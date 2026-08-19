import { useCallback, useEffect, useRef, useState } from 'react'
import type { EngineEvent } from '../../../main/core/engine/research-engine'
import type { ModelInfo } from '../../../main/core/providers/types'
import type { EngineRun } from '../../../shared/types'
import { Badge, Button, Card, fmtDate, Icon, SectionTitle } from './ui'

/**
 * Bedienung der eingebauten Engine.
 *
 * Bewusst ein JOB-MONITOR, kein Chat: Ein Research-Lauf ist kein Dialog, sondern
 * eine Eingabe, minutenlange autonome Arbeit und ein Abbruch-Knopf. Ein
 * Chat-Fenster wäre hier eine schlechtere Version eines Agent-Clients.
 */

/** Nur die Ereignisse, die für einen Menschen etwas bedeuten. */
function describe(e: EngineEvent): { icon: string; text: string; tone: 'plain' | 'good' | 'warn' | 'bad' } | null {
  switch (e.type) {
    case 'phase':
      return { icon: e.phase === 'done' ? 'flag' : 'playlist_play', text: phaseLabel(e.phase, e.detail), tone: 'plain' }
    case 'resumed':
      return { icon: 'resume', text: e.detail, tone: 'warn' }
    case 'round_start':
      return { icon: 'refresh', text: `Runde ${e.round} beginnt`, tone: 'plain' }
    case 'round_end':
      return {
        icon: e.shouldContinue ? 'arrow_forward' : 'stop_circle',
        text: `Runde ${e.round} beendet — ${e.newVerified} neue belegte Quelle(n)${e.stopReason ? `. ${e.stopReason}` : ''}`,
        tone: e.shouldContinue ? 'plain' : 'good',
      }
    case 'subquestion_start':
      return { icon: 'search', text: `Teilfrage ${e.index}/${e.total}: ${e.question}`, tone: 'plain' }
    case 'subquestion_end':
      return {
        icon: e.result.stopReason === 'model_finished' ? 'check' : 'warning',
        text:
          `Teilfrage abgeschlossen (${e.result.stopReason}) — ${e.result.toolCalls} Werkzeugaufruf(e)` +
          (e.result.failedToolCalls ? `, davon ${e.result.failedToolCalls} fehlgeschlagen` : ''),
        tone: e.result.failedToolCalls > 0 ? 'warn' : 'plain',
      }
    case 'coverage':
      return { icon: 'checklist', text: e.report.summary, tone: e.report.ready_for_report ? 'good' : 'warn' }
    case 'error':
      return { icon: 'error', text: e.message, tone: e.fatal ? 'bad' : 'warn' }
    case 'finished':
      return { icon: 'task_alt', text: `Fertig: ${e.stopReason}`, tone: 'good' }
    case 'loop':
      // Werkzeugaufrufe sind interessant, roher Modelltext nicht.
      if (e.event.type === 'tool_end') {
        return {
          icon: e.event.ok ? 'build' : 'build_circle',
          text: `${e.event.name}${e.event.ok ? '' : ' — Fehler, Modell korrigiert'}`,
          tone: e.event.ok ? 'plain' : 'warn',
        }
      }
      return null
    default:
      return null
  }
}

function phaseLabel(phase: string, detail: string): string {
  const names: Record<string, string> = { planning: 'Planung', research: 'Recherche', synthesis: 'Synthese', done: 'Abschluss' }
  return `${names[phase] ?? phase}: ${detail}`
}

const TONES: Record<string, string> = {
  plain: 'text-slate-600',
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
}

/** Warum ein Lauf offen ist — der Unterschied zwischen Abbruch und Absturz zählt. */
function resumeLabel(run: EngineRun): string {
  const when = fmtDate(run.started_at)
  const why =
    run.status === 'interrupted'
      ? 'die App wurde beendet, während er lief'
      : run.status === 'failed'
        ? 'er ist gescheitert'
        : 'er wurde abgebrochen'
  const where = run.round_index ? ` Zuletzt: Runde ${run.round_index}${run.phase ? `, Phase ${run.phase}` : ''}.` : ''
  return `Lauf vom ${when} ist offen — ${why}.${where}${run.stop_reason ? ` ${run.stop_reason}` : ''}`
}

export default function EnginePanel({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [model, setModel] = useState('')
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<Array<{ id: number; icon: string; text: string; tone: string }>>([])
  const [err, setErr] = useState<string | null>(null)
  const [maxRounds, setMaxRounds] = useState(3)
  const [maxTotalTokens, setMaxTotalTokens] = useState(0)
  const [resumable, setResumable] = useState<EngineRun | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const counter = useRef(0)

  const push = useCallback((e: EngineEvent) => {
    const d = describe(e)
    if (!d) return
    setLines((prev) => [...prev.slice(-150), { id: counter.current++, ...d }])
  }, [])

  const refreshResumable = useCallback(() => {
    void window.api.engineResumable(projectId).then(setResumable)
  }, [projectId])

  useEffect(() => {
    void window.api.providerModels().then((m) => {
      setModels(m)
      // Cloud-Modelle bevorzugen — sie sind der geplante Hauptweg.
      setModel((cur) => cur || m.find((x) => x.cloud)?.id || m[0]?.id || '')
    })
    void window.api.engineStatus().then((s) => {
      setRunning(s.running)
      if (s.model) setModel(s.model)
      for (const e of s.recent) push(e)
    })
    refreshResumable()
  }, [push, refreshResumable])

  useEffect(() => {
    const off = window.api.onEngineEvent((e) => {
      push(e)
      // Bei jeder Runde und am Ende die Projektdaten neu laden, damit Quellen/Abdeckung stimmen.
      if (e.type === 'round_end' || e.type === 'finished') onChanged()
      if (e.type === 'finished') {
        setRunning(false)
        refreshResumable()
      }
    })
    return off
  }, [push, onChanged, refreshResumable])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [lines])

  const start = async (resume = false) => {
    setErr(null)
    setLines([])
    setRunning(true)
    try {
      await window.api.startEngine({ projectId, model, maxRounds, maxTotalTokens, resume })
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e).replace(/^.*Error:\s*/, ''))
      setRunning(false)
    } finally {
      onChanged()
      refreshResumable()
    }
  }

  const stop = async () => {
    await window.api.stopEngine()
  }

  const noModels = models.length === 0

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle>Eingebaute Engine</SectionTitle>
        {running && (
          <Badge tone="sky" icon="autorenew">
            läuft
          </Badge>
        )}
      </div>

      {/* Bewusst VOR der Modell-Prüfung: Dass ein Lauf offen ist, gilt unabhängig davon,
          ob gerade ein Modell erreichbar ist. Die Knöpfe bleiben ohne Modell inaktiv,
          die Information verschwindet aber nicht. */}
      {resumable && !running && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Icon name="history" className="!text-[16px] mt-0.5 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <p className="text-xs leading-relaxed text-amber-900">{resumeLabel(resumable)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-700/80">
                Fortsetzen behält Teilfragen, Quellen und die Rundenzählung und räumt zuerst die abgerufenen, aber noch
                undokumentierten Quellen auf. Neu starten beginnt eine zusätzliche Runde im selben Projekt — nichts geht verloren.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="primary" icon="resume" onClick={() => start(true)} disabled={!model}>
                  Fortsetzen
                </Button>
                <Button icon="restart_alt" onClick={() => start(false)} disabled={!model}>
                  Neu starten
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {noModels ? (
        <p className="text-sm text-slate-500">
          Kein Ollama-Modell verfügbar. Siehe <span className="font-medium">MCP &amp; Einstellungen</span> → Eingebaute Engine.
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Modell</span>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={running}
                className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-(--color-accent-600) focus:outline-none disabled:opacity-60"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.cloud ? '☁ ' : '💻 '}
                    {m.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Runden max.</span>
              <input
                type="number"
                min={1}
                max={8}
                value={maxRounds}
                onChange={(e) => setMaxRounds(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
                disabled={running}
                className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-(--color-accent-600) focus:outline-none disabled:opacity-60"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Token-Budget</span>
              <input
                type="number"
                min={0}
                step={10000}
                value={maxTotalTokens}
                onChange={(e) => setMaxTotalTokens(Math.max(0, Number(e.target.value) || 0))}
                disabled={running}
                title="Obergrenze für den gesamten Lauf, nicht je Aufruf. 0 = unbegrenzt. Ein Fünftel bleibt für die Synthese reserviert."
                className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-(--color-accent-600) focus:outline-none disabled:opacity-60"
              />
            </label>
            <div className="flex gap-2">
              {running ? (
                <Button variant="danger" icon="stop" onClick={stop}>
                  Abbrechen
                </Button>
              ) : (
                <Button variant="primary" icon="play_arrow" onClick={() => start(false)} disabled={!model}>
                  Research starten
                </Button>
              )}
            </div>
          </div>

          {err && <p className="mb-3 rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs text-red-800">{err}</p>}

          {lines.length > 0 && (
            <div ref={logRef} className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 p-2">
              {lines.map((l) => (
                <div key={l.id} className={`flex items-start gap-1.5 px-1 py-0.5 text-xs ${TONES[l.tone]}`}>
                  <Icon name={l.icon} className="!text-[14px] mt-0.5 shrink-0 opacity-60" />
                  <span className="min-w-0 break-words">{l.text}</span>
                </div>
              ))}
            </div>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Die Engine plant Teilfragen, recherchiert sie einzeln und entscheidet nach jeder Runde selbst über Fortsetzung — anhand der
            serverseitig berechneten Abdeckung, nicht anhand der Selbsteinschätzung des Modells. Alles Erfasste durchläuft dieselbe
            Provenienz-Prüfung wie bei einem angedockten Fremdclient. Der menschliche Sign-off bleibt in jedem Fall bei dir. Ein
            erschöpftes Kontingent beendet den Lauf sofort, statt ihn je Teilfrage erneut anzurennen; abgebrochene Läufe lassen sich
            fortsetzen.
          </p>
        </>
      )}
    </Card>
  )
}
