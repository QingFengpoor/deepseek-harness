/** Workspace command implementation and stable Remote failure mapping. */

import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceActiveSessionError,
  WorkspaceArchivedSessionPinError,
  WorkspaceDuplicatePathError,
  WorkspaceId,
  WorkspaceLastPathError,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspacePathConflictError,
  WorkspacePathNotOwnedError,
  WorkspaceUnknownSessionError,
} from '@deepseek-ai/dsh-workspace'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { workspaceView } from './feed.ts'
import type {
  WorkspaceAddPathRequest,
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspacePinSessionRequest,
  WorkspacePinValue,
  WorkspaceRemovePathRequest,
  WorkspaceRenameRequest,
  WorkspaceSetPrimaryPathRequest,
  WorkspaceUnarchiveSessionRequest,
  WorkspaceUnpinSessionRequest,
  WorkspaceValue,
} from './types.ts'

/** Implements Workspace mutations against the authoritative registry. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(private readonly ctx: Context) {}

  /**
   * Create or resolve one Workspace over one or more existing directories.
   * `paths` is the multi-root form; `path` remains the compatibility form.
   * @param request - directory path(s) to register.
   * @returns the Workspace and whether this call created it.
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    const requested = request.paths ?? (request.path === undefined ? [] : [request.path])
    return this.enqueue(async () => {
      if (requested.length === 0) {
        throw new RemoteError(
          'workspace/invalid-path',
          'Workspace creation requires at least one directory path',
          { path: '' },
        )
      }
      try {
        if (requested.length === 1) {
          const existing = await this.ctx.workspaceRegistry.resolveByPath(requested[0] as string)
          if (existing !== undefined) {
            return { workspace: workspaceView(existing), created: false }
          }
        }
        const before = new Set(this.ctx.workspaceRegistry.list().map(workspace => workspace.id))
        const workspace = await this.ctx.workspaceRegistry.create(requested, request.title)
        return { workspace: workspaceView(workspace), created: !before.has(workspace.id) }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        if (error instanceof WorkspacePathConflictError) throw this.pathConflict(error)
        throw new RemoteError(
          'workspace/invalid-path',
          `cannot create a Workspace at "${requested[0] as string}": ${errorMessage(error)}`,
          { path: requested[0] as string },
          { cause: error },
        )
      }
    })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(new RemoteError('gateway/bad-request', 'Workspace rename requires a non-blank title', {}))
    }
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      if (title !== workspace.title) {
        if (this.ctx.workspaceRegistry.list().some(candidate =>
          candidate.id !== workspace.id && candidate.title === title)) {
          throw new RemoteError(
            'workspace/name-conflict',
            `Workspace name '${title}' is already in use`,
            { name: title },
          )
        }
        await workspace.setTitle(title)
      }
      return { workspace: workspaceView(workspace) }
    })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.enqueue(async () => {
      if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
        throw workspaceNotFound(request.workspaceId)
      }
      return { deleted: true }
    })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    try {
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return { workspaceIds: [...workspaceIds] }
    } catch (error) {
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Append one existing directory as another root of a Workspace.
   * @param request - Workspace identity and directory path.
   * @returns the updated Workspace projection.
   */
  addPath(request: WorkspaceAddPathRequest): Promise<WorkspaceValue> {
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      try {
        await this.ctx.workspaceRegistry.addPath(WorkspaceId(request.workspaceId), request.path)
      } catch (error) {
        throw this.pathMutationError(error, request.path)
      }
      return { workspace: workspaceView(workspace) }
    })
  }

  /**
   * Remove one root from a Workspace.
   * @param request - Workspace identity and owned root path.
   * @returns the updated Workspace projection.
   */
  removePath(request: WorkspaceRemovePathRequest): Promise<WorkspaceValue> {
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      try {
        await this.ctx.workspaceRegistry.removePath(WorkspaceId(request.workspaceId), request.path)
      } catch (error) {
        throw this.pathMutationError(error, request.path)
      }
      return { workspace: workspaceView(workspace) }
    })
  }

  /**
   * Promote one owned root to the Workspace's primary root.
   * @param request - Workspace identity and owned root path.
   * @returns the updated Workspace projection.
   */
  setPrimaryPath(request: WorkspaceSetPrimaryPathRequest): Promise<WorkspaceValue> {
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      try {
        await this.ctx.workspaceRegistry.setPrimaryPath(WorkspaceId(request.workspaceId), request.path)
      } catch (error) {
        throw this.pathMutationError(error, request.path)
      }
      return { workspace: workspaceView(workspace) }
    })
  }

  private pathMutationError(error: unknown, path: string): unknown {
    if (error instanceof WorkspacePathConflictError) return this.pathConflict(error)
    if (error instanceof WorkspaceDuplicatePathError) {
      return new RemoteError('workspace/duplicate-path', error.message, { path: error.path }, { cause: error })
    }
    if (error instanceof WorkspaceLastPathError) {
      return new RemoteError('workspace/last-path', error.message, { workspaceId: error.workspaceId }, { cause: error })
    }
    if (error instanceof WorkspacePathNotOwnedError) {
      return new RemoteError(
        'workspace/path-not-owned',
        error.message,
        { path: error.path, workspaceId: error.workspaceId },
        { cause: error },
      )
    }
    return new RemoteError('workspace/invalid-path', errorMessage(error), { path }, { cause: error })
  }

  private pathConflict(error: WorkspacePathConflictError): RemoteError<'workspace/path-conflict'> {
    return new RemoteError(
      'workspace/path-conflict',
      error.message,
      { path: error.path, workspaceId: error.workspaceId },
      { cause: error },
    )
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw new RemoteError(
        'workspace/move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
        { cause: error },
      )
    }
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Add one known Session to the registry-global archive set. Without
   * `stopActivity` a Session with running work is refused as
   * `workspace/session-active` with the activity the registry's providers
   * reported; with it, the providers stop that work first.
   * @param request - Session identity to archive and whether to stop its work.
   * @returns the complete resulting archive set.
   */
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    try {
      await this.ctx.workspaceRegistry.archiveSession(
        request.sessionId,
        request.stopActivity === true ? { stopActivity: true } : {},
      )
    } catch (error) {
      if (error instanceof WorkspaceUnknownSessionError) {
        throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
      }
      if (error instanceof WorkspaceActiveSessionError) {
        throw new RemoteError(
          'workspace/session-active',
          error.message,
          { sessionId: request.sessionId, activity: error.activity },
          { cause: error },
        )
      }
      throw error
    }
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Drop one Session from the registry-global archive set. An id that is not
   * archived is not an error: the call is idempotent, so a lost race with
   * another surface resolves as a no-op.
   * @param request - Session identity to unarchive.
   * @returns the complete resulting archive set.
   */
  async unarchiveSession(request: WorkspaceUnarchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    await this.ctx.workspaceRegistry.unarchiveSession(request.sessionId)
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Add one known unarchived Session to the registry-global pin set.
   * @param request - Session identity to pin.
   * @returns the complete resulting pin set, most recently pinned first.
   */
  async pinSession(request: WorkspacePinSessionRequest): Promise<WorkspacePinValue> {
    try {
      await this.ctx.workspaceRegistry.pinSession(request.sessionId)
    } catch (error) {
      if (error instanceof WorkspaceUnknownSessionError) {
        throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
      }
      if (error instanceof WorkspaceArchivedSessionPinError) {
        throw new RemoteError('gateway/bad-request', error.message, {}, { cause: error })
      }
      throw error
    }
    return { pinnedSessionIds: [...this.ctx.workspaceRegistry.pinnedSessionIds] }
  }

  /**
   * Drop one Session from the registry-global pin set. An id that is not
   * pinned is not an error: the call is idempotent, so a lost race with
   * another surface resolves as a no-op.
   * @param request - Session identity to unpin.
   * @returns the complete resulting pin set, most recently pinned first.
   */
  async unpinSession(request: WorkspaceUnpinSessionRequest): Promise<WorkspacePinValue> {
    await this.ctx.workspaceRegistry.unpinSession(request.sessionId)
    return { pinnedSessionIds: [...this.ctx.workspaceRegistry.pinnedSessionIds] }
  }

  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw workspaceNotFound(workspaceId)
    return workspace
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function workspaceNotFound(workspaceId: WorkspaceId): RemoteError<'workspace/not-found'> {
  return new RemoteError(
    'workspace/not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
