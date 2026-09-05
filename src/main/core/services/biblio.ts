import type { Repo } from '../repo'
import { extractDoi } from '../enforce/fetchers'
import type { BibEntryType, Source, SourceKind } from '../../../shared/types'
import { ServiceError } from './research'
import { contactUserAgent, resolveContactEmail } from '../contact-email'

/**
 * Bibliografische Identität — Citekeys sind stabil (nachnameJahrKurztitel),
 * nie aus [S3] abgeleitet. Metadaten kommen aus Crossref/OpenAlex, nicht vom Modell.
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
  let meta: BiblioMeta | null = doi ? await lookupDoi(doi) : null
  const authors = meta?.authors?.length ? meta.authors : []
  const year = meta?.year ?? null
  const title = meta?.title || source.title
  const entryType: BibEntryType = meta?.entry_type ?? 'misc'
  // Ohne DOI nie @article — auch wenn das Modell es so nennen würde.
  const honestType: BibEntryType = doi && entryType === 'article' ? 'article' : doi ? entryType : 'misc'
    const kind: SourceKind = source.source_kind ?? meta?.source_kind ?? (doi ? 'empirical' : 'web')
  const base = citekeyBase(authors, year, title)
  const citekey = allocateCitekey(repo.listCitekeys(source.project_id), base)
  return repo.setSourceBiblio(source.id, {
    doi: doi ?? meta?.doi ?? null,
    authors_json: authors.length ? JSON.stringify(authors) : null,
    year,
    venue: meta?.venue ?? null,
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
  let sources = repo.listSources(projectId).filter((s) => s.review_status !== 'rejected')
  if (sourceIds?.length) {
    const want = new Set(sourceIds)
    sources = sources.filter((s) => want.has(s.id))
  }
  if (sources.length === 0) return '% keine Quellen\n'
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
