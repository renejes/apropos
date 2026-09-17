import { useCallback, useEffect, useMemo, useState } from 'react'
import { type ProjectState } from '../../../shared/types'
import { buildAgentDeskFolders, buildHumanDeskFolders, deskSurfaceForFocus } from '../../../shared/desk'
import { Badge, Button } from '../components/ui'
import AgentChat from './AgentChat'
import NotebookView from './NotebookView'
import DeskTab, { type DeskFocus } from './tabs/DeskTab'
import PlanTab from './tabs/PlanTab'
import ReportsTab from './tabs/ReportsTab'
import ExportDialog from './ExportDialog'

type PaneId = 'plan' | 'agent' | 'desk' | 'report'

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
  const [pane, setPane] = useState<PaneId>('plan')
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [deskFocus, setDeskFocus] = useState<DeskFocus | null>(null)

  const openDocument = (documentId: string, start?: number, end?: number, snapshot: ProjectState | null = state) => {
    setDeskFocus({ documentId, start, end })
    setPane(snapshot && deskSurfaceForFocus(snapshot, { documentId }) === 'human' ? 'desk' : 'agent')
  }

  const reload = useCallback(async () => {
    const next = await window.api.getProjectState(projectId)
    setState(next)
    onChanged()
    return next
  }, [projectId, onChanged])

  useEffect(() => {
    void reload()
    const t = setInterval(() => void reload(), 5000)
    return () => clearInterval(t)
  }, [reload])

  const deskCounts = useMemo(() => {
    if (!state) return { agentOpen: 0, humanOpen: 0 }
    return {
      agentOpen: buildAgentDeskFolders(state).filter((f) => f.pile === 'open').length,
      humanOpen: buildHumanDeskFolders(state).filter((f) => f.pile === 'open').length,
    }
  }, [state])

  if (!state) {
    return <div className="flex h-full items-center justify-center font-mono text-xs text-muted">lädt …</div>
  }

  if (state.project.kind === 'notebook') {
    return <NotebookView projectId={projectId} state={state} onReload={reload} onOpenProject={onOpenProject} />
  }

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
                  const res = await window.api.uploadCorpus(projectId)
                  if (res.errors.length) {
                    setExportMsg(res.errors.map((e) => `${e.filename}: ${e.message}`).join(' · '))
                  } else if (res.filenames.length) {
                    setExportMsg(`${res.filenames.length} Datei(en) im Korpus`)
                    void reload()
                  }
                  setTimeout(() => setExportMsg(null), 4000)
                } catch (err) {
                  setExportMsg(err instanceof Error ? err.message : String(err))
                  setTimeout(() => setExportMsg(null), 5000)
                }
              }}
              title="PDF oder Text als mögliche Quelle ablegen"
            >
              PDFs reinlegen
            </Button>
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
            <Button variant="primary" onClick={() => setExportOpen(true)} title="Provenienz, Easy Writing oder BibTeX">
              Export
            </Button>
          </div>
        </div>
        {exportMsg && <div className="mt-2 text-xs text-ok">{exportMsg}</div>}
        {(deskCounts.humanOpen > 0 || deskCounts.agentOpen > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {deskCounts.humanOpen > 0 && (
              <button
                type="button"
                onClick={() => setPane('desk')}
                className="border border-hairline px-2 py-0.5 text-fg hover:bg-fg hover:text-bg"
              >
                Human Desk · {deskCounts.humanOpen} offen
              </button>
            )}
            {deskCounts.agentOpen > 0 && (
              <button
                type="button"
                onClick={() => setPane('agent')}
                className="border border-hairline px-2 py-0.5 text-muted hover:bg-fg hover:text-bg"
              >
                Agent-Desk · {deskCounts.agentOpen} in Arbeit
              </button>
            )}
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
              void reload().then((next) => {
                openDocument(
                  follow.documentId,
                  follow.start !== follow.end ? follow.start : undefined,
                  follow.start !== follow.end ? follow.end : undefined,
                  next
                )
              })
            }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 gap-0 border-b border-hairline px-4">
            <button
              type="button"
              onClick={() => setPane('plan')}
              className={`inline-flex items-center gap-1.5 border-b px-3 py-2.5 text-sm whitespace-nowrap ${
                pane === 'plan' ? 'border-line text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              Plan
              {(state.researchBrief?.status === 'draft' || state.pendingBriefDraft) && <Badge tone="amber">Entwurf</Badge>}
            </button>
            <button
              type="button"
              onClick={() => setPane('agent')}
              className={`inline-flex items-center gap-1.5 border-b px-3 py-2.5 text-sm whitespace-nowrap ${
                pane === 'agent' ? 'border-line text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              Agent-Desk
              {deskCounts.agentOpen > 0 && <Badge tone="slate">{deskCounts.agentOpen}</Badge>}
            </button>
            <button
              type="button"
              onClick={() => setPane('desk')}
              className={`inline-flex items-center gap-1.5 border-b px-3 py-2.5 text-sm whitespace-nowrap ${
                pane === 'desk' ? 'border-line text-fg' : 'border-transparent text-muted hover:text-fg'
              }`}
            >
              Human Desk
              {deskCounts.humanOpen > 0 && <Badge tone="amber">{deskCounts.humanOpen}</Badge>}
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
          <div className={`min-h-0 flex-1 ${pane === 'report' ? 'overflow-y-auto p-6' : 'overflow-hidden'}`}>
            {pane === 'plan' && (
              <PlanTab
                state={state}
                onReload={reload}
                onOpenProject={onOpenProject}
                onOpenSource={(sourceId) => {
                  setDeskFocus({ sourceId })
                  setPane('desk')
                }}
              />
            )}
            {pane === 'agent' && (
              <DeskTab
                surface="agent"
                state={state}
                onReload={reload}
                focus={deskFocus}
                onFocusConsumed={() => setDeskFocus(null)}
              />
            )}
            {pane === 'desk' && (
              <DeskTab
                surface="human"
                state={state}
                onReload={reload}
                focus={deskFocus}
                onFocusConsumed={() => setDeskFocus(null)}
              />
            )}
            {pane === 'report' && <ReportsTab state={state} onReload={reload} />}
          </div>
        </div>
      </div>
    </div>
  )
}
