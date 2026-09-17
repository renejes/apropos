import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, SCHEMA_VERSION, type DB } from '../db'
import { Repo } from '../repo'
import { ServiceError } from './research'
import { createProject, loadProjectState } from './projects'
import {
  MAX_APPEND_CHARS,
  NOTES_DISCLAIMER,
  appendProjectNotes,
  notesFilePath,
  readProjectNotes,
  writeProjectNotes,
} from './project-notes'

const ACTOR = 'test:notes'

describe('Research-Arbeitsnotizen (NOTES.md)', () => {
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
    root = mkdtempSync(join(tmpdir(), 'rop-notes-'))
    process.env.ROP_AGENT_ROOT = root
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const project = repo.createProject({
      title: 'Hausarbeit',
      research_question: 'Was ist X?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    return { project }
  }

  it('liest leer, hängt mit Zeitstempel an, landet in NOTES.md und im Projektzustand', () => {
    const { project } = setup()
    const empty = readProjectNotes(repo, { project_id: project.id })
    expect(empty.empty).toBe(true)
    expect(empty.markdown).toBe('')
    expect(empty.disclaimer).toBe(NOTES_DISCLAIMER)

    const first = appendProjectNotes(
      repo,
      { project_id: project.id, text: 'Müller widerspricht Schmidt bei der Dosis.' },
      ACTOR
    )
    expect(first.appended).toBe(true)
    expect(first.markdown).toContain('# Arbeitsnotizen')
    expect(first.markdown).toContain(NOTES_DISCLAIMER)
    expect(first.markdown).toMatch(/## \d{4}-\d{2}-\d{2} \d{2}:\d{2} · KI/)
    expect(first.markdown).toContain('Müller widerspricht Schmidt bei der Dosis.')

    const onDisk = readFileSync(notesFilePath(project.id), 'utf-8')
    expect(onDisk).toBe(first.markdown)

    appendProjectNotes(repo, { project_id: project.id, text: 'Als Nächstes die deutsche OA-Fassung suchen.' }, ACTOR)
    const again = readProjectNotes(repo, { project_id: project.id })
    expect(again.markdown).toContain('Müller widerspricht')
    expect(again.markdown).toContain('deutsche OA-Fassung')

    const state = loadProjectState(repo, project.id)
    expect(state.project_notes).toContain('deutsche OA-Fassung')
  })

  it('lässt den Menschen die Datei ersetzen, den Agenten nur anhängen', () => {
    const { project } = setup()
    appendProjectNotes(repo, { project_id: project.id, text: 'Alter Eintrag den der Mensch streicht.' }, ACTOR)
    const replaced = writeProjectNotes(
      repo,
      { project_id: project.id, markdown: '# Arbeitsnotizen\n\nNur noch das.\n' },
      'human:ui'
    )
    expect(replaced.markdown).toContain('Nur noch das.')
    expect(replaced.markdown).not.toContain('Alter Eintrag')

    const appended = appendProjectNotes(repo, { project_id: project.id, text: 'Neuer KI-Eintrag nach dem Kürzen.' }, ACTOR)
    expect(appended.markdown).toContain('Nur noch das.')
    expect(appended.markdown).toMatch(/· KI/)
    expect(appended.markdown).not.toMatch(/· Mensch/)
  })

  it('weist Notebooks und zu lange Einträge ab', () => {
    const { project } = setup()
    const nb = createProject(repo, {
      title: 'Notizbuch',
      research_question: '',
      mode: 'academic',
      kind: 'notebook',
      actor: ACTOR,
    })
    expect(() => readProjectNotes(repo, { project_id: nb.id })).toThrow(ServiceError)
    try {
      appendProjectNotes(repo, { project_id: nb.id, text: 'Das darf hier nicht landen.' }, ACTOR)
      throw new Error('erwartet notes_not_research')
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError)
      expect((err as ServiceError).code).toBe('notes_not_research')
    }
    expect(loadProjectState(repo, nb.id).project_notes).toBe('')

    expect(() =>
      appendProjectNotes(repo, { project_id: project.id, text: 'kurz' }, ACTOR)
    ).toThrow(ServiceError)

    expect(() =>
      appendProjectNotes(repo, { project_id: project.id, text: 'x'.repeat(MAX_APPEND_CHARS + 1) }, ACTOR)
    ).toThrow(ServiceError)
  })
})
