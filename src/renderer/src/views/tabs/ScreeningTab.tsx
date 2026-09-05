import { useMemo, useState } from 'react'
import type { ProjectState, ScreeningCandidate, ScreeningStatus } from '../../../../shared/types'
import { Badge, Button, EmptyState } from '../../components/ui'

const FILTERS: Array<{ id: ScreeningStatus | 'open' | 'all'; label: string }> = [
  { id: 'open', label: 'Offen' },
  { id: 'undecided', label: 'Ungesehen' },
  { id: 'maybe', label: 'Unsicher' },
  { id: 'included', label: 'Rein' },
  { id: 'excluded', label: 'Raus' },
  { id: 'all', label: 'Alle' },
]

export default function ScreeningTab({
  state,
  onReload,
  onOpenDocument,
}: {
  state: ProjectState
  onReload: () => void
  onOpenDocument: (documentId: string) => void
}) {
  const [filter, setFilter] = useState<ScreeningStatus | 'open' | 'all'>('open')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [excludeId, setExcludeId] = useState<string | null>(null)
  const [excludeReason, setExcludeReason] = useState('')
  const [openAbstract, setOpenAbstract] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c = { undecided: 0, maybe: 0, included: 0, excluded: 0, open: 0 }
    for (const row of state.screeningCandidates) {
      c[row.status] += 1
      if (row.status === 'undecided' || row.status === 'maybe') c.open += 1
    }
    return c
  }, [state.screeningCandidates])

  const rows = useMemo(() => {
    let list = state.screeningCandidates
    if (filter === 'open') list = list.filter((r) => r.status === 'undecided' || r.status === 'maybe')
    else if (filter !== 'all') list = list.filter((r) => r.status === filter)
    return [...list].sort((a, b) => {
      const tri = (x: ScreeningCandidate) => (x.found_via.length > 1 ? 1 : 0)
      const t = tri(b) - tri(a)
      if (t !== 0) return t
      return (b.cited_by_count ?? -1) - (a.cited_by_count ?? -1)
    })
  }, [state.screeningCandidates, filter])

  const byQuery = useMemo(() => {
    const groups = new Map<string, ScreeningCandidate[]>()
    for (const row of rows) {
      const key = row.query?.trim() || 'Ohne Query'
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
    }
    return [...groups.entries()]
  }, [rows])

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id)
    setNotice(null)
    try {
      await fn()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      onReload()
      setBusyId(null)
    }
  }

  if (state.screeningCandidates.length === 0) {
    return (
      <EmptyState
        icon="table_rows"
        title="Sichtungstisch ist leer"
        hint="Nach search_literature liegen die Treffer hier. Du sagst Rein, Raus oder Unsicher — erst dann holt die App den Volltext."
      />
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`border px-2.5 py-1 text-xs ${filter === f.id ? 'border-line bg-fg text-bg' : 'border-hairline text-muted hover:text-fg'}`}
          >
            {f.label}
            {f.id === 'open' && counts.open > 0 && <span className="ml-1">{counts.open}</span>}
          </button>
        ))}
      </div>
      {notice && <p className="mb-3 text-sm text-bad">{notice}</p>}
      {byQuery.map(([query, items]) => (
        <section key={query} className="mb-6">
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted">
            {query}
            <span className="ml-2 font-sans normal-case tracking-normal">{items.length}</span>
          </h3>
          <div className="space-y-2">
            {items.map((row) => (
              <ScreeningCard
                key={row.id}
                row={row}
                busy={busyId === row.id}
                excludeOpen={excludeId === row.id}
                excludeReason={excludeId === row.id ? excludeReason : ''}
                abstractOpen={openAbstract === row.id}
                onToggleAbstract={() => setOpenAbstract((cur) => (cur === row.id ? null : row.id))}
                onExcludeOpen={() => {
                  setExcludeId(row.id)
                  setExcludeReason('')
                }}
                onExcludeCancel={() => setExcludeId(null)}
                onExcludeReason={setExcludeReason}
                onInclude={() =>
                  void run(row.id, async () => {
                    const res = await window.api.includeScreening(row.id)
                    if (res.fetch.document_id) onOpenDocument(res.fetch.document_id)
                  })
                }
                onMaybe={() => void run(row.id, async () => { await window.api.maybeScreening(row.id) })}
                onExclude={() =>
                  void run(row.id, async () => {
                    await window.api.excludeScreening(row.id, excludeReason)
                    setExcludeId(null)
                  })
                }
                onOpenDoc={() => {
                  if (row.document_id) onOpenDocument(row.document_id)
                }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ScreeningCard({
  row,
  busy,
  excludeOpen,
  excludeReason,
  abstractOpen,
  onToggleAbstract,
  onExcludeOpen,
  onExcludeCancel,
  onExcludeReason,
  onInclude,
  onMaybe,
  onExclude,
  onOpenDoc,
}: {
  row: ScreeningCandidate
  busy: boolean
  excludeOpen: boolean
  excludeReason: string
  abstractOpen: boolean
  onToggleAbstract: () => void
  onExcludeOpen: () => void
  onExcludeCancel: () => void
  onExcludeReason: (v: string) => void
  onInclude: () => void
  onMaybe: () => void
  onExclude: () => void
  onOpenDoc: () => void
}) {
  const decided = row.status === 'included' || row.status === 'excluded'
  const inCorpus = row.status === 'included' && Boolean(row.document_id)
  const canInclude = row.status !== 'excluded' && !row.document_id
  const canExclude = row.status !== 'excluded' && !row.document_id
  return (
    <article className={`border border-hairline p-3 ${inCorpus || row.status === 'excluded' ? 'opacity-60' : 'bg-bg'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{row.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {row.authors.slice(0, 3).join(', ')}
            {row.authors.length > 3 && ' u. a.'}
            {row.year != null && <span>{row.year}</span>}
            {row.venue && <span className="truncate">{row.venue}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <StatusBadge status={row.status} />
            {row.found_via.length > 1 && <Badge tone="emerald">{row.found_via.length} Register</Badge>}
            {row.found_via.length === 1 && <Badge tone="slate">{row.found_via[0]}</Badge>}
            {row.is_open_access && <Badge tone="sky">OA</Badge>}
            {row.cited_by_count != null && row.cited_by_count > 0 && (
              <span className="text-[11px] text-muted">{row.cited_by_count.toLocaleString('de-DE')} Zit.</span>
            )}
            {row.doi && <span className="font-mono text-[11px] text-muted">{row.doi}</span>}
          </div>
        </div>
      </div>
      {row.abstract && (
        <button type="button" className="mt-2 text-left text-xs text-muted hover:text-fg" onClick={onToggleAbstract}>
          {abstractOpen ? row.abstract : `${row.abstract.slice(0, 220)}${row.abstract.length > 220 ? '…' : ''}`}
        </button>
      )}
      {row.decision_reason && row.status === 'excluded' && (
        <p className="mt-2 text-xs text-muted">{row.decision_reason}</p>
      )}
      {row.status === 'included' && !row.document_id && (
        <p className="mt-2 text-xs text-muted">Volltext noch nicht im Korpus — Rein holt ihn erneut.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {canInclude && (
          <Button variant="primary" disabled={busy} onClick={onInclude}>
            Rein
          </Button>
        )}
        {!decided && (
          <Button disabled={busy || row.status === 'maybe'} onClick={onMaybe}>
            Unsicher
          </Button>
        )}
        {canExclude && (
          <Button variant="danger" disabled={busy} onClick={onExcludeOpen}>
            Raus
          </Button>
        )}
        {inCorpus && (
          <Button icon="menu_book" onClick={onOpenDoc}>
            Im Korpus
          </Button>
        )}
        <Button
          icon="open_in_new"
          disabled={busy}
          onClick={() => void window.api.openExternal(row.oa_url || row.url)}
        >
          Ansehen
        </Button>
      </div>
      {excludeOpen && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            onExclude()
          }}
        >
          <textarea
            className="field w-full text-sm"
            rows={2}
            placeholder="Warum raus? (mind. 10 Zeichen — Plan, Duplikat, Sprache, Qualität)"
            value={excludeReason}
            onChange={(e) => onExcludeReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={busy || excludeReason.trim().length < 10}>
              Ausschließen
            </Button>
            <Button type="button" onClick={onExcludeCancel} disabled={busy}>
              Abbrechen
            </Button>
          </div>
        </form>
      )}
    </article>
  )
}

function StatusBadge({ status }: { status: ScreeningStatus }) {
  switch (status) {
    case 'undecided':
      return <Badge tone="amber">offen</Badge>
    case 'maybe':
      return <Badge tone="slate">unsicher</Badge>
    case 'included':
      return <Badge tone="emerald">rein</Badge>
    case 'excluded':
      return <Badge tone="red">raus</Badge>
    default: {
      const _never: never = status
      return _never
    }
  }
}
