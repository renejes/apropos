import { useEffect, useState } from 'react'
import type { CoverageGap, CoverageGapKind, CoverageReport, ProjectState } from '../../../shared/types'
import { Badge, Card, SectionTitle } from './ui'

/**
 * Abdeckung & Lücken — dieselbe serverseitige Rechnung, die auch das Berichts-Gate
 * für die KI benutzt (computeCoverage). Bewusst kein zweiter, UI-eigener Maßstab:
 * Mensch und KI sehen exakt denselben Stand.
 */

const GAP_LABEL: Record<CoverageGapKind, string> = {
  no_plan: 'Keine Planung',
  subquestion_uncovered: 'Teilfrage unbelegt',
  subquestion_unverified: 'Belege halten nicht',
  source_unassigned: 'Quelle nicht zugeordnet',
  source_quote_failed: 'Zitat nicht auffindbar',
  source_quote_unchecked: 'Zitat ungeprüft',
  claim_unlinked: 'Aussage ohne Beleg',
  claim_missing: 'Keine Aussagen',
  link_refuted: 'Belegkante widerlegt',
  link_unverified: 'Belegkante ungeprüft',
  empirical_shortfall: 'Zu wenige empirische Quellen',
  year_range_shortfall: 'Zeitraum des Briefs nicht bedient',
}

/** UUIDs aus der KI-Handlungsanweisung entfernen — der Mensch klickt, statt IDs zu tippen. */
function humanAction(text: string): string {
  return text
    .replace(/\s*mit\s+\w+="[0-9a-f-]{36}"\s*/gi, ' ')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function CoverageBar({ done, target }: { done: number; target: number }) {
  const pct = Math.min(100, target === 0 ? 100 : (done / target) * 100)
  const full = done >= target
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden bg-hairline">
        <div className={`h-full ${full ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs tabular-nums ${full ? 'text-ok' : 'text-muted'}`}>
        {done}/{target}
      </span>
    </div>
  )
}

export default function CoveragePanel({
  projectId,
  state,
  refreshKey,
  onOpenSource,
  onOpenClaim,
}: {
  projectId: string
  state: ProjectState
  refreshKey: number
  onOpenSource?: (sourceId: string) => void
  onOpenClaim?: () => void
}) {
  const [cov, setCov] = useState<CoverageReport | null>(null)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api.getCoverage(projectId).then((c) => {
      if (alive) setCov(c)
    })
    return () => {
      alive = false
    }
  }, [projectId, refreshKey])

  if (!cov) return null

  const verifiedPerSq = new Map<string, number>()
  for (const s of state.sources) {
    if (!s.sub_question_id || s.review_status === 'rejected') continue
    if (s.quote_verified === 1 || s.review_status === 'human_signed') {
      const key = `${s.sub_question_id}|${s.url}`
      if (!verifiedPerSq.has(key)) verifiedPerSq.set(key, 1)
    }
  }
  const countFor = (sqId: string) => [...verifiedPerSq.keys()].filter((k) => k.startsWith(`${sqId}|`)).length

  const activeSq = state.subQuestions.filter((s) => s.status !== 'dropped')
  const blocking = cov.gaps.filter((g) => g.blocking)
  const informational = cov.gaps.filter((g) => !g.blocking)
  const shown = showAll ? blocking : blocking.slice(0, 6)

  const gapTarget = (g: CoverageGap) => {
    if (g.kind.startsWith('source_') && onOpenSource) return () => onOpenSource(g.entity_id)
    if (g.kind.startsWith('claim_') && onOpenClaim) return onOpenClaim
    return undefined
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle>Recherchetiefe</SectionTitle>
        {cov.ready_for_report ? (
          <Badge tone="emerald">Bericht freigegeben</Badge>
        ) : (
          <Badge tone="amber">
            {blocking.length} {blocking.length === 1 ? 'Lücke' : 'Lücken'}
          </Badge>
        )}
      </div>

      <p className="mb-4 text-sm text-muted">{cov.summary}</p>

      {activeSq.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {activeSq.map((sq) => {
            const done = countFor(sq.id)
            return (
              <div key={sq.id} className="flex items-start justify-between gap-3 px-2 py-1.5">
                <span className={`text-sm ${done >= sq.min_sources ? 'text-muted' : 'text-fg'}`}>{sq.question}</span>
                <div className="shrink-0 pt-0.5">
                  <CoverageBar done={done} target={sq.min_sources} />
                </div>
              </div>
            )
          })}
          {state.subQuestions.length > activeSq.length && (
            <div className="px-2 pt-1 text-xs text-muted">
              {state.subQuestions.length - activeSq.length} Teilfrage(n) verworfen
            </div>
          )}
        </div>
      )}

      {blocking.length > 0 && (
        <div className="space-y-1">
          {shown.map((g) => {
            const onClick = gapTarget(g)
            return (
              <div
                key={`${g.kind}-${g.entity_id}`}
                onClick={onClick}
                className={`flex items-start gap-2 border border-warn bg-warn-bg px-3 py-2 ${onClick ? 'cursor-pointer' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-semibold text-warn">{GAP_LABEL[g.kind]}</span>
                    <span className="truncate text-xs">{g.label}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{g.detail}</div>
                  {/* next_action ist für die KI formuliert und enthält IDs — für den
                      Menschen sind die nur Rauschen. */}
                  <div className="mt-0.5 text-xs text-muted">→ {humanAction(g.next_action)}</div>
                </div>
              </div>
            )
          })}
          {blocking.length > shown.length && (
            <button onClick={() => setShowAll(true)} className="px-3 py-1 text-xs text-muted hover:text-fg">
              … {blocking.length - shown.length} weitere anzeigen
            </button>
          )}
        </div>
      )}

      {informational.length > 0 && (
        <div className="mt-3 text-xs text-muted">
          {informational.length} Belegkante(n) warten auf die geblindete Prüfung — das blockiert den Bericht nicht.
        </div>
      )}

      {state.rounds.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-3 font-mono text-xs text-muted">
          <span>Runden:</span>{' '}
          {state.rounds.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ' · '}
              {r.round_index}
              {r.ended_at ? ` (+${r.new_verified ?? 0})` : ' (läuft)'}
            </span>
          ))}
          {cov.stats.links_selfjudged > 0 && (
            <span className="ml-3 text-warn">
              {cov.stats.links_selfjudged} Kante(n) von derselben Session beurteilt — kein unabhängiger Beleg
            </span>
          )}
        </div>
      )}
    </Card>
  )
}
