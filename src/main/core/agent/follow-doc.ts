export const FOLLOW_DOC_TOOLS = new Set(['fetch_source', 'read_document', 'ingest_local_file', 'include_screening'])

export interface DocumentFollow {
  documentId: string
  start: number
  end: number
  capture: boolean
}

/**
 * Liest document_id + Fenster aus einer MCP-Erfolgsantwort.
 * Fehler-JSON (status: FEHLER) hat keine document_id — dann null.
 */
export function parseDocumentFollow(toolName: string, text: string): DocumentFollow | null {
  if (!FOLLOW_DOC_TOOLS.has(toolName)) return null
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  const rec = payload as Record<string, unknown>
  if (typeof rec.document_id !== 'string' || rec.document_id.length === 0) return null
  const window = rec.window && typeof rec.window === 'object' ? (rec.window as Record<string, unknown>) : null
  const start = typeof window?.offset === 'number' && Number.isFinite(window.offset) ? window.offset : 0
  const length = typeof window?.length === 'number' && Number.isFinite(window.length) ? Math.max(0, window.length) : 0
  return {
    documentId: rec.document_id,
    start,
    end: start + length,
    capture: rec.needs_capture === true,
  }
}
