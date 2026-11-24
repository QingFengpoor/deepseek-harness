/** Regression: an archived Session never comes back through the saved selection. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { bench, persistSelection } from './workspaces-service.client.spec.ts'

const sid = (value: string): SessionId => value as SessionId

function workspace(id: string, sessionIds: readonly SessionId[]) {
  return {
    workspaceId: id as never,
    path: `/w/${id}`,
    paths: [`/w/${id}`],
    title: id,
    sessionIds,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function summary(id: string) {
  return { id: sid(id), displayTitle: id, running: false, blank: false, updatedAt: 0, retainedBy: {} }
}

function state(archived: readonly SessionId[]) {
  return {
    items: [workspace('a', [sid('old')])],
    archivedSessionIds: archived,
    pinnedSessionIds: [],
    phase: 'ready' as const,
    state: 'idle' as const,
    error: null,
  }
}

function list() {
  return {
    ids: [sid('old')],
    byId: { [sid('old')]: summary('old') },
    phase: 'ready' as const,
    projectionsBySession: {},
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('archived Session restoration', () => {
  it('drops a saved selection the archive set hides instead of reopening it', async () => {
    const backing = persistSelection({ sessionId: sid('old') })
    const b = bench({ workspaces: state([]), sessions: list() })
    await vi.waitFor(() => { expect(b.sessions.retained.length).toBe(1) })

    b.workspaces.list.set(state([sid('old')]))
    await vi.waitFor(() => {
      expect(JSON.parse(backing.get('dsh.sessions.current') ?? '"missing"')).toEqual({})
    })
    // Reopening would retain the Session again; the archive must not do that.
    expect(b.sessions.retained.length).toBe(1)
  })

  it('re-reads the Session list and restarts the Workspace follow on refresh', async () => {
    const reloader = vi.fn()
    const b = bench({ workspaces: state([]), sessions: list() })
    b.ctx.provide('workspaceReloader', reloader)
    await b.uiWorkspace.refreshSessionList()
    expect(b.sessions.refresh).toHaveBeenCalledOnce()
    expect(reloader).toHaveBeenCalledOnce()
  })
})
