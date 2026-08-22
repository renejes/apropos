/**
 * Reiner Session-Index für den In-App-Chat: mehrere Agenten pro Projekt.
 * Das SDK speichert die Agenten; diese Datei ist die UI-Liste (Titel, offene Tabs, aktiv).
 */

import type { AgentSessionMeta, AgentSessionsSnapshot } from './agent'

export const MAX_OPEN_CHAT_TABS = 7
export const UNTITLED_CHAT = 'Neuer Chat'
export const LEGACY_SESSION_ID = 'legacy-default'

export interface AgentSessionIndex {
  activeId: string | null
  openIds: string[]
  chats: AgentSessionMeta[]
}

export function emptySessionIndex(): AgentSessionIndex {
  return { activeId: null, openIds: [], chats: [] }
}

export function titleFromUserText(text: string, untitled = UNTITLED_CHAT): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (!one) return untitled
  return one.length > 36 ? `${one.slice(0, 36)}…` : one
}

function meta(index: AgentSessionIndex, id: string): AgentSessionMeta | undefined {
  return index.chats.find((c) => c.id === id)
}

/** `openIds` als gedeckelte LRU, `id` vorne. Unbekannte IDs fallen raus. */
export function pinOpenTab(index: AgentSessionIndex, id: string): AgentSessionIndex {
  if (!meta(index, id)) return index
  const rest = index.openIds.filter((x) => x !== id && meta(index, x))
  return { ...index, openIds: [id, ...rest].slice(0, MAX_OPEN_CHAT_TABS) }
}

export function activateSession(index: AgentSessionIndex, id: string): AgentSessionIndex {
  if (!meta(index, id)) return index
  return pinOpenTab({ ...index, activeId: id }, id)
}

export function addSession(index: AgentSessionIndex, session: AgentSessionMeta): AgentSessionIndex {
  const chats = [session, ...index.chats.filter((c) => c.id !== session.id)]
  return activateSession({ ...index, chats }, session.id)
}

export function touchSession(
  index: AgentSessionIndex,
  id: string,
  patch: { title?: string; updatedAt: number }
): AgentSessionIndex {
  const chats = index.chats.map((c) => {
    if (c.id !== id) return c
    return {
      ...c,
      updatedAt: patch.updatedAt,
      title: patch.title !== undefined ? patch.title : c.title,
    }
  })
  return { ...index, chats }
}

export function closeOpenTab(index: AgentSessionIndex, id: string): AgentSessionIndex {
  const openIds = index.openIds.filter((x) => x !== id)
  if (index.activeId !== id) return { ...index, openIds }
  const next = openIds[0] ?? index.chats.find((c) => c.id !== id)?.id ?? null
  return next ? activateSession({ ...index, openIds }, next) : { ...index, activeId: null, openIds }
}

export function removeSession(index: AgentSessionIndex, id: string): AgentSessionIndex {
  const chats = index.chats.filter((c) => c.id !== id)
  return closeOpenTab({ ...index, chats }, id)
}

export function parseSessionIndex(raw: unknown): AgentSessionIndex | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const chatsIn = Array.isArray(o.chats) ? o.chats : []
  const chats: AgentSessionMeta[] = []
  for (const item of chatsIn) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.id !== 'string' || !c.id.trim()) continue
    chats.push({
      id: c.id,
      title: typeof c.title === 'string' ? c.title : '',
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : 0,
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
    })
  }
  const ids = new Set(chats.map((c) => c.id))
  const activeId = typeof o.activeId === 'string' && ids.has(o.activeId) ? o.activeId : (chats[0]?.id ?? null)
  const openIds = (Array.isArray(o.openIds) ? o.openIds.filter((x): x is string => typeof x === 'string' && ids.has(x)) : []).slice(
    0,
    MAX_OPEN_CHAT_TABS
  )
  return activeId ? pinOpenTab({ activeId, openIds, chats }, activeId) : { activeId, openIds, chats }
}

export function openMetas(index: AgentSessionIndex): AgentSessionMeta[] {
  return index.openIds.map((id) => meta(index, id)).filter((c): c is AgentSessionMeta => !!c)
}

export function historyMetas(index: AgentSessionIndex): AgentSessionMeta[] {
  return [...index.chats].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function snapshotSessions(index: AgentSessionIndex): AgentSessionsSnapshot {
  return {
    activeId: index.activeId,
    open: openMetas(index),
    all: historyMetas(index),
  }
}

/** Einträge aus dem alten Einzel-Transcript, bevor es Multi-Session gab. */
export function seedIndexFromLegacy(input: {
  rememberedId: string | null
  firstUserText: string | null
  now: number
}): AgentSessionIndex | null {
  if (!input.rememberedId && input.firstUserText === null) return null
  const id = input.rememberedId?.trim() || LEGACY_SESSION_ID
  const title = titleFromUserText(input.firstUserText ?? '', UNTITLED_CHAT)
  return addSession(emptySessionIndex(), {
    id,
    title,
    createdAt: input.now,
    updatedAt: input.now,
  })
}
