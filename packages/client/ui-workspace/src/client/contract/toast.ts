/** The Workspace notice queue and the shared Toast Factory's display data. */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToastDisplay } from './slots.ts'

export type { ToastDisplay, ToastDisplayMapper } from './slots.ts'

/**
 * One notice mapped to its display data. `onDone` settles exactly this
 * occurrence, never the whole seat.
 */
export interface ToastOccurrence extends ToastDisplay {
  seq: number
  onDone: () => void
}

/**
 * The mapped queue handed to the shared presentation in a single call.
 *
 * The queue must reach the presentation as one list: an entry that received
 * only its own notice would fix a banner to the same window position as every
 * other entry, so simultaneous banners covered one another and a banner
 * finishing its hold ended the whole seat.
 */
export interface ToastStackList {
  /** Mapped notices in arrival order. */
  occurrences: readonly ToastOccurrence[]
}

/** Complete props of the shared Workspace Toast Factory. */
export type WorkspaceToastProps = FactoryComponentPropsOf<'workspace.toast.content'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /**
     * Shared Toast presentation. One call presents the whole queue, because
     * simultaneous banners must share one fixed seat to stay readable; the
     * business code supplies only display mappings.
     */
    'workspace.toast.content': { scope: 'root'; props: ToastStackList }
  }
}
