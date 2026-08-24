import { useCallback, useEffect, useState } from 'react'
import type { ProjectSummary } from '../../shared/types'
import { Button } from './components/ui'
import ProjectView from './views/ProjectView'
import SettingsView from './views/SettingsView'
import NewProjectDialog from './views/NewProjectDialog'

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'project' | 'settings'>('project')
  const [showNew, setShowNew] = useState(false)
  const [mcpRunning, setMcpRunning] = useState<boolean | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.api.listProjects()
    setProjects(list)
    setSelectedId((cur) => cur ?? list[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    const load = () => window.api.serverInfo().then((i) => setMcpRunning(i.running))
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex h-full bg-bg text-fg">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line">
        <div className="border-b border-hairline px-4 py-3">
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Research Overview</div>
          <div className="text-sm">Transparente KI-Research</div>
        </div>

        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Projekte</span>
          <Button variant="ghost" onClick={() => setShowNew(true)} title="Neues Projekt">
            +
          </Button>
        </div>

        <nav className="flex-1 space-y-px overflow-y-auto px-2 pb-2">
          {projects.length === 0 && (
            <div className="px-2 py-6 text-xs text-muted">
              Noch keine Projekte.
              <br />
              Lege eines an — oder lass deine KI per MCP eines anlegen.
            </div>
          )}
          {projects.map((p) => {
            const active = selectedId === p.id && view === 'project'
            return (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedId(p.id)
                  setView('project')
                }}
                className={`w-full px-3 py-2 text-left ${active ? 'bg-fg text-bg' : 'hover:bg-fg hover:text-bg'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{p.title}</span>
                  {p.pending_count > 0 && (
                    <span className={`font-mono text-xs ${active ? 'text-bg' : 'text-warn'}`}>{p.pending_count}</span>
                  )}
                </div>
                <div className={`mt-0.5 font-mono text-[11px] ${active ? 'text-bg/70' : 'text-muted'}`}>
                  {p.source_count} Quellen · {p.signed_count} frei · {p.mode === 'academic' ? 'akademisch' : 'business'}
                </div>
              </button>
            )
          })}
        </nav>

        <div className="border-t border-hairline p-2">
          <button
            onClick={() => setView('settings')}
            className={`flex w-full items-center gap-2 px-3 py-2 text-sm ${
              view === 'settings' ? 'bg-fg text-bg' : 'text-muted hover:bg-fg hover:text-bg'
            }`}
          >
            Einstellungen
            {mcpRunning != null && (
              <span
                className={`ml-auto h-2 w-2 ${mcpRunning ? 'bg-ok' : 'bg-bad'}`}
                title={mcpRunning ? 'MCP läuft' : 'MCP gestoppt — App muss gestartet sein; Agent-Modus, nicht Chat'}
              />
            )}
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        {view === 'settings' ? (
          <SettingsView onSeeded={refresh} />
        ) : selectedId ? (
          <ProjectView key={selectedId} projectId={selectedId} onChanged={refresh} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <p className="max-w-md text-center text-sm">
              Wähle links ein Projekt. Die Research führst du im Agent-Chat — ohne zweite IDE.
            </p>
          </div>
        )}
      </main>

      {showNew && (
        <NewProjectDialog
          onClose={() => setShowNew(false)}
          onCreated={async (id) => {
            setShowNew(false)
            await refresh()
            setSelectedId(id)
            setView('project')
          }}
        />
      )}
    </div>
  )
}
