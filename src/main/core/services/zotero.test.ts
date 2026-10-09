import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { buildMinimalPdf } from '../enforce/minimal-pdf'
import { adoptMinimalBrief } from './brief'
import { recordSource, requireSearchReflection } from './research'
import { exportSignedToZotero, ingestZoteroPdf, searchZotero, zoteroStatus } from './zotero'

describe('Zotero lokal', () => {
  let db: DB
  let repo: Repo
  let projectId: string
  let dir: string
  const ACTOR = 'test:zotero'

  const item = {
    key: 'ABCD2345',
    data: {
      key: 'ABCD2345',
      itemType: 'journalArticle',
      title: 'Attention Is All You Need',
      creators: [{ creatorType: 'author', firstName: 'Ashish', lastName: 'Vaswani' }],
      date: '2017',
      DOI: '10.5555/3295222.3295349',
      extra: 'Citation Key: vaswani2017attention',
      abstractNote: 'The dominant sequence transduction models.',
    },
  }

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
    projectId = repo.createProject({
      title: 'Hausarbeit',
      research_question: 'Was steht in der Bibliothek?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    }).id
    adoptMinimalBrief(repo, projectId, ACTOR)
    dir = mkdtempSync(join(tmpdir(), 'rop-zotero-'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(dir, { recursive: true, force: true })
  })

  function stub(pdfPath?: string) {
    const calls: string[] = []
    let imported = ''
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const u = String(url)
      calls.push(`${init?.method ?? 'GET'} ${u}`)
      if (u.includes('/connector/import') && typeof init?.body === 'string') imported = init.body
      const json = (body: unknown, status = 200) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      })
      if (u.endsWith('/connector/ping')) return json('Zotero Connector Server is available')
      if (u.includes('/children')) {
        return json([
          {
            key: 'PDF23456',
            data: { key: 'PDF23456', itemType: 'attachment', contentType: 'application/pdf', filename: 'paper.pdf' },
          },
        ])
      }
      if (u.includes('/file/view/url')) return json(pdfPath ? pathToFileURL(pdfPath).href : 'file:///missing.pdf')
      if (u.includes('/items/ABCD2345')) return json(item)
      if (u.includes('/items/top')) {
        const q = decodeURIComponent(new URL(u).searchParams.get('q') ?? '')
        if (q.includes('10.5555/3295222.3295349') || q.toLowerCase().includes('attention')) return json([item])
        return json([])
      }
      if (u.includes('/connector/import')) return json({ ok: true })
      throw new Error('unerwartet: ' + u)
    })
    return { calls, imported: () => imported }
  }

  it('meldet, wenn Zotero nicht läuft', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connect ECONNREFUSED')
    })
    const status = await zoteroStatus()
    expect(status.running).toBe(false)
  })

  it('legt Zotero-Treffer auf den Arbeitstisch und sperrt die nächste Suche bis zur Lage', async () => {
    stub()
    const res = await searchZotero(repo, { project_id: projectId, query: 'attention' }, ACTOR)
    expect(res.hits[0]?.citation_key).toBe('vaswani2017attention')
    expect(res.hits[0]?.has_pdf).toBe(true)
    expect(res.hits[0]?.doi).toBe('10.5555/3295222.3295349')
    expect(repo.listScreeningCandidates(projectId)).toHaveLength(1)
    expect(() => requireSearchReflection(repo, projectId)).toThrow(/Lage/)
  })

  it('holt das PDF und behält die Zotero-Citekey an der Quelle', async () => {
    const pdf = join(dir, 'paper.pdf')
    writeFileSync(pdf, buildMinimalPdf('Hello page one of the zotero fixture text.'))
    stub(pdf)
    const ingested = await ingestZoteroPdf(repo, { project_id: projectId, zotero_key: 'ABCD2345' }, ACTOR)
    const doc = repo.getDocument(ingested.document_id)!
    const start = doc.text.indexOf('Hello')
    expect(start).toBeGreaterThanOrEqual(0)
    const end = start + 'Hello page one of the zotero fixture text.'.length
    const recorded = await recordSource(
      repo,
      {
        project_id: projectId,
        url: ingested.source_url,
        title: 'Attention Is All You Need',
        retrieval_method: 'zotero',
        reason: 'Das Paper liegt schon in der Zotero-Bibliothek und trägt die Fragestellung.',
        extraction: 'Transformer ersetzen Rekurrenz durch Self-Attention in Sequenzmodellen.',
        contribution: 'Stützt die Methodenwahl.',
        document_id: ingested.document_id,
        quote_start: start,
        quote_end: end,
        doi: ingested.doi,
      },
      ACTOR
    )
    expect(recorded.source.citekey).toBe('vaswani2017attention')
  })

  it('importiert nur Quellen, die noch nicht in Zotero liegen', async () => {
    const calls = stub()
    const known = repo.addSource({
      project_id: projectId,
      url: 'https://doi.org/10.5555/3295222.3295349',
      title: 'Attention Is All You Need',
      retrieval_method: 'test',
      accessed_at: '2026-08-20T12:00:00.000Z',
      reason: 'Schon in der Bibliothek, nur der Abgleich.',
      extraction: 'Der Eintrag ist über die DOI schon in Zotero vorhanden.',
      contribution: 'Kein zweiter Import.',
      verbatim_quote: 'The dominant sequence transduction models are based on complex recurrent.',
      citekey: 'vaswani2017attention',
      doi: '10.5555/3295222.3295349',
      year: 2017,
      actor: ACTOR,
    })
    const fresh = repo.addSource({
      project_id: projectId,
      url: 'https://example.org/buch',
      title: 'Ein Lehrbuch ohne Treffer',
      retrieval_method: 'test',
      accessed_at: '2026-08-20T12:00:00.000Z',
      reason: 'Das Lehrbuch ist übernommen und soll neu nach Zotero.',
      extraction: 'Es steht noch nicht in der lokalen Bibliothek.',
      contribution: 'Wird importiert.',
      verbatim_quote: 'Ein Satz aus dem Lehrbuch, lang genug für den Beleg.',
      citekey: 'muster2020lehrbuch',
      entry_type: 'book',
      year: 2020,
      actor: ACTOR,
    })
    repo.signSourceHuman(known.id, 'human_signed', 'da', ACTOR)
    repo.signSourceHuman(fresh.id, 'human_signed', 'neu', ACTOR)
    const result = await exportSignedToZotero(repo, projectId)
    expect(result.already).toBe(1)
    expect(result.created).toBe(1)
    expect(calls.calls.some((call) => call.includes('/connector/import'))).toBe(true)
    expect(calls.imported()).toMatch(/@book\{muster2020lehrbuch/)
    expect(calls.imported()).toMatch(/keywords = \{apROPos, Hausarbeit\}/)
    expect(calls.imported()).not.toMatch(/vaswani2017attention/)
  })
})
