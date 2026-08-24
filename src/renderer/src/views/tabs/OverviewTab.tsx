import { useEffect, useState, type ReactNode } from 'react'
import type { DeterministicVerifyResult, ProjectState, SearchNextAction } from '../../../../shared/types'
import { groupSearchWaves, nextActionLabel } from '../../../../shared/search-waves'
import { Badge, Button, Card, SectionTitle } from '../../components/ui'
import CoveragePanel from '../../components/CoveragePanel'
import SayablePanel from '../../components/SayablePanel'

export default function OverviewTab({
  state,
  onReload,
  coverageKey,
  onOpenSource,
}: {
  state: ProjectState
  onReload: () => void
  coverageKey: number
  onOpenSource?: (sourceId: string) => void
}) {
  const [verifying, setVerifying] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [lastRun, setLastRun] = useState<DeterministicVerifyResult[] | null>(null)

  useEffect(() => {
    // Progress-getrieben: erkennt auch Läufe, die vor dem Mount gestartet wurden
    // oder aus einer anderen Quelle (MCP re_verify) laufen (Review-Finding).
    const off = window.api.onVerifyProgress((p) => {
      setProgress({ done: p.done, total: p.total })
      setVerifying(p.done < p.total)
    })
    return off
  }, [])

  const [busyMsg, setBusyMsg] = useState<string | null>(null)
  const runVerify = async () => {
    setVerifying(true)
    setProgress(null)
    setBusyMsg(null)
    try {
      const results = await window.api.runDeterministicVerify(state.project.id)
      setLastRun(results)
      onReload()
    } catch (err) {
      // In-Flight-Guard des Main-Prozesses: paralleler Lauf wurde abgelehnt
      setBusyMsg(String(err instanceof Error ? err.message : err).replace(/^.*Error:\s*/, ''))
    } finally {
      setVerifying(false)
      setProgress(null)
    }
  }

  const src = state.sources
  const stats: Array<{ label: string; value: number; tone?: string }> = [
    { label: 'Korpus', value: state.documents.filter((d) => d.status !== 'excluded').length },
    { label: 'Quellen', value: src.length },
    { label: 'offen', value: src.filter((s) => s.review_status === 'pending').length, tone: 'text-warn' },
    { label: 'KI-geprüft', value: src.filter((s) => s.review_status === 'ai_checked').length, tone: 'text-info' },
    { label: 'freigegeben', value: src.filter((s) => s.review_status === 'human_signed').length, tone: 'text-ok' },
    { label: 'Beleg fehlt', value: src.filter((s) => s.quote_verified === 0).length, tone: 'text-bad' },
    { label: 'Aussagen', value: state.claims.length },
    { label: 'Versionen', value: state.reportVersions.length },
    { label: 'Unsicherheiten', value: state.uncertaintyFlags.length, tone: state.uncertaintyFlags.length > 0 ? 'text-warn' : undefined },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <p className="text-xs leading-relaxed text-muted">
        Der Alltagsweg ist der <strong>Agent-Chat</strong> links (Cursor-Abo). Sign-off und Lückenprüfung bleiben hier.
      </p>

      <CoveragePanel projectId={state.project.id} state={state} refreshKey={coverageKey} onOpenSource={onOpenSource} />

      <SayablePanel state={state} />

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-hairline py-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className={`font-mono text-sm tabular-nums ${s.tone ?? 'text-fg'}`}>{s.value}</span>
            <span className="text-xs text-muted">{s.label}</span>
          </div>
        ))}
      </div>

      <Card className="p-5">
        <SectionTitle>Verifikations-Leiter</SectionTitle>
        <div className="space-y-3">
          <LadderStep
            n={1}
            title="Deterministische Prüfung (ohne KI)"
            desc="URL/DOI-Auflösung + wörtlicher Beleg-Abgleich gegen den frisch gefetchten Quelltext."
            action={
              <Button variant="primary" onClick={runVerify} disabled={verifying}>
                {verifying ? (progress ? `Prüfe ${progress.done}/${progress.total} …` : 'Prüfe …') : 'Jetzt prüfen'}
              </Button>
            }
          />
          <LadderStep
            n={2}
            title="Geblindete KI-Verifikation (Cross-Context)"
            desc={
              'Starte eine NEUE Chat-Session deiner KI (frischer Kontext), verbinde sie mit dem MCP-Server und gib ihr die Aufgabe: ' +
              '"Rufe re_verify mit depth=ai_judge auf und arbeite die Verifikations-Schleife ab." ' +
              'Die Session sieht nur Aussage + frischen Quelltext — nie die ursprüngliche Begründung.'
            }
          />
          <LadderStep
            n={5}
            title="Menschlicher Sign-off"
            desc="Letzte Instanz: Gib jede Quelle im Quellen-Tab explizit frei oder lehne sie ab. Erst dann gilt sie als belastbar."
          />
        </div>

        {busyMsg && <div className="mt-3 border border-warn bg-warn-bg p-3 text-sm text-warn">{busyMsg}</div>}

        {lastRun && (
          <div className="mt-4 border border-hairline p-3 text-sm">
            <span>Letzter Lauf:</span> {lastRun.length} geprüft ·{' '}
            <span className="text-ok">{lastRun.filter((r) => r.verdict === 'supported').length} belegt</span> ·{' '}
            <span className="text-bad">{lastRun.filter((r) => r.verdict === 'unsupported').length} nicht belegt</span> ·{' '}
            <span className="text-warn">{lastRun.filter((r) => r.verdict === 'source_unreachable').length} unerreichbar</span> ·{' '}
            <span className="text-muted">{lastRun.filter((r) => r.verdict === 'flagged').length} nicht prüfbar</span>
          </div>
        )}
      </Card>

      {(state.searchLog.length > 0 || state.searchReflections.length > 0 || state.excludedSources.length > 0) && (
        <Card className="p-5">
          <SectionTitle>Suchdokumentation</SectionTitle>
          {groupSearchWaves(state.searchLog, state.searchReflections).map((wave, i) => (
            <div key={wave.reflection?.id ?? `pending-${i}`} className="mb-4 last:mb-3">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
                Welle {i + 1}
                {wave.searches.length > 0 && ` · ${wave.searches.length} ${wave.searches.length === 1 ? 'Suche' : 'Suchen'}`}
              </div>
              {wave.searches.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {wave.searches.map((s) => (
                    <li key={s.id} className="flex items-baseline gap-2 text-sm">
                      <code className="font-mono text-xs">{s.query}</code>
                      <span className="text-xs text-muted">
                        {s.engine && `${s.engine} · `}
                        {s.results_found != null && `${s.results_found} Treffer`}
                        {s.results_found == null && s.note && 'fehlgeschlagen'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {wave.blocksSearch ? (
                <div className="border border-warn bg-warn-bg px-3 py-2 text-sm text-warn">
                  Lage ausstehend — die nächste Suche ist gesperrt, bis covered / underrepresented / next_action stehen.
                </div>
              ) : wave.reflection ? (
                <LageBlock
                  covered={wave.reflection.covered}
                  underrepresented={wave.reflection.underrepresented}
                  nextAction={wave.reflection.next_action}
                  nextQuery={wave.reflection.next_query}
                  reason={wave.reflection.reason}
                />
              ) : (
                <p className="text-xs text-muted">Register ausgefallen — Wiederholung ohne neue Lage erlaubt.</p>
              )}
            </div>
          ))}
          {state.excludedSources.length > 0 && (
            <div>
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
                Begründet ausgeschlossen ({state.excludedSources.length})
              </div>
              <ul className="space-y-1.5">
                {state.excludedSources.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="truncate">{e.title ?? e.url}</div>
                    <div className="text-xs text-muted">{e.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {state.uncertaintyFlags.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Von der KI gemeldete Unsicherheiten</SectionTitle>
          <ul className="space-y-2">
            {state.uncertaintyFlags.map((f) => (
              <li key={f.id} className="text-sm">
                <span>{f.uncertainty_reason}</span>
                <span className="ml-2 font-mono text-xs text-muted">(Konfidenz: {f.confidence_level})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function actionTone(action: SearchNextAction): 'amber' | 'sky' | 'emerald' {
  switch (action) {
    case 'search':
      return 'amber'
    case 'read':
      return 'sky'
    case 'enough':
      return 'emerald'
    default: {
      const _never: never = action
      return _never
    }
  }
}

function LageBlock({
  covered,
  underrepresented,
  nextAction,
  nextQuery,
  reason,
}: {
  covered: string
  underrepresented: string
  nextAction: SearchNextAction
  nextQuery: string | null
  reason: string
}) {
  return (
    <div className="border border-hairline px-3 py-2 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone={actionTone(nextAction)}>{nextActionLabel(nextAction)}</Badge>
        {nextQuery && <code className="font-mono text-xs">{nextQuery}</code>}
      </div>
      <p>
        <span className="text-muted">Getroffen: </span>
        {covered}
      </p>
      <p className="mt-1">
        <span className="text-muted">Unterrepräsentiert: </span>
        {underrepresented}
      </p>
      <p className="mt-1 text-xs text-muted">{reason}</p>
    </div>
  )
}

function LadderStep({ n, title, desc, action }: { n: number; title: string; desc: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 border border-hairline p-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center border border-line bg-fg font-mono text-xs text-bg">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{desc}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
