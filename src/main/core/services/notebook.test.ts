import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import { ServiceError, readDocumentWindow, searchProjectDocuments } from './research'
import { createNote, updateNote, groundCitations } from './notes'
import { parseYoutubeVideoId } from './youtube'
import { listArtifacts, readArtifact } from './artifacts'
import { projectWorkspace } from '../agent/workspace'
import { toolsForKind } from '../agent/notebook-tools'

const ACTOR = 'test:notebook'

describe('YouTube-URL', () => {
  it('parst watch, youtu.be, shorts und nackte IDs', () => {
    expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYoutubeVideoId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYoutubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    expect(parseYoutubeVideoId('kein-link')).toBeNull()
  })
})

describe('Notebook: Gates, Notizen, Artefakte', () => {
  let db: DB
  let repo: Repo
  let root: string
  const prevRoot = process.env.ROP_AGENT_ROOT

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ROP_AGENT_ROOT
    else process.env.ROP_AGENT_ROOT = prevRoot
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const setup = (kind: 'research' | 'notebook' = 'notebook') => {
    db = openDb(':memory:')
    repo = new Repo(db)
    root = mkdtempSync(join(tmpdir(), 'rop-nb-'))
    process.env.ROP_AGENT_ROOT = root
    const p = repo.createProject({
      title: kind === 'notebook' ? 'Notebook' : 'Research',
      research_question: kind === 'notebook' ? '' : 'Trägt X?',
      mode: 'academic',
      policy_preset: null,
      kind,
      actor: ACTOR,
    })
    projectWorkspace(p.id, root)
    return p
  }

  it('steht auf Schema v15', () => {
    db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('legt Notebook-Projekte ohne Brief an', () => {
    const p = setup('notebook')
    expect(p.kind).toBe('notebook')
    expect(p.research_question).toBe('')
  })

  it('erlaubt search_documents und read_document ohne Brief', () => {
    const p = setup('notebook')
    const doc = repo.addDocument({
      project_id: p.id,
      url: 'https://example.org/paper',
      title: 'Paper',
      text: 'Offset grounding is required for quotes in notes.',
      content_hash: 'abc',
      actor: ACTOR,
      origin: 'upload',
    })
    const found = searchProjectDocuments(repo, { project_id: p.id, query: 'grounding' }, ACTOR)
    expect(found.hits.length).toBeGreaterThan(0)
    const window = readDocumentWindow(repo, { project_id: p.id, document_id: doc.id, offset: 0, limit: 800 })
    expect(window.window.text).toContain('Offset grounding')
  })

  it('Research ohne Brief bleibt gesperrt', () => {
    const p = setup('research')
    expect(() => searchProjectDocuments(repo, { project_id: p.id, query: 'anything here' }, ACTOR)).toThrow(ServiceError)
  })

  it('schreibt Notizen als Markdown-Datei und schneidet Zitate serverseitig', () => {
    const p = setup('notebook')
    const text = 'Alpha Bravo Charlie Delta Echo'
    const doc = repo.addDocument({
      project_id: p.id,
      url: 'https://example.org/a',
      title: 'A',
      text,
      content_hash: 'h',
      actor: ACTOR,
      origin: 'upload',
    })
    const note = createNote(
      repo,
      {
        project_id: p.id,
        title: 'Kernaussage',
        body_markdown: 'Der Beleg folgt.',
        origin: 'agent',
        citations: [{ document_id: doc.id, quote_start: 0, quote_end: 11 }],
      },
      ACTOR
    )
    expect(note.citations[0]?.quote).toBe('Alpha Bravo')
    const abs = join(root, p.id, 'notes', note.file_name)
    expect(existsSync(abs)).toBe(true)
    expect(readFileSync(abs, 'utf-8')).toContain('# Kernaussage')
    const updated = updateNote(repo, { note_id: note.id, body_markdown: 'Geändert.' }, ACTOR)
    expect(updated.body_markdown).toBe('Geändert.')
  })

  it('lehnt erfundene Offsets ab', () => {
    const p = setup('notebook')
    const doc = repo.addDocument({
      project_id: p.id,
      url: 'https://example.org/a',
      title: 'A',
      text: 'kurz',
      content_hash: 'h',
      actor: ACTOR,
      origin: 'upload',
    })
    expect(() => groundCitations(repo, p.id, [{ document_id: doc.id, quote_start: 0, quote_end: 99 }])).toThrow(/Offsets/)
    expect(() => groundCitations(repo, p.id, [{ document_id: 'fehlt', quote_start: 0, quote_end: 1 }])).toThrow(/liegt nicht/)
  })

  it('listet Artefakte unter artifacts/ und liest HTML', () => {
    const p = setup('notebook')
    const dir = join(root, p.id, 'artifacts')
    writeFileSync(join(dir, 'slides.html'), '<html><body><h1>Folie</h1></body></html>')
    const listed = listArtifacts(p.id)
    expect(listed.some((a) => a.path === 'slides.html' && a.kind === 'html')).toBe(true)
    const file = readArtifact(p.id, 'slides.html')
    expect(file.text).toContain('Folie')
    expect(() => readArtifact(p.id, '../inbox/x')).toThrow()
  })

  it('filtert Notebook-Werkzeuge und hält Research frei von save_note', () => {
    const all = {
      get_project_state: 1,
      search_documents: 1,
      save_note: 1,
      draft_research_brief: 1,
    }
    const nb = toolsForKind(all, 'notebook')
    expect(nb.save_note).toBe(1)
    expect(nb.draft_research_brief).toBeUndefined()
    const rs = toolsForKind(all, 'research')
    expect(rs.save_note).toBeUndefined()
    expect(rs.draft_research_brief).toBe(1)
  })
})
