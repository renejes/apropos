import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { Repo } from './repo'

describe('Repo (in-memory SQLite)', () => {
  let db: DB
  let repo: Repo

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
  })

  const makeProject = () =>
    repo.createProject({ title: 'Testprojekt', research_question: 'Frage?', mode: 'academic', policy_preset: null, actor: 'test' })

  const makeSource = (projectId: string) =>
    repo.addSource({
      project_id: projectId,
      url: 'https://example.org/page',
      title: 'Beispielquelle',
      retrieval_method: 'test',
      accessed_at: new Date().toISOString(),
      reason: 'Weil sie das Kernargument der Studie dokumentiert.',
      extraction: 'Die Studie zeigt X unter Bedingung Y mit Effektstärke Z.',
      contribution: 'Stützt These 2 des Berichts.',
      verbatim_quote: 'Example Domain. This domain is for use in illustrative examples.',
      quote_locator: null,
      confidence: 'medium',
      actor: 'mcp:test@1.0',
    })

  it('legt Projekte an und listet sie mit Kennzahlen', () => {
    const p = makeProject()
    makeSource(p.id)
    const list = repo.listProjects()
    expect(list).toHaveLength(1)
    expect(list[0].source_count).toBe(1)
    expect(list[0].pending_count).toBe(1)
  })

  it('erzwingt review_status-Übergänge und schreibt Review-Kanten beim Sign-off', () => {
    const p = makeProject()
    const s = makeSource(p.id)
    expect(s.review_status).toBe('pending')

    repo.signSourceHuman(s.id, 'human_signed', 'sieht gut aus', 'human:test')
    const after = repo.getSource(s.id)!
    expect(after.review_status).toBe('human_signed')

    const reviews = repo.listReviews(p.id)
    expect(reviews).toHaveLength(1)
    expect(reviews[0].reviewer_type).toBe('human')
    expect(reviews[0].verdict).toBe('approved')
  })

  it('protokolliert jede Mutation im append-only Event-Log', () => {
    const p = makeProject()
    const s = makeSource(p.id)
    repo.setSourceChecks(s.id, { urlResolved: true, quoteVerified: false, quoteMatchScore: 0.3 }, 'deterministic:test')
    const events = repo.listEvents(p.id)
    const types = events.map((e) => e.event_type)
    expect(types).toContain('project.created')
    expect(types).toContain('source.added')
    expect(types).toContain('source.checked')
  })

  it('setzt pending → ai_checked durch deterministische Checks, lässt human_signed unangetastet', () => {
    const p = makeProject()
    const s = makeSource(p.id)
    repo.signSourceHuman(s.id, 'human_signed', null, 'human:test')
    repo.setSourceChecks(s.id, { urlResolved: true, quoteVerified: true, quoteMatchScore: 1 }, 'deterministic:test')
    expect(repo.getSource(s.id)!.review_status).toBe('human_signed')
  })

  it('verknüpft Claims mit Quellen (many-to-many) und aktualisiert Verifikationsstatus', () => {
    const p = makeProject()
    const s = makeSource(p.id)
    const claim = repo.addClaim({ project_id: p.id, claim_text: 'X gilt unter Y.', report_section: null, actor: 'test' })
    const link = repo.linkClaimToSource({
      claim_id: claim.id,
      source_id: s.id,
      quote_span: 'This domain is for use in illustrative examples.',
      support_type: 'supports',
      confidence: 'high',
      actor: 'test',
    })
    expect(link.verification_status).toBe('pending')
    repo.setLinkVerification(link.id, 'supported', 'high', 'ai_judge:test')
    expect(repo.listLinks(p.id)[0].verification_status).toBe('supported')
  })

  it('erzeugt unveränderliche Berichtsversionen mit eindeutigem Snapshot-Hash', () => {
    const p = makeProject()
    const v1 = repo.addReportVersion({ project_id: p.id, content_markdown: '# Bericht v1 — Inhalt A'.padEnd(60, '.'), actor: 'test' })
    const v2 = repo.addReportVersion({
      project_id: p.id,
      content_markdown: '# Bericht v2 — Inhalt B'.padEnd(60, '.'),
      parent_version_id: v1.id,
      change_summary: 'Update',
      actor: 'test',
    })
    expect(v1.snapshot_hash).not.toBe(v2.snapshot_hash)
    expect(repo.listReportVersions(p.id)).toHaveLength(2)
  })

  it('findet Quellen über FTS5-Volltextsuche', () => {
    const p = makeProject()
    makeSource(p.id)
    const hits = repo.searchSources(p.id, 'Effektstärke')
    expect(hits).toHaveLength(1)
    expect(repo.searchSources(p.id, 'nichtvorhandenesWort')).toHaveLength(0)
  })

  it('aggregiert den vollständigen Projektzustand', () => {
    const p = makeProject()
    const s = makeSource(p.id)
    repo.addExtraction({
      source_id: s.id,
      reasoning_freetext: 'Diese Passage präzisiert die Methodik der Untersuchung.',
      extracted_fact: 'Methode M wurde mit n=100 validiert.',
      verbatim_quote: 'illustrative examples in documents',
      quote_locator: null,
      actor: 'test',
    })
    const state = repo.getProjectState(p.id)
    expect(state.sources).toHaveLength(1)
    expect(state.extractions).toHaveLength(1)
    expect(state.project.id).toBe(p.id)
  })
})
