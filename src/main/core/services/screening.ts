import type { Repo } from '../repo'
import type { FetchDocumentResult } from './research'
import { fetchDocument, recordExclusion, ServiceError } from './research'
import type { ScreeningCandidate, ScreeningStatus } from '../../../shared/types'

export const screenExcludeSchemaReasonMin = 10
export const WAIT_SCREENING_DEFAULT_MS = 90_000
export const WAIT_SCREENING_MAX_MS = 300_000
export const WAIT_SCREENING_POLL_MS = 500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function openIdsOf(candidates: ScreeningCandidate[]): Set<string> {
  return new Set(candidates.filter((c) => c.status === 'undecided' || c.status === 'maybe').map((c) => c.id))
}

function screeningNextAction(all: ScreeningCandidate[]): string {
  const included = all.filter((c) => c.status === 'included')
  const open = all.filter((c) => c.status === 'undecided' || c.status === 'maybe').length
  if (all.length === 0) {
    return 'Der Sichtungstisch ist leer. Nach search_literature liegen die Treffer hier. Nicht aus Snippets belegen.'
  }
  if (included.length > 0) {
    const withDoc = included.filter((c) => c.document_id).length
    const capture = included.length - withDoc
    const read =
      withDoc > 0
        ? `read_document auf die ${withDoc} document_id(s), dann add_source mit Offsets.`
        : 'included ohne Dokument: Capture im Korpus oder offene Quellen zuerst dokumentieren, dann include_screening erneut.'
    const rest =
      open > 0
        ? ` ${open} Karten noch offen — wait_for_screening erneut, oder include_screening wenn der Mensch im Chat Rein gesagt hat.`
        : ''
    return `${included.length} Rein.${capture > 0 ? ` ${capture} ohne Volltext.` : ''} ${read}${rest}`
  }
  if (open > 0) {
    return `${open} Treffer warten auf den Menschen (Tab Sichtung: Rein / Raus / Unsicher). fetch_source auf offenen Karten ist gesperrt. wait_for_screening, bis Karten entschieden sind. Chat-Rein: include_screening mit candidate_id und Grund. Nicht die ganze Welle includen.`
  }
  return 'Keine offenen Karten. Eine neue Suche nach reflect_search — oder fetch_source auf URLs, die nicht auf dem Tisch liegen.'
}

function assertCandidate(repo: Repo, id: string): ScreeningCandidate {
  const c = repo.getScreeningCandidate(id)
  if (!c) {
    throw new ServiceError(
      'screening_missing',
      'Dieser Treffer liegt nicht auf dem Sichtungstisch.',
      'Lade die Sichtung neu. search_literature legt die Karten an.'
    )
  }
  return c
}

export function listScreeningDesk(
  repo: Repo,
  projectId: string,
  status?: ScreeningStatus | 'open' | 'all'
): {
  counts: Record<ScreeningStatus, number>
  candidates: ScreeningCandidate[]
  next_action: string
} {
  const all = repo.listScreeningCandidates(projectId)
  const counts: Record<ScreeningStatus, number> = { undecided: 0, maybe: 0, included: 0, excluded: 0 }
  for (const c of all) counts[c.status] += 1
  let candidates = all
  if (status === 'open') candidates = all.filter((c) => c.status === 'undecided' || c.status === 'maybe')
  else if (status && status !== 'all') candidates = all.filter((c) => c.status === status)
  return {
    counts,
    candidates,
    next_action: screeningNextAction(all),
  }
}

export async function includeScreeningCandidate(
  repo: Repo,
  candidateId: string,
  actor: string,
  note?: string | null
): Promise<{ candidate: ScreeningCandidate; fetch: FetchDocumentResult }> {
  const c = assertCandidate(repo, candidateId)
  if (c.status === 'excluded') {
    throw new ServiceError(
      'screening_locked',
      'Diese Karte ist schon ausgeschlossen.',
      'Eine ausgeschlossene Karte kommt nicht zurück auf den Tisch.'
    )
  }
  const fetchUrl = c.oa_url || c.url
  if (!fetchUrl.startsWith('http://') && !fetchUrl.startsWith('https://')) {
    throw new ServiceError(
      'screening_no_url',
      'Dieser Treffer hat keine abrufbare URL.',
      'Verwirf die Karte oder öffne die DOI im Browser und lege die PDF auf einen Capture-Auftrag.'
    )
  }
  const reason = note?.trim() ? note.trim() : null
  if (c.status !== 'included') repo.setScreeningDecision(c.id, 'included', actor, reason)
  const fetch = await fetchDocument(
    repo,
    {
      project_id: c.project_id,
      url: fetchUrl,
      purpose: 'Zur Volltext-Sichtung ausgewählt.',
    },
    actor
  )
  repo.linkScreeningDocument(c.id, fetch.document_id, actor)
  return { candidate: repo.getScreeningCandidate(c.id)!, fetch }
}

export function excludeScreeningCandidate(
  repo: Repo,
  candidateId: string,
  reason: string,
  actor: string
): ScreeningCandidate {
  const c = assertCandidate(repo, candidateId)
  if (c.status === 'excluded') {
    throw new ServiceError(
      'screening_locked',
      'Diese Karte ist schon ausgeschlossen.',
      'Eine ausgeschlossene Karte kommt nicht zurück auf den Tisch.'
    )
  }
  const trimmed = reason.trim()
  if (trimmed.length < screenExcludeSchemaReasonMin) {
    throw new ServiceError(
      'screening_reason',
      `Der Ausschlussgrund muss mindestens ${screenExcludeSchemaReasonMin} Zeichen haben.`,
      'Schreibe, warum der Treffer den Plan nicht trifft (Irrelevanz, Duplikat, Sprache, Qualität).'
    )
  }
  recordExclusion(
    repo,
    {
      project_id: c.project_id,
      url: c.url,
      title: c.title,
      reason: trimmed,
    },
    actor
  )
  return repo.getScreeningCandidate(c.id) ?? { ...c, status: 'excluded', decision_reason: trimmed }
}

export function maybeScreeningCandidate(repo: Repo, candidateId: string, actor: string): ScreeningCandidate {
  const c = assertCandidate(repo, candidateId)
  if (c.status === 'included' || c.status === 'excluded') {
    throw new ServiceError(
      'screening_locked',
      'Diese Karte ist schon entschieden.',
      'Included holst du im Korpus; Excluded bleibt ausgeschlossen.'
    )
  }
  return repo.setScreeningDecision(c.id, 'maybe', actor, null)!
}

export async function includeScreeningInProject(
  repo: Repo,
  projectId: string,
  candidateId: string,
  actor: string,
  note?: string | null
): Promise<{ candidate: ScreeningCandidate; fetch: FetchDocumentResult }> {
  const c = assertCandidate(repo, candidateId)
  if (c.project_id !== projectId) {
    throw new ServiceError(
      'screening_wrong_project',
      'Diese Karte gehört zu einem anderen Projekt.',
      'Rufe list_screening mit der project_id des aktiven Projekts auf und nimm eine id von dort.'
    )
  }
  return includeScreeningCandidate(repo, candidateId, actor, note)
}

export interface WaitScreeningResult {
  waited_ms: number
  timed_out: boolean
  counts: Record<ScreeningStatus, number>
  decided: ScreeningCandidate[]
  still_open: number
  next_action: string
}

/**
 * Blockiert, bis der Mensch mindestens eine offene Karte entscheidet — oder Timeout.
 * Liegen schon included-Karten bereit, kehrt der Aufruf sofort zurück.
 */
export async function waitForScreening(
  repo: Repo,
  input: { project_id: string; timeout_ms?: number; poll_ms?: number }
): Promise<WaitScreeningResult> {
  const timeout = Math.min(input.timeout_ms ?? WAIT_SCREENING_DEFAULT_MS, WAIT_SCREENING_MAX_MS)
  const poll = Math.max(input.poll_ms ?? WAIT_SCREENING_POLL_MS, 20)
  const started = Date.now()

  const snapshot = () => repo.listScreeningCandidates(input.project_id)

  const finish = (all: ScreeningCandidate[], timedOut: boolean, decided: ScreeningCandidate[]): WaitScreeningResult => {
    const counts: Record<ScreeningStatus, number> = { undecided: 0, maybe: 0, included: 0, excluded: 0 }
    for (const c of all) counts[c.status] += 1
    return {
      waited_ms: Date.now() - started,
      timed_out: timedOut,
      counts,
      decided,
      still_open: counts.undecided + counts.maybe,
      next_action: timedOut && counts.undecided + counts.maybe > 0
        ? `Zeit abgelaufen, ${counts.undecided + counts.maybe} Karten noch offen. Der Mensch sichtet im Tab — wait_for_screening erneut oder list_screening.`
        : screeningNextAction(all),
    }
  }

  let all = snapshot()
  const alreadyIncluded = all.filter((c) => c.status === 'included')
  if (alreadyIncluded.length > 0) return finish(all, false, alreadyIncluded)
  if (openIdsOf(all).size === 0) return finish(all, false, [])

  const initialOpen = openIdsOf(all)
  while (Date.now() - started < timeout) {
    await sleep(poll)
    all = snapshot()
    const nowOpen = openIdsOf(all)
    const decided = all.filter((c) => initialOpen.has(c.id) && !nowOpen.has(c.id))
    if (decided.length > 0) return finish(all, false, decided)
  }
  return finish(snapshot(), true, [])
}
