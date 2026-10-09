import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { basename } from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'
import type { Repo } from '../repo'
import { extractDoi } from '../enforce/fetchers'
import { extractPdfText, MAX_PDF_BYTES } from '../enforce/pdf'
import { sourceToBibtex } from './bibliography-format'
import { assertUnreadWorkBuffer, requireAdoptedBrief, requireSearchReflection, ServiceError } from './research'
import type { Source } from '../../../shared/types'
import { zoteroDocumentUrl } from '../../../shared/zotero-ref'

/**
 * Lokale Zotero-Bibliothek (Desktop muss laufen, Einstellung
 * „Anderen Programmen die Verbindung erlauben“).
 * Lesen: Local API. Schreiben: Connector-Import der BibTeX-Einträge,
 * damit der Citekey mit Better BibTeX erhalten bleibt. Kein zweites MCP.
 */
const BASE = 'http://127.0.0.1:23119'
const READ_MS = 8_000
const WRITE_MS = 120_000

export interface ZoteroHit {
  zotero_key: string
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  citation_key: string | null
  has_pdf: boolean
  /** URL für den Arbeitstisch und für add_source. */
  url: string
  abstract: string | null
}

export interface ZoteroSearchResult {
  query: string
  total: number
  hits: ZoteroHit[]
  search_log_id: string
  hint: string
}

export interface ZoteroIngestResult {
  document_id: string
  zotero_key: string
  citation_key: string | null
  doi: string | null
  source_url: string
  char_len: number
  window: string
  has_more: boolean
  next_action: string
}

export interface ZoteroExportResult {
  created: number
  already: number
  skipped: number
  hint: string
}

interface ZoteroItem {
  key?: string
  data?: Record<string, unknown>
}

const searchSchema = z.object({
  project_id: z.string().min(1),
  query: z.string().min(2),
  limit: z.number().int().min(1).max(25).optional(),
})

const ingestSchema = z.object({
  project_id: z.string().min(1),
  zotero_key: z.string().regex(/^[A-Z0-9]{8}$/i, 'Zotero-Item-Key hat 8 Zeichen'),
})

function offline(err: unknown): ServiceError {
  const detail = err instanceof Error ? err.message : String(err)
  return new ServiceError(
    'zotero_offline',
    `Zotero ist nicht erreichbar (${detail}).`,
    'Zotero starten und unter Einstellungen → Erweitert „Anderen Programmen auf diesem Computer die Verbindung mit Zotero erlauben“ einschalten. Danach erneut versuchen. Bis dahin bleibt der RIS-Export der Weg in die Bibliothek.'
  )
}

async function zoteroFetch(url: string, init: RequestInit & { timeout: number }): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeout)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (err) {
    throw offline(err)
  } finally {
    clearTimeout(timer)
  }
}

export async function zoteroStatus(): Promise<{ running: boolean; message: string }> {
  try {
    const res = await zoteroFetch(`${BASE}/connector/ping`, { method: 'GET', timeout: 2_000 })
    if (!res.ok) return { running: false, message: `Zotero antwortet mit HTTP ${res.status}.` }
    return { running: true, message: 'Zotero läuft und nimmt Verbindungen an.' }
  } catch (err) {
    return { running: false, message: err instanceof ServiceError ? err.message : 'Zotero ist nicht erreichbar.' }
  }
}

function asItem(raw: unknown): ZoteroItem | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as ZoteroItem
}

function dataOf(item: ZoteroItem): Record<string, unknown> {
  return item.data && typeof item.data === 'object' ? item.data : {}
}

function itemKey(item: ZoteroItem): string {
  const data = dataOf(item)
  const key = typeof item.key === 'string' ? item.key : typeof data.key === 'string' ? data.key : ''
  return key
}

function readCitekey(item: ZoteroItem): string | null {
  const data = dataOf(item)
  if (typeof data.citationKey === 'string' && data.citationKey.trim()) return data.citationKey.trim()
  const extra = typeof data.extra === 'string' ? data.extra : ''
  const line = extra.split(/\r?\n/).find((row) => /^citation key:\s*\S+/i.test(row))
  if (!line) return null
  return line.replace(/^citation key:\s*/i, '').trim() || null
}

function readDoi(item: ZoteroItem): string | null {
  const data = dataOf(item)
  const raw = typeof data.DOI === 'string' ? data.DOI : typeof data.url === 'string' ? data.url : ''
  return extractDoi(raw)
}

function readYear(item: ZoteroItem): number | null {
  const data = dataOf(item)
  const date = typeof data.date === 'string' ? data.date : ''
  const match = date.match(/\d{4}/)
  return match ? Number(match[0]) : null
}

function readAuthors(item: ZoteroItem): string[] {
  const data = dataOf(item)
  if (!Array.isArray(data.creators)) return []
  return data.creators
    .slice(0, 12)
    .map((creator) => {
      const rec = creator as { name?: string; firstName?: string; lastName?: string; creatorType?: string }
      if (rec.creatorType && rec.creatorType !== 'author') return ''
      if (typeof rec.name === 'string' && rec.name.trim()) return rec.name.trim()
      return [rec.firstName, rec.lastName].filter(Boolean).join(' ').trim()
    })
    .filter(Boolean)
}

function readTitle(item: ZoteroItem): string {
  const data = dataOf(item)
  return typeof data.title === 'string' && data.title.trim() ? data.title.trim() : '(ohne Titel)'
}

function isTopLevelWork(item: ZoteroItem): boolean {
  const type = String(dataOf(item).itemType ?? '')
  return type !== 'attachment' && type !== 'note' && type !== 'annotation'
}

async function searchItems(query: string, limit: number): Promise<ZoteroItem[]> {
  const url =
    `${BASE}/api/users/0/items/top?q=${encodeURIComponent(query)}` +
    `&qmode=everything&limit=${limit}&format=json`
  const res = await zoteroFetch(url, {
    method: 'GET',
    timeout: READ_MS,
    headers: { accept: 'application/json', 'Zotero-API-Version': '3' },
  })
  if (!res.ok) {
    throw new ServiceError(
      'zotero_search_failed',
      `Zotero-Suche antwortet mit HTTP ${res.status}.`,
      'Prüfe, ob Zotero läuft und die lokale Verbindung erlaubt ist.'
    )
  }
  const body = (await res.json()) as unknown
  return Array.isArray(body) ? body.map(asItem).filter((item): item is ZoteroItem => item != null) : []
}

async function itemChildren(key: string): Promise<ZoteroItem[]> {
  const res = await zoteroFetch(`${BASE}/api/users/0/items/${encodeURIComponent(key)}/children?format=json`, {
    method: 'GET',
    timeout: READ_MS,
    headers: { accept: 'application/json', 'Zotero-API-Version': '3' },
  })
  if (!res.ok) return []
  const body = (await res.json()) as unknown
  return Array.isArray(body) ? body.map(asItem).filter((item): item is ZoteroItem => item != null) : []
}

function isPdfAttachment(item: ZoteroItem): boolean {
  const data = dataOf(item)
  if (data.itemType !== 'attachment') return false
  const content = typeof data.contentType === 'string' ? data.contentType : ''
  const filename = typeof data.filename === 'string' ? data.filename : typeof data.title === 'string' ? data.title : ''
  return /pdf/i.test(content) || filename.toLowerCase().endsWith('.pdf')
}

async function hasPdf(key: string): Promise<boolean> {
  const children = await itemChildren(key)
  return children.some(isPdfAttachment)
}

function hitFromItem(item: ZoteroItem, pdf: boolean): ZoteroHit | null {
  const key = itemKey(item)
  if (!key || !isTopLevelWork(item)) return null
  const doi = readDoi(item)
  const data = dataOf(item)
  const abstract = typeof data.abstractNote === 'string' ? data.abstractNote.slice(0, 600) : null
  return {
    zotero_key: key,
    title: readTitle(item),
    authors: readAuthors(item),
    year: readYear(item),
    doi,
    citation_key: readCitekey(item),
    has_pdf: pdf,
    url: doi ? `https://doi.org/${doi}` : `zotero://select/library/items/${key}`,
    abstract,
  }
}

export async function searchZotero(repo: Repo, raw: unknown, actor: string): Promise<ZoteroSearchResult> {
  const parsed = searchSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ServiceError(
      'zotero_invalid',
      'Eingabe ungültig — ' + parsed.error.issues.map((issue) => issue.message).join('; '),
      'query ist der Suchtext, project_id kommt aus get_project_state.'
    )
  }
  const input = parsed.data
  if (!repo.getProject(input.project_id)) {
    throw new ServiceError('project_not_found', `Projekt ${input.project_id} existiert nicht.`, 'Rufe list_projects auf.')
  }
  requireAdoptedBrief(repo, input.project_id)
  requireSearchReflection(repo, input.project_id)
  const limit = input.limit ?? 12

  let items: ZoteroItem[]
  try {
    items = await searchItems(input.query, limit)
  } catch (err) {
    repo.addSearchLog({
      project_id: input.project_id,
      query: input.query,
      engine: 'Zotero',
      results_found: null,
      note: `FEHLGESCHLAGEN: ${err instanceof Error ? err.message : String(err)}`,
      actor,
    })
    throw err
  }

  const hits: ZoteroHit[] = []
  for (const item of items) {
    if (!isTopLevelWork(item)) continue
    const key = itemKey(item)
    const pdf = key ? await hasPdf(key) : false
    const hit = hitFromItem(item, pdf)
    if (hit) hits.push(hit)
    if (hits.length >= limit) break
  }

  const log = repo.addSearchLog({
    project_id: input.project_id,
    query: input.query,
    engine: 'Zotero',
    results_found: hits.length,
    note: `${hits.filter((hit) => hit.has_pdf).length} mit PDF`,
    actor,
  })
  repo.upsertScreeningHits(
    input.project_id,
    hits.map((hit) => ({
      title: hit.title,
      authors: hit.authors,
      year: hit.year,
      doi: hit.doi,
      url: hit.url,
      oa_url: hit.has_pdf ? hit.url : null,
      venue: null,
      abstract: hit.abstract,
      cited_by_count: null,
      is_open_access: hit.has_pdf,
      found_via: ['zotero'],
    })),
    { query: input.query, search_log_id: log.id, actor }
  )

  return {
    query: input.query,
    total: hits.length,
    hits,
    search_log_id: log.id,
    hint:
      hits.length === 0
        ? 'Nichts in Zotero zu dieser Suche. Das ist eine Lage: reflect_search, danach die offenen Register.'
        : `${hits.length} Treffer aus der lokalen Bibliothek. PDFs mit ingest_zotero_pdf (zotero_key) in den Korpus holen, dann add_source mit Offsets. ` +
          'Ohne PDF kein Beleg aus Zotero. Abstracts sind keine Quelle. Danach reflect_search, bevor du woanders suchst.',
  }
}

async function loadItem(key: string): Promise<ZoteroItem> {
  const res = await zoteroFetch(`${BASE}/api/users/0/items/${encodeURIComponent(key)}?format=json`, {
    method: 'GET',
    timeout: READ_MS,
    headers: { accept: 'application/json', 'Zotero-API-Version': '3' },
  })
  if (res.status === 404) {
    throw new ServiceError(
      'zotero_item_missing',
      `Zotero-Eintrag ${key} gibt es nicht.`,
      'Nimm zotero_key aus search_zotero.'
    )
  }
  if (!res.ok) {
    throw new ServiceError('zotero_item_failed', `Zotero-Eintrag ${key}: HTTP ${res.status}.`, 'Suche erneut mit search_zotero.')
  }
  const item = asItem(await res.json())
  if (!item) throw new ServiceError('zotero_item_failed', `Zotero-Eintrag ${key} ist leer.`, 'Suche erneut mit search_zotero.')
  return item
}

async function pdfPath(key: string): Promise<string> {
  const children = await itemChildren(key)
  const pdf = children.find(isPdfAttachment)
  const attachmentKey = pdf ? itemKey(pdf) : ''
  if (!attachmentKey) {
    throw new ServiceError(
      'zotero_no_pdf',
      `Am Zotero-Eintrag ${key} hängt kein PDF.`,
      'Hänge das PDF in Zotero an oder lies die DOI mit fetch_source, wenn sie offen im Netz liegt.'
    )
  }
  const res = await zoteroFetch(`${BASE}/api/users/0/items/${encodeURIComponent(attachmentKey)}/file/view/url`, {
    method: 'GET',
    timeout: READ_MS,
  })
  if (!res.ok) {
    throw new ServiceError(
      'zotero_pdf_path',
      `Zotero gibt den Dateipfad nicht heraus (HTTP ${res.status}).`,
      'Prüfe, ob das PDF in Zotero wirklich gespeichert ist und nicht nur ein Link auf eine Website.'
    )
  }
  const raw = (await res.text()).trim()
  if (!raw.startsWith('file:')) {
    throw new ServiceError('zotero_pdf_path', `Unerwarteter Dateipfad von Zotero: ${raw.slice(0, 120)}`, 'Das PDF in Zotero öffnen und prüfen, ob die Datei lokal liegt.')
  }
  let path: string
  try {
    path = fileURLToPath(raw)
  } catch {
    throw new ServiceError('zotero_pdf_path', `Der Dateipfad lässt sich nicht lesen: ${raw.slice(0, 120)}`, 'Das PDF in Zotero erneut anhängen.')
  }
  if (!path.toLowerCase().endsWith('.pdf') || !existsSync(path)) {
    throw new ServiceError(
      'zotero_pdf_missing',
      `Die PDF-Datei liegt nicht mehr unter ${path}.`,
      'In Zotero die Anlage öffnen. Fehlt sie, das PDF neu an den Eintrag hängen.'
    )
  }
  return path
}

export async function ingestZoteroPdf(repo: Repo, raw: unknown, actor: string): Promise<ZoteroIngestResult> {
  const parsed = ingestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ServiceError(
      'zotero_invalid',
      'Eingabe ungültig — ' + parsed.error.issues.map((issue) => issue.message).join('; '),
      'zotero_key aus search_zotero, project_id aus get_project_state.'
    )
  }
  const input = parsed.data
  if (!repo.getProject(input.project_id)) {
    throw new ServiceError('project_not_found', `Projekt ${input.project_id} existiert nicht.`, 'Rufe list_projects auf.')
  }
  requireAdoptedBrief(repo, input.project_id)
  const item = await loadItem(input.zotero_key)
  const citekey = readCitekey(item)
  const doi = readDoi(item)
  const docUrl = zoteroDocumentUrl(input.zotero_key, citekey)
  const existing = repo.listDocuments(input.project_id).find((doc) => doc.url === docUrl || doc.url.startsWith(`zotero://select/library/items/${input.zotero_key}`))
  if (existing && existing.status !== 'excluded') {
    const text = repo.getDocument(existing.id)?.text ?? ''
    return {
      document_id: existing.id,
      zotero_key: input.zotero_key,
      citation_key: citekey,
      doi,
      source_url: doi ? `https://doi.org/${doi}` : `zotero://select/library/items/${input.zotero_key}`,
      char_len: text.length,
      window: text.slice(0, 8000),
      has_more: text.length > 8000,
      next_action: 'PDF liegt schon im Korpus. add_source mit dieser document_id und Offsets aus dem Fenster. Die Zotero-Citekey bleibt erhalten.',
    }
  }
  assertUnreadWorkBuffer(repo, input.project_id)
  const path = await pdfPath(input.zotero_key)
  const bytes = readFileSync(path)
  if (bytes.length > MAX_PDF_BYTES) {
    throw new ServiceError(
      'zotero_pdf_too_large',
      `Das PDF ist ${bytes.length} Bytes groß (Maximum ${MAX_PDF_BYTES}).`,
      'Eine kleinere Fassung an den Zotero-Eintrag hängen oder die DOI offen im Netz mit fetch_source lesen.'
    )
  }
  const extracted = await extractPdfText(new Uint8Array(bytes))
  if (!extracted.text.trim()) {
    throw new ServiceError(
      'zotero_pdf_empty',
      'Aus dem Zotero-PDF konnte kein Text gelesen werden.',
      'Scan ohne Textschicht. add_source ohne document_id nur mit menschlicher Prüfung, oder eine durchsuchbare PDF in Zotero legen.'
    )
  }
  const filename = basename(path)
  const doc = repo.addDocument({
    project_id: input.project_id,
    url: docUrl,
    title: readTitle(item),
    text: extracted.text,
    content_hash: createHash('sha256').update(bytes).digest('hex'),
    purpose: 'PDF aus Zotero',
    actor,
    origin: 'fetched',
    filename,
    page_starts: extracted.pageStarts,
  })
  const sourceUrl = doi ? `https://doi.org/${doi}` : `zotero://select/library/items/${input.zotero_key}`
  repo.markScreeningFetched(input.project_id, sourceUrl, doc.id, doi, actor)
  return {
    document_id: doc.id,
    zotero_key: input.zotero_key,
    citation_key: citekey,
    doi,
    source_url: sourceUrl,
    char_len: extracted.text.length,
    window: extracted.text.slice(0, 8000),
    has_more: extracted.text.length > 8000,
    next_action:
      'add_source mit document_id und quote_start/quote_end aus diesem Fenster. source url ist source_url. ' +
      (citekey ? `Citekey ${citekey} kommt aus Zotero und wird beibehalten. ` : '') +
      'Nicht aus dem Abstract zitieren.',
  }
}

function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function sameWork(item: ZoteroItem, source: Source): boolean {
  const doi = readDoi(item)
  if (source.doi && doi && doi === source.doi.toLowerCase()) return true
  const key = readCitekey(item)
  if (source.citekey && key && key.toLowerCase() === source.citekey.toLowerCase()) return true
  const title = norm(readTitle(item))
  const year = readYear(item)
  return title.length > 0 && title === norm(source.title) && year != null && year === source.year
}

function bibtexForZotero(source: Source, projectTitle: string): string {
  const raw = sourceToBibtex(source).replace(/\n\}$/, '')
  const tag = `apROPos, ${projectTitle}`.replace(/[{}\\]/g, '').slice(0, 180)
  return `${raw},\n  keywords = {${tag}}\n}\n`
}

export async function exportSignedToZotero(repo: Repo, projectId: string): Promise<ZoteroExportResult> {
  const project = repo.getProject(projectId)
  if (!project) {
    throw new ServiceError('project_not_found', `Projekt ${projectId} existiert nicht.`, 'Rufe list_projects auf.')
  }
  const adopted = repo.listSources(projectId).filter((source) => source.review_status === 'human_signed')
  const signed = adopted.filter((source) => source.citekey)
  const skipped = adopted.length - signed.length
  if (signed.length === 0) {
    throw new ServiceError(
      'zotero_nothing_to_export',
      'Keine übernommene Quelle mit Citekey.',
      'Zuerst auf dem Human Desk übernehmen. Ohne Citekey legt Zotero keinen stabilen Schlüssel an.'
    )
  }
  await zoteroStatus().then((status) => {
    if (!status.running) {
      throw new ServiceError('zotero_offline', status.message, 'Zotero starten. Der RIS-Export bleibt der Ausweg.')
    }
  })

  const fresh: Source[] = []
  let already = 0
  for (const source of signed) {
    const queries = [source.doi, source.citekey, source.title.slice(0, 80)].filter((q): q is string => !!q && q.length > 1)
    let found = false
    for (const query of queries) {
      const items = await searchItems(query, 8)
      if (items.some((item) => sameWork(item, source))) {
        found = true
        break
      }
    }
    if (found) already += 1
    else fresh.push(source)
  }

  if (fresh.length === 0) {
    return {
      created: 0,
      already,
      skipped,
      hint: `${already} übernommene Quelle${already === 1 ? '' : 'n'} liegen schon in Zotero. Nichts neu angelegt. Better BibTeX exportiert sie für Penwright.`,
    }
  }

  const body = fresh.map((source) => bibtexForZotero(source, project.title)).join('\n')
  const session = `apropos-${projectId.slice(0, 8)}-${Date.now()}`
  let res: Response
  try {
    res = await zoteroFetch(`${BASE}/connector/import?session=${encodeURIComponent(session)}`, {
      method: 'POST',
      timeout: WRITE_MS,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body,
    })
  } catch (err) {
    if (err instanceof ServiceError) throw err
    throw offline(err)
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 240)
    throw new ServiceError(
      'zotero_import_failed',
      `Zotero hat den Import abgelehnt (HTTP ${res.status}). ${detail}`,
      'Einzeln die RIS-Datei importieren. Zotero muss geöffnet bleiben, während der Import übersetzt.'
    )
  }

  return {
    created: fresh.length,
    already,
    skipped,
    hint:
      `${fresh.length} ${fresh.length === 1 ? 'Eintrag' : 'Einträge'} nach Zotero importiert` +
      (already ? `, ${already} waren schon da` : '') +
      '. Schlagwort apROPos. Mit Better BibTeX bleibt die Citekey erhalten. In Penwright diese Bibliothek verknüpfen.',
  }
}
