import type { Source } from '../../../shared/types'
import { allocateCitekey, sourceToBibtex } from '../services/biblio'

export interface BibEntryMeta {
  key: string
  doi: string | null
  title: string | null
  url: string | null
}

export interface BibMergeResult {
  bib: string
  sources: Source[]
  remapped: Array<{ from: string; to: string }>
}

export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
  return t.length > 0 ? t : null
}

export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw.trim())
    u.hash = ''
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`
  } catch {
    const t = raw.trim().replace(/\/+$/, '')
    return t.length > 0 ? t : null
  }
}

function field(block: string, name: string): string | null {
  const braced = block.match(new RegExp(`${name}\\s*=\\s*\\{([^}]*)\\}`, 'i'))
  if (braced) return braced[1].trim()
  const quoted = block.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return quoted ? quoted[1].trim() : null
}

export function parseBibEntries(bib: string): BibEntryMeta[] {
  const chunks = bib.split(/(?=@\w+\s*\{)/)
  const entries: BibEntryMeta[] = []
  for (const chunk of chunks) {
    const head = chunk.match(/@\w+\s*\{\s*([^,\s]+)\s*,/)
    if (!head) continue
    entries.push({
      key: head[1],
      doi: normalizeDoi(field(chunk, 'doi')),
      title: field(chunk, 'title'),
      url: normalizeUrl(field(chunk, 'url')),
    })
  }
  return entries
}

function sameWork(source: Source, entry: BibEntryMeta): boolean {
  const doi = normalizeDoi(source.doi)
  if (doi && entry.doi && doi === entry.doi) return true
  const url = normalizeUrl(source.url)
  if (url && entry.url && url === entry.url) return true
  return false
}

/** Hängt neue Keys an; vorhandene Einträge bleiben unverändert. */
export function mergeBibliography(existingBib: string, sources: Source[]): BibMergeResult {
  const existing = parseBibEntries(existingBib)
  const taken = existing.map((e) => e.key)
  const remapped: Array<{ from: string; to: string }> = []
  const mapped: Source[] = []
  const appended: string[] = []

  for (const source of sources) {
    const match = existing.find((entry) => sameWork(source, entry))
    const original = source.citekey || `src${source.id.slice(0, 8)}`
    if (match) {
      mapped.push({ ...source, citekey: match.key })
      if (match.key !== original) remapped.push({ from: original, to: match.key })
      continue
    }
    const key = allocateCitekey(taken, original)
    taken.push(key)
    if (key !== original) remapped.push({ from: original, to: key })
    mapped.push({ ...source, citekey: key })
    appended.push(sourceToBibtex({ ...source, citekey: key }))
  }

  const base = existingBib.trim()
  const bib =
    appended.length === 0
      ? base.length > 0
        ? base + '\n'
        : '% keine Quellen\n'
      : (base.length > 0 ? base + '\n\n' : '') + appended.join('\n\n') + '\n'
  return { bib, sources: mapped, remapped }
}

export function rewriteCitekeys(markdown: string, remapped: Array<{ from: string; to: string }>): string {
  if (remapped.length === 0) return markdown
  const map = new Map(remapped.filter((r) => r.from !== r.to).map((r) => [r.from, r.to]))
  if (map.size === 0) return markdown
  return markdown.replace(/\[@([^\],]+)((?:,[^\]]*)?)\]/g, (full, key: string, rest: string) => {
    const next = map.get(key)
    return next ? `[@${next}${rest}]` : full
  })
}
