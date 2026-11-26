import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { brandString } from '@deepseek-ai/dsh-brand'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { installSessionReadTestServices } from './test-remote.ts'

async function baseContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await installSessionReadTestServices(ctx)
  return ctx
}

interface Fixture {
  readonly ctx: Context
  readonly controller: SessionCommandController
  readonly sessionId: SessionId
  readonly agents: ApiSessionAgentController
}

/** One controller whose agent lookup always resolves the same stand-in Session. */
async function fixture(): Promise<Fixture> {
  const ctx = await baseContext()
  const sessionId = brandString<SessionId>('session-move')
  const agent = {
    id: sessionId,
    session: ctx.sessions.create(sessionId, { meta: { cwd: '/old' } }),
  } as unknown as Agent
  const agents = new ApiSessionAgentController(ctx)
  vi.spyOn(agents, 'resolveAgent').mockResolvedValue({ agent })
  const controller = new SessionCommandController(ctx, agents, '/default')
  return { ctx, controller, sessionId, agents }
}

describe('Session working-directory move', () => {
  it('commits the move, files the Session under the owning Workspace, and checkpoints', async () => {
    const f = await fixture()
    const set = vi.fn(async () => '/new')
    const attachSession = vi.fn(async () => {})
    const write = vi.fn(async () => {})
    f.ctx.provide('workingDirectory', { set } as never)
    f.ctx.provide('workspaceRegistry', {
      list: () => [{
        id: 'workspace-owners', paths: ['/new'], sessionIds: [],
        attachSession,
      }],
    } as never)
    f.ctx.provide('sessionProjectionCache', { write } as never)

    const result = await f.controller.setWorkingDirectory({ sessionId: f.sessionId, path: '/new' })

    expect(result).toEqual({ cwd: '/new', workspaceId: 'workspace-owners' })
    expect(set).toHaveBeenCalledOnce()
    expect(attachSession).toHaveBeenCalledWith(f.sessionId)
    expect(write).toHaveBeenCalledOnce()
    await f.ctx.fiber.dispose()
  })

  it('keeps the committed move when no Workspace owns the new directory', async () => {
    const f = await fixture()
    const set = vi.fn(async () => '/elsewhere')
    const write = vi.fn(async () => {})
    f.ctx.provide('workingDirectory', { set } as never)
    f.ctx.provide('workspaceRegistry', { list: () => [] } as never)
    f.ctx.provide('sessionProjectionCache', { write } as never)

    await expect(f.controller.setWorkingDirectory({ sessionId: f.sessionId, path: '/elsewhere' }))
      .resolves.toEqual({ cwd: '/elsewhere' })
    expect(write).toHaveBeenCalledOnce()
    await f.ctx.fiber.dispose()
  })

  it('keeps the committed move when the Workspace refuses the attach or the cache write fails', async () => {
    const f = await fixture()
    f.ctx.provide('workingDirectory', { set: async () => '/new' } as never)
    f.ctx.provide('workspaceRegistry', {
      list: () => [{
        id: 'workspace-owners', paths: ['/new'], sessionIds: [],
        attachSession: async () => { throw new Error('header still names the original project') },
      }],
    } as never)
    f.ctx.provide('sessionProjectionCache', {
      write: async () => { throw new Error('cache unavailable') },
    } as never)

    await expect(f.controller.setWorkingDirectory({ sessionId: f.sessionId, path: '/new' }))
      .resolves.toEqual({ cwd: '/new' })
    await f.ctx.fiber.dispose()
  })

  it.each([
    ['WORKING_DIRECTORY_NOT_FOUND', 'session/working-directory-not-found'],
    ['WORKING_DIRECTORY_INVALID', 'session/working-directory-invalid'],
    ['WORKING_DIRECTORY_UNAVAILABLE', 'session/working-directory-unavailable'],
    ['SOMETHING_ELSE', 'session/working-directory-unavailable'],
  ])('maps %s to %s', async (serviceCode, remoteCode) => {
    const f = await fixture()
    f.ctx.provide('workingDirectory', {
      set: async () => { throw Object.assign(new Error('refused'), { code: serviceCode }) },
    } as never)

    const failure = await f.controller.setWorkingDirectory({ sessionId: f.sessionId, path: '/new' })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect((failure as RemoteError).code).toBe(remoteCode)
    expect((failure as RemoteError).details).toMatchObject({ sessionId: f.sessionId, path: '/new' })
    await f.ctx.fiber.dispose()
  })

  it('reports a deployment without the working-directory service', async () => {
    const f = await fixture()

    const failure = await f.controller.setWorkingDirectory({ sessionId: f.sessionId, path: '/new' })
      .catch((error: unknown) => error)
    expect((failure as RemoteError).code).toBe('gateway/internal')
    await f.ctx.fiber.dispose()
  })
})
