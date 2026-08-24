import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { ServiceError, ingestLocalFile, listProjectInbox, linkClaim, planResearch } from '../services/research'
import { adoptMinimalBrief } from '../services/brief'
import { describeEvidenceMap } from '../services/visual'
import { mapSdkMessage } from './events'
import { sessionPreamble, followUpPrefix, mentionContext } from './instructions'
import { defaultAgentSettings, loadAgentSettings, normalizeParamValues, saveAgentSettings } from './settings'
import { localInboxUrl, projectWorkspace, removeProjectWorkspace, resolveInboxFile } from './workspace'

describe('Inbox-Pfade', () => {
  let root: string

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('löst nur den Dateinamen auf und bleibt in der Inbox', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-ws-'))
    const ws = projectWorkspace('proj-a', root)
    writeFileSync(join(ws, 'inbox', 'note.txt'), 'hello')
    const resolved = resolveInboxFile(ws, '../inbox/note.txt')
    expect(resolved).toBe(join(ws, 'inbox', 'note.txt'))
    expect(resolveInboxFile(ws, '/etc/passwd')).toBe(join(ws, 'inbox', 'passwd'))
  })

  it('weist . und .. als Dateiname ab', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-ws-'))
    const ws = projectWorkspace('proj-b', root)
    expect(() => resolveInboxFile(ws, '..')).toThrow(/Ungültig/)
    expect(() => resolveInboxFile(ws, '.')).toThrow(/Ungültig/)
  })

  it('entfernt den Workspace beim Projektlöschen', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-ws-'))
    const ws = projectWorkspace('proj-del', root)
    writeFileSync(join(ws, 'inbox', 'note.txt'), 'bye')
    removeProjectWorkspace('proj-del', root)
    expect(existsSync(ws)).toBe(false)
  })

  it('erzeugt eine URL, die z.string().url() akzeptiert', () => {
    expect(z.string().url().safeParse(localInboxUrl('paper.pdf')).success).toBe(true)
    expect(z.string().url().safeParse(localInboxUrl('my file.txt')).success).toBe(true)
  })
})

describe('Agent-Settings', () => {
  let dataDir: string
  const prev = process.env.ROP_DATA_DIR

  afterEach(() => {
    if (prev === undefined) delete process.env.ROP_DATA_DIR
    else process.env.ROP_DATA_DIR = prev
    if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  })

  it('defaulted Fast auf aus', () => {
    expect(defaultAgentSettings().paramValues.fast).toBe('false')
  })

  it('normalisiert Parameter: Fast bleibt false, Unbekanntes fällt auf den ersten Wert', () => {
    const params = [
      { id: 'fast', values: [{ value: 'true' }, { value: 'false' }] },
      { id: 'reasoning_effort', values: [{ value: 'low' }, { value: 'high' }] },
    ]
    expect(normalizeParamValues(params, {})).toEqual({ fast: 'false', reasoning_effort: 'low' })
    expect(normalizeParamValues(params, { fast: 'true', reasoning_effort: 'high' })).toEqual({
      fast: 'true',
      reasoning_effort: 'high',
    })
  })

  it('behält gemerkte Agent-IDs beim Speichern der Modellwahl', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'rop-data-'))
    process.env.ROP_DATA_DIR = dataDir
    saveAgentSettings({ modelId: 'composer-2.5', paramValues: { fast: 'false' }, agentIds: { p1: 'ag-1' } })
    const cur = loadAgentSettings()
    saveAgentSettings({ ...cur, modelId: 'gpt-5' })
    expect(loadAgentSettings().agentIds?.p1).toBe('ag-1')
    expect(loadAgentSettings().modelId).toBe('gpt-5')
  })
})

describe('ingest_local_file + Evidenzkarte', () => {
  let db: DB
  let repo: Repo
  let root: string
  const ACTOR = 'test:agent'
  const prevRoot = process.env.ROP_AGENT_ROOT

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ROP_AGENT_ROOT
    else process.env.ROP_AGENT_ROOT = prevRoot
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const setup = () => {
    db = openDb(':memory:')
    repo = new Repo(db)
    root = mkdtempSync(join(tmpdir(), 'rop-agent-'))
    process.env.ROP_AGENT_ROOT = root
    return repo.createProject({
      title: 'Inbox',
      research_question: 'Trägt die lokale Datei?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
  }

  const setupReady = () => {
    const project = setup()
    adoptMinimalBrief(repo, project.id, ACTOR)
    return project
  }

  it('legt ein Dokument aus der Inbox an und schneidet Offsets', async () => {
    const project = setupReady()
    const ws = projectWorkspace(project.id, root)
    const quote = 'Lokale Provenienz muss genauso unfälschbar sein wie Netzquellen.'
    writeFileSync(join(ws, 'inbox', 'memo.txt'), `Einleitung.\n${quote}\nSchluss.`)

    const listed = listProjectInbox(repo, { project_id: project.id })
    expect(listed.files.map((f) => f.filename)).toContain('memo.txt')

    const doc = await ingestLocalFile(
      repo,
      { project_id: project.id, filename: 'memo.txt', purpose: 'Lokale Notiz als Beleg einlesen' },
      ACTOR
    )
    expect(doc.url).toBe(localInboxUrl('memo.txt'))
    expect(doc.window.text).toContain(quote)
    const start = doc.window.text.indexOf(quote)
    expect(start).toBeGreaterThanOrEqual(0)
  })

  it('weist Traversal-Namen ab, die keine Inbox-Datei treffen', async () => {
    const project = setup()
    projectWorkspace(project.id, root)
    await expect(
      ingestLocalFile(repo, { project_id: project.id, filename: '..', purpose: 'Versuch, auszubrechen aus der Inbox' }, ACTOR)
    ).rejects.toBeInstanceOf(ServiceError)
  })

  it('lehnt unerlaubte Dateitypen ab', async () => {
    const project = setupReady()
    const ws = projectWorkspace(project.id, root)
    writeFileSync(join(ws, 'inbox', 'x.bin'), 'nope')
    await expect(
      ingestLocalFile(repo, { project_id: project.id, filename: 'x.bin', purpose: 'Binärdatei soll nicht durchrutschen' }, ACTOR)
    ).rejects.toMatchObject({ code: 'ingest_type' })
  })

  it('describe_evidence_map listet nur vorhandene Quellen und Aussagen', () => {
    const project = setupReady()
    const planned = planResearch(
      repo,
      { project_id: project.id, sub_questions: [{ question: 'Teilfrage Nummer 1 zum Sachverhalt?', min_sources: 1 }] },
      ACTOR
    )
    const sq = planned.sub_questions[0]!.id
    const src = repo.addSource({
      project_id: project.id,
      url: 'https://example.org/a',
      title: 'Beispielquelle',
      retrieval_method: 'test',
      accessed_at: new Date().toISOString(),
      reason: 'Weil sie das Kernargument der Studie dokumentiert.',
      extraction: 'Die Studie zeigt X unter Bedingung Y mit Effektstärke Z.',
      contribution: 'Stützt These 2 des Berichts.',
      verbatim_quote: 'Ein wörtliches Zitat mit ausreichender Länge.',
      sub_question_id: sq,
      actor: ACTOR,
    })
    linkClaim(
      repo,
      {
        project_id: project.id,
        claim_text: 'Zentrale Aussage des Berichts über den Sachverhalt.',
        source_id: src.id,
        quote_span: 'Ein wörtliches Zitat mit ausreichender Länge.',
        support_type: 'supports',
      },
      ACTOR
    )
    const map = describeEvidenceMap(repo, { project_id: project.id })
    expect(map.layout_kind).toBe('theme_clusters')
    expect(map.graph.nodes.every((n) => n.entity_id)).toBe(true)
    expect(map.graph.nodes.some((n) => n.kind === 'source' && n.entity_id === src.id)).toBe(true)
    expect(map.claims).toHaveLength(1)
    expect(map.claims[0]!.links[0]!.source_id).toBe(src.id)
  })
})

describe('SDK-Event-Mapping und Arbeitsvertrag', () => {
  it('mappt Assistententext und überspringt leere Tool-Blöcke', () => {
    const out = mapSdkMessage({
      type: 'assistant',
      agent_id: 'a',
      run_id: 'r',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'x', input: {} }] },
    })
    expect(out).toEqual([])
    const text = mapSdkMessage({
      type: 'assistant',
      agent_id: 'a',
      run_id: 'r',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hallo' }] },
    })
    expect(text).toEqual([{ type: 'assistant', text: 'Hallo' }])
  })

  it('enthält die project_id im ersten Turn', () => {
    const text = sessionPreamble({ projectId: 'proj-42', title: 'T', researchQuestion: 'Warum?' })
    expect(text).toContain('proj-42')
    expect(text).toContain('search_documents')
    expect(text).toContain('reflect_search')
    expect(text).toContain('describe_evidence_map')
    expect(text).toContain('draft_research_brief')
    expect(text).not.toMatch(/sofort search_literature/i)
  })

  it('hängt @-Kontext an Folge-Turns', () => {
    const mentions = mentionContext([
      { kind: 'source', id: 'src-1', label: 'smith2024' },
      { kind: 'inbox', id: 'paper.pdf', label: 'paper.pdf' },
      { kind: 'question', id: 'sq-1', label: 'Wirkt X auf Y?' },
    ])
    expect(mentions).toContain('source_id: src-1')
    expect(mentions).toContain('paper.pdf')
    expect(mentions).toContain('sq-1')
    expect(followUpPrefix('proj-1', ['note.txt'], [{ kind: 'source', id: 'src-1', label: 'smith2024' }])).toContain('@-Erwähnungen')
  })

  it('mappt Usage-Events auf Token-Zahlen', () => {
    const out = mapSdkMessage({
      type: 'usage',
      agent_id: 'a',
      run_id: 'r',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
    expect(out).toEqual([{ type: 'usage', inputTokens: 10, outputTokens: 4, totalTokens: 14 }])
  })
})

