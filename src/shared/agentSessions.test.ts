import { describe, expect, it } from 'vitest'
import {
  MAX_OPEN_CHAT_TABS,
  activateSession,
  addSession,
  closeOpenTab,
  emptySessionIndex,
  historyMetas,
  parseSessionIndex,
  pinOpenTab,
  removeSession,
  seedIndexFromLegacy,
  snapshotSessions,
  titleFromUserText,
  touchSession,
} from './agentSessions'

const now = 1_700_000_000_000

function chat(id: string, title = id, at = now) {
  return { id, title, createdAt: at, updatedAt: at }
}

describe('titleFromUserText', () => {
  it('kürzt lange erste Nachrichten und fällt auf den Platzhalter zurück', () => {
    expect(titleFromUserText('  ')).toBe('Neuer Chat')
    expect(titleFromUserText('Arbeite den Brief aus')).toBe('Arbeite den Brief aus')
    expect(titleFromUserText('x'.repeat(40)).endsWith('…')).toBe(true)
    expect(titleFromUserText('x'.repeat(40)).length).toBe(37)
  })
})

describe('Session-Index', () => {
  it('aktiviert eine neue Session und pinnt sie als LRU-Tab', () => {
    let index = emptySessionIndex()
    index = addSession(index, chat('a'))
    index = addSession(index, chat('b'))
    expect(index.activeId).toBe('b')
    expect(index.openIds).toEqual(['b', 'a'])
    index = activateSession(index, 'a')
    expect(index.activeId).toBe('a')
    expect(index.openIds[0]).toBe('a')
  })

  it('deckt offene Tabs auf MAX_OPEN_CHAT_TABS', () => {
    let index = emptySessionIndex()
    for (let i = 0; i < MAX_OPEN_CHAT_TABS + 3; i += 1) {
      index = addSession(index, chat(`s${i}`))
    }
    expect(index.openIds).toHaveLength(MAX_OPEN_CHAT_TABS)
    expect(index.openIds[0]).toBe(`s${MAX_OPEN_CHAT_TABS + 2}`)
    expect(index.chats).toHaveLength(MAX_OPEN_CHAT_TABS + 3)
  })

  it('schließt den aktiven Tab und wechselt auf den nächsten', () => {
    let index = addSession(emptySessionIndex(), chat('a'))
    index = addSession(index, chat('b'))
    index = closeOpenTab(index, 'b')
    expect(index.activeId).toBe('a')
    expect(index.openIds).toEqual(['a'])
    expect(index.chats.map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('löscht eine Session vollständig', () => {
    let index = addSession(emptySessionIndex(), chat('a'))
    index = addSession(index, chat('b'))
    index = removeSession(index, 'b')
    expect(index.chats.map((c) => c.id)).toEqual(['a'])
    expect(index.activeId).toBe('a')
  })

  it('setzt den Titel nur beim ersten Touch, updatedAt immer', () => {
    let index = addSession(emptySessionIndex(), chat('a', 'Neuer Chat'))
    index = touchSession(index, 'a', { title: 'Brief ausarbeiten', updatedAt: now + 10 })
    expect(index.chats[0]?.title).toBe('Brief ausarbeiten')
    index = touchSession(index, 'a', { updatedAt: now + 20 })
    expect(index.chats[0]?.title).toBe('Brief ausarbeiten')
    expect(index.chats[0]?.updatedAt).toBe(now + 20)
  })

  it('parst beschädigte Indizes robust', () => {
    expect(parseSessionIndex(null)).toBeNull()
    expect(parseSessionIndex('nope')).toBeNull()
    const parsed = parseSessionIndex({
      activeId: 'missing',
      openIds: ['a', 'ghost', 3],
      chats: [{ id: 'a', title: 'Eins', createdAt: 1, updatedAt: 2 }, { id: '' }, { nope: true }],
    })
    expect(parsed?.activeId).toBe('a')
    expect(parsed?.openIds).toEqual(['a'])
    expect(parsed?.chats).toHaveLength(1)
  })

  it('sortiert die History nach updatedAt und snapshottet open/all', () => {
    let index = addSession(emptySessionIndex(), chat('old', 'Alt', 1))
    index = addSession(index, chat('new', 'Neu', 9))
    index = pinOpenTab(index, 'old')
    const snap = snapshotSessions(index)
    expect(snap.all.map((c) => c.id)).toEqual(['new', 'old'])
    expect(historyMetas(index)[0]?.id).toBe('new')
  })
})

describe('Legacy-Migration', () => {
  it('legt eine Session aus gemerkter Agent-ID und erstem User-Text an', () => {
    const seeded = seedIndexFromLegacy({
      rememberedId: 'ag-1',
      firstUserText: 'Fasse den Stand zusammen',
      now,
    })
    expect(seeded?.activeId).toBe('ag-1')
    expect(seeded?.chats[0]?.title).toBe('Fasse den Stand zusammen')
  })

  it('nutzt legacy-default, wenn nur ein Transcript ohne Agent-ID existiert', () => {
    const seeded = seedIndexFromLegacy({ rememberedId: null, firstUserText: '', now })
    expect(seeded?.activeId).toBe('legacy-default')
    expect(seeded?.chats[0]?.title).toBe('Neuer Chat')
  })

  it('liefert null, wenn es nichts zu übernehmen gibt', () => {
    expect(seedIndexFromLegacy({ rememberedId: null, firstUserText: null, now })).toBeNull()
  })
})
