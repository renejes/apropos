import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OllamaProvider } from './ollama'
import { ProviderError } from './types'
import type { ChatChunk } from './types'

/**
 * Tests gegen einen echten HTTP-Server, der das Ollama-NDJSON-Protokoll spricht.
 * Bewusst kein gestubbtes fetch: Die riskanten Stellen sind Stream-Verhalten,
 * Zeilenaufteilung über Chunk-Grenzen hinweg und Fehler MITTEN im Stream — genau
 * das würde ein Mock wegabstrahieren.
 */
describe('Ollama-Adapter', () => {
  let server: Server
  let endpoint: string
  let handler: (req: { url: string; body: string }, res: import('node:http').ServerResponse) => void

  beforeEach(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => handler({ url: req.url ?? '', body }, res))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterEach(async () => {
    delete process.env.OLLAMA_NO_CLOUD
    await new Promise<void>((r) => server.close(() => r()))
  })

  const ndjson = (res: import('node:http').ServerResponse, lines: unknown[], opts: { split?: boolean } = {}) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' })
    const payload = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
    if (opts.split) {
      // Chunk-Grenzen mitten in einer JSON-Zeile — der realistische Fall.
      const mid = Math.floor(payload.length / 2)
      res.write(payload.slice(0, mid))
      res.write(payload.slice(mid))
    } else {
      res.write(payload)
    }
    res.end()
  }

  const provider = () => new OllamaProvider({ endpoint })

  const collect = async (gen: AsyncGenerator<ChatChunk>): Promise<ChatChunk[]> => {
    const out: ChatChunk[] = []
    for await (const c of gen) out.push(c)
    return out
  }

  const chunk = (over: Record<string, unknown> = {}) => ({ model: 'm', message: { role: 'assistant', content: '' }, done: false, ...over })

  // ---------------------------------------------------------------- Streaming

  it('streamt Text und meldet Abschluss mit Nutzungsdaten', async () => {
    handler = (_req, res) =>
      ndjson(res, [
        chunk({ message: { role: 'assistant', content: 'Hallo ' } }),
        chunk({ message: { role: 'assistant', content: 'Welt' } }),
        { model: 'm', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 5, total_duration: 2_000_000 },
      ])

    const chunks = await collect(provider().chat({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }))
    expect(chunks.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text)).toEqual(['Hallo ', 'Welt'])
    const done = chunks.at(-1)
    expect(done).toMatchObject({ type: 'done', reason: 'stop' })
    expect((done as { usage: { promptTokens: number; totalDurationMs: number } }).usage).toMatchObject({ promptTokens: 12, totalDurationMs: 2 })
  })

  it('kommt mit JSON-Zeilen zurecht, die über Chunk-Grenzen zerteilt sind', async () => {
    handler = (_req, res) =>
      ndjson(
        res,
        [chunk({ message: { role: 'assistant', content: 'Ein längerer Text zum Zerteilen' } }), chunk({ done: true, done_reason: 'stop' })],
        { split: true }
      )
    const chunks = await collect(provider().chat({ model: 'm', messages: [] }))
    expect(chunks.filter((c) => c.type === 'text')).toHaveLength(1)
    expect(chunks.at(-1)?.type).toBe('done')
  })

  it('trennt Denkschritte von der Antwort', async () => {
    handler = (_req, res) =>
      ndjson(res, [
        chunk({ message: { role: 'assistant', content: '', thinking: 'Erst überlegen…' } }),
        chunk({ message: { role: 'assistant', content: 'Antwort' } }),
        chunk({ done: true, done_reason: 'stop' }),
      ])
    const chunks = await collect(provider().chat({ model: 'm', messages: [], think: true }))
    expect(chunks.filter((c) => c.type === 'thinking')).toHaveLength(1)
    expect(chunks.filter((c) => c.type === 'text')).toHaveLength(1)
  })

  // ---------------------------------------------------------------- Werkzeugaufrufe

  it('liest Werkzeugaufrufe aus und vergibt eine ID', async () => {
    handler = (_req, res) =>
      ndjson(res, [
        chunk({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'add_source', arguments: { url: 'https://x.de' } } }] } }),
        chunk({ done: true, done_reason: 'stop' }),
      ])
    const chunks = await collect(provider().chat({ model: 'm', messages: [] }))
    const call = chunks.find((c) => c.type === 'tool_call') as { call: { id: string; name: string; arguments: Record<string, unknown> } }
    expect(call.call.name).toBe('add_source')
    expect(call.call.arguments).toEqual({ url: 'https://x.de' })
    expect(call.call.id).toMatch(/[0-9a-f-]{36}/)
  })

  it('repariert Argumente, die als JSON-String kommen', async () => {
    handler = (_req, res) =>
      ndjson(res, [
        chunk({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 't', arguments: '{"a":1}' } }] } }),
        chunk({ done: true, done_reason: 'stop' }),
      ])
    const chunks = await collect(provider().chat({ model: 'm', messages: [] }))
    expect((chunks.find((c) => c.type === 'tool_call') as { call: { arguments: unknown } }).call.arguments).toEqual({ a: 1 })
  })

  it('schickt Werkzeug-Definitionen und -Ergebnisse im Ollama-Format', async () => {
    let seen: Record<string, any> = {}
    handler = (req, res) => {
      seen = JSON.parse(req.body)
      ndjson(res, [chunk({ done: true, done_reason: 'stop' })])
    }
    await collect(
      provider().chat({
        model: 'm',
        messages: [
          { role: 'user', content: 'f' },
          { role: 'assistant', content: '', tool_calls: [{ id: 'x', name: 'suche', arguments: { q: 'a' } }] },
          { role: 'tool', content: '{"ok":true}', tool_name: 'suche' },
        ],
        tools: [{ name: 'suche', description: 'sucht', parameters: { type: 'object', properties: {} } }],
      })
    )
    expect(seen.tools[0]).toMatchObject({ type: 'function', function: { name: 'suche' } })
    expect(seen.messages[1].tool_calls[0].function).toMatchObject({ name: 'suche', arguments: { q: 'a' } })
    expect(seen.messages[2]).toMatchObject({ role: 'tool', tool_name: 'suche' })
    expect(seen.stream).toBe(true)
  })

  // ---------------------------------------------------------------- Fehlerfälle

  it('erkennt einen Fehler MITTEN im Stream (HTTP 200) als Fehler', async () => {
    handler = (_req, res) => ndjson(res, [chunk({ message: { role: 'assistant', content: 'Teil' } }), { error: 'model runner has unexpectedly stopped' }])
    await expect(collect(provider().chat({ model: 'm', messages: [] }))).rejects.toMatchObject({ code: 'stream_error' })
  })

  it('erkennt Kontingent-Fehler im Stream als quota_exhausted', async () => {
    handler = (_req, res) => ndjson(res, [{ error: 'usage limit exceeded for this period' }])
    await expect(collect(provider().chat({ model: 'gpt-oss:120b-cloud', messages: [] }))).rejects.toMatchObject({ code: 'quota_exhausted' })
  })

  it('behandelt HTTP 200 mit LEEREM Body als erschöpftes Kontingent, nicht als leere Antwort', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.end()
    }
    const err = await collect(provider().chat({ model: 'deepseek-v3.1:671b-cloud', messages: [] })).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.code).toBe('quota_exhausted')
    expect(err.hint).toMatch(/16045/) // verweist auf das dokumentierte Ollama-Issue
  })

  it('meldet einen abgebrochenen Stream ohne done-Marker als Fehler', async () => {
    handler = (_req, res) => ndjson(res, [chunk({ message: { role: 'assistant', content: 'halb' } })])
    await expect(collect(provider().chat({ model: 'm', messages: [] }))).rejects.toMatchObject({ code: 'stream_error' })
  })

  it('übersetzt 404 in einen sprechenden Hinweis — bei Cloud-Modellen mit signin-Hinweis', async () => {
    handler = (_req, res) => {
      res.writeHead(404)
      res.end('model not found')
    }
    const local = await collect(provider().chat({ model: 'qwen3', messages: [] })).catch((e) => e)
    expect(local.code).toBe('model_not_found')
    expect(local.hint).toBe('ollama pull qwen3')

    const cloud = await collect(provider().chat({ model: 'qwen3-coder:480b-cloud', messages: [] })).catch((e) => e)
    expect(cloud.hint).toMatch(/signin/)
  })

  it('übersetzt 401/403 in einen Cloud-Anmeldehinweis', async () => {
    handler = (_req, res) => {
      res.writeHead(401)
      res.end('unauthorized')
    }
    const err = await collect(provider().chat({ model: 'gpt-oss:120b-cloud', messages: [] })).catch((e) => e)
    expect(err.code).toBe('quota_exhausted')
    expect(err.hint).toMatch(/ollama signin/)
  })

  it('bricht auf Wunsch ab', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' })
      res.write(JSON.stringify(chunk({ message: { role: 'assistant', content: 'a' } })) + '\n')
      // absichtlich offen lassen
    }
    const ctrl = new AbortController()
    const gen = provider().chat({ model: 'm', messages: [], signal: ctrl.signal })
    const first = await gen.next()
    expect(first.value).toMatchObject({ type: 'text' })
    ctrl.abort()
    await expect(gen.next()).rejects.toMatchObject({ code: 'aborted' })
  })

  it('meldet einen nicht erreichbaren Daemon verständlich', async () => {
    const p = new OllamaProvider({ endpoint: 'http://127.0.0.1:1' })
    const h = await p.health()
    expect(h.reachable).toBe(false)
    expect(h.note).toMatch(/nicht erreichbar/)
    await expect(collect(p.chat({ model: 'm', messages: [] }))).rejects.toMatchObject({ code: 'unreachable' })
  })

  // ---------------------------------------------------------------- Modelle & Cloud

  it('listet Modelle und erkennt Cloud-Modelle am Suffix', async () => {
    handler = (req, res) => {
      if (req.url.startsWith('/api/tags')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', size: 5_200_000_000 }, { name: 'deepseek-v3.1:671b-cloud', size: 0 }] }))
      }
    }
    const models = await provider().listModels()
    expect(models.map((m) => m.cloud)).toEqual([false, true])
    expect(models[0].sizeBytes).toBe(5_200_000_000)
  })

  it('liest Fähigkeiten aus /api/show — Tool-Support wird nicht geraten', async () => {
    handler = (req, res) => {
      if (req.url.startsWith('/api/show')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ capabilities: ['completion', 'tools', 'thinking'], model_info: { 'qwen3.context_length': 40960 } }))
      }
    }
    const info = await provider().describeModel('qwen3:8b')
    expect(info.supportsTools).toBe(true)
    expect(info.supportsThinking).toBe(true)
    expect(info.contextLength).toBe(40960)
  })

  it('meldet Cloud als gesperrt, wenn OLLAMA_NO_CLOUD gesetzt ist', async () => {
    process.env.OLLAMA_NO_CLOUD = 'true'
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    }
    const status = await provider().cloudStatus()
    expect(status.available).toBe(false)
    expect(status.reason).toMatch(/OLLAMA_NO_CLOUD/)
  })

  it('meldet fehlende Anmeldung für Cloud-Modelle', async () => {
    handler = (req, res) => {
      if (req.url.startsWith('/api/me')) {
        res.writeHead(401)
        res.end()
      } else {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      }
    }
    const status = await provider().cloudStatus()
    expect(status.signedIn).toBe(false)
    expect(status.reason).toMatch(/ollama signin/)
  })

  it('health() bündelt Version, Modelle und Cloud-Status', async () => {
    handler = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url.startsWith('/api/version')) return res.end(JSON.stringify({ version: '0.32.5' }))
      if (req.url.startsWith('/api/tags')) return res.end(JSON.stringify({ models: [{ name: 'x:cloud', size: 0 }] }))
      if (req.url.startsWith('/api/me')) return res.end(JSON.stringify({ plan: 'pro', email: 'a@b.c' }))
      res.end('{}')
    }
    const h = await provider().health()
    expect(h).toMatchObject({ reachable: true, version: '0.32.5', modelCount: 1 })
    expect(h.cloud).toMatchObject({ available: true, signedIn: true, plan: 'pro' })
    expect(h.note).toBe('ok')
  })

  it('weist auf fehlende Cloud-Modelle hin, wenn nur lokale registriert sind', async () => {
    handler = (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url.startsWith('/api/version')) return res.end(JSON.stringify({ version: '0.32.5' }))
      if (req.url.startsWith('/api/tags')) return res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', size: 1 }] }))
      if (req.url.startsWith('/api/me')) return res.end(JSON.stringify({ plan: 'pro' }))
      res.end('{}')
    }
    const h = await provider().health()
    expect(h.note).toMatch(/Keine Cloud-Modelle registriert/)
  })
})
