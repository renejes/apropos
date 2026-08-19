/**
 * End-to-End-Smoke-Test OHNE Electron:
 *  1. Startet einen lokalen Fixture-HTTP-Server mit bekannter Quellseite.
 *  2. Startet den eingebauten MCP-Server (Streamable HTTP) auf einem freien Port.
 *  3. Verbindet einen echten MCP-SDK-Client und fährt den vollen Flow:
 *     create_project → add_source (Quote-Check!) → link_claim_to_source →
 *     add_report_version → re_verify → get_next_unverified_claim → submit_verdict.
 *  4. Spike 4 (Mini): ZWEI Clients schreiben CONCURRENT 20 Quellen ins selbe Projekt.
 *
 * Läuft unter Node-ABI:  npm run smoke
 */
// Fixture-Server läuft auf 127.0.0.1 — SSRF-Guard nur für diesen Test lockern
process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'

import { createServer } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { openDb } from '../src/main/core/db'
import { Repo } from '../src/main/core/repo'
import { startMcpHttpServer } from '../src/main/mcp/http'
import { buildMinimalPdf } from '../src/main/core/enforce/minimal-pdf'

const QUOTE = 'Verifiable provenance is the foundation of trustworthy AI research.'
const FIXTURE_HTML = `<!doctype html><html><head><title>Fixture Paper</title></head>
<body><h1>On Trustworthy AI Research</h1>
<p>Many systems assert correctness without evidence. ${QUOTE} Systems that cannot show
their sources should not be trusted with high-stakes conclusions.</p></body></html>`
const FIXTURE_PDF = buildMinimalPdf(QUOTE)

let failures = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  ✅ ${name}`)
  } else {
    failures++
    console.error(`  ❌ ${name}`, detail ?? '')
  }
}

function parseResult(res: unknown): any {
  const r = res as { content?: Array<{ type: string; text?: string }> }
  const text = r.content?.find((c) => c.type === 'text')?.text
  return text ? JSON.parse(text) : null
}

async function makeClient(url: string, name: string): Promise<Client> {
  const client = new Client({ name, version: '0.0.1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  return client
}

async function main(): Promise<void> {
  // 1. Fixture-Server
  const fixture = createServer((req, res) => {
    if (req.url === '/paper') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(FIXTURE_HTML)
    } else if (req.url === '/paper.pdf') {
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': FIXTURE_PDF.length })
      res.end(FIXTURE_PDF)
    } else {
      res.writeHead(404)
      res.end('not found')
    }
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const fixturePort = (fixture.address() as { port: number }).port
  const paperUrl = `http://127.0.0.1:${fixturePort}/paper`
  const pdfUrl = `http://127.0.0.1:${fixturePort}/paper.pdf`
  console.log(`Fixture-Quelle: ${paperUrl}`)

  // 2. MCP-Server mit Temp-DB
  const dbPath = join(tmpdir(), `rop-smoke-${Date.now()}.db`)
  const db = openDb(dbPath)
  const repo = new Repo(db)
  const mcp = await startMcpHttpServer({ repo, actorLabel: 'smoke' }, 0)
  console.log(`MCP-Server: ${mcp.url}\n`)

  try {
    // 3. Voller Flow mit einem Client
    console.log('— Flow-Test (1 Client) —')
    const client = await makeClient(mcp.url, 'smoke-researcher')

    const tools = await client.listTools()
    check('26 Tools registriert', tools.tools.length >= 26, tools.tools.map((t) => t.name))
    check(
      'Tiefen-Tools vorhanden (plan_research, get_coverage_gaps, next_round, assign_source)',
      ['plan_research', 'get_coverage_gaps', 'next_round', 'assign_source'].every((n) => tools.tools.some((t) => t.name === n)),
      tools.tools.map((t) => t.name)
    )

    const prompts = await client.listPrompts()
    check(
      'MCP-Prompts (research/verify/discuss/extend) vorhanden',
      ['transparent_research', 'verify_session', 'discuss_research', 'extend_research'].every((p) => prompts.prompts.some((x) => x.name === p)),
      prompts.prompts.map((p) => p.name)
    )
    const team = await client.getPrompt({ name: 'transparent_research', arguments: { research_question: 'Testfrage?', parallel_agents: '4' } })
    check('Multi-Agent-Modus im Prompt aktivierbar (parallel_agents)', JSON.stringify(team.messages).includes('MULTI-AGENT-MODUS'))
    const tr = await client.getPrompt({ name: 'transparent_research', arguments: { research_question: 'Testfrage?' } })
    const trText = JSON.stringify(tr.messages)
    check('transparent_research-Prompt enthält Workflow (add_source, log_search, exclude_source)', ['add_source', 'log_search', 'exclude_source'].every((t) => trText.includes(t)))

    const proj = parseResult(
      await client.callTool({
        name: 'create_project',
        arguments: { title: 'Smoke-Research', research_question: 'Funktioniert der Provenienz-Flow?', mode: 'academic' },
      })
    )
    check('create_project liefert project_id', typeof proj?.project_id === 'string')

    // Recherchetiefe: Ohne Teilfragen ist Abdeckung nicht messbar — und der Bericht wird abgelehnt.
    const plan = parseResult(
      await client.callTool({
        name: 'plan_research',
        arguments: {
          project_id: proj.project_id,
          sub_questions: [
            { question: 'Was macht KI-Research-Provenienz vertrauenswürdig?', rationale: 'Kernbegriff der Hauptfrage', min_sources: 1 },
          ],
        },
      })
    )
    const subQuestionId = plan?.created?.[0]?.sub_question_id
    check('plan_research legt Teilfragen an und eröffnet Runde 1', typeof subQuestionId === 'string' && plan?.round === 1, plan)

    const gapsBefore = parseResult(await client.callTool({ name: 'get_coverage_gaps', arguments: { project_id: proj.project_id } }))
    check(
      'get_coverage_gaps meldet die ungedeckte Teilfrage',
      gapsBefore?.ready_for_report === false && gapsBefore?.gaps?.some((g: { kind: string }) => g.kind === 'subquestion_uncovered'),
      gapsBefore?.summary
    )

    // --- fetch_source: eigener Abruf + Offset-Zitat (unfälschbar per Konstruktion)
    const doc = parseResult(
      await client.callTool({
        name: 'fetch_source',
        arguments: { project_id: proj.project_id, url: paperUrl, purpose: 'Kernquelle für die Teilfrage abrufen' },
      })
    )
    check('fetch_source liefert document_id + Textfenster', typeof doc?.document_id === 'string' && doc?.window?.text?.length > 0, {
      char_len: doc?.char_len,
      window: doc?.window?.length,
    })

    const qStart = (doc.window.text as string).indexOf(QUOTE)
    check('Fixture-Zitat im abgerufenen Text gefunden', qStart >= 0)
    const absStart = doc.window.offset + qStart
    const absEnd = absStart + QUOTE.length

    const offsetSource = parseResult(
      await client.callTool({
        name: 'add_source',
        arguments: {
          project_id: proj.project_id,
          url: paperUrl,
          title: 'On Trustworthy AI Research (Offset)',
          retrieval_method: 'fetch_source',
          reason: 'Beleg per Offset aus dem selbst abgerufenen Dokument geschnitten.',
          extraction: 'Verifizierbare Provenienz ist die Grundlage vertrauenswürdiger KI-Research.',
          contribution: 'Stützt die Kernthese des Berichts.',
          document_id: doc.document_id,
          quote_start: absStart,
          quote_end: absEnd,
          sub_question_id: subQuestionId,
        },
      })
    )
    check('add_source per Offset: Zitat serverseitig geschnitten, verifiziert', offsetSource?.checks?.quote_verified === true, offsetSource?.checks)
    check('Offset-Beleg wird als offset_exact auditiert', String(offsetSource?.checks?.note ?? '').startsWith('offset_exact'), offsetSource?.checks?.note)

    // --- PDF: fetch_source extrahiert Text, Offset bleibt unfälschbar
    const pdfDoc = parseResult(
      await client.callTool({
        name: 'fetch_source',
        arguments: { project_id: proj.project_id, url: pdfUrl, purpose: 'PDF-Volltext für Offset-Zitat abrufen' },
      })
    )
    check('fetch_source auf PDF liefert document_id + Text', typeof pdfDoc?.document_id === 'string' && String(pdfDoc?.window?.text ?? '').includes(QUOTE), {
      note: pdfDoc?.hint,
      char_len: pdfDoc?.char_len,
    })
    const pdfStart = String(pdfDoc?.window?.text ?? '').indexOf(QUOTE)
    const pdfAbsStart = (pdfDoc?.window?.offset ?? 0) + pdfStart
    const pdfAdded = parseResult(
      await client.callTool({
        name: 'add_source',
        arguments: {
          project_id: proj.project_id,
          url: pdfUrl,
          title: 'Fixture PDF',
          retrieval_method: 'fetch_source',
          reason: 'Beleg per Offset aus dem selbst abgerufenen PDF geschnitten.',
          extraction: 'Verifizierbare Provenienz ist die Grundlage vertrauenswürdiger KI-Research.',
          contribution: 'PDF-Pfad für akademische Volltexte.',
          document_id: pdfDoc.document_id,
          quote_start: pdfAbsStart,
          quote_end: pdfAbsStart + QUOTE.length,
          sub_question_id: subQuestionId,
        },
      })
    )
    check('add_source per PDF-Offset: quote_verified true', pdfAdded?.checks?.quote_verified === true, pdfAdded?.checks)

    const ingestRes = await fetch(`http://127.0.0.1:${mcp.port}/ingest/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: proj.project_id, query: 'hook ingest smoke', provider: 'cursor-websearch', hit_count: 1 }),
    })
    const ingestJson = (await ingestRes.json()) as { stored?: boolean }
    check('POST /ingest/search protokolliert ohne MCP-Handshake', ingestRes.ok && ingestJson.stored === true)

    // Erfundenes Zitat zu echten Offsets muss scheitern
    const forged = await client
      .callTool({
        name: 'add_source',
        arguments: {
          project_id: proj.project_id,
          url: paperUrl,
          title: 'Gefälschtes Zitat',
          retrieval_method: 'fetch_source',
          reason: 'Test, ob der Server ein erfundenes Zitat zu echten Offsets erkennt.',
          extraction: 'Behauptung, die so nicht im Text steht und erfunden wurde.',
          contribution: 'Darf nicht gespeichert werden.',
          document_id: doc.document_id,
          quote_start: absStart,
          quote_end: absEnd,
          verbatim_quote: 'Diese Aussage steht nachweislich nicht an dieser Stelle im Dokument.',
        },
      })
      .then(
        (r) => r,
        (e) => ({ isError: true, error: e })
      )
    check('erfundenes Zitat zu echten Offsets wird abgelehnt', (forged as { isError?: boolean }).isError === true)

    // Pflichtfeld-Enforcement: add_source ohne verbatim_quote muss scheitern
    const invalid = await client
      .callTool({
        name: 'add_source',
        arguments: { project_id: proj.project_id, url: paperUrl, title: 'Ohne Beleg', retrieval_method: 'test', reason: 'x'.repeat(30), extraction: 'y'.repeat(30), contribution: 'z'.repeat(15) },
      })
      .then(
        (r) => r,
        (e) => ({ isError: true, error: e })
      )
    check('add_source OHNE verbatim_quote wird abgelehnt (Schema-Zwang)', (invalid as { isError?: boolean }).isError === true)

    // Gültige Quelle mit korrektem Zitat → Quote-Check muss greifen
    const good = parseResult(
      await client.callTool({
        name: 'add_source',
        arguments: {
          project_id: proj.project_id,
          url: paperUrl,
          title: 'On Trustworthy AI Research',
          retrieval_method: 'fixture',
          reason: 'Kernquelle: definiert Provenienz als Vertrauensgrundlage für KI-Research.',
          extraction: 'Verifizierbare Provenienz ist die Grundlage vertrauenswürdiger KI-Research.',
          contribution: 'Stützt die Kernthese des Berichts.',
          verbatim_quote: QUOTE,
          confidence: 'high',
          sub_question_id: subQuestionId,
        },
      })
    )
    check('add_source: Quote wird im Quelltext verifiziert', good?.checks?.quote_verified === true, good?.checks)
    check('add_source: Quelle ist der Teilfrage zugeordnet', good?.sub_question_id === subQuestionId, good?.sub_question_id)
    check('add_source: URL wird als erreichbar erkannt', good?.checks?.url_resolved === true, good?.checks)

    // Fabriziertes Zitat → muss als NICHT belegt erkannt werden
    const fabricated = parseResult(
      await client.callTool({
        name: 'add_source',
        arguments: {
          project_id: proj.project_id,
          url: paperUrl,
          title: 'Fabrizierter Beleg',
          retrieval_method: 'fixture',
          reason: 'Negativtest: dieses Zitat steht nicht in der Quelle und muss auffliegen.',
          extraction: 'Diese Behauptung ist frei erfunden und nicht durch die Quelle gedeckt.',
          contribution: 'Testet die Fabrikations-Erkennung.',
          verbatim_quote: 'AI research is always trustworthy without any verification whatsoever, obviously.',
          confidence: 'low',
        },
      })
    )
    check('add_source: fabriziertes Zitat wird erkannt (quote_verified=false)', fabricated?.checks?.quote_verified === false, fabricated?.checks)

    // Suchprozess-Transparenz (PRISMA-S)
    const searchLogged = parseResult(
      await client.callTool({
        name: 'log_search',
        arguments: { project_id: proj.project_id, query: 'trustworthy AI research provenance', engine: 'web_search', results_found: 2 },
      })
    )
    check('log_search protokolliert Suchvorgang', searchLogged?.stored === true)
    const excluded = parseResult(
      await client.callTool({
        name: 'exclude_source',
        arguments: {
          project_id: proj.project_id,
          url: 'https://example.org/irrelevant',
          title: 'Irrelevanter Treffer',
          reason: 'Behandelt ein anderes Thema; kein Bezug zur Forschungsfrage.',
        },
      })
    )
    check('exclude_source dokumentiert begründeten Ausschluss', excluded?.stored === true)

    // Diskussions-Support: FTS-Suche über MCP
    const searchHits = parseResult(
      await client.callTool({ name: 'search_sources', arguments: { project_id: proj.project_id, query: 'Provenienz' } })
    )
    check('search_sources findet Quellen per FTS (read-only)', searchHits?.hits >= 1 && searchHits?.results?.[0]?.marker === '[S1]', searchHits)

    const linked = parseResult(
      await client.callTool({
        name: 'link_claim_to_source',
        arguments: {
          project_id: proj.project_id,
          claim_text: 'Provenienz ist Grundlage vertrauenswürdiger KI-Research.',
          source_id: good.source_id,
          quote_span: QUOTE,
          support_type: 'supports',
          confidence: 'high',
        },
      })
    )
    check('link_claim_to_source legt Claim + Kante an', typeof linked?.link_id === 'string')

    // Berichts-Gate: Die fabrizierte Quelle ist eine offene Lücke — der Server muss ablehnen.
    const REPORT_MD = '## Ergebnis\n\nProvenienz ist die Grundlage vertrauenswürdiger KI-Research [S1]. '.padEnd(80, '.')
    const blocked = await client
      .callTool({
        name: 'add_report_version',
        arguments: { project_id: proj.project_id, content_markdown: REPORT_MD, change_summary: 'Erstfassung' },
      })
      .then(
        (r) => r,
        (e) => ({ isError: true, error: e })
      )
    check('add_report_version wird bei offenen Lücken abgelehnt (Gate)', (blocked as { isError?: boolean }).isError === true)

    // Ohne Begründung darf auch die Quittierung nicht durchgehen.
    const noReason = await client
      .callTool({
        name: 'add_report_version',
        arguments: { project_id: proj.project_id, content_markdown: REPORT_MD, acknowledge_gaps: true },
      })
      .then(
        (r) => r,
        (e) => ({ isError: true, error: e })
      )
    check('acknowledge_gaps ohne Begründung wird abgelehnt', (noReason as { isError?: boolean }).isError === true)

    const report = parseResult(
      await client.callTool({
        name: 'add_report_version',
        arguments: {
          project_id: proj.project_id,
          content_markdown: REPORT_MD,
          change_summary: 'Erstfassung',
          acknowledge_gaps: true,
          gap_acknowledgement: 'Smoke-Test: die fabrizierte Quelle ist absichtlich fehlerhaft.',
        },
      })
    )
    check('add_report_version liefert snapshot_hash (mit begründeter Quittierung)', typeof report?.snapshot_hash === 'string')
    check('Bericht kennt seinen Lückenstand zum Schreibzeitpunkt', report?.coverage_at_write?.ready_for_report === false, report?.coverage_at_write)

    const round = parseResult(
      await client.callTool({ name: 'next_round', arguments: { project_id: proj.project_id, note: 'Smoke-Runde' } })
    )
    check('next_round misst Sättigung und entscheidet über Fortsetzung', round?.closed_round === 1 && typeof round?.should_continue === 'boolean', {
      new_verified: round?.new_verified,
      should_continue: round?.should_continue,
      stop_reason: round?.stop_reason,
    })

    // Geblindeter Verify-Flow — Schleife über Link- UND Source-Items
    console.log('\n— Geblindeter Re-Verify-Pass —')
    const servedItems: any[] = []
    for (let i = 0; i < 5; i++) {
      const next = parseResult(
        await client.callTool({ name: 'get_next_unverified_claim', arguments: { project_id: proj.project_id, verifier_id: 'smoke-judge' } })
      )
      if (next?.done) break
      servedItems.push(next)
      const verdictRes = parseResult(
        await client.callTool({
          name: 'submit_verdict',
          arguments: {
            entity_type: next.entity_type,
            entity_id: next.entity_id,
            reasoning: 'Der Quelltext enthält die Aussage wörtlich; sie wird eindeutig gestützt (bzw. beim Negativ-Item nicht).',
            verdict: 'supported',
            confidence: 'high',
            evidence_span: QUOTE,
            source_snapshot_hash: next.source_snapshot_hash,
            serving_nonce: next.serving_nonce,
            verifier_id: 'smoke-judge',
          },
        })
      )
      check(`submit_verdict #${i + 1} (${next.entity_type}) als GEBLINDET auditiert`, verdictRes?.recorded === true && verdictRes?.audited_as === 'blinded_cross_context', verdictRes)
    }
    check('Verify-Schleife hat Link- UND Source-Items serviert', new Set(servedItems.map((s) => s.entity_type)).size >= 2, servedItems.map((s) => s.entity_type))
    const servedJson = JSON.stringify(servedItems)
    check('Blinding: KEIN serviertes Item enthält reason/contribution', !servedJson.includes('Kernquelle: definiert') && !servedJson.includes('Stützt die Kernthese') && !servedJson.includes('Negativtest: dieses Zitat'))

    // Negativ-Test: Review für nicht-existente Entität muss abgelehnt werden
    const ghost = parseResult(
      await client.callTool({
        name: 'submit_verdict',
        arguments: {
          entity_type: 'source',
          entity_id: 'nicht-existent-0000',
          reasoning: 'Dieser Review darf nicht gespeichert werden, die Entität existiert nicht.',
          verdict: 'supported',
          confidence: 'low',
        },
      })
    )
    check('submit_verdict für Geister-Entität wird abgelehnt', typeof ghost?.error === 'string')

    // Ohne Nonce → ehrliches Audit-Label 'ai_judge_unblinded'
    const unblinded = parseResult(
      await client.callTool({
        name: 'submit_verdict',
        arguments: {
          entity_type: 'source',
          entity_id: good.source_id,
          reasoning: 'Zweiturteil ohne Serving-Nonce — muss als unblinded auditiert werden.',
          verdict: 'supported',
          confidence: 'medium',
        },
      })
    )
    check("Urteil ohne Nonce wird ehrlich als 'ai_judge_unblinded' auditiert", unblinded?.audited_as === 'ai_judge_unblinded', unblinded)

    const state = parseResult(await client.callTool({ name: 'get_project_state', arguments: { project_id: proj.project_id } }))
    check('Reviews enthalten deterministic + ai_judge Kanten', state?.reviews?.some((r: any) => r.reviewer_type === 'deterministic') && state?.reviews?.some((r: any) => r.reviewer_type === 'ai_judge'))
    check('Kein Tool kann human_signed setzen (Status bleibt ai_checked/pending)', state?.sources?.every((s: any) => s.review_status !== 'human_signed'))

    await client.close()

    // 4. Spike 4: Concurrency — 2 Clients × 10 Quellen parallel
    console.log('\n— Spike 4: Multi-Client-Concurrency (2 Clients × 10 Quellen) —')
    const [c1, c2] = await Promise.all([makeClient(mcp.url, 'client-A'), makeClient(mcp.url, 'client-B')])
    const proj2 = parseResult(
      await c1.callTool({ name: 'create_project', arguments: { title: 'Concurrency-Test', research_question: 'Halten 2 Clients concurrent?', mode: 'business' } })
    )

    const writeSource = (c: Client, label: string, i: number) =>
      c.callTool({
        name: 'add_source',
        arguments: {
          project_id: proj2.project_id,
          url: paperUrl,
          title: `Quelle ${label}-${i}`,
          retrieval_method: 'fixture',
          reason: `Concurrency-Testquelle ${label}-${i}: prüft parallele Schreibzugriffe.`,
          extraction: `Extraktion ${label}-${i}: verifizierbare Provenienz ist die Vertrauensgrundlage.`,
          contribution: `Beitrag ${label}-${i} zum Stresstest.`,
          verbatim_quote: QUOTE,
        },
      })

    const t0 = Date.now()
    const results = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => writeSource(c1, 'A', i)),
      ...Array.from({ length: 10 }, (_, i) => writeSource(c2, 'B', i)),
    ])
    const dt = Date.now() - t0
    const okCount = results.map(parseResult).filter((r) => r?.stored === true && r?.checks?.quote_verified === true).length
    check(`20/20 concurrent add_source erfolgreich + verifiziert (${dt} ms)`, okCount === 20, { okCount })

    const state2 = parseResult(await c2.callTool({ name: 'get_project_state', arguments: { project_id: proj2.project_id, include: ['sources'] } }))
    check('Keine verlorenen Schreibzugriffe (20 Quellen in DB)', state2?.sources?.length === 20, state2?.sources?.length)
    check('Beide Client-Identitäten im Audit-Trail', new Set(state2?.sources?.map((s: any) => s.created_by)).size === 2)

    await Promise.all([c1.close(), c2.close()])
  } finally {
    await mcp.close()
    fixture.close()
    db.close()
    try {
      rmSync(dbPath)
      rmSync(dbPath + '-wal', { force: true })
      rmSync(dbPath + '-shm', { force: true })
    } catch {
      /* egal */
    }
  }

  console.log(failures === 0 ? '\n🎉 Smoke-Test: alle Checks grün.' : `\n💥 Smoke-Test: ${failures} Check(s) fehlgeschlagen.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Smoke-Test fatal:', err)
  process.exit(1)
})
