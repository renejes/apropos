import { useCallback, useEffect, useState } from 'react'
import type { ProjectState } from '../../../shared/types'
import { Badge, Button } from '../components/ui'
import AgentChat from './AgentChat'
import NotebookView from './NotebookView'
import OverviewTab from './tabs/OverviewTab'
import CorpusTab from './tabs/CorpusTab'
import SourcesTab from './tabs/SourcesTab'
import ClaimsTab from './tabs/ClaimsTab'
import MapTab from './tabs/MapTab'
import ReportsTab from './tabs/ReportsTab'
import ChatTab from './tabs/ChatTab'
import AuditTab from './tabs/AuditTab'
import ExportDialog from './ExportDialog'

const TABS = [
  { id: 'overview', label: 'Übersicht' },
  { id: 'corpus', label: 'Korpus' },
  { id: 'sources', label: 'Quellen' },
  { id: 'claims', label: 'Aussagen' },
  { id: 'map', label: 'Karte' },
  { id: 'reports', label: 'Berichte' },
  { id: 'chat', label: 'Protokoll' },
  { id: 'audit', label: 'Audit' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function ProjectView({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [state, setState] = useState<ProjectState | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
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
    return <div className="flex h-full items-center justify-center font-mono text-xs text-muted">lädt …</div>
  }

  if (state.project.kind === 'notebook') {
    return <NotebookView projectId={projectId} state={state} onReload={reload} />
  }

  const pendingCount = state.sources.filter((s) => s.review_status === 'pending').length
  const corpusCount = state.documents.filter((d) => d.status !== 'excluded').length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-hairline px-6 pt-5 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg">{state.project.title}</h1>
              <Badge tone="slate">{state.project.mode === 'academic' ? 'akademisch' : 'business'}</Badge>
              {state.project.policy_preset && <Badge tone="slate">{state.project.policy_preset}</Badge>}
            </div>
            {state.project.research_question && <p className="mt-1 truncate text-sm text-muted">{state.project.research_question}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              onClick={async () => {
                await window.api.copyMarkdown(projectId, null)
                setExportMsg('Export in Zwischenablage kopiert')
                setTimeout(() => setExportMsg(null), 2500)
              }}
              title="Provenienz-Export in die Zwischenablage"
            >
              Kopieren
            </Button>
            <Button variant="primary" onClick={() => setExportOpen(true)} title="Provenienz oder Easy Writing">
              Export
            </Button>
          </div>
        </div>
        {exportMsg && <div className="mt-2 text-xs text-ok">{exportMsg}</div>}
      </header>

      {exportOpen && (
        <ExportDialog
          state={state}
          onClose={() => setExportOpen(false)}
          onDone={(msg) => {
            setExportMsg(msg)
            setTimeout(() => setExportMsg(null), 4000)
            void reload()
          }}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[42%] min-w-[300px] max-w-[560px] shrink-0 flex-col border-r border-line">
          <AgentChat projectId={projectId} onRunEnd={() => void reload()} onCorpusChange={() => void reload()} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 gap-0 overflow-x-auto border-b border-hairline px-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 border-b px-3 py-2.5 text-sm whitespace-nowrap ${
                  tab === t.id ? 'border-line text-fg' : 'border-transparent text-muted hover:text-fg'
                }`}
              >
                {t.label}
                {t.id === 'sources' && pendingCount > 0 && <Badge tone="amber">{pendingCount}</Badge>}
                {t.id === 'corpus' && corpusCount > 0 && <Badge tone="slate">{corpusCount}</Badge>}
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
