#!/usr/bin/env node
/**
 * Provenienz-Gate für Claude Code (Research Overview Platform).
 *
 * Erzwingt deterministisch, dass Claude während einer Research jede gefetchte
 * Quelle SOFORT dokumentiert (add_source/exclude_source) und jede Suche
 * protokolliert (log_search), bevor es weiter recherchieren darf.
 *
 * Verkabelung über .claude/settings.json (siehe README):
 *   PreToolUse  (WebFetch|WebSearch)                → gate: blockt bei offenen Pflichten
 *   PostToolUse (WebFetch|WebSearch)                → merkt Pflichten vor + erinnert
 *   PostToolUse (mcp__*__add_source|exclude_source|log_search) → löst Pflichten auf
 *   Stop                                            → blockt Turn-Ende bei offenen Pflichten
 *
 * State: eine kleine JSON-Datei pro Claude-Code-Session im tmp-Verzeichnis.
 * Fail-open: Bei unerwarteten Fehlern wird NIE geblockt (Session nicht bricken).
 *
 * Konfiguration per Env:
 *   ROP_MAX_PENDING  – wie viele gefetchte, noch unprotokollierte Quellen
 *                      erlaubt sind, bevor geblockt wird (Default: 3)
 */
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const MAX_PENDING = Math.max(1, parseInt(process.env.ROP_MAX_PENDING || '3', 10) || 3)

function statePath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')
  return path.join(os.tmpdir(), `rop-provenance-${safe}.json`)
}

function loadState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8'))
  } catch {
    return { pendingFetches: [], pendingSearch: null }
  }
}

function saveState(sessionId, state) {
  try {
    fs.writeFileSync(statePath(sessionId), JSON.stringify(state))
  } catch {
    /* fail-open */
  }
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj))
  process.exit(0)
}

function allowPre() {
  out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })
}

function main(input) {
  const event = input.hook_event_name
  const sessionId = input.session_id
  const tool = input.tool_name || ''
  const state = loadState(sessionId)

  // ---------------------------------------------------------------- PreToolUse
  if (event === 'PreToolUse') {
    if (state.pendingSearch) {
      out({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `PROVENIENZ-GATE: Die letzte Suche ("${state.pendingSearch.query}") ist noch nicht protokolliert. ` +
            `Rufe zuerst log_search (research-overview MCP) mit exakter Query, Suchort und Trefferzahl auf — danach darfst du weiter recherchieren.`,
        },
      })
    }
    if (Array.isArray(state.pendingFetches) && state.pendingFetches.length >= MAX_PENDING) {
      const urls = state.pendingFetches.map((p) => p.url).join('\n  - ')
      out({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `PROVENIENZ-GATE: ${state.pendingFetches.length} gefetchte Quellen sind noch unprotokolliert:\n  - ${urls}\n` +
            `Dokumentiere JEDE davon zuerst über den research-overview MCP-Server — genutzte Quellen mit add_source (inkl. wörtlichem Zitat aus dem Text, den du gerade gelesen hast), verworfene mit exclude_source (mit Grund). Erst dann geht die Recherche weiter.`,
        },
      })
    }
    allowPre()
  }

  // --------------------------------------------------------------- PostToolUse
  if (event === 'PostToolUse') {
    // Unsere MCP-Tools lösen Pflichten auf (Servername egal: mcp__<alias>__<tool>)
    const mcpTool = tool.match(/^mcp__.+__(add_source|exclude_source|log_search|log_extraction)$/)
    if (mcpTool) {
      const name = mcpTool[1]
      if (name === 'log_search') {
        state.pendingSearch = null
      } else if (name === 'add_source' || name === 'exclude_source') {
        const url = input.tool_input && input.tool_input.url
        const idx = url ? state.pendingFetches.findIndex((p) => p.url === url) : -1
        if (idx >= 0) state.pendingFetches.splice(idx, 1)
        else state.pendingFetches.shift() // kein URL-Match → älteste Pflicht auflösen
      }
      saveState(sessionId, state)
      out({})
    }

    if (tool === 'WebSearch') {
      const query = (input.tool_input && input.tool_input.query) || '(unbekannt)'
      state.pendingSearch = { query, ts: Date.now() }
      saveState(sessionId, state)
      out({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `[Provenienz-Gate] Suche ausgeführt. PFLICHT vor dem nächsten Schritt: log_search (research-overview) mit query="${query}", Suchort und Trefferzahl aufrufen.`,
        },
      })
    }

    if (tool === 'WebFetch') {
      const url = (input.tool_input && input.tool_input.url) || '(unbekannt)'
      state.pendingFetches = state.pendingFetches || []
      if (!state.pendingFetches.some((p) => p.url === url)) {
        state.pendingFetches.push({ url, ts: Date.now() })
      }
      saveState(sessionId, state)
      out({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            `[Provenienz-Gate] Quelle gefetcht: ${url}\n` +
            `PFLICHT solange der Text noch vor dir liegt: add_source (genutzt, mit wörtlichem Zitat) oder exclude_source (verworfen, mit Grund) über research-overview aufrufen. ` +
            `Offene Pflichten: ${state.pendingFetches.length}/${MAX_PENDING} — bei ${MAX_PENDING} wird der nächste Fetch geblockt.`,
        },
      })
    }

    out({})
  }

  // ---------------------------------------------------------------------- Stop
  if (event === 'Stop') {
    // Schleifenschutz: wenn wir schon einmal geblockt haben, nicht erneut blocken
    if (input.stop_hook_active) out({})
    const open = (state.pendingFetches || []).length
    if (open > 0 || state.pendingSearch) {
      const parts = []
      if (state.pendingSearch) parts.push(`die Suche "${state.pendingSearch.query}" ist nicht per log_search protokolliert`)
      if (open > 0) parts.push(`${open} gefetchte Quelle(n) sind nicht per add_source/exclude_source dokumentiert`)
      out({
        decision: 'block',
        reason:
          `PROVENIENZ-GATE: Der Turn kann noch nicht enden — ${parts.join(' und ')}. ` +
          `Hole die Dokumentation über den research-overview MCP-Server jetzt nach.`,
      })
    }
    // Sauber: State-Datei aufräumen, wenn alles dokumentiert ist
    try {
      fs.unlinkSync(statePath(sessionId))
    } catch {
      /* egal */
    }
    out({})
  }

  out({})
}

let raw = ''
process.stdin.on('data', (d) => (raw += d))
process.stdin.on('end', () => {
  try {
    main(JSON.parse(raw || '{}'))
  } catch {
    // Fail-open: niemals die Session bricken
    out({})
  }
})
