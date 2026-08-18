/**
 * Eigenständiger stdio-MCP-Server für Clients, die lokale Prozesse starten
 * (Claude Desktop via claude_desktop_config.json, CLIs).
 * Teilt sich die SQLite-DB (WAL) mit der Desktop-App.
 *
 * Start:  npm run mcp:stdio         (bzw. npx tsx src/main/mcp/stdio-entry.ts)
 * DB-Pfad-Override: Env RESEARCH_DB_PATH
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { openDb } from '../core/db'
import { Repo } from '../core/repo'
import { defaultDbPath } from '../core/paths'
import { buildMcpServer } from './server'

async function main(): Promise<void> {
  const dbPath = defaultDbPath()
  const db = openDb(dbPath)
  const repo = new Repo(db)
  const server = buildMcpServer({ repo, actorLabel: 'stdio-client' })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // WICHTIG: bei stdio niemals auf stdout loggen (stört JSON-RPC) — nur stderr.
  console.error(`[research-overview] stdio MCP server ready (db: ${dbPath})`)
}

main().catch((err) => {
  console.error('[research-overview] fatal:', err)
  process.exit(1)
})
