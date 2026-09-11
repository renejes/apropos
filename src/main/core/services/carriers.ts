import { z } from 'zod'
import { createHash } from 'crypto'
import { isIP } from 'net'
import type { Repo } from '../repo'
import { fetchSourceText } from '../enforce/fetchers'
import { urlLooksLikePdf } from '../enforce/pdf'
import { ServiceError } from './research'
import type {
  Carrier,
  CarrierEvidenceBasis,
  CarrierKind,
  CarrierProfile,
  CarrierSignal,
  CarrierSignalKind,
  CarrierSignalOrigin,
  CarrierWatchlistEntry,
  DiscoveryMethod,
  DocumentContext,
  DocumentRole,
  FetchedDocument,
  WatchlistKind,
} from '../../../shared/types'

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, code: string): z.infer<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new ServiceError(
      code,
      parsed.error.issues.map((i) => i.message).join('; '),
      'Korrigiere die genannten Felder und rufe das Werkzeug erneut auf.'
    )
  }
  return parsed.data
}

function assertProject(repo: Repo, projectId: string): void {
  if (!repo.getProject(projectId)) {
    throw new ServiceError(
      'project_not_found',
      `Projekt ${projectId} existiert nicht.`,
      'Rufe list_projects auf und verwende eine der dort genannten project_id. Erfinde keine ID.'
    )
  }
}

const LITERATURE_BACKENDS = new Set(['openalex', 'crossref', 'europepmc', 'arxiv', 'semanticscholar', 'openaire'])

const SLD = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu'])

export function isHumanActor(actor: string): boolean {
  return actor === 'human:ui' || actor.startsWith('human:')
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

export function registrableDomain(host: string): string {
  const cleaned = host.toLowerCase().replace(/^www\./, '')
  if (isIP(cleaned)) return cleaned
  const parts = cleaned.split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  if (parts.length >= 3 && SLD.has(parts[parts.length - 2]!)) return parts.slice(-3).join('.')
  return parts.slice(-2).join('.')
}

export function domainMatches(hostOrUrl: string, listed: string): boolean {
  const listedNorm = listed.toLowerCase().replace(/^www\./, '').replace(/^\./, '')
  let host = hostOrUrl.toLowerCase().replace(/^www\./, '')
  if (host.includes('://')) host = hostOf(host) ?? host
  return host === listedNorm || host.endsWith(`.${listedNorm}`)
}

export function canonicalOrigin(url: string): string | null {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

const IMPRESSUM_HINT = /impressum|imprint|about(?:-us)?|über\s*uns|ueber\s*uns|legal\s*notice|masthead/i

export function findImpressumUrl(html: string, baseUrl: string): string | null {
  const origin = canonicalOrigin(baseUrl)
  const host = hostOf(baseUrl)
  if (!origin || !host) return null
  const domain = registrableDomain(host)
  const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  for (const m of hrefs) {
    const href = m[1]!.trim()
    const inner = m[2]!.replace(/<[^>]+>/g, ' ')
    const attr = m[0]
    if (!IMPRESSUM_HINT.test(inner) && !IMPRESSUM_HINT.test(href) && !IMPRESSUM_HINT.test(attr)) continue
    const absolute = resolveSameCarrierUrl(href, baseUrl, domain)
    if (absolute) return absolute
  }
  return null
}

function resolveSameCarrierUrl(href: string, baseUrl: string, domain: string): string | null {
  try {
    const absolute = new URL(href, baseUrl)
    if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return null
    const target = hostOf(absolute.href)
    if (!target || registrableDomain(target) !== domain) return null
    if (absolute.href.split('#')[0] === baseUrl.split('#')[0]) return null
    return absolute.href
  } catch {
    return null
  }
}

function fallbackImpressumUrl(fromUrl: string): string | null {
  const origin = canonicalOrigin(fromUrl)
  return origin ? `${origin}/impressum` : null
}

const CARRIER_KINDS = [
  'academic_publisher',
  'journal',
  'government',
  'ngo',
  'thinktank',
  'news',
  'blog',
  'party_media',
  'commercial',
  'personal',
  'unknown',
] as const

const EVIDENCE_BASES = ['imprint', 'about', 'landing', 'literature_register', 'domain_list', 'insufficient'] as const

export const assessCarrierSchema = z
  .object({
    project_id: z.string().min(1),
    carrier_id: z.string().min(1),
    observed: z.string().min(20),
    interpretation: z.string().min(20),
    uncertainty: z.string().min(10),
    carrier_kind: z.enum(CARRIER_KINDS),
    evidence_basis: z.enum(EVIDENCE_BASES),
    confidence: z.enum(['low', 'medium', 'high']).optional().nullable(),
    self_description_document_id: z.string().optional().nullable(),
    self_description_start: z.number().int().min(0).optional().nullable(),
    self_description_end: z.number().int().min(1).optional().nullable(),
    signals: z
      .array(
        z.object({
          signal_kind: z.enum([
            'imprint_missing',
            'imprint_quote',
            'about_quote',
            'ownership',
            'funding',
            'list_hit',
            'undisclosed_affiliation',
            'other',
          ]),
          label: z.string().min(2),
          detail: z.string().min(4),
          origin: z.enum(['document', 'domain_list', 'manual']).optional(),
          document_id: z.string().optional().nullable(),
          quote_start: z.number().int().min(0).optional().nullable(),
          quote_end: z.number().int().min(1).optional().nullable(),
        })
      )
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.evidence_basis === 'literature_register') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence_basis'],
        message: 'literature_register setzt nur der Server (Literatur-Shortcut). Wähle imprint, about, landing, domain_list oder insufficient.',
      })
    }
    const hasDoc = !!v.self_description_document_id
    const hasOffsets = v.self_description_start != null && v.self_description_end != null
    if (hasDoc !== hasOffsets) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['self_description_start'],
        message: 'Selbstdarstellung braucht document_id plus quote_start und quote_end — oder keines davon.',
      })
    }
    if (hasOffsets && v.self_description_end! <= v.self_description_start!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['self_description_end'],
        message: 'self_description_end muss größer als self_description_start sein.',
      })
    }
  })

export const watchlistInputSchema = z.object({
  project_id: z.string().min(1),
  list_kind: z.enum(['exclude', 'caution', 'prefer']),
  domain: z.string().min(3),
  note: z.string().min(8),
})

export interface CarrierAttachResult {
  carrier: Carrier
  context: DocumentContext
  landing_document_id: string | null
  imprint_document_id: string | null
  needs_assessment: boolean
  watchlist_hits: CarrierWatchlistEntry[]
  auto_profile: boolean
}

export interface FetchCarrierOpts {
  parentUrl?: string | null
  discoveryMethod?: DiscoveryMethod
  landingHtml?: string | null
}

/**
 * Legt Träger + Fundstelle zum Work-Dokument an.
 * Landing/Impressum zählen nicht ins Pending-Gate. Fehlendes Impressum bleibt ehrlich leer.
 */
export async function attachDocumentContext(
  repo: Repo,
  work: FetchedDocument,
  actor: string,
  opts: FetchCarrierOpts = {}
): Promise<CarrierAttachResult | null> {
  if (work.origin === 'upload' || work.origin === 'youtube') return null
  if (!work.url.startsWith('http://') && !work.url.startsWith('https://')) return null

  const parentUrl = normalizeOptionalUrl(opts.parentUrl)
  const discoveryUrl = parentUrl && parentUrl !== work.url ? parentUrl : work.url
  const host = hostOf(discoveryUrl)
  if (!host) return null
  const domain = registrableDomain(host)
  const origin = canonicalOrigin(discoveryUrl) ?? discoveryUrl

  const carrier = repo.ensureCarrier({
    project_id: work.project_id,
    registrable_domain: domain,
    canonical_url: origin.endsWith('/') ? origin : `${origin}/`,
    actor,
  })

  let landingId: string | null = null
  let landingHtml = opts.landingHtml ?? null
  if (parentUrl && parentUrl !== work.url) {
    const landing = await fetchContextPage(repo, work.project_id, parentUrl, 'landing', actor)
    if (landing) {
      landingId = landing.doc.id
      landingHtml = landing.html ?? landingHtml
    }
  } else if (!urlLooksLikePdf(work.url) && landingHtml == null) {
    landingId = work.id
  }

  const imprintFrom = landingId ? parentUrl || work.url : work.url
  let imprintId: string | null = null
  const imprintTarget = (landingHtml ? findImpressumUrl(landingHtml, imprintFrom) : null) ?? fallbackImpressumUrl(imprintFrom)
  if (imprintTarget && imprintTarget !== work.url && imprintTarget !== parentUrl) {
    const imprint = await fetchContextPage(repo, work.project_id, imprintTarget, 'imprint', actor)
    if (imprint) imprintId = imprint.doc.id
  }

  const screening = repo.findScreeningCandidate(work.project_id, { url: work.url })
  const method: DiscoveryMethod =
    opts.discoveryMethod ??
    (screening ? (isLiteratureHit(screening.found_via) ? 'literature' : 'screening') : parentUrl ? 'web_search' : 'direct')

  const context = repo.ensureDocumentContext({
    project_id: work.project_id,
    document_id: work.id,
    parent_document_id: landingId && landingId !== work.id ? landingId : null,
    carrier_id: carrier.id,
    discovery_url: discoveryUrl,
    discovery_method: method,
    search_log_id: screening?.search_log_id ?? null,
    screening_candidate_id: screening?.id ?? null,
    actor,
  })

  const watchlist_hits = repo.findWatchlistHits(work.project_id, domain)
  let auto_profile = false
  if (!repo.getCarrierProfileByCarrier(carrier.id) && screening && shouldAutoProfile(screening)) {
    writeLiteratureProfile(repo, carrier, screening.venue!, screening.found_via, actor)
    auto_profile = true
  }

  const profile = repo.getCarrierProfileByCarrier(carrier.id)
  return {
    carrier,
    context,
    landing_document_id: landingId,
    imprint_document_id: imprintId,
    needs_assessment: !profile,
    watchlist_hits,
    auto_profile,
  }
}

function isLiteratureHit(foundVia: string[]): boolean {
  return foundVia.some((v) => LITERATURE_BACKENDS.has(v))
}

function shouldAutoProfile(screening: { venue: string | null; found_via: string[] }): boolean {
  return Boolean(screening.venue?.trim()) && isLiteratureHit(screening.found_via)
}

function writeLiteratureProfile(repo: Repo, carrier: Carrier, venue: string, foundVia: string[], actor: string): void {
  const via = foundVia.filter((v) => LITERATURE_BACKENDS.has(v)).join(', ')
  repo.upsertCarrierProfile({
    carrier_id: carrier.id,
    project_id: carrier.project_id,
    observed: `Publikationsort „${venue}“ laut Literaturregister (${via || 'register'}). Trägerseite und Impressum wurden dafür nicht gelesen.`,
    interpretation: 'Akademischer Publikationsort aus dem Register — kein Blog- oder Kampagnenkontext geprüft.',
    uncertainty: 'Einordnung stützt sich auf Metadaten, nicht auf Impressum oder About-Seite.',
    evidence_basis: 'literature_register',
    confidence: 'medium',
    self_description_document_id: null,
    self_description_start: null,
    self_description_end: null,
    review_status: 'ai_checked',
    actor,
    carrier_kind: 'journal',
    display_name: venue,
  })
}

async function fetchContextPage(
  repo: Repo,
  projectId: string,
  url: string,
  role: Extract<DocumentRole, 'landing' | 'imprint' | 'about'>,
  actor: string
): Promise<{ doc: FetchedDocument; html: string | null } | null> {
  const existing = repo.listDocuments(projectId).find((d) => d.url === url && d.status !== 'excluded')
  if (existing) {
    const full = repo.getDocument(existing.id)
    return full ? { doc: full, html: null } : null
  }
  const fetched = await fetchSourceText(url)
  if (!fetched.ok || !fetched.text.trim()) return null
  const doc = repo.addDocument({
    project_id: projectId,
    url,
    text: fetched.text,
    content_hash: fetched.snapshotHash ?? createHash('sha256').update(fetched.text).digest('hex'),
    purpose: role === 'landing' ? 'Fundstelle / Trägerseite' : 'Impressum oder About des Trägers',
    actor,
    origin: 'fetched',
    page_starts: fetched.pageStarts ?? null,
    status: 'used',
    document_role: role,
  })
  return { doc, html: fetched.html ?? null }
}

function normalizeOptionalUrl(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v) return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.href
  } catch {
    return null
  }
}

export function assessCarrier(repo: Repo, rawInput: unknown, actor: string): {
  carrier: Carrier
  profile: CarrierProfile
  signals: CarrierSignal[]
  hint: string
} {
  const input = parseOrThrow(assessCarrierSchema, rawInput, 'carrier_assess_invalid')
  assertProject(repo, input.project_id)
  const carrier = repo.getCarrier(input.carrier_id)
  if (!carrier || carrier.project_id !== input.project_id) {
    throw new ServiceError(
      'carrier_not_found',
      `Träger ${input.carrier_id} existiert in diesem Projekt nicht.`,
      'Übernimm carrier_id aus der fetch_source-Antwort. Erfinde keine ID.'
    )
  }

  let selfStart = input.self_description_start ?? null
  let selfEnd = input.self_description_end ?? null
  if (input.self_description_document_id) {
    const doc = repo.getDocument(input.self_description_document_id)
    if (!doc || doc.project_id !== input.project_id) {
      throw new ServiceError(
        'document_not_found',
        'Das Dokument für die Selbstdarstellung gehört nicht zu diesem Projekt.',
        'Nimm eine document_id aus fetch_source (Landing oder Impressum), nicht die PDF, wenn der Beleg dort steht.'
      )
    }
    const sliced = doc.text.slice(selfStart!, selfEnd!)
    if (sliced.trim().length < 12) {
      throw new ServiceError(
        'quote_too_short',
        'Der Selbstdarstellungs-Ausschnitt ist zu kurz.',
        'Wähle Offsets so, dass ein vollständiger Satz aus Impressum oder About darin steht.'
      )
    }
  }

  const profile = repo.upsertCarrierProfile({
    carrier_id: carrier.id,
    project_id: carrier.project_id,
    observed: input.observed.trim(),
    interpretation: input.interpretation.trim(),
    uncertainty: input.uncertainty.trim(),
    evidence_basis: input.evidence_basis,
    confidence: input.confidence ?? null,
    self_description_document_id: input.self_description_document_id ?? null,
    self_description_start: selfStart,
    self_description_end: selfEnd,
    review_status: 'pending',
    actor,
    carrier_kind: input.carrier_kind,
    display_name: carrier.display_name,
  })

  repo.replaceCarrierSignals(profile.id)
  const watchHits = repo.findWatchlistHits(carrier.project_id, carrier.registrable_domain)
  for (const hit of watchHits) {
    repo.addCarrierSignal({
      carrier_profile_id: profile.id,
      signal_kind: 'list_hit',
      label: hit.list_kind === 'exclude' ? 'Watchlist-Ausschluss' : hit.list_kind === 'caution' ? 'Watchlist-Vorsicht' : 'Watchlist-bevorzugt',
      detail: hit.note,
      origin: 'domain_list',
      watchlist_id: hit.id,
    })
  }

  const imprintDocs = repo
    .listDocuments(carrier.project_id)
    .filter((d) => d.document_role === 'imprint' && hostOf(d.url) && domainMatches(d.url, carrier.registrable_domain))
  if (imprintDocs.length === 0 && input.evidence_basis !== 'literature_register') {
    repo.addCarrierSignal({
      carrier_profile_id: profile.id,
      signal_kind: 'imprint_missing',
      label: 'Kein Impressum abgerufen',
      detail: 'Es liegt kein Impressum-Dokument für diese Domain vor. Direkt-PDF ohne Landing bleibt ehrlich ohne Trägerseite.',
      origin: 'document',
    })
  }

  for (const sig of input.signals ?? []) {
    if (sig.signal_kind === 'list_hit') continue
    repo.addCarrierSignal({
      carrier_profile_id: profile.id,
      signal_kind: sig.signal_kind,
      label: sig.label,
      detail: sig.detail,
      origin: sig.origin ?? 'manual',
      document_id: sig.document_id ?? null,
      quote_start: sig.quote_start ?? null,
      quote_end: sig.quote_end ?? null,
    })
  }

  const exclude = watchHits.find((h) => h.list_kind === 'exclude')
  return {
    carrier: repo.getCarrier(carrier.id)!,
    profile: repo.getCarrierProfile(profile.id)!,
    signals: repo.listCarrierSignals(profile.id),
    hint: exclude
      ? `Watchlist exclude für ${carrier.registrable_domain}: add_source wird abgelehnt. exclude_source oder Watchlist im Tab Träger ändern.`
      : 'Trägerprofil gespeichert, Sign-off gebündelt im Tab Träger. Danach add_source mit document_id + Offsets.',
  }
}

export function addWatchlistEntry(
  repo: Repo,
  rawInput: unknown,
  actor: string
): CarrierWatchlistEntry {
  const input = parseOrThrow(watchlistInputSchema, rawInput, 'watchlist_invalid')
  assertProject(repo, input.project_id)
  const domain = registrableDomain(input.domain.replace(/^https?:\/\//, '').split('/')[0]!)
  if (!domain.includes('.')) {
    throw new ServiceError(
      'watchlist_domain',
      `„${input.domain}“ ist keine Domain.`,
      'Nimm eine Domain wie example.org, ohne Pfad.'
    )
  }
  return repo.addWatchlistEntry({
    project_id: input.project_id,
    list_kind: input.list_kind,
    domain,
    note: input.note.trim(),
    actor,
  })
}

export function removeWatchlistEntry(repo: Repo, id: string, actor: string): void {
  const row = repo.getWatchlistEntry(id)
  if (!row) {
    throw new ServiceError('watchlist_missing', 'Dieser Watchlist-Eintrag existiert nicht.', 'Lade den Tab Träger neu.')
  }
  repo.removeWatchlistEntry(id, actor)
}

export function signCarrierProfileHuman(
  repo: Repo,
  profileId: string,
  verdict: 'human_signed' | 'rejected',
  note: string | null,
  reviewer: string
): CarrierProfile {
  const profile = repo.getCarrierProfile(profileId)
  if (!profile) {
    throw new ServiceError('carrier_profile_missing', 'Dieses Trägerprofil existiert nicht.', 'Lade den Tab Träger neu.')
  }
  repo.signCarrierProfileHuman(profileId, verdict, note, reviewer)
  return repo.getCarrierProfile(profileId)!
}

export function assertCarrierAllowsSource(
  repo: Repo,
  input: { projectId: string; document: FetchedDocument | undefined; actor: string }
): { context_id: string | null; carrier_id: string | null } {
  const doc = input.document
  if (!doc || doc.document_role !== 'work') return { context_id: null, carrier_id: null }
  if (doc.origin === 'upload' || doc.origin === 'youtube') return { context_id: null, carrier_id: null }

  const context = repo.getLatestDocumentContext(doc.id)
  if (!context) return { context_id: null, carrier_id: null }

  const hits = repo.findWatchlistHits(input.projectId, repo.getCarrier(context.carrier_id)?.registrable_domain ?? '')
  const banned = hits.find((h) => h.list_kind === 'exclude')
  if (banned) {
    throw new ServiceError(
      'carrier_watchlist_exclude',
      `Die Domain steht auf der projektweiten Ausschlussliste (${banned.domain}): ${banned.note}`,
      'Nutze exclude_source. Die Watchlist änderst du im Tab Träger, nicht per Prompt.'
    )
  }

  const profile = repo.getCarrierProfileByCarrier(context.carrier_id)
  if (profile?.review_status === 'rejected') {
    throw new ServiceError(
      'carrier_rejected',
      'Dieser Träger ist menschlich abgelehnt.',
      'Nimm eine andere Fundstelle oder schließe die Quelle mit exclude_source aus.'
    )
  }

  if (!profile && !isHumanActor(input.actor)) {
    throw new ServiceError(
      'carrier_profile_required',
      `Träger ${context.carrier_id} hat noch kein Profil.`,
      `Rufe zuerst assess_carrier mit carrier_id ${context.carrier_id} auf (observed / interpretation / uncertainty / carrier_kind / evidence_basis).`
    )
  }

  return { context_id: context.id, carrier_id: context.carrier_id }
}

export function carrierHint(attach: CarrierAttachResult | null): string {
  if (!attach) return ''
  const hits = attach.watchlist_hits
  const exclude = hits.find((h) => h.list_kind === 'exclude')
  const caution = hits.filter((h) => h.list_kind === 'caution')
  const parts: string[] = []
  parts.push(
    `Träger ${attach.carrier.registrable_domain} (carrier_id ${attach.carrier.id}, context_id ${attach.context.id}).`
  )
  if (attach.context.parent_document_id) {
    parts.push(`Landing-Dokument ${attach.context.parent_document_id}.`)
  } else {
    parts.push('Keine Landing-Seite — Direkt-PDF oder die Work-URL ist selbst die Seite. Impressum ggf. unvollständig.')
  }
  if (attach.imprint_document_id) parts.push(`Impressum-Dokument ${attach.imprint_document_id}.`)
  if (exclude) parts.push(`WATCHLIST EXCLUDE: ${exclude.note} add_source wird abgelehnt.`)
  else if (caution.length) parts.push(`Watchlist Vorsicht: ${caution.map((c) => c.note).join(' ')}`)
  if (attach.auto_profile) {
    parts.push('Literatur-Shortcut: Profil aus Venue/Register (ai_checked). Mensch sichtet gebündelt im Tab Träger.')
  } else if (attach.needs_assessment) {
    parts.push(`TU JETZT: assess_carrier mit dieser carrier_id, danach add_source.`)
  }
  return ` ${parts.join(' ')}`
}

export function listCarrierDesk(repo: Repo, projectId: string): {
  pending: number
  carriers: Array<{
    carrier: Carrier
    profile: CarrierProfile | null
    signals: CarrierSignal[]
    watchlist_hits: CarrierWatchlistEntry[]
  }>
} {
  const carriers = repo.listCarriers(projectId)
  const watch = repo.listWatchlist(projectId)
  const rows = carriers.map((carrier) => {
    const profile = repo.getCarrierProfileByCarrier(carrier.id) ?? null
    return {
      carrier,
      profile,
      signals: profile ? repo.listCarrierSignals(profile.id) : [],
      watchlist_hits: watch.filter((w) => domainMatches(carrier.registrable_domain, w.domain)),
    }
  })
  return {
    pending: rows.filter((r) => !r.profile || r.profile.review_status === 'pending' || r.profile.review_status === 'ai_checked').length,
    carriers: rows,
  }
}

export type { WatchlistKind, CarrierEvidenceBasis, CarrierKind, CarrierSignalKind, CarrierSignalOrigin }
