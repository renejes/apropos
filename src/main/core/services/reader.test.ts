import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { projectWorkspace } from '../agent/workspace'
import { inspectDocumentOpen } from './reader'
import { ingestUploadedFiles } from './research'
import { buildMinimalPdf } from '../enforce/minimal-pdf'
import { pageForOffset } from '../../../shared/page-offset'

const ACTOR = 'test:reader'

describe('Dokument öffnen (kein Markup)', () => {
  let db: DB
  let repo: Repo
  let root: string
  const prevRoot = process.env.ROP_AGENT_ROOT

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ROP_AGENT_ROOT
    else process.env.ROP_AGENT_ROOT = prevRoot
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const setup = () => {
    db = openDb(':memory:')
    repo = new Repo(db)
    root = mkdtempSync(join(tmpdir(), 'rop-reader-'))
    process.env.ROP_AGENT_ROOT = root
    return repo.createProject({
      title: 'Leser',
      research_question: 'Trägt X?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
  }

  it('Offset einer Fixture-PDF trifft die Seite aus page_starts', async () => {
    const project = setup()
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'paper.pdf'), buildMinimalPdf('Hello page one of the fixture.'))
    const res = await ingestUploadedFiles(repo, project.id, ['paper.pdf'], ACTOR)
    expect(res.errors).toEqual([])
    const doc = repo.getDocument(res.documents[0]!.document_id)!
    expect(doc.page_starts?.length).toBeGreaterThanOrEqual(1)
    expect(pageForOffset(doc.page_starts, 0)).toBe(1)
    const info = inspectDocumentOpen(repo, doc.id)
    expect(info.kind).toBe('pdf')
    expect(info.file_exists).toBe(true)
  })

  it('öffnet den PDF-Viewer nicht für Nicht-PDF', async () => {
    const project = setup()
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'note.txt'), 'Nur Text, kein PDF.')
    const res = await ingestUploadedFiles(repo, project.id, ['note.txt'], ACTOR)
    const info = inspectDocumentOpen(repo, res.documents[0]!.document_id)
    expect(info.kind).not.toBe('pdf')
    expect(info.kind).toBe('text')
  })

  it('fehlende Datei stürzt nicht ab', async () => {
    const project = setup()
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'gone.pdf'), buildMinimalPdf('Temporary file for missing-path test.'))
    const res = await ingestUploadedFiles(repo, project.id, ['gone.pdf'], ACTOR)
    unlinkSync(join(ws, 'inbox', 'gone.pdf'))
    const info = inspectDocumentOpen(repo, res.documents[0]!.document_id)
    expect(info.kind).toBe('missing')
    expect(info.file_exists).toBe(false)
  })

  it('YouTube wird nicht als PDF geöffnet', () => {
    const project = setup()
    const doc = repo.addDocument({
      project_id: project.id,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'Video',
      text: 'Transcript text for the video.',
      content_hash: 'h',
      actor: ACTOR,
      origin: 'youtube',
    })
    const info = inspectDocumentOpen(repo, doc.id)
    expect(info.kind).toBe('youtube')
  })
})
