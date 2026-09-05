import { createServer, type Server } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo, type ScreeningHitInput } from '../repo'
import { ServiceError, fetchDocument, ingestSearch, recordExclusion } from './research'
import { adoptMinimalBrief } from './brief'
import {
  excludeScreeningCandidate,
  includeScreeningCandidate,
  includeScreeningInProject,
  listScreeningDesk,
  maybeScreeningCandidate,
  waitForScreening,
} from './screening'

const ACTOR = 'test:screening'
const BODY = 'Full text of the screened paper, long enough to sit in the corpus window.'

function hit(over: Partial<ScreeningHitInput> = {}): ScreeningHitInput {
  return {
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani'],
    year: 2017,
    doi: '10.5555/3295222.3295349',
    url: 'https://papers.nips.cc/paper/7181',
    oa_url: null,
    venue: 'NeurIPS',
    abstract: 'The dominant sequence transduction models…',
    cited_by_count: 100_000,
    is_open_access: true,
    found_via: ['openalex'],
    ...over,
  }
}

describe('Sichtungstisch', () => {
  let db: DB
  let repo: Repo
  let projectId: string
  let server: Server
  let origin: string
  const prevPrivate = process.env.RESEARCH_ALLOW_PRIVATE_FETCH

  beforeAll(async () => {
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(BODY)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    if (prevPrivate === undefined) delete process.env.RESEARCH_ALLOW_PRIVATE_FETCH
    else process.env.RESEARCH_ALLOW_PRIVATE_FETCH = prevPrivate
  })

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    projectId = repo.createProject({
      title: 'Sichtung',
      research_question: 'Welche Treffer gehören in den Korpus?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    }).id
    adoptMinimalBrief(repo, projectId, ACTOR)
  })

  afterEach(() => {
    db.close()
  })

  it('legt Treffer einmal an und führt dieselbe DOI zusammen', () => {
    const first = repo.upsertScreeningHits(projectId, [hit({ found_via: ['openalex'] })], {
      query: 'transformer',
      search_log_id: null,
      actor: ACTOR,
    })
    expect(first).toEqual({ inserted: 1, merged: 0 })
    const second = repo.upsertScreeningHits(
      projectId,
      [hit({ url: 'https://doi.org/10.5555/3295222.3295349', found_via: ['crossref'], cited_by_count: 120_000 })],
      { query: 'transformer', search_log_id: null, actor: ACTOR }
    )
    expect(second).toEqual({ inserted: 0, merged: 1 })
    const rows = repo.listScreeningCandidates(projectId)
    expect(rows).toHaveLength(1)
    expect(rows[0].found_via.sort()).toEqual(['crossref', 'openalex'])
    expect(rows[0].cited_by_count).toBe(120_000)
    expect(rows[0].status).toBe('undecided')
  })

  it('identifiziert ohne DOI über die kanonische URL (utm fällt weg)', () => {
    repo.upsertScreeningHits(
      projectId,
      [hit({ doi: null, url: 'https://example.org/paper?utm_source=x' })],
      { query: 'q', search_log_id: null, actor: ACTOR }
    )
    repo.upsertScreeningHits(
      projectId,
      [hit({ doi: null, url: 'https://example.org/paper', found_via: ['websearch'] })],
      { query: 'q', search_log_id: null, actor: ACTOR }
    )
    const rows = repo.listScreeningCandidates(projectId)
    expect(rows).toHaveLength(1)
    expect(rows[0].found_via.sort()).toEqual(['openalex', 'websearch'])
  })

  it('lässt eine entschiedene Karte beim erneuten Upsert grau', () => {
    repo.upsertScreeningHits(projectId, [hit()], { query: 'q', search_log_id: null, actor: ACTOR })
    const id = repo.listScreeningCandidates(projectId)[0].id
    excludeScreeningCandidate(repo, id, 'Trifft den Plan nicht, andere Population.', ACTOR)
    repo.upsertScreeningHits(projectId, [hit({ found_via: ['europepmc'] })], {
      query: 'q2',
      search_log_id: null,
      actor: ACTOR,
    })
    const row = repo.listScreeningCandidates(projectId)[0]
    expect(row.status).toBe('excluded')
    expect(row.found_via).toContain('europepmc')
    expect(row.decision_reason).toMatch(/Plan/)
  })

  it('holt bei Rein den Volltext über oa_url', async () => {
    const oa = `${origin}/oa`
    repo.upsertScreeningHits(projectId, [hit({ oa_url: oa })], { query: 'q', search_log_id: null, actor: ACTOR })
    const id = repo.listScreeningCandidates(projectId)[0].id
    const res = await includeScreeningCandidate(repo, id, ACTOR)
    expect(res.candidate.status).toBe('included')
    expect(res.candidate.document_id).toBe(res.fetch.document_id)
    expect(res.fetch.window.text).toContain('Full text')
    expect(repo.listOpenDocuments(projectId)).toHaveLength(1)
    const again = await fetchDocument(
      repo,
      { project_id: projectId, url: oa, purpose: 'Nach Rein denselben Volltext nochmal lesen.' },
      ACTOR
    )
    expect(again.document_id).toBe(res.fetch.document_id)
  })

  it('schließt mit Grund aus und zieht die Karte nach', () => {
    repo.upsertScreeningHits(
      projectId,
      [hit(), hit({ doi: '10.2/short', url: 'https://example.org/short', title: 'Short' })],
      { query: 'q', search_log_id: null, actor: ACTOR }
    )
    const [keep, short] = repo.listScreeningCandidates(projectId)
    const row = excludeScreeningCandidate(repo, keep.id, 'Irrelevanter Scope, andere Stichprobe.', ACTOR)
    expect(row.status).toBe('excluded')
    expect(repo.listExcludedSources(projectId)).toHaveLength(1)
    expect(() => excludeScreeningCandidate(repo, short.id, 'kurz', ACTOR)).toThrow(/10/)
    expect(() => excludeScreeningCandidate(repo, keep.id, 'Noch ein Grund, der lang genug ist.', ACTOR)).toThrow(
      /schon ausgeschlossen/
    )
  })

  it('merkt Unsicher und listet offene Karten getrennt', () => {
    repo.upsertScreeningHits(
      projectId,
      [hit(), hit({ doi: '10.2/other', url: 'https://example.org/other', title: 'Other' })],
      { query: 'q', search_log_id: null, actor: ACTOR }
    )
    const [a, b] = repo.listScreeningCandidates(projectId)
    maybeScreeningCandidate(repo, a.id, ACTOR)
    excludeScreeningCandidate(repo, b.id, 'Passt nicht zur Einschlussregel des Briefs.', ACTOR)
    const open = listScreeningDesk(repo, projectId, 'open')
    expect(open.counts.maybe).toBe(1)
    expect(open.counts.excluded).toBe(1)
    expect(open.candidates).toHaveLength(1)
    expect(open.candidates[0].status).toBe('maybe')
  })

  it('legt WebSearch-URLs auf den Tisch', () => {
    ingestSearch(
      repo,
      {
        project_id: projectId,
        query: 'transformer pdf',
        urls: ['https://arxiv.org/abs/1706.03762', 'https://example.org/grey'],
      },
      ACTOR
    )
    const rows = repo.listScreeningCandidates(projectId)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.found_via.includes('websearch'))).toBe(true)
    expect(rows.every((r) => r.status === 'undecided')).toBe(true)
  })

  it('sperrt fetch_source auf offenen Karten und auf der DOI derselben Karte', async () => {
    const url = `${origin}/gated`
    repo.upsertScreeningHits(projectId, [hit({ doi: '10.5555/3295222.3295349', url, oa_url: null })], {
      query: 'q',
      search_log_id: null,
      actor: ACTOR,
    })
    await expect(
      fetchDocument(repo, { project_id: projectId, url, purpose: 'Ohne Sichtung die Karte holen.' }, ACTOR)
    ).rejects.toMatchObject({ code: 'screening_required' })
    await expect(
      fetchDocument(
        repo,
        {
          project_id: projectId,
          url: 'https://doi.org/10.5555/3295222.3295349',
          purpose: 'Dieselbe Karte über den DOI-Resolver holen.',
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: 'screening_required' })
    expect(repo.listScreeningCandidates(projectId)[0].status).toBe('undecided')
    expect(repo.listOpenDocuments(projectId)).toHaveLength(0)
  })

  it('sperrt fetch_source auf ausgeschlossenen Karten', async () => {
    const url = `${origin}/out`
    repo.upsertScreeningHits(projectId, [hit({ doi: null, url, oa_url: url })], {
      query: 'q',
      search_log_id: null,
      actor: ACTOR,
    })
    const id = repo.listScreeningCandidates(projectId)[0].id
    excludeScreeningCandidate(repo, id, 'Trifft den Plan nicht, andere Population.', ACTOR)
    await expect(
      fetchDocument(repo, { project_id: projectId, url, purpose: 'Ausgeschlossene Karte trotzdem holen.' }, ACTOR)
    ).rejects.toMatchObject({ code: 'screening_locked' })
  })

  it('zieht exclude_source auf den Tisch nach', () => {
    const other = 'https://example.org/drop'
    repo.upsertScreeningHits(projectId, [hit({ doi: '10.9/drop', url: other, title: 'Drop' })], {
      query: 'q',
      search_log_id: null,
      actor: ACTOR,
    })
    recordExclusion(repo, { project_id: projectId, url: other, title: 'Drop', reason: 'Nicht im Einschluss des Briefs.' }, ACTOR)
    expect(repo.findScreeningCandidate(projectId, { url: other })?.status).toBe('excluded')
  })

  it('weist include_screening ab, wenn die Karte zu einem anderen Projekt gehört', async () => {
    repo.upsertScreeningHits(projectId, [hit()], { query: 'q', search_log_id: null, actor: ACTOR })
    const id = repo.listScreeningCandidates(projectId)[0].id
    await expect(includeScreeningInProject(repo, 'other-project', id, ACTOR, 'Mensch im Chat: nimm diese Karte.')).rejects.toMatchObject(
      { code: 'screening_wrong_project' }
    )
  })

  it('wait_for_screening kehrt sofort zurück, wenn Rein schon da ist', async () => {
    const oa = `${origin}/ready`
    repo.upsertScreeningHits(projectId, [hit({ doi: '10.ready/1', url: oa, oa_url: oa })], {
      query: 'q',
      search_log_id: null,
      actor: ACTOR,
    })
    const id = repo.listScreeningCandidates(projectId)[0].id
    await includeScreeningCandidate(repo, id, ACTOR)
    const res = await waitForScreening(repo, { project_id: projectId, timeout_ms: 800, poll_ms: 20 })
    expect(res.timed_out).toBe(false)
    expect(res.waited_ms).toBeLessThan(200)
    expect(res.decided[0]?.id).toBe(id)
    expect(res.decided[0]?.status).toBe('included')
  })

  it('wait_for_screening sieht eine Sichtung während des Wartens', async () => {
    const oa = `${origin}/live`
    repo.upsertScreeningHits(projectId, [hit({ doi: '10.live/1', url: oa, oa_url: oa })], {
      query: 'q',
      search_log_id: null,
      actor: ACTOR,
    })
    const id = repo.listScreeningCandidates(projectId)[0].id
    const pending = waitForScreening(repo, { project_id: projectId, timeout_ms: 2000, poll_ms: 25 })
    await new Promise((r) => setTimeout(r, 60))
    await includeScreeningCandidate(repo, id, ACTOR, 'Mensch im Chat: nimm diesen Treffer.')
    const res = await pending
    expect(res.timed_out).toBe(false)
    expect(res.decided.some((d) => d.id === id && d.status === 'included')).toBe(true)
  })

  it('wait_for_screening läuft in Timeout, wenn niemand sichtet', async () => {
    repo.upsertScreeningHits(projectId, [hit()], { query: 'q', search_log_id: null, actor: ACTOR })
    const res = await waitForScreening(repo, { project_id: projectId, timeout_ms: 80, poll_ms: 20 })
    expect(res.timed_out).toBe(true)
    expect(res.still_open).toBe(1)
    expect(res.next_action).toMatch(/Zeit abgelaufen/)
  })

  it('sperrt Rein und Unsicher auf ausgeschlossenen Karten', async () => {
    repo.upsertScreeningHits(projectId, [hit()], { query: 'q', search_log_id: null, actor: ACTOR })
    const id = repo.listScreeningCandidates(projectId)[0].id
    excludeScreeningCandidate(repo, id, 'Trifft den Plan nicht, andere Population.', ACTOR)
    expect(() => maybeScreeningCandidate(repo, id, ACTOR)).toThrow(ServiceError)
    await expect(includeScreeningCandidate(repo, id, ACTOR)).rejects.toMatchObject({ code: 'screening_locked' })
    expect(() => excludeScreeningCandidate(repo, id, 'Noch ein Grund, der lang genug ist.', ACTOR)).toThrow(
      /schon ausgeschlossen/
    )
    expect(repo.listExcludedSources(projectId)).toHaveLength(1)
  })

  it('bleibt included ohne Dokument, wenn das Abruf-Kontingent voll ist', async () => {
    for (let i = 0; i < 3; i++) {
      await fetchDocument(
        repo,
        { project_id: projectId, url: `${origin}/open/${i}`, purpose: 'Kontingent mit offener Quelle füllen.' },
        ACTOR
      )
    }
    expect(repo.listOpenDocuments(projectId)).toHaveLength(3)
    const screenUrl = `${origin}/screen`
    repo.upsertScreeningHits(projectId, [hit({ doi: '10.gate/x', url: screenUrl, oa_url: screenUrl })], {
      query: 'q',
      search_log_id: null,
      actor: ACTOR,
    })
    const id = repo.findScreeningCandidate(projectId, { url: screenUrl })!.id
    await expect(includeScreeningCandidate(repo, id, ACTOR)).rejects.toMatchObject({ code: 'open_documents_limit' })
    const row = repo.getScreeningCandidate(id)!
    expect(row.status).toBe('included')
    expect(row.document_id).toBeNull()
  })
})
