/** Business-owned display mappings for the Workspace notice queue. */
import type { Context } from '@deepseek-ai/cordis'
import type { RowToastActions, RowToastState, WorkspaceViewStoreHandle } from '../contract/slots.ts'
import type { ToastDisplay, ToastDisplayMapper } from '../contract/toast.ts'
import { WorkspaceToastStack } from './Toast.tsx'

/** Display fields for one archived notice plus the filter action it offers. */
type ArchiveNotice = Extract<RowToastState, { kind: 'archived' | 'stoppedAndArchived' }>

/**
 * Register the queue's presentation and every kind's display mapping.
 *
 * The overlay holds the queue and presents it at one seat, so a kind
 * contributes a mapping here instead of rendering a banner of its own:
 * independent banners cannot share a seat, and one finishing its hold could
 * only end the whole seat. The mapping list is keyed by notice kind and handed
 * to the overlay, which maps the queued notices in arrival order.
 * @param ctx - Workspace plugin context.
 * @param viewStore - Viewing store, read only by archive notices.
 * @param actions - Archive and source-opening callbacks.
 * @returns Display mappings keyed by the notice kind each one owns.
 */
export function registerToasts(
  ctx: Context,
  viewStore: WorkspaceViewStoreHandle,
  actions: Pick<RowToastActions, 'undoArchive' | 'showArchived' | 'openForkSource'>,
): ReadonlyMap<RowToastState['kind'], ToastDisplayMapper> {
  const archivedVisible = (): boolean => (viewStore.create().store.getSnapshot().archivedFilter ?? 'default') !== 'default'
  const archiveDisplay = (
    notice: ArchiveNotice,
    t: Parameters<ToastDisplayMapper>[1],
    dismiss: () => void,
  ): ToastDisplay => {
    const undo = {
      label: t('toast.archivedUndo'),
      onClick: () => { dismiss(); actions.undoArchive(notice.sessionId) },
    }
    // The filter action only helps while archived rows are hidden: once they
    // show, it would point at rows already in view.
    const actionsList = archivedVisible() ? [undo] : [undo, {
      prefix: t('toast.archivedOr'), label: t('toast.archivedFilter'),
      onClick: () => { dismiss(); actions.showArchived() },
    }]
    return {
      text: notice.message ?? t(notice.kind === 'archived' ? 'toast.archived' : 'toast.stoppedAndArchived'),
      tone: notice.tone ?? 'success', holdMs: 6000, actions: actionsList,
    }
  }
  ctx.slots.registerFactory({ name: 'workspace.toast.content', scope: 'root' }, WorkspaceToastStack)
  return new Map<RowToastState['kind'], ToastDisplayMapper>([
    ['sessionIdCopied', (_notice, t) => ({ text: t('toast.sessionIdCopied'), tone: 'success' })],
    ['sessionIdCopyFailed', (_notice, t) => ({ text: t('toast.sessionIdCopyFailed'), tone: 'warning' })],
    ['pinFailed', (_notice, t) => ({ text: t('toast.pinFailed'), tone: 'warning' })],
    ['unpinFailed', (_notice, t) => ({ text: t('toast.unpinFailed'), tone: 'warning' })],
    ['archivedNotOpenable', (_notice, t) => ({ text: t('toast.archivedNotOpenable'), tone: 'warning' })],
    ['defaultWorkspaceFailed', (_notice, t) => ({ text: t('defaultWorkspace.failed'), tone: 'warning' })],
    ['shortcutForkFailed', (notice, t) => ({
      text: t(notice.kind === 'shortcutForkFailed' && notice.reason === 'unavailable'
        ? 'shortcut.noCompletedTurn' : 'shortcut.forkFailed'),
      tone: 'plain',
    })],
    ['createFailed', (notice, t) => ({
      text: t('toast.createFailed', { message: notice.kind === 'createFailed' ? notice.message : '' }),
      tone: 'warning', holdMs: 6000,
    })],
    ['forkRequiresOpen', (notice, t, dismiss) => ({
      text: t('toast.forkRequiresOpen'), tone: 'warning', holdMs: 6000,
      actions: [{
        label: t('toast.openForkSource'),
        onClick: () => {
          dismiss()
          if (notice.kind === 'forkRequiresOpen') actions.openForkSource(notice.sessionId)
        },
      }],
    })],
    ['archived', (notice, t, dismiss) => archiveDisplay(notice as ArchiveNotice, t, dismiss)],
    ['stoppedAndArchived', (notice, t, dismiss) => archiveDisplay(notice as ArchiveNotice, t, dismiss)],
  ])
}
