import express from 'express'
import { randomUUID } from 'crypto'
import type { Server as HttpServer } from 'http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildMcpServer, type McpDeps } from './server'
import { ServiceError, ingestSearch } from '../core/services/research'

/**
 * Lokaler Streamable-HTTP-Endpoint auf 127.0.0.1 — Multi-Client-fähig
 * (kanonisches SDK-Muster: pro initialize eine Transport+Server-Instanz,
 * abgelegt in einer Map nach mcp-session-id). Siehe documentation/01.
 *
 * Härtung: Bind an 127.0.0.1 + DNS-Rebinding-Schutz per Host-Allowlist.
 *
 * ACHTUNG, GEÄNDERTE SDK-SEMANTIK (gefunden bei der Client-Recherche 2026-07-30):
 * Bis SDK 1.24.x lagen `enableDnsRebindingProtection` und `allowedHosts` als Optionen
 * im StreamableHTTPServerTransport und wurden gegen den ROHEN Host-Header inklusive
 * Port geprüft. Seit 1.25.0 sind beide Optionen aus dem Transport ENTFERNT — wer sie
 * weiterhin übergibt, bekommt keinen Fehler, sondern GAR KEINEN Schutz mehr.
 * Die Prüfung liegt jetzt in der Express-Middleware `hostHeaderValidation` und ist
 * PORTAGNOSTISCH: Einträge ohne Port, IPv6 mit Klammern.
 */

/**
 * Erlaubte Host-Namen (ohne Port).
 * Standard ist streng localhost-only. Docker-Nutzer (Open WebUI, LibreChat) erreichen
 * den Host nur über `host.docker.internal` — das muss bewusst freigegeben werden,
 * weil es die Angriffsfläche über den eigenen Rechner hinaus öffnet.
 */
function allowedHostnames(): string[] {
  const base = ['127.0.0.1', 'localhost', '[::1]']
  const extra = (process.env.ROP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
  return [...new Set([...base, ...extra])]
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport
  server: McpServer
  lastSeen: number
}

// Review-Finding: verwaiste Sessions (Client abgebrochen ohne DELETE) aufräumen
const SESSION_IDLE_TTL_MS = 60 * 60 * 1000
const SESSION_SWEEP_INTERVAL_MS = 10 * 60 * 1000

export interface RunningHttpServer {
  port: number
  url: string
  sessionCount: () => number
  close: () => Promise<void>
}

export async function startMcpHttpServer(deps: McpDeps, port: number): Promise<RunningHttpServer> {
  const app = express()
  // Rebinding-Schutz VOR allem anderen — auch vor dem Body-Parser, damit ein
  // fremder Host nicht einmal Nutzlast in den Prozess bekommt.
  app.use(hostHeaderValidation(allowedHostnames()))
  app.use(express.json({ limit: '8mb' }))

  const sessions = new Map<string, SessionEntry>()
  // Wird nach listen() auf den tatsächlich gebundenen Port gesetzt (port=0 ⇒ ephemeral).
  let boundPort = port

  app.post('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined

      if (sessionId && sessions.has(sessionId)) {
        const entry = sessions.get(sessionId)!
        entry.lastSeen = Date.now()
        await entry.transport.handleRequest(req, res, req.body)
        return
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          // Kein enableDnsRebindingProtection/allowedHosts mehr: seit SDK 1.25 ohne
          // Wirkung. Der Schutz sitzt in der Middleware oben.
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server, lastSeen: Date.now() })
          },
          onsessionclosed: (sid) => {
            sessions.delete(sid)
          },
        })
        const server = buildMcpServer(deps)
        transport.onclose = () => {
          if (transport.sessionId) sessions.delete(transport.sessionId)
        }
        await server.connect(transport)
        await transport.handleRequest(req, res, req.body)
        return
      }

      if (sessionId) {
        // Spec-konform: unbekannte/abgelaufene Session ⇒ 404, damit Clients neu initialisieren
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found or expired. Re-initialize.' },
          id: null,
        })
        return
      }
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: no valid session. Send an initialize request first.' },
        id: null,
      })
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
      }
      console.error('[mcp-http] request error:', err)
    }
  })

  // GET = Server-Notifications (SSE), DELETE = Session-Ende
  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    if (!sessionId) {
      res.status(400).send('Missing session ID')
      return
    }
    const entry = sessions.get(sessionId)
    if (!entry) {
      res.status(404).send('Session not found or expired')
      return
    }
    entry.lastSeen = Date.now()
    await entry.transport.handleRequest(req, res)
  }
  app.get('/mcp', handleSessionRequest)
  app.delete('/mcp', handleSessionRequest)

  app.get('/health', (_req, res) => {
    res.json({ ok: true, sessions: sessions.size })
  })

  /**
   * Leichter Ingest neben MCP: Cursor-Hooks sollen kein Streamable-HTTP-Handshake
   * machen. Nur localhost (Bind + Host-Allowlist). Schreibpfad = Service, nicht Repo.
   */
  app.post('/ingest/search', (req, res) => {
    try {
      const entry = ingestSearch(deps.repo, req.body ?? {}, `hook:${String((req.body as { provider?: string })?.provider ?? 'cursor-websearch')}`)
      res.json({
        stored: true,
        search_id: entry.id,
        project_id: entry.project_id,
        query: entry.query,
        engine: entry.engine,
        results_found: entry.results_found,
      })
    } catch (err) {
      if (err instanceof ServiceError) {
        const status = err.code === 'project_not_found' || err.code === 'no_project' ? 404 : 400
        res.status(status).json({
          status: `FEHLER ${err.code}`,
          code: err.code,
          error: err.message,
          next_action: err.hint,
        })
        return
      }
      res.status(500).json({
        status: 'FEHLER internal',
        code: 'internal',
        error: err instanceof Error ? err.message : String(err),
        next_action: 'Prüfe, ob die App läuft, und wiederhole POST /ingest/search.',
      })
    }
  })

  const httpServer: HttpServer = await new Promise((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s))
    s.on('error', reject)
  })

  boundPort = (httpServer.address() as { port: number }).port

  // Idle-Sweep für verwaiste Sessions
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [sid, entry] of sessions) {
      if (now - entry.lastSeen > SESSION_IDLE_TTL_MS) {
        sessions.delete(sid)
        void entry.transport.close().catch(() => undefined)
      }
    }
  }, SESSION_SWEEP_INTERVAL_MS)
  sweep.unref?.()

  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/mcp`,
    sessionCount: () => sessions.size,
    close: async () => {
      clearInterval(sweep)
      for (const [sid, entry] of sessions) {
        try {
          await entry.transport.close()
        } catch {
          /* egal */
        }
        sessions.delete(sid)
      }
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}
