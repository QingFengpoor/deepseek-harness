/** The existing overlay presents the Workspace notice queue at one seat. */
import type { PropsLocale, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { RowToastProps } from '../contract/slots.ts'
import type { ToastOccurrence } from '../contract/toast.ts'
import type {} from '../contract/toast.ts'

/** Props of the queue's overlay entry. */
export type RowActionToastProps =
  RowToastProps & PropsLocale<'workspace'> & PropsRenderFactories

/**
 * Present the queued notices without interpreting their business payload.
 *
 * The queue is mapped here, in one piece, instead of by one presentation per
 * notice: banners that each fixed themselves to the same window position
 * covered one another, and one finishing its hold reported "done" for the
 * whole seat. Each occurrence carries its own dismissal, so a banner that
 * finishes its hold settles that entry alone and never takes down the notices
 * queued after it.
 * @param props - Queued notices, their dismissal, the per-kind display mappings, locale, and the Factory renderer.
 * @returns the notice stack, or nothing while no queued notice maps to a banner.
 */
export function RowActionToast({ useToast, dismissToast, displays, t, renderFactorySlot }: RowActionToastProps) {
  const notices = useToast(current => current)
  if (notices.length === 0) return null
  const occurrences: ToastOccurrence[] = []
  for (const notice of notices) {
    const map = displays.get(notice.kind)
    if (map === undefined) continue
    const dismiss = (): void => { dismissToast(notice.seq) }
    occurrences.push({ ...map(notice, t, dismiss), seq: notice.seq, onDone: dismiss })
  }
  return renderFactorySlot('workspace.toast.content', { occurrences })
}
