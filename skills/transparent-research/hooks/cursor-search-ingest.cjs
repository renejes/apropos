#!/usr/bin/env node
/**
 * Cursor-Hook für die Research Overview Platform.
 *
 * Absicht, bewusst anders als provenance-gate.cjs (Claude Code):
 *   - WebSearch wird NICHT geblockt, sondern fail-open an POST /ingest/search
 *     geschickt (Suchprotokoll ohne Modellwohlwollen).
 *   - WebFetch wird abgewiesen: der Text muss über fetch_source in der DB liegen.
 *   - MCP-Werkzeuge (fetch_source, add_source, …) werden nicht angefasst.
 *
 * Verkabelung: .cursor/hooks.json (Projektwurzel).
 * Fail-open: Jeder Fehler, Timeout oder fehlende App lässt die Session weiterlaufen.
 *
 * Env:
 *   ROP_INGEST_URL   – Override, Standard http://127.0.0.1:8790/ingest/search
 *   ROP_PROJECT_ID   – Fallback, wenn der Hook keine project_id kennt (Server ebenfalls)
 */
'use strict'

const DEFAULT_INGEST = 'http://127.0.0.1:8790/ingest/search'
const TIMEOUT_MS = 800

function out(obj) {
  process.stdout.write(JSON.stringify(obj ?? {}))
  process.exit(0)
}

function failOpen() {
  out({})
}

function eventName(input) {
  if (input.hook_event_name) return input.hook_event_name
  return input.tool_output !== undefined ? 'postToolUse' : 'preToolUse'
}

function extractUrls(output) {
  const urls = new Set()
  const add = (s) => {
    if (typeof s !== 'string') return
    const m = s.match(/^https?:\/\/[^\s"'<>\\]+/i)
    if (m) urls.add(m[0].replace(/[),.;]+$/, ''))
  }
  const walk = (v, depth) => {
    if (depth > 8 || v == null) return
    if (typeof v === 'string') {
      const re = /https?:\/\/[^\s"'<>\\]+/gi
      let m
      while ((m = re.exec(v))) add(m[0])
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    if (typeof v === 'object') {
      if (typeof v.url === 'string') add(v.url)
      for (const x of Object.values(v)) walk(x, depth + 1)
    }
  }
  if (typeof output === 'string') {
    try {
      walk(JSON.parse(output), 0)
    } catch {
      walk(output, 0)
    }
  } else {
    walk(output, 0)
  }
  return [...urls]
}

function queryOf(input) {
  const t = input.tool_input || {}
  return String(t.query || t.search_term || t.searchTerm || '').trim()
}

function isMcpTool(tool) {
  return /mcp/i.test(tool) || /fetch_source|add_source|exclude_source|log_search/i.test(tool)
}

/**
 * Reine Entscheidung — ohne Netz. Von Tests importierbar.
 * @returns {{ permission?: string, agent_message?: string, user_message?: string, ingest?: object, additional_context?: string }}
 */
function decide(input) {
  const event = eventName(input)
  const tool = String(input.tool_name || '')
  if (isMcpTool(tool)) return {}

  if (event === 'preToolUse' && /^WebFetch$/i.test(tool)) {
    const msg =
      'Nutze fetch_source über den MCP-Server research-overview — der Quelltext muss in der lokalen Datenbank liegen. ' +
      'WebFetch umgeht die Provenienz: Zitate wären wieder fälschbar. ' +
      'next_action: Rufe fetch_source mit der URL auf, danach add_source mit document_id + quote_start + quote_end.'
    return {
      permission: 'deny',
      agent_message: msg,
      user_message: 'WebFetch blockiert: Quelle über fetch_source (Research Overview) abrufen.',
    }
  }

  if (event === 'postToolUse' && /^WebSearch$/i.test(tool)) {
    const query = queryOf(input)
    const urls = extractUrls(input.tool_output)
    const hitCount = urls.length || (typeof input.tool_input?.num_results === 'number' ? input.tool_input.num_results : undefined)
    return {
      ingest: {
        query: query || '(unbekannt)',
        provider: 'cursor-websearch',
        hit_count: hitCount,
        urls,
      },
      additional_context:
        '[Research Overview] Suche protokolliert. Snippets sind keine Quelle. ' +
        'URLs, die in den Bericht sollen: fetch_source → add_source mit Offsets. Nicht WebFetch.',
    }
  }

  return {}
}

async function postIngest(body) {
  const url = process.env.ROP_INGEST_URL || DEFAULT_INGEST
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

async function main(input) {
  const decision = decide(input)
  if (decision.ingest) {
    try {
      await postIngest(decision.ingest)
    } catch {
      /* fail-open: App nicht gestartet oder Timeout */
    }
    const { ingest: _ignored, ...rest } = decision
    out(rest)
  }
  out(decision)
}

module.exports = { decide, extractUrls, DEFAULT_INGEST }

if (require.main === module) {
  let raw = ''
  process.stdin.on('data', (d) => (raw += d))
  process.stdin.on('end', () => {
    try {
      void main(JSON.parse(raw || '{}')).catch(() => failOpen())
    } catch {
      failOpen()
    }
  })
}
