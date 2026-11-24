/** Native-open feedback that survives the initiating panel: mobile success and all failures. */
import type { ReactNode } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconWarningOutlineRegular, isMobileDevice, ToastStack } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { NS } from './locales.ts'
import type { OpenInAppOutcome } from './outcome.ts'

/** One announced gesture; `seq` keys the banner so a repeat restarts it. */
export type OpenInAppToastState = Exclude<OpenInAppOutcome, { kind: 'skipped' }> & { readonly seq: number }

/** Store every contribution reports into and the overlay entry reads. */
export interface OpenInAppToastSource {
  /** Queued notices for the overlay entry, oldest first. */
  readonly hooks: { readonly toast: HostObservable<readonly OpenInAppToastState[]> }
  /**
   * Announce failures on every device and acknowledged opens or reveals on mobile.
   * Desktop successes and skipped gestures leave the current notice unchanged.
   * @param outcome - settled native-open result.
   */
  readonly report: (outcome: OpenInAppOutcome) => void
  /** Clear one notice by its sequence. */
  readonly dismiss: (seq: number) => void
}

/**
 * Create the one outcome store the overlay entry shows.
 * @returns the observable notice with its report and dismiss actions.
 */
export function createOpenInAppToastSource(): OpenInAppToastSource {
  const store = createSnapshotStore<readonly OpenInAppToastState[]>([])
  let seq = 0
  return {
    hooks: { toast: store },
    report: (outcome) => {
      if (outcome.kind === 'skipped') return
      if (outcome.kind !== 'failed' && !isMobileDevice()) return
      seq += 1
      store.set([...store.getSnapshot(), { ...outcome, seq }])
    },
    dismiss: (seq) => { store.set(store.getSnapshot().filter(toast => toast.seq !== seq)) },
  }
}

/** Props of the `shell.overlay` entry: the notice store, its dismissal, and localized copy. */
export type OpenInAppToastProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<Omit<OpenInAppToastSource, 'report'>>

/**
 * Render a mobile handoff confirmation or a native-open failure.
 * @param props - the notice hook, its dismissal, and the locale seat.
 * @returns the banner on display, or null.
 */
export function OpenInAppToast({ useToast, dismiss, t }: OpenInAppToastProps): ReactNode {
  const toasts = useToast(current => current)
  if (toasts.length === 0) return null
  return <ToastStack entries={toasts.map((toast) => {
    const failed = toast.kind === 'failed'
    return {
      key: `open-in-app-${String(toast.seq)}`,
      text: t(failed
        ? toast.failure === 'revealError' ? 'path.revealError' : 'path.openError'
        : toast.kind === 'opened' ? 'path.opened' : 'path.revealed'),
      ...(failed ? { icon: <IconWarningOutlineRegular /> } : { tone: 'success' as const }),
      onDone: () => { dismiss(toast.seq) },
    }
  })} />
}
