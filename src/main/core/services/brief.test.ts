import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import { ServiceError, fetchDocument, ingestLocalFile, planResearch, requireAdoptedBrief } from './research'
import { searchLiterature } from './literature'
import {
  MINIMAL_BRIEF_INPUT,
  adoptMinimalBrief,
  adoptResearchBrief,
  draftResearchBrief,
  getResearchBrief,
} from './brief'
import { projectWorkspace } from '../agent/workspace'

describe('Research-Brief (Phase E)', () => {
  let db: DB
  let repo: Repo
  let projectId: string
  const ACTOR = 'test:brief'
  const prevRoot = process.env.ROP_AGENT_ROOT
  let root: string

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
    root = mkdtempSync(join(tmpdir(), 'rop-brief-'))
    process.env.ROP_AGENT_ROOT = root
    projectId = repo.createProject({
      title: 'Brief-Test',
      research_question: 'Was trägt der gewählte Frame?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    }).id
  })

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.ROP_AGENT_ROOT
    else process.env.ROP_AGENT_ROOT = prevRoot
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('steht auf Schema v10 und hat die Brief-Tabelle', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
    expect(tables.map((t) => t.name)).toContain('research_briefs')
  })

  it('lehnt einen Entwurf ohne gewählten Frame ab', () => {
    expect(() =>
      draftResearchBrief(
        repo,
        {
          ...MINIMAL_BRIEF_INPUT,
          project_id: projectId,
          frames: [
            { key: 'a', label: 'Erster Blickwinkel ohne Wahl' },
            { key: 'b', label: 'Zweiter Blickwinkel ohne Wahl' },
          ],
        },
        ACTOR
      )
    ).toThrow(ServiceError)
  })

  it('legt einen Entwurf an und macht ihn erst nach Adoption bindend', () => {
    const { brief, next_action } = draftResearchBrief(repo, { project_id: projectId, ...MINIMAL_BRIEF_INPUT }, ACTOR)
    expect(brief.status).toBe('draft')
    expect(brief.markdown).toMatch(/## 1\. Lieferform/)
    expect(brief.markdown).toMatch(/\(gewählt\)/)
    expect(next_action).toMatch(/adopt_research_brief/)
    expect(getResearchBrief(repo, { project_id: projectId }).adopted).toBe(false)
    expect(repo.getAdoptedBrief(projectId)).toBeUndefined()

    const adopted = adoptResearchBrief(repo, { project_id: projectId, brief_id: brief.id }, ACTOR)
    expect(adopted.status).toBe('adopted')
    expect(getResearchBrief(repo, { project_id: projectId }).adopted).toBe(true)
  })

  it('schreibt RESEARCH-PLAN.md in den Workspace bei Adoption', () => {
    projectWorkspace(projectId, root)
    const brief = adoptMinimalBrief(repo, projectId, ACTOR)
    const plan = readFileSync(join(root, projectId, 'RESEARCH-PLAN.md'), 'utf-8')
    expect(plan).toBe(brief.markdown)
    expect(plan).toMatch(/Stopp-Regel/)
  })

  it('lehnt Suche, Abruf und Inbox ohne adoptierten Brief ab (brief_required)', async () => {
    await expect(
      searchLiterature(repo, { project_id: projectId, query: 'transformer attention' }, ACTOR)
    ).rejects.toMatchObject({ code: 'brief_required' })
    await expect(
      fetchDocument(repo, { project_id: projectId, url: 'https://example.org/x', purpose: 'Eine Quelle lesen wollen' }, ACTOR)
    ).rejects.toMatchObject({ code: 'brief_required' })
    await expect(
      ingestLocalFile(repo, { project_id: projectId, filename: 'memo.txt', purpose: 'Lokale Datei einlesen wollen' }, ACTOR)
    ).rejects.toMatchObject({ code: 'brief_required' })
    expect(() =>
      planResearch(repo, { project_id: projectId, sub_questions: [{ question: 'Eine Teilfrage zum Sachverhalt?' }] }, ACTOR)
    ).toThrow(/adoptierten Research-Brief/)
    expect(() => requireAdoptedBrief(repo, projectId)).toThrow(ServiceError)
  })

  it('übernimmt Teilfragen aus dem Brief, wenn plan_research keine mitgibt', () => {
    adoptMinimalBrief(repo, projectId, ACTOR)
    const planned = planResearch(repo, { project_id: projectId, sub_questions: [] }, ACTOR)
    expect(planned.sub_questions).toHaveLength(MINIMAL_BRIEF_INPUT.sub_questions.length)
    expect(planned.sub_questions.map((s) => s.question)).toEqual(MINIMAL_BRIEF_INPUT.sub_questions)
  })

  it('seedit den focused-research-Skill in den Workspace', () => {
    const ws = projectWorkspace(projectId, root)
    const cursorSkill = join(ws, '.cursor', 'skills', 'focused-research', 'SKILL.md')
    const fallbackSkill = join(ws, 'skills', 'focused-research', 'SKILL.md')
    const skill = readFileSync(existsSync(cursorSkill) ? cursorSkill : fallbackSkill, 'utf-8')
    expect(skill).toMatch(/draft_research_brief/)
    expect(skill).toMatch(/nicht suchen/i)
  })

  it('dokumentiert die PSYNDEX-Lücke im Plan, wenn die Disziplin Psychologie ist', () => {
    const { brief } = draftResearchBrief(
      repo,
      { project_id: projectId, ...MINIMAL_BRIEF_INPUT, discipline: 'psychology', year_from: 2016, year_to: 2026, min_empirical: 3 },
      ACTOR
    )
    expect(brief.markdown).toMatch(/PSYNDEX/)
    expect(brief.markdown).toMatch(/pubpsych\.eu/)
    expect(brief.markdown).toMatch(/2016–2026/)
    expect(brief.markdown).toMatch(/Mindestzahl empirischer Quellen: 3/)
  })
})
