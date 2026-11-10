/**
 * Package-private workspace entity: the single {@link Workspace}
 * implementation. Holds a record snapshot that is swapped in place after each
 * durable mutation; every write funnels through the private `mutate` so
 * `updatedAt` stamping and invalid-account pruning happen exactly once.
 * Not re-exported from the package entrypoint — consumers see only the
 * `Workspace` interface.
 * @module @deepseek-ai/dsh-workspace/src/entity
 */

import { stat } from 'node:fs/promises'
import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceRecord } from './spec.ts'
import type { Workspace, WorkspaceId } from './types.ts'
import { realpathNormalize, storedWorkspacePaths } from './paths.ts'

/** An insertSessionBefore request named a session or anchor not on the account (storage failures stay plain errors). */
export class WorkspaceMoveInvalidError extends Error {
  /**
   * @param message - Which id was unaccounted and where.
   */
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceMoveInvalidError'
  }
}

/** A root mutation named a canonical path the workspace does not own. */
export class WorkspacePathNotOwnedError extends Error {
  /**
   * @param path - The canonical root the caller named.
   * @param workspaceId - The workspace that was asked to mutate.
   */
  constructor(readonly path: string, readonly workspaceId: WorkspaceId) {
    super(`workspace '${workspaceId}' does not own root '${path}'`)
    this.name = 'WorkspacePathNotOwnedError'
  }
}

/** A root removal would leave the workspace with no roots at all. */
export class WorkspaceLastPathError extends Error {
  /**
   * @param workspaceId - The workspace whose last root was named for removal.
   */
  constructor(readonly workspaceId: WorkspaceId) {
    super(`cannot remove the last root of workspace '${workspaceId}'; delete the workspace instead`)
    this.name = 'WorkspaceLastPathError'
  }
}

/**
 * The registry-owned machinery an entity mutates through. Entities never see
 * the registry itself — only the open table, the canonical session-path
 * index backing the `sessionIds` projection, and attach-time header reads.
 */
export interface WorkspaceEntityHost {
  /**
   * Resolve the open `workspaces` table.
   * @returns the table; throws while the registry has not started yet.
   */
  table(): KvTable<WorkspaceId, WorkspaceRecord>

  /**
   * Validate an already-accounted session, preserving ownership when its fully
   * qualified cwd cannot resolve because a path component is missing.
   * @param id - Session already present in this workspace's candidate account.
   * @param paths - The workspace's stored canonical roots.
   * @returns whether the candidate remains a member.
   */
  candidateMatches(id: SessionId, paths: readonly string[]): boolean

  /**
   * Read one stored session header for attach validation.
   * @param id - The session whose header to read.
   * @returns the header; rejects when session persistence is absent or holds
   * no session with this id.
   */
  readSessionHeader(id: SessionId): Promise<SessionHeader>

  /**
   * Publish a successfully validated canonical cwd to the projection index.
   * @param id - Validated session id.
   * @param path - Canonical existing directory from the immutable header cwd.
   */
  rememberSessionPath(id: SessionId, path: string): void
}

/** Chain-slot abort sentinel thrown by the update fn when the record needs no change; only `mutate` observes it. */
const unchangedSentinel = new Error('workspace record unchanged (internal sentinel)')

/** The single {@link Workspace} implementation; constructed only by the registry. */
export class WorkspaceEntity implements Workspace {
  private record: WorkspaceRecord

  /**
   * @param host - Registry-owned table, session-path index, and header reads.
   * @param id - The record's stable id.
   * @param record - The validated record snapshot loaded or just written.
   */
  constructor(
    private readonly host: WorkspaceEntityHost,
    readonly id: WorkspaceId,
    record: WorkspaceRecord,
  ) {
    this.record = record
  }

  get path(): string {
    return this.record.path
  }

  get paths(): readonly string[] {
    return storedWorkspacePaths(this.record)
  }

  get title(): string {
    return this.record.title
  }

  get createdAt(): string {
    return this.record.createdAt
  }

  get updatedAt(): string {
    return this.record.updatedAt
  }

  get sessionIds(): readonly SessionId[] {
    return this.record.sessionIds.filter(id => this.host.candidateMatches(id, this.paths))
  }

  async setTitle(title: string): Promise<void> {
    await this.mutate(record => ({ ...record, title }))
  }

  async attachSession(sessionId: SessionId): Promise<void> {
    // Validation is skipped when the settled snapshot already accounts the
    // id: the cwd fact was checked when it first attached and both inputs
    // (stored header cwd, workspace path) are immutable. Membership itself is
    // decided on the write chain inside `mutate`, never on this snapshot.
    if (!this.record.sessionIds.includes(sessionId)) {
      const header = await this.host.readSessionHeader(sessionId)
      if (header.cwd === undefined) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + 'its stored header carries no cwd to validate against',
        )
      }
      let cwd: string
      try {
        cwd = await realpathNormalize(header.cwd)
      } catch (error) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd '${header.cwd}' does not resolve, so it cannot be validated`,
          { cause: error },
        )
      }
      if (!(await stat(cwd)).isDirectory()) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd '${header.cwd}' is not a directory`,
        )
      }
      if (!this.paths.includes(cwd)) {
        throw new Error(
          `cannot attach session '${sessionId}' to workspace '${this.record.path}': `
          + `its cwd resolves to '${cwd}', which is not one of this workspace's roots`,
        )
      }
      this.host.rememberSessionPath(sessionId, cwd)
    }
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? record
      : { ...record, sessionIds: [sessionId, ...record.sessionIds] })
  }

  async insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void> {
    await this.mutate((record) => {
      if (!record.sessionIds.includes(sessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' in workspace '${record.path}': the session is not accounted`,
        )
      }
      if (beforeSessionId !== undefined && !record.sessionIds.includes(beforeSessionId)) {
        throw new WorkspaceMoveInvalidError(
          `cannot move session '${sessionId}' before '${beforeSessionId}' in workspace '${record.path}': `
          + 'the anchor session is not accounted',
        )
      }
      if (beforeSessionId === sessionId) return record
      const without = record.sessionIds.filter(id => id !== sessionId)
      const at = beforeSessionId === undefined ? without.length : without.indexOf(beforeSessionId)
      const sessionIds = [...without.slice(0, at), sessionId, ...without.slice(at)]
      return sessionIds.every((id, index) => id === record.sessionIds[index])
        ? record
        : { ...record, sessionIds }
    })
  }

  async detachSession(sessionId: SessionId): Promise<void> {
    await this.mutate(record => record.sessionIds.includes(sessionId)
      ? { ...record, sessionIds: record.sessionIds.filter(id => id !== sessionId) }
      : record)
  }

  /**
   * Append one canonical root. The registry owns global ownership checks before
   * calling this; the write itself only rejects a duplicate already on the
   * record (idempotent no-op) and leaves the primary root untouched.
   * @param path - Canonical existing directory not already owned by this workspace.
   * @returns resolution after durability.
   */
  async addPath(path: string): Promise<void> {
    await this.mutate((record) => {
      const paths = storedWorkspacePaths(record)
      return paths.includes(path) ? record : { ...record, paths: [...paths, path] }
    })
  }

  /**
   * Remove one root. The last root cannot be removed; removing the primary root
   * promotes the next root in order. Sessions whose cwd was the removed root no
   * longer match membership, so the same durable write prunes their account
   * slots (their logs are untouched).
   * @param path - Canonical root currently owned by this workspace.
   * @returns resolution after durability.
   */
  async removePath(path: string): Promise<void> {
    await this.mutate((record) => {
      const paths = storedWorkspacePaths(record)
      if (!paths.includes(path)) throw new WorkspacePathNotOwnedError(path, this.id)
      if (paths.length === 1) throw new WorkspaceLastPathError(this.id)
      const next = paths.filter(candidate => candidate !== path)
      return { ...record, path: next[0] as string, paths: next }
    })
  }

  /**
   * Promote one owned root to primary by moving it to the front. `path` is the
   * compatibility field, so it always follows `paths[0]`.
   * @param path - Canonical root currently owned by this workspace.
   * @returns resolution after durability.
   */
  async setPrimaryPath(path: string): Promise<void> {
    await this.mutate((record) => {
      const paths = storedWorkspacePaths(record)
      if (!paths.includes(path)) throw new WorkspacePathNotOwnedError(path, this.id)
      if (record.path === path) return record
      return { ...record, path, paths: [path, ...paths.filter(candidate => candidate !== path)] }
    })
  }

  async status(): Promise<'ok' | 'missing-dir'> {
    for (const path of this.paths) {
      try {
        if (!(await stat(path)).isDirectory()) return 'missing-dir'
      } catch {
        // Any stat failure (ENOENT, dangling parent, permission loss) means the
        // directory is not usable right now; the record itself never mutates.
        return 'missing-dir'
      }
    }
    return 'ok'
  }

  /**
   * The single write path: run `fn` on the domain write chain via
   * `table.update`, stamping `updatedAt` and pruning candidates that no
   * longer pass the candidate membership check, then swap the
   * snapshot.
   *
   * `fn` sees the value current at its chain slot, so membership decisions
   * (attach/detach idempotence) are race-free against queued writes; a fn
   * signalling no change by returning `current` verbatim aborts the slot
   * through the sentinel when pruning also finds nothing, so a no-op neither
   * rewrites the medium nor emits a change event.
   */
  private async mutate(fn: (record: WorkspaceRecord) => WorkspaceRecord): Promise<void> {
    let next: WorkspaceRecord
    try {
      next = await this.host.table().update(this.id, (current) => {
        const changed = fn(current)
        const sessionIds = changed.sessionIds.filter(
          id => this.host.candidateMatches(id, storedWorkspacePaths(changed)),
        )
        if (changed === current && sessionIds.length === current.sessionIds.length) {
          throw unchangedSentinel
        }
        return { ...changed, sessionIds, updatedAt: new Date().toISOString() }
      })
    } catch (error) {
      if (error === unchangedSentinel) return
      throw error
    }
    this.record = next
  }
}
