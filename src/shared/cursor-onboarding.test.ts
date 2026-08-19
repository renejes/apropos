import { describe, expect, it } from 'vitest'
import { CURSOR_RULE_MDC, DEFAULT_MCP_HTTP_URL, cursorMcpJson } from './cursor-onboarding'

describe('cursorMcpJson', () => {
  it('schreibt nur url, kein type-Feld', () => {
    const parsed = JSON.parse(cursorMcpJson('http://127.0.0.1:8790/mcp')) as {
      mcpServers: { 'research-overview': { url: string; type?: string } }
    }
    expect(parsed.mcpServers['research-overview']).toEqual({ url: 'http://127.0.0.1:8790/mcp' })
    expect(parsed.mcpServers['research-overview'].type).toBeUndefined()
  })

  it('fällt bei ungültigem Endpoint auf den Default zurück', () => {
    const parsed = JSON.parse(cursorMcpJson('(Server nicht gestartet)')) as {
      mcpServers: { 'research-overview': { url: string } }
    }
    expect(parsed.mcpServers['research-overview'].url).toBe(DEFAULT_MCP_HTTP_URL)
  })

  it('Rule nennt fetch_source und Agent-Modus', () => {
    expect(CURSOR_RULE_MDC).toContain('fetch_source')
    expect(CURSOR_RULE_MDC).toContain('Agent-Modus')
    expect(CURSOR_RULE_MDC).toContain('start_transparent_research')
  })
})
