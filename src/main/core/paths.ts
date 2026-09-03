import { join } from 'path'
import { resolvedDataRoot } from './data-root'

/** Gemeinsames User-Data-Verzeichnis der App (DB, Agent-Workspaces, Settings). */
export function appDataDir(): string {
  return resolvedDataRoot()
}

/**
 * Standard-DB-Pfad — identisch für Electron-App und stdio-MCP-Server,
 * damit beide Prozesse auf derselben Source-of-Truth arbeiten.
 * Override per Env RESEARCH_DB_PATH (auch für Tests).
 */
export function defaultDbPath(): string {
  if (process.env.RESEARCH_DB_PATH) return process.env.RESEARCH_DB_PATH
  return join(appDataDir(), 'research.db')
}

export function defaultAgentRoot(): string {
  if (process.env.ROP_AGENT_ROOT) return process.env.ROP_AGENT_ROOT
  return join(appDataDir(), 'agent-workspaces')
}

export function agentSettingsPath(): string {
  return join(appDataDir(), 'agent-settings.json')
}

export const DEFAULT_MCP_PORT = 8790

/** Leichter Ingest neben MCP — Hooks sollen kein Streamable-HTTP-Handshake machen. */
export const DEFAULT_INGEST_URL = `http://127.0.0.1:${DEFAULT_MCP_PORT}/ingest/search`
