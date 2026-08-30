import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { DocumentSearchHit, FetchedDocument, ProjectState } from '../../../../shared/types'
import { Badge, Button, EmptyState, Icon, fmtDate } from '../../components/ui'

type DocMeta = Omit<FetchedDocument, 'text'>

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
          <Reader
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

function OriginBadge({ origin }: { origin: DocMeta['origin'] }) {
  switch (origin) {
    case 'upload':
      return (
        <Badge tone="violet" icon="upload_file">
          Upload
        </Badge>
      )
    case 'youtube':
      return (
        <Badge tone="red" icon="smart_display">
          YouTube
        </Badge>
      )
    case 'fetched':
      return (
        <Badge tone="sky" icon="public">
          Netz
        </Badge>
      )
    default: {
      const _never: never = origin
      return _never
    }
  }
}

function pageForOffset(starts: number[] | null, offset: number): number | null {
  if (!starts || starts.length === 0) return null
  let page = 0
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= offset) page = i
    else break
  }
  return page + 1
}

function Reader({
  meta,
  doc,
  range,
  citedBy,
}: {
  meta: DocMeta
  doc: FetchedDocument
  range: { start: number; end: number } | null
  citedBy: number
}) {
  const markRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [doc.id, range?.start, range?.end])

  const jumpPage = useCallback(
    (pageIndex: number) => {
      const el = document.getElementById(`corpus-page-${pageIndex}`)
      el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    },
    []
  )

  const quotePage = range ? pageForOffset(doc.page_starts, range.start) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-hairline bg-bg px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{doc.title || meta.filename || doc.url}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <OriginBadge origin={doc.origin} />
              <span>Abgerufen {fmtDate(doc.fetched_at)}</span>
              <span>{doc.char_len.toLocaleString('de-DE')} Zeichen</span>
              {citedBy > 0 && <span>{citedBy} Beleg(e)</span>}
              {quotePage != null && <span>Stelle auf S. {quotePage}</span>}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {doc.filename && (
              <Button icon="open_in_new" onClick={() => void window.api.openOriginalDocument(doc.id)}>
                Original
              </Button>
            )}
          </div>
        </div>
        {doc.page_starts && doc.page_starts.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {doc.page_starts.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => jumpPage(i)}
                className={`px-1.5 py-0.5 text-[11px] ${
                  quotePage === i + 1 ? 'bg-warn-bg font-medium text-fg' : 'border border-hairline text-muted hover:bg-fg hover:text-bg'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <article className="mx-auto max-w-3xl text-[15px] leading-relaxed text-fg">
          <HighlightedBody text={doc.text} pageStarts={doc.page_starts} range={range} markRef={markRef} />
        </article>
      </div>
    </div>
  )
}

function HighlightedBody({
  text,
  pageStarts,
  range,
  markRef,
}: {
  text: string
  pageStarts: number[] | null
  range: { start: number; end: number } | null
  markRef: MutableRefObject<HTMLElement | null>
}) {
  const starts = pageStarts && pageStarts.length > 0 ? pageStarts : [0]
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!
    const to = i + 1 < starts.length ? starts[i + 1]! : text.length
    const chunk = text.slice(from, to)
    nodes.push(
      <div key={i} id={`corpus-page-${i}`} className={i > 0 ? 'mt-8 border-t border-hairline pt-6' : ''}>
        {starts.length > 1 && <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Seite {i + 1}</div>}
        <HighlightedChunk text={chunk} absStart={from} range={range} markRef={markRef} />
      </div>
    )
  }
  return <>{nodes}</>
}

function HighlightedChunk({
  text,
  absStart,
  range,
  markRef,
}: {
  text: string
  absStart: number
  range: { start: number; end: number } | null
  markRef: MutableRefObject<HTMLElement | null>
}) {
  if (!range) return <span className="whitespace-pre-wrap">{text}</span>
  const localStart = range.start - absStart
  const localEnd = range.end - absStart
  if (localEnd <= 0 || localStart >= text.length) return <span className="whitespace-pre-wrap">{text}</span>
  const a = Math.max(0, localStart)
  const b = Math.min(text.length, localEnd)
  return (
    <span className="whitespace-pre-wrap">
      {text.slice(0, a)}
      <mark
        ref={(el) => {
          if (localStart >= 0 && localStart < text.length) markRef.current = el
        }}
        className="bg-warn-bg px-0.5 font-medium text-fg"
      >
        {text.slice(a, b)}
      </mark>
      {text.slice(b)}
    </span>
  )
}
