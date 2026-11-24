/** The Workspace notice queue's presentation over the shared Toast stack. */
import { IconWarningOutlineRegular, ToastStack, type ToastProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToastOccurrence, ToastStackList } from '../contract/toast.ts'

/** One banner ready for the shared stack. */
type StackEntry = { key: string } & ToastProps

/**
 * Translate one mapped occurrence into a stack entry.
 * @param occurrence - localized copy, its actions, and its own dismissal.
 * @returns the entry the shared stack renders.
 */
function stackEntry({ seq, text, tone, holdMs, actions, onDone }: ToastOccurrence): StackEntry {
  return {
    key: String(seq),
    text,
    ...tone === 'success' ? { tone: 'success' as const } : {},
    ...tone === 'warning' ? { icon: <IconWarningOutlineRegular /> } : {},
    ...holdMs === undefined ? {} : { holdMs },
    ...actions === undefined ? {} : { actions },
    onDone,
  }
}

/**
 * Present every queued notice at one seat.
 *
 * The queue arrives in one call because simultaneous banners must share a
 * fixed position: banners that each fixed themselves to the same window
 * coordinates covered one another, and a banner finishing its own hold could
 * only report "done" for the whole seat, ending the newer notices with it.
 * Each entry keeps its own key and completion, so one settling leaves the
 * others in place.
 * @param props - Mapped notices in arrival order.
 * @returns the floating column, or nothing while the queue is empty.
 */
export function WorkspaceToastStack({ occurrences }: ToastStackList) {
  return <ToastStack entries={occurrences.map(stackEntry)} />
}
