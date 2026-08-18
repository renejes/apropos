import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../core/db'
import { Repo } from '../core/repo'
import { ToolBridge } from '../core/engine/tool-bridge'
import { installSelfCarryingProtocolErrors, translateProtocolError } from './server'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Fehlerantworten müssen sich SELBST tragen.
 *
 * Der Anlass (documentation/07): Von 20 geprüften Clients werten nur drei das
 * MCP-Feld `isError` aus. In den übrigen 17 landet der Antworttext im Verlauf wie
 * jedes andere Werkzeugergebnis — ununterscheidbar von einem Erfolg, wenn er nicht
 * selbst sagt, dass er einer ist.
 *
 * Geprüft wird deshalb am ECHTEN Client über den echten Server, nicht an der
 * Formatierungsfunktion: Der häufigste Fehler (Schema-Verstoß) entsteht im SDK,
 * bevor irgendein eigener Handler läuft. Genau dieser Pfad war unbemerkt roh.
 */

/** Wörter, mit denen eine Handlungsanweisung beginnen darf. Kein Stilkatalog, sondern
 *  die Prüfbedingung für "imperativ": Wer hier ergänzt, soll bewusst entscheiden. */
const IMPERATIVE = [
  'Arbeite',
  'Beschreibe',
  'Dokumentiere',
  'Erfasse',
  'Frage',
  'Gib',
  'Hole',
  'Korrigiere',
  'Lass',
  'Lies',
  'Nimm',
  'Nutze',
  'Prüfe',
  'Rufe',
  'Schließe',
  'Suche',
  'TU',
  'Trage',
  'Vergrößere',
  'Verkleinere',
  'Vertausche',
  'Wähle',
  'Zerlege',
]

interface ErrorPayload {
  status?: string
  code?: string
  error?: string
  next_action?: string
}

describe('Fehlerantworten tragen sich selbst', () => {
  let db: DB
  let repo: Repo
  let bridge: ToolBridge
  let projectId: string
  let fixture: Server
  let paperUrl: string

  const QUOTE = 'Verifizierbare Provenienz ist die Grundlage vertrauenswürdiger Forschung.'
  const FIXTURE = `<!doctype html><html><head><title>Fixture</title></head><body>
<h1>Über belegte Forschung</h1><p>Viele Systeme behaupten Korrektheit ohne Beleg. ${QUOTE}
Wer seine Quellen nicht zeigen kann, sollte keine starken Schlüsse ziehen.</p></body></html>`

  beforeAll(async () => {
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    fixture = createServer((req, res) => {
      if (req.url?.startsWith('/paper')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(FIXTURE)
      } else {
        res.writeHead(404)
        res.end('nope')
      }
    })
    await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', r))
    paperUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}/paper`
  })

  afterAll(async () => {
    delete process.env.RESEARCH_ALLOW_PRIVATE_FETCH
    await new Promise<void>((r) => fixture.close(() => r()))
  })

  beforeEach(async () => {
    db = openDb(':memory:')
    repo = new Repo(db)
    projectId = repo.createProject({
      title: 'Fehlertest',
      research_question: 'Tragen Fehlermeldungen sich selbst?',
      mode: 'academic',
      policy_preset: null,
      actor: 'test',
    }).id
    bridge = new ToolBridge(repo)
    await bridge.connect()
  })

  const callAndParse = async (name: string, args: Record<string, unknown>) => {
    const res = await bridge.call(name, args)
    let payload: ErrorPayload
    try {
      payload = JSON.parse(res.text) as ErrorPayload
    } catch {
      throw new Error(`Antwort von ${name} ist kein JSON — ein Client kann sie nicht auswerten:\n${res.text}`)
    }
    return { res, payload }
  }

  // ---------------------------------------------------------------- der Vertrag

  /**
   * Jede Fehlerklasse einmal — inklusive der beiden, die im SDK entstehen und
   * unsere Handler nie erreichen (input_invalid, tool_not_found).
   */
  const FAILING_CALLS: Array<[string, string, Record<string, unknown>]> = [
    ['Schema: URL ungültig', 'add_source', { project_id: 'p', url: 'keine-url', title: 'x' }],
    ['Schema: Pflichtfeld fehlt', 'log_search', { project_id: 'p', engine: 'test' }],
    ['Schema: leere Liste', 'plan_research', { project_id: 'p', sub_questions: [] }],
    ['unbekanntes Werkzeug', 'gibt_es_nicht', {}],
    ['Projekt existiert nicht', 'log_search', { project_id: 'gibt-es-nicht', query: 'gueltige anfrage' }],
    ['Dokument existiert nicht', 'add_source', {
      project_id: 'p',
      url: 'https://example.org/a',
      title: 'Titel',
      retrieval_method: 'test',
      reason: 'Eine hinreichend lange Begründung für diese Quelle.',
      extraction: 'Eine hinreichend lange Extraktion aus dieser Quelle.',
      contribution: 'Trägt zum Ergebnis bei.',
      document_id: 'gibt-es-nicht',
      quote_start: 0,
      quote_end: 50,
    }],
    ['keine offene Runde', 'next_round', { project_id: 'p' }],
    ['Bericht bei offenen Lücken', 'add_report_version', { project_id: 'p', content_markdown: 'x'.repeat(60) }],
  ]

  it.each(FAILING_CALLS)('%s: meldet FEHLER, Code und eine imperative next_action', async (_label, tool, rawArgs) => {
    const args = Object.fromEntries(Object.entries(rawArgs).map(([k, v]) => [k, v === 'p' ? projectId : v]))
    const { res, payload } = await callAndParse(tool, args)

    expect(res.isError).toBe(true)
    expect(payload.status).toMatch(/FEHLER/)
    expect(payload.code).toBeTruthy()
    expect(payload.error).toBeTruthy()

    const next = payload.next_action ?? ''
    expect(next.length).toBeGreaterThan(30)
    const firstWord = next.split(/\s+/)[0]
    expect(
      IMPERATIVE.includes(firstWord),
      `next_action beginnt mit "${firstWord}" — das ist keine Handlungsanweisung. ` +
        `Formuliere imperativ (oder ergänze das Verb bewusst in IMPERATIVE):\n${next}`
    ).toBe(true)
  })

  it('setzt status als ERSTES Feld — wer die Antwort abschneidet, sieht den Fehler trotzdem', async () => {
    const { res } = await callAndParse('log_search', { project_id: 'gibt-es-nicht', query: 'gueltige anfrage' })
    expect(res.text.trimStart().startsWith('{\n  "status"')).toBe(true)
    // Selbst die ersten 60 Zeichen tragen den Befund.
    expect(res.text.slice(0, 60)).toMatch(/FEHLER/)
  })

  // ---------------------------------------------------------------- SDK-Pfad

  it('übersetzt Schema-Verstöße des SDK ins Deutsche und dampft das Zod-JSON ein', async () => {
    const { payload } = await callAndParse('log_search', { project_id: projectId, engine: 'test' })
    expect(payload.code).toBe('input_invalid')
    expect(payload.error).toContain('log_search')
    expect(payload.error).toMatch(/query/)
    // Keine rohe Zod-Wand mehr: eine Zeile statt eingerücktem JSON-Array.
    expect(payload.error).not.toContain('"code": "invalid_type"')
    expect(payload.next_action).toContain('log_search')
  })

  it('meldet unbekannte Werkzeuge als solche, statt den Protokollfehler durchzureichen', async () => {
    const { payload } = await callAndParse('gibt_es_nicht', {})
    expect(payload.code).toBe('tool_not_found')
    expect(payload.error).toContain('gibt_es_nicht')
    expect(payload.error).not.toMatch(/MCP error/)
  })

  it('erkennt die SDK-Meldung mit UND ohne JSON-RPC-Präfix', () => {
    const inner = 'Input validation error: Invalid arguments for tool add_source: [{"path":["url"],"message":"Invalid url"}]'
    for (const message of [inner, `MCP error -32602: ${inner}`]) {
      const parsed = JSON.parse(translateProtocolError(message).content[0].text) as ErrorPayload
      expect(parsed.code).toBe('input_invalid')
      expect(parsed.error).toContain('url: Invalid url')
    }
  })

  /**
   * Der Wächter. Die angezapfte SDK-Methode ist `private` — verschwindet sie in
   * einer neuen Fassung, MUSS der Server laut scheitern. Ein stiller Rückfall auf
   * rohen englischen Protokolltext wäre die Wiederholung des Rebinding-Fehlers:
   * kein Fehler, keine Warnung, nur keine Wirkung mehr.
   */
  it('scheitert laut, wenn der SDK-Ansatzpunkt verschwindet', () => {
    expect(() => installSelfCarryingProtocolErrors({} as McpServer)).toThrow(/createToolError/)
  })

  // ------------------------------------------------- der Fall ohne isError-Flag

  it('add_source schreit, wenn der Beleg durchgefallen ist — obwohl es KEIN Werkzeugfehler ist', async () => {
    const res = await bridge.call('add_source', {
      project_id: projectId,
      url: paperUrl,
      title: 'Fixture-Papier',
      retrieval_method: 'test',
      reason: 'Diese Quelle soll die Kernaussage des Berichts belegen.',
      extraction: 'Die Quelle behauptet etwas über verifizierbare Provenienz.',
      contribution: 'Stützt die zentrale These.',
      verbatim_quote: 'Dieser Satz steht garantiert nicht im Quelltext des Fixture-Dokuments.',
    })

    // Genau das ist die Falle: der Eintrag wurde gespeichert, also kein isError.
    expect(res.isError).toBe(false)
    const payload = JSON.parse(res.text) as { status?: string; next_action?: string; checks?: { quote_verified?: boolean } }
    expect(payload.checks?.quote_verified).toBe(false)
    expect(payload.status).toMatch(/ACHTUNG/)
    expect(payload.status).toMatch(/NICHT VERIFIZIERT/)
    // Und der Befund steht vorne, nicht hinter "stored: true".
    expect(res.text.slice(0, 60)).toMatch(/ACHTUNG/)
    expect(payload.next_action).toMatch(/^TU JETZT/)
  })

  it('add_source meldet den Offset-Beleg als OK', async () => {
    const fetched = JSON.parse((await bridge.call('fetch_source', {
      project_id: projectId,
      url: paperUrl,
      purpose: 'Beleg für die Kernaussage suchen.',
    })).text) as { document_id: string; window: { text: string; offset: number } }

    const start = fetched.window.offset + fetched.window.text.indexOf(QUOTE)
    const res = await bridge.call('add_source', {
      project_id: projectId,
      url: paperUrl,
      title: 'Fixture-Papier',
      retrieval_method: 'fetch_source',
      reason: 'Diese Quelle soll die Kernaussage des Berichts belegen.',
      extraction: 'Die Quelle nennt Provenienz als Grundlage vertrauenswürdiger Forschung.',
      contribution: 'Stützt die zentrale These.',
      document_id: fetched.document_id,
      quote_start: start,
      quote_end: start + QUOTE.length,
    })
    const payload = JSON.parse(res.text) as { status?: string }
    expect(res.isError).toBe(false)
    expect(payload.status).toMatch(/^OK/)
  })

  it('fetch_source nennt das verbleibende Abruf-Kontingent, bevor es aufgebraucht ist', async () => {
    const first = JSON.parse((await bridge.call('fetch_source', {
      project_id: projectId,
      url: `${paperUrl}?a`,
      purpose: 'Erste Quelle für die Teilfrage lesen.',
    })).text) as { hint: string }
    expect(first.hint).toMatch(/Noch 2 Abruf/)

    await bridge.call('fetch_source', { project_id: projectId, url: `${paperUrl}?b`, purpose: 'Zweite Quelle lesen.' })
    const third = JSON.parse((await bridge.call('fetch_source', {
      project_id: projectId,
      url: `${paperUrl}?c`,
      purpose: 'Dritte Quelle lesen.',
    })).text) as { hint: string }
    expect(third.hint).toMatch(/Kontingent ist damit aufgebraucht/)

    // Und der nächste Abruf wird tatsächlich abgelehnt — die Warnung war keine Floskel.
    const { res, payload } = await callAndParse('fetch_source', {
      project_id: projectId,
      url: `${paperUrl}?d`,
      purpose: 'Vierte Quelle lesen.',
    })
    expect(res.isError).toBe(true)
    expect(payload.code).toBe('open_documents_limit')
  })
})
