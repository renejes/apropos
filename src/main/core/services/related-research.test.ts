import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import { ServiceError, ingestUploadedFiles, recordSource } from './research'
import {
  addRelatedResearch,
  importRelatedSource,
  listRelatedResearch,
  listRelatedSummaries,
  readRelatedDocument,
  removeRelatedResearch,
} from './related-research'
import { createProject, deleteProject, loadProjectState } from './projects'
import { projectWorkspace } from '../agent/workspace'
import { adoptMinimalBrief } from './brief'

const ACTOR = 'test:related'

describe('Verwandte Research-Projekte', () => {
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
    root = mkdtempSync(join(tmpdir(), 'rop-rel-'))
    process.env.ROP_AGENT_ROOT = root
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const part1 = repo.createProject({
      title: 'Hausarbeit Teil 1',
      research_question: 'Was ist X?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    const part2 = repo.createProject({
      title: 'Hausarbeit Teil 2',
      research_question: 'Wie wirkt Y?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    return { part1, part2 }
  }

  it('verknüpft nur Research mit Research, nicht mit sich selbst', () => {
    const { part1, part2 } = setup()
    const nb = createProject(repo, {
      title: 'Notizbuch',
      research_question: '',
      mode: 'academic',
      kind: 'notebook',
      actor: ACTOR,
    })
    expect(() => addRelatedResearch(repo, part1.id, nb.id, ACTOR)).toThrow(ServiceError)
    expect(() => addRelatedResearch(repo, part1.id, part1.id, ACTOR)).toThrow(ServiceError)
    const linked = addRelatedResearch(repo, part2.id, part1.id, ACTOR, true)
    expect(linked.added).toBe(true)
    expect(linked.related.map((r) => r.project_id)).toEqual([part1.id])
    expect(listRelatedSummaries(repo, part1.id).map((r) => r.project_id)).toEqual([part2.id])
  })

  it('lässt den Agenten signierte Quellen und Seed-PDFs des anderen Projekts lesen, nicht zitieren', async () => {
    const { part1, part2 } = setup()
    adoptMinimalBrief(repo, part2.id, ACTOR)
    const ws = projectWorkspace(part1.id, root)
    writeFileSync(join(ws, 'inbox', 'seed.txt'), 'Alpha-Theorie belegt den Zusammenhang zwischen X und Y im Seminar.')
    const ingested = await ingestUploadedFiles(repo, part1.id, ['seed.txt'], ACTOR)
    const docId = ingested.documents[0]!.document_id
    const doc = repo.getDocument(docId)!
    const quote = doc.text.slice(0, 80)
    const src = repo.addSource({
      project_id: part1.id,
      url: doc.url,
      title: 'Seed-Paper',
      retrieval_method: 'upload',
      accessed_at: new Date().toISOString(),
      reason: 'Kernbeleg für Teil 1 der Hausarbeit mit ausreichender Länge.',
      extraction: 'X hängt mit Y zusammen.',
      contribution: 'Stützt die Theorie in Teil 1.',
      verbatim_quote: quote,
      document_id: doc.id,
      quote_start: 0,
      quote_end: quote.length,
      actor: ACTOR,
    })
    repo.signSourceHuman(src.id, 'human_signed', null, ACTOR)

    expect(() => readRelatedDocument(repo, { project_id: part2.id, document_id: doc.id })).toThrow(ServiceError)

    addRelatedResearch(repo, part2.id, part1.id, ACTOR)
    const listed = listRelatedResearch(repo, { project_id: part2.id, query: 'Alpha-Theorie' })
    expect(listed.related).toHaveLength(1)
    expect(listed.sources).toHaveLength(1)
    expect(listed.sources[0]!.source_id).toBe(src.id)
    expect(listed.hits.length).toBeGreaterThan(0)

    const window = readRelatedDocument(repo, { project_id: part2.id, document_id: doc.id })
    expect(window.window.text).toContain('Alpha-Theorie')
    expect(window.hint).toMatch(/NICHT add_source/)

    await expect(
      recordSource(
        repo,
        {
          project_id: part2.id,
          url: doc.url,
          title: 'Unerlaubte Fremd-ID',
          retrieval_method: 'test',
          accessed_at: new Date().toISOString(),
          reason: 'Versuch, eine fremde document_id direkt zu zitieren in Teil 2.',
          extraction: 'Dieser Aufruf muss an der fremden document_id scheitern.',
          contribution: 'Negativtest.',
          verbatim_quote: quote,
          document_id: doc.id,
          quote_start: 0,
          quote_end: quote.length,
        },
        ACTOR
      )
    ).rejects.toMatchObject({ code: 'document_project_mismatch' })
  })

  it('kopiert eine übernommene Quelle als pending in das aktuelle Projekt', async () => {
    const { part1, part2 } = setup()
    const ws = projectWorkspace(part1.id, root)
    writeFileSync(join(ws, 'inbox', 'note.txt'), 'Verifiable provenance is the foundation of trustworthy AI research across chapters.')
    const ingested = await ingestUploadedFiles(repo, part1.id, ['note.txt'], ACTOR)
    const doc = repo.getDocument(ingested.documents[0]!.document_id)!
    const quote = doc.text.slice(0, 60)
    const src = repo.addSource({
      project_id: part1.id,
      url: doc.url,
      title: 'Provenienz-Text',
      retrieval_method: 'upload',
      accessed_at: new Date().toISOString(),
      reason: 'Belegt Provenienz über Kapitelgrenzen hinweg mit genug Text.',
      extraction: 'Provenienz ist die Grundlage.',
      contribution: 'Kapitel 1.',
      verbatim_quote: quote,
      document_id: doc.id,
      quote_start: 0,
      quote_end: quote.length,
      citekey: 'prov2026',
      actor: ACTOR,
    })
    repo.signSourceHuman(src.id, 'human_signed', null, ACTOR)
    addRelatedResearch(repo, part2.id, part1.id, ACTOR)

    const imported = importRelatedSource(repo, { project_id: part2.id, source_id: src.id }, ACTOR)
    expect(imported.already_present).toBe(false)
    expect(imported.source?.review_status).toBe('pending')
    expect(imported.source?.project_id).toBe(part2.id)
    expect(imported.source?.citekey).toBe('prov2026')
    expect(imported.document_id).toBeTruthy()
    expect(imported.document_id).not.toBe(doc.id)
    const copy = repo.getDocument(imported.document_id!)!
    expect(copy.project_id).toBe(part2.id)
    expect(copy.text).toContain('Verifiable provenance')

    const again = importRelatedSource(repo, { project_id: part2.id, source_id: src.id }, ACTOR)
    expect(again.already_present).toBe(true)
    expect(again.source?.id).toBe(imported.source?.id)
  })

  it('übernimmt ein Seed-PDF ohne Quelle nur als Dokument', async () => {
    const { part1, part2 } = setup()
    const ws = projectWorkspace(part1.id, root)
    writeFileSync(join(ws, 'inbox', 'loose.txt'), 'Ein lose gefundenes PDF, das die KI auf Relevanz prüfen soll.')
    const ingested = await ingestUploadedFiles(repo, part1.id, ['loose.txt'], ACTOR)
    addRelatedResearch(repo, part2.id, part1.id, ACTOR)
    const imported = importRelatedSource(repo, { project_id: part2.id, document_id: ingested.documents[0]!.document_id }, ACTOR)
    expect(imported.source).toBeNull()
    expect(imported.document_id).toBeTruthy()
    const listed = listRelatedResearch(repo, { project_id: part2.id })
    expect(listed.seed_documents.some((d) => d.document_id === ingested.documents[0]!.document_id)).toBe(true)
  })

  it('entfernt den Link und löscht ihn mit dem Projekt', () => {
    const { part1, part2 } = setup()
    addRelatedResearch(repo, part2.id, part1.id, ACTOR)
    expect(removeRelatedResearch(repo, part2.id, part1.id, ACTOR).removed).toBe(true)
    expect(listRelatedSummaries(repo, part2.id)).toEqual([])
    addRelatedResearch(repo, part2.id, part1.id, ACTOR)
    expect(deleteProject(repo, part1.id, ACTOR)).toBe(true)
    expect(listRelatedSummaries(repo, part2.id)).toEqual([])
    const state = loadProjectState(repo, part2.id)
    expect(state.related_research).toEqual([])
  })
})
