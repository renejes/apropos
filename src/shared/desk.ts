import type { ProjectState, ReviewStatus, ScreeningCandidate, ScreeningStatus, Source } from './types'
import { isWorkDocument } from './types'

export type DeskPile = 'open' | 'accepted' | 'rejected'

export type DeskFolder = {
  id: string
  pile: DeskPile
  title: string
  origin: string
  year: number | null
  source: Source | null
  candidate: ScreeningCandidate | null
  documentId: string | null
}

function pileFromReview(status: ReviewStatus): DeskPile {
  switch (status) {
    case 'human_signed':
      return 'accepted'
    case 'rejected':
      return 'rejected'
    case 'pending':
    case 'ai_checked':
      return 'open'
    default: {
      const _never: never = status
      return _never
    }
  }
}

function pileFromScreening(status: ScreeningStatus): DeskPile {
  switch (status) {
    case 'excluded':
      return 'rejected'
    case 'undecided':
    case 'maybe':
    case 'included':
      return 'open'
    default: {
      const _never: never = status
      return _never
    }
  }
}

function claimSource(source: Source, docs: Set<string>, urls: Set<string>, dois: Set<string>): void {
  if (source.document_id) docs.add(source.document_id)
  urls.add(source.url)
  if (source.doi) dois.add(source.doi.toLowerCase())
}

function screeningClaimed(candidate: ScreeningCandidate, docs: Set<string>, urls: Set<string>, dois: Set<string>): boolean {
  if (candidate.document_id && docs.has(candidate.document_id)) return true
  if (urls.has(candidate.url)) return true
  if (candidate.oa_url && urls.has(candidate.oa_url)) return true
  if (candidate.doi && dois.has(candidate.doi.toLowerCase())) return true
  return false
}

/** Eine Akte auf dem Arbeitstisch: Quelle, sonst Screening-Karte, sonst unzugeordnetes Dokument. */
export function buildDeskFolders(
  state: Pick<ProjectState, 'sources' | 'screeningCandidates' | 'documents'>
): DeskFolder[] {
  const claimedDocs = new Set<string>()
  const claimedUrls = new Set<string>()
  const claimedDois = new Set<string>()
  const folders: DeskFolder[] = []

  for (const source of state.sources) {
    folders.push({
      id: `source:${source.id}`,
      pile: pileFromReview(source.review_status),
      title: source.title,
      origin: source.url,
      year: source.year,
      source,
      candidate: null,
      documentId: source.document_id,
    })
    claimSource(source, claimedDocs, claimedUrls, claimedDois)
  }

  for (const candidate of state.screeningCandidates) {
    if (screeningClaimed(candidate, claimedDocs, claimedUrls, claimedDois)) continue
    folders.push({
      id: `screening:${candidate.id}`,
      pile: pileFromScreening(candidate.status),
      title: candidate.title,
      origin: candidate.venue || candidate.url,
      year: candidate.year,
      source: null,
      candidate,
      documentId: candidate.document_id,
    })
    if (candidate.document_id) claimedDocs.add(candidate.document_id)
    claimedUrls.add(candidate.url)
    if (candidate.oa_url) claimedUrls.add(candidate.oa_url)
    if (candidate.doi) claimedDois.add(candidate.doi.toLowerCase())
  }

  for (const doc of state.documents) {
    if (!isWorkDocument(doc) || doc.status === 'excluded') continue
    if (claimedDocs.has(doc.id) || claimedUrls.has(doc.url)) continue
    folders.push({
      id: `document:${doc.id}`,
      pile: 'open',
      title: doc.title || doc.filename || doc.url,
      origin: doc.url,
      year: null,
      source: null,
      candidate: null,
      documentId: doc.id,
    })
    claimedDocs.add(doc.id)
    claimedUrls.add(doc.url)
  }

  const order: Record<DeskPile, number> = { open: 0, accepted: 1, rejected: 2 }
  return folders.sort((a, b) => {
    const pile = order[a.pile] - order[b.pile]
    if (pile !== 0) return pile
    const ta = a.source?.created_at ?? a.candidate?.updated_at ?? a.candidate?.created_at ?? ''
    const tb = b.source?.created_at ?? b.candidate?.updated_at ?? b.candidate?.created_at ?? ''
    return tb.localeCompare(ta)
  })
}

export function findDeskFolder(
  folders: DeskFolder[],
  focus: { sourceId?: string | null; documentId?: string | null }
): DeskFolder | undefined {
  if (focus.sourceId) {
    const bySource = folders.find((f) => f.source?.id === focus.sourceId)
    if (bySource) return bySource
  }
  if (focus.documentId) return folders.find((f) => f.documentId === focus.documentId)
  return undefined
}
