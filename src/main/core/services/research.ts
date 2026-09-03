import { z } from 'zod'
import { createHash } from 'crypto'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import type { Repo } from '../repo'
import { verifySourceDeterministic } from '../enforce/verify'
import { fetchSourceText } from '../enforce/fetchers'
import { extractPdfText, isPdfMagic, MAX_PDF_BYTES } from '../enforce/pdf'
import { htmlToText } from '../enforce/textmatch'
import { listInboxFiles, localInboxUrl, projectWorkspace, registeredWorkspace, resolveInboxFile } from '../agent/workspace'
import { enrichSourceBiblio } from './biblio'
import type {
  ClaimSourceLink,
  CoverageGap,
  CoverageReport,
  ExcludedSource,
  FetchedDocument,
  ReportVersion,
  ResearchRound,
  RoundResult,
  SearchLogEntry,
  SearchNextAction,
  SearchReflection,
  Source,
  SubQuestion,
  DocumentSearchHit,
} from '../../../shared/types'
import { isFailedSearchAttempt } from '../../../shared/search-waves'

export { isFailedSearchAttempt }

/**
 * Service-Schicht: HIER lebt das Provenienz-Enforcement — nicht im MCP-Handler.
 *
 * Grund (Architekturentscheidung, documentation/06): Die Plattform bekommt einen
 * zweiten Schreibpfad (eingebaute Research-Engine) neben dem MCP-Server. Läge das
 * Enforcement weiter im Tool-Handler, hätte ausgerechnet die eigene Engine die
 * schwächeren Garantien. Beide Pfade rufen jetzt dieselben Funktionen auf:
 *
 *   MCP-Tool      ─┐
 *                  ├─> services/research.ts ─> Repo ─> SQLite
 *   Eigene Engine ─┘
 *
 * Regeln:
 *  - Validierung passiert hier (geteilte Zod-Schemas), nicht beim Aufrufer.
 *  - Fehler sind ServiceError mit `code` — der Aufrufer entscheidet, wie er sie
 *    darstellt (MCP: isError-Antwort; Engine: Korrektur-Feedback an das Modell).
 *  - Kein Pfad kann `human_signed` setzen. Das bleibt Repo.signSourceHuman (UI/IPC).
 */

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /**
     * PFLICHTFELD — bewusst nicht optional.
     *
     * Grund (documentation/07): Von 20 geprüften Clients werten nur drei das
     * MCP-Feld `isError` aus. Alle anderen legen dem Modell den Antworttext hin
     * wie jedes andere Werkzeugergebnis. Ein Fehler muss sich deshalb SELBST
     * tragen — er darf nicht darauf angewiesen sein, dass der Client ihn als
     * Fehler markiert.
     *
     * Daraus folgt die Form: kein beschreibender Hinweis, sondern die nächste
     * Handlung im Imperativ ("Rufe zuerst fetch_source auf." statt "fetch_source
     * wäre hier sinnvoll gewesen."). Dass der Compiler das Feld erzwingt, ist
     * Absicht: eine Konvention hält das über 26 Fehlerstellen nicht durch.
     */
    readonly hint: string
  ) {
    super(message)
    this.name = 'ServiceError'
  }
}

// ---------------------------------------------------------------- Schemas
// Bewusst geteilt: Was das MCP-Tool ablehnt, muss auch die Engine ablehnen.
// Feldreihenfolge ist relevant — Begründung VOR Ergebnis (CoT nicht abwürgen).

export const confidenceSchema = z.enum(['low', 'medium', 'high'])

export const sourceInputSchema = z
  .object({
    project_id: z.string().min(1),
    url: z.string().url(),
    title: z.string().min(3),
    retrieval_method: z.string().min(1),
    reason: z.string().min(20),
    extraction: z.string().min(20),
    contribution: z.string().min(10),
    /** Optional, WENN document_id + Offsets angegeben sind — dann schneidet der Server. */
    verbatim_quote: z.string().min(20).optional(),
    quote_locator: z.string().optional().nullable(),
    confidence: confidenceSchema.optional().nullable(),
    sub_question_id: z.string().optional().nullable(),
    document_id: z.string().optional().nullable(),
    quote_start: z.number().int().min(0).optional().nullable(),
    quote_end: z.number().int().min(1).optional().nullable(),
    accessed_at: z.string().optional(),
    doi: z.string().optional().nullable(),
    source_kind: z.enum(['empirical', 'review', 'textbook', 'grey', 'web']).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const hasDoc = !!v.document_id
    const hasOffsets = v.quote_start != null && v.quote_end != null
    if (hasDoc && !hasOffsets) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quote_start'], message: 'Mit document_id sind quote_start UND quote_end Pflicht.' })
    }
    if (!hasDoc && hasOffsets) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['document_id'], message: 'quote_start/quote_end ergeben nur zusammen mit document_id Sinn.' })
    }
    if (!hasDoc && !v.verbatim_quote) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verbatim_quote'],
        message: 'Ohne document_id ist verbatim_quote Pflicht. Besser: erst fetch_source, dann document_id + Offsets angeben.',
      })
    }
    if (hasOffsets && v.quote_end! <= v.quote_start!) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quote_end'], message: 'quote_end muss größer als quote_start sein.' })
    }
  })
export type SourceInput = z.infer<typeof sourceInputSchema>

export const searchInputSchema = z.object({
  project_id: z.string().min(1),
  query: z.string().min(2),
  engine: z.string().optional().nullable(),
  results_found: z.number().int().min(0).optional().nullable(),
  note: z.string().optional().nullable(),
})

export const exclusionInputSchema = z.object({
  project_id: z.string().min(1),
  url: z.string().url(),
  title: z.string().optional().nullable(),
  reason: z.string().min(10),
})

export const linkInputSchema = z.object({
  project_id: z.string().min(1),
  claim_id: z.string().optional(),
  claim_text: z.string().optional(),
  report_section: z.string().optional().nullable(),
  source_id: z.string().min(1),
  quote_span: z.string().min(10),
  support_type: z.enum(['supports', 'contrasts', 'mentions']),
  confidence: confidenceSchema.optional().nullable(),
})

export const reportInputSchema = z.object({
  project_id: z.string().min(1),
  content_markdown: z.string().min(50),
  parent_version_id: z.string().optional().nullable(),
  change_summary: z.string().optional().nullable(),
  acknowledge_gaps: z.boolean().optional(),
  gap_acknowledgement: z.string().optional().nullable(),
  visual_version_id: z.string().optional().nullable(),
  mark_scope: z.boolean().optional(),
})

export const subQuestionSchema = z.object({
  question: z.string().min(10),
  rationale: z.string().optional().nullable(),
  min_sources: z.number().int().min(1).max(20).optional(),
})

/** Zod-Fehler in eine für ein Modell verwertbare Meldung übersetzen. */
function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, code: string): z.infer<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new ServiceError(code, `Eingabe ungültig — ${detail}`, 'Korrigiere GENAU die oben genannten Felder und rufe dasselbe Werkzeug erneut auf.')
  }
  return parsed.data
}

function assertProject(repo: Repo, projectId: string): void {
  if (!repo.getProject(projectId)) {
    throw new ServiceError(
      'project_not_found',
      `Projekt ${projectId} existiert nicht.`,
      'Rufe list_projects auf und verwende eine der dort genannten project_id. Erfinde keine ID. Gibt es noch kein Projekt, lege es mit create_project an.'
    )
  }
}

/**
 * Welches Projekt den Korpus besitzt. Notebook mit Link → Research-ID.
 * Unverknüpftes Notebook und Research → die eigene ID.
 */
export function resolveCorpusProjectId(repo: Repo, projectId: string): string {
  assertProject(repo, projectId)
  const project = repo.getProject(projectId)!
  if (project.kind === 'notebook' && project.linked_research_id) return project.linked_research_id
  return projectId
}

/** Ingest/Fetch/Add-Source/Exclude gegen den Research-Korpus im Notebook ablehnen. */
export function assertCorpusWritable(repo: Repo, projectId: string): void {
  assertProject(repo, projectId)
  const project = repo.getProject(projectId)!
  if (project.kind === 'notebook' && project.linked_research_id) {
    const research = repo.getProject(project.linked_research_id)
    const name = research?.title ?? 'Research'
    throw new ServiceError(
      'corpus_owned_by_research',
      'Quellen im Research-Projekt anlegen, nicht hier.',
      `Öffne das Research-Projekt „${name}“ und lege die Quelle dort an. Danach erscheint sie in diesem Notebook.`
    )
  }
}

export function documentBelongsToCorpus(repo: Repo, projectId: string, documentProjectId: string): boolean {
  return documentProjectId === resolveCorpusProjectId(repo, projectId)
}

/**
 * Suche und Abruf erst nach adoptiertem Brief — sonst Deep Research ohne Blickwinkel.
 * Kein Env-Bypass: der Test muss rot werden, wenn diese Prüfung entfernt wird.
 */
export function requireAdoptedBrief(repo: Repo, projectId: string): void {
  if (repo.getProject(projectId)?.kind === 'notebook') return
  if (!repo.getAdoptedBrief(projectId)) {
    throw new ServiceError(
      'brief_required',
      'Es gibt noch keinen adoptierten Research-Brief. Ohne Blickwinkel und Stopp-Regel darf nicht gesucht oder gelesen werden.',
      'Rufe zuerst draft_research_brief auf, lass den Menschen den Plan bestätigen, dann adopt_research_brief.'
    )
  }
}

export function listPendingDiscoverySearches(repo: Repo, projectId: string): SearchLogEntry[] {
  return repo.listUnreflectedSearches(projectId).filter((entry) => !isFailedSearchAttempt(entry))
}

const REFLECT_HINT =
  'Rufe reflect_search auf: covered (welche Facetten/Teilfragen die Treffer bedienen), ' +
  'underrepresented (was gegenüber Brief/Ziel fehlt — keine Stückzahl), ' +
  'next_action search|read|enough. Bei search die next_query selbst formulieren. ' +
  'get_coverage_gaps ist nur eine Zählung, kein Auftrag zu suchen.'

export function requireSearchReflection(repo: Repo, projectId: string): void {
  if (repo.getProject(projectId)?.kind === 'notebook') return
  const pending = listPendingDiscoverySearches(repo, projectId)
  if (pending.length === 0) return
  const queries = [...new Set(pending.map((p) => p.query))]
  const shown = queries[0] ?? ''
  const extra = queries.length > 1 ? ' u. a.' : ''
  throw new ServiceError(
    'search_reflection_required',
    `Nach der Suche „${shown}“${extra} steht noch keine Lage. Die nächste Suche läuft erst nach reflect_search.`,
    REFLECT_HINT
  )
}

export function evaluateSearchGate(
  repo: Repo,
  explicitProjectId?: string | null
): {
  allowed: boolean
  project_id: string | null
  pending_queries: string[]
  code?: string
  error?: string
  next_action?: string
} {
  let projectId: string
  try {
    projectId = resolveIngestProjectId(repo, explicitProjectId)
  } catch {
    return { allowed: true, project_id: null, pending_queries: [] }
  }
  if (repo.getProject(projectId)?.kind === 'notebook') {
    return { allowed: true, project_id: projectId, pending_queries: [] }
  }
  const pending = listPendingDiscoverySearches(repo, projectId)
  if (pending.length === 0) return { allowed: true, project_id: projectId, pending_queries: [] }
  const queries = [...new Set(pending.map((p) => p.query))]
  const shown = queries[0] ?? ''
  const extra = queries.length > 1 ? ' u. a.' : ''
  return {
    allowed: false,
    project_id: projectId,
    pending_queries: queries,
    code: 'search_reflection_required',
    error: `Nach der Suche „${shown}“${extra} steht noch keine Lage. Die nächste Suche läuft erst nach reflect_search.`,
    next_action: REFLECT_HINT,
  }
}

export const reflectSearchSchema = z.object({
  project_id: z.string().min(1),
  covered: z
    .string()
    .min(20)
    .describe('Welche Facetten oder Teilfragen die letzte Suche bedient — am Brief/Ziel, nicht an der Trefferzahl'),
  underrepresented: z
    .string()
    .min(20)
    .describe('Was gegenüber Brief/Ziel unterrepräsentiert ist — keine Stückzahl wie „noch 2 Quellen“'),
  next_action: z.enum(['search', 'read', 'enough']),
  next_query: z.string().min(3).optional(),
  reason: z.string().min(20).describe('Warum dieser nächste Schritt — bei enough: warum diese Facette reicht'),
  sub_question_id: z.string().min(1).optional(),
})

export function reflectSearch(
  repo: Repo,
  rawInput: unknown,
  actor: string
): {
  reflection: SearchReflection
  attached_search_ids: string[]
  hint: string
} {
  const input = parseOrThrow(reflectSearchSchema, rawInput, 'reflection_invalid')
  assertProject(repo, input.project_id)

  const unreflected = repo.listUnreflectedSearches(input.project_id)
  if (unreflected.length === 0) {
    throw new ServiceError(
      'nothing_to_reflect',
      'Es gibt keine unbewertete Suche. Die letzte Lage gilt noch, oder es wurde noch nicht gesucht.',
      'Suche zuerst mit search_literature, search_documents oder WebSearch. Die nächste Lage kommt nach der nächsten Suchwelle.'
    )
  }

  const action: SearchNextAction = input.next_action
  switch (action) {
    case 'search':
      if (!input.next_query?.trim()) {
        throw new ServiceError(
          'next_query_required',
          'next_action=search braucht eine next_query — die nächste Suche kommt aus dieser Lage, nicht aus einem Algorithmus.',
          'Formuliere next_query selbst (neue Facette, anderer Register-Schnitt, andere Sprache). Dann erst suchen.'
        )
      }
      break
    case 'read':
    case 'enough':
      if (input.next_query?.trim()) {
        throw new ServiceError(
          'next_query_forbidden',
          `next_action=${action} darf keine next_query tragen.`,
          action === 'read'
            ? 'Lass next_query weg und lies zuerst mit fetch_source oder read_document. Eine neue Suche braucht eine neue Lage mit next_action=search.'
            : 'Lass next_query weg. Wenn doch weitergesucht werden soll: next_action=search und die Query selbst schreiben.'
        )
      }
      break
    default: {
      const _never: never = action
      throw new ServiceError('reflection_invalid', `Unbekannte next_action: ${_never}`, 'Nutze search, read oder enough.')
    }
  }

  if (input.sub_question_id) {
    const sq = repo.getSubQuestion(input.sub_question_id)
    if (!sq || sq.project_id !== input.project_id) {
      throw new ServiceError(
        'sub_question_not_found',
        `Teilfrage ${input.sub_question_id} existiert in diesem Projekt nicht.`,
        'Lass sub_question_id weg oder nimm eine ID aus get_project_state / plan_research.'
      )
    }
  }

  const attached_search_ids = unreflected.map((s) => s.id)
  const reflection = repo.addSearchReflection({
    project_id: input.project_id,
    covered: input.covered.trim(),
    underrepresented: input.underrepresented.trim(),
    next_action: action,
    next_query: action === 'search' ? input.next_query!.trim() : null,
    reason: input.reason.trim(),
    sub_question_id: input.sub_question_id ?? null,
    actor,
  })

  const hint =
    action === 'search'
      ? `Lage gespeichert. Nächste Suche mit der Query aus next_query: „${reflection.next_query}“. Nicht vom Algorithmus nachziehen — du suchst selbst.`
      : action === 'read'
        ? 'Lage gespeichert. Als Nächstes fetch_source oder read_document, dann add_source. Die nächste Suche braucht danach eine neue Lage.'
        : 'Lage gespeichert: diese Facette reicht. get_coverage_gaps bleibt die Zählung; next_round entscheidet über Sättigung. Eine neue Suche braucht eine neue Lage.'

  return { reflection, attached_search_ids, hint }
}

// ---------------------------------------------------------------- Dokumente

/** Wie viele abgerufene, aber undokumentierte Dokumente gleichzeitig offen sein dürfen. */
const MAX_OPEN_DOCUMENTS = Number(process.env.ROP_MAX_PENDING ?? 3)
/** Wie viel Text ein einzelner Abruf zurückgibt (Kontext-Budget des Modells). */
const WINDOW_DEFAULT = 8000
const WINDOW_MAX = 30000

export const fetchInputSchema = z.object({
  project_id: z.string().min(1),
  url: z.string().url(),
  purpose: z.string().min(10),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(500).max(WINDOW_MAX).optional(),
})

export interface FetchDocumentResult {
  document_id: string
  url: string
  char_len: number
  content_hash: string
  window: { offset: number; length: number; text: string }
  has_more: boolean
  open_documents: number
  hint: string
}

/**
 * Ruft eine Quelle SELBST ab und speichert den Text.
 *
 * Zwei Wirkungen, die Hooks nicht leisten können:
 *  1. Das Zitat kann anschließend per {document_id, quote_start, quote_end} eingetragen
 *     werden — der Server schneidet es aus DIESEM Text. Erfinden ist damit unmöglich.
 *  2. Der Abruf läuft durch den Server, also kann er weitere Abrufe verweigern, solange
 *     ein Dokument undokumentiert ist. Das Vollständigkeits-Gate wird damit
 *     agentenunabhängig — Harness-Hooks feuern in Subagenten nicht verlässlich.
 */
export async function fetchDocument(repo: Repo, rawInput: unknown, actor: string): Promise<FetchDocumentResult> {
  const input = parseOrThrow(fetchInputSchema, rawInput, 'fetch_invalid')
  assertProject(repo, input.project_id)
  assertCorpusWritable(repo, input.project_id)
  requireAdoptedBrief(repo, input.project_id)

  // Bereits abgerufen? Dann kein zweiter Netzabruf — Fenster aus dem Gespeicherten liefern.
  const existing = repo
    .listDocuments(input.project_id)
    .find((d) => d.url === input.url && d.status !== 'excluded')
  if (existing) {
    return windowOf(repo.getDocument(existing.id)!, input.offset ?? 0, input.limit ?? WINDOW_DEFAULT, repo, input.project_id, true)
  }

  // Gate: erst dokumentieren, dann weiterlesen.
  const open = repo.listOpenDocuments(input.project_id)
  if (open.length >= MAX_OPEN_DOCUMENTS) {
    throw new ServiceError(
      'open_documents_limit',
      `${open.length} abgerufene Quelle(n) sind noch nicht dokumentiert:\n` +
        open.map((d) => `- ${d.url}`).join('\n'),
      'Dokumentiere JEDE dieser URLs, bevor du erneut abrufst: entweder add_source (mit document_id + quote_start/quote_end) ' +
        'oder exclude_source mit Begründung. Erst danach lässt fetch_source dich weiterlesen.'
    )
  }

  const fetched = await fetchSourceText(input.url)
  if (!fetched.ok || !fetched.text.trim()) {
    throw new ServiceError(
      'fetch_failed',
      `Quelle konnte nicht abgerufen werden: ${fetched.note}`,
      'Prüfe die URL und rufe fetch_source erneut auf. PDFs mit Textschicht werden extrahiert; Bilder, Scans ohne Text und Paywalls nicht. ' +
        'Gibt es keine HTML/PDF-Fassung, erfasse die Quelle mit add_source OHNE document_id und mit wörtlichem verbatim_quote — ' +
        'sie geht dann in die menschliche Prüfung. Oder schließe sie mit exclude_source begründet aus.'
    )
  }

  const doc = repo.addDocument({
    project_id: input.project_id,
    url: input.url,
    text: fetched.text,
    content_hash: fetched.snapshotHash ?? '',
    purpose: input.purpose,
    actor,
    origin: 'fetched',
    page_starts: fetched.pageStarts ?? null,
  })

  return windowOf(doc, input.offset ?? 0, input.limit ?? WINDOW_DEFAULT, repo, input.project_id, false)
}

function windowOf(
  doc: FetchedDocument,
  offset: number,
  limit: number,
  repo: Repo,
  projectId: string,
  cached: boolean
): FetchDocumentResult {
  const start = Math.min(offset, doc.char_len)
  const end = Math.min(start + limit, doc.char_len)
  const openCount = repo.listOpenDocuments(projectId).length
  // Das Kontingent VOR dem Anschlag melden, nicht erst beim Fehlschlag: ein Modell,
  // das weiß, dass dies sein letzter freier Abruf war, dokumentiert von selbst.
  const free = MAX_OPEN_DOCUMENTS - openCount
  const budget =
    free <= 0
      ? ' ACHTUNG: Dein Abruf-Kontingent ist damit aufgebraucht — der nächste Abruf (fetch_source oder ingest_local_file) wird ABGELEHNT, ' +
        'bis du die offenen Quellen mit add_source oder exclude_source dokumentiert hast.'
      : ` Noch ${free} Abruf(e) frei, bevor du dokumentieren musst.`
  return {
    document_id: doc.id,
    url: doc.url,
    char_len: doc.char_len,
    content_hash: doc.content_hash,
    window: { offset: start, length: end - start, text: doc.text.slice(start, end) },
    has_more: end < doc.char_len,
    open_documents: openCount,
    hint:
      (cached ? 'Bereits abgerufen — Text aus dem Projektspeicher. ' : '') +
      `Zeichen ${start}–${end} von ${doc.char_len}. ` +
      'TU JETZT: Trage die Quelle mit add_source ein und gib dabei document_id sowie quote_start/quote_end an ' +
      '(ABSOLUTE Zeichenpositionen in diesem Dokument, gezählt ab 0 — das Fenster beginnt bei ' +
      `${start}, addiere diesen Wert also auf jede Position innerhalb des Fensters). ` +
      'Der Server schneidet das Zitat selbst heraus; tippe es NICHT ab. ' +
      (end < doc.char_len ? `Reicht der Text nicht, lies mit demselben Werkzeug und offset=${end} weiter.` : '') +
      budget,
  }
}

// ---------------------------------------------------------------- Lokale Inbox (In-App-Agent)

const ALLOWED_INBOX_EXT = new Set(['.pdf', '.txt', '.md', '.markdown', '.html', '.htm', '.csv'])

export const ingestLocalSchema = z.object({
  project_id: z.string().min(1),
  filename: z.string().min(1),
  purpose: z.string().min(10),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(500).max(WINDOW_MAX).optional(),
})

export const inboxListSchema = z.object({
  project_id: z.string().min(1),
})

export interface InboxFileInfo {
  filename: string
  bytes: number
}

function workspaceFor(projectId: string): string {
  return registeredWorkspace(projectId) ?? projectWorkspace(projectId)
}

export function listProjectInbox(repo: Repo, rawInput: unknown): { files: InboxFileInfo[]; next_action: string } {
  const input = parseOrThrow(inboxListSchema, rawInput, 'inbox_invalid')
  assertProject(repo, input.project_id)
  const ws = workspaceFor(input.project_id)
  const files = listInboxFiles(input.project_id).map((filename) => {
    let bytes = 0
    try {
      bytes = statSync(resolveInboxFile(ws, filename)).size
    } catch {
      bytes = 0
    }
    return { filename, bytes }
  })
  return {
    files,
    next_action:
      files.length === 0
        ? 'Keine Dateien in der Inbox. Der Mensch hängt sie in der App an (Büroklammer im Chat). Danach list_inbox erneut aufrufen.'
        : 'Lies eine Datei mit ingest_local_file (filename + purpose), danach SOFORT add_source mit document_id + quote_start + quote_end.',
  }
}

/**
 * Liest eine Inbox-Datei (kein Netz, kein file://-Fetcher) und legt sie wie fetch_source
 * als Dokument an. Dieselbe Pending-Grenze gilt — sonst umgeht die Inbox das Gate.
 */
export async function ingestLocalFile(repo: Repo, rawInput: unknown, actor: string): Promise<FetchDocumentResult> {
  const input = parseOrThrow(ingestLocalSchema, rawInput, 'ingest_invalid')
  assertProject(repo, input.project_id)
  assertCorpusWritable(repo, input.project_id)
  requireAdoptedBrief(repo, input.project_id)

  const ext = extname(input.filename).toLowerCase()
  if (!ALLOWED_INBOX_EXT.has(ext)) {
    throw new ServiceError(
      'ingest_type',
      `Dateityp "${ext || '(ohne Endung)'}" ist nicht erlaubt.`,
      'Nur pdf, txt, md, html oder csv. Hänge die Datei in der App erneut mit passender Endung an.'
    )
  }

  const ws = workspaceFor(input.project_id)
  let absPath: string
  try {
    absPath = resolveInboxFile(ws, input.filename)
  } catch {
    throw new ServiceError(
      'inbox_path',
      `Datei "${input.filename}" liegt nicht in der Inbox (oder der Name ist ungültig).`,
      'Rufe list_inbox auf und verwende GENAU einen der dort genannten Dateinamen — ohne Pfad, ohne ..'
    )
  }
  if (!existsSync(absPath)) {
    throw new ServiceError(
      'inbox_missing',
      `Datei "${input.filename}" wurde in der Inbox nicht gefunden.`,
      'Rufe list_inbox auf. Existiert die Datei nicht, muss der Mensch sie in der App anhängen.'
    )
  }

  const url = localInboxUrl(input.filename)
  const existing = repo.listDocuments(input.project_id).find((d) => d.url === url && d.status !== 'excluded')
  if (existing) {
    return windowOf(repo.getDocument(existing.id)!, input.offset ?? 0, input.limit ?? WINDOW_DEFAULT, repo, input.project_id, true)
  }

  const open = repo.listOpenDocuments(input.project_id)
  if (open.length >= MAX_OPEN_DOCUMENTS) {
    throw new ServiceError(
      'open_documents_limit',
      `${open.length} abgerufene Quelle(n) sind noch nicht dokumentiert:\n` + open.map((d) => `- ${d.url}`).join('\n'),
      'Dokumentiere JEDE dieser URLs, bevor du erneut liest: add_source (document_id + Offsets) oder exclude_source. Erst danach lässt ingest_local_file / fetch_source dich weiterlesen.'
    )
  }

  const bytes = readFileSync(absPath)
  if (bytes.length > MAX_PDF_BYTES) {
    throw new ServiceError(
      'ingest_too_large',
      `Datei ist ${bytes.length} Bytes groß (Maximum ${MAX_PDF_BYTES}).`,
      'Bitte eine kleinere Datei anhängen oder die Quelle über fetch_source aus dem Netz lesen.'
    )
  }

  const extracted = await extractInboxBytes(bytes, ext)
  if (!extracted.text.trim()) {
    throw new ServiceError(
      'ingest_empty',
      `Aus "${input.filename}" konnte kein Text gelesen werden (leere Datei oder PDF ohne Textschicht).`,
      'Scans ohne Textschicht können so nicht belegt werden. Erfasse die Quelle mit add_source OHNE document_id und mit wörtlichem verbatim_quote — sie geht in die menschliche Prüfung. Oder schließe sie mit exclude_source aus.'
    )
  }

  const doc = repo.addDocument({
    project_id: input.project_id,
    url,
    title: input.filename,
    text: extracted.text,
    content_hash: createHash('sha256').update(bytes).digest('hex'),
    purpose: input.purpose,
    actor,
    origin: 'upload',
    filename: input.filename,
    page_starts: extracted.pageStarts,
  })
  return windowOf(doc, input.offset ?? 0, input.limit ?? WINDOW_DEFAULT, repo, input.project_id, false)
}

async function extractInboxBytes(bytes: Buffer, ext: string): Promise<{ text: string; pageStarts: number[] | null }> {
  if (isPdfMagic(bytes) || ext === '.pdf') {
    const extracted = await extractPdfText(new Uint8Array(bytes))
    return { text: extracted.text, pageStarts: extracted.pageStarts }
  }
  if (ext === '.html' || ext === '.htm') {
    return { text: htmlToText(bytes.toString('utf-8')), pageStarts: null }
  }
  return { text: bytes.toString('utf-8'), pageStarts: null }
}

export interface CorpusIngestResult {
  documents: Array<{ document_id: string; filename: string; char_len: number; url: string }>
  errors: Array<{ filename: string; message: string }>
}

/**
 * Mensch legt Dateien in den Projekt-Korpus. Kein Brief-Gate, kein Pending-Gate:
 * der Upload IST die Entscheidung, die Datei dazuzunehmen. Zitieren bleibt add_source.
 */
export async function ingestUploadedFiles(
  repo: Repo,
  projectId: string,
  filenames: string[],
  actor: string
): Promise<CorpusIngestResult> {
  assertProject(repo, projectId)
  assertCorpusWritable(repo, projectId)
  const ws = workspaceFor(projectId)
  const documents: CorpusIngestResult['documents'] = []
  const errors: CorpusIngestResult['errors'] = []

  for (const filename of filenames) {
    const ext = extname(filename).toLowerCase()
    if (!ALLOWED_INBOX_EXT.has(ext)) {
      errors.push({ filename, message: `Dateityp "${ext || '(ohne Endung)'}" ist nicht erlaubt.` })
      continue
    }
    let absPath: string
    try {
      absPath = resolveInboxFile(ws, filename)
    } catch {
      errors.push({ filename, message: 'Datei liegt nicht in der Inbox.' })
      continue
    }
    if (!existsSync(absPath)) {
      errors.push({ filename, message: 'Datei wurde in der Inbox nicht gefunden.' })
      continue
    }
    const url = localInboxUrl(filename)
    const existing = repo.listDocuments(projectId).find((d) => d.url === url && d.status !== 'excluded')
    if (existing) {
      documents.push({ document_id: existing.id, filename, char_len: existing.char_len, url })
      continue
    }
    const bytes = readFileSync(absPath)
    if (bytes.length > MAX_PDF_BYTES) {
      errors.push({ filename, message: `Datei ist größer als ${MAX_PDF_BYTES} Bytes.` })
      continue
    }
    try {
      const extracted = await extractInboxBytes(bytes, ext)
      if (!extracted.text.trim()) {
        errors.push({ filename, message: 'Kein Text lesbar (leere Datei oder Scan-PDF ohne Textschicht).' })
        continue
      }
      const doc = repo.addDocument({
        project_id: projectId,
        url,
        title: filename,
        text: extracted.text,
        content_hash: createHash('sha256').update(bytes).digest('hex'),
        purpose: 'Vom Menschen in den Projekt-Korpus gelegt',
        actor,
        origin: 'upload',
        filename,
        page_starts: extracted.pageStarts,
        status: 'used',
      })
      documents.push({ document_id: doc.id, filename, char_len: doc.char_len, url })
    } catch (err) {
      errors.push({ filename, message: err instanceof Error ? err.message : String(err) })
    }
  }

  return { documents, errors }
}

export const readDocumentSchema = z.object({
  project_id: z.string().min(1),
  document_id: z.string().min(1),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(500).max(WINDOW_MAX).optional(),
})

/** Liest ein bereits gespeichertes Dokument — kein neuer Abruf, kein Pending-Zähler. */
export function readDocumentWindow(repo: Repo, rawInput: unknown): FetchDocumentResult {
  const input = parseOrThrow(readDocumentSchema, rawInput, 'read_invalid')
  assertProject(repo, input.project_id)
  requireAdoptedBrief(repo, input.project_id)
  const corpusId = resolveCorpusProjectId(repo, input.project_id)
  const doc = repo.getDocument(input.document_id)
  if (!doc || doc.project_id !== corpusId) {
    throw new ServiceError(
      'document_missing',
      'Dokument nicht gefunden.',
      'Rufe list_corpus oder search_documents auf und verwende eine document_id aus diesem Projekt.'
    )
  }
  if (doc.status === 'excluded') {
    throw new ServiceError(
      'document_excluded',
      'Dieses Dokument wurde ausgeschlossen.',
      'Wähle ein anderes Dokument aus list_corpus.'
    )
  }
  return windowOf(doc, input.offset ?? 0, input.limit ?? WINDOW_DEFAULT, repo, input.project_id, true)
}

export const searchDocumentsSchema = z.object({
  project_id: z.string().min(1),
  query: z.string().min(2),
})

export function searchProjectDocuments(
  repo: Repo,
  rawInput: unknown,
  actor: string
): { query: string; hits: DocumentSearchHit[]; next_action: string } {
  const input = parseOrThrow(searchDocumentsSchema, rawInput, 'search_invalid')
  assertProject(repo, input.project_id)
  requireAdoptedBrief(repo, input.project_id)
  requireSearchReflection(repo, input.project_id)
  const corpusId = resolveCorpusProjectId(repo, input.project_id)
  const hits = repo.searchDocuments(corpusId, input.query)
  repo.addSearchLog({
    project_id: input.project_id,
    query: input.query,
    engine: 'corpus',
    results_found: hits.length,
    note: null,
    actor,
  })
  return {
    query: input.query,
    hits,
    next_action:
      (hits.length === 0
        ? 'Keine Treffer im Korpus. '
        : 'Lies die Stelle mit read_document (document_id + offset nahe am Treffer), dann SOFORT add_source mit Offsets. ') +
      'Lesen ist jetzt erlaubt. Bevor du erneut suchst: reflect_search (covered / underrepresented / next_action).',
  }
}

export function listProjectCorpus(
  repo: Repo,
  rawInput: unknown
): { documents: Array<Omit<FetchedDocument, 'text'>>; next_action: string } {
  const input = parseOrThrow(inboxListSchema, rawInput, 'corpus_invalid')
  assertProject(repo, input.project_id)
  const corpusId = resolveCorpusProjectId(repo, input.project_id)
  const documents = repo.listDocuments(corpusId).filter((d) => d.status !== 'excluded')
  const uploads = documents.filter((d) => d.origin === 'upload').length
  return {
    documents,
    next_action:
      documents.length === 0
        ? 'Der Korpus ist leer. Der Mensch lädt PDFs im Tab „Korpus“ hoch oder hängt sie im Chat an.'
        : `${documents.length} Dokument(e), davon ${uploads} Upload(s). Suche mit search_documents, lies mit read_document, belege mit add_source.`,
  }
}

// ---------------------------------------------------------------- Quellen

export interface RecordSourceResult {
  source: Source
  stored: true
  /**
   * Erste Zeile der Antwort — und der Grund, warum es dieses Feld gibt.
   *
   * add_source ist der einzige Pfad, auf dem ein SCHEITERN in einer Antwort OHNE
   * `isError` steckt: Der Eintrag wurde gespeichert (also kein Werkzeugfehler),
   * aber die Zitatprüfung ist durchgefallen. Bisher stand das nur im `hint` — und
   * ein Modell liest einen Hinweis als Randnotiz, nicht als Auftrag. Da nur drei
   * von 20 Clients `isError` überhaupt auswerten (documentation/07), muss der
   * Befund im Text selbst stehen und laut sein.
   */
  status: string
  checks: {
    url_resolved: boolean | null
    quote_verified: boolean | null
    quote_match_score: number | null
    verdict: string
    note: string
  }
  review_status: Source['review_status']
  duplicate_warning?: string
  hint: string
}

/**
 * Erfasst eine Quelle MIT Provenienz und prüft den Beleg SOFORT deterministisch.
 * Das Prüfergebnis geht an den Aufrufer zurück, damit ein falsches Zitat
 * im selben Arbeitsschritt korrigiert wird statt unbemerkt zu bleiben.
 */
export async function recordSource(repo: Repo, rawInput: unknown, actor: string): Promise<RecordSourceResult> {
  const input = parseOrThrow(sourceInputSchema, rawInput, 'source_invalid')
  assertProject(repo, input.project_id)
  assertCorpusWritable(repo, input.project_id)

  // Leerstring ist keine Zuordnung — sonst schlägt der Fremdschlüssel roh zu und die
  // Quelle geht verloren, statt sauber als "nicht zugeordnet" zu landen.
  if (input.sub_question_id !== undefined && input.sub_question_id !== null && input.sub_question_id.trim() === '') {
    input.sub_question_id = null
  }

  if (input.sub_question_id) {
    const sq = repo.getSubQuestion(input.sub_question_id)
    if (!sq) {
      throw new ServiceError(
        'subquestion_not_found',
        `Teilfrage ${input.sub_question_id} existiert nicht.`,
        'Rufe get_coverage_gaps auf und übernimm eine der dort genannten entity_id als sub_question_id. Erfinde keine ID.'
      )
    }
    if (sq.project_id !== input.project_id) {
      throw new ServiceError(
        'subquestion_project_mismatch',
        `Teilfrage ${input.sub_question_id} gehört zu Projekt ${sq.project_id}, nicht zu ${input.project_id}.`,
        'Prüfe, in welchem Projekt du arbeitest, und nimm eine Teilfrage AUS DIESEM Projekt — get_coverage_gaps listet sie.'
      )
    }
  }

  const duplicates = repo.listSources(input.project_id).filter((s) => s.url === input.url)

  // --- Offset-Zitat: der Server SCHNEIDET das Zitat aus dem selbst gespeicherten Text.
  // Das Modell kann hier nichts erfinden, es kann nur auf vorhandenen Text zeigen.
  let quote = input.verbatim_quote
  let doc: FetchedDocument | undefined
  if (input.document_id) {
    doc = repo.getDocument(input.document_id)
    if (!doc) {
      throw new ServiceError(
        'document_not_found',
        `Dokument ${input.document_id} existiert nicht.`,
        'Rufe die Quelle zuerst mit fetch_source ab und übernimm die document_id AUS DESSEN Antwort. Erfinde keine ID.'
      )
    }
    if (doc.project_id !== input.project_id) {
      throw new ServiceError(
        'document_project_mismatch',
        `Dokument ${input.document_id} gehört zu Projekt ${doc.project_id}, nicht zu ${input.project_id}.`,
        'Rufe die Quelle mit fetch_source im richtigen Projekt erneut ab und nimm die dabei zurückgegebene document_id.'
      )
    }
    const start = input.quote_start!
    const end = input.quote_end!
    if (end > doc.char_len) {
      throw new ServiceError(
        'quote_range_invalid',
        `quote_end=${end} liegt hinter dem Dokumentende (${doc.char_len} Zeichen).`,
        `Wähle quote_start/quote_end innerhalb von 0–${doc.char_len}. Kennst du die Stelle noch nicht, ` +
          'lies das Dokument mit fetch_source(offset=…) weiter und nimm die Positionen aus dem zurückgegebenen Fenster.'
      )
    }
    const sliced = doc.text.slice(start, end)
    if (sliced.trim().length < 20) {
      throw new ServiceError(
        'quote_too_short',
        `Der Bereich ${start}–${end} enthält nur ${sliced.trim().length} Zeichen Text (mindestens 20 nötig).`,
        'Vergrößere den Bereich: Wähle quote_start/quote_end so, dass ein vollständiger, für sich verständlicher Satz darin steht.'
      )
    }
    if (sliced.length > 2000) {
      throw new ServiceError(
        'quote_too_long',
        `Der Bereich ${start}–${end} umfasst ${sliced.length} Zeichen (höchstens 2000).`,
        'Verkleinere den Bereich auf die Sätze, die die Aussage TATSÄCHLICH belegen. Für weitere Stellen derselben Quelle nutze log_extraction.'
      )
    }
    // Wurde zusätzlich ein Zitattext geliefert, MUSS er exakt passen — sonst hat das
    // Modell einen Text erfunden und Offsets dazu geraten.
    if (input.verbatim_quote && input.verbatim_quote.trim() !== sliced.trim()) {
      throw new ServiceError(
        'quote_mismatch',
        `Das angegebene verbatim_quote stimmt nicht mit dem Text an Position ${start}–${end} überein.\n` +
          `Dort steht: "${sliced.slice(0, 200)}"`,
        'Lass verbatim_quote weg — der Server setzt es aus den Offsets ein. Oder korrigiere die Offsets.'
      )
    }
    quote = sliced
  }

  const source = repo.addSource({
    project_id: input.project_id,
    url: input.url,
    title: input.title,
    retrieval_method: input.retrieval_method,
    accessed_at: input.accessed_at ?? new Date().toISOString(),
    reason: input.reason,
    extraction: input.extraction,
    contribution: input.contribution,
    verbatim_quote: quote!,
    quote_locator: input.quote_locator ?? null,
    confidence: input.confidence ?? null,
    sub_question_id: input.sub_question_id ?? null,
    document_id: input.document_id ?? null,
    quote_start: input.quote_start ?? null,
    quote_end: input.quote_end ?? null,
    source_kind: input.source_kind ?? null,
    actor,
  })

  let stored = source
  try {
    stored = await enrichSourceBiblio(repo, source, input.doi)
  } catch {
    stored = source
  }

  let check: { urlResolved: boolean | null; quoteVerified: boolean | null; quoteMatchScore: number | null; verdict: string; note: string }

  if (doc) {
    // Kein Netzabruf nötig: das Zitat stammt per Konstruktion aus dem gespeicherten Text.
    const note = `offset_exact: Zeichen ${input.quote_start}–${input.quote_end} aus Dokument ${doc.id} (Hash ${doc.content_hash})`
    repo.setSourceChecks(source.id, { urlResolved: true, quoteVerified: true, quoteMatchScore: 1 }, actor)
    repo.addReview({
      entity_type: 'source',
      entity_id: source.id,
      reviewer_type: 'deterministic',
      reviewer_id: actor,
      verdict: 'supported',
      confidence: 'high',
      evidence_span: quote!.slice(0, 500),
      source_snapshot_hash: doc.content_hash,
      note,
      method: 'offset_exact',
    })
    repo.setDocumentStatus(doc.id, 'used', actor)
    check = { urlResolved: true, quoteVerified: true, quoteMatchScore: 1, verdict: 'supported', note }
  } else {
    // Enforcement Ebene 1: deterministisch, kein Modell.
    const det = await verifySourceDeterministic(repo, source, actor)
    check = {
      urlResolved: det.urlResolved,
      quoteVerified: det.quoteVerified,
      quoteMatchScore: det.quoteMatchScore,
      verdict: det.verdict,
      note: det.note,
    }
    repo.closeOpenDocumentsForUrl(input.project_id, input.url, 'used', actor)
  }

  // Was zählt: nur ein deterministisch bestätigtes Zitat (oder menschlicher Sign-off)
  // geht in die Abdeckungsrechnung ein — siehe Repo.VERIFIED_SQL. Ein durchgefallener
  // Beleg ist deshalb kein Schönheitsfehler, sondern eine blockierende Lücke.
  const failed = !doc && check.quoteVerified === false
  const unchecked = !doc && check.quoteVerified === null

  return {
    source: repo.getSource(stored.id)!,
    stored: true,
    status: doc
      ? 'OK — Zitat serverseitig aus dem gespeicherten Dokument geschnitten, exakt per Konstruktion.'
      : failed
        ? 'ACHTUNG — BELEG NICHT VERIFIZIERT: Das angegebene Zitat steht so NICHT im Quelltext. ' +
          'Der Eintrag ist zwar gespeichert, zählt aber NICHT zur Abdeckung und blockiert den Bericht. Das ist noch nicht erledigt.'
        : unchecked
          ? 'ACHTUNG — BELEG UNGEPRÜFT: Die Quelle war maschinell nicht prüfbar (PDF, Paywall oder nicht erreichbar). ' +
            'Der Eintrag zählt NICHT zur Abdeckung, bis ein Mensch ihn in der App signiert.'
          : 'OK — Beleg im Quelltext verifiziert.',
    review_status: check.verdict === 'supported' ? 'ai_checked' : 'pending',
    checks: {
      url_resolved: check.urlResolved,
      quote_verified: check.quoteVerified,
      quote_match_score: check.quoteMatchScore,
      verdict: check.verdict,
      note: check.note,
    },
    duplicate_warning:
      duplicates.length > 0
        ? `ACHTUNG: Für diese URL existieren bereits ${duplicates.length} Einträge (${duplicates.map((d) => d.id).join(', ')}). ` +
          `Falls dies eine Korrektur war, markiere die alten Einträge mit flag_uncertainty als überholt. ` +
          `Für weitere Erkenntnisse aus derselben Quelle log_extraction statt add_source nutzen.`
        : undefined,
    hint: doc
      ? 'Weiter zur nächsten offenen Lücke aus get_coverage_gaps. Den menschlichen Sign-off holt der Mensch in der App — dich betrifft er nicht.'
      : failed
        ? 'TU JETZT: Rufe die Quelle mit fetch_source ab, suche die Stelle im zurückgegebenen Text und erfasse sie erneut ' +
          'mit document_id + quote_start + quote_end. Dann schneidet der Server das Zitat selbst und der Fehler ist ausgeschlossen. ' +
          'Trägt die Quelle die Aussage doch nicht, schließe sie mit exclude_source begründet aus. Geh nicht einfach weiter.'
        : unchecked
          ? 'TU JETZT: Suche eine frei zugängliche HTML-Fassung und erfasse sie mit fetch_source + document_id + Offsets erneut. ' +
            'Gibt es keine, belasse es dabei und nenne die Quelle im Bericht ausdrücklich als menschlich zu prüfen.'
          : 'Weiter zur nächsten offenen Lücke aus get_coverage_gaps. Künftig besser: fetch_source + document_id + Offsets — ' +
            'dann kann die Zitatprüfung gar nicht erst durchfallen.',
  }
}

// ---------------------------------------------------------------- Suche & Ausschluss

export function recordSearch(repo: Repo, rawInput: unknown, actor: string): SearchLogEntry {
  const input = parseOrThrow(searchInputSchema, rawInput, 'search_invalid')
  assertProject(repo, input.project_id)
  return repo.addSearchLog({
    project_id: input.project_id,
    query: input.query,
    engine: input.engine ?? null,
    results_found: input.results_found ?? null,
    note: input.note ?? null,
    actor,
  })
}

/**
 * Suchprotokoll vom Cursor-Hook (POST /ingest/search).
 * project_id fehlt oft: Fallback ROP_PROJECT_ID, sonst das zuletzt aktualisierte Projekt.
 */
export const ingestSearchSchema = z.object({
  project_id: z.string().min(1).optional(),
  query: z.string().min(2),
  provider: z.string().min(1).optional(),
  engine: z.string().optional(),
  hit_count: z.number().int().min(0).optional(),
  results_found: z.number().int().min(0).optional(),
  urls: z.array(z.string()).optional(),
  note: z.string().optional(),
})

export function resolveIngestProjectId(repo: Repo, explicit?: string | null): string {
  if (explicit) {
    assertProject(repo, explicit)
    return explicit
  }
  const fromEnv = process.env.ROP_PROJECT_ID?.trim()
  if (fromEnv) {
    assertProject(repo, fromEnv)
    return fromEnv
  }
  const latest = repo.listProjects()[0]
  if (latest) return latest.id
  throw new ServiceError(
    'no_project',
    'Kein Projekt vorhanden — die Suche kann nicht protokolliert werden.',
    'Lege zuerst mit create_project ein Projekt an, dann wiederhole die Suche.'
  )
}

export function ingestSearch(repo: Repo, rawInput: unknown, actor: string): SearchLogEntry {
  const input = parseOrThrow(ingestSearchSchema, rawInput, 'search_invalid')
  const projectId = resolveIngestProjectId(repo, input.project_id)
  const urls = (input.urls ?? []).map((u) => u.trim()).filter(Boolean).slice(0, 20)
  const hitCount = input.hit_count ?? input.results_found ?? (urls.length > 0 ? urls.length : null)
  const noteParts = [input.note, urls.length > 0 ? `urls: ${urls.join(' ')}` : null].filter(Boolean)
  return recordSearch(
    repo,
    {
      project_id: projectId,
      query: input.query,
      engine: input.provider ?? input.engine ?? 'cursor-websearch',
      results_found: hitCount,
      note: noteParts.length > 0 ? noteParts.join(' | ') : null,
    },
    actor
  )
}

export function recordExclusion(repo: Repo, rawInput: unknown, actor: string): ExcludedSource {
  const input = parseOrThrow(exclusionInputSchema, rawInput, 'exclusion_invalid')
  assertProject(repo, input.project_id)
  assertCorpusWritable(repo, input.project_id)
  const entry = repo.addExcludedSource({
    project_id: input.project_id,
    url: input.url,
    title: input.title ?? null,
    reason: input.reason,
    actor,
  })
  // Ein begründeter Ausschluss erfüllt die Dokumentationspflicht für diese URL.
  repo.closeOpenDocumentsForUrl(input.project_id, input.url, 'excluded', actor)
  return entry
}

// ---------------------------------------------------------------- Claims

export function linkClaim(repo: Repo, rawInput: unknown, actor: string): { claim_id: string; link: ClaimSourceLink } {
  const input = parseOrThrow(linkInputSchema, rawInput, 'link_invalid')
  assertProject(repo, input.project_id)

  if (input.claim_id) {
    const existing = repo.getClaim(input.claim_id)
    if (!existing) {
      throw new ServiceError(
        'claim_not_found',
        `Claim ${input.claim_id} existiert nicht.`,
        'Lass claim_id weg und gib stattdessen claim_text an — der Claim wird dann angelegt. Bestehende Claims listet get_project_state.'
      )
    }
    if (existing.project_id !== input.project_id) {
      throw new ServiceError(
        'claim_project_mismatch',
        `Claim ${input.claim_id} gehört zu Projekt ${existing.project_id}, nicht zu ${input.project_id}.`,
        'Nimm einen Claim AUS DIESEM Projekt (get_project_state) — oder lass claim_id weg und gib claim_text an.'
      )
    }
  } else if (!input.claim_text) {
    throw new ServiceError(
      'claim_missing',
      'Entweder claim_id oder claim_text angeben.',
      'Gib claim_text mit der Aussage an, die belegt werden soll — sie wird dann als neuer Claim angelegt.'
    )
  }

  // Claim-Anlage und Belegkante als EINE Einheit: scheitert die Kante (z. B. unbekannte
  // source_id), darf kein unbelegter Waisen-Claim zurückbleiben, der das Gate dauerhaft
  // blockiert (Review-Finding).
  try {
    return repo.runInTransaction(() => {
      const claimId =
        input.claim_id ??
        repo.addClaim({
          project_id: input.project_id,
          claim_text: input.claim_text!,
          report_section: input.report_section ?? null,
          actor,
        }).id
      const link = repo.linkClaimToSource({
        claim_id: claimId,
        source_id: input.source_id,
        quote_span: input.quote_span,
        support_type: input.support_type,
        confidence: input.confidence ?? null,
        actor,
      })
      return { claim_id: claimId, link }
    })
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throw new ServiceError(
      'link_failed',
      err instanceof Error ? err.message : String(err),
      'Prüfe zuerst, ob die source_id existiert (search_sources oder get_project_state), und rufe dann erneut auf. ' +
        'Es wurde weder ein Claim noch eine Belegkante angelegt.'
    )
  }
}

// ---------------------------------------------------------------- Teilfragen

export function planResearch(
  repo: Repo,
  input: { project_id: string; sub_questions?: unknown[] },
  actor: string
): { sub_questions: SubQuestion[]; round: ResearchRound } {
  assertProject(repo, input.project_id)
  requireAdoptedBrief(repo, input.project_id)
  const brief = repo.getAdoptedBrief(input.project_id)
  let raw = input.sub_questions
  if (!Array.isArray(raw) || raw.length === 0) {
    raw = (brief?.sub_questions ?? []).map((question) => ({
      question,
      rationale: 'Aus dem adoptierten Research-Brief.',
    }))
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ServiceError(
      'plan_empty',
      'Mindestens eine Teilfrage angeben.',
      'Zerlege die Forschungsfrage in 3–8 unabhängig recherchierbare Teilfragen — oder übernimm sie aus dem Brief, indem du sub_questions weglässt.'
    )
  }
  const parsed = raw.map((q) => parseOrThrow(subQuestionSchema, q, 'subquestion_invalid'))

  // Duplikate sowohl gegen die DB als auch INNERHALB des Aufrufs abfangen.
  const seen = new Set(repo.listSubQuestions(input.project_id).map((s) => s.question.trim().toLowerCase()))
  const created: SubQuestion[] = []
  for (const q of parsed) {
    const key = q.question.trim().toLowerCase()
    if (seen.has(key)) continue // idempotent bei Nachplanung
    seen.add(key)
    created.push(
      repo.addSubQuestion({
        project_id: input.project_id,
        question: q.question,
        rationale: q.rationale ?? null,
        min_sources: q.min_sources,
        actor,
      })
    )
  }
  const round = repo.openRound(input.project_id, actor)
  return { sub_questions: created, round }
}

// ---------------------------------------------------------------- Abdeckung

const DRY_THRESHOLD = 2
const MAX_ROUNDS = 4

/**
 * Serverseitig berechnete Lückenanalyse — bewusst KEIN Modell-Urteil.
 * Das ist die Abbruchbedingung der Recherche-Schleife: Solange hier Lücken
 * stehen, ist die Recherche nicht fertig, egal was das Modell meint.
 */
export function computeCoverage(repo: Repo, projectId: string): CoverageReport {
  assertProject(repo, projectId)

  const subQuestions = repo.listSubQuestions(projectId)
  const sources = repo.listSources(projectId)
  const claims = repo.listClaims(projectId)
  const links = repo.listLinks(projectId)
  const verifiedPerSq = repo.countVerifiedPerSubQuestion(projectId)
  const assignedPerSq = repo.countAssignedPerSubQuestion(projectId)
  const unlinkedClaims = repo.listUnlinkedClaims(projectId)
  const round = repo.getLatestRound(projectId)

  const gaps: CoverageGap[] = []
  const add = (g: Omit<CoverageGap, 'blocking'> & { blocking?: boolean }) =>
    gaps.push({ blocking: g.blocking ?? true, ...g } as CoverageGap)

  // --- Teilfragen. 'dropped' zählt nicht mit; 'covered' wird unten dynamisch bestimmt.
  const activeSubQuestions = subQuestions.filter((s) => s.status !== 'dropped')
  let coveredCount = 0

  for (const sq of activeSubQuestions) {
    const verified = verifiedPerSq.get(sq.id) ?? 0
    const assigned = assignedPerSq.get(sq.id) ?? 0
    if (verified >= sq.min_sources) {
      coveredCount++
      continue
    }
    if (assigned >= sq.min_sources) {
      // Quellen sind da, aber die Belege halten der Prüfung nicht stand.
      add({
        kind: 'subquestion_unverified',
        entity_id: sq.id,
        label: sq.question,
        detail: `${assigned} unterschiedliche Quelle(n) zugeordnet, aber nur ${verified} von ${sq.min_sources} belegt.`,
        next_action: 'Zitate der zugeordneten Quellen korrigieren (exakter Wortlaut), menschlich signieren oder weitere Belege suchen.',
      })
    } else {
      add({
        kind: 'subquestion_uncovered',
        entity_id: sq.id,
        label: sq.question,
        detail: `${verified} von ${sq.min_sources} belegten Quellen (unterschiedliche URLs).`,
        next_action: `Gezielt zu dieser Teilfrage weitersuchen und Quellen mit sub_question_id="${sq.id}" erfassen.`,
      })
    }
  }

  const activeSources = sources.filter((s) => s.review_status !== 'rejected')
  const signed = (s: (typeof activeSources)[number]) => s.review_status === 'human_signed'

  if (activeSubQuestions.length > 0) {
    for (const s of activeSources.filter((s) => !s.sub_question_id)) {
      add({
        kind: 'source_unassigned',
        entity_id: s.id,
        label: s.title,
        detail: 'Quelle ist keiner Teilfrage zugeordnet und zählt daher nirgends zur Abdeckung.',
        next_action: 'Mit assign_source einer Teilfrage zuordnen — oder die Quelle begründet ausschließen.',
      })
    }
  }

  // Menschlicher Sign-off ist die höchste Stufe der Leiter und löst beide Zitat-Lücken auf —
  // sonst wäre jede PDF-/Paywall-Quelle eine Sackgasse, aus der nur die Ablehnung führt.
  for (const s of activeSources.filter((s) => s.quote_verified === 0 && !signed(s))) {
    add({
      kind: 'source_quote_failed',
      entity_id: s.id,
      label: s.title,
      detail: 'Das wörtliche Zitat wurde im Quelltext NICHT gefunden.',
      next_action:
        'Quelle mit korrigiertem, exaktem Zitat erneut erfassen; die fehlerhafte Fassung danach in der App ablehnen — oder sie nach menschlicher Prüfung signieren.',
    })
  }

  for (const s of activeSources.filter((s) => s.quote_verified === null && !signed(s))) {
    add({
      kind: 'source_quote_unchecked',
      entity_id: s.id,
      label: s.title,
      detail: 'Zitat konnte nicht automatisch geprüft werden (nicht fetchbar/PDF/Paywall).',
      next_action: 'Menschlicher Sign-off in der App — das löst diese Lücke auf. Oder eine maschinell prüfbare Fassung nachreichen.',
    })
  }

  for (const c of unlinkedClaims) {
    add({
      kind: 'claim_unlinked',
      entity_id: c.id,
      label: c.claim_text.slice(0, 120),
      detail: 'Aussage hat keinen tragfähigen Beleg (keine Kante, oder Quelle abgelehnt bzw. Kante widerlegt).',
      next_action: 'Mit link_claim_to_source tragfähig belegen — oder die Aussage aus dem Bericht entfernen.',
    })
  }

  // WIDERLEGTE Kante: blockiert. Genau dafür existiert die geblindete Prüfung.
  const refuted = links.filter((l) => l.verification_status === 'unsupported' || l.verification_status === 'source_unreachable')
  for (const l of refuted) {
    add({
      kind: 'link_refuted',
      entity_id: l.id,
      label: `Belegkante ${l.id.slice(0, 8)}`,
      detail: `Die Verifikation hat diese Belegkante als "${l.verification_status}" beurteilt.`,
      next_action: 'Aussage streichen oder mit einer tragfähigen Quelle neu belegen. Die widerlegte Kante darf nicht im Bericht stehen bleiben.',
    })
  }

  // UNGEPRÜFTE Kante: nur Hinweis. Die geblindete Verify-Session findet laut Ablauf
  // NACH dem Bericht statt — sie hier blockierend zu machen, hätte das Gate unerfüllbar
  // gemacht und systematisch zur Quittierung trainiert (Review-Finding).
  const pending = links.filter((l) => l.verification_status === 'pending')
  for (const l of pending) {
    add({
      kind: 'link_unverified',
      entity_id: l.id,
      label: `Belegkante ${l.id.slice(0, 8)}`,
      detail: 'Belegkante ist noch nicht geblindet geprüft.',
      next_action: 'Nach dem Bericht die geblindete Verify-Session in einer NEUEN Unterhaltung laufen lassen.',
      blocking: false,
    })
  }

  // Belegte Quellen, aber keine einzige Aussage — dann greift das Claim-Gate ins Leere.
  const verifiedCount = repo.countVerifiedSources(projectId)
  if (verifiedCount > 0 && claims.length === 0) {
    add({
      kind: 'claim_missing',
      entity_id: projectId,
      label: 'Keine Aussagen erfasst',
      detail: `${verifiedCount} belegte Quelle(n), aber keine einzige Aussage — ein Bericht ohne verknüpfte Aussagen ist nicht prüfbar.`,
      next_action: 'Die zentralen Aussagen des Berichts per link_claim_to_source mit Quelle und wörtlicher Belegstelle verknüpfen.',
    })
  }

  // Ohne (aktive) Teilfragen lässt sich Abdeckung nicht messen — das ist selbst eine Lücke.
  if (activeSubQuestions.length === 0) {
    add({
      kind: 'no_plan',
      entity_id: projectId,
      label: subQuestions.length === 0 ? 'Keine Teilfragen geplant' : 'Alle Teilfragen verworfen',
      detail: 'Ohne aktive Teilfragen lässt sich Abdeckung nicht messen.',
      next_action: 'plan_research aufrufen und die Forschungsfrage in 3–8 Teilfragen zerlegen.',
    })
  }

  const brief = repo.getAdoptedBrief(projectId)
  if (brief?.min_empirical != null && brief.min_empirical > 0) {
    const empirical = activeSources.filter(
      (s) => s.source_kind === 'empirical' && (s.quote_verified === 1 || signed(s))
    )
    if (empirical.length < brief.min_empirical) {
      add({
        kind: 'empirical_shortfall',
        entity_id: projectId,
        label: `Zu wenige empirische Quellen (${empirical.length}/${brief.min_empirical})`,
        detail: `Der Brief verlangt mindestens ${brief.min_empirical} belegte empirische Paper; aktuell ${empirical.length}.`,
        next_action:
          'Suche gezielt empirische Studien (source_kind=empirical) im Brief-Zeitraum und erfasse sie mit fetch_source + add_source.',
      })
    }
  }
  if (brief && (brief.year_from != null || brief.year_to != null)) {
    const from = brief.year_from ?? 1500
    const to = brief.year_to ?? 2100
    const inRange = activeSources.filter(
      (s) => s.year != null && s.year >= from && s.year <= to && (s.quote_verified === 1 || signed(s))
    )
    if (inRange.length === 0) {
      add({
        kind: 'year_range_shortfall',
        entity_id: projectId,
        label: `Keine belegte Quelle im Zeitraum ${from}–${to}`,
        detail: 'year_from/year_to aus dem Brief steuern die Suche — ohne Treffer in diesem Fenster ist die Coverage unvollständig.',
        next_action: `Rufe search_literature mit year_from=${from} und year_to=${to} auf und belege passende Treffer.`,
      })
    }
  }

  // Selbsturteile sichtbar machen: eine Kante, die dieselbe Session beurteilt hat, ist
  // kein unabhängiger Beleg. Blockiert nicht, gehört aber in die Statistik.
  const blindedLinkIds = new Set(
    repo
      .listReviews(projectId)
      .filter((r) => r.entity_type === 'claim_source_link' && r.method === 'blinded_cross_context')
      .map((r) => r.entity_id)
  )
  const linksSelfjudged = links.filter((l) => l.verification_status !== 'pending' && !blindedLinkIds.has(l.id)).length

  const stats = {
    sub_questions_total: subQuestions.length,
    sub_questions_active: activeSubQuestions.length,
    sub_questions_covered: coveredCount,
    sub_questions_dropped: subQuestions.filter((s) => s.status === 'dropped').length,
    sources_total: activeSources.length,
    sources_verified: verifiedCount,
    sources_quote_failed: activeSources.filter((s) => s.quote_verified === 0 && !signed(s)).length,
    sources_quote_unchecked: activeSources.filter((s) => s.quote_verified === null && !signed(s)).length,
    sources_unassigned: activeSubQuestions.length > 0 ? activeSources.filter((s) => !s.sub_question_id).length : 0,
    claims_total: claims.length,
    claims_unlinked: unlinkedClaims.length,
    links_total: links.length,
    links_pending: pending.length,
    links_refuted: refuted.length,
    links_selfjudged: linksSelfjudged,
    current_round: round?.round_index ?? null,
  }

  gaps.sort((a, b) => Number(b.blocking) - Number(a.blocking))
  const blockingGaps = gaps.filter((g) => g.blocking)
  const readyForReport = blockingGaps.length === 0

  return {
    project_id: projectId,
    ready_for_report: readyForReport,
    gaps,
    blocking_gaps: blockingGaps,
    stats,
    summary: readyForReport
      ? `Bericht freigegeben: ${stats.sub_questions_covered}/${stats.sub_questions_active} Teilfragen abgedeckt, ` +
        `${stats.sources_verified} belegte Quelle(n), alle Aussagen tragfähig belegt.` +
        (stats.links_pending > 0 ? ` Hinweis: ${stats.links_pending} Belegkante(n) warten noch auf die geblindete Prüfung.` : '')
      : `${blockingGaps.length} blockierende Lücke(n) — ` +
        `${stats.sub_questions_active - stats.sub_questions_covered} Teilfrage(n) unzureichend belegt, ` +
        `${stats.sources_quote_failed} Zitat(e) nicht auffindbar, ${stats.claims_unlinked} Aussage(n) ohne tragfähigen Beleg, ` +
        `${stats.links_refuted} widerlegte Belegkante(n).`,
  }
}

/**
 * Schließt die laufende Runde, misst die Sättigung und entscheidet, ob die
 * Schleife weiterlaufen soll. Das ist die Stelle, an der "Deep Research"
 * aufhört, eine Prompt-Absicht zu sein, und ein Abbruchkriterium wird.
 */
export function advanceRound(
  repo: Repo,
  input: { project_id: string; note?: string | null; max_rounds?: number; dry_threshold?: number },
  actor: string
): RoundResult {
  assertProject(repo, input.project_id)
  const maxRounds = input.max_rounds ?? MAX_ROUNDS
  const dryThreshold = input.dry_threshold ?? DRY_THRESHOLD

  const open = repo.getLatestRound(input.project_id)
  if (!open || open.ended_at !== null) {
    throw new ServiceError(
      'no_open_round',
      'Es läuft keine offene Recherche-Runde.',
      'Rufe zuerst plan_research auf — das eröffnet Runde 1.'
    )
  }

  // Eine Runde ohne jede Aktivität darf nicht als "erschöpft" gelten — sonst beendet
  // ein zweiter next_round-Aufruf direkt hintereinander die Recherche (Review-Finding).
  if (repo.countActivity(input.project_id) <= open.activity_at_start) {
    throw new ServiceError(
      'round_without_activity',
      `Runde ${open.round_index} enthält keine Recherche-Aktivität (keine Suche, keine Quelle, kein Ausschluss).`,
      'Arbeite zuerst an den offenen Lücken aus get_coverage_gaps, bevor du die Runde abschließt.'
    )
  }

  let decided: { dry: boolean; stopReason: string | null } | null = null

  const { closed, opened } = repo.advanceRoundAtomic(input.project_id, input.note ?? null, actor, (c) => {
    const newVerified = c.new_verified ?? 0
    const dry = newVerified < dryThreshold
    const cov = computeCoverage(repo, input.project_id)
    let stopReason: string | null = null
    if (cov.ready_for_report) stopReason = 'Alle aktiven Teilfragen abgedeckt, keine blockierenden Lücken.'
    else if (dry) stopReason = `Sättigung erreicht: Runde ${c.round_index} brachte nur ${newVerified} neue belegte Quelle(n) (Schwelle ${dryThreshold}).`
    else if (c.round_index >= maxRounds) stopReason = `Rundendeckel erreicht (${maxRounds}).`
    decided = { dry, stopReason }
    return stopReason === null
  })

  if (!closed || !decided) {
    throw new ServiceError(
      'round_already_closed',
      'Die Runde wurde bereits von einem anderen Client abgeschlossen.',
      'Frage den aktuellen Stand mit get_coverage_gaps ab.'
    )
  }

  const { dry, stopReason } = decided as { dry: boolean; stopReason: string | null }

  return {
    closed_round: closed.round_index,
    new_verified: closed.new_verified ?? 0,
    dry,
    dry_threshold: dryThreshold,
    opened_round: opened?.round_index ?? null,
    should_continue: stopReason === null,
    stop_reason: stopReason,
    coverage: computeCoverage(repo, input.project_id),
  }
}

// ---------------------------------------------------------------- Bericht

/**
 * Berichts-Gate: Solange Lücken offen sind, wird keine Version abgelegt —
 * es sei denn, der Aufrufer quittiert sie ausdrücklich und begründet.
 * Die Quittierung landet im Event-Log und in der change_summary; sie
 * verschwindet also nicht, sondern wird Teil des Prüfpfads.
 */
export function recordReportVersion(
  repo: Repo,
  rawInput: unknown,
  actor: string
): { version: ReportVersion; coverage: CoverageReport } {
  const input = parseOrThrow(reportInputSchema, rawInput, 'report_invalid')
  assertProject(repo, input.project_id)

  // parent_version_id darf nicht auf eine fremde oder erfundene Version zeigen —
  // sonst bricht die Versionskette des Provenienz-Artefakts.
  if (input.parent_version_id) {
    const parent = repo.listReportVersions(input.project_id).find((v) => v.id === input.parent_version_id)
    if (!parent) {
      throw new ServiceError(
        'parent_version_invalid',
        `parent_version_id ${input.parent_version_id} gehört nicht zu Projekt ${input.project_id} (oder existiert nicht).`,
        'Nutze get_project_state, um die aktuelle Versionskette zu lesen.'
      )
    }
  }

  // Prüfen und Schreiben MÜSSEN eine synchrone Transaktion sein: sonst können zwei
  // gleichzeitige Clients beide das Gate passieren und beide schreiben (TOCTOU).
  // better-sqlite3-Transaktionen vertragen kein await — hier ist alles synchron.
  return repo.runInTransaction(() => writeReportChecked(repo, input, actor))
}

function writeReportChecked(
  repo: Repo,
  input: z.infer<typeof reportInputSchema>,
  actor: string
): { version: ReportVersion; coverage: CoverageReport } {
  const coverage = computeCoverage(repo, input.project_id)
  const blocking = coverage.blocking_gaps

  if (!coverage.ready_for_report && !input.acknowledge_gaps) {
    const top = blocking.slice(0, 8).map((g) => `- [${g.kind}] ${g.label}: ${g.detail} → ${g.next_action}`)
    throw new ServiceError(
      'coverage_gaps_open',
      `Bericht abgelehnt: ${blocking.length} blockierende Lücke(n).\n${top.join('\n')}` +
        (blocking.length > top.length ? `\n… und ${blocking.length - top.length} weitere.` : ''),
      'Schließe die Lücken — oder lege bewusst mit acknowledge_gaps=true und gap_acknowledgement="<Begründung>" ab.'
    )
  }

  if (!coverage.ready_for_report && input.acknowledge_gaps && !input.gap_acknowledgement?.trim()) {
    throw new ServiceError(
      'acknowledgement_missing',
      'acknowledge_gaps=true erfordert eine Begründung in gap_acknowledgement.',
      'Beschreibe, warum der Bericht trotz offener Lücken abgelegt wird — das wird im Prüfpfad festgehalten.'
    )
  }

  const acknowledged = !coverage.ready_for_report
  // Die Quittierung steht VORNE in der change_summary — der Markdown-Export kürzt das
  // Feld, und hinten angehängt wäre der Warnhinweis stillschweigend verschwunden
  // (Review-Finding: Berichte mit offenen Lücken sahen im Artefakt sauber aus).
  const summary = acknowledged
    ? `⚠️ MIT ${blocking.length} OFFENEN LÜCKEN ABGELEGT: ${input.gap_acknowledgement}` +
      (input.change_summary ? ` — ${input.change_summary}` : '')
    : (input.change_summary ?? null)

  const version = repo.addReportVersion({
    project_id: input.project_id,
    content_markdown: input.content_markdown,
    parent_version_id: input.parent_version_id ?? null,
    change_summary: summary,
    visual_version_id: input.visual_version_id ?? null,
    mark_scope: input.mark_scope ?? false,
    actor,
  })

  if (acknowledged) {
    repo.logEvent(input.project_id, actor, 'report.gaps_acknowledged', {
      version_id: version.id,
      gap_count: blocking.length,
      gap_kinds: blocking.map((g) => g.kind),
      acknowledgement: input.gap_acknowledgement,
    })
  }

  return { version, coverage }
}
