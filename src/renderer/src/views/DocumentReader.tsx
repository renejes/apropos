import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { type DocumentOpenInfo, type FetchedDocument, type SubQuestion, isCapturePending } from '../../../shared/types'
import { pageForOffset } from '../../../shared/page-offset'
import { Badge, Button, fmtDate } from '../components/ui'

type DocMeta = Omit<FetchedDocument, 'text'>

export default function DocumentReader({
  meta,
  doc,
  range,
  citedBy = 0,
  projectId,
  subQuestions,
  onChanged,
}: {
  meta: DocMeta
  doc: FetchedDocument
  range: { start: number; end: number } | null
  citedBy?: number
  projectId: string
  subQuestions: SubQuestion[]
  onChanged: () => void
}) {
  const [info, setInfo] = useState<DocumentOpenInfo | null>(null)
  const [surface, setSurface] = useState<'auto' | 'text'>('auto')
  const [selection, setSelection] = useState<{ start: number; end: number; quote: string } | null>(null)
  const [excludeOpen, setExcludeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const capturePending = isCapturePending(doc) && doc.char_len === 0

  useEffect(() => {
    let alive = true
    void window.api.inspectDocument(doc.id).then((next) => {
      if (alive) setInfo(next)
    })
    return () => {
      alive = false
    }
  }, [doc.id, doc.filename])

  useEffect(() => {
    setSelection(null)
    setExcludeOpen(false)
    setNotice(null)
    setSurface('auto')
  }, [doc.id])

  const quotePage = range ? pageForOffset(doc.page_starts, range.start) : null
  const kind = info?.kind ?? (doc.origin === 'youtube' ? 'youtube' : 'text')
  const showText = surface === 'text' || kind !== 'pdf' || capturePending

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-hairline bg-bg px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{doc.title || meta.filename || doc.url}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              <OriginBadge origin={doc.origin} />
              {capturePending && (
                <Badge tone="amber" icon="lock">
                  Capture
                </Badge>
              )}
              {doc.status === 'open' && !capturePending && (
                <Badge tone="amber" icon="pending">
                  Offen
                </Badge>
              )}
              <span>Abgerufen {fmtDate(doc.fetched_at)}</span>
              <span>{doc.char_len.toLocaleString('de-DE')} Zeichen</span>
              {citedBy > 0 && <span>{citedBy} Beleg(e)</span>}
              {quotePage != null && <span>Stelle auf S. {quotePage}</span>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {kind === 'pdf' && !capturePending && (
              <Button icon={showText ? 'picture_as_pdf' : 'notes'} onClick={() => setSurface((s) => (s === 'text' ? 'auto' : 'text'))}>
                {showText ? 'PDF zeigen' : 'Text zum Belegen'}
              </Button>
            )}
            {info?.file_exists && (
              <>
                <Button icon="folder_open" onClick={() => void window.api.showDocumentInFolder(doc.id)}>
                  Im Finder zeigen
                </Button>
                <Button icon="open_in_new" onClick={() => void window.api.openOriginalDocument(doc.id)}>
                  System-PDF
                </Button>
              </>
            )}
            {(kind === 'youtube' || kind === 'html' || kind === 'missing' || capturePending) && isHttpUrl(doc.url) && (
              <Button icon="open_in_new" onClick={() => void window.api.openExternal(doc.url)}>
                URL öffnen
              </Button>
            )}
            <Button
              variant="danger"
              icon="block"
              onClick={() => {
                setExcludeOpen((v) => !v)
                setSelection(null)
              }}
            >
              Verwerfen
            </Button>
          </div>
        </div>
        {notice && <p className="mt-2 text-xs text-muted">{notice}</p>}
      </header>
      {excludeOpen && (
        <ExcludeForm
          busy={busy}
          onCancel={() => setExcludeOpen(false)}
          onSubmit={async (reason) => {
            setBusy(true)
            setNotice(null)
            try {
              await window.api.excludeSourceFromReader({ projectId, documentId: doc.id, reason })
              setExcludeOpen(false)
              onChanged()
            } catch (err) {
              setNotice(err instanceof Error ? err.message : String(err))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      {selection && !capturePending && (
        <CiteForm
          quote={selection.quote}
          start={selection.start}
          end={selection.end}
          subQuestions={subQuestions}
          busy={busy}
          onCancel={() => setSelection(null)}
          onSubmit={async (fields) => {
            setBusy(true)
            setNotice(null)
            try {
              await window.api.addSourceFromReader({
                projectId,
                documentId: doc.id,
                quoteStart: selection.start,
                quoteEnd: selection.end,
                reason: fields.reason,
                extraction: fields.extraction,
                contribution: fields.contribution,
                subQuestionId: fields.subQuestionId,
              })
              setSelection(null)
              onChanged()
            } catch (err) {
              setNotice(err instanceof Error ? err.message : String(err))
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
      {capturePending ? (
        <CapturePanel
          reason={doc.capture_reason ?? 'Zugang gesperrt'}
          url={doc.url}
          busy={busy}
          onNotice={setNotice}
          onBind={async (paths) => {
            setBusy(true)
            setNotice(null)
            try {
              const res = await window.api.importCorpus(projectId, paths, doc.id)
              if (res.errors.length) setNotice(res.errors.map((e) => `${e.filename}: ${e.message}`.trim()).join(' · '))
              else setNotice('Volltext gebunden. Die URL bleibt — jetzt markieren und belegen.')
              onChanged()
            } finally {
              setBusy(false)
            }
          }}
        />
      ) : (
        <ReaderBody
          kind={kind}
          info={info}
          doc={doc}
          range={range}
          quotePage={quotePage}
          preferText={showText}
          onSelection={setSelection}
        />
      )}
    </div>
  )
}

function isHttpUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

function ReaderBody({
  kind,
  info,
  doc,
  range,
  quotePage,
  preferText,
  onSelection,
}: {
  kind: DocumentOpenInfo['kind'] | 'text' | 'youtube' | 'html' | 'pdf' | 'missing'
  info: DocumentOpenInfo | null
  doc: FetchedDocument
  range: { start: number; end: number } | null
  quotePage: number | null
  preferText: boolean
  onSelection: (sel: { start: number; end: number; quote: string } | null) => void
}) {
  if (kind === 'pdf' && !preferText) {
    return <PdfPages documentId={doc.id} initialPage={quotePage} />
  }
  switch (kind) {
    case 'pdf':
      return <TextBody doc={doc} range={range} onSelection={onSelection} />
    case 'youtube':
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="border-b border-hairline px-5 py-2 text-xs text-muted">
            YouTube-Transkript — kein PDF. Das Video öffnest du über den Link.
          </p>
          <TextBody doc={doc} range={range} onSelection={onSelection} />
        </div>
      )
    case 'missing':
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-hairline bg-warn-bg px-5 py-2 text-sm text-warn">
            Die Datei liegt nicht mehr in der Inbox
            {info?.filename ? ` (${info.filename})` : ''}. Gespeicherter Text bleibt lesbar.
            {isHttpUrl(doc.url) ? ' Die URL kannst du im Browser öffnen.' : ''}
          </div>
          <TextBody doc={doc} range={range} onSelection={onSelection} />
        </div>
      )
    case 'html':
    case 'text':
      return <TextBody doc={doc} range={range} onSelection={onSelection} />
    default: {
      const _never: never = kind
      return _never
    }
  }
}

function TextBody({
  doc,
  range,
  onSelection,
}: {
  doc: FetchedDocument
  range: { start: number; end: number } | null
  onSelection: (sel: { start: number; end: number; quote: string } | null) => void
}) {
  const markRef = useRef<HTMLElement | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [doc.id, range?.start, range?.end])

  const jumpPage = useCallback((pageIndex: number) => {
    const el = document.getElementById(`corpus-page-${pageIndex}`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

  const quotePage = range ? pageForOffset(doc.page_starts, range.start) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {doc.page_starts && doc.page_starts.length > 1 && (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-hairline px-5 py-2">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <article
          ref={rootRef}
          className="mx-auto max-w-3xl text-[15px] leading-relaxed text-fg"
          onMouseUp={() => {
            const root = rootRef.current
            if (!root) return
            const sel = offsetsFromSelection(root)
            if (sel) onSelection(sel)
          }}
        >
          <HighlightedBody text={doc.text} pageStarts={doc.page_starts} range={range} markRef={markRef} />
        </article>
        <p className="mx-auto mt-4 max-w-3xl text-[11px] text-muted">Markieren → Beleg anlegen (mindestens 20 Zeichen).</p>
      </div>
    </div>
  )
}

function PdfPages({ documentId, initialPage }: { documentId: string; initialPage: number | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [page, setPage] = useState(initialPage && initialPage > 0 ? initialPage : 1)
  const [scale, setScale] = useState(1.15)

  useEffect(() => {
    if (initialPage && initialPage > 0) setPage(initialPage)
  }, [documentId, initialPage])

  useEffect(() => {
    let cancelled = false
    const canvases: HTMLCanvasElement[] = []
    void (async () => {
      setStatus('loading')
      setMessage(null)
      try {
        const bytes = await window.api.readDocumentPdf(documentId)
        if (!bytes || cancelled) {
          if (!cancelled) {
            setStatus('error')
            setMessage('PDF-Datei nicht lesbar.')
          }
          return
        }
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
        const pdf = await task.promise
        if (cancelled) {
          await pdf.destroy()
          return
        }
        setPageCount(pdf.numPages)
        const host = hostRef.current
        if (host) host.replaceChildren()
        for (let n = 1; n <= pdf.numPages; n++) {
          const pg = await pdf.getPage(n)
          const viewport = pg.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.id = `pdf-page-${n}`
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'mx-auto mb-4 block border border-hairline bg-bg'
          canvas.setAttribute('aria-label', `Seite ${n}`)
          const ctx = canvas.getContext('2d')
          if (ctx) await pg.render({ canvasContext: ctx, viewport }).promise
          canvases.push(canvas)
          hostRef.current?.appendChild(canvas)
        }
        await pdf.destroy()
        if (!cancelled) setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setMessage(err instanceof Error ? err.message : String(err))
        }
      }
    })()
    return () => {
      cancelled = true
      for (const c of canvases) c.remove()
    }
  }, [documentId, scale])

  useEffect(() => {
    if (status !== 'ready') return
    const el = document.getElementById(`pdf-page-${page}`)
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [status, page, documentId])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-5 py-2 text-sm">
        <Button
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          title="Vorherige Seite"
          icon="chevron_left"
        />
        <span className="font-mono text-xs text-muted">
          Seite {page}
          {pageCount ? ` / ${pageCount}` : ''}
        </span>
        <Button
          disabled={pageCount > 0 && page >= pageCount}
          onClick={() => setPage((p) => (pageCount ? Math.min(pageCount, p + 1) : p + 1))}
          title="Nächste Seite"
          icon="chevron_right"
        />
        <span className="mx-2 h-4 w-px bg-hairline" />
        <Button onClick={() => setScale((s) => Math.max(0.6, Math.round((s - 0.15) * 100) / 100))} title="Verkleinern">
          −
        </Button>
        <span className="font-mono text-xs text-muted">{Math.round(scale * 100)} %</span>
        <Button onClick={() => setScale((s) => Math.min(2.4, Math.round((s + 0.15) * 100) / 100))} title="Vergrößern">
          +
        </Button>
      </div>
      {status === 'error' && <p className="px-5 py-4 text-sm text-bad">{message ?? 'PDF konnte nicht geöffnet werden.'}</p>}
      {status === 'loading' && <p className="px-5 py-4 text-sm text-muted">PDF wird geladen …</p>}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-auto bg-wash px-4 py-4" />
    </div>
  )
}

function OriginBadge({ origin }: { origin: FetchedDocument['origin'] }) {
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
        {starts.length > 1 && (
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Seite {i + 1}</div>
        )}
        <span className="whitespace-pre-wrap">
          <HighlightedChunk text={chunk} absStart={from} range={range} markRef={markRef} />
        </span>
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
  if (!range) return <TextPiece absStart={absStart} text={text} />
  const localStart = range.start - absStart
  const localEnd = range.end - absStart
  if (localEnd <= 0 || localStart >= text.length) return <TextPiece absStart={absStart} text={text} />
  const a = Math.max(0, localStart)
  const b = Math.min(text.length, localEnd)
  return (
    <>
      <TextPiece absStart={absStart} text={text.slice(0, a)} />
      <TextPiece
        absStart={absStart + a}
        text={text.slice(a, b)}
        mark
        markRef={localStart >= 0 && localStart < text.length ? markRef : undefined}
      />
      <TextPiece absStart={absStart + b} text={text.slice(b)} />
    </>
  )
}

function TextPiece({
  absStart,
  text,
  mark,
  markRef,
}: {
  absStart: number
  text: string
  mark?: boolean
  markRef?: MutableRefObject<HTMLElement | null>
}) {
  if (!text) return null
  if (mark) {
    return (
      <mark
        data-abs-start={absStart}
        ref={(el) => {
          if (markRef) markRef.current = el
        }}
        className="bg-warn-bg px-0.5 font-medium text-fg"
      >
        {text}
      </mark>
    )
  }
  return <span data-abs-start={absStart}>{text}</span>
}

function offsetsFromSelection(root: HTMLElement): { start: number; end: number; quote: string } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const start = absOffset(range.startContainer, range.startOffset)
  const end = absOffset(range.endContainer, range.endOffset)
  if (start == null || end == null) return null
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  if (b - a < 20) return null
  return { start: a, end: b, quote: sel.toString() }
}

function absOffset(node: Node, offset: number): number | null {
  const el =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element).closest('[data-abs-start]')
      : node.parentElement?.closest('[data-abs-start]')
  if (!el) return null
  const base = Number(el.getAttribute('data-abs-start'))
  if (!Number.isFinite(base)) return null
  if (node.nodeType === Node.TEXT_NODE) {
    const spanText = el.textContent ?? ''
    const nodeText = node.textContent ?? ''
    const idx = spanText.indexOf(nodeText)
    return base + (idx >= 0 ? idx : 0) + offset
  }
  return base + offset
}

function CapturePanel({
  reason,
  url,
  busy,
  onBind,
  onNotice,
}: {
  reason: string
  url: string
  busy: boolean
  onBind: (paths: string[]) => Promise<void>
  onNotice: (msg: string | null) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center ${over ? 'ring-2 ring-inset ring-fg' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const paths = [...e.dataTransfer.files]
          .map((f) => (f as File & { path?: string }).path)
          .filter((p): p is string => typeof p === 'string' && p.length > 0)
        if (paths.length === 0) {
          onNotice('Keine Datei erkannt.')
          return
        }
        void onBind(paths)
      }}
    >
      <Badge tone="amber">Capture-Auftrag</Badge>
      <p className="max-w-md text-sm text-fg">Zugang gesperrt ({reason}). URL bleibt — lege die Campus- oder Verlags-PDF hierher.</p>
      <p className="max-w-md truncate text-xs text-muted">{url}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          variant="primary"
          icon="upload_file"
          disabled={busy}
          onClick={() => {
            void (async () => {
              const paths = await window.api.pickCorpusFiles()
              if (paths.length) await onBind(paths)
            })()
          }}
        >
          PDF wählen
        </Button>
        {isHttpUrl(url) && (
          <Button icon="open_in_new" disabled={busy} onClick={() => void window.api.openExternal(url)}>
            Im Browser öffnen
          </Button>
        )}
      </div>
      <p className="max-w-sm text-[11px] text-muted">Download im Systembrowser, dann Datei hierher ziehen oder wählen. Nicht als neue Quelle hochladen.</p>
    </div>
  )
}

function CiteForm({
  quote,
  start,
  end,
  subQuestions,
  busy,
  onCancel,
  onSubmit,
}: {
  quote: string
  start: number
  end: number
  subQuestions: SubQuestion[]
  busy: boolean
  onCancel: () => void
  onSubmit: (fields: { reason: string; extraction: string; contribution: string; subQuestionId: string | null }) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [extraction, setExtraction] = useState('')
  const [contribution, setContribution] = useState('')
  const [subQuestionId, setSubQuestionId] = useState(subQuestions[0]?.id ?? '')
  return (
    <form
      className="shrink-0 space-y-2 border-b border-hairline bg-wash px-5 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit({
          reason: reason.trim(),
          extraction: extraction.trim(),
          contribution: contribution.trim(),
          subQuestionId: subQuestionId || null,
        })
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
        Beleg Zeichen {start}–{end}
      </div>
      <p className="max-h-20 overflow-y-auto text-xs italic text-fg">{quote}</p>
      <textarea className="field w-full text-sm" rows={2} placeholder="Warum diese Stelle? (mind. 20 Zeichen)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <textarea className="field w-full text-sm" rows={2} placeholder="Welches Wissen steht hier? (mind. 20 Zeichen)" value={extraction} onChange={(e) => setExtraction(e.target.value)} />
      <input className="field w-full text-sm" placeholder="Beitrag zum Ergebnis (mind. 10 Zeichen)" value={contribution} onChange={(e) => setContribution(e.target.value)} />
      {subQuestions.length > 0 && (
        <select className="field w-full text-sm" value={subQuestionId} onChange={(e) => setSubQuestionId(e.target.value)}>
          <option value="">Keine Teilfrage</option>
          {subQuestions.map((q) => (
            <option key={q.id} value={q.id}>
              {q.question}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Quelle anlegen
        </Button>
        <Button type="button" onClick={onCancel} disabled={busy}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

function ExcludeForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  return (
    <form
      className="shrink-0 space-y-2 border-b border-hairline bg-wash px-5 py-3"
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit(reason.trim())
      }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Quelle verwerfen</div>
      <textarea className="field w-full text-sm" rows={2} placeholder="Grund (mind. 10 Zeichen)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 10}>
          Ausschließen
        </Button>
        <Button type="button" onClick={onCancel} disabled={busy}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}

export { OriginBadge }
