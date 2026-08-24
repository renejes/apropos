import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import {
  ServiceError,
  ingestSearch,
  recordSearch,
  reflectSearch,
  searchProjectDocuments,
  fetchDocument,
  ingestUploadedFiles,
  readDocumentWindow,
} from './research'
import { searchLiterature } from './literature'
import { adoptMinimalBrief } from './brief'
import { projectWorkspace } from '../agent/workspace'

const ACTOR = 'test:reflect'
const COVERED = 'Die Treffer bedienen die Methodenfrage zum Offset-Zitat im Brief-Ziel.'
const GAPS = 'Gegenüber dem Ziel fehlen Gegenpositionen und die historische Einordnung.'
const WHY_READ = 'Die Titel reichen nicht; erst die Volltexte lesen, bevor eine neue Facette gesucht wird.'
const WHY_SEARCH = 'Die Methodenfrage ist grob getroffen; als Nächstes die Gegenposition gezielt suchen.'
const WHY_ENOUGH = 'Diese Facette ist für das Brief-Ziel bedient, weil der Mechanismus in den Titeln klar ist.'

describe('Such-Lage (reflect_search)', () => {
  let db: DB
  let repo: Repo
  let projectId: string
  let root: string
  const prevRoot = process.env.ROP_AGENT_ROOT

  afterEach(() => {
    vi.unstubAllGlobals()
    if (prevRoot === undefined) delete process.env.ROP_AGENT_ROOT
    else process.env.ROP_AGENT_ROOT = prevRoot
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const setup = () => {
    db = openDb(':memory:')
    repo = new Repo(db)
    root = mkdtempSync(join(tmpdir(), 'rop-reflect-'))
    process.env.ROP_AGENT_ROOT = root
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const project = repo.createProject({
      title: 'Lage',
      research_question: 'Trägt die Such-Lage?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    projectId = project.id
    adoptMinimalBrief(repo, projectId, ACTOR)
    return project
  }

  it('erlaubt log_search weiterhin; search_documents ist nach einer Welle geblockt', () => {
    setup()
    recordSearch(repo, { project_id: projectId, query: 'offset quote provenance', engine: 'web', results_found: 4 }, ACTOR)
    recordSearch(repo, { project_id: projectId, query: 'zweite dokumentation', engine: 'web', results_found: 1 }, ACTOR)
    expect(repo.listUnreflectedSearches(projectId)).toHaveLength(2)
    expect(() => searchProjectDocuments(repo, { project_id: projectId, query: 'offset' }, ACTOR)).toThrow(ServiceError)
    try {
      searchProjectDocuments(repo, { project_id: projectId, query: 'offset' }, ACTOR)
    } catch (err) {
      expect((err as ServiceError).code).toBe('search_reflection_required')
      expect((err as ServiceError).hint).toMatch(/reflect_search/)
    }
  })

  it('Korpus-Suche: erste Welle ok, zweite erst nach Lage, Lesen bleibt frei', async () => {
    setup()
    const ws = projectWorkspace(projectId, root)
    writeFileSync(join(ws, 'inbox', 'note.txt'), 'Verifiable provenance is the foundation of trustworthy AI research.')
    await ingestUploadedFiles(repo, projectId, ['note.txt'], ACTOR)

    const first = searchProjectDocuments(repo, { project_id: projectId, query: 'provenance foundation' }, ACTOR)
    expect(first.hits.length).toBeGreaterThan(0)
    expect(first.next_action).toMatch(/reflect_search/)
    expect(repo.listSearchLog(projectId).some((s) => s.engine === 'corpus')).toBe(true)

    try {
      searchProjectDocuments(repo, { project_id: projectId, query: 'trustworthy' }, ACTOR)
      throw new Error('erwartete search_reflection_required')
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as ServiceError).code).toBe('search_reflection_required')
    }

    const window = readDocumentWindow(repo, {
      project_id: projectId,
      document_id: first.hits[0]!.document_id,
      offset: 0,
      limit: 800,
    })
    expect(window.window.text).toMatch(/provenance/i)

    const reflected = reflectSearch(
      repo,
      {
        project_id: projectId,
        covered: COVERED,
        underrepresented: GAPS,
        next_action: 'search',
        next_query: 'historical reviews of provenance in AI research',
        reason: WHY_SEARCH,
      },
      ACTOR
    )
    expect(reflected.reflection.next_action).toBe('search')
    expect(reflected.reflection.next_query).toBe('historical reviews of provenance in AI research')
    expect(reflected.attached_search_ids.length).toBeGreaterThan(0)
    expect(repo.listUnreflectedSearches(projectId)).toHaveLength(0)

    const second = searchProjectDocuments(repo, { project_id: projectId, query: 'trustworthy' }, ACTOR)
    expect(second.query).toBe('trustworthy')
  })

  it('next_action=enough speichert keine Query', () => {
    setup()
    recordSearch(repo, { project_id: projectId, query: 'erste suche mit treffern', engine: 'web', results_found: 2 }, ACTOR)

    try {
      reflectSearch(
        repo,
        {
          project_id: projectId,
          covered: COVERED,
          underrepresented: GAPS,
          next_action: 'enough',
          next_query: 'sollte nicht gehen',
          reason: WHY_ENOUGH,
        },
        ACTOR
      )
      throw new Error('erwartete next_query_forbidden')
    } catch (err) {
      expect((err as ServiceError).code).toBe('next_query_forbidden')
    }

    const enough = reflectSearch(
      repo,
      { project_id: projectId, covered: COVERED, underrepresented: GAPS, next_action: 'enough', reason: WHY_ENOUGH },
      ACTOR
    )
    expect(enough.reflection.next_query).toBeNull()
    expect(enough.hint).toMatch(/Facette reicht/)
  })

  it('next_action=read mit Query wird abgelehnt', () => {
    setup()
    recordSearch(repo, { project_id: projectId, query: 'welle eins', engine: 'web', results_found: 1 }, ACTOR)
    try {
      reflectSearch(
        repo,
        {
          project_id: projectId,
          covered: COVERED,
          underrepresented: GAPS,
          next_action: 'read',
          next_query: 'nicht jetzt suchen',
          reason: WHY_READ,
        },
        ACTOR
      )
      throw new Error('erwartete next_query_forbidden')
    } catch (err) {
      expect((err as ServiceError).code).toBe('next_query_forbidden')
    }
  })

  it('next_action=search ohne next_query wird abgelehnt — der Code erfindet keine Query', () => {
    setup()
    recordSearch(repo, { project_id: projectId, query: 'welle eins', engine: 'web', results_found: 1 }, ACTOR)
    try {
      reflectSearch(
        repo,
        { project_id: projectId, covered: COVERED, underrepresented: GAPS, next_action: 'search', reason: WHY_SEARCH },
        ACTOR
      )
      throw new Error('erwartete next_query_required')
    } catch (err) {
      expect((err as ServiceError).code).toBe('next_query_required')
    }
  })

  it('ingestSearch (WebSearch-Hook) erzeugt dieselbe Pflicht wie search_literature', async () => {
    setup()
    ingestSearch(repo, { project_id: projectId, query: 'cursor websearch welle', provider: 'cursor-websearch', hit_count: 3 }, ACTOR)
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
      text: async () => '{}',
    }))
    await expect(
      searchLiterature(repo, { project_id: projectId, query: 'zweite literature suche', backends: ['openalex'] }, ACTOR)
    ).rejects.toMatchObject({ code: 'search_reflection_required' })
  })

  it('fetch_source bleibt nach einer Suche ohne Lage erlaubt', async () => {
    setup()
    ingestSearch(repo, { project_id: projectId, query: 'darf trotzdem lesen', hit_count: 1 }, ACTOR)
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    const { createServer } = await import('node:http')
    const quote = 'Verifiable provenance is the foundation of trustworthy AI research.'
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<p>${quote}</p>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    try {
      const doc = await fetchDocument(
        repo,
        { project_id: projectId, url: `http://127.0.0.1:${port}/paper`, purpose: 'Lesen nach der Suche bleibt erlaubt.' },
        ACTOR
      )
      expect(doc.window.text).toContain('provenance')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      delete process.env.RESEARCH_ALLOW_PRIVATE_FETCH
    }
  })

  it('lehnt reflect_search ohne unbewertete Suche ab', () => {
    setup()
    try {
      reflectSearch(
        repo,
        { project_id: projectId, covered: COVERED, underrepresented: GAPS, next_action: 'read', reason: WHY_READ },
        ACTOR
      )
      throw new Error('erwartete nothing_to_reflect')
    } catch (err) {
      expect((err as ServiceError).code).toBe('nothing_to_reflect')
    }
  })
})
