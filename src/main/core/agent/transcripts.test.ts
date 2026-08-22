import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadOrMigrateIndex, loadTranscript, saveIndexFile } from './transcripts'
import { addSession, emptySessionIndex } from '../../../shared/agentSessions'

describe('Chat-Transcripts', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('übernimmt ui-transcript.json in die erste Session', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-chats-'))
    writeFileSync(
      join(root, 'ui-transcript.json'),
      JSON.stringify([{ type: 'user', text: 'Fasse den Stand zusammen' }, { type: 'assistant', text: 'Kurz:' }]),
      'utf-8'
    )
    const index = loadOrMigrateIndex(root, 'ag-legacy')
    expect(index.activeId).toBe('ag-legacy')
    expect(index.chats[0]?.title).toBe('Fasse den Stand zusammen')
    expect(loadTranscript(root, 'ag-legacy')).toHaveLength(2)
  })

  it('behält einen vorhandenen chats.json-Index', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-chats-'))
    const existing = addSession(emptySessionIndex(), {
      id: 'ag-keep',
      title: 'Bereits da',
      createdAt: 1,
      updatedAt: 2,
    })
    saveIndexFile(root, existing)
    const index = loadOrMigrateIndex(root, 'other')
    expect(index.activeId).toBe('ag-keep')
    expect(index.chats).toHaveLength(1)
  })
})
