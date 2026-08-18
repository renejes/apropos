import { useCallback, useEffect, useState } from 'react'
import type { ProjectSummary } from '../../shared/types'
import { Icon, Button, Badge } from './components/ui'
import ProjectView from './views/ProjectView'
import SettingsView from './views/SettingsView'
import NewProjectDialog from './views/NewProjectDialog'

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'project' | 'settings'>('project')
  const [showNew, setShowNew] = useState(false)

  const refresh = useCallback(async () => {
    const list = await window.api.listProjects()
    setProjects(list)
    setSelectedId((cur) => cur ?? list[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void refresh()
    // Review-Finding: auch ohne gemountete ProjectView pollen, damit per MCP
    // angelegte Projekte in der Sidebar erscheinen.
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [refresh])

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-(--color-accent-600) text-white">
            <Icon name="travel_explore" />
          </span>
          <div>
            <div className="text-sm font-semibold leading-tight">Research Overview</div>
            <div className="text-[11px] text-slate-400">Transparente KI-Research</div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Projekte</span>
          <Button variant="ghost" icon="add" onClick={() => setShowNew(true)} title="Neues Projekt" />
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-2">
          {projects.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-400">
              Noch keine Projekte.
              <br />
              Lege eines an — oder lass deine KI per MCP eines anlegen.
            </div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setSelectedId(p.id)
                setView('project')
              }}
              className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                selectedId === p.id && view === 'project' ? 'bg-(--color-accent-50) ring-1 ring-(--color-accent-100)' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{p.title}</span>
                {p.pending_count > 0 && <Badge tone="amber">{p.pending_count}</Badge>}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-0.5">
                  <Icon name="link" className="!text-[13px]" /> {p.source_count}
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <Icon name="verified" className="!text-[13px]" /> {p.signed_count}
                </span>
                <span>{p.mode === 'academic' ? 'akademisch' : 'business'}</span>
              </div>
            </button>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-2">
          <button
            onClick={() => setView('settings')}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              view === 'settings' ? 'bg-(--color-accent-50) font-medium' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Icon name="settings" className="icon-sm" />
            MCP & Einstellungen
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        {view === 'settings' ? (
          <SettingsView onSeeded={refresh} />
        ) : selectedId ? (
          <ProjectView key={selectedId} projectId={selectedId} onChanged={refresh} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
            <Icon name="science" className="icon-lg" />
            <p className="max-w-md text-center text-sm">
              Wähle links ein Projekt oder verbinde deine KI mit dem MCP-Server (siehe Einstellungen), damit sie eine Research anlegt.
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
