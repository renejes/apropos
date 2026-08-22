import { describe, expect, it } from 'vitest'
import { formatUsageLine, mergeStreamText, shortToolName } from './agentStream'

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
