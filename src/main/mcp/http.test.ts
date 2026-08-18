import { request as httpRequest } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../core/db'
import { Repo } from '../core/repo'
import { startMcpHttpServer, type RunningHttpServer } from './http'

/**
 * Sichert den DNS-Rebinding-Schutz ab.
 *
 * Warum als eigener Test: Die Schutzfunktion war real WIRKUNGSLOS, ohne dass es
 * auffiel. Bis SDK 1.24 lagen `enableDnsRebindingProtection` und `allowedHosts` als
 * Optionen im StreamableHTTPServerTransport; seit 1.25 sind sie dort entfernt und
 * werden stillschweigend ignoriert — kein Fehler, kein Warnhinweis, nur kein Schutz.
 * Ein Test, der einen fremden Host-Header abweist, hätte das sofort gezeigt.
 */
describe('MCP-HTTP-Endpoint: DNS-Rebinding-Schutz', () => {
  let db: DB
  let mcp: RunningHttpServer

  beforeEach(async () => {
    db = openDb(':memory:')
    mcp = await startMcpHttpServer({ repo: new Repo(db), actorLabel: 'test' }, 0)
  })
  afterEach(async () => {
    await mcp.close()
    delete process.env.ROP_ALLOWED_HOSTS
  })

  /**
   * Bewusst node:http statt fetch(): Node's fetch behandelt `host` als verbotenen
   * Header und setzt ihn selbst — mit fetch ließe sich ein Rebinding-Angriff gar
   * nicht nachstellen, und der Test wäre wertlos.
   */
  const request = (
    opts: { host?: string; port?: number; path?: string; method?: string }
  ): Promise<{ status: number; body: string }> =>
    new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      })
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: opts.port ?? mcp.port,
          path: opts.path ?? '/mcp',
          method: opts.method ?? 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'content-length': Buffer.byteLength(payload),
            ...(opts.host ? { host: opts.host } : {}),
          },
        },
        (res) => {
          let body = ''
          res.on('data', (c) => (body += c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
        }
      )
      req.on('error', reject)
      if ((opts.method ?? 'POST') === 'POST') req.write(payload)
      req.end()
    })

  const post = (host: string) => request({ host })

  it('weist einen fremden Host-Header ab', async () => {
    const res = await post('boese.example.com')
    expect(res.status).toBe(403)
    expect(JSON.parse(res.body).error?.message).toMatch(/Invalid Host/i)
  })

  it('weist auch einen fremden Host MIT Port ab (portagnostische Prüfung)', async () => {
    const res = await post(`boese.example.com:${mcp.port}`)
    expect(res.status).toBe(403)
  })

  it('lässt 127.0.0.1 mit dem tatsächlichen Port durch', async () => {
    const res = await post(`127.0.0.1:${mcp.port}`)
    expect(res.status).not.toBe(403)
  })

  it('lässt localhost durch', async () => {
    const res = await post(`localhost:${mcp.port}`)
    expect(res.status).not.toBe(403)
  })

  it('/health ist ebenfalls geschützt — die Middleware greift vor allen Routen', async () => {
    const res = await request({ host: 'boese.example.com', path: '/health', method: 'GET' })
    expect(res.status).toBe(403)
  })

  it('erlaubt zusätzliche Hosts nur über ROP_ALLOWED_HOSTS (Docker-Fall)', async () => {
    // Ohne Freigabe abgewiesen …
    expect((await post('host.docker.internal')).status).toBe(403)

    // … mit Freigabe erlaubt. Neuer Server, weil die Liste beim Start gelesen wird.
    process.env.ROP_ALLOWED_HOSTS = 'host.docker.internal'
    const withDocker = await startMcpHttpServer({ repo: new Repo(openDb(':memory:')), actorLabel: 'test' }, 0)
    try {
      const res = await request({ host: 'host.docker.internal', port: withDocker.port })
      expect(res.status).not.toBe(403)
    } finally {
      await withDocker.close()
    }
  })
})
