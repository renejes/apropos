/**
 * Stream-Helfer für den In-App-Chat. Cursor liefert teils Snapshots, teils Deltas.
 */

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
