import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { DocumentOpenInfo, FetchedDocument } from '../../../shared/types'
import { pageForOffset } from '../../../shared/page-offset'
import { Badge, Button, fmtDate } from '../components/ui'

type DocMeta = Omit<FetchedDocument, 'text'>

export default function DocumentReader({
  meta,
  doc,
  range,
  citedBy = 0,
}: {
  meta: DocMeta
  doc: FetchedDocument
  range: { start: number; end: number } | null
  citedBy?: number
}) {
  const [info, setInfo] = useState<DocumentOpenInfo | null>(null)

  useEffect(() => {
    let alive = true
    void window.api.inspectDocument(doc.id).then((next) => {
      if (alive) setInfo(next)
    })
    return () => {
      alive = false
    }
  }, [doc.id, doc.filename])

  const quotePage = range ? pageForOffset(doc.page_starts, range.start) : null
  const kind = info?.kind ?? (doc.origin === 'youtube' ? 'youtube' : 'text')

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
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
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
            {(kind === 'youtube' || kind === 'html' || kind === 'missing') && isHttpUrl(doc.url) && (
              <Button icon="open_in_new" onClick={() => void window.api.openExternal(doc.url)}>
                URL öffnen
              </Button>
            )}
          </div>
        </div>
      </header>
      <ReaderBody kind={kind} info={info} doc={doc} range={range} quotePage={quotePage} />
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
}: {
  kind: DocumentOpenInfo['kind'] | 'text' | 'youtube' | 'html' | 'pdf' | 'missing'
  info: DocumentOpenInfo | null
  doc: FetchedDocument
  range: { start: number; end: number } | null
  quotePage: number | null
}) {
  switch (kind) {
    case 'pdf':
      return <PdfPages documentId={doc.id} initialPage={quotePage} />
    case 'youtube':
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="border-b border-hairline px-5 py-2 text-xs text-muted">
            YouTube-Transkript — kein PDF. Das Video öffnest du über den Link.
          </p>
          <TextBody doc={doc} range={range} />
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
          <TextBody doc={doc} range={range} />
        </div>
      )
    case 'html':
    case 'text':
      return <TextBody doc={doc} range={range} />
    default: {
      const _never: never = kind
      return _never
    }
  }
}

function TextBody({ doc, range }: { doc: FetchedDocument; range: { start: number; end: number } | null }) {
  const markRef = useRef<HTMLElement | null>(null)
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
        <article className="mx-auto max-w-3xl text-[15px] leading-relaxed text-fg">
          <HighlightedBody text={doc.text} pageStarts={doc.page_starts} range={range} markRef={markRef} />
        </article>
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

export { OriginBadge }
