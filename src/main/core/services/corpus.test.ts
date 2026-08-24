import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import {
  ServiceError,
  fetchDocument,
  ingestUploadedFiles,
  listProjectCorpus,
  readDocumentWindow,
  searchProjectDocuments,
} from './research'
import { adoptMinimalBrief } from './brief'
import { projectWorkspace } from '../agent/workspace'
import { buildMinimalPdf } from '../enforce/minimal-pdf'

const ACTOR = 'test:corpus'
const QUOTE = 'Verifiable provenance is the foundation of trustworthy AI research.'

describe('Korpus: Seed-Upload, Suche, Lesen', () => {
  let db: DB
  let repo: Repo
  let root: string
  const prevRoot = process.env.ROP_AGENT_ROOT
  const prevPrivate = process.env.RESEARCH_ALLOW_PRIVATE_FETCH

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ROP_AGENT_ROOT
    else process.env.ROP_AGENT_ROOT = prevRoot
    if (prevPrivate === undefined) delete process.env.RESEARCH_ALLOW_PRIVATE_FETCH
    else process.env.RESEARCH_ALLOW_PRIVATE_FETCH = prevPrivate
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const setup = () => {
    db = openDb(':memory:')
    repo = new Repo(db)
    root = mkdtempSync(join(tmpdir(), 'rop-corpus-'))
    process.env.ROP_AGENT_ROOT = root
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    return repo.createProject({
      title: 'Korpus',
      research_question: 'Trägt der Seed?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
  }

  it('nimmt PDFs ohne Brief ins Korpus und zählt sie nicht als offene Abrufe', async () => {
    const project = setup()
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'paper.pdf'), buildMinimalPdf(QUOTE))

    const res = await ingestUploadedFiles(repo, project.id, ['paper.pdf'], ACTOR)
    expect(res.errors).toEqual([])
    expect(res.documents).toHaveLength(1)
    expect(repo.listOpenDocuments(project.id)).toHaveLength(0)
    const listed = listProjectCorpus(repo, { project_id: project.id })
    expect(listed.documents).toHaveLength(1)
    expect(listed.documents[0]!.origin).toBe('upload')
    expect(listed.documents[0]!.status).toBe('used')
    expect(listed.documents[0]!.page_starts?.length).toBeGreaterThanOrEqual(1)
  })

  it('findet Stellen per FTS und liefert Offsets', async () => {
    const project = setup()
    adoptMinimalBrief(repo, project.id, ACTOR)
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'note.txt'), `Einleitung.\n${QUOTE}\nSchluss.`)
    await ingestUploadedFiles(repo, project.id, ['note.txt'], ACTOR)

    const found = searchProjectDocuments(repo, { project_id: project.id, query: 'provenance foundation' }, ACTOR)
    expect(found.hits).toHaveLength(1)
    expect(found.hits[0]!.matches.length).toBeGreaterThan(0)
    const hit = found.hits[0]!.matches[0]!
    const doc = repo.getDocument(found.hits[0]!.document_id)!
    expect(doc.text.slice(hit.start, hit.end).toLowerCase()).toContain('provenance')
  })

  it('liest ein Seed-Dokument ohne Pending-Gate', async () => {
    const project = setup()
    adoptMinimalBrief(repo, project.id, ACTOR)
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'note.txt'), `${QUOTE}\n`.repeat(3))
    const uploaded = await ingestUploadedFiles(repo, project.id, ['note.txt'], ACTOR)
    const window = readDocumentWindow(repo, {
      project_id: project.id,
      document_id: uploaded.documents[0]!.document_id,
      offset: 0,
      limit: 800,
    })
    expect(window.window.text).toContain('provenance')
    expect(repo.listOpenDocuments(project.id)).toHaveLength(0)
  })

  it('lehnt search_documents ohne Brief ab', () => {
    const project = setup()
    expect(() => searchProjectDocuments(repo, { project_id: project.id, query: 'anything here' }, ACTOR)).toThrow(ServiceError)
  })

  it('blockiert fetch_source nicht, wenn nur Seed-Dokumente liegen', async () => {
    const project = setup()
    adoptMinimalBrief(repo, project.id, ACTOR)
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'seed.txt'), 'Seed text that must not fill the pending quota for web fetches.')
    await ingestUploadedFiles(repo, project.id, ['seed.txt'], ACTOR)
    expect(repo.listOpenDocuments(project.id)).toHaveLength(0)

    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    const { createServer } = await import('node:http')
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<p>${QUOTE}</p>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    try {
      const doc = await fetchDocument(
        repo,
        { project_id: project.id, url: `http://127.0.0.1:${port}/`, purpose: 'Netzquelle trotz Seed-Korpus abrufen' },
        ACTOR
      )
      expect(doc.document_id).toBeTruthy()
      expect(repo.listOpenDocuments(project.id)).toHaveLength(1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }
  })
})
