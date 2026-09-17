import { z } from 'zod'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Repo } from '../repo'
import {
  localInboxUrl,
  projectWorkspace,
  registeredWorkspace,
  resolveInboxFile,
  uniqueInboxName,
} from '../agent/workspace'
import { allocateCitekey } from './biblio'
import { ServiceError, unreadWorkBuffer } from './research'
import type {
  DocumentSearchHit,
  FetchedDocument,
  RelatedResearch,
  Source,
} from '../../../shared/types'
import { isCapturePending } from '../../../shared/types'

const WINDOW_DEFAULT = 8000
const WINDOW_MAX = 30000

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

function assertResearch(repo: Repo, projectId: string, role: 'dieses' | 'das Ziel') {
  const project = assertProject(repo, projectId)
  if (project.kind !== 'research') {
    throw new ServiceError(
      'related_not_research',
      `${role === 'dieses' ? 'Dieses' : 'Das Ziel-'}Projekt ist kein Research.`,
      'Verwandte Quellen gibt es nur zwischen Research-Projekten. Notebooks koppeln über linked_research_id.'
    )
  }
  return project
}

function workspaceFor(projectId: string): string {
  return registeredWorkspace(projectId) ?? projectWorkspace(projectId)
}

function clip(text: string, n = 280): string {
  const t = text.trim()
  return t.length <= n ? t : `${t.slice(0, n)}…`
}

function relatedIds(repo: Repo, fromProjectId: string): string[] {
  return repo.listResearchLinkTargetIds(fromProjectId).filter((id) => {
    const p = repo.getProject(id)
    return p?.kind === 'research'
  })
}

export function listRelatedSummaries(repo: Repo, projectId: string): RelatedResearch[] {
  assertProject(repo, projectId)
  return relatedIds(repo, projectId).flatMap((id) => {
    const p = repo.getProject(id)
    if (!p) return []
    const sources = repo.listSources(id)
    const docs = repo.listDocuments(id)
    return [
      {
        project_id: p.id,
        title: p.title,
        research_question: p.research_question,
        signed_count: sources.filter((s) => s.review_status === 'human_signed').length,
        source_count: sources.filter((s) => s.review_status !== 'rejected').length,
        upload_count: docs.filter((d) => d.origin === 'upload' && d.status !== 'excluded').length,
      },
    ]
  })
}

export function addRelatedResearch(
  repo: Repo,
  fromProjectId: string,
  toProjectId: string,
  actor: string,
  bothWays = false
): { related: RelatedResearch[]; added: boolean } {
  const from = assertResearch(repo, fromProjectId, 'dieses')
  const to = assertResearch(repo, toProjectId, 'das Ziel')
  if (from.id === to.id) {
    throw new ServiceError(
      'related_self',
      'Ein Projekt kann nicht mit sich selbst verknüpft werden.',
      'Wähle ein anderes Research-Projekt.'
    )
  }
  const first = repo.addResearchLink(from.id, to.id, actor)
  if (bothWays) repo.addResearchLink(to.id, from.id, actor)
  return { related: listRelatedSummaries(repo, from.id), added: first.created }
}

export function removeRelatedResearch(
  repo: Repo,
  fromProjectId: string,
  toProjectId: string,
  actor: string,
  bothWays = false
): { related: RelatedResearch[]; removed: boolean } {
  assertResearch(repo, fromProjectId, 'dieses')
  const removed = repo.removeResearchLink(fromProjectId, toProjectId, actor)
  if (bothWays) repo.removeResearchLink(toProjectId, fromProjectId, actor)
  return { related: listRelatedSummaries(repo, fromProjectId), removed }
}

function assertLinkedTarget(repo: Repo, fromProjectId: string, toProjectId: string) {
  const from = assertResearch(repo, fromProjectId, 'dieses')
  const to = assertResearch(repo, toProjectId, 'das Ziel')
  if (!repo.hasResearchLink(from.id, to.id)) {
    throw new ServiceError(
      'related_not_linked',
      `„${to.title}“ ist nicht mit diesem Projekt verknüpft.`,
      'Der Mensch verknüpft verwandte Research-Projekte unter Plan. Danach list_related_research.'
    )
  }
  return to
}

export const listRelatedSchema = z.object({
  project_id: z.string().min(1),
  related_project_id: z.string().min(1).optional(),
  query: z.string().min(2).optional(),
})

export type RelatedSourceRow = {
  source_id: string
  related_project_id: string
  related_title: string
  title: string
  url: string
  contribution: string
  verbatim_quote: string
  document_id: string | null
  doi: string | null
  year: number | null
  citekey: string | null
  review_status: Source['review_status']
}

export type RelatedSeedDoc = {
  document_id: string
  related_project_id: string
  related_title: string
  title: string | null
  filename: string | null
  origin: string
  char_len: number
}

export function listRelatedResearch(
  repo: Repo,
  rawInput: unknown
): {
  related: RelatedResearch[]
  sources: RelatedSourceRow[]
  seed_documents: RelatedSeedDoc[]
  hits: Array<DocumentSearchHit & { related_project_id: string; related_title: string }>
  next_action: string
} {
  const input = parseOrThrow(listRelatedSchema, rawInput, 'related_invalid')
  assertResearch(repo, input.project_id, 'dieses')
  const all = listRelatedSummaries(repo, input.project_id)
  if (all.length === 0) {
    return {
      related: [],
      sources: [],
      seed_documents: [],
      hits: [],
      next_action:
        'Keine verwandten Research-Projekte. Der Mensch verknüpft sie unter Plan (Hausarbeit in Teilen). Danach dieses Werkzeug erneut.',
    }
  }

  const scoped = input.related_project_id
    ? all.filter((r) => r.project_id === input.related_project_id)
    : all
  if (input.related_project_id && scoped.length === 0) {
    throw new ServiceError(
      'related_not_linked',
      'Diese related_project_id ist nicht verknüpft.',
      'Rufe list_related_research ohne Filter auf und nimm eine der genannten project_id.'
    )
  }

  const sources: RelatedSourceRow[] = []
  const seed_documents: RelatedSeedDoc[] = []
  const hits: Array<DocumentSearchHit & { related_project_id: string; related_title: string }> = []

  for (const rel of scoped) {
    const signed = repo
      .listSources(rel.project_id)
      .filter((s) => s.review_status === 'human_signed')
      .slice(0, 40)
    const signedDocIds = new Set(signed.map((s) => s.document_id).filter((id): id is string => Boolean(id)))
    for (const s of signed) {
      sources.push({
        source_id: s.id,
        related_project_id: rel.project_id,
        related_title: rel.title,
        title: s.title,
        url: s.url,
        contribution: clip(s.contribution),
        verbatim_quote: clip(s.verbatim_quote),
        document_id: s.document_id,
        doi: s.doi,
        year: s.year,
        citekey: s.citekey,
        review_status: s.review_status,
      })
    }
    for (const d of repo.listDocuments(rel.project_id)) {
      if (d.status === 'excluded' || d.origin !== 'upload') continue
      if (d.char_len <= 0) continue
      if (signedDocIds.has(d.id)) continue
      seed_documents.push({
        document_id: d.id,
        related_project_id: rel.project_id,
        related_title: rel.title,
        title: d.title,
        filename: d.filename,
        origin: d.origin,
        char_len: d.char_len,
      })
    }
    if (input.query) {
      for (const hit of repo.searchDocuments(rel.project_id, input.query)) {
        hits.push({ ...hit, related_project_id: rel.project_id, related_title: rel.title })
      }
    }
  }

  return {
    related: all,
    sources,
    seed_documents,
    hits,
    next_action:
      'Lies mit read_related_document (document_id aus dieser Liste). Was in DIESEN Bericht soll: import_related_source — Kopie landet pending auf dem Human Desk. Nicht die fremde document_id in add_source. Übernehmen nur der Mensch. Zählt nicht als Suchwelle.',
  }
}

export const readRelatedSchema = z.object({
  project_id: z.string().min(1),
  document_id: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(500).max(WINDOW_MAX).optional(),
})

export function readRelatedDocument(
  repo: Repo,
  rawInput: unknown
): {
  document_id: string
  related_project_id: string
  related_title: string
  url: string
  char_len: number
  content_hash: string
  window: { offset: number; length: number; text: string }
  has_more: boolean
  open_documents: number
  hint: string
} {
  const input = parseOrThrow(readRelatedSchema, rawInput, 'related_read_invalid')
  assertResearch(repo, input.project_id, 'dieses')
  const doc = repo.getDocument(input.document_id)
  if (!doc) {
    throw new ServiceError(
      'document_missing',
      'Dokument nicht gefunden.',
      'Rufe list_related_research auf und nimm eine document_id aus sources oder seed_documents.'
    )
  }
  const related = assertLinkedTarget(repo, input.project_id, doc.project_id)
  if (doc.status === 'excluded' || isCapturePending(doc) || doc.char_len <= 0) {
    throw new ServiceError(
      'document_unavailable',
      'Dieses Dokument hat in dem anderen Projekt keinen lesbaren Volltext.',
      'Wähle ein anderes Dokument aus list_related_research.'
    )
  }
  const start = Math.min(input.offset ?? 0, doc.char_len)
  const end = Math.min(start + (input.limit ?? WINDOW_DEFAULT), doc.char_len)
  const buf = unreadWorkBuffer(repo, input.project_id)
  return {
    document_id: doc.id,
    related_project_id: related.id,
    related_title: related.title,
    url: doc.url,
    char_len: doc.char_len,
    content_hash: doc.content_hash,
    window: { offset: start, length: end - start, text: doc.text.slice(start, end) },
    has_more: end < doc.char_len,
    open_documents: buf.open,
    hint:
      `Dokument aus verwandtem Research „${related.title}“. Zeichen ${start}–${end} von ${doc.char_len}. ` +
      'NICHT add_source mit dieser document_id. Wenn die Stelle in DIESEN Bericht soll: import_related_source ' +
      `(source_id aus list_related_research oder document_id=${doc.id}), dann add_source mit der neuen lokalen ID. ` +
      (end < doc.char_len ? `Weiterlesen: offset=${end}.` : ''),
  }
}

export const importRelatedSchema = z
  .object({
    project_id: z.string().min(1),
    source_id: z.string().min(1).optional(),
    document_id: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.source_id || v.document_id), {
    message: 'source_id oder document_id ist Pflicht.',
  })

function copyRelatedInboxFile(fromProjectId: string, toProjectId: string, filename: string | null): string | null {
  if (!filename) return null
  try {
    const src = resolveInboxFile(workspaceFor(fromProjectId), filename)
    if (!existsSync(src)) return null
    const destDir = join(workspaceFor(toProjectId), 'inbox')
    mkdirSync(destDir, { recursive: true })
    const name = uniqueInboxName(destDir, filename)
    copyFileSync(src, join(destDir, name))
    return name
  } catch {
    return null
  }
}

function copyRelatedDocument(repo: Repo, intoProjectId: string, sourceDoc: FetchedDocument, actor: string): FetchedDocument {
  const existing = repo.listDocuments(intoProjectId).find((d) => d.content_hash === sourceDoc.content_hash && d.status !== 'excluded')
  if (existing) {
    const full = repo.getDocument(existing.id)
    if (full) return full
  }
  const copiedName = copyRelatedInboxFile(sourceDoc.project_id, intoProjectId, sourceDoc.filename)
  const origin = sourceDoc.origin === 'upload' || copiedName ? 'upload' : sourceDoc.origin
  const filename = copiedName ?? (origin === 'upload' ? sourceDoc.filename : copiedName)
  const url =
    origin === 'upload' && filename
      ? localInboxUrl(filename)
      : sourceDoc.url.startsWith('local://') && filename
        ? localInboxUrl(filename)
        : sourceDoc.url
  return repo.addDocument({
    project_id: intoProjectId,
    url,
    title: sourceDoc.title,
    text: sourceDoc.text,
    content_hash: sourceDoc.content_hash,
    purpose: `Aus verwandtem Research übernommen (${sourceDoc.project_id})`,
    actor,
    origin,
    filename,
    page_starts: sourceDoc.page_starts,
    status: 'used',
    document_role: sourceDoc.document_role,
  })
}

export function importRelatedSource(
  repo: Repo,
  rawInput: unknown,
  actor: string
): {
  source: Source | null
  document_id: string | null
  already_present: boolean
  hint: string
} {
  const input = parseOrThrow(importRelatedSchema, rawInput, 'related_import_invalid')
  const into = assertResearch(repo, input.project_id, 'dieses')

  let relatedSource: Source | undefined
  if (input.source_id) {
    relatedSource = repo.getSource(input.source_id)
    if (!relatedSource) {
      throw new ServiceError(
        'source_not_found',
        `Quelle ${input.source_id} existiert nicht.`,
        'Rufe list_related_research auf und nimm eine source_id aus der Liste.'
      )
    }
    if (relatedSource.review_status === 'rejected') {
      throw new ServiceError(
        'related_source_rejected',
        'Diese Quelle ist im anderen Projekt abgelehnt.',
        'Wähle eine übernommene Quelle oder ein Seed-Dokument.'
      )
    }
    assertLinkedTarget(repo, into.id, relatedSource.project_id)
  }

  const relatedDocId = relatedSource?.document_id ?? input.document_id ?? null
  let relatedDoc = relatedDocId ? repo.getDocument(relatedDocId) : undefined
  if (input.document_id && !relatedSource) {
    if (!relatedDoc) {
      throw new ServiceError(
        'document_missing',
        'Dokument nicht gefunden.',
        'Rufe list_related_research auf und nimm eine document_id aus seed_documents.'
      )
    }
    assertLinkedTarget(repo, into.id, relatedDoc.project_id)
  }
  if (relatedDoc && (relatedDoc.status === 'excluded' || isCapturePending(relatedDoc) || relatedDoc.char_len <= 0)) {
    relatedDoc = undefined
  }

  if (relatedSource) {
    const sameUrl = repo.listSources(into.id).find((s) => s.url === relatedSource!.url && s.review_status !== 'rejected')
    if (sameUrl) {
      return {
        source: sameUrl,
        document_id: sameUrl.document_id,
        already_present: true,
        hint:
          sameUrl.review_status === 'human_signed'
            ? 'Diese Quelle liegt hier schon und ist übernommen. Nicht erneut importieren.'
            : 'Diese Quelle liegt hier schon als Ordner. Übernehmen auf dem Human Desk — nicht add_source mit der fremden ID.',
      }
    }
  }

  const copiedDoc = relatedDoc ? copyRelatedDocument(repo, into.id, relatedDoc, actor) : null
  if (!relatedSource && copiedDoc) {
    return {
      source: null,
      document_id: copiedDoc.id,
      already_present: false,
      hint:
        `Dokument liegt jetzt im Korpus dieses Projekts (document_id ${copiedDoc.id}). ` +
        'Lies mit read_document, dann add_source mit Offsets. Übernehmen nur der Mensch.',
    }
  }
  if (!relatedSource) {
    throw new ServiceError(
      'related_import_empty',
      'Nichts zu übernehmen.',
      'Übergib source_id einer übernommenen Quelle oder document_id eines Seed-Dokuments aus list_related_research.'
    )
  }

  const relatedTitle = repo.getProject(relatedSource.project_id)?.title ?? 'verwandtes Research'
  const citekey = relatedSource.citekey
    ? allocateCitekey(repo.listCitekeys(into.id), relatedSource.citekey)
    : null
  const source = repo.addSource({
    project_id: into.id,
    url: relatedSource.url,
    title: relatedSource.title,
    retrieval_method: 'related_import',
    accessed_at: relatedSource.accessed_at,
    reason: `Übernommen aus Research „${relatedTitle}“. ${relatedSource.reason}`,
    extraction: relatedSource.extraction,
    contribution: relatedSource.contribution,
    verbatim_quote: relatedSource.verbatim_quote,
    quote_locator: relatedSource.quote_locator,
    confidence: relatedSource.confidence,
    document_id: copiedDoc?.id ?? null,
    quote_start: copiedDoc ? relatedSource.quote_start : null,
    quote_end: copiedDoc ? relatedSource.quote_end : null,
    doi: relatedSource.doi,
    authors_json: relatedSource.authors_json,
    year: relatedSource.year,
    venue: relatedSource.venue,
    entry_type: relatedSource.entry_type,
    citekey,
    source_kind: relatedSource.source_kind,
    actor,
  })
  repo.logEvent(into.id, actor, 'source.imported_related', {
    source_id: source.id,
    from_source_id: relatedSource.id,
    from_project_id: relatedSource.project_id,
    document_id: copiedDoc?.id ?? null,
  })
  return {
    source,
    document_id: copiedDoc?.id ?? null,
    already_present: false,
    hint:
      `Kopie liegt pending auf dem Human Desk (source_id ${source.id}). ` +
      'Nicht human_signed — der Mensch übernimmt erneut. Bericht nur nach Übernehmen.',
  }
}
