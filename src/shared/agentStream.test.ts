import { describe, expect, it } from 'vitest'
import { formatUsageLine, mergeStreamText, shortToolName, reduceChatEvents, groupChatActivity, activitySummaryLine } from './agentStream'

describe('mergeStreamText', () => {
  it('nimmt Snapshots, Deltas und Überlappungen an', () => {
    expect(mergeStreamText('', 'Hallo')).toBe('Hallo')
    expect(mergeStreamText('Hal', 'Hallo')).toBe('Hallo')
    expect(mergeStreamText('Hallo', 'Hallo')).toBe('Hallo')
    expect(mergeStreamText('Hallo Welt', 'Hallo')).toBe('Hallo Welt')
    expect(mergeStreamText('Hallo ', 'Welt')).toBe('Hallo Welt')
    expect(mergeStreamText('abcde', 'cdefg')).toBe('abcdefg')
  })
})

describe('shortToolName', () => {
  it('schneidet Host-Präfixe ab', () => {
    expect(shortToolName('mcp:get_project_state')).toBe('get_project_state')
    expect(shortToolName('mcp_fetch_source')).toBe('fetch_source')
    expect(shortToolName('get_coverage_gaps')).toBe('get_coverage_gaps')
    expect(shortToolName('CallMcpTool')).toBe('CallMcpTool')
  })
})

describe('formatUsageLine', () => {
  it('formatiert Token-Zahlen kompakt', () => {
    expect(formatUsageLine({ totalTokens: 1200, inputTokens: 800, outputTokens: 400 })).toBe('1200 Tokens · 800↓ · 400↑')
    expect(formatUsageLine({})).toBe('')
  })
})

describe('groupChatActivity', () => {
  it('fasst Denken und Tool-Aufrufe einer Phase zu einer Zeile zusammen', () => {
    const grouped = groupChatActivity(
      reduceChatEvents([
        { type: 'user', text: 'Los' },
        { type: 'thinking', text: 'hmm' },
        { type: 'tool', callId: '1', name: 'mcp:search_literature', status: 'running' },
        { type: 'tool', callId: '1', name: 'mcp:search_literature', status: 'completed' },
        { type: 'tool', callId: '2', name: 'fetch_source', status: 'completed' },
        { type: 'assistant', text: 'Fertig' },
      ])
    )
    expect(grouped.map((g) => g.kind)).toEqual(['user', 'activity', 'assistant'])
    const act = grouped[1]
    expect(act?.kind).toBe('activity')
    if (act?.kind !== 'activity') return
    expect(act.tools).toHaveLength(2)
    expect(activitySummaryLine(act)).toBe('Denken · 2 MCP-Aufrufe')
  })

  it('trennt Phasen, wenn dazwischen Assistententext kommt', () => {
    const grouped = groupChatActivity(
      reduceChatEvents([
        { type: 'tool', callId: '1', name: 'a', status: 'completed' },
        { type: 'assistant', text: 'Zwischenstand' },
        { type: 'tool', callId: '2', name: 'b', status: 'completed' },
      ])
    )
    expect(grouped.map((g) => g.kind)).toEqual(['activity', 'assistant', 'activity'])
  })

  it('fasst Kontext-Zusammenfassen zu einer Zeile', () => {
    const items = reduceChatEvents([
      { type: 'summary', phase: 'started' },
      { type: 'summary', phase: 'completed' },
    ])
    expect(items).toEqual([{ kind: 'summary', phase: 'completed' }])
  })
})
