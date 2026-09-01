import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type {
  AgentChatEvent,
  AgentMention,
  AgentMentionable,
  AgentMode,
  AgentSessionMeta,
  AgentSessionResult,
  AgentSessionsSnapshot,
  AgentSettings,
} from '../../../shared/agent'
import { formatUsageLine, mergeStreamText, shortToolName } from '../../../shared/agentStream'
import { Badge, Button, Icon } from '../components/ui'
import { ModelPicker, useCursorAccount } from '../components/CursorSettings'

const NOTEBOOK_STARTERS = [
  {
    id: 'ask',
    label: 'Quellen zusammenfassen',
    text: 'Lies den Korpus mit list_corpus und search_documents. Fasse zusammen, was in den Quellen steht. Keine Fakten aus dem Gedächtnis.',
  },
  {
    id: 'slides',
    label: 'Als HTML aufbereiten',
    text: 'Erstelle aus den Quellen eine kurze HTML-Präsentation unter artifacts/slides.html. Eigenständig, kein CDN. Zitate nur aus read_document.',
  },
] as const

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

const MAX_ATTACH = 8
const STALL_AFTER_SEC = 45

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
        if (last?.kind === 'assistant') last.text = mergeStreamText(last.text, e.text)
        else items.push({ kind: 'assistant', text: e.text })
        break
      }
      case 'thinking': {
        const last = items[items.length - 1]
        if (last?.kind === 'thinking') last.text = mergeStreamText(last.text, e.text)
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
      case 'usage':
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

function sessionTitle(title: string): string {
  const t = title.trim()
  return t || 'Neuer Chat'
}

function mentionQueryOf(draft: string): string | null {
  const m = draft.match(/@([^\s]*)$/)
  return m ? (m[1] ?? '') : null
}

function renderInline(line: string): ReactNode[] {
  const parts: React.ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push(line.slice(last, m.index))
    const token = m[0]
    if (token.startsWith('**')) {
      parts.push(
        <strong key={i} className="font-semibold">
          {token.slice(2, -2)}
        </strong>
      )
    } else {
      parts.push(
        <code key={i} className="border border-hairline px-1 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>
      )
    }
    i += 1
    last = m.index + token.length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts
}

function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, li) => (
        <span key={li}>
          {li > 0 && <br />}
          {renderInline(line)}
        </span>
      ))}
    </>
  )
}

const EMPTY_SESSIONS: AgentSessionsSnapshot = { activeId: null, open: [], all: [] }

export default function AgentChat({
  projectId,
  onRunEnd,
  onCorpusChange,
  variant = 'research',
  onSaveNote,
}: {
  projectId: string
  onRunEnd: () => void
  onCorpusChange?: () => void
  variant?: 'research' | 'notebook'
  onSaveNote?: (text: string) => void
}) {
  const { auth, models, settings, saveSettings, loginBrowser } = useCursorAccount()
  const [events, setEvents] = useState<AgentChatEvent[]>([])
  const [draft, setDraft] = useState('')
  const [pendingFiles, setPendingFiles] = useState<string[]>([])
  const [pendingMentions, setPendingMentions] = useState<AgentMention[]>([])
  const [running, setRunning] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [mode, setMode] = useState<AgentMode>('agent')
  const [sessions, setSessions] = useState<AgentSessionsSnapshot>(EMPTY_SESSIONS)
  const [usageLine, setUsageLine] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mentionables, setMentionables] = useState<AgentMentionable[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [quietSec, setQuietSec] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const menuRoot = useRef<HTMLDivElement>(null)
  const historyRoot = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)
  const lastActivityAt = useRef(Date.now())

  const bumpActivity = () => {
    lastActivityAt.current = Date.now()
    setQuietSec(0)
  }

  const applySession = (res: AgentSessionResult) => {
    setSessions(res.sessions)
    setEvents(res.history)
    activeIdRef.current = res.sessions.activeId
    if (!res.ok && res.error) setSendError(res.error)
    else setSendError(null)
  }

  useEffect(() => {
    activeIdRef.current = sessions.activeId
  }, [sessions.activeId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [history, state, sessionRes] = await Promise.all([
        window.api.agentHistory(projectId),
        window.api.agentRunState(projectId),
        window.api.agentSessions(projectId),
      ])
      if (cancelled) return
      setEvents(history)
      setRunning(state.running)
      setSessions(sessionRes.sessions)
      activeIdRef.current = sessionRes.sessions.activeId
      setDraft('')
      setPendingFiles([])
      setPendingMentions([])
      setUsageLine('')
      setSendError(null)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    const off = window.api.onAgentEvent((payload) => {
      if (payload.projectId !== projectId) return
      if (payload.sessionId && activeIdRef.current && payload.sessionId !== activeIdRef.current) return
      bumpActivity()
      if (payload.event.type === 'usage') {
        setUsageLine(formatUsageLine(payload.event))
        return
      }
      setEvents((cur) => [...cur, payload.event])
      if (payload.event.type === 'run_end') {
        setRunning(false)
        onRunEnd()
        void window.api.agentSessions(projectId).then((res) => setSessions(res.sessions))
      }
    })
    return off
  }, [projectId, onRunEnd])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [events, running, elapsedSec])

  useEffect(() => {
    if (!running) {
      setElapsedSec(0)
      setQuietSec(0)
      return
    }
    bumpActivity()
    const started = Date.now()
    const t = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - started) / 1000))
      setQuietSec(Math.floor((Date.now() - lastActivityAt.current) / 1000))
    }, 500)
    return () => window.clearInterval(t)
  }, [running])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRoot.current && !menuRoot.current.contains(t)) setMenuOpen(false)
      if (historyRoot.current && !historyRoot.current.contains(t)) setHistoryOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const mentionQuery = mentionQueryOf(draft)
  const mentionHits = useMemo(() => {
    if (mentionQuery === null) return []
    const q = mentionQuery.toLowerCase()
    return mentionables
      .filter((m) => m.label.toLowerCase().includes(q) || (m.hint ?? '').toLowerCase().includes(q))
      .slice(0, 12)
  }, [mentionQuery, mentionables])

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery])

  useEffect(() => {
    if (mentionQuery === null) return
    let cancelled = false
    void window.api.agentMentionables(projectId).then((list) => {
      if (!cancelled) setMentionables(list)
    })
    return () => {
      cancelled = true
    }
  }, [mentionQuery, projectId])

  const items = useMemo(() => reduceEvents(events), [events])
  const lastAssistantIdx = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it?.kind === 'assistant' && it.text) return i
    }
    return -1
  }, [items])
  const runningTool = [...items].reverse().find((i) => i.kind === 'tool' && i.status === 'running')
  const hasAssistantText = items.some((i) => i.kind === 'assistant' && i.text)
  const stalling = running && quietSec >= STALL_AFTER_SEC
  const signedIn = !!auth?.signedIn
  const expired = !!auth?.expired
  const canSend = signedIn && !expired && !running && (!!draft.trim() || pendingFiles.length > 0 || pendingMentions.length > 0)

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if ((!trimmed && pendingFiles.length === 0 && pendingMentions.length === 0) || running) return
      if (!auth?.signedIn || auth.expired) {
        setSendError(auth?.expired ? 'Cursor-Anmeldung abgelaufen. Bitte neu anmelden.' : 'Bitte zuerst unter Einstellungen bei Cursor anmelden.')
        return
      }
      setSendError(null)
      setDraft('')
      const attached = pendingFiles
      const mentions = pendingMentions
      setPendingFiles([])
      setPendingMentions([])
      setRunning(true)
      bumpActivity()
      const result = await window.api.agentSend(projectId, {
        text: trimmed,
        attached,
        mentions,
        mode,
        yolo: settings?.yolo,
      })
      if (!result.ok && result.error) setSendError(result.error)
      if (!result.ok) setRunning(false)
      const snap = await window.api.agentSessions(projectId)
      setSessions(snap.sessions)
    },
    [auth?.expired, auth?.signedIn, mode, pendingFiles, pendingMentions, projectId, running, settings?.yolo]
  )

  const attach = async () => {
    const names = await window.api.agentAttach(projectId)
    if (!names.length) return
    setPendingFiles((cur) => [...new Set([...cur, ...names])].slice(0, MAX_ATTACH))
    onCorpusChange?.()
  }

  const pickMention = (hit: AgentMentionable) => {
    setDraft((d) => d.replace(/@[^\s]*$/, ''))
    setPendingMentions((cur) => (cur.some((m) => m.kind === hit.kind && m.id === hit.id) ? cur : [...cur, { kind: hit.kind, id: hit.id, label: hit.label }]))
  }

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionHits.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionHits.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionHits.length) % mentionHits.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const hit = mentionHits[mentionIndex] ?? mentionHits[0]
        if (hit) pickMention(hit)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDraft((d) => d.replace(/@[^\s]*$/, ''))
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(draft)
    }
  }

  const yoloOn = settings?.yolo === true
  const modeLabel = mode === 'plan' ? 'Plan' : yoloOn ? 'YOLO' : 'Agent'
  const starters = variant === 'notebook' ? NOTEBOOK_STARTERS : STARTERS

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em]">Agent</span>
        {signedIn && !expired ? (
          <Badge tone="emerald">Cursor</Badge>
        ) : (
          <Badge tone="amber">{expired ? 'abgelaufen' : 'nicht angemeldet'}</Badge>
        )}
        {yoloOn && <Badge tone="amber">YOLO</Badge>}
        <span className="ml-auto" />
        {signedIn && !expired && (
          <>
            <div className="relative" ref={historyRoot}>
              <Button
                type="button"
                variant="ghost"
                icon="history"
                title="Chat-Verlauf"
                disabled={running}
                onClick={() => {
                  setHistoryOpen((v) => !v)
                  setMenuOpen(false)
                }}
              />
              {historyOpen && (
                <div className="absolute top-full right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto border border-line bg-bg py-1">
                  {sessions.all.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted">Noch keine Chats.</p>
                  ) : (
                    sessions.all.map((s) => (
                      <HistoryRow
                        key={s.id}
                        session={s}
                        active={s.id === sessions.activeId}
                        disabled={running}
                        onPick={() => {
                          setHistoryOpen(false)
                          void window.api.agentSwitchSession(projectId, s.id).then(applySession)
                        }}
                        onDelete={() => {
                          void window.api.agentDeleteSession(projectId, s.id).then(applySession)
                        }}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              icon="add"
              title="Neuer Chat"
              disabled={running}
              onClick={() => void window.api.agentNewSession(projectId).then(applySession)}
            />
          </>
        )}
      </div>

      {!signedIn || expired ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 text-sm text-muted">
          <p className="mb-3">
            {expired
              ? 'Die Cursor-Anmeldung ist abgelaufen. Bitte erneut anmelden, damit der Agent weiterlaufen kann.'
              : 'Melde dich mit deinem Cursor-Konto an — der Browser öffnet cursor.com. Danach läuft der Agent hier im Fenster, ohne zweite IDE.'}
          </p>
          <Button variant="primary" icon="login" onClick={() => void loginBrowser()}>
            Mit Cursor anmelden
          </Button>
          {sendError && <p className="mt-3 text-xs text-bad">{sendError}</p>}
        </div>
      ) : (
        <>
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {items.length === 0 && (
              <div className="px-2 py-8 text-sm text-muted">
                <p className="mb-3">
                  {variant === 'notebook'
                    ? 'Frag den Agenten zu den Quellen links. Unter jeder Antwort: „Als Notiz speichern“ — dann kannst du sie in der Mitte bearbeiten. Mit @ hängst du Dateien an.'
                    : 'Chat mit dem Research-Agenten. Er schreibt nur über die Provenienz-Werkzeuge; Sign-off bleibt rechts bei dir. Mit @ hängst du Quellen, Inbox-Dateien oder Teilfragen an.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {starters.map((s) => (
                    <Button key={s.id} onClick={() => void send(s.text)}>
                      {s.label}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {items.map((item, i) => (
                <ChatBubble
                  key={`${sessions.activeId ?? 'chat'}:${i}`}
                  item={item}
                  busy={running && i === items.length - 1}
                  elapsedSec={elapsedSec}
                  onSaveNote={
                    variant === 'notebook' &&
                    item.kind === 'assistant' &&
                    item.text &&
                    onSaveNote &&
                    !(running && i === lastAssistantIdx)
                      ? () => onSaveNote(item.text)
                      : undefined
                  }
                />
              ))}
              {running && !hasAssistantText && (
                <p className="text-xs text-muted">
                  {runningTool && runningTool.kind === 'tool'
                    ? `Nutzt ${shortToolName(runningTool.name)}…`
                    : `Arbeitet${elapsedSec > 0 ? ` · ${elapsedSec}s` : '…'}`}
                </p>
              )}
              {stalling && <p className="text-xs text-warn">Keine neue Ausgabe seit {quietSec}s — der Lauf läuft noch.</p>}
            </div>
          </div>

          {sendError && <div className="px-3 pb-1 text-xs text-bad">{sendError}</div>}

          <div className="border-t border-hairline p-3">
            {(pendingFiles.length > 0 || pendingMentions.length > 0) && (
              <ul className="mb-2 flex flex-wrap gap-1">
                {pendingFiles.map((f) => (
                  <li key={`file:${f}`}>
                    <Chip label={f} icon="attach_file" onRemove={() => setPendingFiles((cur) => cur.filter((x) => x !== f))} />
                  </li>
                ))}
                {pendingMentions.map((m) => (
                  <li key={`${m.kind}:${m.id}`}>
                    <Chip
                      label={`@${m.label}`}
                      icon={m.kind === 'inbox' ? 'folder' : m.kind === 'question' ? 'help' : 'link'}
                      onRemove={() => setPendingMentions((cur) => cur.filter((x) => !(x.kind === m.kind && x.id === m.id)))}
                    />
                  </li>
                ))}
              </ul>
            )}
            {mentionQuery !== null && (
              <ul className="mb-2 max-h-40 overflow-y-auto border border-line bg-bg py-1" role="listbox">
                {mentionHits.length === 0 ? (
                  <li className="px-3 py-1.5 text-xs text-muted">Keine Treffer.</li>
                ) : (
                  mentionHits.map((hit, i) => (
                    <li key={`${hit.kind}:${hit.id}`}>
                      <button
                        type="button"
                        className={`flex w-full flex-col px-3 py-1.5 text-left text-xs ${i === mentionIndex ? 'bg-fg text-bg' : 'hover:bg-fg hover:text-bg'}`}
                        onClick={() => pickMention(hit)}
                      >
                        <span>@{hit.label}</span>
                        {hit.hint && <span className="truncate opacity-70">{hit.hint}</span>}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onComposerKey}
              rows={3}
              placeholder={
                signedIn
                  ? variant === 'notebook'
                    ? 'Frage zu den Quellen…  @ für Dateien'
                    : 'Nachricht an den Research-Agenten…  @ für Quellen'
                  : 'Zuerst mit Cursor anmelden'
              }
              disabled={!signedIn || running}
              className="field min-h-[4.5rem] w-full resize-none text-sm leading-relaxed"
            />
            <div className="mt-2 flex items-end gap-2">
              <div className="relative" ref={menuRoot}>
                <Button
                  type="button"
                  variant="ghost"
                  title="Modus und Modell"
                  onClick={() => {
                    setMenuOpen((v) => !v)
                    setHistoryOpen(false)
                  }}
                >
                  {modeLabel} ▾
                </Button>
                {menuOpen && settings && (
                  <div className="absolute bottom-full left-0 z-20 mb-1 w-72 border border-line bg-bg p-3">
                    <label className="mb-3 block text-xs text-muted">
                      Modus
                      <select
                        value={mode}
                        onChange={(e) => setMode(e.target.value === 'plan' ? 'plan' : 'agent')}
                        className="field mt-1 w-full text-sm"
                      >
                        <option value="agent">Agent — Tools ausführen</option>
                        <option value="plan">Plan — erst nachdenken</option>
                      </select>
                    </label>
                    <label className="mb-3 flex items-start gap-2 text-xs">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={yoloOn}
                        onChange={(e) => {
                          if (!settings) return
                          void saveSettings({ ...settings, yolo: e.target.checked })
                        }}
                      />
                      <span>
                        <span className="text-fg">YOLO — nach dem Briefing ohne Nachfragen</span>
                        <span className="mt-0.5 block text-muted">
                          Research: Intake bleibt, danach Suche aus dem Brief. Notebook: antworten, Speichern nur per Button.
                        </span>
                      </span>
                    </label>
                    <ModelPicker models={models} settings={settings} onChange={(next: AgentSettings) => void saveSettings(next)} />
                    {usageLine && <p className="mt-2 font-mono text-xs text-muted">{usageLine}</p>}
                  </div>
                )}
              </div>
              <Button type="button" variant="ghost" icon="attach_file" title="PDF oder Text in den Korpus" onClick={() => void attach()} />
              <span className="flex-1" />
              {running ? (
                <Button type="button" variant="danger" icon="stop" onClick={() => void window.api.agentCancel(projectId)}>
                  Stopp
                </Button>
              ) : (
                <Button type="button" variant="primary" icon="send" disabled={!canSend} onClick={() => void send(draft)}>
                  Senden
                </Button>
              )}
            </div>
          </div>

          {sessions.open.length > 0 && (
            <nav className="flex shrink-0 gap-px overflow-x-auto border-t border-hairline px-2 py-1" aria-label="Offene Chats">
              {sessions.open.map((s) => (
                <div
                  key={s.id}
                  className={`flex max-w-[10rem] items-center ${s.id === sessions.activeId ? 'bg-fg text-bg' : 'hover:bg-fg hover:text-bg'}`}
                >
                  <button
                    type="button"
                    className="truncate px-2 py-1 text-xs"
                    title={sessionTitle(s.title)}
                    disabled={running}
                    onClick={() => void window.api.agentSwitchSession(projectId, s.id).then(applySession)}
                  >
                    {sessionTitle(s.title)}
                  </button>
                  {sessions.open.length > 1 && (
                    <button
                      type="button"
                      className="px-1 opacity-60 hover:opacity-100"
                      title="Tab schließen"
                      disabled={running && s.id === sessions.activeId}
                      onClick={() => void window.api.agentCloseTab(projectId, s.id).then(applySession)}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </nav>
          )}
        </>
      )}
    </div>
  )
}

function Chip({ label, icon, onRemove }: { label: string; icon: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 border border-hairline py-0.5 pr-1 pl-2 text-xs">
      <Icon name={icon} className="!text-[14px]" />
      <span className="truncate">{label}</span>
      <button type="button" className="px-1 text-muted hover:text-fg" aria-label="Entfernen" onClick={onRemove}>
        ×
      </button>
    </span>
  )
}

function HistoryRow({
  session,
  active,
  disabled,
  onPick,
  onDelete,
}: {
  session: AgentSessionMeta
  active: boolean
  disabled: boolean
  onPick: () => void
  onDelete: () => void
}) {
  return (
    <div className={`flex items-center gap-1 px-1 ${active ? 'bg-fg text-bg' : ''}`}>
      <button type="button" className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs" disabled={disabled} onClick={onPick}>
        {sessionTitle(session.title)}
      </button>
      <button type="button" className="px-2 text-muted hover:text-bad" title="Chat löschen" disabled={disabled} onClick={onDelete}>
        ×
      </button>
    </div>
  )
}

function ChatBubble({
  item,
  busy,
  elapsedSec,
  onSaveNote,
}: {
  item: ChatItem
  busy: boolean
  elapsedSec: number
  onSaveNote?: () => void
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ml-8 border border-hairline bg-wash px-3 py-2 text-sm">
          <ChatMarkdown text={item.text} />
        </div>
      )
    case 'assistant':
      return item.text ? (
        <div className="mr-6 border border-line px-3 py-2 text-sm">
          <ChatMarkdown text={item.text} />
          {onSaveNote && (
            <div className="mt-2">
              <Button variant="default" icon="edit_note" onClick={onSaveNote}>
                Als Notiz speichern
              </Button>
            </div>
          )}
        </div>
      ) : null
    case 'thinking':
      return (
        <details className="border border-hairline px-3 py-1.5 text-xs text-muted">
          <summary className="cursor-pointer select-none font-mono">
            Denken{busy && elapsedSec > 0 ? ` · ${elapsedSec}s` : ''}
          </summary>
          {item.text && (
            <p className="mt-1">
              <ChatMarkdown text={item.text} />
            </p>
          )}
        </details>
      )
    case 'tool':
      return (
        <div className="flex items-center gap-2 font-mono text-xs">
          {item.status === 'running' && <span className="text-warn">·</span>}
          <Badge tone={toolTone(item.status)}>{shortToolName(item.name)}</Badge>
          <span className="text-muted">
            {item.status === 'running' ? 'läuft' : item.status === 'error' ? 'Fehler' : 'fertig'}
          </span>
        </div>
      )
    case 'status':
      return <p className="text-xs text-muted">{item.text}</p>
    case 'request':
      return <p className="border border-warn bg-warn-bg px-3 py-2 text-xs text-warn">{item.text}</p>
    case 'run_end':
      if (item.status === 'finished') return null
      return (
        <p className={`text-xs ${item.status === 'cancelled' ? 'text-muted' : 'text-bad'}`}>
          {item.status === 'cancelled' ? 'Lauf abgebrochen.' : item.error ?? 'Lauf fehlgeschlagen.'}
        </p>
      )
    default: {
      const _never: never = item
      return _never
    }
  }
}
