import { useCallback, useEffect, useState } from 'react'
import type { ProjectState } from '../../../shared/types'
import { Badge, Button, Icon } from '../components/ui'
import AgentChat from './AgentChat'
import OverviewTab from './tabs/OverviewTab'
import CorpusTab from './tabs/CorpusTab'
import SourcesTab from './tabs/SourcesTab'
import ClaimsTab from './tabs/ClaimsTab'
import MapTab from './tabs/MapTab'
import ReportsTab from './tabs/ReportsTab'
import ChatTab from './tabs/ChatTab'
import AuditTab from './tabs/AuditTab'

const TABS = [
  { id: 'overview', label: 'Übersicht', icon: 'dashboard' },
  { id: 'corpus', label: 'Korpus', icon: 'menu_book' },
  { id: 'sources', label: 'Quellen', icon: 'link' },
  { id: 'claims', label: 'Aussagen', icon: 'fact_check' },
  { id: 'map', label: 'Karte', icon: 'account_tree' },
  { id: 'reports', label: 'Berichte', icon: 'description' },
  { id: 'chat', label: 'Protokoll', icon: 'forum' },
  { id: 'audit', label: 'Audit', icon: 'history' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function ProjectView({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [state, setState] = useState<ProjectState | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [coverageKey, setCoverageKey] = useState(0)
  const [focusSourceId, setFocusSourceId] = useState<string | null>(null)
  const [focusDoc, setFocusDoc] = useState<{ documentId: string; start?: number; end?: number } | null>(null)
  const openSource = (sourceId: string) => {
    setFocusSourceId(sourceId)
    setTab('sources')
  }
  const openDocument = (documentId: string, start?: number, end?: number) => {
    setFocusDoc({ documentId, start, end })
    setTab('corpus')
  }

  const reload = useCallback(async () => {
    setState(await window.api.getProjectState(projectId))
    setCoverageKey((k) => k + 1)
    onChanged()
  }, [projectId, onChanged])

  useEffect(() => {
    void reload()
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-white px-6 pt-5 pb-3">
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
            <Button
              icon="menu_book"
              onClick={async () => {
                const res = await window.api.exportBibliography(projectId)
                if (res.saved) {
                  setExportMsg(`BibTeX für Easy Writing: ${res.filePath}`)
                  setTimeout(() => setExportMsg(null), 4000)
                }
              }}
              title="references.bib mit stabilen Citekeys"
            >
              Für Easy Writing exportieren
            </Button>
          </div>
        </div>
        {exportMsg && <div className="mt-2 text-xs text-emerald-700">{exportMsg}</div>}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[42%] min-w-[300px] max-w-[560px] shrink-0 flex-col border-r border-slate-200">
          <AgentChat projectId={projectId} onRunEnd={() => void reload()} onCorpusChange={() => void reload()} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4 pt-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                  tab === t.id
                    ? 'border-(--color-accent-600) text-(--color-accent-700)'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon name={t.icon} className="icon-sm" />
                {t.label}
                {t.id === 'sources' && pendingCount > 0 && <Badge tone="amber">{pendingCount}</Badge>}
                {t.id === 'corpus' && state.documents.filter((d) => d.status !== 'excluded').length > 0 && (
                  <Badge tone="slate">{state.documents.filter((d) => d.status !== 'excluded').length}</Badge>
                )}
              </button>
            ))}
          </nav>
          <div className={`min-h-0 flex-1 ${tab === 'corpus' ? 'overflow-hidden' : 'overflow-y-auto p-6'}`}>
            {tab === 'overview' && <OverviewTab state={state} onReload={reload} coverageKey={coverageKey} onOpenSource={openSource} />}
            {tab === 'corpus' && (
              <CorpusTab state={state} onReload={reload} focus={focusDoc} onFocusConsumed={() => setFocusDoc(null)} />
            )}
            {tab === 'sources' && (
              <SourcesTab
                state={state}
                onReload={reload}
                focusSourceId={focusSourceId}
                onFocusConsumed={() => setFocusSourceId(null)}
                onOpenDocument={openDocument}
              />
            )}
            {tab === 'claims' && <ClaimsTab state={state} onOpenSource={openSource} />}
            {tab === 'map' && <MapTab state={state} onOpenSource={openSource} onReload={reload} />}
            {tab === 'reports' && <ReportsTab state={state} onReload={reload} />}
            {tab === 'chat' && <ChatTab state={state} />}
            {tab === 'audit' && <AuditTab projectId={projectId} />}
          </div>
        </div>
      </div>
    </div>
  )
}
