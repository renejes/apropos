import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import {
  ServiceError,
  advanceRound,
  computeCoverage,
  ingestSearch,
  linkClaim,
  planResearch,
  recordReportVersion,
  recordExclusion,
  recordSearch,
  recordSource,
} from './research'
import type { SourceKind } from '../../../shared/types'
import { adoptMinimalBrief, adoptResearchBrief, MINIMAL_BRIEF_INPUT } from './brief'

/**
 * Tests der Tiefensteuerung. Bewusst OHNE Netz: recordSource wird nur auf dem
 * Validierungspfad geprüft (der wirft, bevor gefetcht wird); der verifizierte
 * Zustand wird über repo.setSourceChecks simuliert — genau das, was die
 * deterministische Prüfung im Echtbetrieb schreibt.
 */
describe('Recherchetiefe (Teilfragen, Abdeckung, Runden)', () => {
  let db: DB
  let repo: Repo
  const ACTOR = 'test:engine'

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
  })

  const makeProject = () => {
    const p = repo.createProject({ title: 'Testprojekt', research_question: 'Trägt X?', mode: 'academic', policy_preset: null, actor: ACTOR })
    adoptMinimalBrief(repo, p.id, ACTOR)
    return p
  }

  /** Quelle anlegen und optional als "Zitat verifiziert" markieren. */
  const addSource = (
    projectId: string,
    opts: { sq?: string | null; verified?: boolean | null; url?: string; source_kind?: SourceKind; year?: number } = {}
  ) => {
    const src = repo.addSource({
      project_id: projectId,
      url: opts.url ?? `https://example.org/${Math.random().toString(36).slice(2)}`,
      title: 'Beispielquelle',
      retrieval_method: 'test',
      accessed_at: new Date().toISOString(),
      reason: 'Weil sie das Kernargument der Studie dokumentiert.',
      extraction: 'Die Studie zeigt X unter Bedingung Y mit Effektstärke Z.',
      contribution: 'Stützt These 2 des Berichts.',
      verbatim_quote: 'Ein wörtliches Zitat mit ausreichender Länge.',
      sub_question_id: opts.sq ?? null,
      source_kind: opts.source_kind,
      year: opts.year,
      actor: ACTOR,
    })
    if (opts.verified !== undefined) {
      repo.setSourceChecks(src.id, { urlResolved: true, quoteVerified: opts.verified, quoteMatchScore: opts.verified ? 1 : 0.2 }, ACTOR)
    }
    return repo.getSource(src.id)!
  }

  /** Aussage + tragfähige Belegkante — sonst greift die claim_missing-Lücke. */
  const addClaimFor = (projectId: string, sourceId: string, text = 'Zentrale Aussage des Berichts.') =>
    linkClaim(
      repo,
      {
        project_id: projectId,
        claim_text: text,
        source_id: sourceId,
        quote_span: 'Ein wörtliches Zitat mit ausreichender Länge.',
        support_type: 'supports',
      },
      ACTOR
    )

  const plan = (projectId: string, n = 2) =>
    planResearch(
      repo,
      {
        project_id: projectId,
        sub_questions: Array.from({ length: n }, (_, i) => ({ question: `Teilfrage Nummer ${i + 1} zum Sachverhalt?`, min_sources: 1 })),
      },
      ACTOR
    )

  // ---------------------------------------------------------------- Migration

  it('legt sub_question_id auf sources an und steht auf der aktuellen Schema-Version', () => {
    const cols = db.pragma('table_info(sources)') as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toContain('sub_question_id')
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('migriert eine echte v2-Datenbank auf den aktuellen Stand, ohne Daten zu verlieren', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'rop-mig-')), 'v2.db')

    // Echten v2-Stand herstellen: Schema OHNE die v3-Tabellen und ohne sub_question_id.
    const legacy = new Database(file)
    legacy.pragma('journal_mode = WAL')
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, research_question TEXT NOT NULL DEFAULT '',
        mode TEXT NOT NULL DEFAULT 'academic', policy_preset TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE sources (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        url TEXT NOT NULL, title TEXT NOT NULL, retrieval_method TEXT NOT NULL DEFAULT 'unknown', accessed_at TEXT NOT NULL,
        reason TEXT NOT NULL, extraction TEXT NOT NULL, contribution TEXT NOT NULL, verbatim_quote TEXT NOT NULL,
        quote_locator TEXT, quote_verified INTEGER, quote_match_score REAL, url_resolved INTEGER,
        review_status TEXT NOT NULL DEFAULT 'pending', confidence TEXT, created_at TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'unknown');
    `)
    legacy.prepare(`INSERT INTO projects VALUES ('p1','Alt','Frage?','academic',NULL,'2026-01-01','2026-01-01')`).run()
    legacy
      .prepare(
        `INSERT INTO sources (id,project_id,url,title,retrieval_method,accessed_at,reason,extraction,contribution,verbatim_quote,created_at)
         VALUES ('s1','p1','https://example.org/alt','Alte Quelle','test','2026-01-01','r','e','c','q','2026-01-01')`
      )
      .run()
    legacy.pragma('user_version = 2')
    const colsBefore = (legacy.pragma('table_info(sources)') as Array<{ name: string }>).map((c) => c.name)
    legacy.close()
    expect(colsBefore).not.toContain('sub_question_id')

    // Migration läuft beim Öffnen.
    const migrated = openDb(file)
    expect(migrated.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const colsAfter = (migrated.pragma('table_info(sources)') as Array<{ name: string }>).map((c) => c.name)
    expect(colsAfter).toContain('sub_question_id')

    const migRepo = new Repo(migrated)
    expect(migRepo.listSources('p1')).toHaveLength(1)
    expect(migRepo.getSource('s1')?.sub_question_id).toBeNull()
    // Neue Tabellen sind nutzbar
    const sq = migRepo.addSubQuestion({ project_id: 'p1', question: 'Nach der Migration angelegt?', actor: ACTOR })
    expect(migRepo.assignSourceToSubQuestion('s1', sq.id, ACTOR).sub_question_id).toBe(sq.id)
    // v5: auch der Checkpoint muss auf einer migrierten Altdatenbank tragen — sonst
    // scheitert ausgerechnet der Fortsetzen-Pfad bei bestehenden Projekten.
    const run = migRepo.startEngineRun({ project_id: 'p1', model: 'test-modell', resumed_from: null })
    migRepo.endEngineRun(run.id, 'aborted', 'Testabbruch')
    expect(migRepo.getResumableRun('p1')?.id).toBe(run.id)
    const tables = (migrated.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>).map((t) => t.name)
    expect(tables).toContain('visual_versions')
    expect(tables).toContain('marks')
    expect(tables).toContain('documents_fts')
    expect(tables).toContain('search_reflections')
    const docCols = (migrated.pragma('table_info(documents)') as Array<{ name: string }>).map((c) => c.name)
    expect(docCols).toContain('origin')
    const searchCols = (migrated.pragma('table_info(search_log)') as Array<{ name: string }>).map((c) => c.name)
    expect(searchCols).toContain('reflection_id')
    const projectCols = (migrated.pragma('table_info(projects)') as Array<{ name: string }>).map((c) => c.name)
    expect(projectCols).toContain('easy_writing_dir')
    expect(projectCols).toContain('kind')
    expect(tables).toContain('notes')

    // Erneutes Öffnen ist idempotent.
    migrated.close()
    const again = openDb(file)
    expect(again.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    again.close()
    rmSync(file, { force: true })
  })

  // ---------------------------------------------------------------- Planung

  it('plan_research legt Teilfragen an und eröffnet Runde 1', () => {
    const p = makeProject()
    const res = plan(p.id, 3)
    expect(res.sub_questions).toHaveLength(3)
    expect(res.round.round_index).toBe(1)
    expect(res.round.ended_at).toBeNull()
  })

  it('plan_research ist bei Nachplanung idempotent (Duplikate werden übersprungen)', () => {
    const p = makeProject()
    plan(p.id, 2)
    const again = planResearch(
      repo,
      {
        project_id: p.id,
        sub_questions: [
          { question: 'Teilfrage Nummer 1 zum Sachverhalt?' }, // Duplikat
          { question: 'Eine ganz neue Lückenfrage zum Sachverhalt?' },
        ],
      },
      ACTOR
    )
    expect(again.sub_questions).toHaveLength(1)
    expect(repo.listSubQuestions(p.id)).toHaveLength(3)
  })

  it('übernimmt Teilfragen aus dem Brief, wenn die Planung leer ist', () => {
    const p = makeProject()
    const res = planResearch(repo, { project_id: p.id, sub_questions: [] }, ACTOR)
    expect(res.sub_questions.length).toBeGreaterThanOrEqual(3)
  })

  it('lehnt die Planung ohne adoptierten Brief ab', () => {
    const p = repo.createProject({ title: 'Ohne Brief', research_question: 'Trägt X?', mode: 'academic', policy_preset: null, actor: ACTOR })
    expect(() =>
      planResearch(repo, { project_id: p.id, sub_questions: [{ question: 'Eine Teilfrage zum Sachverhalt?' }] }, ACTOR)
    ).toThrow(/adoptierten Research-Brief/)
  })

  // ---------------------------------------------------------------- Abdeckung

  it('meldet fehlende Planung selbst als Lücke', () => {
    const p = makeProject()
    const cov = computeCoverage(repo, p.id)
    expect(cov.ready_for_report).toBe(false)
    expect(cov.gaps.some((g) => g.label === 'Keine Teilfragen geplant')).toBe(true)
  })

  it('zählt nur BELEGTE Quellen zur Abdeckung', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    const sq = sub_questions[0].id

    addSource(p.id, { sq, verified: false }) // Zitat nicht gefunden
    let cov = computeCoverage(repo, p.id)
    expect(cov.ready_for_report).toBe(false)
    // Quelle ist zugeordnet, aber nicht belegt -> "unverified", nicht "uncovered"
    expect(cov.gaps.some((g) => g.kind === 'subquestion_unverified')).toBe(true)
    expect(cov.gaps.some((g) => g.kind === 'source_quote_failed')).toBe(true)

    addSource(p.id, { sq, verified: true })
    cov = computeCoverage(repo, p.id)
    expect(cov.stats.sources_verified).toBe(1)
    // Teilfrage jetzt abgedeckt — die gescheiterte Quelle bleibt aber eine Lücke
    expect(cov.gaps.some((g) => g.kind === 'subquestion_uncovered')).toBe(false)
    expect(cov.gaps.some((g) => g.kind === 'source_quote_failed')).toBe(true)
  })

  it('meldet nicht zugeordnete Quellen als Lücke', () => {
    const p = makeProject()
    plan(p.id, 1)
    addSource(p.id, { verified: true }) // ohne sub_question_id
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'source_unassigned')).toBe(true)
    expect(cov.stats.sources_unassigned).toBe(1)
  })

  it('meldet Aussagen ohne Belegkante', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    addSource(p.id, { sq: sub_questions[0].id, verified: true })
    repo.addClaim({ project_id: p.id, claim_text: 'Unbelegte Behauptung', actor: ACTOR })
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'claim_unlinked')).toBe(true)
    expect(cov.stats.claims_unlinked).toBe(1)
  })

  it('ready_for_report wird true, wenn alle Lücken geschlossen sind', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 2)
    const s1 = addSource(p.id, { sq: sub_questions[0].id, verified: true })
    addSource(p.id, { sq: sub_questions[1].id, verified: true })
    addClaimFor(p.id, s1.id)
    const cov = computeCoverage(repo, p.id)
    expect(cov.blocking_gaps).toHaveLength(0)
    expect(cov.ready_for_report).toBe(true)
  })

  it('meldet zu wenige empirische Quellen aus dem Brief', () => {
    const p = repo.createProject({ title: 'Empirie', research_question: 'Trägt X?', mode: 'academic', policy_preset: null, actor: ACTOR })
    adoptResearchBrief(repo, { project_id: p.id, ...MINIMAL_BRIEF_INPUT, min_empirical: 2, year_from: 2016, year_to: 2026 }, ACTOR)
    const { sub_questions } = plan(p.id, 1)
    const s1 = repo.addSource({
      project_id: p.id,
      url: 'https://example.org/emp',
      title: 'Empirische Studie',
      retrieval_method: 'test',
      accessed_at: new Date().toISOString(),
      reason: 'Weil sie das Kernargument der Studie dokumentiert.',
      extraction: 'Die Studie zeigt X unter Bedingung Y mit Effektstärke Z.',
      contribution: 'Stützt These 2 des Berichts.',
      verbatim_quote: 'Ein wörtliches Zitat mit ausreichender Länge.',
      sub_question_id: sub_questions[0].id,
      source_kind: 'empirical',
      year: 2020,
      actor: ACTOR,
    })
    repo.setSourceChecks(s1.id, { urlResolved: true, quoteVerified: true, quoteMatchScore: 1 }, ACTOR)
    addClaimFor(p.id, s1.id)
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'empirical_shortfall')).toBe(true)
    expect(cov.ready_for_report).toBe(false)
  })

  it('meldet den Brief-Zeitraum, wenn keine belegte Quelle darin liegt', () => {
    const p = repo.createProject({ title: 'Jahre', research_question: 'Trägt X?', mode: 'academic', policy_preset: null, actor: ACTOR })
    adoptResearchBrief(repo, { project_id: p.id, ...MINIMAL_BRIEF_INPUT, year_from: 2016, year_to: 2026 }, ACTOR)
    const { sub_questions } = plan(p.id, 1)
    const s1 = addSource(p.id, { sq: sub_questions[0].id, verified: true })
    addClaimFor(p.id, s1.id)
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'year_range_shortfall')).toBe(true)
  })

  it('schließt den Brief-Zeitraum, wenn eine belegte Quelle darin liegt', () => {
    const p = repo.createProject({ title: 'Jahre-ok', research_question: 'Trägt X?', mode: 'academic', policy_preset: null, actor: ACTOR })
    adoptResearchBrief(repo, { project_id: p.id, ...MINIMAL_BRIEF_INPUT, year_from: 2016, year_to: 2026 }, ACTOR)
    const { sub_questions } = plan(p.id, 1)
    const s1 = addSource(p.id, { sq: sub_questions[0].id, verified: true, year: 2020 })
    addClaimFor(p.id, s1.id)
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'year_range_shortfall')).toBe(false)
  })

  it('schließt empirical_shortfall, sobald genug belegte empirische Quellen da sind', () => {
    const p = repo.createProject({ title: 'Empirie-ok', research_question: 'Trägt X?', mode: 'academic', policy_preset: null, actor: ACTOR })
    adoptResearchBrief(repo, { project_id: p.id, ...MINIMAL_BRIEF_INPUT, min_empirical: 2 }, ACTOR)
    const { sub_questions } = plan(p.id, 1)
    const s1 = addSource(p.id, { sq: sub_questions[0].id, verified: true, source_kind: 'empirical', year: 2020 })
    addSource(p.id, { sq: sub_questions[0].id, verified: true, source_kind: 'empirical', year: 2021 })
    addClaimFor(p.id, s1.id)
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'empirical_shortfall')).toBe(false)
  })

  it('ignoriert abgelehnte Quellen in der Abdeckung', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    const bad = addSource(p.id, { sq: sub_questions[0].id, verified: false })
    repo.setSourceReviewStatus(bad.id, 'rejected', ACTOR)
    const good = addSource(p.id, { sq: sub_questions[0].id, verified: true })
    addClaimFor(p.id, good.id)
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'source_quote_failed')).toBe(false)
    expect(cov.ready_for_report).toBe(true)
  })

  it('meldet belegte Quellen ohne jede Aussage als Lücke', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    addSource(p.id, { sq: sub_questions[0].id, verified: true })
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'claim_missing')).toBe(true)
    expect(cov.ready_for_report).toBe(false)
  })

  // ---------------------------------------------------------------- Runden

  it('erkennt Sättigung und stoppt die Schleife', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 2)
    addSource(p.id, { sq: sub_questions[0].id, verified: true }) // nur 1 neue belegte Quelle

    const res = advanceRound(repo, { project_id: p.id }, ACTOR)
    expect(res.closed_round).toBe(1)
    expect(res.new_verified).toBe(1)
    expect(res.dry).toBe(true) // < Schwelle 2
    expect(res.should_continue).toBe(false)
    expect(res.stop_reason).toMatch(/Sättigung/)
    expect(res.opened_round).toBeNull()
  })

  it('läuft weiter, solange eine Runde ergiebig ist und Lücken offen sind', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 3)
    addSource(p.id, { sq: sub_questions[0].id, verified: true })
    addSource(p.id, { sq: sub_questions[1].id, verified: true })

    const res = advanceRound(repo, { project_id: p.id }, ACTOR)
    expect(res.new_verified).toBe(2)
    expect(res.dry).toBe(false)
    expect(res.should_continue).toBe(true)
    expect(res.opened_round).toBe(2)
    expect(res.coverage.gaps.some((g) => g.kind === 'subquestion_uncovered')).toBe(true)
  })

  it('stoppt bei vollständiger Abdeckung, auch wenn die Runde ergiebig war', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 2)
    const s1 = addSource(p.id, { sq: sub_questions[0].id, verified: true })
    addSource(p.id, { sq: sub_questions[1].id, verified: true })
    addClaimFor(p.id, s1.id)
    const res = advanceRound(repo, { project_id: p.id }, ACTOR)
    expect(res.should_continue).toBe(false)
    expect(res.stop_reason).toMatch(/keine blockierenden Lücken/i)
  })

  it('respektiert den Rundendeckel', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 8)
    // Jede Runde ergiebig halten, damit nur der Deckel greift.
    for (let round = 1; round <= 2; round++) {
      addSource(p.id, { sq: sub_questions[0].id, verified: true })
      addSource(p.id, { sq: sub_questions[1].id, verified: true })
      const res = advanceRound(repo, { project_id: p.id, max_rounds: 2 }, ACTOR)
      if (round === 2) {
        expect(res.should_continue).toBe(false)
        expect(res.stop_reason).toMatch(/Rundendeckel/)
      } else {
        expect(res.should_continue).toBe(true)
      }
    }
  })

  it('lehnt next_round ohne offene Runde ab', () => {
    const p = makeProject()
    expect(() => advanceRound(repo, { project_id: p.id }, ACTOR)).toThrow(/keine offene Recherche-Runde/i)
  })

  // ---------------------------------------------------------------- Berichts-Gate

  const REPORT = 'x'.repeat(60)

  it('verweigert den Bericht, solange Lücken offen sind', () => {
    const p = makeProject()
    plan(p.id, 2)
    try {
      recordReportVersion(repo, { project_id: p.id, content_markdown: REPORT }, ACTOR)
      throw new Error('hätte werfen müssen')
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as ServiceError).code).toBe('coverage_gaps_open')
    }
    expect(repo.listReportVersions(p.id)).toHaveLength(0)
  })

  it('erlaubt den Bericht bei vollständiger Abdeckung', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    const s = addSource(p.id, { sq: sub_questions[0].id, verified: true })
    addClaimFor(p.id, s.id)
    const { version, coverage } = recordReportVersion(repo, { project_id: p.id, content_markdown: REPORT }, ACTOR)
    expect(coverage.ready_for_report).toBe(true)
    expect(version.snapshot_hash).toHaveLength(16)
  })

  it('verlangt eine Begründung, wenn Lücken bewusst quittiert werden', () => {
    const p = makeProject()
    plan(p.id, 1)
    expect(() =>
      recordReportVersion(repo, { project_id: p.id, content_markdown: REPORT, acknowledge_gaps: true }, ACTOR)
    ).toThrow(/gap_acknowledgement/)
  })

  it('hält die Quittierung im Prüfpfad fest', () => {
    const p = makeProject()
    plan(p.id, 1)
    const { version } = recordReportVersion(
      repo,
      {
        project_id: p.id,
        content_markdown: REPORT,
        change_summary: 'Zwischenstand',
        acknowledge_gaps: true,
        gap_acknowledgement: 'Zwischenbericht für die Besprechung; Teilfrage 2 folgt.',
      },
      ACTOR
    )
    // Quittierung steht VORNE — der Export kürzt change_summary, hinten wäre sie verschwunden.
    expect(version.change_summary).toMatch(/^⚠️ MIT 1 OFFENEN LÜCKEN ABGELEGT: Zwischenbericht/)
    const events = repo.listEvents(p.id).map((e) => e.event_type)
    expect(events).toContain('report.gaps_acknowledged')
  })

  // ---------------------------------------------------------------- Validierung

  it('recordSource lehnt unvollständige Provenienz ab, bevor irgendetwas gespeichert wird', async () => {
    const p = makeProject()
    await expect(
      recordSource(repo, { project_id: p.id, url: 'https://example.org/a', title: 'T', reason: 'zu kurz' }, ACTOR)
    ).rejects.toBeInstanceOf(ServiceError)
    expect(repo.listSources(p.id)).toHaveLength(0)
  })

  it('recordSource lehnt eine fremde Teilfrage ab', async () => {
    const a = makeProject()
    const b = makeProject()
    const { sub_questions } = plan(b.id, 1)
    await expect(
      recordSource(
        repo,
        {
          project_id: a.id,
          url: 'https://example.org/a',
          title: 'Titel der Quelle',
          retrieval_method: 'test',
          reason: 'Eine ausreichend lange Begründung für die Quelle.',
          extraction: 'Eine ausreichend lange Extraktion aus der Quelle.',
          contribution: 'Beitrag zum Ergebnis.',
          verbatim_quote: 'Ein wörtliches Zitat mit ausreichender Länge.',
          sub_question_id: sub_questions[0].id,
        },
        ACTOR
      )
    ).rejects.toThrow(/gehört zu Projekt/)
  })

  it('recordSearch lehnt unbekannte Projekte ab', () => {
    expect(() => recordSearch(repo, { project_id: 'gibtsnicht', query: 'test' }, ACTOR)).toThrow(/existiert nicht/)
  })

  // ------------------------------------------------- Regressionen aus dem Review

  /** Vollständig abgedecktes Projekt mit einer belegten Aussage. */
  const completeProject = () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    const src = addSource(p.id, { sq: sub_questions[0].id, verified: true })
    const { link } = addClaimFor(p.id, src.id)
    return { p, sq: sub_questions[0], src, link }
  }

  it('KRITISCH: eine WIDERLEGTE Belegkante blockiert den Bericht, statt die Lücke zu schließen', () => {
    const { p, link } = completeProject()
    expect(computeCoverage(repo, p.id).ready_for_report).toBe(true)

    // Die geblindete Verify-Session widerlegt die einzige Belegkante.
    repo.setLinkVerification(link.id, 'unsupported', 'high', 'judge')

    const cov = computeCoverage(repo, p.id)
    expect(cov.ready_for_report).toBe(false)
    expect(cov.gaps.some((g) => g.kind === 'link_refuted')).toBe(true)
    expect(cov.stats.links_refuted).toBe(1)
    expect(() => recordReportVersion(repo, { project_id: p.id, content_markdown: REPORT }, ACTOR)).toThrow(ServiceError)
  })

  it('source_unreachable blockiert ebenfalls', () => {
    const { p, link } = completeProject()
    repo.setLinkVerification(link.id, 'source_unreachable', null, 'judge')
    expect(computeCoverage(repo, p.id).ready_for_report).toBe(false)
  })

  it('eine NOCH UNGEPRÜFTE Belegkante blockiert NICHT (Verify-Session kommt nach dem Bericht)', () => {
    const { p } = completeProject()
    const cov = computeCoverage(repo, p.id)
    expect(cov.stats.links_pending).toBe(1)
    expect(cov.gaps.some((g) => g.kind === 'link_unverified' && g.blocking === false)).toBe(true)
    expect(cov.ready_for_report).toBe(true) // sonst wäre das Gate nie regulär erfüllbar
  })

  it('menschlicher Sign-off löst eine nicht prüfbare Quelle auf und zählt als Beleg', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    const s = addSource(p.id, { sq: sub_questions[0].id, verified: null }) // PDF/Paywall
    expect(computeCoverage(repo, p.id).gaps.some((g) => g.kind === 'source_quote_unchecked')).toBe(true)

    repo.signSourceHuman(s.id, 'human_signed', 'PDF manuell geprüft', 'mensch')
    addClaimFor(p.id, s.id)

    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'source_quote_unchecked')).toBe(false)
    expect(cov.stats.sources_verified).toBe(1) // Sign-off zählt als Beleg
    expect(cov.ready_for_report).toBe(true)
  })

  it('dieselbe URL zweimal erfüllt min_sources NICHT', () => {
    const p = makeProject()
    const { sub_questions } = planResearch(
      repo,
      { project_id: p.id, sub_questions: [{ question: 'Braucht zwei unabhängige Belege?', min_sources: 2 }] },
      ACTOR
    )
    const sq = sub_questions[0].id
    addSource(p.id, { sq, verified: true, url: 'https://example.org/same' })
    addSource(p.id, { sq, verified: true, url: 'https://example.org/same' })

    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'subquestion_uncovered' || g.kind === 'subquestion_unverified')).toBe(true)

    addSource(p.id, { sq, verified: true, url: 'https://example.org/other' })
    expect(computeCoverage(repo, p.id).gaps.some((g) => g.entity_id === sq)).toBe(false)
  })

  it('eine Aussage wird wieder unbelegt, wenn ihre einzige Quelle abgelehnt wird', () => {
    const { p, src } = completeProject()
    expect(computeCoverage(repo, p.id).ready_for_report).toBe(true)
    repo.signSourceHuman(src.id, 'rejected', 'Quelle unseriös', 'mensch')
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'claim_unlinked')).toBe(true)
    expect(cov.ready_for_report).toBe(false)
  })

  it('alle Teilfragen verworfen = kein vollständiges Projekt', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    repo.setSubQuestionStatus(sub_questions[0].id, 'dropped', 'nicht relevant', ACTOR)
    const cov = computeCoverage(repo, p.id)
    expect(cov.gaps.some((g) => g.kind === 'no_plan')).toBe(true)
    expect(cov.ready_for_report).toBe(false)
  })

  it('sub_questions_covered zählt tatsächliche Abdeckung, nicht das gespeicherte Status-Feld', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 2)
    addSource(p.id, { sq: sub_questions[0].id, verified: true })
    const cov = computeCoverage(repo, p.id)
    expect(cov.stats.sub_questions_active).toBe(2)
    expect(cov.stats.sub_questions_covered).toBe(1) // ohne dass setSubQuestionStatus je lief
  })

  it('next_round ohne jede Aktivität wird abgelehnt (zwei Aufrufe beenden die Recherche nicht)', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 3)
    addSource(p.id, { sq: sub_questions[0].id, verified: true })
    addSource(p.id, { sq: sub_questions[1].id, verified: true })

    const r1 = advanceRound(repo, { project_id: p.id }, ACTOR)
    expect(r1.should_continue).toBe(true)
    // Zweiter Aufruf ohne zwischenzeitliche Arbeit: darf die Recherche nicht beenden.
    expect(() => advanceRound(repo, { project_id: p.id }, ACTOR)).toThrow(/keine Recherche-Aktivität/)
    expect(repo.getLatestRound(p.id)?.ended_at).toBeNull()
  })

  it('Sättigung misst neue Quellen der Runde, nicht das Netto-Delta', () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 4)
    const a = addSource(p.id, { sq: sub_questions[0].id, verified: true })
    addSource(p.id, { sq: sub_questions[1].id, verified: true })
    // Eine ältere Quelle wird abgelehnt — das darf die Runde nicht als "dry" ausweisen.
    repo.signSourceHuman(a.id, 'rejected', 'doch nicht tragfähig', 'mensch')
    addSource(p.id, { sq: sub_questions[2].id, verified: true })

    const res = advanceRound(repo, { project_id: p.id }, ACTOR)
    expect(res.new_verified).toBeGreaterThanOrEqual(2)
    expect(res.dry).toBe(false)
  })

  it('scheiternde Belegkante hinterlässt keinen Waisen-Claim', () => {
    const p = makeProject()
    plan(p.id, 1)
    expect(() =>
      linkClaim(
        repo,
        {
          project_id: p.id,
          claim_text: 'Aussage ohne existierende Quelle',
          source_id: 'gibt-es-nicht',
          quote_span: 'Ein wörtliches Zitat mit ausreichender Länge.',
          support_type: 'supports',
        },
        ACTOR
      )
    ).toThrow()
    expect(repo.listClaims(p.id)).toHaveLength(0)
  })

  it('lehnt parent_version_id aus einem fremden Projekt ab', () => {
    const { p: a } = completeProject()
    const { p: b } = completeProject()
    const vA = recordReportVersion(repo, { project_id: a.id, content_markdown: REPORT }, ACTOR).version
    expect(() =>
      recordReportVersion(repo, { project_id: b.id, content_markdown: REPORT, parent_version_id: vA.id }, ACTOR)
    ).toThrow(/parent_version_id/)
  })

  it('leere sub_question_id wird als "nicht zugeordnet" behandelt, nicht als FK-Fehler', async () => {
    const p = makeProject()
    plan(p.id, 1)
    // Validierung greift vor dem Netzzugriff; entscheidend ist, dass KEIN FK-Fehler kommt.
    await expect(
      recordSource(
        repo,
        {
          project_id: p.id,
          url: 'not-a-url',
          title: 'Titel der Quelle',
          retrieval_method: 'test',
          reason: 'Eine ausreichend lange Begründung für die Quelle.',
          extraction: 'Eine ausreichend lange Extraktion aus der Quelle.',
          contribution: 'Beitrag zum Ergebnis.',
          verbatim_quote: 'Ein wörtliches Zitat mit ausreichender Länge.',
          sub_question_id: '',
        },
        ACTOR
      )
    ).rejects.toThrow(/url/i)
  })

  // ------------------------------------------------- Offset-Zitate (fetch_source)

  const DOC_TEXT =
    'Einleitung ohne Belang. ' + // 0-23
    'Die Studie zeigt einen robusten Effekt unter Bedingung Y. ' +
    'Weiterer Text, der nichts zur Sache tut und nur Länge erzeugt.'
  const QUOTE_START = 24
  const QUOTE_END = 81

  const addDoc = (projectId: string, text = DOC_TEXT) =>
    repo.addDocument({
      project_id: projectId,
      url: 'https://example.org/studie',
      text,
      content_hash: 'abc123',
      purpose: 'Kernquelle für Teilfrage 1',
      actor: ACTOR,
    })

  const sourceArgs = (projectId: string, extra: Record<string, unknown>) => ({
    project_id: projectId,
    url: 'https://example.org/studie',
    title: 'Die Studie',
    retrieval_method: 'fetch_source',
    reason: 'Weil sie das Kernargument der Fragestellung dokumentiert.',
    extraction: 'Die Studie belegt einen robusten Effekt unter Bedingung Y.',
    contribution: 'Stützt Teilfrage 1.',
    ...extra,
  })

  it('schneidet das Zitat serverseitig aus dem Dokument — ohne Netzabruf', async () => {
    const p = makeProject()
    const { sub_questions } = plan(p.id, 1)
    const doc = addDoc(p.id)

    const res = await recordSource(
      repo,
      sourceArgs(p.id, {
        document_id: doc.id,
        quote_start: QUOTE_START,
        quote_end: QUOTE_END,
        sub_question_id: sub_questions[0].id,
      }),
      ACTOR
    )

    expect(res.source.verbatim_quote).toBe(DOC_TEXT.slice(QUOTE_START, QUOTE_END))
    expect(res.checks.quote_verified).toBe(true)
    expect(res.checks.quote_match_score).toBe(1)
    expect(res.source.document_id).toBe(doc.id)
    // Der Prüfpfad hält die Methode fest
    expect(repo.listReviews(p.id).some((r) => r.method === 'offset_exact')).toBe(true)
    // Das Dokument gilt jetzt als dokumentiert
    expect(repo.listOpenDocuments(p.id)).toHaveLength(0)
  })

  it('lehnt ein erfundenes Zitat ab, das nicht an den angegebenen Offsets steht', async () => {
    const p = makeProject()
    const doc = addDoc(p.id)
    await expect(
      recordSource(
        repo,
        sourceArgs(p.id, {
          document_id: doc.id,
          quote_start: QUOTE_START,
          quote_end: QUOTE_END,
          verbatim_quote: 'Die Studie widerlegt jeden Effekt unter Bedingung Y.',
        }),
        ACTOR
      )
    ).rejects.toThrow(/stimmt nicht mit dem Text/)
    expect(repo.listSources(p.id)).toHaveLength(0)
  })

  it('lehnt Offsets außerhalb des Dokuments ab', async () => {
    const p = makeProject()
    const doc = addDoc(p.id)
    await expect(
      recordSource(repo, sourceArgs(p.id, { document_id: doc.id, quote_start: 0, quote_end: 99999 }), ACTOR)
    ).rejects.toThrow(/hinter dem Dokumentende/)
  })

  it('lehnt einen zu kurzen Ausschnitt ab', async () => {
    const p = makeProject()
    const doc = addDoc(p.id)
    await expect(
      recordSource(repo, sourceArgs(p.id, { document_id: doc.id, quote_start: 0, quote_end: 5 }), ACTOR)
    ).rejects.toThrow(/mindestens 20/)
  })

  it('lehnt ein Dokument aus einem fremden Projekt ab', async () => {
    const a = makeProject()
    const b = makeProject()
    const doc = addDoc(b.id)
    await expect(
      recordSource(repo, sourceArgs(a.id, { document_id: doc.id, quote_start: QUOTE_START, quote_end: QUOTE_END }), ACTOR)
    ).rejects.toThrow(/gehört zu Projekt/)
  })

  it('verlangt Offsets, wenn document_id gesetzt ist', async () => {
    const p = makeProject()
    const doc = addDoc(p.id)
    await expect(recordSource(repo, sourceArgs(p.id, { document_id: doc.id }), ACTOR)).rejects.toThrow(/quote_start/)
  })

  it('verlangt ohne document_id weiterhin ein wörtliches Zitat', async () => {
    const p = makeProject()
    await expect(recordSource(repo, sourceArgs(p.id, {}), ACTOR)).rejects.toThrow(/verbatim_quote/)
  })

  it('exclude_source erfüllt die Dokumentationspflicht für ein abgerufenes Dokument', () => {
    const p = makeProject()
    const doc = addDoc(p.id)
    expect(repo.listOpenDocuments(p.id)).toHaveLength(1)
    recordExclusion(repo, { project_id: p.id, url: doc.url, reason: 'Quelle ist ein Blog ohne Belege.' }, ACTOR)
    expect(repo.listOpenDocuments(p.id)).toHaveLength(0)
    expect(repo.getDocument(doc.id)?.status).toBe('excluded')
  })

  it('planResearch entfernt Duplikate auch innerhalb desselben Aufrufs', () => {
    const p = makeProject()
    const res = planResearch(
      repo,
      {
        project_id: p.id,
        sub_questions: [
          { question: 'Dieselbe Frage zum Sachverhalt?' },
          { question: 'Dieselbe Frage zum Sachverhalt?' },
          { question: 'Eine andere Frage zum Sachverhalt?' },
        ],
      },
      ACTOR
    )
    expect(res.sub_questions).toHaveLength(2)
  })
})

describe('Such-Ingest (Hook-Pfad)', () => {
  let db: DB
  let repo: Repo
  const ACTOR = 'hook:cursor-websearch'

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
    delete process.env.ROP_PROJECT_ID
  })

  it('fällt ohne project_id auf das zuletzt aktualisierte Projekt zurück', async () => {
    const older = repo.createProject({ title: 'Alt', research_question: 'a?', mode: 'academic', policy_preset: null, actor: ACTOR })
    await new Promise((r) => setTimeout(r, 15))
    const newer = repo.createProject({ title: 'Neu', research_question: 'b?', mode: 'academic', policy_preset: null, actor: ACTOR })
    expect(older.updated_at < newer.updated_at).toBe(true)
    const entry = ingestSearch(repo, { query: 'transformer attention', provider: 'cursor-websearch', hit_count: 3, urls: ['https://arxiv.org/abs/1706.03762'] }, ACTOR)
    expect(entry.project_id).toBe(newer.id)
    expect(entry.engine).toBe('cursor-websearch')
    expect(entry.results_found).toBe(3)
    expect(entry.note).toMatch(/arxiv\.org/)
  })

  it('respektiert eine explizite project_id und ROP_PROJECT_ID', () => {
    const a = repo.createProject({ title: 'A', research_question: 'a?', mode: 'academic', policy_preset: null, actor: ACTOR })
    const b = repo.createProject({ title: 'B', research_question: 'b?', mode: 'academic', policy_preset: null, actor: ACTOR })
    const explicit = ingestSearch(repo, { project_id: a.id, query: 'explizit' }, ACTOR)
    expect(explicit.project_id).toBe(a.id)
    process.env.ROP_PROJECT_ID = b.id
    const viaEnv = ingestSearch(repo, { query: 'aus env' }, ACTOR)
    expect(viaEnv.project_id).toBe(b.id)
  })

  it('wirft, wenn es kein Projekt gibt', () => {
    expect(() => ingestSearch(repo, { query: 'ohne projekt' }, ACTOR)).toThrow(ServiceError)
    try {
      ingestSearch(repo, { query: 'ohne projekt' }, ACTOR)
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as ServiceError).code).toBe('no_project')
      expect((err as ServiceError).hint).toMatch(/create_project/)
    }
  })
})
