import { z } from 'zod'
import type { Repo } from '../repo'
import { extractDoi } from '../enforce/fetchers'
import type { BibEntryType, BiblioFoundVia, BiblioSuggestion, Source, SourceKind } from '../../../shared/types'
import { ServiceError } from './research'
import { contactUserAgent, resolveContactEmail } from '../contact-email'

/**
 * Bibliografische Identität — Citekeys sind stabil (nachnameJahrKurztitel),
 * nie aus [S3] abgeleitet. Metadaten kommen aus Crossref/OpenAlex, nicht vom Modell.
 * Die .bib fürs Schreiben enthält nur übernommene Quellen (human_signed).
 */
const TIMEOUT_MS = 8_000

const STOP = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einer',
  'eines',
  'the',
  'a',
  'an',
  'and',
  'und',
  'of',
  'für',
  'for',
  'on',
  'in',
  'im',
  'zu',
  'zur',
  'zum',
  'with',
  'from',
  'über',
  'von',
])

export interface BiblioMeta {
  doi: string | null
  authors: string[]
  year: number | null
  venue: string | null
  title: string | null
  entry_type: BibEntryType
  source_kind: SourceKind
}

export function slugPart(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function citekeyBase(authors: string[], year: number | null, title: string): string {
  const last = authors[0]?.trim().split(/\s+/).pop() || 'anon'
  const y = year && year > 0 ? String(year) : 'nd'
  const words = title
    .split(/[\s:;,.!?/—–-]+/)
    .map(slugPart)
    .filter((w) => w.length > 2 && !STOP.has(w))
  const short = words[0] || 'untitled'
  const base = `${slugPart(last)}${y}${short}`
  return base.length > 0 ? base : 'anonnduntitled'
}

export function allocateCitekey(existing: string[], base: string): string {
  const taken = new Set(existing)
  if (!taken.has(base)) return base
  for (const ch of 'abcdefghijklmnopqrstuvwxyz') {
    const key = `${base}${ch}`
    if (!taken.has(key)) return key
  }
  let n = 2
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

function mapCrossrefType(type: string | undefined): { entry_type: BibEntryType; source_kind: SourceKind } {
  switch (type) {
    case 'journal-article':
      return { entry_type: 'article', source_kind: 'empirical' }
    case 'book':
    case 'monograph':
    case 'edited-book':
      return { entry_type: 'book', source_kind: 'textbook' }
    case 'proceedings-article':
    case 'proceedings':
      return { entry_type: 'inproceedings', source_kind: 'empirical' }
    case 'report':
    case 'posted-content':
    case 'dissertation':
      return { entry_type: 'misc', source_kind: 'grey' }
    default:
      return { entry_type: 'misc', source_kind: 'web' }
  }
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': contactUserAgent() } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

export async function lookupDoi(doi: string): Promise<BiblioMeta | null> {
  const id = doi.replace(/^https?:\/\/doi.org\//i, '').trim().toLowerCase()
  if (!id.startsWith('10.')) return null
  try {
    const data = (await getJson(`https://api.crossref.org/works/${encodeURIComponent(id)}?mailto=${encodeURIComponent(resolveContactEmail())}`)) as {
      message?: Record<string, unknown>
    }
    const it = data.message
    if (!it) return null
    const year = (it.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0] ?? null
    const authors = Array.isArray(it.author)
      ? (it.author as Array<{ given?: string; family?: string }>)
          .slice(0, 12)
          .map((a) => [a.given, a.family].filter(Boolean).join(' '))
          .filter(Boolean)
      : []
    const mapped = mapCrossrefType(typeof it.type === 'string' ? it.type : undefined)
    const title = Array.isArray(it.title) ? String(it.title[0] ?? '') : null
    const venue = Array.isArray(it['container-title']) ? String((it['container-title'] as string[])[0] ?? '') : null
    return {
      doi: id,
      authors,
      year: typeof year === 'number' ? year : null,
      venue,
      title: title || null,
      entry_type: mapped.entry_type,
      source_kind: mapped.source_kind,
    }
  } catch {
    try {
      const data = (await getJson(
        `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(id)}?mailto=${encodeURIComponent(resolveContactEmail())}`
      )) as Record<string, unknown>
      const authors = Array.isArray(data.authorships)
        ? (data.authorships as Array<{ author?: { display_name?: string } }>)
            .slice(0, 12)
            .map((a) => String(a.author?.display_name ?? ''))
            .filter(Boolean)
        : []
      return {
        doi: id,
        authors,
        year: typeof data.publication_year === 'number' ? data.publication_year : null,
        venue: (data.primary_location as { source?: { display_name?: string } } | undefined)?.source?.display_name ?? null,
        title: typeof data.display_name === 'string' ? data.display_name : null,
        entry_type: 'article',
        source_kind: 'empirical',
      }
    } catch {
      return null
    }
  }
}

export async function enrichSourceBiblio(repo: Repo, source: Source, knownDoi?: string | null): Promise<Source> {
  const doi = knownDoi ?? extractDoi(source.url)
  const meta = doi ? await lookupDoi(doi) : null
  return applyLookedUpBiblio(repo, source, meta, doi, { preserveCitekey: false })
}

export function applyLookedUpBiblio(
  repo: Repo,
  source: Source,
  meta: BiblioMeta | null,
  doi: string | null,
  opts?: { preserveCitekey?: boolean }
): Source {
  const authors = meta?.authors?.length ? meta.authors : []
  const year = meta?.year ?? source.year ?? null
  const title = meta?.title || source.title
  const entryType: BibEntryType = meta?.entry_type ?? 'misc'
  const honestType: BibEntryType = doi && entryType === 'article' ? 'article' : doi ? entryType : 'misc'
  const kind: SourceKind = source.source_kind ?? meta?.source_kind ?? (doi ? 'empirical' : 'web')
  const keep = Boolean(opts?.preserveCitekey && source.citekey)
  const citekey = keep
    ? source.citekey
    : allocateCitekey(
        repo.listCitekeys(source.project_id).filter((k) => k !== source.citekey),
        citekeyBase(authors, year, title)
      )
  return repo.setSourceBiblio(source.id, {
    doi: doi ?? meta?.doi ?? null,
    authors_json: authors.length ? JSON.stringify(authors) : source.authors_json,
    year,
    venue: meta?.venue ?? source.venue ?? null,
    entry_type: honestType,
    citekey,
    source_kind: kind,
  })
}

function bibField(value: string): string {
  return value.replace(/[{}]/g, '')
}

function authorsBib(authorsJson: string | null): string {
  if (!authorsJson) return ''
  try {
    const authors = JSON.parse(authorsJson) as string[]
    return authors
      .map((a) => {
        const parts = a.trim().split(/\s+/)
        if (parts.length === 1) return parts[0]
        const family = parts[parts.length - 1]
        const given = parts.slice(0, -1).join(' ')
        return `${family}, ${given}`
      })
      .join(' and ')
  } catch {
    return ''
  }
}

/** APA-Locator: Seite → `p. 12` / `pp. 12–14`. Ohne Zahl: Originaltext, nie ein erfundenes `p. 1`. */
export function formatLocator(locator: string | null | undefined): string | null {
  if (!locator?.trim()) return null
  const t = locator.trim()
  const range = t.match(/(?:(?:pp?|ss?|seiten?)\.?\s*)(\d+)\s*[–-]\s*(\d+)/i)
  if (range) return `pp. ${range[1]}–${range[2]}`
  const single = t.match(/(?:(?:pp?|ss?|seite)\.?\s*)(\d+)\b/i) || t.match(/^(\d+)$/)
  if (single) return `p. ${single[1]}`
  return t
}

export function citeMarker(source: Pick<Source, 'citekey' | 'quote_locator'>, fallbackIndex?: number, withLocator = false): string {
  if (source.citekey) {
    const loc = withLocator ? formatLocator(source.quote_locator) : null
    return loc ? `[@${source.citekey}, ${loc}]` : `[@${source.citekey}]`
  }
  return fallbackIndex != null ? `[S${fallbackIndex}]` : '[S?]'
}

export function sourceToBibtex(source: Source): string {
  const key = source.citekey || `src${source.id.slice(0, 8)}`
  const type = source.entry_type && source.doi ? source.entry_type : 'misc'
  const fields: string[] = []
  const author = authorsBib(source.authors_json)
  if (author) fields.push(`  author = {${bibField(author)}}`)
  fields.push(`  title = {${bibField(source.title)}}`)
  if (type === 'article' && source.venue) fields.push(`  journal = {${bibField(source.venue)}}`)
  else if (source.venue) fields.push(`  howpublished = {${bibField(source.venue)}}`)
  if (source.year) fields.push(`  year = {${source.year}}`)
  if (source.doi) fields.push(`  doi = {${bibField(source.doi)}}`)
  fields.push(`  url = {${source.url}}`)
  if (type === 'misc' || !source.doi) {
    const accessed = source.accessed_at.slice(0, 10)
    fields.push(`  note = {Zugriff am ${accessed}}`)
  }
  return `@${type}{${key},\n${fields.join(',\n')}\n}`
}

export function exportBibliography(repo: Repo, projectId: string, sourceIds?: string[] | null): string {
  if (!repo.getProject(projectId)) {
    throw new ServiceError(
      'project_not_found',
      `Projekt ${projectId} existiert nicht.`,
      'Rufe list_projects auf und verwende eine der dort genannten project_id.'
    )
  }
  let sources = repo.listSources(projectId).filter((s) => s.review_status === 'human_signed')
  if (sourceIds?.length) {
    const want = new Set(sourceIds)
    sources = sources.filter((s) => want.has(s.id))
  }
  if (sources.length === 0) return '% keine übernommenen Quellen\n'
  return sources.map(sourceToBibtex).join('\n\n') + '\n'
}

export function rewriteCiteMarkers(markdown: string, sources: Source[]): string {
  const byIndex = new Map<number, Source>()
  sources.forEach((s, i) => byIndex.set(i + 1, s))
  return markdown.replace(/\[S(\d+)\]/g, (full, n) => {
    const src = byIndex.get(Number(n))
    if (!src?.citekey) return full
    return citeMarker(src, Number(n), true)
  })
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, code: string): z.infer<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new ServiceError(code, `Eingabe ungültig — ${detail}`, 'Korrigiere GENAU die oben genannten Felder und rufe dasselbe Werkzeug erneut auf.')
  }
  return parsed.data
}

function assertResearchSource(repo: Repo, sourceId: string): Source {
  const source = repo.getSource(sourceId)
  if (!source) {
    throw new ServiceError(
      'biblio_source_missing',
      `Quelle ${sourceId} existiert nicht.`,
      'Rufe get_project_state auf und nimm eine source_id aus diesem Projekt.'
    )
  }
  const project = repo.getProject(source.project_id)
  if (project?.kind !== 'research') {
    throw new ServiceError(
      'biblio_not_research',
      'Bibliografie-Vorschläge gibt es nur in Research-Projekten.',
      'Nimm die source_id einer Research-Quelle.'
    )
  }
  return source
}

function titleTokens(raw: string): Set<string> {
  return new Set(
    raw
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
  )
}

export function titleOverlap(a: string, b: string): number {
  const A = titleTokens(a)
  const B = titleTokens(b)
  if (A.size === 0 || B.size === 0) return 0
  let hit = 0
  for (const t of A) if (B.has(t)) hit += 1
  return hit / Math.min(A.size, B.size)
}

function parseCrossrefItem(it: Record<string, unknown>): BiblioMeta | null {
  const doi = typeof it.DOI === 'string' ? extractDoi(it.DOI) : null
  if (!doi) return null
  const year = (it.issued as { 'date-parts'?: number[][] } | undefined)?.['date-parts']?.[0]?.[0] ?? null
  const authors = Array.isArray(it.author)
    ? (it.author as Array<{ given?: string; family?: string }>)
        .slice(0, 12)
        .map((a) => [a.given, a.family].filter(Boolean).join(' '))
        .filter(Boolean)
    : []
  const mapped = mapCrossrefType(typeof it.type === 'string' ? it.type : undefined)
  const title = Array.isArray(it.title) ? String(it.title[0] ?? '') : null
  const venue = Array.isArray(it['container-title']) ? String((it['container-title'] as string[])[0] ?? '') : null
  return {
    doi,
    authors,
    year: typeof year === 'number' ? year : null,
    venue,
    title: title || null,
    entry_type: mapped.entry_type,
    source_kind: mapped.source_kind,
  }
}

export type BiblioSearchHit = BiblioMeta & { overlap: number }

export async function searchCrossrefWorks(query: string): Promise<BiblioMeta[]> {
  const q = query.trim()
  if (q.length < 5) return []
  try {
    const data = (await getJson(
      `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=5&mailto=${encodeURIComponent(resolveContactEmail())}`
    )) as { message?: { items?: Array<Record<string, unknown>> } }
    const items = data.message?.items ?? []
    return items.map(parseCrossrefItem).filter((m): m is BiblioMeta => m != null)
  } catch {
    return []
  }
}

export const searchBiblioSchema = z.object({
  source_id: z.string().min(1),
  query: z.string().min(5).optional(),
})

export async function searchBiblioForSource(
  repo: Repo,
  rawInput: unknown
): Promise<{ source_id: string; query: string; hits: BiblioSearchHit[]; next_action: string }> {
  const input = parseOrThrow(searchBiblioSchema, rawInput, 'biblio_invalid')
  const source = assertResearchSource(repo, input.source_id)
  const query = (input.query ?? source.title).trim()
  const metas = await searchCrossrefWorks(query)
  const hits = metas.map((m) => ({ ...m, overlap: titleOverlap(source.title, m.title || '') }))
  return {
    source_id: source.id,
    query,
    hits,
    next_action:
      hits.length === 0
        ? 'Formuliere eine kürzere query (Titelstichworte, Autor, Jahr) und rufe search_biblio erneut auf. Oder lies das PDF und nimm eine DOI mit Offsets in propose_biblio.'
        : 'Wähle den Treffer, dessen Titel zur Quelle passt, und rufe propose_biblio mit dessen doi auf. Erfinde keine DOI.',
  }
}

export const proposeBiblioSchema = z
  .object({
    source_id: z.string().min(1),
    doi: z.string().min(3).optional(),
    document_id: z.string().optional(),
    quote_start: z.number().int().min(0).optional(),
    quote_end: z.number().int().min(1).optional(),
    reason: z.string().min(10),
  })
  .superRefine((v, ctx) => {
    const hasOffsets = v.document_id != null && v.quote_start != null && v.quote_end != null
    if (!v.doi && !hasOffsets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['doi'],
        message: 'Entweder doi aus search_biblio, oder document_id + quote_start + quote_end auf die DOI im gespeicherten Text.',
      })
    }
  })

function doiFromOffsets(repo: Repo, source: Source, documentId: string, start: number, end: number): { doi: string; found_via: BiblioFoundVia } {
  const doc = repo.getDocument(documentId)
  if (!doc || doc.project_id !== source.project_id) {
    throw new ServiceError(
      'biblio_document_missing',
      `Dokument ${documentId} liegt nicht in diesem Projekt.`,
      'Nimm document_id der Quelle oder aus list_corpus / read_document.'
    )
  }
  if (start < 0 || end > doc.char_len || start >= end) {
    throw new ServiceError(
      'biblio_offset_invalid',
      `Offsets ${start}–${end} passen nicht zum Dokument (${doc.char_len} Zeichen).`,
      'Lies das Dokument mit read_document und übernimm quote_start/quote_end aus dem Fenster, in dem die DOI steht.'
    )
  }
  const slice = doc.text.slice(start, end)
  const doi = extractDoi(slice)
  if (!doi) {
    throw new ServiceError(
      'biblio_doi_missing',
      'Im markierten Textfenster steht keine DOI (10.…).',
      'Vergrößere das Fenster um die DOI, oder suche mit search_biblio nach Titel/Autor.'
    )
  }
  return { doi, found_via: 'document_offset' }
}

export async function proposeBiblio(
  repo: Repo,
  rawInput: unknown,
  actor: string
): Promise<{ suggestion: BiblioSuggestion; warning: string | null; next_action: string }> {
  const input = parseOrThrow(proposeBiblioSchema, rawInput, 'biblio_invalid')
  const source = assertResearchSource(repo, input.source_id)
  let doi: string
  let found_via: BiblioFoundVia = 'doi'
  if (input.document_id != null && input.quote_start != null && input.quote_end != null) {
    const fromDoc = doiFromOffsets(repo, source, input.document_id, input.quote_start, input.quote_end)
    doi = fromDoc.doi
    found_via = fromDoc.found_via
  } else {
    const extracted = extractDoi(input.doi || '')
    if (!extracted) {
      throw new ServiceError(
        'biblio_doi_invalid',
        `Keine DOI in „${input.doi}“.`,
        'Nimm eine DOI der Form 10.xxxx/… aus search_biblio, ohne extra Text.'
      )
    }
    doi = extracted
  }
  if (source.doi && source.doi.toLowerCase() === doi.toLowerCase()) {
    throw new ServiceError(
      'biblio_already',
      `Quelle hat bereits die DOI ${source.doi}.`,
      'Nichts zu tun — oder wähle eine andere Quelle ohne DOI.'
    )
  }
  const meta = await lookupDoi(doi)
  if (!meta) {
    throw new ServiceError(
      'biblio_doi_unknown',
      `Crossref/OpenAlex kennen ${doi} nicht.`,
      'Prüfe die DOI. Bei Titelsuche: search_biblio, dann eine der zurückgegebenen dois.'
    )
  }
  const overlap = titleOverlap(source.title, meta.title || '')
  const suggestion = repo.addBiblioSuggestion({
    source_id: source.id,
    project_id: source.project_id,
    proposed_doi: meta.doi || doi,
    proposed_title: meta.title,
    proposed_authors: meta.authors,
    proposed_year: meta.year,
    proposed_venue: meta.venue,
    proposed_entry_type: meta.entry_type,
    proposed_source_kind: meta.source_kind,
    title_overlap: overlap,
    reason: input.reason,
    found_via,
    document_id: input.document_id ?? null,
    quote_start: input.quote_start ?? null,
    quote_end: input.quote_end ?? null,
    actor,
  })
  const warning =
    overlap < 0.25
      ? 'Titel weicht stark von der Quelle ab. Der Mensch muss das auf dem Human Desk prüfen.'
      : null
  return {
    suggestion,
    warning,
    next_action:
      'Warte, bis der Mensch den Vorschlag auf dem Human Desk übernimmt. Setze human_signed nicht. Schreibe die .bib nicht selbst.',
  }
}

export function acceptBiblioSuggestion(repo: Repo, suggestionId: string, actor: string): { source: Source; suggestion: BiblioSuggestion } {
  const suggestion = repo.getBiblioSuggestion(suggestionId)
  if (!suggestion) {
    throw new ServiceError(
      'biblio_suggestion_missing',
      `Vorschlag ${suggestionId} existiert nicht.`,
      'Öffne die Akte auf dem Human Desk — der Vorschlag steht dort, solange er offen ist.'
    )
  }
  if (suggestion.status !== 'pending') {
    throw new ServiceError(
      'biblio_suggestion_decided',
      'Dieser Vorschlag ist schon entschieden.',
      'Schau auf dem Human Desk nach dem aktuellen Stand der Quelle.'
    )
  }
  const source = assertResearchSource(repo, suggestion.source_id)
  const meta: BiblioMeta = {
    doi: suggestion.proposed_doi,
    authors: suggestion.proposed_authors,
    year: suggestion.proposed_year,
    venue: suggestion.proposed_venue,
    title: suggestion.proposed_title,
    entry_type: suggestion.proposed_entry_type ?? 'article',
    source_kind: suggestion.proposed_source_kind ?? 'empirical',
  }
  const preserveCitekey = source.review_status === 'human_signed' && Boolean(source.citekey)
  const updated = applyLookedUpBiblio(repo, source, meta, suggestion.proposed_doi, { preserveCitekey })
  const decided = repo.decideBiblioSuggestion(suggestion.id, 'accepted', actor)
  return { source: updated, suggestion: decided! }
}

export function rejectBiblioSuggestion(repo: Repo, suggestionId: string, actor: string): BiblioSuggestion {
  const suggestion = repo.getBiblioSuggestion(suggestionId)
  if (!suggestion) {
    throw new ServiceError(
      'biblio_suggestion_missing',
      `Vorschlag ${suggestionId} existiert nicht.`,
      'Öffne die Akte auf dem Human Desk.'
    )
  }
  if (suggestion.status !== 'pending') {
    throw new ServiceError(
      'biblio_suggestion_decided',
      'Dieser Vorschlag ist schon entschieden.',
      'Nichts weiter zu tun.'
    )
  }
  assertResearchSource(repo, suggestion.source_id)
  return repo.decideBiblioSuggestion(suggestion.id, 'rejected', actor)!
}

