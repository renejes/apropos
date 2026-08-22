import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AgentChatEvent } from '../../../shared/agent'
import {
  emptySessionIndex,
  parseSessionIndex,
  seedIndexFromLegacy,
  type AgentSessionIndex,
} from '../../../shared/agentSessions'

const INDEX_FILE = 'chats.json'
const LEGACY_HISTORY = 'ui-transcript.json'
const HISTORY_MAX = 800

export function sessionIndexPath(cwd: string): string {
  return join(cwd, INDEX_FILE)
}

export function legacyHistoryPath(cwd: string): string {
  return join(cwd, LEGACY_HISTORY)
}

function safeSessionFileId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'chat'
}

export function transcriptPathFor(cwd: string, sessionId: string): string {
  return join(cwd, 'transcripts', `${safeSessionFileId(sessionId)}.json`)
}

export function loadHistoryEvents(path: string): AgentChatEvent[] {
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown
    return Array.isArray(raw) ? (raw as AgentChatEvent[]) : []
  } catch {
    return []
  }
}

export function saveHistoryEvents(path: string, history: AgentChatEvent[]): void {
  const trimmed = history.length > HISTORY_MAX ? history.slice(history.length - HISTORY_MAX) : history
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(trimmed), 'utf-8')
}

export function loadTranscript(cwd: string, sessionId: string): AgentChatEvent[] {
  return loadHistoryEvents(transcriptPathFor(cwd, sessionId))
}

export function saveTranscript(cwd: string, sessionId: string, history: AgentChatEvent[]): void {
  saveHistoryEvents(transcriptPathFor(cwd, sessionId), history)
}

export function deleteTranscript(cwd: string, sessionId: string): void {
  const path = transcriptPathFor(cwd, sessionId)
  if (existsSync(path)) unlinkSync(path)
}

export function loadIndexFile(cwd: string): AgentSessionIndex | null {
  const path = sessionIndexPath(cwd)
  if (!existsSync(path)) return null
  try {
    return parseSessionIndex(JSON.parse(readFileSync(path, 'utf-8')) as unknown)
  } catch {
    return null
  }
}

export function saveIndexFile(cwd: string, index: AgentSessionIndex): void {
  mkdirSync(cwd, { recursive: true })
  writeFileSync(sessionIndexPath(cwd), JSON.stringify(index), 'utf-8')
}

function firstUserText(history: AgentChatEvent[]): string | null {
  const user = history.find((e) => e.type === 'user')
  return user && user.type === 'user' ? user.text : null
}

/** Lädt chats.json oder übernimmt das alte ui-transcript.json in eine Session. */
export function loadOrMigrateIndex(cwd: string, rememberedId: string | null): AgentSessionIndex {
  const parsed = loadIndexFile(cwd)
  if (parsed && parsed.chats.length > 0) return parsed

  const legacy = loadHistoryEvents(legacyHistoryPath(cwd))
  const seeded = seedIndexFromLegacy({
    rememberedId,
    firstUserText: legacy.length ? firstUserText(legacy) ?? '' : rememberedId ? '' : null,
    now: Date.now(),
  })
  if (!seeded) return emptySessionIndex()
  saveIndexFile(cwd, seeded)
  if (legacy.length && seeded.activeId) saveTranscript(cwd, seeded.activeId, legacy)
  return seeded
}
