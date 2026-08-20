import { useEffect, useState } from 'react'
import type { DeterministicVerifyResult, ProjectState } from '../../../../shared/types'
import { Button, Card, Icon, SectionTitle } from '../../components/ui'
import CoveragePanel from '../../components/CoveragePanel'
import EnginePanel from '../../components/EnginePanel'
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
  const stats = [
    { icon: 'link', label: 'Quellen', value: src.length, tone: 'text-slate-700' },
    { icon: 'schedule', label: 'offen', value: src.filter((s) => s.review_status === 'pending').length, tone: 'text-amber-600' },
    { icon: 'neurology', label: 'KI-geprüft', value: src.filter((s) => s.review_status === 'ai_checked').length, tone: 'text-sky-600' },
    { icon: 'verified', label: 'freigegeben', value: src.filter((s) => s.review_status === 'human_signed').length, tone: 'text-emerald-600' },
    { icon: 'cancel', label: 'Beleg fehlt', value: src.filter((s) => s.quote_verified === 0).length, tone: 'text-red-600' },
    { icon: 'fact_check', label: 'Aussagen', value: state.claims.length, tone: 'text-slate-700' },
    { icon: 'description', label: 'Versionen', value: state.reportVersions.length, tone: 'text-slate-700' },
    { icon: 'flag', label: 'Unsicherheiten', value: state.uncertaintyFlags.length, tone: 'text-violet-600' },
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <p className="text-xs leading-relaxed text-slate-500">
        Der Alltagsweg ist der <strong>Agent-Chat</strong> links (Cursor-Abo). Die eingebaute Ollama-Engine darunter ist der Fallback
        ohne Cursor-Konto.
      </p>
      {/* Eingebaute Engine: Lauf starten, Fortschritt sehen, abbrechen */}
      <EnginePanel projectId={state.project.id} onChanged={onReload} />

      {/* Recherchetiefe: Teilfragen, Abdeckung, offene Lücken */}
      <CoveragePanel projectId={state.project.id} state={state} refreshKey={coverageKey} onOpenSource={onOpenSource} />

      <SayablePanel state={state} />

      {/* Kennzahlen */}
      <div className="grid grid-cols-4 gap-3 lg:grid-cols-8">
        {stats.map((s) => (
          <Card key={s.label} className="px-3 py-3 text-center">
            <Icon name={s.icon} className={`${s.tone}`} />
            <div className={`mt-1 text-xl font-semibold ${s.tone}`}>{s.value}</div>
            <div className="text-[11px] text-slate-400">{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Verifikations-Leiter */}
      <Card className="p-5">
        <SectionTitle>Verifikations-Leiter</SectionTitle>
        <div className="space-y-3">
          <LadderStep
            n={1}
            title="Deterministische Prüfung (ohne KI)"
            desc="URL/DOI-Auflösung + wörtlicher Beleg-Abgleich gegen den frisch gefetchten Quelltext."
            action={
              <Button variant="primary" icon="rule" onClick={runVerify} disabled={verifying}>
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

        {busyMsg && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{busyMsg}</div>}

        {lastRun && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <span className="font-medium">Letzter Lauf:</span> {lastRun.length} geprüft ·{' '}
            <span className="text-emerald-700">{lastRun.filter((r) => r.verdict === 'supported').length} belegt</span> ·{' '}
            <span className="text-red-700">{lastRun.filter((r) => r.verdict === 'unsupported').length} nicht belegt</span> ·{' '}
            <span className="text-amber-700">{lastRun.filter((r) => r.verdict === 'source_unreachable').length} unerreichbar</span> ·{' '}
            <span className="text-slate-500">{lastRun.filter((r) => r.verdict === 'flagged').length} nicht prüfbar</span>
          </div>
        )}
      </Card>

      {/* Suchdokumentation (PRISMA-S) */}
      {(state.searchLog.length > 0 || state.excludedSources.length > 0) && (
        <Card className="p-5">
          <SectionTitle>Suchdokumentation</SectionTitle>
          {state.searchLog.length > 0 && (
            <div className="mb-3">
              <div className="mb-1 text-xs font-medium text-slate-500">Durchgeführte Suchen ({state.searchLog.length})</div>
              <ul className="space-y-1">
                {state.searchLog.map((s) => (
                  <li key={s.id} className="flex items-baseline gap-2 text-sm">
                    <Icon name="search" className="!text-[14px] shrink-0 text-slate-400" />
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{s.query}</code>
                    <span className="text-xs text-slate-400">
                      {s.engine && `${s.engine} · `}
                      {s.results_found != null && `${s.results_found} Treffer`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.excludedSources.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Begründet ausgeschlossen ({state.excludedSources.length})</div>
              <ul className="space-y-1.5">
                {state.excludedSources.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="flex items-baseline gap-2">
                      <Icon name="do_not_disturb_on" className="!text-[14px] shrink-0 text-red-300" />
                      <span className="truncate text-slate-600">{e.title ?? e.url}</span>
                    </div>
                    <div className="ml-6 text-xs text-slate-400">{e.reason}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Unsicherheits-Flags */}
      {state.uncertaintyFlags.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Von der KI gemeldete Unsicherheiten</SectionTitle>
          <ul className="space-y-2">
            {state.uncertaintyFlags.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-sm">
                <Icon name="flag" className="icon-sm mt-0.5 text-violet-500" />
                <div>
                  <span className="text-slate-700">{f.uncertainty_reason}</span>
                  <span className="ml-2 text-xs text-slate-400">(Konfidenz: {f.confidence_level})</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function LadderStep({ n, title, desc, action }: { n: number; title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/50 p-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--color-accent-600) text-xs font-bold text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
