import { homedir } from 'os'
import { join } from 'path'

/**
 * Standard-DB-Pfad — identisch für Electron-App und stdio-MCP-Server,
 * damit beide Prozesse (via WAL) auf derselben Source-of-Truth arbeiten.
 * Override per Env RESEARCH_DB_PATH (auch für Tests).
 */
export function defaultDbPath(): string {
  if (process.env.RESEARCH_DB_PATH) return process.env.RESEARCH_DB_PATH
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'))
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'))
  return join(base, 'research-overview-platform', 'research.db')
}

export const DEFAULT_MCP_PORT = 8790

/** Leichter Ingest neben MCP — Hooks sollen kein Streamable-HTTP-Handshake machen. */
export const DEFAULT_INGEST_URL = `http://127.0.0.1:${DEFAULT_MCP_PORT}/ingest/search`
