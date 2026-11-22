import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckCircleOutlineRegular } from './icons/index.tsx'
import css from './Toast.module.css'

/** Full-opacity hold before the fade starts, when the owner names none. */
const HOLD_MS = 3000
/** Fade duration. Must agree with the stylesheet's toast-fade duration. */
const FADE_MS = 1000
/**
 * Simultaneous banners one stack keeps. The stack renders newest first, so a
 * flood over the cap drops its oldest entries instead of hiding the newest.
 */
const STACK_LIMIT = 3

/**
 * Props of one banner. Owners that may hold several notices at once render
 * {@link ToastStack}, which lays simultaneous banners out instead of letting
 * them share one fixed position.
 */
export interface ToastProps {
  text: string
  icon?: ReactNode
  tone?: 'success'
  anchor?: HTMLElement | null
  holdMs?: number
  actions?: readonly { label: string; prefix?: string; onClick: () => void }[]
  onDone: () => void
}

/**
 * Transient top-center banner: slides in, holds at full opacity, fades out,
 * then reports done so the owner can unmount it. Re-showing the same text
 * restarts the cycle when the owner remounts the component (key it by a
 * per-show sequence). Rendered through a body portal so an owner inside a
 * transformed or filtered ancestor cannot trap the fixed banner in that
 * ancestor's box.
 * With unchanged holdMs, parent rerenders do not extend the lifetime.
 * Completion calls the latest onDone handler; fully faded actions receive no input.
 *
 * The hold is the owner's to set, because how long a banner has to stay
 * depends on how much there is to read: a one-line limit lands in the default
 * window, while a failure that names what broke does not. One value drives
 * both the unmount timer and the stylesheet's fade delay — the stylesheet
 * reads it as a custom property — so the two can no longer disagree and leave
 * the banner unmounting mid-fade.
 * @param props.text - resolved banner copy; the owner passes localized text.
 * @param props.icon - optional leading glyph (e.g. a warning icon); ignored
 * under `tone="success"`, which brings its own glyph.
 * @param props.tone - 'success' renders the design's circled green check as
 * the leading glyph; omitted, the icon seat keeps its warning tint.
 * @param props.actions - optional inline actions continuing the sentence:
 * each renders its plain-text `prefix` (a connective like 或) followed by its
 * localized `label` as blue clickable text, flowing after `text` as one
 * sentence. Each press is the owner's to handle (e.g. undo the reported
 * change, then unmount the toast). The banner surface stays click-through —
 * only the action text takes the pointer.
 * @param props.holdMs - full-opacity hold before the fade; defaults to 3000.
 * @param props.anchor - optional element whose horizontal center the banner
 * follows (e.g. the composer card, so the banner centers over the chat column
 * rather than the whole window); omitted, it centers on the viewport.
 * @param props.onDone - called once the fade completes; unmount the toast here.
 * @param props.position - 'viewport' keeps the banner fixed to the window;
 * 'flowed' leaves it in its parent's layout, for {@link ToastStack}, whose
 * element supplies the fixed seat and the vertical order.
 * @returns the floating banner.
 */
export function Toast({
  text, icon, tone, anchor, holdMs = HOLD_MS, actions, onDone, position = 'viewport',
}: ToastProps & { position?: 'viewport' | 'flowed' }) {
  const latestOnDone = useRef(onDone)
  useLayoutEffect(() => { latestOnDone.current = onDone }, [onDone])
  useEffect(() => {
    const timer = setTimeout(() => { latestOnDone.current() }, holdMs + FADE_MS)
    return () => { clearTimeout(timer) }
  }, [holdMs])
  // Anchor-centered placement re-measures on window resizes; the banner lives
  // four seconds, so sub-window layout drift within that span stays out of
  // scope.
  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (anchor == null) return
    const measure = (): void => {
      const rect = anchor.getBoundingClientRect()
      setLeft(rect.left + rect.width / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [anchor])
  const banner = (
    <div
      className={position === 'flowed' ? `${css.toast} ${css.flowed}` : css.toast}
      role="alert"
      style={{
        ...left === null ? {} : { left },
        '--dsh-toast-hold': `${String(holdMs)}ms`,
      } as CSSProperties}
    >
      {tone === 'success'
        ? <span className={`${css.icon} ${css.success}`} aria-hidden><IconCheckCircleOutlineRegular /></span>
        : icon !== undefined && <span className={css.icon} aria-hidden>{icon}</span>}
      <span className={css.text}>
        {text}
        {actions?.map(action => (
          <Fragment key={action.label}>
            {action.prefix}
            <button type="button" className={css.action} onClick={action.onClick}>
              {action.label}
            </button>
          </Fragment>
        ))}
      </span>
    </div>
  )
  // A flowed banner already sits inside the stack's own portal; portaling it
  // again would lift it back to the body and undo the column it belongs to.
  return position === 'flowed' ? banner : createPortal(banner, document.body)
}

/**
 * Several notices at one seat: the element owns the single fixed position and
 * lays its banners out in a column, newest on top. Independent banners that
 * each fixed themselves to the same coordinates would cover one another, so
 * every owner that can hold more than one notice presents them here.
 * Entries expire individually: one banner's completion removes only its own
 * entry, and reaching the fade of an older banner never ends a newer one.
 * The stack keeps {@link STACK_LIMIT} entries, dropping the oldest beyond it.
 * @param props.entries - banners in arrival order; each needs a stable `key`.
 * @param props.anchor - optional element whose horizontal center the column
 * follows; omitted, it centers on the viewport.
 * @returns the floating column, or nothing while it holds no entry.
 */
export function ToastStack({ entries, anchor }: {
  entries: readonly ({ key: string } & ToastProps)[]
  anchor?: HTMLElement | null
}) {
  // Anchor-centered placement re-measures on window resizes; the column is
  // short-lived, so sub-window layout drift within that span stays out of
  // scope.
  const [left, setLeft] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (anchor == null) return
    const measure = (): void => {
      const rect = anchor.getBoundingClientRect()
      setLeft(rect.left + rect.width / 2)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => { window.removeEventListener('resize', measure) }
  }, [anchor])
  const shown = entries.slice(Math.max(0, entries.length - STACK_LIMIT))
  if (shown.length === 0) return null
  return createPortal(
    <div
      className={css.stack}
      data-dsh-toast-stack=""
      style={{ ...left === null ? {} : { left } }}
    >
      {[...shown].reverse().map(({ key, ...banner }) => (
        <Toast key={key} position="flowed" {...banner} />
      ))}
    </div>,
    document.body,
  )
}
