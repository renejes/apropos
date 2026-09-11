import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DeskFolder, DeskPile } from '../../../../shared/desk'
import { buildDeskFolders, findDeskFolder } from '../../../../shared/desk'
import type { FetchedDocument, ProjectState } from '../../../../shared/types'
import { Badge, Button, EmptyState, Icon, quoteBadge, statusBadge } from '../../components/ui'
import DocumentReader from '../DocumentReader'

export type DeskFocus = { sourceId?: string | null; documentId?: string | null; start?: number; end?: number }

const FILTERS: Array<{ id: DeskPile | 'all'; label: string }> = [
  { id: 'all', label: 'Alle' },
  { id: 'open', label: 'Offen' },
  { id: 'accepted', label: 'Übernommen' },
  { id: 'rejected', label: 'Abgelehnt' },
]

function pileBadge(pile: DeskPile) {
  switch (pile) {
    case 'open':
      return <Badge tone="amber">offen</Badge>
    case 'accepted':
      return <Badge tone="emerald">übernommen</Badge>
    case 'rejected':
      return <Badge tone="red">abgelehnt</Badge>
    default: {
      const _never: never = pile
      return _never
    }
  }
}

function pileIcon(pile: DeskPile): string {
  switch (pile) {
    case 'open':
      return 'folder'
    case 'accepted':
      return 'folder_special'
    case 'rejected':
      return 'folder_off'
    default: {
      const _never: never = pile
      return _never
    }
  }
}

export default function DeskTab({
  state,
  onReload,
  focus,
  onFocusConsumed,
}: {
  state: ProjectState
  onReload: () => void
  focus?: DeskFocus | null
  onFocusConsumed?: () => void
}) {
  const folders = useMemo(() => buildDeskFolders(state), [state])
  const [filter, setFilter] = useState<DeskPile | 'all'>('open')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)

  useEffect(() => {
    if (!focus?.sourceId && !focus?.documentId) return
    const hit = findDeskFolder(folders, focus)
    if (hit) {
      setSelectedId(hit.id)
      setFilter('all')
      if (focus.start != null && focus.end != null && focus.start !== focus.end) {
        setRange({ start: focus.start, end: focus.end })
      } else {
        setRange(null)
      }
    }
    onFocusConsumed?.()
  }, [focus, folders, onFocusConsumed])

  const counts = useMemo(() => {
    const c = { open: 0, accepted: 0, rejected: 0 }
    for (const f of folders) c[f.pile] += 1
    return c
  }, [folders])

  const visible = filter === 'all' ? folders : folders.filter((f) => f.pile === filter)
  const selected = folders.find((f) => f.id === selectedId) ?? null

  if (folders.length === 0) {
    return (
      <EmptyState
        icon="folder_open"
        title="Noch keine Ordner"
        hint="Nach dem Briefing sucht der Agent und legt Treffer hier ab. Du öffnest die Akte und übernimmst oder lehnst ab."
      />
    )
  }

  if (selected) {
    return (
      <FolderOpen
        folder={selected}
        state={state}
        range={range}
        onBack={() => {
          setSelectedId(null)
          setRange(null)
        }}
        onReload={onReload}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-5 py-3">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-sm ${
              filter === f.id ? 'border-line bg-fg text-bg' : 'border-hairline text-muted hover:text-fg'
            }`}
          >
            {f.label}
            {f.id !== 'all' && counts[f.id] > 0 && <Badge tone={f.id === 'open' ? 'amber' : 'slate'}>{counts[f.id]}</Badge>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {visible.length === 0 ? (
          <EmptyState icon="folder" title="Keine Ordner in diesem Filter" hint="Wechsle den Filter oben, oder warte bis der Agent neue Treffer legt." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {visible.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  setSelectedId(folder.id)
                  setRange(null)
                }}
                className="border border-hairline bg-bg p-4 text-left hover:bg-wash"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Icon name={pileIcon(folder.pile)} className="!text-[22px] text-muted" />
                  {pileBadge(folder.pile)}
                </div>
                <div className="text-sm font-medium leading-snug">{folder.title}</div>
                <div className="mt-1 truncate text-xs text-muted">
                  {folder.year ? `${folder.year} · ` : ''}
                  {folder.origin}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FolderOpen({
  folder,
  state,
  range,
  onBack,
  onReload,
}: {
  folder: DeskFolder
  state: ProjectState
  range: { start: number; end: number } | null
  onBack: () => void
  onReload: () => void
}) {
  const source = folder.source
  const candidate = folder.candidate
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [full, setFull] = useState<FetchedDocument | null>(null)
  const meta = folder.documentId ? state.documents.find((d) => d.id === folder.documentId) ?? null : null

  useEffect(() => {
    if (!folder.documentId) {
      setFull(null)
      return
    }
    let alive = true
    void window.api.getDocument(folder.documentId).then((doc) => {
      if (alive) setFull(doc)
    })
    return () => {
      alive = false
    }
  }, [folder.documentId, state.documents])

  const sign = async (verdict: 'human_signed' | 'rejected') => {
    if (!source) return
    setBusy(true)
    try {
      await window.api.signSource(source.id, verdict, note.trim() || null)
      setNote('')
      onReload()
    } finally {
      setBusy(false)
    }
  }

  const rejectScreening = async () => {
    if (!candidate) return
    const reason = note.trim() || 'Passt nicht zum gewählten Blickwinkel.'
    setBusy(true)
    try {
      await window.api.excludeScreening(candidate.id, reason)
      setNote('')
      onReload()
      onBack()
    } finally {
      setBusy(false)
    }
  }

  const rejectDocument = async () => {
    if (!folder.documentId || source) return
    const reason = note.trim() || 'Passt nicht zum gewählten Blickwinkel.'
    setBusy(true)
    try {
      await window.api.excludeSourceFromReader({ projectId: state.project.id, documentId: folder.documentId, reason })
      setNote('')
      onReload()
      onBack()
    } finally {
      setBusy(false)
    }
  }

  const flags = source ? state.uncertaintyFlags.filter((f) => f.entity_type === 'source' && f.entity_id === source.id) : []
  const carrier = source?.carrier_id ? state.carriers.find((c) => c.id === source.carrier_id) : undefined
  const profile = source?.carrier_id ? state.carrierProfiles.find((p) => p.carrier_id === source.carrier_id) : undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
        <Button variant="ghost" icon="arrow_back" onClick={onBack} title="Zurück zum Tisch">
          Tisch
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{folder.title}</h2>
        {pileBadge(folder.pile)}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[min(380px,42%)] shrink-0 flex-col overflow-y-auto border-r border-hairline p-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {source && statusBadge(source.review_status)}
            {source && quoteBadge(source.quote_verified, source.quote_match_score)}
            {folder.year && <Badge tone="slate">{folder.year}</Badge>}
          </div>
          <Field label="Woher">
            <a href={source?.url ?? candidate?.url ?? folder.origin} target="_blank" rel="noreferrer" className="break-all underline decoration-dotted">
              {source?.url ?? candidate?.url ?? folder.origin}
            </a>
          </Field>
          {source && (
            <>
              <Field label="Warum relevant">{source.reason}</Field>
              <Field label="Einschätzung">{source.extraction}</Field>
              <Field label="Beitrag">{source.contribution}</Field>
              {carrier && (
                <Field label="Träger">
                  {`${carrier.display_name || carrier.registrable_domain} · ${carrier.carrier_kind}`}
                  {profile ? ` — ${profile.interpretation}${profile.uncertainty ? ` (${profile.uncertainty})` : ''}` : ''}
                </Field>
              )}
              {source.verbatim_quote && (
                <Field label="Beleg">
                  <blockquote className="border-l-4 border-line bg-wash p-3 text-[13px] italic">„{source.verbatim_quote}“</blockquote>
                </Field>
              )}
            </>
          )}
          {!source && candidate?.abstract && <Field label="Abstract">{candidate.abstract}</Field>}
          {!source && !candidate && (
            <p className="text-sm text-muted">Volltext liegt vor. Die KI-Anmerkung kommt, sobald der Agent den Ordner mit add_source füllt.</p>
          )}
          {flags.length > 0 && (
            <Field label="Unsicherheit">
              {flags.map((f) => (
                <div key={f.id} className="text-xs text-warn">
                  {f.uncertainty_reason}
                </div>
              ))}
            </Field>
          )}

          <div className="mt-auto border-t border-hairline pt-4">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optionale Notiz …"
              className="field mb-2 w-full text-sm"
            />
            {source ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  icon="verified"
                  onClick={() => void sign('human_signed')}
                  disabled={busy || source.review_status === 'human_signed'}
                >
                  Übernehmen
                </Button>
                <Button
                  variant="danger"
                  icon="block"
                  onClick={() => void sign('rejected')}
                  disabled={busy || source.review_status === 'rejected'}
                >
                  Ablehnen
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[11px] leading-relaxed text-muted">
                  Übernehmen geht, sobald der Agent den Ordner als Quelle angelegt hat. Ablehnen legt ihn weg.
                </p>
                <Button
                  variant="danger"
                  icon="block"
                  onClick={() => void (candidate ? rejectScreening() : rejectDocument())}
                  disabled={busy || (!candidate && !folder.documentId)}
                >
                  Ablehnen
                </Button>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-muted">Nur du setzt Übernehmen — die KI kann das nicht.</p>
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {meta && full ? (
            <DocumentReader
              meta={meta}
              doc={full}
              range={range}
              citedBy={state.sources.filter((s) => s.document_id === meta.id).length}
              projectId={state.project.id}
              subQuestions={state.subQuestions}
              onChanged={onReload}
            />
          ) : folder.documentId ? (
            <div className="flex flex-1 items-center justify-center font-mono text-xs text-muted">lädt …</div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted">
              Noch kein Volltext. Abstracts allein sind kein Ordner-Inhalt — der Agent holt den Text, bevor du übernimmst.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3 text-sm">
      <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="leading-relaxed">{children}</div>
    </div>
  )
}
