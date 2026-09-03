import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import type { ArtifactFile, FetchedDocument, Note, ProjectState, ProjectSummary } from '../../../shared/types'
import { Badge, Button, EmptyState } from '../components/ui'
import AgentChat from './AgentChat'
import DocumentReader from './DocumentReader'

type CenterTab =
  | { kind: 'chat' }
  | { kind: 'note'; id: string }
  | { kind: 'artifact'; path: string }
  | { kind: 'document'; id: string; start?: number; end?: number }

export default function NotebookView({
  projectId,
  state,
  onReload,
  onOpenProject,
}: {
  projectId: string
  state: ProjectState
  onReload: () => void
  onOpenProject?: (id: string) => void
}) {
  const [center, setCenter] = useState<CenterTab>({ kind: 'chat' })
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState(false)
  const [artifacts, setArtifacts] = useState<ArtifactFile[]>([])
  const docs = state.documents.filter((d) => d.status !== 'excluded')
  const notes = state.notes
  const linked = state.linked_research
  const corpusLocked = Boolean(linked)
  const [researchList, setResearchList] = useState<ProjectSummary[]>([])

  const refreshArtifacts = useCallback(() => {
    void window.api.listArtifacts(projectId).then(setArtifacts)
  }, [projectId])

  useEffect(() => {
    refreshArtifacts()
    const t = setInterval(refreshArtifacts, 4000)
    return () => clearInterval(t)
  }, [refreshArtifacts])

  useEffect(() => {
    if (linked || docs.length > 0) return
    void window.api.listProjects().then((list) => setResearchList(list.filter((p) => p.kind === 'research')))
  }, [linked, docs.length])

  const upload = async (importer: () => Promise<{ filenames: string[]; errors: Array<{ filename: string; message: string }> }>) => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await importer()
      if (res.errors.length) setNotice(res.errors.map((e) => `${e.filename}: ${e.message}`).join(' · '))
      else if (res.filenames.length) setNotice(`${res.filenames.length} Datei(en) im Korpus.`)
      onReload()
    } finally {
      setBusy(false)
    }
  }

  const addYoutube = async () => {
    const url = youtubeUrl.trim()
    if (!url) return
    setBusy(true)
    setNotice(null)
    try {
      const doc = await window.api.ingestYoutube(projectId, url)
      setYoutubeUrl('')
      setNotice(`YouTube: ${doc.title ?? doc.url}`)
      onReload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const saveChatAsNote = async (text: string) => {
    const title = titleFromMarkdown(text)
    const note = await window.api.createNote({ project_id: projectId, title, body_markdown: text, origin: 'chat' })
    onReload()
    setCenter({ kind: 'note', id: note.id })
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDropOver(false)
    const paths = [...e.dataTransfer.files]
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (paths.length === 0) return
    if (corpusLocked) {
      setNotice('Quellen im Research-Projekt anlegen, nicht hier.')
      return
    }
    void upload(() => window.api.importCorpus(projectId, paths))
  }

  const openNote = notes.find((n) => center.kind === 'note' && n.id === center.id) ?? null
  const openDocMeta = docs.find((d) => center.kind === 'document' && d.id === center.id) ?? null
  const [openDocFull, setOpenDocFull] = useState<FetchedDocument | null>(null)

  useEffect(() => {
    if (center.kind !== 'document') {
      setOpenDocFull(null)
      return
    }
    let alive = true
    void window.api.getDocument(center.id).then((doc) => {
      if (alive) setOpenDocFull(doc)
    })
    return () => {
      alive = false
    }
  }, [center])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-hairline px-6 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg">{state.project.title}</h1>
          <Badge tone="violet">Notebook</Badge>
        </div>
        <p className="mt-1 text-sm text-muted">Quellen links, Chat und Notizen in der Mitte. Alles Markdown.</p>
        {linked && (
          <p className="mt-2 text-xs text-muted">
            Korpus aus Research „{linked.title}“.{' '}
            <button type="button" className="underline" onClick={() => onOpenProject?.(linked.id)}>
              Research öffnen
            </button>
            . Quellen nur dort anlegen.
          </p>
        )}
      </header>

      <div
        className="flex min-h-0 flex-1"
        onDragOver={(e) => {
          e.preventDefault()
          setDropOver(true)
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={onDrop}
      >
        <aside className={`flex w-72 shrink-0 flex-col border-r border-line ${dropOver ? 'ring-2 ring-inset ring-fg' : ''}`}>
          <section className="border-b border-hairline p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Quellen</h2>
              {!corpusLocked && (
                <Button
                  variant="ghost"
                  icon="upload_file"
                  title="PDF hochladen"
                  disabled={busy}
                  onClick={() => void upload(() => window.api.uploadCorpus(projectId))}
                />
              )}
            </div>
            {!corpusLocked && (
              <div className="flex gap-1">
                <input
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void addYoutube()
                  }}
                  placeholder="YouTube-Link"
                  className="field min-w-0 flex-1 text-xs"
                  disabled={busy}
                />
                <Button variant="ghost" disabled={busy || !youtubeUrl.trim()} onClick={() => void addYoutube()}>
                  +
                </Button>
              </div>
            )}
            {!corpusLocked && !linked && docs.length === 0 && researchList.length > 0 && (
              <div className="mt-2">
                <p className="mb-1 text-[11px] text-muted">Oder mit Research verknüpfen:</p>
                <select
                  className="field w-full text-xs"
                  defaultValue=""
                  onChange={(e) => {
                    const id = e.target.value
                    if (!id) return
                    void window.api
                      .linkNotebookToResearch(projectId, id)
                      .then(() => onReload())
                      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)))
                  }}
                >
                  <option value="">Research wählen …</option>
                  {researchList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {notice && <p className="mt-2 text-[11px] text-muted">{notice}</p>}
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {docs.length === 0 ? (
                <li className="text-xs text-muted">
                  {corpusLocked ? 'Noch keine Dokumente im verknüpften Research.' : 'PDFs hierher ziehen oder YouTube-Link einfügen.'}
                </li>
              ) : (
                docs.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className={`w-full truncate px-1 py-0.5 text-left text-xs ${
                        center.kind === 'document' && center.id === d.id ? 'bg-fg text-bg' : 'hover:bg-fg hover:text-bg'
                      }`}
                      onClick={() => setCenter({ kind: 'document', id: d.id })}
                    >
                      <OriginLabel origin={d.origin} /> {d.title || d.filename || d.url}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>

          <section className="min-h-0 flex-1 overflow-y-auto border-b border-hairline p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Notizen</h2>
              <Button
                variant="ghost"
                icon="add"
                title="Leere Notiz"
                onClick={async () => {
                  const note = await window.api.createNote({
                    project_id: projectId,
                    title: 'Neue Notiz',
                    body_markdown: '',
                    origin: 'human',
                  })
                  onReload()
                  setCenter({ kind: 'note', id: note.id })
                }}
              />
            </div>
            {notes.length === 0 ? (
              <EmptyState icon="edit_note" title="Noch keine Notizen" hint="Im Chat „Als Notiz speichern“ oder hier anlegen." />
            ) : (
              <ul className="space-y-1">
                {notes.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setCenter({ kind: 'note', id: n.id })}
                      className={`w-full px-2 py-1.5 text-left text-sm ${
                        center.kind === 'note' && center.id === n.id ? 'bg-fg text-bg' : 'hover:bg-fg hover:text-bg'
                      }`}
                    >
                      <span className="block truncate">{n.title}</span>
                      <span className="text-[11px] opacity-70">{n.citations.length > 0 ? `${n.citations.length} Belege` : 'Entwurf'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="max-h-40 overflow-y-auto p-3">
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Artefakte</h2>
            {artifacts.length === 0 ? (
              <p className="text-xs text-muted">HTML/Tabellen legt der Agent unter artifacts/ ab.</p>
            ) : (
              <ul className="space-y-1">
                {artifacts.map((a) => (
                  <li key={a.path}>
                    <button
                      type="button"
                      onClick={() => setCenter({ kind: 'artifact', path: a.path })}
                      className={`w-full truncate px-2 py-1 text-left text-xs ${
                        center.kind === 'artifact' && center.path === a.path ? 'bg-fg text-bg' : 'hover:bg-fg hover:text-bg'
                      }`}
                    >
                      {a.path}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 gap-0 overflow-x-auto border-b border-hairline px-2" aria-label="Notebook-Tabs">
            <TabButton active={center.kind === 'chat'} onClick={() => setCenter({ kind: 'chat' })}>
              Chat
            </TabButton>
            {center.kind === 'note' && openNote && (
              <TabButton active onClick={() => undefined}>
                {openNote.title}
                <span className="ml-1 opacity-60" onClick={(e) => { e.stopPropagation(); setCenter({ kind: 'chat' }) }}>
                  ×
                </span>
              </TabButton>
            )}
            {center.kind === 'document' && openDocMeta && (
              <TabButton active onClick={() => undefined}>
                {(openDocMeta.title || openDocMeta.filename || 'Quelle').slice(0, 28)}
                <span
                  className="ml-1 opacity-60"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCenter({ kind: 'chat' })
                  }}
                >
                  ×
                </span>
              </TabButton>
            )}
            {center.kind === 'artifact' && (
              <TabButton active onClick={() => undefined}>
                {center.path}
                <span
                  className="ml-1 opacity-60"
                  onClick={(e) => {
                    e.stopPropagation()
                    setCenter({ kind: 'chat' })
                  }}
                >
                  ×
                </span>
              </TabButton>
            )}
          </nav>

          <div className={center.kind === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
            <AgentChat
              projectId={projectId}
              variant="notebook"
              onRunEnd={() => {
                void onReload()
                refreshArtifacts()
              }}
              onCorpusChange={onReload}
              onSaveNote={saveChatAsNote}
            />
          </div>
          {center.kind === 'note' && openNote && (
            <NoteEditor
              note={openNote}
              onSaved={() => void onReload()}
              onDeleted={() => {
                setCenter({ kind: 'chat' })
                void onReload()
              }}
              onOpenDocument={(documentId, start, end) => setCenter({ kind: 'document', id: documentId, start, end })}
            />
          )}
          {center.kind === 'document' && openDocMeta && openDocFull && (
            <DocumentReader
              meta={openDocMeta}
              doc={openDocFull}
              range={center.start != null && center.end != null ? { start: center.start, end: center.end } : null}
            />
          )}
          {center.kind === 'artifact' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <ArtifactPreview projectId={projectId} path={center.path} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center border-b px-3 py-2.5 text-sm whitespace-nowrap ${
        active ? 'border-line text-fg' : 'border-transparent text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

function OriginLabel({ origin }: { origin: FetchedDocument['origin'] }) {
  switch (origin) {
    case 'youtube':
      return <Badge tone="red">YT</Badge>
    case 'upload':
      return <Badge tone="violet">PDF</Badge>
    case 'fetched':
      return <Badge tone="sky">Netz</Badge>
    default: {
      const _never: never = origin
      return _never
    }
  }
}

function titleFromMarkdown(text: string): string {
  const heading = text.match(/^#\s+(.+)$/m)
  if (heading?.[1]) return heading[1].trim().slice(0, 80)
  const line = text.split('\n').find((l) => l.trim())
  return (line ?? 'Notiz').trim().slice(0, 80)
}

function NoteEditor({
  note,
  onSaved,
  onDeleted,
  onOpenDocument,
}: {
  note: Note
  onSaved: () => void
  onDeleted: () => void
  onOpenDocument?: (documentId: string, start?: number, end?: number) => void
}) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body_markdown)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setTitle(note.title)
    setBody(note.body_markdown)
  }, [note.id, note.title, note.body_markdown])

  const dirty = title !== note.title || body !== note.body_markdown

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="field min-w-0 flex-1 text-sm" />
        {note.citations.length === 0 ? <Badge tone="amber">Entwurf</Badge> : <Badge tone="emerald">{note.citations.length} Belege</Badge>}
        <Button
          variant="primary"
          disabled={busy || !dirty || !title.trim()}
          onClick={async () => {
            setBusy(true)
            try {
              await window.api.updateNote({ note_id: note.id, title: title.trim(), body_markdown: body })
              onSaved()
            } finally {
              setBusy(false)
            }
          }}
        >
          Speichern
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            await window.api.deleteNote(note.id)
            onDeleted()
          }}
        >
          Löschen
        </Button>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="field min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-sm leading-relaxed"
        placeholder="Markdown …"
      />
      {note.citations.length > 0 && (
        <ul className="max-h-28 overflow-y-auto border-t border-hairline px-4 py-2 text-xs text-muted">
          {note.citations.map((c, i) => (
            <li key={`${c.document_id}-${c.quote_start}-${i}`} className="mb-1">
              <span className="font-mono">{c.quote_start}–{c.quote_end}</span> · {c.quote.slice(0, 120)}{' '}
              {onOpenDocument && (
                <button type="button" className="underline" onClick={() => onOpenDocument(c.document_id, c.quote_start, c.quote_end)}>
                  Im PDF zeigen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ArtifactPreview({ projectId, path }: { projectId: string; path: string }) {
  const [payload, setPayload] = useState<{ path: string; kind: ArtifactFile['kind']; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setPayload(null)
    setError(null)
    void window.api
      .readArtifact(projectId, path)
      .then((p) => {
        if (alive) setPayload(p)
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [projectId, path])

  if (error) return <p className="p-6 text-sm text-bad">{error}</p>
  if (!payload) return <p className="p-6 text-sm text-muted">lädt …</p>

  if (payload.kind === 'html') {
    return (
      <iframe
        title={payload.path}
        sandbox="allow-scripts"
        className="min-h-0 w-full flex-1 border-0 bg-bg"
        srcDoc={payload.text}
      />
    )
  }

  return <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">{payload.text}</pre>
}
