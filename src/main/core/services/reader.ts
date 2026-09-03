import { existsSync, readFileSync } from 'fs'
import { extname } from 'path'
import type { Repo } from '../repo'
import { projectWorkspace, registeredWorkspace, resolveInboxFile } from '../agent/workspace'
import { urlLooksLikePdf } from '../enforce/pdf'
import { ServiceError } from './research'
import type { DocumentOpenInfo, DocumentOpenKind, FetchedDocument } from '../../../shared/types'

function workspaceFor(projectId: string): string {
  return registeredWorkspace(projectId) ?? projectWorkspace(projectId)
}

function kindFromDoc(doc: FetchedDocument, filePath: string | null): DocumentOpenKind {
  if (doc.origin === 'youtube') return 'youtube'
  const name = (doc.filename ?? '').toLowerCase()
  const ext = filePath ? extname(filePath).toLowerCase() : extname(name)
  if (ext === '.pdf' || name.endsWith('.pdf') || urlLooksLikePdf(doc.url) || doc.url.startsWith('local://inbox/') && name.endsWith('.pdf')) {
    return 'pdf'
  }
  if (ext === '.html' || ext === '.htm' || name.endsWith('.html') || name.endsWith('.htm')) return 'html'
  if (doc.origin === 'fetched' && (doc.url.startsWith('http://') || doc.url.startsWith('https://'))) {
    if (urlLooksLikePdf(doc.url)) return 'pdf'
    return 'html'
  }
  if (ext === '.txt' || ext === '.md' || ext === '.markdown' || ext === '.csv') return 'text'
  return 'text'
}

/** Datei am Dokument — physisch im Workspace des besitzenden Projekts (Research bei Link). */
export function inspectDocumentOpen(repo: Repo, documentId: string): DocumentOpenInfo {
  const doc = repo.getDocument(documentId)
  if (!doc) {
    throw new ServiceError(
      'document_not_found',
      `Dokument ${documentId} existiert nicht.`,
      'Rufe list_corpus auf und verwende eine document_id aus dem Korpus.'
    )
  }

  let filePath: string | null = null
  let fileExists = false
  if (doc.filename) {
    try {
      filePath = resolveInboxFile(workspaceFor(doc.project_id), doc.filename)
      fileExists = existsSync(filePath)
    } catch {
      filePath = null
      fileExists = false
    }
  }

  let kind = kindFromDoc(doc, filePath)
  if (kind === 'pdf' && !fileExists) kind = 'missing'
  if ((kind === 'html' || kind === 'text') && doc.filename && !fileExists && !doc.url.startsWith('http')) {
    kind = 'missing'
  }

  return {
    document_id: doc.id,
    kind,
    filename: doc.filename,
    url: doc.url,
    file_exists: fileExists,
    origin: doc.origin,
    page_starts: doc.page_starts,
  }
}

export function readDocumentPdfBytes(repo: Repo, documentId: string): Buffer | null {
  const info = inspectDocumentOpen(repo, documentId)
  if (info.kind !== 'pdf' || !info.file_exists || !info.filename) return null
  const doc = repo.getDocument(documentId)
  if (!doc?.filename) return null
  try {
    const abs = resolveInboxFile(workspaceFor(doc.project_id), doc.filename)
    if (!existsSync(abs)) return null
    return readFileSync(abs)
  } catch {
    return null
  }
}

export function resolveDocumentDiskPath(repo: Repo, documentId: string): string | null {
  const doc = repo.getDocument(documentId)
  if (!doc?.filename) return null
  try {
    const abs = resolveInboxFile(workspaceFor(doc.project_id), doc.filename)
    return existsSync(abs) ? abs : null
  } catch {
    return null
  }
}
