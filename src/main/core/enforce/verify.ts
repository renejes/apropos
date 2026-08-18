import type { Repo } from '../repo'
import type { DeterministicVerifyResult, Source, Verdict } from '../../../shared/types'
import { checkUrl, fetchSourceText } from './fetchers'
import { quoteInSource } from './textmatch'

/**
 * Verifikations-Ebene 1 (deterministisch, KEIN Modell) — siehe
 * documentation/01 "Verifikations-Layer". Für jede Quelle:
 *   1. URL/DOI auflösen (tote Links, erfundene DOIs)
 *   2. Quelle frisch fetchen und prüfen, ob verbatim_quote im Text vorkommt
 * Ergebnis wird als NEUE Review-Kante geschrieben (reviewer_type='deterministic'),
 * das Original wird nie überschrieben.
 */
export async function verifySourceDeterministic(repo: Repo, source: Source, actor: string): Promise<DeterministicVerifyResult> {
  const urlCheck = await checkUrl(source.url)

  let quoteVerified: boolean | null = null
  let quoteMatchScore: number | null = null
  let snapshotHash: string | null = null
  let quoteNote = ''

  if (urlCheck.reachable !== false) {
    const fetched = await fetchSourceText(source.url)
    snapshotHash = fetched.snapshotHash
    if (fetched.ok) {
      const match = quoteInSource(source.verbatim_quote, fetched.text)
      quoteVerified = match.found
      quoteMatchScore = match.score
      quoteNote = `quote ${match.found ? 'found' : 'NOT found'} (score ${match.score}, ${match.method})`
    } else {
      quoteNote = `source text not fetchable: ${fetched.note}`
    }
  } else {
    quoteNote = 'skipped (url unreachable)'
  }

  const verdict: Verdict =
    urlCheck.reachable === false
      ? 'source_unreachable'
      : quoteVerified === true
        ? 'supported'
        : quoteVerified === false
          ? 'unsupported'
          : 'flagged' // Prüfung nicht möglich (offline/PDF) → explizit flaggen, nie still durchwinken

  const note = `url: ${urlCheck.note}; ${quoteNote}`

  repo.setSourceChecks(
    source.id,
    { urlResolved: urlCheck.reachable, quoteVerified, quoteMatchScore },
    actor
  )
  repo.addReview({
    entity_type: 'source',
    entity_id: source.id,
    reviewer_type: 'deterministic',
    reviewer_id: actor,
    verdict,
    confidence: quoteVerified === true ? 'high' : quoteVerified === false ? 'high' : 'low',
    evidence_span: quoteVerified ? source.verbatim_quote.slice(0, 500) : null,
    source_snapshot_hash: snapshotHash,
    note,
    method: 'deterministic_l1',
  })

  return {
    sourceId: source.id,
    urlResolved: urlCheck.reachable,
    quoteVerified,
    quoteMatchScore,
    verdict,
    note,
  }
}

export interface ReVerifyOptions {
  scope: 'all_pending' | 'source_ids'
  sourceIds?: string[]
}

// Review-Finding: nur EIN deterministischer Pass pro Projekt gleichzeitig
// (UI, MCP-re_verify und stdio teilen sich diesen Guard prozessweit).
const runningPasses = new Set<string>()

export function isVerifyRunning(projectId: string): boolean {
  return runningPasses.has(projectId)
}

/** Batch-Pass über offene Quellen eines Projekts (sequenziell, um Ziel-Server zu schonen). */
export async function reVerifyProject(
  repo: Repo,
  projectId: string,
  opts: ReVerifyOptions,
  actor: string,
  onProgress?: (done: number, total: number, last: DeterministicVerifyResult) => void
): Promise<DeterministicVerifyResult[]> {
  if (runningPasses.has(projectId)) {
    throw new Error(`Für Projekt ${projectId} läuft bereits ein Verifikations-Pass — bitte warten, bis er abgeschlossen ist.`)
  }
  runningPasses.add(projectId)
  try {
    const all = repo.listSources(projectId)
    const targets =
      opts.scope === 'source_ids'
        ? all.filter((s) => opts.sourceIds?.includes(s.id))
        : all.filter((s) => s.review_status === 'pending' || s.quote_verified == null)

    const results: DeterministicVerifyResult[] = []
    for (const src of targets) {
      const res = await verifySourceDeterministic(repo, src, actor)
      results.push(res)
      onProgress?.(results.length, targets.length, res)
    }
    repo.logEvent(projectId, actor, 'verify.deterministic_pass', {
      scope: opts.scope,
      checked: results.length,
      unsupported: results.filter((r) => r.verdict === 'unsupported').length,
      unreachable: results.filter((r) => r.verdict === 'source_unreachable').length,
    })
    return results
  } finally {
    runningPasses.delete(projectId)
  }
}
