import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireDataLock, releaseDataLock } from './data-lock'
import { isCloudSyncedPath, journalModeForRoot, relocateDataRoot, inspectDataRoot, loadRootSettings, saveRootSettings } from './data-root'
import { openDb } from './db'

describe('Datenordner: Cloud-Pfad und Journal', () => {
  it('erkennt Dropbox, Drive und iCloud', () => {
    expect(isCloudSyncedPath('/Users/x/Dropbox/apropos')).toBe(true)
    expect(isCloudSyncedPath('/Users/x/Library/CloudStorage/GoogleDrive-abc/Meine Ablage/apropos')).toBe(true)
    expect(isCloudSyncedPath('/Users/x/Library/Mobile Documents/com~apple~CloudDocs/apropos')).toBe(true)
    expect(isCloudSyncedPath('/Users/x/Library/Application Support/apropos')).toBe(false)
  })

  it('setzt DELETE auf Cloud-Pfaden und bei Flag, sonst WAL', () => {
    expect(journalModeForRoot('/Users/x/Dropbox/foo')).toBe('delete')
    expect(journalModeForRoot('/tmp/local-rop')).toBe('wal')
    expect(journalModeForRoot('/tmp/local-rop', true)).toBe('delete')
  })

  it('öffnet eine Datei-DB mit DELETE und nicht mit WAL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rop-jnl-'))
    const db = openDb(join(dir, 'research.db'), { journalMode: 'delete' })
    expect(String(db.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('delete')
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('Lock.json', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('blockiert einen zweiten Host und gibt nach Close frei', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-lock-'))
    const first = acquireDataLock(root, {
      hostname: 'laptop-a',
      pid: 111,
      startedAt: '2026-09-03T10:00:00.000Z',
      appVersion: '0.1.0',
      pidAlive: () => true,
    })
    expect(first.ok).toBe(true)
    const second = acquireDataLock(root, {
      hostname: 'laptop-b',
      pid: 222,
      pidAlive: () => true,
    })
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.reason).toBe('foreign_host')
      expect(second.lock.hostname).toBe('laptop-a')
    }
    releaseDataLock(root)
    expect(existsSync(join(root, 'lock.json'))).toBe(false)
    const third = acquireDataLock(root, { hostname: 'laptop-b', pid: 222, pidAlive: () => true })
    expect(third.ok).toBe(true)
  })

  it('übernimmt das Lock bei gleichem Host und totem PID', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-lock2-'))
    acquireDataLock(root, { hostname: 'laptop-a', pid: 9, pidAlive: () => false })
    const next = acquireDataLock(root, { hostname: 'laptop-a', pid: 10, pidAlive: (pid: number) => pid === 10 })
    expect(next.ok).toBe(true)
    if (next.ok) expect(next.lock.pid).toBe(10)
  })

  it('erlaubt denselben Host mit lebendigem PID (App + stdio)', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-lock3-'))
    acquireDataLock(root, { hostname: 'laptop-a', pid: 1, pidAlive: () => true })
    const stdio = acquireDataLock(root, { hostname: 'laptop-a', pid: 2, pidAlive: () => true })
    expect(stdio.ok).toBe(true)
    if (stdio.ok) expect(stdio.created).toBe(false)
  })
})

describe('Datenordner umziehen', () => {
  it('kopiert die DB, überschreibt eine vorhandene nicht', () => {
    const from = mkdtempSync(join(tmpdir(), 'rop-from-'))
    const to = mkdtempSync(join(tmpdir(), 'rop-to-'))
    writeFileSync(join(from, 'research.db'), 'OLD')
    mkdirSync(join(from, 'agent-workspaces'))
    writeFileSync(join(from, 'agent-workspaces', 'keep.txt'), 'ws')
    relocateDataRoot(from, to, 'copy')
    expect(readFileSync(join(to, 'research.db'), 'utf-8')).toBe('OLD')
    expect(existsSync(join(to, 'agent-workspaces', 'keep.txt'))).toBe(true)
    writeFileSync(join(to, 'research.db'), 'DEST')
    relocateDataRoot(from, to, 'copy')
    expect(readFileSync(join(to, 'research.db'), 'utf-8')).toBe('DEST')
    expect(inspectDataRoot(to).hasDb).toBe(true)
    rmSync(from, { recursive: true, force: true })
    rmSync(to, { recursive: true, force: true })
  })
})

describe('settings.json rundet Kontakt-Mail mit', () => {
  it('verliert contactEmail nicht, wenn nur cloudSynced geschrieben wird', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rop-set-'))
    saveRootSettings(dir, { contactEmail: 'name@domain.de' })
    saveRootSettings(dir, { cloudSynced: true })
    const loaded = loadRootSettings(dir)
    expect(loaded.contactEmail).toBe('name@domain.de')
    expect(loaded.cloudSynced).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
