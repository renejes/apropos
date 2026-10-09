import type { BibEntryType, Source } from '../../../shared/types'

export type LocatorStyle = 'apa' | 'dgps'
export type BibliographyType = BibEntryType | 'incollection'

/** Deutscher Kurzbeleg in der Hausarbeit, englischer in APA. */
export function locatorStyleForLang(lang: string | null | undefined): LocatorStyle {
  return lang === 'de' ? 'dgps' : 'apa'
}

/**
 * Typ, den BibTeX und RIS schreiben.
 * Ein Buch mit Bandtitel ist ein Sammelbandbeitrag. Fehlende DOI stuft den gesetzten Typ nicht herab.
 */
export function bibliographyType(source: Pick<Source, 'entry_type' | 'booktitle'>): BibliographyType {
  if (source.entry_type === 'book' && source.booktitle?.trim()) return 'incollection'
  if (
    source.entry_type === 'article' ||
    source.entry_type === 'book' ||
    source.entry_type === 'inproceedings' ||
    source.entry_type === 'misc'
  ) {
    return source.entry_type
  }
  return 'misc'
}

function bibField(value: string): string {
  return value.replace(/[{}]/g, '')
}

export function authorsBib(authorsJson: string | null): string {
  if (!authorsJson) return ''
  try {
    const authors = JSON.parse(authorsJson) as string[]
    return authors
      .map((a) => {
        const parts = a.trim().split(/\s+/)
        if (parts.length === 1) return parts[0] ?? ''
        const family = parts[parts.length - 1]
        const given = parts.slice(0, -1).join(' ')
        return `${family}, ${given}`
      })
      .filter(Boolean)
      .join(' and ')
  } catch {
    return ''
  }
}

function pageLabels(style: LocatorStyle, range: boolean): string {
  if (style === 'dgps') return 'S.'
  return range ? 'pp.' : 'p.'
}

/**
 * Seite → `p. 12` / `S. 12`, Bereich → `pp. 12–14` / `S. 12–14`.
 * „f.“ und „ff.“ fallen weg, ohne eine Folgeseite zu erfinden. Ohne Zahl bleibt der Originaltext.
 */
export function formatLocator(locator: string | null | undefined, style: LocatorStyle = 'apa'): string | null {
  if (!locator?.trim()) return null
  const t = locator
    .trim()
    .replace(/\s*f{1,2}\.?\s*$/i, '')
    .trim()
  if (!t) return null
  const range = t.match(/^(?:(?:pp?|ss?|seiten?)\.?\s*)?(\d+)\s*[–-]\s*(\d+)$/i)
  if (range) return `${pageLabels(style, true)} ${range[1]}–${range[2]}`
  const single = t.match(/^(?:(?:pp?|ss?|seite|seiten)\.?\s*)?(\d+)$/i)
  if (single) return `${pageLabels(style, false)} ${single[1]}`
  return t
}

export function citeMarker(
  source: Pick<Source, 'citekey' | 'quote_locator'>,
  fallbackIndex?: number,
  withLocator = false,
  style: LocatorStyle = 'apa'
): string {
  if (source.citekey) {
    const loc = withLocator ? formatLocator(source.quote_locator, style) : null
    return loc ? `[@${source.citekey}, ${loc}]` : `[@${source.citekey}]`
  }
  return fallbackIndex != null ? `[S${fallbackIndex}]` : '[S?]'
}

export function rewriteCiteMarkers(markdown: string, sources: Source[], style: LocatorStyle = 'apa'): string {
  const byIndex = new Map<number, Source>()
  sources.forEach((s, i) => byIndex.set(i + 1, s))
  return markdown.replace(/\[S(\d+)\]/g, (full, n) => {
    const src = byIndex.get(Number(n))
    if (!src?.citekey) return full
    return citeMarker(src, Number(n), true, style)
  })
}

function pushBib(fields: string[], key: string, value: string | null | undefined): void {
  const v = value?.trim()
  if (!v) return
  fields.push(`  ${key} = {${bibField(v)}}`)
}

/** Internetquellen bekommen ein Abrufdatum. Bücher und Artikel nicht, auch ohne DOI. */
function accessNote(source: Source, type: BibliographyType): string | null {
  if (type !== 'misc') return null
  const accessed = source.accessed_at?.slice(0, 10)
  return accessed ? `Zugriff am ${accessed}` : null
}

export function sourceToBibtex(source: Source): string {
  const key = source.citekey || `src${source.id.slice(0, 8)}`
  const type = bibliographyType(source)
  const fields: string[] = []
  const author = authorsBib(source.authors_json)
  const editor = authorsBib(source.editors_json)
  if (author) fields.push(`  author = {${bibField(author)}}`)
  if (editor) fields.push(`  editor = {${bibField(editor)}}`)
  fields.push(`  title = {${bibField(source.title)}}`)
  if (type === 'article') pushBib(fields, 'journal', source.venue)
  if (type === 'incollection') pushBib(fields, 'booktitle', source.booktitle)
  if (type === 'inproceedings') pushBib(fields, 'booktitle', source.venue)
  if (type === 'book' && source.venue && source.venue !== source.publisher) pushBib(fields, 'series', source.venue)
  if (type === 'misc' && source.venue) pushBib(fields, 'howpublished', source.venue)
  if (source.year) fields.push(`  year = {${source.year}}`)
  pushBib(fields, 'volume', source.volume)
  pushBib(fields, 'number', source.issue)
  pushBib(fields, 'pages', source.pages)
  pushBib(fields, 'edition', source.edition)
  pushBib(fields, 'publisher', source.publisher)
  pushBib(fields, 'address', source.place)
  pushBib(fields, 'doi', source.doi)
  if (source.url) fields.push(`  url = {${source.url}}`)
  pushBib(fields, 'note', accessNote(source, type))
  return `@${type}{${key},\n${fields.join(',\n')}\n}`
}

function risLine(tag: string, value: string | null | undefined): string | null {
  const v = value?.replace(/\s+/g, ' ').trim()
  if (!v) return null
  return `${tag}  - ${v}`
}

function risPeople(tag: string, authorsJson: string | null): string[] {
  if (!authorsJson) return []
  try {
    const authors = JSON.parse(authorsJson) as unknown
    if (!Array.isArray(authors)) return []
    return authors
      .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
      .map((a) => {
        const parts = a.trim().split(/\s+/)
        if (parts.length === 1) return `${tag}  - ${parts[0]}`
        const family = parts[parts.length - 1]
        const given = parts.slice(0, -1).join(' ')
        return `${tag}  - ${family}, ${given}`
      })
  } catch {
    return []
  }
}

/** Anfangs- und Endseite für RIS. Unklarer Text bleibt weg, statt als Seitenzahl des ganzen Werks zu landen. */
export function splitWorkPages(pages: string | null | undefined): { start: string | null; end: string | null } {
  if (!pages?.trim()) return { start: null, end: null }
  const t = pages.trim().replace(/\s+/g, '')
  const range = t.match(/^(\d+)[–-](\d+)$/)
  if (range) return { start: range[1] ?? null, end: range[2] ?? null }
  const single = t.match(/^(\d+)$/)
  if (single) return { start: single[1] ?? null, end: null }
  return { start: null, end: null }
}

function risType(type: BibliographyType): string {
  switch (type) {
    case 'article':
      return 'JOUR'
    case 'book':
      return 'BOOK'
    case 'incollection':
      return 'CHAP'
    case 'inproceedings':
      return 'CONF'
    case 'misc':
      return 'GEN'
    default: {
      const _never: never = type
      return _never
    }
  }
}

export function sourceToRis(source: Source): string {
  const type = bibliographyType(source)
  const pages = splitWorkPages(source.pages)
  const lines = [
    `TY  - ${risType(type)}`,
    ...risPeople('AU', source.authors_json),
    ...risPeople('ED', source.editors_json),
    risLine('TI', source.title),
    risLine('T2', type === 'incollection' ? source.booktitle : type === 'inproceedings' ? source.venue : null),
    risLine('JO', type === 'article' ? source.venue : null),
    source.year ? `PY  - ${source.year}` : null,
    risLine('VL', source.volume),
    risLine('IS', source.issue),
    risLine('SP', pages.start),
    risLine('EP', pages.end),
    risLine('ET', source.edition),
    risLine('PB', source.publisher),
    risLine('CY', source.place),
    risLine('DO', source.doi),
    risLine('UR', source.url),
    risLine('N1', accessNote(source, type)),
    'ER  - ',
  ].filter((line): line is string => Boolean(line))
  return lines.join('\n')
}

export function sourcesToRis(sources: Source[]): string {
  if (sources.length === 0) return ''
  return sources.map(sourceToRis).join('\n\n') + '\n'
}
