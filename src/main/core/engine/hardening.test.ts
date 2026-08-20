import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { ProviderError } from '../providers/types'
import { FakeProvider, type FakeTurn } from './fake-provider'
import { ResearchEngine, type EngineEvent } from './research-engine'
import { adoptMinimalBrief } from '../services/brief'

/**
 * Auto-Mode-Härtung: Was passiert, wenn ein Langlauf NICHT glatt durchläuft?
 *
 * Zwei Eigenschaften, die ein Vierstundenlauf braucht und die vorher fehlten:
 *
 *  1. QUOTA-GUARD — ein erschöpftes Kontingent, ein unerreichbarer Dienst oder ein
 *     aufgebrauchtes Token-Budget muss den LAUF beenden. Vorher wurde ein
 *     Anbieterfehler nur pro Teilfrage gemeldet und die Schleife rannte ihn für
 *     jede weitere Teilfrage und jede weitere Runde erneut an.
 *  2. CHECKPOINT/RESUME — nach Abbruch oder Absturz muss nachvollziehbar sein, dass
 *     ein Lauf offen ist, und er muss fortsetzbar sein, ohne die bereits abgerufenen
 *     aber undokumentierten Quellen zu verlieren.
 */

const QUOTE = 'Verifizierbare Provenienz ist die Grundlage vertrauenswürdiger Forschung.'
const FIXTURE = `<!doctype html><html><head><title>Fixture</title></head><body>
<h1>Über belegte Forschung</h1><p>Viele Systeme behaupten Korrektheit ohne Beleg. ${QUOTE}
Wer seine Quellen nicht zeigen kann, sollte keine starken Schlüsse ziehen.</p></body></html>`

describe('Auto-Mode-Härtung', () => {
  let db: DB
  let repo: Repo
  let projectId: string
  let fixture: Server
  let paperUrl: string

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

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
    projectId = repo.createProject({
      title: 'Härtungstest',
      research_question: 'Was hält ein Langlauf aus?',
      mode: 'academic',
      policy_preset: null,
      actor: 'test',
    }).id
    adoptMinimalBrief(repo, projectId, 'test')
  })

  /** Teilfragen vorab anlegen, damit die Planungs-Spawn-Runde die Skripte nicht verschiebt. */
  const plan = (n: number) => {
    for (let i = 0; i < n; i++) {
      repo.addSubQuestion({
        project_id: projectId,
        question: `Teilfrage Nummer ${i + 1} zum Sachverhalt?`,
        rationale: null,
        min_sources: 1,
        actor: 'test',
      })
    }
    repo.openRound(projectId, 'test')
  }

  const engineWith = (script: FakeTurn[], cfg: Partial<ConstructorParameters<typeof ResearchEngine>[1]> = {}) => {
    const provider = new FakeProvider(script)
    const engine = new ResearchEngine(repo, { provider, model: 'fake-model', maxRounds: 2, ...cfg })
    return { provider, engine }
  }

  const runWith = async (
    provider: FakeProvider,
    engine: ResearchEngine,
    over: { signal?: AbortSignal; resume?: boolean } = {}
  ) => {
    const events: EngineEvent[] = []
    const result = await engine.run({
      projectId,
      researchQuestion: 'Was hält ein Langlauf aus?',
      onEvent: (e) => events.push(e),
      ...over,
    })
    return { events, result, provider }
  }

  // ---------------------------------------------------------------- Quota-Guard

  it('beendet den LAUF beim ersten erschöpften Kontingent, statt es je Teilfrage erneut anzurennen', async () => {
    plan(4)
    const quota: FakeTurn = { error: new ProviderError('quota_exhausted', 'Kontingent erschöpft') }
    const { provider, engine } = engineWith([quota, quota, quota, quota, quota, quota])
    const { result, events } = await runWith(provider, engine)

    // Entscheidend: GENAU EIN Versuch. Vorher waren es vier (eine je Teilfrage).
    expect(provider.turnsUsed).toBe(1)
    expect(result.stopReason).toMatch(/Kontingent|quota/i)
    expect(events.some((e) => e.type === 'error' && e.fatal)).toBe(true)
  })

  it('behandelt einen unerreichbaren Dienst ebenfalls als endgültig', async () => {
    plan(3)
    const down: FakeTurn = { error: new ProviderError('unreachable', 'Modell-Anbieter antwortet nicht') }
    const { provider, engine } = engineWith([down, down, down, down])
    const { result } = await runWith(provider, engine)
    expect(provider.turnsUsed).toBe(1)
    expect(result.stopReason).toMatch(/unreachable|erreichbar/i)
  })

  it('gibt vorübergehenden Fehlern eine zweite Chance, bricht aber nach wiederholtem Scheitern ab', async () => {
    plan(6)
    const flaky: FakeTurn = { error: new ProviderError('stream_error', 'Verbindung abgerissen') }
    const { provider, engine } = engineWith(Array(12).fill(flaky), { budget: { maxConsecutiveFailures: 3 } })
    const { result } = await runWith(provider, engine)
    expect(provider.turnsUsed).toBe(3)
    expect(result.stopReason).toMatch(/hintereinander|nacheinander|Folge/i)
  })

  it('stoppt, wenn das Token-Budget des GESAMTEN Laufs erschöpft ist', async () => {
    plan(6)
    // Jeder Fake-Turn kostet 120 Token (100 Prompt + 20 Completion).
    const done: FakeTurn = { text: 'Nichts gefunden.' }
    const { provider, engine } = engineWith(Array(20).fill(done), { budget: { maxTotalTokens: 300 } })
    const { result } = await runWith(provider, engine)

    // 300 Token, davon 20 % Synthese-Reserve -> 240 für die Recherche -> 2 Spawns.
    expect(provider.turnsUsed).toBeLessThanOrEqual(3)
    expect(result.stopReason).toMatch(/Budget|Token/i)
    expect(result.totalPromptTokens + result.totalCompletionTokens).toBeLessThanOrEqual(400)
  })

  it('hält eine Reserve zurück, damit die Synthese noch laufen kann', async () => {
    plan(1)
    const script: FakeTurn[] = [
      ...researchScript(repo, projectId, paperUrl, 0),
      // Synthese
      {
        dynamic: () => ({
          toolCalls: [
            {
              name: 'link_claim_to_source',
              arguments: {
                project_id: projectId,
                claim_text: 'Belegte Provenienz ist die Grundlage vertrauenswürdiger Forschung.',
                source_id: repo.listSources(projectId)[0].id,
                quote_span: QUOTE,
                support_type: 'supports',
              },
            },
          ],
        }),
      },
      {
        dynamic: () => ({
          toolCalls: [
            {
              name: 'add_report_version',
              arguments: { project_id: projectId, content_markdown: `# Bericht\n\n${QUOTE} [S1]`.padEnd(80, ' ') },
            },
          ],
        }),
      },
      { text: 'Bericht abgelegt.' },
    ]
    // Bewusst so bemessen, dass der Test etwas UNTERSCHEIDET:
    // 500 Token gesamt, 40 % Reserve -> die Recherche darf 300, die Synthese 500.
    // Die Recherche verbraucht 360 (3 Turns à 120) und liegt damit ÜBER ihrer Grenze.
    // Ohne Reserve wäre die Synthese jetzt gesperrt und es gäbe keinen Bericht.
    const { provider, engine } = engineWith(script, { budget: { maxTotalTokens: 500, synthesisReserve: 0.4 } })
    const { result } = await runWith(provider, engine)

    const spentAfterResearch = 3 * 120
    expect(result.totalPromptTokens + result.totalCompletionTokens).toBeGreaterThan(spentAfterResearch)
    expect(result.reportVersionId).not.toBeNull()
  })

  // ---------------------------------------------------------------- Checkpoint

  it('schreibt einen Lauf-Datensatz und schließt ihn ab', async () => {
    plan(1)
    const { provider, engine } = engineWith([{ text: 'Nichts gefunden.' }, { text: 'Fertig.' }])
    await runWith(provider, engine)

    const runs = repo.listEngineRuns(projectId)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('finished')
    expect(runs[0].ended_at).toBeTruthy()
    expect(runs[0].model).toBe('fake-model')
  })

  it('hinterlässt nach Abbruch einen fortsetzbaren Lauf mit Phase und Runde', async () => {
    plan(2)
    const ctrl = new AbortController()
    const { provider, engine } = engineWith([
      {
        dynamic: () => {
          ctrl.abort()
          return { text: 'abgebrochen mitten drin' }
        },
      },
      { text: 'sollte nicht mehr kommen' },
    ])
    const { result } = await runWith(provider, engine, { signal: ctrl.signal })
    expect(result.stopReason).toMatch(/Abgebrochen/)

    const resumable = repo.getResumableRun(projectId)
    expect(resumable).not.toBeNull()
    expect(resumable!.status).toBe('aborted')
    expect(resumable!.round_index).toBe(1)
  })

  it('erkennt einen Lauf, dessen Prozess gestorben ist — sonst bliebe er ewig "läuft"', () => {
    const run = repo.startEngineRun({ project_id: projectId, model: 'fake-model', resumed_from: null })
    expect(repo.listEngineRuns(projectId)[0].status).toBe('running')

    // Was beim App-Start passiert: kein Prozess kann mehr laufen, also ist 'running' eine Lüge.
    const healed = repo.markRunningAsInterrupted()
    expect(healed).toBe(1)

    const after = repo.listEngineRuns(projectId)[0]
    expect(after.id).toBe(run.id)
    expect(after.status).toBe('interrupted')
    expect(repo.getResumableRun(projectId)?.id).toBe(run.id)
  })

  // ---------------------------------------------------------------- Resume

  it('verweist beim Fortsetzen auf den vorherigen Lauf', async () => {
    plan(1)
    const first = repo.startEngineRun({ project_id: projectId, model: 'fake-model', resumed_from: null })
    repo.endEngineRun(first.id, 'aborted', 'Abgebrochen.')

    const { provider, engine } = engineWith([{ text: 'Nichts gefunden.' }, { text: 'Fertig.' }])
    await runWith(provider, engine, { resume: true })

    const runs = repo.listEngineRuns(projectId)
    expect(runs).toHaveLength(2)
    expect(runs.find((r) => r.id !== first.id)!.resumed_from).toBe(first.id)
  })

  it('nennt dem Modell die abgerufenen, aber undokumentierten Quellen des Vorlaufs', async () => {
    plan(1)
    // Was ein Abbruch zwischen fetch_source und add_source hinterlässt:
    repo.addDocument({
      project_id: projectId,
      url: 'https://example.org/haengengeblieben',
      text: 'Ein Text, der abgerufen, aber nie dokumentiert wurde.',
      content_hash: 'hash',
      purpose: 'Beleg suchen',
      actor: 'engine',
    })
    const prev = repo.startEngineRun({ project_id: projectId, model: 'fake-model', resumed_from: null })
    repo.endEngineRun(prev.id, 'aborted', 'Abgebrochen.')

    const { provider, engine } = engineWith([{ text: 'Verstanden.' }, { text: 'Fertig.' }])
    const { events } = await runWith(provider, engine, { resume: true })

    // Die Aufgabe des ersten Recherche-Spawns muss die offene URL enthalten —
    // sonst läuft das Modell blind in die Abruf-Sperre.
    const task = provider.requests[0].messages.find((m) => m.role === 'user')?.content ?? ''
    expect(task).toContain('haengengeblieben')
    expect(task).toMatch(/exclude_source|add_source/)
    expect(events.some((e) => e.type === 'resumed')).toBe(true)
  })
})

/** Skript, das eine Teilfrage über fetch_source + Offset-Zitat belegt. */
function researchScript(repo: Repo, projectId: string, paperUrl: string, sqIndex: number): FakeTurn[] {
  return [
    { dynamic: () => ({ toolCalls: [{ name: 'fetch_source', arguments: { project_id: projectId, url: paperUrl, purpose: 'Belegquelle abrufen' } }] }) },
    {
      dynamic: (req) => {
        const toolMsg = [...req.messages].reverse().find((m) => m.role === 'tool')
        const parsed = JSON.parse(toolMsg?.content ?? '{}')
        const text: string = parsed.window?.text ?? ''
        const start = (parsed.window?.offset ?? 0) + text.indexOf(QUOTE)
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
}
