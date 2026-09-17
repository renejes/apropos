/**
 * Stream-Helfer für den In-App-Chat. Cursor liefert teils Snapshots, teils Deltas.
 */

import type { AgentChatEvent } from './agent'

/** Fügt einen Chunk so an, dass weder Duplikate noch abgeschnittene Prefixes entstehen. */
export function mergeStreamText(current: string, incoming: string): string {
  if (!incoming) return current
  if (!current) return incoming
  if (incoming === current) return current
  if (incoming.startsWith(current)) return incoming
  if (current.startsWith(incoming)) return current
  const overlap = Math.min(current.length, incoming.length)
  for (let n = overlap; n > 0; n -= 1) {
    if (current.endsWith(incoming.slice(0, n))) return current + incoming.slice(n)
  }
  return current + incoming
}

/** MCP-/Host-Präfixe kürzen, damit der Chip `get_project_state` statt `mcp:get_project_state` zeigt. */
export function shortToolName(name: string): string {
  const trimmed = name
    .replace(/^mcp[_:]/i, '')
    .replace(/^CallMcpTool$/i, '')
    .replace(/^custom[_-]?user[_-]?tool[_:]?/i, '')
    .trim()
  return trimmed || name
}

export function formatUsageLine(input: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}): string {
  const bits: string[] = []
  if (input.totalTokens) bits.push(`${input.totalTokens} Tokens`)
  if (input.inputTokens) bits.push(`${input.inputTokens}↓`)
  if (input.outputTokens) bits.push(`${input.outputTokens}↑`)
  return bits.join(' · ')
}

export type ReducedChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; callId: string; name: string; status: 'running' | 'completed' | 'error' }
  | { kind: 'status'; text: string }
  | { kind: 'request'; text: string }
  | { kind: 'summary'; phase: 'started' | 'completed' }
  | { kind: 'run_end'; status: 'finished' | 'error' | 'cancelled'; error?: string }

export type ActivityTool = {
  callId: string
  name: string
  status: 'running' | 'completed' | 'error'
}

export type ChatActivity = {
  kind: 'activity'
  thinking: string
  tools: ActivityTool[]
  statuses: string[]
}

export type DisplayChatItem =
  | Exclude<ReducedChatItem, { kind: 'thinking' } | { kind: 'tool' } | { kind: 'status' }>
  | ChatActivity

export function reduceChatEvents(events: AgentChatEvent[]): ReducedChatItem[] {
  const items: ReducedChatItem[] = []
  const toolAt = new Map<string, number>()
  for (const e of events) {
    switch (e.type) {
      case 'user':
        items.push({ kind: 'user', text: e.text })
        break
      case 'assistant': {
        const last = items[items.length - 1]
        if (last?.kind === 'assistant') last.text = mergeStreamText(last.text, e.text)
        else items.push({ kind: 'assistant', text: e.text })
        break
      }
      case 'thinking': {
        const last = items[items.length - 1]
        if (last?.kind === 'thinking') last.text = mergeStreamText(last.text, e.text)
        else items.push({ kind: 'thinking', text: e.text })
        break
      }
      case 'tool': {
        const idx = toolAt.get(e.callId)
        const next: ReducedChatItem = { kind: 'tool', callId: e.callId, name: e.name, status: e.status }
        if (idx != null && items[idx]?.kind === 'tool') items[idx] = next
        else {
          toolAt.set(e.callId, items.length)
          items.push(next)
        }
        break
      }
      case 'status':
        items.push({ kind: 'status', text: e.text })
        break
      case 'request':
        items.push({ kind: 'request', text: e.text })
        break
      case 'summary': {
        const last = [...items].reverse().find((i) => i.kind === 'summary')
        if (last?.kind === 'summary' && last.phase === 'started' && e.phase === 'completed') last.phase = 'completed'
        else items.push({ kind: 'summary', phase: e.phase })
        break
      }
      case 'usage':
      case 'follow_doc':
        break
      case 'run_end':
        items.push({ kind: 'run_end', status: e.status, error: e.error })
        break
      default: {
        const _never: never = e
        void _never
      }
    }
  }
  return items
}

export function groupChatActivity(items: ReducedChatItem[]): DisplayChatItem[] {
  const out: DisplayChatItem[] = []
  let acc: ChatActivity | null = null

  const flush = () => {
    if (!acc) return
    if (acc.thinking || acc.tools.length > 0 || acc.statuses.length > 0) out.push(acc)
    acc = null
  }

  for (const item of items) {
    if (item.kind === 'thinking' || item.kind === 'tool' || item.kind === 'status') {
      if (!acc) acc = { kind: 'activity', thinking: '', tools: [], statuses: [] }
      if (item.kind === 'thinking') {
        acc.thinking = acc.thinking ? mergeStreamText(acc.thinking, `\n\n${item.text}`) : item.text
      } else if (item.kind === 'tool') {
        const idx = acc.tools.findIndex((t) => t.callId === item.callId)
        const next = { callId: item.callId, name: item.name, status: item.status }
        if (idx >= 0) acc.tools[idx] = next
        else acc.tools.push(next)
      } else if (item.text) {
        acc.statuses.push(item.text)
      }
      continue
    }
    flush()
    if (item.kind === 'assistant' && !item.text) continue
    out.push(item)
  }
  flush()
  return out
}

export function activitySummaryLine(
  activity: ChatActivity,
  opts?: { live?: boolean; elapsedSec?: number }
): string {
  const n = activity.tools.length
  const errors = activity.tools.filter((t) => t.status === 'error').length
  const running = activity.tools.find((t) => t.status === 'running')
  const bits: string[] = []
  if (activity.thinking) bits.push(opts?.live && n === 0 ? 'Denkt' : 'Denken')
  if (n === 1) bits.push('1 MCP-Aufruf')
  else if (n > 1) bits.push(`${n} MCP-Aufrufe`)
  if (errors > 0) bits.push(errors === 1 ? '1 Fehler' : `${errors} Fehler`)
  if (running) bits.push(`${shortToolName(running.name)} läuft`)
  if (opts?.live && opts.elapsedSec && opts.elapsedSec > 0) bits.push(`${opts.elapsedSec}s`)
  if (bits.length === 0 && activity.statuses.length > 0) return activity.statuses[activity.statuses.length - 1] ?? 'Arbeitet'
  return bits.join(' · ') || 'Arbeitet'
}

