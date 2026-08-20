import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentChatEvent, AgentSettings } from '../../../shared/agent'
import { Badge, Button, Icon } from '../components/ui'
import { ModelPicker, useCursorAccount } from '../components/CursorSettings'

const STARTERS = [
  {
    id: 'start',
    label: 'Research starten',
    text: 'Arbeite den Research-Brief aus, bevor du suchst. Rufe get_research_brief auf. Fehlt ein adoptierter Plan: kläre Lieferform, Adressat, Ziel, Frames, Einschluss/Ausschluss, Teilfragen, Stopp-Regel und Tabus, dann draft_research_brief. Suche nicht, bis ich den Plan bestätigt habe.',
  },
  {
    id: 'summary',
    label: 'Zusammenfassen',
    text: 'Fasse den aktuellen Forschungsstand zusammen. Keine neuen Fakten. Nutze get_project_state und bei Bedarf start_discuss_research.',
  },
  {
    id: 'map',
    label: 'Karte aufbereiten',
    text: 'Bereite die Evidenzkarte auf. Rufe describe_evidence_map auf, speichere bei einer klaren Frage eine Version mit prepare_view, und verweise auf den Tab „Karte“. Keine Knoten erfinden.',
  },
] as const

type ChatItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; callId: string; name: string; status: 'running' | 'completed' | 'error' }
  | { kind: 'status'; text: string }
  | { kind: 'request'; text: string }
  | { kind: 'run_end'; status: 'finished' | 'error' | 'cancelled'; error?: string }

function reduceEvents(events: AgentChatEvent[]): ChatItem[] {
  const items: ChatItem[] = []
  const toolAt = new Map<string, number>()
  for (const e of events) {
    switch (e.type) {
      case 'user':
        items.push({ kind: 'user', text: e.text })
        break
      case 'assistant': {
        const last = items[items.length - 1]
        if (last?.kind === 'assistant') last.text += e.text
        else items.push({ kind: 'assistant', text: e.text })
        break
      }
      case 'thinking': {
        const last = items[items.length - 1]
        if (last?.kind === 'thinking') last.text += e.text
        else items.push({ kind: 'thinking', text: e.text })
        break
      }
      case 'tool': {
        const idx = toolAt.get(e.callId)
        const next: ChatItem = { kind: 'tool', callId: e.callId, name: e.name, status: e.status }
        if (idx != null && items[idx]?.kind === 'tool') items[idx] = next
        else {
          toolAt.set(e.callId, items.length)
          items.push(next)
        }
        break
      }
      case 'status':
        items.push({ kind: 'status', text: e.text })
        break
      case 'request':
        items.push({ kind: 'request', text: e.text })
        break
      case 'run_end':
        items.push({ kind: 'run_end', status: e.status, error: e.error })
        break
      default: {
        const _never: never = e
        void _never
      }
    }
  }
  return items
}

function toolTone(status: 'running' | 'completed' | 'error'): 'slate' | 'emerald' | 'red' | 'amber' {
  switch (status) {
    case 'running':
      return 'amber'
    case 'completed':
      return 'emerald'
    case 'error':
      return 'red'
    default: {
      const _never: never = status
      return _never
    }
  }
}

export default function AgentChat({
  projectId,
  onRunEnd,
}: {
  projectId: string
  onRunEnd: () => void
}) {
  const { auth, models, settings, saveSettings, loginBrowser } = useCursorAccount()
  const [events, setEvents] = useState<AgentChatEvent[]>([])
  const [draft, setDraft] = useState('')
  const [pendingFiles, setPendingFiles] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [history, state] = await Promise.all([window.api.agentHistory(projectId), window.api.agentRunState(projectId)])
      if (cancelled) return
      setEvents(history)
      setRunning(state.running)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const off = window.api.onAgentEvent((payload) => {
      if (payload.projectId !== projectId) return
      setEvents((cur) => [...cur, payload.event])
      if (payload.event.type === 'run_end') {
        setRunning(false)
        onRunEnd()
      }
    })
    return off
  }, [projectId, onRunEnd])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [events])

  const items = useMemo(() => reduceEvents(events), [events])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if ((!trimmed && pendingFiles.length === 0) || running) return
      if (!auth?.signedIn) {
        setSendError('Bitte zuerst unter Einstellungen einen Cursor-API-Key hinterlegen.')
        return
      }
      setSendError(null)
      setDraft('')
      const attached = pendingFiles
      setPendingFiles([])
      setRunning(true)
      const result = await window.api.agentSend(projectId, trimmed, attached)
      if (!result.ok && result.error) setSendError(result.error)
      if (!result.ok) setRunning(false)
    },
    [auth?.signedIn, pendingFiles, projectId, running]
  )

  const attach = async () => {
    const names = await window.api.agentAttach(projectId)
    if (names.length) setPendingFiles((cur) => [...cur, ...names])
  }

  const signedIn = !!auth?.signedIn

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <Icon name="smart_toy" className="text-(--color-accent-700)" />
        <span className="text-sm font-medium">Agent</span>
        {signedIn ? (
          <Badge tone="emerald">Cursor</Badge>
        ) : (
          <Badge tone="amber" icon="login">
            nicht angemeldet
          </Badge>
        )}
        {settings && signedIn && (
          <ModelPicker
            compact
            models={models}
            settings={settings}
            onChange={(next: AgentSettings) => void saveSettings(next)}
          />
        )}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {items.length === 0 && (
          <div className="px-2 py-8 text-sm text-slate-500">
            {signedIn ? (
              <>
                <p className="mb-3">
                  Chat mit dem Research-Agenten. Er schreibt nur über die Provenienz-Werkzeuge; Sign-off bleibt rechts bei dir.
                </p>
                <div className="flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <Button key={s.id} onClick={() => void send(s.text)}>
                      {s.label}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p>
                  Melde dich mit deinem Cursor-Konto an — der Browser öffnet cursor.com. Danach läuft die Research hier im Fenster,
                  ohne zweite IDE.
                </p>
                <Button variant="primary" icon="login" onClick={() => void loginBrowser()}>
                  Mit Cursor anmelden
                </Button>
              </div>
            )}
          </div>
        )}
        <div className="space-y-2">
          {items.map((item, i) => (
            <ChatBubble key={i} item={item} />
          ))}
        </div>
      </div>

      {sendError && <div className="px-3 text-xs text-red-700">{sendError}</div>}

      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-slate-100 px-3 py-2">
          {pendingFiles.map((f) => (
            <Badge key={f} tone="slate" icon="attach_file">
              {f}
            </Badge>
          ))}
        </div>
      )}

      <form
        className="flex items-end gap-2 border-t border-slate-200 p-3"
        onSubmit={(e) => {
          e.preventDefault()
          void send(draft)
        }}
      >
        <Button type="button" variant="ghost" icon="attach_file" title="PDF oder Text anhängen" onClick={() => void attach()} />
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(draft)
            }
          }}
          rows={3}
          placeholder={signedIn ? 'Nachricht an den Research-Agenten…' : 'Zuerst mit Cursor anmelden'}
          disabled={!signedIn || running}
          className="min-h-[4.5rem] flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed disabled:bg-slate-50"
        />
        {running ? (
          <Button type="button" variant="danger" icon="stop" onClick={() => void window.api.agentCancel(projectId)}>
            Stopp
          </Button>
        ) : (
          <Button type="submit" variant="primary" icon="send" disabled={!signedIn || (!draft.trim() && pendingFiles.length === 0)}>
            Senden
          </Button>
        )}
      </form>
    </div>
  )
}

function ChatBubble({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-8 rounded-xl bg-slate-100 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">{item.text}</div>
      )
    case 'assistant':
      return (
        <div className="mr-6 rounded-xl bg-(--color-accent-50) px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">{item.text}</div>
      )
    case 'thinking':
      return (
        <details className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          <summary className="cursor-pointer select-none">Denken</summary>
          <p className="mt-1 whitespace-pre-wrap">{item.text}</p>
        </details>
      )
    case 'tool':
      return (
        <div className="flex items-center gap-2 text-xs">
          <Icon name={item.status === 'running' ? 'progress_activity' : 'build'} className={item.status === 'running' ? 'animate-spin' : ''} />
          <Badge tone={toolTone(item.status)}>{item.name}</Badge>
          <span className="text-slate-400">
            {item.status === 'running' ? 'läuft' : item.status === 'error' ? 'Fehler' : 'fertig'}
          </span>
        </div>
      )
    case 'status':
      return <p className="text-xs text-slate-400">{item.text}</p>
    case 'request':
      return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{item.text}</p>
    case 'run_end':
      if (item.status === 'finished') return null
      return (
        <p className={`text-xs ${item.status === 'cancelled' ? 'text-slate-500' : 'text-red-700'}`}>
          {item.status === 'cancelled' ? 'Lauf abgebrochen.' : item.error ?? 'Lauf fehlgeschlagen.'}
        </p>
      )
    default: {
      const _never: never = item
      return _never
    }
  }
}
