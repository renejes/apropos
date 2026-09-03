import { useEffect, useMemo, useState } from 'react'
import type { DocumentSearchHit, FetchedDocument, ProjectState } from '../../../../shared/types'
import { Button, EmptyState, Icon } from '../../components/ui'
import DocumentReader, { OriginBadge } from '../DocumentReader'

export type CorpusFocus = { documentId: string; start?: number; end?: number }

export default function CorpusTab({
  state,
  onReload,
  focus,
  onFocusConsumed,
}: {
  state: ProjectState
  onReload: () => void
  focus?: CorpusFocus | null
  onFocusConsumed?: () => void
}) {
  const docs = state.documents.filter((d) => d.status !== 'excluded')
  const [selectedId, setSelectedId] = useState<string | null>(focus?.documentId ?? docs[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DocumentSearchHit[] | null>(null)
  const [range, setRange] = useState<{ start: number; end: number } | null>(
    focus?.start != null && focus?.end != null ? { start: focus.start, end: focus.end } : null
  )
  const [full, setFull] = useState<FetchedDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropOver, setDropOver] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!focus?.documentId) return
    setSelectedId(focus.documentId)
    if (focus.start != null && focus.end != null) setRange({ start: focus.start, end: focus.end })
    onFocusConsumed?.()
  }, [focus, onFocusConsumed])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits(null)
      return
    }
    const t = setTimeout(() => {
      void window.api.searchDocuments(state.project.id, q).then(setHits)
    }, 250)
    return () => clearTimeout(t)
  }, [query, state.project.id])

  useEffect(() => {
    if (!selectedId) {
      setFull(null)
      return
    }
    let alive = true
    void window.api.getDocument(selectedId).then((doc) => {
      if (alive) setFull(doc)
    })
    return () => {
      alive = false
    }
  }, [selectedId, state.documents])

  const filtered = useMemo(() => {
    if (!query.trim() || !hits) return docs
    const ids = new Set(hits.map((h) => h.document_id))
    return docs.filter((d) => ids.has(d.id) || (d.title ?? '').toLowerCase().includes(query.toLowerCase()))
  }, [docs, hits, query])

  const selected = docs.find((d) => d.id === selectedId) ?? null

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

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDropOver(false)
    const paths = [...e.dataTransfer.files]
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (paths.length === 0) return
    void upload(() => window.api.importCorpus(state.project.id, paths))
  }

  return (
    <div
      className="flex h-full min-h-0"
      onDragOver={(e) => {
        e.preventDefault()
        setDropOver(true)
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={onDrop}
    >
      <aside className={`flex w-[280px] shrink-0 flex-col border-r border-hairline bg-bg ${dropOver ? 'ring-2 ring-inset ring-fg' : ''}`}>
        <div className="border-b border-hairline p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Korpus</h2>
            <Button variant="primary" icon="upload_file" disabled={busy} onClick={() => void upload(() => window.api.uploadCorpus(state.project.id))}>
              Hochladen
            </Button>
          </div>
          <div className="relative">
            <Icon name="search" className="icon-sm absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="In PDFs suchen …"
              className="field w-full py-1.5 pl-8 pr-3 text-sm"
            />
          </div>
          {notice && <p className="mt-2 text-[11px] text-muted">{notice}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {docs.length === 0 ? (
            <EmptyState icon="menu_book" title="Noch keine Dokumente" hint="Lade PDFs hoch oder hänge sie im Chat an. Sie bleiben im Projekt, unabhängig vom Chat." />
          ) : (
            <div className="space-y-1.5">
              {filtered.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(d.id)
                    setRange(null)
                  }}
                  className={`w-full px-2.5 py-2 text-left ${selectedId === d.id ? 'bg-fg text-bg' : 'hover:bg-fg hover:text-bg'}`}
                >
                  <div className="flex items-start gap-2">
                    <Icon name={d.filename?.toLowerCase().endsWith('.pdf') || d.url.includes('.pdf') ? 'picture_as_pdf' : 'description'} className="mt-0.5 opacity-60" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{d.title || d.filename || d.url}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        <OriginBadge origin={d.origin} />
                        <span className="text-[11px] text-muted">{d.char_len.toLocaleString('de-DE')} Zeichen</span>
                        {d.page_starts && d.page_starts.length > 1 && (
                          <span className="text-[11px] text-muted">{d.page_starts.length} Seiten</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted">Keine Treffer im Korpus.</p>}
            </div>
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-bg">
        {hits && hits.length > 0 && query.trim().length >= 2 && (
          <div className="shrink-0 border-b border-hairline bg-bg px-4 py-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {hits.reduce((n, h) => n + h.matches.length, 0)} Stellen in {hits.length} Dokument(en)
            </div>
            <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
              {hits.flatMap((h) =>
                h.matches.map((m, i) => (
                  <button
                    key={`${h.document_id}-${m.start}-${i}`}
                    type="button"
                    className="px-2 py-1 text-left text-xs text-muted hover:bg-wash"
                    onClick={() => {
                      setSelectedId(h.document_id)
                      setRange({ start: m.start, end: m.end })
                    }}
                  >
                    <span className="font-medium text-fg">{h.title ?? 'Dokument'}</span>
                    <span className="text-muted"> · </span>
                    <span className="italic">{m.snippet}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        {selected && full ? (
          <DocumentReader
            meta={selected}
            doc={full}
            range={range}
            citedBy={state.sources.filter((s) => s.document_id === selected.id).length}
          />
        ) : docs.length > 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Dokument wählen oder eine Datei hierher ziehen.</div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Icon name="upload_file" className="icon-lg text-muted" />
            <div className="text-sm font-medium text-muted">PDFs hierher ziehen oder hochladen</div>
            <p className="max-w-sm text-xs text-muted">
              Der Agent sucht in diesen Dateien und im Netz. Belege springen zur markierten Stelle — wie in NotebookLM, mit Offset-Zwang.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
