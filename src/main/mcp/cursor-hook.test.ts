import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'skills/transparent-research/hooks/cursor-search-ingest.cjs')
const requireCjs = createRequire(__filename)
const hook = requireCjs(SCRIPT) as {
  decide: (input: Record<string, unknown>) => Record<string, unknown>
  extractUrls: (output: unknown) => string[]
}

function runHook(input: unknown, env: NodeJS.ProcessEnv = {}): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, code }))
    child.stdin.write(JSON.stringify(input))
    child.stdin.end()
  })
}

describe('Cursor-Such-Ingest-Hook', () => {
  it('weist WebFetch ab und verlangt fetch_source', () => {
    const d = hook.decide({ hook_event_name: 'preToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://example.org' } })
    expect(d.permission).toBe('deny')
    expect(String(d.agent_message)).toMatch(/fetch_source/)
  })

  it('fasst MCP-Werkzeuge nicht an', () => {
    const d = hook.decide({ hook_event_name: 'preToolUse', tool_name: 'MCP:fetch_source', tool_input: {} })
    expect(d.permission).toBeUndefined()
    expect(d.ingest).toBeUndefined()
  })

  it('zieht URLs aus WebSearch-Output', () => {
    const urls = hook.extractUrls({ results: [{ url: 'https://arxiv.org/abs/1706.03762' }, { link: 'https://doi.org/10.1/abc' }] })
    expect(urls).toContain('https://arxiv.org/abs/1706.03762')
    expect(urls).toContain('https://doi.org/10.1/abc')
  })

  it('fail-open: kaputtes JSON beendet mit leerem Objekt', async () => {
    const child = await new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
      const c = spawn(process.execPath, [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      c.stdout.on('data', (d) => (out += d))
      c.on('error', reject)
      c.on('close', (exit) => resolve({ stdout: out, code: exit }))
      c.stdin.write('dies ist kein json')
      c.stdin.end()
    })
    expect(child.code).toBe(0)
    expect(JSON.parse(child.stdout || '{}')).toEqual({})
  })
})

describe('Cursor-Hook POST /ingest/search', () => {
  let server: Server
  let received: unknown

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('schickt WebSearch fail-open an den Ingest und blockt die Session nicht', async () => {
    received = null
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        received = JSON.parse(raw || '{}')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ stored: true }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port

    const { stdout, code } = await runHook(
      {
        hook_event_name: 'postToolUse',
        tool_name: 'WebSearch',
        tool_input: { query: 'attention is all you need' },
        tool_output: JSON.stringify({ results: [{ url: 'https://arxiv.org/abs/1706.03762' }] }),
      },
      { ROP_INGEST_URL: `http://127.0.0.1:${port}/ingest/search` }
    )
    expect(code).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.additional_context).toMatch(/fetch_source/)
    expect(parsed.permission).toBeUndefined()
    expect(received).toMatchObject({ query: 'attention is all you need', provider: 'cursor-websearch' })
  })
})
