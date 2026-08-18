import { useEffect, useMemo, useState } from 'react'
import type { DocumentExcerpt, ProjectState, Source } from '../../../../shared/types'
import { Badge, Button, Card, EmptyState, Icon, SectionTitle, fmtDate, quoteBadge, statusBadge } from '../../components/ui'

/**
 * Kern der Review-UI: Quellenliste mit Status + Detail-Drawer mit
 * menschlichem Sign-off (Ebene 5 der Verifikations-Leiter).
 */
export default function SourcesTab({
  state,
  onReload,
  focusSourceId,
  onFocusConsumed,
}: {
  state: ProjectState
  onReload: () => void
  focusSourceId?: string | null
  onFocusConsumed?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'pending' | 'problems' | 'unassigned'>('all')
  const [query, setQuery] = useState('')
  const [ftsIds, setFtsIds] = useState<Set<string> | null>(null)

  // Sprung aus dem Aussagen-Tab: Quelle direkt öffnen (Filter zurücksetzen)
  useEffect(() => {
    if (focusSourceId) {
      setSelectedId(focusSourceId)
      setFilter('all')
      setQuery('')
      onFocusConsumed?.()
    }
  }, [focusSourceId, onFocusConsumed])

  // Review-Finding: FTS5-Volltextsuche nutzen (debounced) statt naiver Substring-Filterung
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setFtsIds(null)
      return
    }
    const t = setTimeout(() => {
      void window.api.searchSources(state.project.id, q).then((hits) => setFtsIds(new Set(hits.map((h) => h.id))))
    }, 250)
    return () => clearTimeout(t)
  }, [query, state.project.id])

  const sources = useMemo(() => {
    let list = state.sources
    if (filter === 'pending') list = list.filter((s) => s.review_status === 'pending' || s.review_status === 'ai_checked')
    if (filter === 'problems') list = list.filter((s) => s.quote_verified === 0 || s.url_resolved === 0)
    if (filter === 'unassigned') list = list.filter((s) => !s.sub_question_id && s.review_status !== 'rejected')
    if (query.trim() && ftsIds) {
      // FTS-Treffer + URL-Substring (URLs sind nicht im FTS-Index)
      const q = query.toLowerCase()
      list = list.filter((s) => ftsIds.has(s.id) || s.url.toLowerCase().includes(q))
    }
    return list
  }, [state.sources, filter, query, ftsIds])

  const selected = state.sources.find((s) => s.id === selectedId) ?? null

  if (state.sources.length === 0) {
    return (
      <EmptyState
        icon="link_off"
        title="Noch keine Quellen erfasst"
        hint="Verbinde deine KI mit dem MCP-Server und lass sie mit add_source Quellen samt Begründung, Extraktion und wörtlichem Beleg eintragen."
      />
    )
  }

  return (
    <div className="flex h-full gap-4">
      {/* Liste */}
      <div className={`${selected ? 'w-1/2' : 'w-full'} min-w-0 transition-all`}>
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Icon name="search" className="icon-sm absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Quellen durchsuchen …"
              className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-(--color-accent-600) focus:outline-none"
            />
          </div>
          {(
            [
              ['all', 'Alle'],
              ['pending', 'Zu reviewen'],
              ['problems', 'Probleme'],
              ['unassigned', 'Ohne Teilfrage'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                filter === value ? 'bg-(--color-accent-600) font-medium text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {sources.map((s, i) => (
            <Card
              key={s.id}
              className={`cursor-pointer p-3 transition-shadow hover:shadow ${selectedId === s.id ? 'ring-2 ring-(--color-accent-600)' : ''}`}
            >
              <button className="w-full text-left" onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    <span className="mr-1.5 text-xs text-slate-400">[S{state.sources.indexOf(s) + 1}]</span>
                    {s.title}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {quoteBadge(s.quote_verified, s.quote_match_score)}
                    {statusBadge(s.review_status)}
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{s.extraction}</p>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="truncate">{s.url}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {s.document_id && (
                    <Badge tone="emerald" icon="anchor">
                      Offset-Beleg
                    </Badge>
                  )}
                  {state.subQuestions.length > 0 &&
                    (s.sub_question_id ? (
                      <Badge tone="slate" icon="checklist">
                        {state.subQuestions.find((q) => q.id === s.sub_question_id)?.question.slice(0, 48) ?? 'Teilfrage'}
                      </Badge>
                    ) : (
                      s.review_status !== 'rejected' && (
                        <Badge tone="amber" icon="link_off">
                          ohne Teilfrage
                        </Badge>
                      )
                    ))}
                </div>
              </button>
            </Card>
          ))}
          {sources.length === 0 && <EmptyState icon="filter_alt_off" title="Keine Treffer für diesen Filter" />}
        </div>
      </div>

      {/* Detail-Drawer — key erzwingt State-Reset beim Quellenwechsel (Review-Finding) */}
      {selected && <SourceDetail key={selected.id} source={selected} state={state} onClose={() => setSelectedId(null)} onReload={onReload} />}
    </div>
  )
}

function SourceDetail({ source: s, state, onClose, onReload }: { source: Source; state: ProjectState; onClose: () => void; onReload: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const reviews = state.reviews.filter((r) => r.entity_type === 'source' && r.entity_id === s.id)
  const extractions = state.extractions.filter((e) => e.source_id === s.id)
  const flags = state.uncertaintyFlags.filter((f) => f.entity_type === 'source' && f.entity_id === s.id)

  const sign = async (verdict: 'human_signed' | 'rejected') => {
    setBusy(true)
    try {
      await window.api.signSource(s.id, verdict, note.trim() || null)
      setNote('')
      onReload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="flex w-1/2 min-w-0 flex-col overflow-y-auto p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold leading-snug">{s.title}</h2>
        <Button variant="ghost" icon="close" onClick={onClose} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {statusBadge(s.review_status)}
        {quoteBadge(s.quote_verified, s.quote_match_score)}
        {s.url_resolved === 1 && (
          <Badge tone="emerald" icon="public">
            URL ok
          </Badge>
        )}
        {s.url_resolved === 0 && (
          <Badge tone="red" icon="public_off">
            URL tot
          </Badge>
        )}
        {s.confidence && <Badge tone="slate">KI-Konfidenz: {s.confidence}</Badge>}
      </div>

      <div className="space-y-4 text-sm">
        <Field label="URL">
          <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-(--color-accent-700) underline decoration-dotted">
            {s.url}
          </a>
          <span className="ml-2 text-xs text-slate-400">
            Zugriff {fmtDate(s.accessed_at)} · {s.retrieval_method} · von {s.created_by}
          </span>
        </Field>
        <Field label="Warum diese Quelle (KI-Angabe, zu verifizieren)">{s.reason}</Field>
        <Field label="Extraktion">{s.extraction}</Field>
        <Field label="Beitrag zum Ergebnis">{s.contribution}</Field>
        <Field label="Teilfrage">
          <select
            value={s.sub_question_id ?? ''}
            onChange={async (e) => {
              await window.api.assignSource(s.id, e.target.value || null)
              onReload()
            }}
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-(--color-accent-600) focus:outline-none"
          >
            <option value="">— nicht zugeordnet (zählt bei keiner Teilfrage) —</option>
            {state.subQuestions
              .filter((sq) => sq.status !== 'dropped')
              .map((sq) => (
                <option key={sq.id} value={sq.id}>
                  {sq.question}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Wörtlicher Beleg">
          <blockquote
            className={`rounded-lg border-l-4 p-3 text-[13px] italic ${
              s.quote_verified === 1
                ? 'border-emerald-400 bg-emerald-50/60'
                : s.quote_verified === 0
                  ? 'border-red-400 bg-red-50/60'
                  : 'border-slate-300 bg-slate-50'
            }`}
          >
            „{s.verbatim_quote}“
            {s.quote_locator && <div className="mt-1 text-[11px] not-italic text-slate-400">Fundstelle: {s.quote_locator}</div>}
          </blockquote>
          {s.document_id && s.quote_start != null && s.quote_end != null && (
            <QuoteInContext documentId={s.document_id} start={s.quote_start} end={s.quote_end} />
          )}
        </Field>

        {extractions.length > 0 && (
          <Field label={`Weitere Extraktionen (${extractions.length})`}>
            <ul className="space-y-2">
              {extractions.map((e) => (
                <li key={e.id} className="rounded-lg bg-slate-50 p-2 text-xs">
                  <div className="font-medium text-slate-700">{e.extracted_fact}</div>
                  <div className="mt-1 italic text-slate-500">„{e.verbatim_quote}“</div>
                </li>
              ))}
            </ul>
          </Field>
        )}

        {flags.length > 0 && (
          <Field label="Unsicherheits-Flags">
            {flags.map((f) => (
              <div key={f.id} className="mb-1 flex items-start gap-1.5 text-xs text-violet-700">
                <Icon name="flag" className="!text-[14px] mt-0.5" />
                {f.uncertainty_reason}
              </div>
            ))}
          </Field>
        )}

        {reviews.length > 0 && (
          <Field label="Verifikations-Historie">
            <ul className="space-y-1.5">
              {reviews.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-xs">
                  <Icon
                    name={r.reviewer_type === 'human' ? 'person' : r.reviewer_type === 'deterministic' ? 'rule' : 'neurology'}
                    className="!text-[15px] mt-0.5 text-slate-400"
                  />
                  <div>
                    <span className="font-medium">{r.verdict}</span>
                    <span className="text-slate-400"> · {r.reviewer_id} · {fmtDate(r.created_at)}</span>
                    {r.note && <div className="text-slate-500">{r.note}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </Field>
        )}
      </div>

      {/* Sign-off */}
      <div className="mt-5 border-t border-slate-200 pt-4">
        <SectionTitle>Menschlicher Sign-off</SectionTitle>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optionale Notiz zur Entscheidung …"
          className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-(--color-accent-600) focus:outline-none"
        />
        <div className="flex gap-2">
          <Button variant="primary" icon="verified" onClick={() => sign('human_signed')} disabled={busy || s.review_status === 'human_signed'}>
            Freigeben
          </Button>
          <Button variant="danger" icon="block" onClick={() => sign('rejected')} disabled={busy || s.review_status === 'rejected'}>
            Ablehnen
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          Der Sign-off ist nur hier in der App möglich — keine KI kann ihn über MCP setzen. Deine Entscheidung wird als Review-Kante im
          Audit-Trail protokolliert.
        </p>
      </div>
    </Card>
  )
}

/**
 * Belegstelle im Originaltext, den die App SELBST abgerufen hat.
 * Das ist der schnellste denkbare Sign-off: der Mensch sieht die Fundstelle im
 * Kontext, statt die URL zu öffnen und den Satz zu suchen. Und weil der Text
 * gespeichert ist, gilt das auch dann noch, wenn sich die Seite später ändert.
 */
function QuoteInContext({ documentId, start, end }: { documentId: string; start: number; end: number }) {
  const [ex, setEx] = useState<DocumentExcerpt | null>(null)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let alive = true
    void window.api
      .getExcerpt(documentId, start, end)
      .then((e) => alive && (e ? setEx(e) : setErr(true)))
      .catch(() => alive && setErr(true))
    return () => {
      alive = false
    }
  }, [documentId, start, end])

  if (err) return <div className="mt-2 text-xs text-slate-400">Originaltext nicht mehr verfügbar.</div>
  if (!ex) return null

  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs text-(--color-accent-700) hover:underline">
        <Icon name={open ? 'expand_less' : 'expand_more'} className="!text-[16px]" />
        {open ? 'Originaltext ausblenden' : 'Im Originaltext anzeigen'}
        <Badge tone="emerald" icon="anchor">
          Position {start}–{end}
        </Badge>
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
            Abgerufen {fmtDate(ex.fetched_at)} · {ex.char_len.toLocaleString('de-DE')} Zeichen · Hash {ex.content_hash}
          </div>
          <div className="max-h-72 overflow-y-auto p-3 text-[13px] leading-relaxed text-slate-600">
            {ex.truncated_start && <span className="text-slate-300">… </span>}
            <span>{ex.before}</span>
            <mark className="rounded bg-amber-200/70 px-0.5 font-medium text-slate-900">{ex.quote}</mark>
            <span>{ex.after}</span>
            {ex.truncated_end && <span className="text-slate-300"> …</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="text-slate-700">{children}</div>
    </div>
  )
}
