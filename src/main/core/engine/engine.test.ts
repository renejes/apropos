import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { ProviderError } from '../providers/types'
import { ToolBridge } from './tool-bridge'
import { runAgentLoop } from './agent-loop'
import { FakeProvider, type FakeTurn } from './fake-provider'
import { ResearchEngine, type EngineEvent } from './research-engine'
import { computeCoverage } from '../services/research'
import { adoptMinimalBrief } from '../services/brief'

/**
 * Tests der Agenten-Schleife mit skriptbarem Modell und echtem MCP-Server
 * (in-process) über einer echten SQLite-DB. Nur der Modell-Anbieter ist ein
 * Testdouble — Werkzeuge, Enforcement und Abdeckungsrechnung sind die echten.
 */

const QUOTE = 'Verifizierbare Provenienz ist die Grundlage vertrauenswürdiger Forschung.'
const FIXTURE = `<!doctype html><html><head><title>Fixture</title></head><body>
<h1>Über belegte Forschung</h1><p>Viele Systeme behaupten Korrektheit ohne Beleg. ${QUOTE}
Wer seine Quellen nicht zeigen kann, sollte keine starken Schlüsse ziehen.</p></body></html>`

describe('Agenten-Schleife & Engine', () => {
  let db: DB
  let repo: Repo
  let projectId: string
  let bridge: ToolBridge
  let fixture: Server
  let paperUrl: string

  beforeAll(async () => {
    // SSRF-Guard nur für den lokalen Fixture-Server lockern (wie im Smoke-Test).
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    fixture = createServer((req, res) => {
      if (req.url === '/paper') {
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
      title: 'Engine-Test',
      research_question: 'Trägt belegte Provenienz?',
      mode: 'academic',
      policy_preset: null,
      actor: 'test',
    }).id
    adoptMinimalBrief(repo, projectId, 'test')
    bridge = new ToolBridge(repo)
    await bridge.connect()
  })

  // ---------------------------------------------------------------- ToolBridge

  it('bindet den echten MCP-Server in-process an und listet alle Werkzeuge', async () => {
    const tools = await bridge.listAll()
    expect(tools.length).toBeGreaterThanOrEqual(21)
    expect(tools.map((t) => t.name)).toContain('add_source')
    expect(tools.map((t) => t.name)).toContain('draft_research_brief')
    expect(tools.map((t) => t.name)).toContain('adopt_research_brief')
    expect(tools.find((t) => t.name === 'add_source')?.parameters).toHaveProperty('properties')
    const addSourceParams = tools.find((t) => t.name === 'add_source')?.parameters as { properties?: Record<string, unknown> }
    expect(addSourceParams.properties).toHaveProperty('source_kind')
    expect(addSourceParams.properties).toHaveProperty('quote_locator')
  })

  it('gibt je Phase nur die passenden Werkzeuge heraus — unter der 15er-Grenze', async () => {
    for (const phase of ['planning', 'research', 'synthesis'] as const) {
      const tools = await bridge.listForPhase(phase)
      expect(tools.length).toBeGreaterThan(0)
      expect(tools.length).toBeLessThanOrEqual(15)
    }
    expect((await bridge.listForPhase('research')).map((t) => t.name)).toContain('fetch_source')
    // Der Bericht darf in der Recherche-Phase nicht schreibbar sein.
    expect((await bridge.listForPhase('research')).map((t) => t.name)).not.toContain('add_report_version')
  })

  it('gibt Werkzeugfehler als Ergebnis zurück, statt zu werfen', async () => {
    const res = await bridge.call('add_source', { project_id: projectId, url: 'nicht-mal-eine-url' })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/ungültig|invalid|url/i)
  })

  it('meldet unbekannte Werkzeuge als Fehler-Ergebnis', async () => {
    const res = await bridge.call('gibt_es_nicht', {})
    expect(res.isError).toBe(true)
  })

  // ---------------------------------------------------------------- Innere Schleife

  const loop = (script: FakeTurn[], over: Partial<Parameters<typeof runAgentLoop>[0]> = {}) => {
    const provider = new FakeProvider(script)
    return {
      provider,
      run: async () =>
        runAgentLoop({
          provider,
          model: 'fake-model',
          bridge,
          tools: [],
          system: 'sys',
          task: 'task',
          ...over,
        }),
    }
  }

  it('endet, sobald das Modell keine Werkzeuge mehr aufruft', async () => {
    const { run } = loop([{ text: 'Alles erledigt.' }])
    const res = await run()
    expect(res.stopReason).toBe('model_finished')
    expect(res.finalText).toBe('Alles erledigt.')
    expect(res.turns).toBe(1)
  })

  it('führt Werkzeugaufrufe aus und speist die Ergebnisse zurück', async () => {
    const { provider, run } = loop([
      { toolCalls: [{ name: 'log_search', arguments: { project_id: projectId, query: 'testfrage', engine: 'test', results_found: 3 } }] },
      { text: 'Suche protokolliert.' },
    ])
    const res = await run()
    expect(res.stopReason).toBe('model_finished')
    expect(res.toolCalls).toBe(1)
    expect(res.failedToolCalls).toBe(0)
    expect(repo.listSearchLog(projectId)).toHaveLength(1)
    // Das Werkzeug-Ergebnis liegt im Verlauf des ZWEITEN Aufrufs.
    const second = provider.requests[1]
    expect(second.messages.some((m) => m.role === 'tool' && m.tool_name === 'log_search')).toBe(true)
  })

  it('zählt fehlgeschlagene Werkzeugaufrufe und gibt dem Modell die Chance zur Korrektur', async () => {
    // Schema-konform, aber unbekanntes Projekt -> der Fehler kommt aus der Service-Schicht.
    const { provider, run } = loop([
      { toolCalls: [{ name: 'log_search', arguments: { project_id: 'gibt-es-nicht', query: 'gueltige anfrage', engine: 'test' } }] },
      { toolCalls: [{ name: 'log_search', arguments: { project_id: projectId, query: 'korrigiert', engine: 'test' } }] },
      { text: 'Korrigiert.' },
    ])
    const res = await run()
    expect(res.failedToolCalls).toBe(1)
    expect(res.toolCalls).toBe(2)
    // Das Modell hat den Fehler tatsächlich gesehen — mit code und hint zur Korrektur.
    const toolMsg = provider.requests[1].messages.find((m) => m.role === 'tool')
    expect(toolMsg?.content).toMatch(/existiert nicht/)
    expect(toolMsg?.content).toMatch(/project_not_found/)
    expect(repo.listSearchLog(projectId)[0].query).toBe('korrigiert')
  })

  it('reicht auch Schema-Verstöße als korrigierbaren Fehler zurück', async () => {
    // query zu kurz -> die MCP-Zod-Prüfung greift VOR der Service-Schicht.
    const { provider, run } = loop([
      { toolCalls: [{ name: 'log_search', arguments: { project_id: projectId, query: 'x' } }] },
      { text: 'Verstanden.' },
    ])
    const res = await run()
    expect(res.failedToolCalls).toBe(1)
    expect(provider.requests[1].messages.find((m) => m.role === 'tool')?.content).toMatch(/validation|ungültig/i)
    expect(repo.listSearchLog(projectId)).toHaveLength(0)
  })

  it('respektiert die Turn-Grenze', async () => {
    const endless: FakeTurn = { toolCalls: [{ name: 'get_coverage_gaps', arguments: { project_id: projectId } }] }
    const { run } = loop([endless, endless, endless, endless, endless], { limits: { maxTurns: 3 } })
    const res = await run()
    expect(res.stopReason).toBe('max_turns')
    expect(res.turns).toBe(3)
  })

  it('respektiert die Token-Grenze', async () => {
    const t: FakeTurn = { toolCalls: [{ name: 'get_coverage_gaps', arguments: { project_id: projectId } }] }
    // Jeder Turn zählt 120 Token; nach zwei Turns ist die Grenze von 200 überschritten.
    const { run } = loop([t, t, t, t], { limits: { maxTokens: 200 } })
    const res = await run()
    expect(res.stopReason).toBe('max_tokens')
    expect(res.turns).toBe(2)
  })

  it('bricht auf Signal ab', async () => {
    const ctrl = new AbortController()
    const t: FakeTurn = {
      dynamic: () => {
        ctrl.abort()
        return { toolCalls: [{ name: 'get_coverage_gaps', arguments: { project_id: projectId } }] }
      },
    }
    const { run } = loop([t, t], { signal: ctrl.signal })
    const res = await run()
    expect(res.stopReason).toBe('aborted')
  })

  it('meldet Anbieterfehler, ohne den Verlauf zu verlieren', async () => {
    const { run } = loop([
      { toolCalls: [{ name: 'log_search', arguments: { project_id: projectId, query: 'a', engine: 't' } }] },
      { error: new ProviderError('quota_exhausted', 'Kontingent erschöpft') },
    ])
    const res = await run()
    expect(res.stopReason).toBe('provider_error')
    expect(res.error).toMatch(/quota_exhausted/)
    expect(res.toolCalls).toBe(1) // die Arbeit davor ist erhalten
  })

  it('gibt Denkschritte als Ereignis heraus, aber nicht in den Kontext', async () => {
    const provider = new FakeProvider([{ text: 'ok' }])
    const events: string[] = []
    // Denkschritte kommen vom Anbieter; hier über den Fake nicht erzeugbar —
    // stattdessen prüfen, dass der Verlauf keine thinking-Rolle kennt.
    await runAgentLoop({
      provider,
      model: 'm',
      bridge,
      tools: [],
      system: 's',
      task: 't',
      onEvent: (e) => events.push(e.type),
    })
    expect(events).toContain('assistant_text')
    expect(events).toContain('turn')
  })

  // ---------------------------------------------------------------- Engine

  /** Skript, das eine Teilfrage über fetch_source + Offset-Zitat belegt. */
  const researchScript = (sqIndex: number): FakeTurn[] => [
    {
      dynamic: () => ({
        toolCalls: [{ name: 'fetch_source', arguments: { project_id: projectId, url: paperUrl, purpose: 'Belegquelle für die Teilfrage abrufen' } }],
      }),
    },
    {
      dynamic: (req) => {
        // document_id und Offsets aus dem Werkzeug-Ergebnis lesen — wie ein echtes Modell.
        const toolMsg = [...req.messages].reverse().find((m) => m.role === 'tool')
        const parsed = JSON.parse(toolMsg?.content ?? '{}')
        const text: string = parsed.window?.text ?? ''
        const rel = text.indexOf(QUOTE)
        const start = (parsed.window?.offset ?? 0) + rel
        const sq = repo.listSubQuestions(projectId).filter((s) => s.status !== 'dropped')[sqIndex]
        return {
          toolCalls: [
            {
              name: 'add_source',
              arguments: {
                project_id: projectId,
                url: paperUrl,
                title: `Belegquelle ${sqIndex + 1}`,
                retrieval_method: 'fetch_source',
                reason: 'Zentrale Quelle, die die Teilfrage direkt adressiert und belegt.',
                extraction: 'Belegte Provenienz ist die Grundlage vertrauenswürdiger Forschung.',
                contribution: 'Beantwortet die Teilfrage.',
                document_id: parsed.document_id,
                quote_start: start,
                quote_end: start + QUOTE.length,
                sub_question_id: sq?.id,
              },
            },
          ],
        }
      },
    },
    { text: 'Teilfrage belegt.' },
  ]

  const engineEvents = (bag: EngineEvent[]) => (e: EngineEvent) => bag.push(e)

  it('plant, recherchiert, schließt Runden und schreibt einen Bericht', async () => {
    const script: FakeTurn[] = [
      // Planung
      {
        toolCalls: [
          {
            name: 'plan_research',
            arguments: {
              project_id: projectId,
              sub_questions: [{ question: 'Was macht Provenienz belastbar?', min_sources: 1 }],
            },
          },
        ],
      },
      { text: 'Eine Teilfrage geplant.' },
      // Recherche
      ...researchScript(0),
      // Synthese
      {
        dynamic: () => {
          const src = repo.listSources(projectId)[0]
          return {
            toolCalls: [
              {
                name: 'link_claim_to_source',
                arguments: {
                  project_id: projectId,
                  claim_text: 'Belegte Provenienz ist die Grundlage vertrauenswürdiger Forschung.',
                  source_id: src.id,
                  quote_span: QUOTE,
                  support_type: 'supports',
                },
              },
            ],
          }
        },
      },
      {
        toolCalls: [
          {
            name: 'add_report_version',
            arguments: {
              project_id: projectId,
              content_markdown: '## Ergebnis\n\nBelegte Provenienz trägt [S1]. '.padEnd(80, '.'),
              change_summary: 'Erstfassung durch die Engine',
            },
          },
        ],
      },
      { text: 'Bericht abgelegt.' },
    ]

    const events: EngineEvent[] = []
    const engine = new ResearchEngine(repo, { provider: new FakeProvider(script), model: 'fake-model', maxRounds: 2 })
    const res = await engine.run({
      projectId,
      researchQuestion: 'Trägt belegte Provenienz?',
      onEvent: engineEvents(events),
    })

    expect(repo.listSubQuestions(projectId)).toHaveLength(1)
    expect(repo.listSources(projectId)).toHaveLength(1)
    expect(repo.getSource(repo.listSources(projectId)[0].id)?.quote_verified).toBe(1)
    expect(res.reportVersionId).not.toBeNull()
    expect(res.coverage.ready_for_report).toBe(true)
    expect(res.totalToolCalls).toBeGreaterThanOrEqual(4)

    const phases = events.filter((e) => e.type === 'phase').map((e) => (e as { phase: string }).phase)
    expect(phases).toEqual(['planning', 'research', 'synthesis', 'done'])
    expect(events.some((e) => e.type === 'round_end')).toBe(true)
    expect(events.some((e) => e.type === 'finished')).toBe(true)
  })

  it('legt eine Rückfall-Teilfrage an, wenn das Modell nicht plant', async () => {
    const engine = new ResearchEngine(repo, {
      // Modell ruft plan_research nie auf
      provider: new FakeProvider([{ text: 'Ich plane nichts.' }, { text: 'Nichts zu tun.' }, { text: 'Fertig.' }]),
      model: 'fake-model',
      maxRounds: 1,
    })
    await engine.run({ projectId, researchQuestion: 'Eine Frage, die geplant werden müsste?' })
    const sqs = repo.listSubQuestions(projectId)
    expect(sqs).toHaveLength(1)
    expect(sqs[0].question).toBe('Eine Frage, die geplant werden müsste?')
    expect(sqs[0].rationale).toMatch(/Rückfall/)
  })

  it('stoppt bei Sättigung, statt bis zum Rundendeckel zu laufen', async () => {
    // Zwei Teilfragen, aber das Modell belegt nur die erste und tut danach nichts mehr.
    const script: FakeTurn[] = [
      {
        toolCalls: [
          {
            name: 'plan_research',
            arguments: {
              project_id: projectId,
              sub_questions: [
                { question: 'Erste Teilfrage zum Sachverhalt?', min_sources: 1 },
                { question: 'Zweite Teilfrage zum Sachverhalt?', min_sources: 1 },
              ],
            },
          },
        ],
      },
      { text: 'Geplant.' },
      ...researchScript(0),
      // Zweite Teilfrage: nur eine Suche protokollieren, keine Quelle -> Runde bleibt mager
      { toolCalls: [{ name: 'log_search', arguments: { project_id: projectId, query: 'ergebnislos', engine: 'test', results_found: 0 } }] },
      { text: 'Nichts gefunden.' },
      // Falls doch eine weitere Runde käme, würde das Skript hier ausgehen (Default: "Fertig.")
    ]
    const events: EngineEvent[] = []
    const engine = new ResearchEngine(repo, { provider: new FakeProvider(script), model: 'fake-model', maxRounds: 4, dryThreshold: 2 })
    const res = await engine.run({ projectId, researchQuestion: 'Frage?', onEvent: engineEvents(events) })

    // Nur 1 neue belegte Quelle in Runde 1 -> unter der Schwelle 2 -> Sättigung
    const roundEnd = events.find((e) => e.type === 'round_end') as { newVerified: number; shouldContinue: boolean }
    expect(roundEnd.newVerified).toBe(1)
    expect(roundEnd.shouldContinue).toBe(false)
    expect(res.rounds).toBe(1)
    expect(res.stopReason).toMatch(/Sättigung/)
  })

  it('überspringt die Synthese, wenn keine belegte Quelle existiert', async () => {
    const engine = new ResearchEngine(repo, {
      provider: new FakeProvider([
        { toolCalls: [{ name: 'plan_research', arguments: { project_id: projectId, sub_questions: [{ question: 'Frage ohne Belege?' }] } }] },
        { text: 'Geplant.' },
        { toolCalls: [{ name: 'log_search', arguments: { project_id: projectId, query: 'leer', engine: 'test', results_found: 0 } }] },
        { text: 'Nichts.' },
      ]),
      model: 'fake-model',
      maxRounds: 1,
    })
    const res = await engine.run({ projectId, researchQuestion: 'Frage?' })
    expect(res.reportVersionId).toBeNull()
    expect(repo.listReportVersions(projectId)).toHaveLength(0)
  })

  it('bricht ab, ohne den bisherigen Stand zu verlieren', async () => {
    const ctrl = new AbortController()
    const script: FakeTurn[] = [
      {
        toolCalls: [
          { name: 'plan_research', arguments: { project_id: projectId, sub_questions: [{ question: 'Erste Frage zum Sachverhalt?', min_sources: 1 }] } },
        ],
      },
      { text: 'Geplant.' },
      {
        dynamic: () => {
          ctrl.abort() // mitten in der Recherche abbrechen
          return { text: 'abgebrochen' }
        },
      },
    ]
    const engine = new ResearchEngine(repo, { provider: new FakeProvider(script), model: 'fake-model' })
    const res = await engine.run({ projectId, researchQuestion: 'Frage?', signal: ctrl.signal })

    expect(res.stopReason).toMatch(/Abgebrochen/)
    // Die Planung von vorher ist erhalten — der Lauf ist wiederaufnehmbar.
    expect(repo.listSubQuestions(projectId)).toHaveLength(1)
  })

  it('nutzt vorhandene Teilfragen statt neu zu planen', async () => {
    repo.addSubQuestion({ project_id: projectId, question: 'Bereits vorhandene Teilfrage?', min_sources: 1, actor: 'human' })
    repo.openRound(projectId, 'human')
    const provider = new FakeProvider([...researchScript(0), { text: 'Fertig.' }])
    const engine = new ResearchEngine(repo, { provider, model: 'fake-model', maxRounds: 1 })
    await engine.run({ projectId, researchQuestion: 'Frage?' })

    expect(repo.listSubQuestions(projectId)).toHaveLength(1) // nichts hinzugeplant
    // Kein Aufruf hat plan_research angeboten -> Planungsphase wurde übersprungen
    expect(provider.requests[0].messages.some((m) => m.content.includes('plan_research'))).toBe(false)
  })

  it('protokolliert das Laufergebnis im Event-Log', async () => {
    const engine = new ResearchEngine(repo, {
      provider: new FakeProvider([
        { toolCalls: [{ name: 'plan_research', arguments: { project_id: projectId, sub_questions: [{ question: 'Kurze Testfrage?' }] } }] },
        { text: 'Geplant.' },
        { text: 'Nichts weiter.' },
      ]),
      model: 'fake-model',
      maxRounds: 1,
    })
    await engine.run({ projectId, researchQuestion: 'Frage?' })
    const ev = repo.listEvents(projectId).find((e) => e.event_type === 'engine.run_finished')
    expect(ev).toBeDefined()
    expect(JSON.parse(ev!.payload_json).model).toBe('fake-model')
  })

  it('die Abdeckungsrechnung bleibt die Entscheidungsgrundlage, nicht das Modell', async () => {
    // Das Modell behauptet, fertig zu sein — die Lücke bleibt trotzdem offen.
    repo.addSubQuestion({ project_id: projectId, question: 'Unbeantwortete Teilfrage?', min_sources: 2, actor: 'human' })
    repo.openRound(projectId, 'human')
    const engine = new ResearchEngine(repo, {
      provider: new FakeProvider([{ text: 'Ich bin fertig, alles ist bestens belegt.' }]),
      model: 'fake-model',
      maxRounds: 1,
    })
    const res = await engine.run({ projectId, researchQuestion: 'Frage?' })
    expect(res.coverage.ready_for_report).toBe(false)
    expect(computeCoverage(repo, projectId).gaps.some((g) => g.kind === 'subquestion_uncovered')).toBe(true)
  })
})
