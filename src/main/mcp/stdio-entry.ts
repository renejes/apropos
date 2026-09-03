/**
 * Eigenständiger stdio-MCP-Server für Clients, die lokale Prozesse starten
 * (Claude Desktop via claude_desktop_config.json, CLIs).
 * Teilt sich die SQLite-DB mit der Desktop-App (gleicher Host).
 *
 * Start:  npm run mcp:stdio         (bzw. npx tsx src/main/mcp/stdio-entry.ts)
 * DB-Pfad-Override: Env RESEARCH_DB_PATH
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { checkpointAndClose, openDb } from '../core/db'
import { Repo } from '../core/repo'
import { appDataDir, defaultDbPath } from '../core/paths'
import { acquireDataLock, releaseDataLock } from '../core/data-lock'
import { journalModeForRoot } from '../core/data-root'
import { buildMcpServer } from './server'

async function main(): Promise<void> {
  const root = appDataDir()
  const lock = acquireDataLock(root, { appVersion: '0.1.0' })
  if (!lock.ok) {
    console.error(
      `[research-overview] Datenordner ist auf einem anderen Rechner geöffnet (${lock.lock.hostname}, seit ${lock.lock.startedAt}).`
    )
    process.exit(1)
  }
  const createdLock = lock.created
  const dbPath = defaultDbPath()
  const db = openDb(dbPath, { journalMode: journalModeForRoot(root) })
  const repo = new Repo(db)
  const server = buildMcpServer({ repo, actorLabel: 'stdio-client' })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[research-overview] stdio MCP server ready (db: ${dbPath})`)

  const shutdown = (): void => {
    try {
      checkpointAndClose(db)
    } catch {
      /* egal */
    }
    if (createdLock) {
      try {
        releaseDataLock(root)
      } catch {
        /* egal */
      }
    }
  }
  process.on('exit', shutdown)
  process.on('SIGINT', () => {
    shutdown()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    shutdown()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('[research-overview] fatal:', err)
  process.exit(1)
})
