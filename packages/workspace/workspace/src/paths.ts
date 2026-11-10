/**
 * Path canonicalization for workspace identity.
 * @module @deepseek-ai/dsh-workspace/src/paths
 */

import { realpath } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

/**
 * Check whether a path names one fixed Host location without process cwd or
 * current-drive resolution.
 * @param path - Candidate Workspace path.
 * @param platform - Host platform; injectable for deterministic path tests.
 * @returns Whether the path is fully qualified on that platform.
 */
export function fullyQualifiedWorkspacePath(
  path: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') return posix.isAbsolute(path)
  const root = win32.parse(path).root
  return win32.isAbsolute(path) && root !== '\\' && root !== '/'
}

/**
 * Derive a non-empty default title from a canonical Workspace path.
 * @param path - Canonical Workspace path.
 * @param platform - Host platform; injectable for deterministic path tests.
 * @returns The final segment when present, otherwise the complete root spelling.
 */
export function defaultWorkspaceTitle(
  path: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === 'win32' ? win32 : posix
  return pathApi.basename(path) || pathApi.parse(path).root
}

/** The stored-path shape a Workspace record exposes; `paths` is absent on pre-multi-root records. */
export interface WorkspacePathRecord {
  readonly path: string
  readonly paths?: readonly string[] | undefined
}

/**
 * Read every root of a stored Workspace record in primary-first order.
 *
 * `path` remains the compatibility field and the primary root. Records written
 * before multi-root carry no `paths`, so they resolve to exactly `[path]`.
 * Duplicates (including a `paths` array that repeats the primary) collapse in
 * first-seen order; the result is therefore non-empty and `paths[0] === path`.
 * This is a pure shape operation: the values are already canonical because
 * every write goes through {@link realpathNormalize}.
 * @param record - stored record or any consumer projection with the same fields.
 * @returns the record's roots, primary first.
 */
export function storedWorkspacePaths(record: WorkspacePathRecord): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const path of [record.path, ...(record.paths ?? [])]) {
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

/**
 * Canonicalize a fully qualified directory path via `fs.realpath`: trailing
 * slashes, `..` segments, and symlinks are all resolved. This is the ONE
 * uniqueness canon of the package — workspace paths are stored canonicalized,
 * uniqueness is string equality of canonicalized paths (a symlink to an
 * existing workspace's directory collides), and attach-time session `cwd`
 * checks go through the same canon. Relative paths reject before `realpath` can
 * resolve them from the Host cwd or current Windows drive. A path that does not
 * exist rejects with the original `ENOENT` — this is `create`'s reject path (a
 * workspace must point at an existing directory).
 * @param path - The path to canonicalize.
 * @returns the canonical absolute path.
 */
export async function realpathNormalize(path: string): Promise<string> {
  if (!fullyQualifiedWorkspacePath(path)) {
    throw new TypeError(`Workspace path is not fully qualified: '${path}'`)
  }
  return await realpath(path)
}
