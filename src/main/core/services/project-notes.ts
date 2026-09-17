import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { z } from 'zod'
import type { Repo } from '../repo'
import { projectWorkspace, registeredWorkspace } from '../agent/workspace'
import { ServiceError } from './research'

export const NOTES_FILE = 'NOTES.md'
export const MAX_NOTES_CHARS = 80_000
export const MAX_APPEND_CHARS = 8_000

export const NOTES_DISCLAIMER =
  'Kein Beleg und kein Bericht. Querverweise, Sackgassen, nächste Vermutung. Bericht und BibTeX ignorieren diese Datei.'

const NOTES_STARTER = `# Arbeitsnotizen\n\n${NOTES_DISCLAIMER}\n`

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, code: string): z.infer<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new ServiceError(code, `Eingabe ungültig — ${detail}`, 'Korrigiere GENAU die oben genannten Felder und rufe dasselbe Werkzeug erneut auf.')
  }
  return parsed.data
}

function assertProject(repo: Repo, projectId: string) {
  const project = repo.getProject(projectId)
  if (!project) {
    throw new ServiceError(
      'project_not_found',
      `Projekt ${projectId} existiert nicht.`,
      'Rufe list_projects auf und verwende eine der dort genannten project_id. Erfinde keine ID.'
    )
  }
  return project
}

function assertResearchNotes(repo: Repo, projectId: string) {
  const project = assertProject(repo, projectId)
  if (project.kind !== 'research') {
    throw new ServiceError(
      'notes_not_research',
      'Arbeitsnotizen gibt es nur in Research-Projekten.',
      'Nimm die project_id eines Research-Projekts. Im Notebook: save_note für gegroundete Notizen.'
    )
  }
  return project
}

function workspaceFor(projectId: string): string {
  return registeredWorkspace(projectId) ?? projectWorkspace(projectId)
}

export function notesFilePath(projectId: string): string {
  return join(workspaceFor(projectId), NOTES_FILE)
}

function readFileOrEmpty(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

function writeNotesFile(path: string, markdown: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf-8')
}

function actorLane(actor: string): 'Mensch' | 'KI' {
  return actor.startsWith('human') ? 'Mensch' : 'KI'
}

function stamp(now = new Date()): string {
  return now.toISOString().slice(0, 16).replace('T', ' ')
}

export const readNotesSchema = z.object({
  project_id: z.string().min(1),
})

export const appendNotesSchema = z.object({
  project_id: z.string().min(1),
  text: z
    .string()
    .min(8)
    .max(MAX_APPEND_CHARS)
    .describe('Neuer Eintrag. Kein Beleg, kein Zitat für den Bericht. Querverweise, Sackgassen, nächste Vermutung.'),
})

export const writeNotesSchema = z.object({
  project_id: z.string().min(1),
  markdown: z.string().max(MAX_NOTES_CHARS),
})

/** Für die UI und get_project_state — leere Zeichenkette, wenn nichts liegt oder Notebook. */
export function loadProjectNotesText(repo: Repo, projectId: string): string {
  const project = repo.getProject(projectId)
  if (!project || project.kind !== 'research') return ''
  try {
    return readFileOrEmpty(notesFilePath(projectId))
  } catch {
    return ''
  }
}

export function readProjectNotes(repo: Repo, rawInput: unknown): { markdown: string; empty: boolean; disclaimer: string } {
  const input = parseOrThrow(readNotesSchema, rawInput, 'notes_invalid')
  assertResearchNotes(repo, input.project_id)
  const markdown = readFileOrEmpty(notesFilePath(input.project_id))
  return {
    markdown,
    empty: markdown.trim().length === 0,
    disclaimer: NOTES_DISCLAIMER,
  }
}

export function appendProjectNotes(
  repo: Repo,
  rawInput: unknown,
  actor: string
): { markdown: string; appended: true; chars: number } {
  const input = parseOrThrow(appendNotesSchema, rawInput, 'notes_invalid')
  assertResearchNotes(repo, input.project_id)
  const path = notesFilePath(input.project_id)
  const current = readFileOrEmpty(path)
  const body = current.trim().length === 0 ? NOTES_STARTER : current.replace(/\s*$/, '\n')
  const entry = `\n## ${stamp()} · ${actorLane(actor)}\n\n${input.text.trim()}\n`
  const next = `${body}${entry}`
  if (next.length > MAX_NOTES_CHARS) {
    throw new ServiceError(
      'notes_too_long',
      `Die Arbeitsnotizen sind zu lang (${next.length} Zeichen, Limit ${MAX_NOTES_CHARS}).`,
      'Lies read_project_notes, fasse Altes zusammen, und lass den Menschen unter Plan kürzen. Danach denselben Eintrag erneut anhängen.'
    )
  }
  writeNotesFile(path, next)
  repo.logEvent(input.project_id, actor, 'project_notes.appended', { chars: input.text.trim().length })
  const markdown = readFileOrEmpty(path)
  return { markdown, appended: true, chars: markdown.length }
}

/** Voller Ersatz — nur die App (Mensch). Der Agent hängt an, er überschreibt nicht. */
export function writeProjectNotes(
  repo: Repo,
  rawInput: unknown,
  actor: string
): { markdown: string } {
  const input = parseOrThrow(writeNotesSchema, rawInput, 'notes_invalid')
  assertResearchNotes(repo, input.project_id)
  const path = notesFilePath(input.project_id)
  const markdown = input.markdown
  writeNotesFile(path, markdown)
  repo.logEvent(input.project_id, actor, 'project_notes.replaced', { chars: markdown.length })
  return { markdown: readFileOrEmpty(path) }
}
