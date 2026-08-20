import { z } from 'zod'
import type { Repo } from '../repo'
import { ServiceError, requireAdoptedBrief } from './research'

/**
 * Wissenschaftliche Literatursuche über offene, kostenlose APIs.
 *
 * Warum das hier hingehört und nicht in eine Websuche:
 *  - Diese APIs liefern DOIs, Autoren, Jahr, Journal und Open-Access-Volltextlinks —
 *    also STABILE IDENTIFIKATOREN statt geratener URLs. Ein DOI ist als Provenienz-Anker
 *    ungleich mehr wert als ein Suchtreffer.
 *  - Sie sind kostenlos, ohne Vertrag und ohne Schlüssel nutzbar, und ihre
 *    Nutzungsbedingungen erlauben das Speichern der Ergebnisse ausdrücklich — anders als
 *    bei kommerziellen Such-APIs, deren AGB das Archivieren untersagen.
 *  - Jede Suche wird automatisch in `search_log` protokolliert (PRISMA-S). Die
 *    Suchdokumentation entsteht damit als Nebenprodukt, nicht als Pflichtübung.
 *
 * Höflichkeit: OpenAlex und Crossref öffnen den schnelleren "polite pool", wenn eine
 * Kontakt-Mail mitgeschickt wird. Konfigurierbar über ROP_CONTACT_EMAIL.
 */

const CONTACT = process.env.ROP_CONTACT_EMAIL?.trim() || 'research-overview-platform@localhost'
const UA = `ResearchOverviewPlatform/0.1 (+mailto:${CONTACT})`
const TIMEOUT_MS = 12_000

export type LiteratureBackend = 'openalex' | 'crossref' | 'europepmc' | 'arxiv'

export const literatureInputSchema = z.object({
  project_id: z.string().min(1),
  query: z.string().min(3),
  backends: z.array(z.enum(['openalex', 'crossref', 'europepmc', 'arxiv'])).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  year_from: z.number().int().min(1500).max(2100).optional(),
  year_to: z.number().int().min(1500).max(2100).optional(),
  open_access_only: z.boolean().optional(),
  note: z.string().optional(),
})

export interface LiteratureHit {
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  /** Beste abrufbare URL: Landing-Page oder DOI-Resolver — nicht die PDF unterschieben. */
  url: string | null
  /** Frei zugänglicher Volltext (oft PDF) — der Kandidat für fetch_source. */
  oa_url: string | null
  venue: string | null
  abstract: string | null
  cited_by_count: number | null
  is_open_access: boolean | null
  found_via: LiteratureBackend[]
}

export interface LiteratureResult {
  query: string
  backends_used: LiteratureBackend[]
  backends_failed: Array<{ backend: LiteratureBackend; error: string }>
  total: number
  hits: LiteratureHit[]
  search_log_ids: string[]
  hint: string
}

async function getJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

async function getText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/atom+xml,text/xml', 'user-agent': UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

/** OpenAlex liefert Abstracts als invertierten Index — hier zurückgedreht. */
function fromInvertedIndex(idx: Record<string, number[]> | null | undefined): string | null {
  if (!idx) return null
  const words: string[] = []
  for (const [word, positions] of Object.entries(idx)) for (const p of positions) words[p] = word
  const text = words.filter(Boolean).join(' ').trim()
  return text ? text.slice(0, 1500) : null
}

function cleanDoi(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  const m = raw.match(/10\.\d{4,9}\/\S+/)
  return m ? m[0].replace(/[.,;)\]]+$/, '').toLowerCase() : null
}

function stripTags(s: unknown): string | null {
  if (typeof s !== 'string' || !s) return null
  const t = s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t.slice(0, 1500) : null
}

function looksLikePdfUrl(u: string | null | undefined): boolean {
  if (!u) return false
  try {
    const path = new URL(u).pathname.toLowerCase()
    return path.endsWith('.pdf') || path.includes('/pdf/')
  } catch {
    return /\.pdf(\?|#|$)/i.test(u) || /\/pdf\//i.test(u)
  }
}

/** Landing-Page/DOI vor PDF — sonst würde fetch_source die PDF als einzige url bekommen. */
function preferLanding(...candidates: Array<string | null | undefined>): string | null {
  const list = candidates.filter((c): c is string => typeof c === 'string' && c.length > 0)
  return list.find((u) => !looksLikePdfUrl(u)) ?? list[0] ?? null
}

// ------------------------------------------------------------------ Backends

async function searchOpenAlex(q: string, limit: number, o: { yearFrom?: number; yearTo?: number; oaOnly?: boolean }): Promise<LiteratureHit[]> {
  const filters: string[] = []
  if (o.yearFrom) filters.push(`from_publication_date:${o.yearFrom}-01-01`)
  if (o.yearTo) filters.push(`to_publication_date:${o.yearTo}-12-31`)
  if (o.oaOnly) filters.push('is_oa:true')
  const url =
    `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${limit}` +
    (filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '') +
    `&mailto=${encodeURIComponent(CONTACT)}`

  const data = (await getJson(url)) as { results?: Array<Record<string, any>> }
  return (data.results ?? []).map((w) => {
    const doi = cleanDoi(w.doi)
    const landing = w.primary_location?.landing_page_url ?? w.best_oa_location?.landing_page_url ?? null
    const oa = w.open_access?.oa_url ?? w.best_oa_location?.pdf_url ?? null
    return {
      title: String(w.display_name ?? w.title ?? '(ohne Titel)'),
      authors: (w.authorships ?? []).slice(0, 12).map((a: any) => String(a?.author?.display_name ?? '')).filter(Boolean),
      year: typeof w.publication_year === 'number' ? w.publication_year : null,
      doi,
      url: preferLanding(landing, doi ? `https://doi.org/${doi}` : null, oa),
      oa_url: oa,
      venue: w.primary_location?.source?.display_name ?? null,
      abstract: fromInvertedIndex(w.abstract_inverted_index),
      cited_by_count: typeof w.cited_by_count === 'number' ? w.cited_by_count : null,
      is_open_access: w.open_access?.is_oa ?? null,
      found_via: ['openalex'] as LiteratureBackend[],
    }
  })
}

async function searchCrossref(q: string, limit: number, o: { yearFrom?: number; yearTo?: number }): Promise<LiteratureHit[]> {
  const filters: string[] = []
  if (o.yearFrom) filters.push(`from-pub-date:${o.yearFrom}-01-01`)
  if (o.yearTo) filters.push(`until-pub-date:${o.yearTo}-12-31`)
  const url =
    `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${limit}` +
    (filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '') +
    `&mailto=${encodeURIComponent(CONTACT)}`

  const data = (await getJson(url)) as { message?: { items?: Array<Record<string, any>> } }
  return (data.message?.items ?? []).map((it) => {
    const doi = cleanDoi(it.DOI)
    const year = it.issued?.['date-parts']?.[0]?.[0] ?? null
    return {
      title: Array.isArray(it.title) ? String(it.title[0] ?? '(ohne Titel)') : '(ohne Titel)',
      authors: (it.author ?? [])
        .slice(0, 12)
        .map((a: any) => [a?.given, a?.family].filter(Boolean).join(' '))
        .filter(Boolean),
      year: typeof year === 'number' ? year : null,
      doi,
      url: preferLanding(doi ? `https://doi.org/${doi}` : null, it.URL ?? null),
      oa_url: null, // Crossref sagt nichts Verlässliches über Volltext-Zugang
      venue: Array.isArray(it['container-title']) ? (it['container-title'][0] ?? null) : null,
      abstract: stripTags(it.abstract),
      cited_by_count: typeof it['is-referenced-by-count'] === 'number' ? it['is-referenced-by-count'] : null,
      is_open_access: null,
      found_via: ['crossref'] as LiteratureBackend[],
    }
  })
}

async function searchEuropePmc(q: string, limit: number, o: { yearFrom?: number; yearTo?: number; oaOnly?: boolean }): Promise<LiteratureHit[]> {
  let query = q
  if (o.yearFrom || o.yearTo) query += ` AND (PUB_YEAR:[${o.yearFrom ?? 1500} TO ${o.yearTo ?? 2100}])`
  if (o.oaOnly) query += ' AND (OPEN_ACCESS:y)'
  const url =
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}` +
    `&format=json&pageSize=${limit}&resultType=core`

  const data = (await getJson(url)) as { resultList?: { result?: Array<Record<string, any>> } }
  return (data.resultList?.result ?? []).map((r) => {
    const doi = cleanDoi(r.doi)
    const full = (r.fullTextUrlList?.fullTextUrl ?? []).find((u: any) => u?.availability === 'Open access') ?? null
    const oa = full?.url ?? (r.isOpenAccess === 'Y' && r.pmcid ? `https://europepmc.org/article/PMC/${r.pmcid}` : null)
    const landing = r.pmcid ? `https://europepmc.org/article/PMC/${r.pmcid}` : null
    return {
      title: String(r.title ?? '(ohne Titel)'),
      authors: typeof r.authorString === 'string' ? r.authorString.split(/,\s*/).slice(0, 12) : [],
      year: r.pubYear ? Number(r.pubYear) : null,
      doi,
      url: preferLanding(doi ? `https://doi.org/${doi}` : null, landing, oa),
      oa_url: oa,
      venue: r.journalTitle ?? null,
      abstract: stripTags(r.abstractText),
      cited_by_count: typeof r.citedByCount === 'number' ? r.citedByCount : null,
      is_open_access: r.isOpenAccess === 'Y',
      found_via: ['europepmc'] as LiteratureBackend[],
    }
  })
}

async function searchArxiv(q: string, limit: number): Promise<LiteratureHit[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&max_results=${limit}`
  const xml = await getText(url)
  const entries = xml.split('<entry>').slice(1)
  return entries.map((e) => {
    const pick = (tag: string) => e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? null
    const id = pick('id')
    const published = pick('published')
    const doi = cleanDoi(pick('arxiv:doi') ?? '')
    const pdf = e.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/)?.[1] ?? null
    return {
      title: stripTags(pick('title')) ?? '(ohne Titel)',
      authors: [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].slice(0, 12).map((m) => m[1].trim()),
      year: published ? Number(published.slice(0, 4)) : null,
      doi,
      url: preferLanding(id, doi ? `https://doi.org/${doi}` : null, pdf),
      oa_url: pdf ?? id, // arXiv ist immer frei zugänglich
      venue: 'arXiv',
      abstract: stripTags(pick('summary')),
      cited_by_count: null,
      is_open_access: true,
      found_via: ['arxiv'] as LiteratureBackend[],
    }
  })
}

// ------------------------------------------------------------------ Zusammenführung

/** Titel für den Duplikat-Abgleich normalisieren (DOI hat Vorrang, fehlt aber oft). */
function titleKey(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 90)
}

function merge(lists: LiteratureHit[][]): LiteratureHit[] {
  const byKey = new Map<string, LiteratureHit>()
  for (const list of lists) {
    for (const hit of list) {
      const key = hit.doi ? `doi:${hit.doi}` : `title:${titleKey(hit.title)}`
      const seen = byKey.get(key)
      if (!seen) {
        byKey.set(key, { ...hit })
        continue
      }
      // Dieselbe Arbeit aus mehreren Registern: Felder zusammenführen, nichts überschreiben.
      seen.found_via = [...new Set([...seen.found_via, ...hit.found_via])]
      seen.doi ??= hit.doi
      seen.oa_url ??= hit.oa_url
      seen.url ??= hit.url
      seen.venue ??= hit.venue
      seen.abstract ??= hit.abstract
      seen.year ??= hit.year
      seen.cited_by_count ??= hit.cited_by_count
      seen.is_open_access ??= hit.is_open_access
      if (seen.authors.length === 0) seen.authors = hit.authors
    }
  }
  return [...byKey.values()]
}

/**
 * Faire Auswahl über die Register hinweg.
 *
 * Naives Sortieren nach Zitationszahl verdrängt ganze Register: arXiv-Preprints haben
 * dort gar keinen Wert und fielen komplett aus der Liste — ausgerechnet die frei
 * zugänglichen Treffer. Deshalb: Mehrfachfunde zuerst (Triangulation ist ein echtes
 * Qualitätssignal), danach reihum ein Treffer je Register.
 */
function selectFairly(hits: LiteratureHit[], max: number): LiteratureHit[] {
  const byCitations = (a: LiteratureHit, b: LiteratureHit) => (b.cited_by_count ?? -1) - (a.cited_by_count ?? -1)

  const multi = hits.filter((h) => h.found_via.length > 1).sort(byCitations)
  const single = hits.filter((h) => h.found_via.length === 1)

  const buckets = new Map<LiteratureBackend, LiteratureHit[]>()
  for (const h of single) {
    const b = h.found_via[0]
    if (!buckets.has(b)) buckets.set(b, [])
    buckets.get(b)!.push(h)
  }
  for (const list of buckets.values()) list.sort(byCitations)

  const out = multi.slice(0, max)
  const order = [...buckets.keys()]
  for (let round = 0; out.length < max; round++) {
    let addedThisRound = false
    for (const b of order) {
      const next = buckets.get(b)![round]
      if (!next) continue
      out.push(next)
      addedThisRound = true
      if (out.length >= max) break
    }
    if (!addedThisRound) break
  }
  return out
}

const BACKEND_LABEL: Record<LiteratureBackend, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  europepmc: 'Europe PMC',
  arxiv: 'arXiv',
}

/**
 * Sucht parallel in mehreren offenen Wissenschafts-Registern, führt Treffer über
 * DOI/Titel zusammen und protokolliert jede Teilsuche einzeln (PRISMA-S).
 * Ein ausgefallenes Register bricht die Suche NICHT ab — es wird gemeldet.
 */
export async function searchLiterature(repo: Repo, rawInput: unknown, actor: string): Promise<LiteratureResult> {
  const parsed = literatureInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    throw new ServiceError(
      'literature_invalid',
      'Eingabe ungültig — ' + parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      'Korrigiere GENAU die oben genannten Felder und rufe search_literature erneut auf.'
    )
  }
  const input = parsed.data
  if (!repo.getProject(input.project_id)) {
    throw new ServiceError(
      'project_not_found',
      `Projekt ${input.project_id} existiert nicht.`,
      'Rufe list_projects auf und verwende eine der dort genannten project_id. Erfinde keine ID.'
    )
  }
  requireAdoptedBrief(repo, input.project_id)
  const brief = repo.getAdoptedBrief(input.project_id)
  const yearFrom = input.year_from ?? brief?.year_from ?? undefined
  const yearTo = input.year_to ?? brief?.year_to ?? undefined
  if (yearFrom && yearTo && yearFrom > yearTo) {
    throw new ServiceError(
      'year_range_invalid',
      `year_from (${yearFrom}) liegt hinter year_to (${yearTo}).`,
      'Vertausche die beiden Werte: year_from muss das frühere Jahr sein.'
    )
  }

  // Psychologie: dieselben offenen Register; arXiv nur wenn der Aufruf es explizit setzt. PSYNDEX fehlt.
  const openRegisters: LiteratureBackend[] = ['openalex', 'crossref', 'europepmc']
  const backends: LiteratureBackend[] = input.backends?.length ? [...new Set(input.backends)] : [...openRegisters]
  const limit = input.limit ?? 10
  const opts = { yearFrom, yearTo, oaOnly: input.open_access_only }

  const settled = await Promise.allSettled(
    backends.map((b) => {
      switch (b) {
        case 'openalex':
          return searchOpenAlex(input.query, limit, opts)
        case 'crossref':
          return searchCrossref(input.query, limit, opts)
        case 'europepmc':
          return searchEuropePmc(input.query, limit, opts)
        case 'arxiv':
          return searchArxiv(input.query, limit)
        default: {
          const _exhaustive: never = b
          return Promise.reject(new Error(`Unbekanntes Register: ${_exhaustive}`))
        }
      }
    })
  )

  const lists: LiteratureHit[][] = []
  const used: LiteratureBackend[] = []
  const failed: Array<{ backend: LiteratureBackend; error: string }> = []
  const logIds: string[] = []

  settled.forEach((r, i) => {
    const backend = backends[i]
    if (r.status === 'fulfilled') {
      lists.push(r.value)
      used.push(backend)
      // PRISMA-S: jede Teilsuche einzeln protokollieren, auch die mit 0 Treffern.
      logIds.push(
        repo.addSearchLog({
          project_id: input.project_id,
          query: input.query,
          engine: BACKEND_LABEL[backend],
          results_found: r.value.length,
          note: input.note ?? null,
          actor,
        }).id
      )
    } else {
      failed.push({ backend, error: String(r.reason instanceof Error ? r.reason.message : r.reason) })
      logIds.push(
        repo.addSearchLog({
          project_id: input.project_id,
          query: input.query,
          engine: BACKEND_LABEL[backend],
          results_found: null,
          note: `FEHLGESCHLAGEN: ${String(r.reason instanceof Error ? r.reason.message : r.reason)}`,
          actor,
        }).id
      )
    }
  })

  if (used.length === 0) {
    throw new ServiceError(
      'all_backends_failed',
      `Alle Register nicht erreichbar: ${failed.map((f) => `${BACKEND_LABEL[f.backend]} (${f.error})`).join(', ')}`,
      'Rufe search_literature in einem Moment erneut auf — die Register sind offene Dienste und gelegentlich kurz nicht erreichbar. ' +
        'Bleibt es dabei, weiche auf fetch_source mit einer konkreten URL aus. Die Fehlversuche stehen bereits im Suchprotokoll.'
    )
  }

  const hits = selectFairly(merge(lists), limit * 2)
  const withOa = hits.filter((h) => h.oa_url).length
  const triangulated = hits.filter((h) => h.found_via.length > 1).length

  return {
    query: input.query,
    backends_used: used,
    backends_failed: failed,
    total: hits.length,
    hits,
    search_log_ids: logIds,
    hint:
      `${hits.length} Arbeiten aus ${used.map((b) => BACKEND_LABEL[b]).join(', ')}; ${withOa} mit frei zugänglichem Volltext` +
      (triangulated > 0 ? `, ${triangulated} in mehreren Registern gefunden (stehen oben)` : '') +
      '. ' +
      'Die Suchen sind bereits protokolliert — log_search ist hier NICHT nötig. ' +
      'Nächster Schritt: oa_url (HTML oder PDF) mit fetch_source abrufen und die Quelle per document_id + Offsets belegen. ' +
      'url ist die Landing-Page/DOI — nicht automatisch die PDF. ' +
      'Ohne oa_url führt die url auf die Verlagsseite (evtl. Paywall) — dann exclude_source mit Grund "Paywall" ' +
      'oder eine frei zugängliche Fassung suchen.' +
      (brief?.discipline === 'psychology'
        ? ' Disziplin Psychologie: OpenAlex/Crossref/Europe PMC (PubMed teilweise). PSYNDEX ist nicht angebunden — deutschsprachige Fachliteratur bleibt eine ehrliche Lücke im Brief.'
        : ''),
  }
}
