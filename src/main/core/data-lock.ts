import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { hostname as osHostname } from 'os'
import { join } from 'path'
import type { DataLock } from '../../shared/types'

export const LOCK_FILE_NAME = 'lock.json'

export function lockPath(root: string): string {
  return join(root, LOCK_FILE_NAME)
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EPERM: Prozess existiert, gehört uns nicht — gilt als lebendig.
    return code === 'EPERM'
  }
}

export function readDataLock(root: string): DataLock | null {
  const file = lockPath(root)
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<DataLock>
    if (typeof raw.hostname !== 'string' || typeof raw.pid !== 'number') return null
    return {
      hostname: raw.hostname,
      pid: raw.pid,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
    }
  } catch {
    return null
  }
}

export function writeDataLock(root: string, lock: DataLock): void {
  writeFileSync(lockPath(root), JSON.stringify(lock, null, 2), 'utf-8')
}

export function releaseDataLock(root: string): void {
  const file = lockPath(root)
  if (existsSync(file)) rmSync(file, { force: true })
}

export interface AcquireLockInput {
  hostname?: string
  pid?: number
  startedAt?: string
  appVersion?: string
  force?: boolean
  pidAlive?: (pid: number) => boolean
}

export type AcquireLockResult =
  | { ok: true; created: boolean; lock: DataLock }
  | { ok: false; reason: 'foreign_host'; lock: DataLock }

function sameHost(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Sperre für nacheinander auf zwei Rechnern — nicht für App + stdio auf demselben Host.
 * Anderer Host → blockieren. Gleicher Host + toter PID → übernehmen.
 */
export function acquireDataLock(root: string, input: AcquireLockInput = {}): AcquireLockResult {
  const hostname = input.hostname ?? osHostname()
  const pid = input.pid ?? process.pid
  const startedAt = input.startedAt ?? new Date().toISOString()
  const appVersion = input.appVersion ?? '0.1.0'
  const pidAlive = input.pidAlive ?? isPidAlive
  const ours: DataLock = { hostname, pid, startedAt, appVersion }

  const existing = readDataLock(root)
  if (!existing) {
    writeDataLock(root, ours)
    return { ok: true, created: true, lock: ours }
  }

  if (!sameHost(existing.hostname, hostname)) {
    if (input.force) {
      writeDataLock(root, ours)
      return { ok: true, created: true, lock: ours }
    }
    return { ok: false, reason: 'foreign_host', lock: existing }
  }

  if (existing.pid === pid || pidAlive(existing.pid)) {
    return { ok: true, created: false, lock: existing }
  }

  writeDataLock(root, ours)
  return { ok: true, created: true, lock: ours }
}
