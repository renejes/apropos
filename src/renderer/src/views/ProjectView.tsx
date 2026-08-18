import { useCallback, useEffect, useState } from 'react'
import type { ProjectState } from '../../../shared/types'
import { Badge, Button, Icon } from '../components/ui'
import OverviewTab from './tabs/OverviewTab'
import SourcesTab from './tabs/SourcesTab'
import ClaimsTab from './tabs/ClaimsTab'
import ReportsTab from './tabs/ReportsTab'
import ChatTab from './tabs/ChatTab'
import AuditTab from './tabs/AuditTab'

const TABS = [
  { id: 'overview', label: 'Übersicht', icon: 'dashboard' },
  { id: 'sources', label: 'Quellen', icon: 'link' },
  { id: 'claims', label: 'Aussagen', icon: 'fact_check' },
  { id: 'reports', label: 'Berichte', icon: 'description' },
  { id: 'chat', label: 'Protokoll', icon: 'forum' },
  { id: 'audit', label: 'Audit', icon: 'history' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function ProjectView({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [state, setState] = useState<ProjectState | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  // Zähler statt Objekt: die Abdeckung wird im Main-Prozess berechnet und muss
  // nach jedem Reload neu geholt werden (Sign-off ändert sie z. B. sofort).
  const [coverageKey, setCoverageKey] = useState(0)
  // Sprung "Aussage → Quelle": Belegkante klicken öffnet die Quelle im Quellen-Tab
  const [focusSourceId, setFocusSourceId] = useState<string | null>(null)
  const openSource = (sourceId: string) => {
    setFocusSourceId(sourceId)
    setTab('sources')
  }

  const reload = useCallback(async () => {
    setState(await window.api.getProjectState(projectId))
    setCoverageKey((k) => k + 1)
    onChanged()
  }, [projectId, onChanged])

  useEffect(() => {
    void reload()
    // Periodisch aktualisieren, damit MCP-Schreibzugriffe anderer Clients sichtbar werden
    const t = setInterval(() => void reload(), 5000)
    return () => clearInterval(t)
  }, [reload])

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Icon name="progress_activity" className="animate-spin" />
      </div>
    )
  }

  const pendingCount = state.sources.filter((s) => s.review_status === 'pending').length

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white px-6 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{state.project.title}</h1>
              <Badge tone={state.project.mode === 'academic' ? 'violet' : 'sky'}>
                {state.project.mode === 'academic' ? 'akademisch' : 'business'}
              </Badge>
              {state.project.policy_preset && <Badge tone="slate">{state.project.policy_preset}</Badge>}
            </div>
            {state.project.research_question && <p className="mt-1 truncate text-sm text-slate-500">{state.project.research_question}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              icon="content_copy"
              onClick={async () => {
                await window.api.copyMarkdown(projectId, null)
                setExportMsg('Export in Zwischenablage kopiert')
                setTimeout(() => setExportMsg(null), 2500)
              }}
              title="Provenienz-Export in die Zwischenablage"
            >
              Kopieren
            </Button>
            <Button
              variant="primary"
              icon="download"
              onClick={async () => {
                const res = await window.api.exportMarkdown(projectId, null)
                if (res.saved) {
                  setExportMsg(`Gespeichert: ${res.filePath}`)
                  setTimeout(() => setExportMsg(null), 4000)
                }
              }}
            >
              Export
            </Button>
          </div>
        </div>
        {exportMsg && <div className="mt-2 text-xs text-emerald-700">{exportMsg}</div>}

        {/* Tabs */}
        <nav className="mt-4 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'border-(--color-accent-600) text-(--color-accent-700)'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon name={t.icon} className="icon-sm" />
              {t.label}
              {t.id === 'sources' && pendingCount > 0 && <Badge tone="amber">{pendingCount}</Badge>}
            </button>
          ))}
        </nav>
      </header>

      {/* Inhalt */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'overview' && <OverviewTab state={state} onReload={reload} coverageKey={coverageKey} onOpenSource={openSource} />}
        {tab === 'sources' && (
          <SourcesTab state={state} onReload={reload} focusSourceId={focusSourceId} onFocusConsumed={() => setFocusSourceId(null)} />
        )}
        {tab === 'claims' && <ClaimsTab state={state} onOpenSource={openSource} />}
        {tab === 'reports' && <ReportsTab state={state} onReload={reload} />}
        {tab === 'chat' && <ChatTab state={state} />}
        {tab === 'audit' && <AuditTab projectId={projectId} />}
      </div>
    </div>
  )
}
