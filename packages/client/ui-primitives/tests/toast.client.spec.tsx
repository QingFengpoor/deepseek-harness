// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { Toast, ToastStack } from '../src/Toast.tsx'

afterEach(cleanup)

describe('Toast', () => {
  it('announces its text and reports done after the hold-and-fade lifetime', () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="最多添加 50 张图片" icon={<svg data-testid="icon" />} onDone={onDone} />)
      const banner = view.getByRole('alert')
      expect(banner.textContent).toContain('最多添加 50 张图片')
      expect(view.getByTestId('icon')).toBeTruthy()
      vi.advanceTimersByTime(3999)
      expect(onDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds for the owner\'s window and hands the stylesheet the same value', () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="切换失败" holdMs={6000} onDone={onDone} />)
      // One value drives both, so a banner can never unmount mid-fade: the
      // timer waits the hold plus the fade, and the stylesheet delays the
      // fade by the same hold.
      expect(view.getByRole('alert').style.getPropertyValue('--dsh-toast-hold')).toBe('6000ms')
      vi.advanceTimersByTime(6999)
      expect(onDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onDone).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps its original expiry across rerenders and calls the latest completion handler', () => {
    vi.useFakeTimers()
    try {
      const first = vi.fn()
      const latest = vi.fn()
      const view = render(<Toast text="archived" onDone={first} />)
      vi.advanceTimersByTime(1000)
      view.rerender(<Toast text="archived" onDone={latest} />)
      vi.advanceTimersByTime(2999)
      expect(first).not.toHaveBeenCalled()
      expect(latest).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(first).not.toHaveBeenCalled()
      expect(latest).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('centers over its anchor and re-measures on window resize', () => {
    vi.useFakeTimers()
    try {
      const anchor = document.createElement('div')
      document.body.appendChild(anchor)
      anchor.getBoundingClientRect = () => ({ left: 100, width: 400 }) as DOMRect
      const view = render(<Toast text="anchored" anchor={anchor} onDone={vi.fn()} />)
      expect(view.getByRole('alert').style.left).toBe('300px')
      anchor.getBoundingClientRect = () => ({ left: 200, width: 400 }) as DOMRect
      fireEvent(window, new Event('resize'))
      expect(view.getByRole('alert').style.left).toBe('400px')
      anchor.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flows prefixed actions inline as one sentence and hands each press to the owner', () => {
    vi.useFakeTimers()
    try {
      const undo = vi.fn()
      const filter = vi.fn()
      const view = render(
        <Toast
          text="会话已归档，可"
          tone="success"
          actions={[
            { label: '撤销', onClick: undo },
            { prefix: '或', label: '筛选已归档会话', onClick: filter },
          ]}
          onDone={vi.fn()}
        />,
      )
      // The success tone brings the circled green check itself; no icon prop.
      const glyph = view.getByRole('alert').querySelector('[aria-hidden]')
      expect(glyph?.className).toContain('success')
      expect(glyph?.querySelector('svg')).toBeTruthy()
      expect(view.getByRole('alert').textContent).toBe('会话已归档，可撤销或筛选已归档会话')
      fireEvent.click(view.getByRole('button', { name: '撤销' }))
      expect(undo).toHaveBeenCalledTimes(1)
      fireEvent.click(view.getByRole('button', { name: '筛选已归档会话' }))
      expect(filter).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lays simultaneous banners out in one column instead of stacking them on the same seat', () => {
    const view = render(<ToastStack anchor={null} entries={[
      { key: '1', text: 'first', onDone: vi.fn() },
      { key: '2', text: 'second', onDone: vi.fn() },
    ]} />)
    // One fixed seat owns the window position; each banner flows inside it.
    const alerts = view.getAllByRole('alert')
    expect(alerts.map(alert => alert.textContent)).toEqual(['second', 'first'])
    const seat = alerts[0]!.parentElement!
    expect(seat.hasAttribute('data-dsh-toast-stack')).toBe(true)
    for (const alert of alerts) {
      expect(alert.parentElement).toBe(seat)
      // A flow-positioned banner keeps its parent's order instead of fixing
      // itself to the window at the same coordinates as its neighbours.
      expect(alert.style.top).toBe('')
      expect(alert.style.left).toBe('')
    }
  })

  it('renders nothing while the stack holds no entry', () => {
    render(<ToastStack entries={[]} />)
    expect(document.querySelector('[data-dsh-toast-stack]')).toBeNull()
  })

  it('settles only the banner that reached its own hold', () => {
    vi.useFakeTimers()
    try {
      const firstDone = vi.fn()
      const secondDone = vi.fn()
      const view = render(<ToastStack entries={[
        { key: '1', text: 'first', holdMs: 1000, onDone: firstDone },
        { key: '2', text: 'second', holdMs: 5000, onDone: secondDone },
      ]} />)
      expect(view.getAllByRole('alert')).toHaveLength(2)
      // The shorter hold ends first and reports only itself.
      vi.advanceTimersByTime(2000)
      expect(firstDone).toHaveBeenCalledOnce()
      expect(secondDone).not.toHaveBeenCalled()
      vi.advanceTimersByTime(4000)
      expect(secondDone).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows every queued banner without dropping any, newest first', () => {
    const texts = ['one', 'two', 'three', 'four', 'five']
    const view = render(<ToastStack entries={texts.map((text, index) => ({
      key: String(index), text, onDone: vi.fn(),
    }))} />)
    expect(view.getAllByRole('alert').map(alert => alert.textContent)).toEqual([...texts].reverse())
  })

  it('renders without an icon and cancels its timer on unmount', () => {
    vi.useFakeTimers()
    try {
      const onDone = vi.fn()
      const view = render(<Toast text="plain" onDone={onDone} />)
      expect(view.getByRole('alert').querySelector('[aria-hidden]')).toBeNull()
      view.unmount()
      vi.advanceTimersByTime(10_000)
      expect(onDone).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
