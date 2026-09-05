import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { APP_DATA_DIR_NAME } from '../../shared/brand'
import type { DataRootInfo, JournalMode } from '../../shared/types'

const POINTER_NAME = 'data-root.json'
const SETTINGS_NAME = 'settings.json'
const DB_NAME = 'research.db'

const DATA_ITEMS = [
  DB_NAME,
  `${DB_NAME}-wal`,
  `${DB_NAME}-shm`,
  `${DB_NAME}-journal`,
  'agent-workspaces',
  'agent-settings.json',
  SETTINGS_NAME,
] as const

interface DataRootPointer {
  root: string
}

interface RootSettingsFile {
  cloudSynced?: boolean
  contactEmail?: string | null
}

/** OS-Default, unabhängig von ROP_DATA_DIR und vom gewählten Datenordner. */
export function osDefaultAppDataDir(): string {
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'))
  return join(base, APP_DATA_DIR_NAME)
}

export function dataRootPointerPath(): string {
  return join(osDefaultAppDataDir(), POINTER_NAME)
}

export function readDataRootPointer(): string | null {
  const file = dataRootPointerPath()
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<DataRootPointer>
    if (typeof raw.root === 'string' && raw.root.trim()) return resolve(raw.root.trim())
    return null
  } catch {
    return null
  }
}

export function writeDataRootPointer(root: string | null): void {
  const file = dataRootPointerPath()
  mkdirSync(osDefaultAppDataDir(), { recursive: true })
  if (!root || resolve(root) === resolve(osDefaultAppDataDir())) {
    if (existsSync(file)) rmSync(file, { force: true })
    return
  }
  writeFileSync(file, JSON.stringify({ root: resolve(root) } satisfies DataRootPointer, null, 2), 'utf-8')
}

/** Effektiver Datenordner: Env, dann Pointer, dann OS-Default. */
export function resolvedDataRoot(): string {
  if (process.env.ROP_DATA_DIR) return process.env.ROP_DATA_DIR
  return readDataRootPointer() ?? osDefaultAppDataDir()
}

export function dbFileName(): string {
  return DB_NAME
}

export function isCloudSyncedPath(p: string): boolean {
  const n = p.replace(/\\/g, '/').toLowerCase()
  if (n.includes('/dropbox')) return true
  if (n.includes('/google drive') || n.includes('/googledrive')) return true
  if (n.includes('/library/cloudstorage/')) return true
  if (n.includes('/library/mobile documents/')) return true
  if (n.includes('/icloud drive') || n.includes('/iclouddrive') || n.includes('com~apple~clouddocs')) return true
  return false
}

export function loadRootSettings(root: string): RootSettingsFile {
  const file = join(root, SETTINGS_NAME)
  if (!existsSync(file)) return {}
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<RootSettingsFile>
    const email = typeof raw.contactEmail === 'string' ? raw.contactEmail.trim() : ''
    return {
      cloudSynced: raw.cloudSynced === true,
      contactEmail: email || null,
    }
  } catch {
    return {}
  }
}

export function saveRootSettings(root: string, next: RootSettingsFile): void {
  mkdirSync(root, { recursive: true })
  const prev = loadRootSettings(root)
  writeFileSync(join(root, SETTINGS_NAME), JSON.stringify({ ...prev, ...next }, null, 2), 'utf-8')
}

export function journalModeForRoot(root: string, cloudSyncedFlag?: boolean): JournalMode {
  const flagged = cloudSyncedFlag ?? loadRootSettings(root).cloudSynced === true
  if (flagged || isCloudSyncedPath(root)) return 'delete'
  return 'wal'
}

export function inspectDataRoot(root: string): { hasDb: boolean; hasWorkspaces: boolean } {
  const db = join(root, DB_NAME)
  const ws = join(root, 'agent-workspaces')
  return {
    hasDb: existsSync(db),
    hasWorkspaces: existsSync(ws),
  }
}

export type RelocateMode = 'copy' | 'use-existing'

/**
 * Kopiert DB + Workspaces in den neuen Ordner.
 * `use-existing`: Ziel hat schon eine DB — nur Pointer wechseln, nichts überschreiben.
 */
export function relocateDataRoot(fromRoot: string, toRoot: string, mode: RelocateMode): void {
  const from = resolve(fromRoot)
  const to = resolve(toRoot)
  if (from === to) return
  mkdirSync(to, { recursive: true })
  if (mode === 'use-existing') return
  for (const name of DATA_ITEMS) {
    const src = join(from, name)
    const dest = join(to, name)
    if (!existsSync(src)) continue
    if (existsSync(dest)) continue
    try {
      const st = statSync(src)
      if (st.isDirectory() || st.isFile()) cpSync(src, dest, { recursive: true })
    } catch {
      /* einzelne Datei kann fehlen (WAL nach Checkpoint) */
    }
  }
}

export function describeDataRoot(opts?: { lockHostname?: string | null; lockStartedAt?: string | null }): DataRootInfo {
  const root = resolvedDataRoot()
  const settings = loadRootSettings(root)
  const detected = isCloudSyncedPath(root)
  const cloudSynced = settings.cloudSynced === true || detected
  return {
    root,
    dbPath: join(root, DB_NAME),
    defaultRoot: osDefaultAppDataDir(),
    envOverride: Boolean(process.env.ROP_DATA_DIR),
    cloudSynced,
    cloudPathDetected: detected,
    journalMode: journalModeForRoot(root, settings.cloudSynced),
    lockHostname: opts?.lockHostname ?? null,
    lockStartedAt: opts?.lockStartedAt ?? null,
  }
}
