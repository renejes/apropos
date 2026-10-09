import { z } from 'zod'
import type { Repo } from '../repo'
import { extractDoi } from '../enforce/fetchers'
import type { BibEntryType, BiblioFoundVia, BiblioSuggestion, Source, SourceKind } from '../../../shared/types'
import { ServiceError } from './research'
import { contactUserAgent, resolveContactEmail } from '../contact-email'
import { sourceToBibtex, sourcesToRis } from './bibliography-format'

export {
  bibliographyType,
  citeMarker,
  formatLocator,
  locatorStyleForLang,
  rewriteCiteMarkers,
  sourceToBibtex,
  sourceToRis,
  sourcesToRis,
  splitWorkPages,
} from './bibliography-format'
export type { BibliographyType, LocatorStyle } from './bibliography-format'

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
  volume: string | null
  issue: string | null
  pages: string | null
  publisher: string | null
  place: string | null
  edition: string | null
  editors: string[]
  booktitle: string | null
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
    case 'book-chapter':
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

function cleanText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return null
}

function personNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 12)
    .map((a) => {
      const rec = a as { given?: string; family?: string; name?: string }
      if (typeof rec.name === 'string' && rec.name.trim()) return rec.name.trim()
      return [rec.given, rec.family].filter(Boolean).join(' ')
    })
    .filter(Boolean)
}

function imprintFromCrossref(it: Record<string, unknown>, entryType: BibEntryType): Pick<
  BiblioMeta,
  'volume' | 'issue' | 'pages' | 'publisher' | 'place' | 'edition' | 'editors' | 'booktitle' | 'venue'
> {
  const container = Array.isArray(it['container-title']) ? cleanText((it['container-title'] as unknown[])[0]) : null
  const chapter = entryType === 'book' && it.type === 'book-chapter'
  return {
    volume: cleanText(it.volume),
    issue: cleanText(it.issue),
    pages: cleanText(it.page),
    publisher: cleanText(it.publisher),
    place: cleanText(it['publisher-location']),
    edition: cleanText(it['edition-number']),
    editors: personNames(it.editor),
    booktitle: chapter ? container : null,
    venue: chapter ? null : container,
  }
}

function imprintFromOpenAlex(data: Record<string, unknown>): Pick<
  BiblioMeta,
  'volume' | 'issue' | 'pages' | 'publisher' | 'place' | 'edition' | 'editors' | 'booktitle'
> {
  const biblio = data.biblio as { volume?: unknown; issue?: unknown; first_page?: unknown; last_page?: unknown } | undefined
  const first = cleanText(biblio?.first_page)
  const last = cleanText(biblio?.last_page)
  const pages = first && last && first !== last ? `${first}-${last}` : first
  const workType = typeof data.type === 'string' ? data.type : ''
  const source = (data.primary_location as { source?: { display_name?: string; host_organization_name?: string } } | undefined)?.source
  const bookish = workType === 'book' || workType === 'book-chapter'
  return {
    volume: cleanText(biblio?.volume),
    issue: cleanText(biblio?.issue),
    pages,
    publisher: bookish ? cleanText(source?.host_organization_name) : null,
    place: null,
    edition: null,
    editors: [],
    booktitle: workType === 'book-chapter' ? cleanText(source?.display_name) : null,
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
    const imprint = imprintFromCrossref(it, mapped.entry_type)
    return {
      doi: id,
      authors,
      year: typeof year === 'number' ? year : null,
      venue: imprint.venue,
      title: title || null,
      entry_type: mapped.entry_type,
      source_kind: mapped.source_kind,
      volume: imprint.volume,
      issue: imprint.issue,
      pages: imprint.pages,
      publisher: imprint.publisher,
      place: imprint.place,
      edition: imprint.edition,
      editors: imprint.editors,
      booktitle: imprint.booktitle,
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
      const workType = typeof data.type === 'string' ? data.type : ''
      const mapped =
        workType === 'book' || workType === 'book-chapter'
          ? { entry_type: 'book' as const, source_kind: 'textbook' as const }
          : { entry_type: 'article' as const, source_kind: 'empirical' as const }
      const imprint = imprintFromOpenAlex(data)
      const venue = (data.primary_location as { source?: { display_name?: string } } | undefined)?.source?.display_name ?? null
      return {
        doi: id,
        authors,
        year: typeof data.publication_year === 'number' ? data.publication_year : null,
        venue: workType === 'book-chapter' ? null : venue,
        title: typeof data.display_name === 'string' ? data.display_name : null,
        entry_type: mapped.entry_type,
        source_kind: mapped.source_kind,
        ...imprint,
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
  const entryType: BibEntryType = meta?.entry_type ?? source.entry_type ?? 'misc'
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
    volume: meta?.volume ?? null,
    issue: meta?.issue ?? null,
    pages: meta?.pages ?? null,
    publisher: meta?.publisher ?? null,
    place: meta?.place ?? null,
    edition: meta?.edition ?? null,
    editors_json: meta?.editors?.length ? JSON.stringify(meta.editors) : null,
    booktitle: meta?.booktitle ?? null,
    entry_type: entryType,
    citekey,
    source_kind: kind,
  })
}

function signedExportSources(repo: Repo, projectId: string, sourceIds?: string[] | null): Source[] {
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
  return sources
}

export function exportBibliography(repo: Repo, projectId: string, sourceIds?: string[] | null): string {
  const sources = signedExportSources(repo, projectId, sourceIds)
  if (sources.length === 0) return '% keine übernommenen Quellen\n'
  return sources.map(sourceToBibtex).join('\n\n') + '\n'
}

export function exportRis(repo: Repo, projectId: string, sourceIds?: string[] | null): string {
  return sourcesToRis(signedExportSources(repo, projectId, sourceIds))
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
  const imprint = imprintFromCrossref(it, mapped.entry_type)
  return {
    doi,
    authors,
    year: typeof year === 'number' ? year : null,
    venue: imprint.venue,
    title: title || null,
    entry_type: mapped.entry_type,
    source_kind: mapped.source_kind,
    volume: imprint.volume,
    issue: imprint.issue,
    pages: imprint.pages,
    publisher: imprint.publisher,
    place: imprint.place,
    edition: imprint.edition,
    editors: imprint.editors,
    booktitle: imprint.booktitle,
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

const imprintText = z.string().trim().max(300)

export const sourceImprintSchema = z.object({
  source_id: z.string().min(1),
  entry_type: z.enum(['article', 'book', 'inproceedings', 'misc']).nullable(),
  authors: z.array(z.string().trim().min(1).max(200)).max(12),
  year: z.number().int().min(1000).max(2100).nullable(),
  venue: imprintText.nullable(),
  volume: imprintText.nullable(),
  issue: imprintText.nullable(),
  pages: imprintText.nullable(),
  publisher: imprintText.nullable(),
  place: imprintText.nullable(),
  edition: imprintText.nullable(),
  editors: z.array(z.string().trim().min(1).max(200)).max(12),
  booktitle: imprintText.nullable(),
})

function blankToNull(value: string | null): string | null {
  const t = value?.trim() ?? ''
  return t.length > 0 ? t : null
}

/** Felder, die Crossref nicht hatte. Nur der Mensch, nie das Modell. */
export function saveSourceImprint(repo: Repo, raw: unknown, actor: string): Source {
  const input = parseOrThrow(sourceImprintSchema, raw, 'imprint_invalid')
  const source = assertResearchSource(repo, input.source_id)
  if (input.pages && /\bf{1,2}\.?\s*$/i.test(input.pages)) {
    throw new ServiceError(
      'imprint_pages',
      'Seitenbereich ohne „f.“ oder „ff.“. Anfang und Ende angeben, zum Beispiel 12-18.',
      'Trag den Seitenbereich des Artikels oder Beitrags ein, nicht die Fundstelle des Zitats.'
    )
  }
  return repo.setSourceImprint(
    source.id,
    {
      authors_json: input.authors.length ? JSON.stringify(input.authors) : null,
      year: input.year,
      venue: blankToNull(input.venue),
      volume: blankToNull(input.volume),
      issue: blankToNull(input.issue),
      pages: blankToNull(input.pages),
      publisher: blankToNull(input.publisher),
      place: blankToNull(input.place),
      edition: blankToNull(input.edition),
      editors_json: input.editors.length ? JSON.stringify(input.editors) : null,
      booktitle: blankToNull(input.booktitle),
      entry_type: input.entry_type,
    },
    actor
  )
}

export async function acceptBiblioSuggestion(
  repo: Repo,
  suggestionId: string,
  actor: string
): Promise<{ source: Source; suggestion: BiblioSuggestion }> {
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
  const looked = await lookupDoi(suggestion.proposed_doi)
  const meta: BiblioMeta = looked ?? {
    doi: suggestion.proposed_doi,
    authors: suggestion.proposed_authors,
    year: suggestion.proposed_year,
    venue: suggestion.proposed_venue,
    title: suggestion.proposed_title,
    entry_type: suggestion.proposed_entry_type ?? 'article',
    source_kind: suggestion.proposed_source_kind ?? 'empirical',
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    place: null,
    edition: null,
    editors: [],
    booktitle: null,
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

