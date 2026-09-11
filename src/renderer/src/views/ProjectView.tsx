import { useCallback, useEffect, useMemo, useState } from 'react'
import { type ProjectState, isCapturePending, isWorkDocument } from '../../../shared/types'
import { buildDeskFolders } from '../../../shared/desk'
import { Badge, Button } from '../components/ui'
import AgentChat from './AgentChat'
import NotebookView from './NotebookView'
import DeskTab, { type DeskFocus } from './tabs/DeskTab'
import ReportsTab from './tabs/ReportsTab'
import ExportDialog from './ExportDialog'

type PaneId = 'desk' | 'report'

export default function ProjectView({
  projectId,
  onChanged,
  onOpenProject,
}: {
  projectId: string
  onChanged: () => void
  onOpenProject?: (id: string) => void
}) {
  const [state, setState] = useState<ProjectState | null>(null)
  const [pane, setPane] = useState<PaneId>('desk')
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [deskFocus, setDeskFocus] = useState<DeskFocus | null>(null)

  const openDocument = (documentId: string, start?: number, end?: number) => {
    setDeskFocus({ documentId, start, end })
    setPane('desk')
  }

  const reload = useCallback(async () => {
    setState(await window.api.getProjectState(projectId))
    onChanged()
  }, [projectId, onChanged])

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(), 5000)
    return () => clearInterval(t)
  }, [reload])

  const deskCounts = useMemo(() => {
    if (!state) return { open: 0, accepted: 0 }
    const folders = buildDeskFolders(state)
    return { open: folders.filter((f) => f.pile === 'open').length }
  }, [state])

  if (!state) {
    return <div className="flex h-full items-center justify-center font-mono text-xs text-muted">lädt …</div>
  }

  if (state.project.kind === 'notebook') {
    return <NotebookView projectId={projectId} state={state} onReload={reload} onOpenProject={onOpenProject} />
  }

  const openDocs = state.documents.filter((d) => d.status === 'open' && isWorkDocument(d))

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
                try {
                  const nb = await window.api.createNotebookFromResearch(projectId)
                  onChanged()
                  onOpenProject?.(nb.id)
                } catch (err) {
                  setExportMsg(err instanceof Error ? err.message : String(err))
                  setTimeout(() => setExportMsg(null), 5000)
                }
              }}
              title="Notebook, das diesen Korpus liest"
            >
              Notebook aus diesem Projekt
            </Button>
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
        {openDocs.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Offen</span>
            {openDocs.map((d) => (
              <button
                key={d.id}
                type="button"
                title={d.url}
                onClick={() => openDocument(d.id)}
                className="max-w-[220px] truncate border border-hairline px-2 py-0.5 text-xs text-fg hover:bg-fg hover:text-bg"
              >
                {isCapturePending(d) ? 'Capture · ' : ''}
                {d.title || d.filename || d.url}
              </button>
            ))}
          </div>
        )}
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
          <AgentChat
            projectId={projectId}
            onRunEnd={() => void reload()}
            onCorpusChange={() => void reload()}
            onFollowDoc={(follow) => {
              void reload()
              openDocument(
                follow.documentId,
                follow.start !== follow.end ? follow.start : undefined,
                follow.start !== follow.end ? follow.end : undefined
              )
            }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 gap-0 border-b border-hairline px-4">
            <button
              type="button"
              onClick={() => setPane('desk')}
              className={`inline-flex items-center gap-1.5 border-b px-3 py-2.5 text-sm whitespace-nowrap ${
                pane === 'desk' ? 'border-line text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              Arbeitstisch
              {deskCounts.open > 0 && <Badge tone="amber">{deskCounts.open}</Badge>}
            </button>
            <button
              type="button"
              onClick={() => setPane('report')}
              className={`inline-flex items-center gap-1.5 border-b px-3 py-2.5 text-sm whitespace-nowrap ${
                pane === 'report' ? 'border-line text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              Bericht
              {state.reportVersions.length > 0 && <Badge tone="slate">{state.reportVersions.length}</Badge>}
            </button>
          </nav>
          <div className={`min-h-0 flex-1 ${pane === 'desk' ? 'overflow-hidden' : 'overflow-y-auto p-6'}`}>
            {pane === 'desk' && (
              <DeskTab state={state} onReload={reload} focus={deskFocus} onFocusConsumed={() => setDeskFocus(null)} />
            )}
            {pane === 'report' && <ReportsTab state={state} onReload={reload} />}
          </div>
        </div>
      </div>
    </div>
  )
}
