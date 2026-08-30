import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Repo } from '../repo'
import { projectWorkspace } from '../agent/workspace'
import { ServiceError } from './research'
import type { Note, NoteCitation, NoteOrigin } from '../../../shared/types'

function assertProject(repo: Repo, projectId: string): void {
  if (!repo.getProject(projectId)) {
    throw new ServiceError('project_missing', `Projekt ${projectId} existiert nicht.`, 'Rufe list_projects auf und verwende eine gültige project_id.')
  }
}

function noteFileName(title: string, id: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9äöüß]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'notiz'
  return `${slug}-${id.slice(0, 8)}.md`
}

function notesDir(projectId: string): string {
  const dir = join(projectWorkspace(projectId), 'notes')
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeNoteFile(projectId: string, fileName: string, title: string, body: string): void {
  const header = `# ${title.trim() || 'Notiz'}\n\n`
  const bodyWithoutTitle = body.replace(/^\s*#\s+[^\n]+\n+/, '')
  writeFileSync(join(notesDir(projectId), fileName), `${header}${bodyWithoutTitle}`.trimEnd() + '\n', 'utf-8')
}

function removeNoteFile(projectId: string, fileName: string): void {
  const abs = join(notesDir(projectId), fileName)
  if (existsSync(abs)) unlinkSync(abs)
}

export function groundCitations(repo: Repo, projectId: string, raw: unknown): NoteCitation[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new ServiceError(
      'citation_invalid',
      'citations muss eine Liste von Offset-Belegen sein.',
      'Übergib citations als Array mit document_id, quote_start und quote_end aus read_document.'
    )
  }
  const out: NoteCitation[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new ServiceError('citation_invalid', 'Ein Beleg ist kein Objekt.', 'Jedes citations-Element braucht document_id, quote_start, quote_end.')
    }
    const rec = item as Record<string, unknown>
    const documentId = typeof rec.document_id === 'string' ? rec.document_id : ''
    const start = typeof rec.quote_start === 'number' ? rec.quote_start : Number.NaN
    const end = typeof rec.quote_end === 'number' ? rec.quote_end : Number.NaN
    if (!documentId || !Number.isInteger(start) || !Number.isInteger(end)) {
      throw new ServiceError(
        'citation_invalid',
        'Beleg unvollständig.',
        'Setze document_id, quote_start und quote_end aus dem Textfenster von read_document.'
      )
    }
    const doc = repo.getDocument(documentId)
    if (!doc || doc.project_id !== projectId) {
      throw new ServiceError(
        'citation_document_missing',
        `Dokument ${documentId} liegt nicht in diesem Projekt.`,
        'Rufe list_corpus oder search_documents auf und nimm eine document_id aus diesem Notebook.'
      )
    }
    if (start < 0 || end > doc.char_len || start >= end) {
      throw new ServiceError(
        'citation_offset_invalid',
        `Offsets ${start}–${end} passen nicht zum Dokument (${doc.char_len} Zeichen).`,
        'Lies das Dokument mit read_document und übernimm quote_start/quote_end aus dem Fenster.'
      )
    }
    out.push({ document_id: documentId, quote_start: start, quote_end: end, quote: doc.text.slice(start, end) })
  }
  return out
}

export function createNote(
  repo: Repo,
  input: {
    project_id: string
    title: string
    body_markdown: string
    origin?: NoteOrigin
    citations?: unknown
  },
  actor: string
): Note {
  assertProject(repo, input.project_id)
  const title = input.title.trim()
  if (title.length < 1) {
    throw new ServiceError('note_title_empty', 'Die Notiz braucht einen Titel.', 'Gib einen kurzen Titel an.')
  }
  const citations = groundCitations(repo, input.project_id, input.citations)
  const tempId = 'pending'
  const fileName = noteFileName(title, tempId)
  const note = repo.addNote({
    project_id: input.project_id,
    title,
    body_markdown: input.body_markdown,
    file_name: fileName,
    origin: input.origin ?? 'human',
    citations,
  })
  const finalName = noteFileName(title, note.id)
  if (finalName !== fileName) repo.updateNote(note.id, { file_name: finalName })
  writeNoteFile(input.project_id, finalName, title, input.body_markdown)
  repo.logEvent(input.project_id, actor, 'note.created', { note_id: note.id, origin: input.origin ?? 'human' })
  return repo.getNote(note.id)!
}

export function updateNote(
  repo: Repo,
  input: { note_id: string; title?: string; body_markdown?: string; citations?: unknown },
  actor: string
): Note {
  const current = repo.getNote(input.note_id)
  if (!current) {
    throw new ServiceError('note_missing', 'Notiz nicht gefunden.', 'Rufe list_notes auf und verwende eine note_id aus diesem Projekt.')
  }
  const title = (input.title ?? current.title).trim()
  if (title.length < 1) {
    throw new ServiceError('note_title_empty', 'Die Notiz braucht einen Titel.', 'Gib einen kurzen Titel an.')
  }
  const body = input.body_markdown ?? current.body_markdown
  const citations = input.citations !== undefined ? groundCitations(repo, current.project_id, input.citations) : current.citations
  const nextName = noteFileName(title, current.id)
  if (nextName !== current.file_name) removeNoteFile(current.project_id, current.file_name)
  const updated = repo.updateNote(current.id, { title, body_markdown: body, file_name: nextName, citations })
  if (!updated) {
    throw new ServiceError('note_missing', 'Notiz nicht gefunden.', 'Rufe list_notes auf.')
  }
  writeNoteFile(current.project_id, nextName, title, body)
  repo.logEvent(current.project_id, actor, 'note.updated', { note_id: current.id })
  return updated
}

export function deleteNote(repo: Repo, noteId: string, actor: string): boolean {
  const current = repo.getNote(noteId)
  if (!current) return false
  removeNoteFile(current.project_id, current.file_name)
  const ok = repo.deleteNote(noteId)
  if (ok) repo.logEvent(current.project_id, actor, 'note.deleted', { note_id: noteId })
  return ok
}
