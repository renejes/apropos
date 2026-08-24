import { useCallback, useEffect, useState } from 'react'
import type { ProjectSummary } from '../../shared/types'
import { Button, Icon } from './components/ui'
import ProjectView from './views/ProjectView'
import SettingsView from './views/SettingsView'
import NewProjectDialog from './views/NewProjectDialog'
import ManualDialog from './views/ManualDialog'

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'project' | 'settings'>('project')
  const [showNew, setShowNew] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [mcpRunning, setMcpRunning] = useState<boolean | null>(null)
  const [showManual, setShowManual] = useState(false)

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

  useEffect(() => window.api.onOpenManual(() => setShowManual(true)), [])

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    const id = deleteTarget.id
    const fallbackId = projects.find((p) => p.id !== id)?.id ?? null
    setSelectedId((cur) => (cur === id ? fallbackId : cur))
    try {
      const { deleted } = await window.api.deleteProject(id)
      setDeleteTarget(null)
      const list = await window.api.listProjects()
      setProjects(list)
      setSelectedId((cur) => {
        if (cur && list.some((p) => p.id === cur)) return cur
        return list[0]?.id ?? null
      })
      if (!deleted) setSelectedId(id)
    } catch {
      await refresh()
      setSelectedId(id)
    } finally {
      setDeleteBusy(false)
    }
  }

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
              <div key={p.id} className={`group flex items-stretch ${active ? 'bg-fg text-bg' : 'hover:bg-fg hover:text-bg'}`}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(p.id)
                    setView('project')
                  }}
                  className="min-w-0 flex-1 px-3 py-2 text-left"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{p.title}</span>
                    {p.pending_count > 0 && (
                      <span className={`font-mono text-xs ${active ? 'text-bg' : 'text-warn'}`}>{p.pending_count}</span>
                    )}
                  </div>
                  <div className={`mt-0.5 font-mono text-[11px] ${active ? 'text-bg/70' : 'group-hover:text-bg/70 text-muted'}`}>
                    {p.source_count} Quellen · {p.signed_count} frei · {p.mode === 'academic' ? 'akademisch' : 'business'}
                  </div>
                </button>
                <button
                  type="button"
                  title="Projekt löschen"
                  onClick={() => setDeleteTarget(p)}
                  className={`shrink-0 px-2 ${active ? 'text-bg/70 hover:text-bg' : 'text-muted opacity-0 group-hover:opacity-100 group-hover:text-bg'}`}
                >
                  <Icon name="delete" className="icon-sm" />
                </button>
              </div>
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

      {showManual && <ManualDialog onClose={() => setShowManual(false)} />}

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

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 p-4"
          onClick={() => {
            if (!deleteBusy) setDeleteTarget(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            className="w-full max-w-md border border-line bg-bg p-6"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !deleteBusy) setDeleteTarget(null)
            }}
          >
            <h2 id="delete-project-title" className="text-base">
              Projekt löschen
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              „{deleteTarget.title}“ wird unwiderruflich entfernt — Quellen, Korpus, Chats und der Agent-Workspace. Ein
              Easy-Writing-Ordner auf der Platte bleibt.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>
                Abbrechen
              </Button>
              <Button variant="danger" disabled={deleteBusy} onClick={() => void confirmDelete()}>
                Löschen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
