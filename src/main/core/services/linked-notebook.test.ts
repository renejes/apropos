import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import {
  ServiceError,
  ingestUploadedFiles,
  ingestLocalFile,
  listProjectCorpus,
  readDocumentWindow,
  searchProjectDocuments,
  requireAdoptedBrief,
} from './research'
import { createProject, createNotebookFromResearch, deleteProject, linkNotebookToResearch, loadProjectState } from './projects'
import { createNote } from './notes'
import { projectWorkspace } from '../agent/workspace'
import { toolsForKind } from '../agent/notebook-tools'
import { inspectDocumentOpen } from './reader'

const ACTOR = 'test:linked-nb'

describe('Notebook aus Research (lebender Korpus)', () => {
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
    root = mkdtempSync(join(tmpdir(), 'rop-link-'))
    process.env.ROP_AGENT_ROOT = root
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  }

  it('unlinked Notebook behält den eigenen leeren Korpus', () => {
    setup()
    const nb = createProject(repo, {
      title: 'Klassisch',
      research_question: '',
      mode: 'academic',
      kind: 'notebook',
      actor: ACTOR,
    })
    expect(nb.linked_research_id).toBeNull()
    expect(listProjectCorpus(repo, { project_id: nb.id }).documents).toHaveLength(0)
    requireAdoptedBrief(repo, nb.id)
  })

  it('liest den Research-Korpus live, lehnt Ingest ab, speichert Notizen im Notebook', async () => {
    setup()
    const research = createProject(repo, {
      title: 'Studie',
      research_question: 'Trägt X?',
      mode: 'academic',
      kind: 'research',
      actor: ACTOR,
    })
    const ws = projectWorkspace(research.id, root)
    writeFileSync(join(ws, 'inbox', 'seed.txt'), 'Offset grounding lives in the research corpus for notebooks.')
    await ingestUploadedFiles(repo, research.id, ['seed.txt'], ACTOR)

    const nb = createNotebookFromResearch(repo, research.id, ACTOR)
    expect(nb.kind).toBe('notebook')
    expect(nb.linked_research_id).toBe(research.id)
    expect(nb.title).toContain('Studie')

    const listed = listProjectCorpus(repo, { project_id: nb.id })
    expect(listed.documents).toHaveLength(1)
    const docId = listed.documents[0]!.id
    expect(repo.getDocument(docId)?.project_id).toBe(research.id)

    const found = searchProjectDocuments(repo, { project_id: nb.id, query: 'grounding' }, ACTOR)
    expect(found.hits.length).toBeGreaterThan(0)

    const window = readDocumentWindow(repo, { project_id: nb.id, document_id: docId, offset: 0, limit: 800 })
    expect(window.window.text).toContain('Offset grounding')

    await expect(ingestUploadedFiles(repo, nb.id, ['seed.txt'], ACTOR)).rejects.toMatchObject({ code: 'corpus_owned_by_research' })
    await expect(
      ingestLocalFile(repo, { project_id: nb.id, filename: 'seed.txt', purpose: 'Sollte im Notebook scheitern.' }, ACTOR)
    ).rejects.toBeInstanceOf(ServiceError)

    const note = createNote(
      repo,
      {
        project_id: nb.id,
        title: 'Aus Research',
        body_markdown: 'Beleg.',
        origin: 'human',
        citations: [{ document_id: docId, quote_start: 0, quote_end: 16 }],
      },
      ACTOR
    )
    expect(note.citations[0]?.quote.length).toBeGreaterThan(0)
    const notePath = join(root, nb.id, 'notes', note.file_name)
    expect(existsSync(notePath)).toBe(true)
    expect(readFileSync(notePath, 'utf-8')).toContain('# Aus Research')

    writeFileSync(join(ws, 'inbox', 'neu.txt'), 'Eine neue Quelle im Research erscheint im Notebook.')
    await ingestUploadedFiles(repo, research.id, ['neu.txt'], ACTOR)
    expect(listProjectCorpus(repo, { project_id: nb.id }).documents).toHaveLength(2)

    const open = inspectDocumentOpen(repo, docId)
    expect(open.kind).toBe('text')

    expect(() => deleteProject(repo, research.id, ACTOR)).toThrow(/verknüpfte Notebooks/)
    expect(repo.getProject(research.id)).toBeTruthy()

    const state = loadProjectState(repo, nb.id)
    expect(state.linked_research?.id).toBe(research.id)
    expect(state.documents).toHaveLength(2)
  })

  it('verknüpft nur leere Notebooks und lehnt Research-Gates im Notebook ab', async () => {
    setup()
    const research = createProject(repo, {
      title: 'R',
      research_question: 'Trägt X?',
      mode: 'academic',
      actor: ACTOR,
    })
    const filled = createProject(repo, {
      title: 'Hat Korpus',
      research_question: '',
      mode: 'academic',
      kind: 'notebook',
      actor: ACTOR,
    })
    const fws = projectWorkspace(filled.id, root)
    writeFileSync(join(fws, 'inbox', 'own.txt'), 'Eigenes Dokument im Notebook.')
    await ingestUploadedFiles(repo, filled.id, ['own.txt'], ACTOR)
    expect(() => linkNotebookToResearch(repo, filled.id, research.id, ACTOR)).toThrow(/eigene Dokumente/)

    const empty = createProject(repo, {
      title: 'Leer',
      research_question: '',
      mode: 'academic',
      kind: 'notebook',
      actor: ACTOR,
    })
    const linked = linkNotebookToResearch(repo, empty.id, research.id, ACTOR)
    expect(linked.linked_research_id).toBe(research.id)

    requireAdoptedBrief(repo, empty.id)
    const rs = toolsForKind(
      {
        list_corpus: 1,
        save_note: 1,
        draft_research_brief: 1,
        plan_research: 1,
        export_bibliography: 1,
      },
      'notebook'
    )
    expect(rs.draft_research_brief).toBeUndefined()
    expect(rs.plan_research).toBeUndefined()
    expect(rs.list_corpus).toBe(1)
    expect(rs.save_note).toBe(1)
  })
})
