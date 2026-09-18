import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DeskFolder, DeskPile, DeskSurface } from '../../../../shared/desk'
import { buildAgentDeskFolders, buildHumanDeskFolders, findDeskFolder } from '../../../../shared/desk'
import type { BibEntryType, BiblioSuggestion, FetchedDocument, ProjectState, Source } from '../../../../shared/types'
import { Badge, Button, EmptyState, Icon, quoteBadge, statusBadge } from '../../components/ui'
import DocumentReader from '../DocumentReader'

export type DeskFocus = { sourceId?: string | null; documentId?: string | null; start?: number; end?: number }

const HUMAN_FILTERS: Array<{ id: DeskPile | 'all'; label: string }> = [
  { id: 'all', label: 'Alle' },
  { id: 'open', label: 'Offen' },
  { id: 'accepted', label: 'Übernommen' },
  { id: 'rejected', label: 'Abgelehnt' },
]

const AGENT_FILTERS: Array<{ id: DeskPile | 'all'; label: string }> = [
  { id: 'all', label: 'Alle' },
  { id: 'open', label: 'In Arbeit' },
  { id: 'rejected', label: 'Abgelegt' },
]

function pileBadge(pile: DeskPile, surface: DeskSurface) {
  if (surface === 'agent') {
    switch (pile) {
      case 'open':
        return <Badge tone="amber">in Arbeit</Badge>
      case 'accepted':
        return <Badge tone="emerald">Quelle</Badge>
      case 'rejected':
        return <Badge tone="slate">abgelegt</Badge>
      default: {
        const _never: never = pile
        return _never
      }
    }
  }
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

function entryTypeLabel(type: BibEntryType | string | null | undefined): string {
  switch (type) {
    case 'article':
      return 'Artikel'
    case 'book':
      return 'Buch'
    case 'inproceedings':
      return 'Tagungsbeitrag'
    case 'misc':
      return 'Sonstiges'
    default:
      return type?.trim() ? type : 'noch offen'
  }
}

function pendingBiblio(state: ProjectState, sourceId: string | undefined): BiblioSuggestion | undefined {
  if (!sourceId) return undefined
  return state.biblio_suggestions.find((s) => s.source_id === sourceId && s.status === 'pending')
}

function authorsLine(authors: string[] | null | undefined): string | null {
  if (!authors?.length) return null
  return authors.join(', ')
}

function sourceAuthors(source: Source): string | null {
  if (!source.authors_json) return null
  try {
    const parsed = JSON.parse(source.authors_json) as unknown
    return Array.isArray(parsed) ? authorsLine(parsed.filter((x): x is string => typeof x === 'string')) : null
  } catch {
    return null
  }
}

export default function DeskTab({
  state,
  surface,
  onReload,
  focus,
  onFocusConsumed,
}: {
  state: ProjectState
  surface: DeskSurface
  onReload: () => void
  focus?: DeskFocus | null
  onFocusConsumed?: () => void
}) {
  const folders = useMemo(
    () => (surface === 'human' ? buildHumanDeskFolders(state) : buildAgentDeskFolders(state)),
    [state, surface]
  )
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

  const filters = surface === 'human' ? HUMAN_FILTERS : AGENT_FILTERS
  const visible = filter === 'all' ? folders : folders.filter((f) => f.pile === filter)
  const selected = folders.find((f) => f.id === selectedId) ?? null
  const backLabel = surface === 'human' ? 'Human Desk' : 'Agent-Desk'

  if (folders.length === 0) {
    return surface === 'human' ? (
      <EmptyState
        icon="folder_special"
        title="Noch keine Akten"
        hint="Sobald der Agent eine Quelle anlegt, erscheint sie hier. Nur dieser Tisch ist zum Übernehmen da."
      />
    ) : (
      <EmptyState
        icon="visibility"
        title="Die KI arbeitet noch nicht sichtbar"
        hint="Suchtreffer und gelesene Texte ohne Quelle liegen hier, während die KI sucht. Was du prüfen sollst, liegt auf dem Human Desk."
      />
    )
  }

  if (selected) {
    return (
      <FolderOpen
        folder={selected}
        surface={surface}
        state={state}
        range={range}
        backLabel={backLabel}
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
        {filters.map((f) => (
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
        {surface === 'human' && state.sources.some((s) => s.review_status === 'human_signed') && (
          <span className="ml-auto">
            <Button
              title="BibTeX nur aus übernommenen Quellen"
              onClick={() => void window.api.exportBibliography(state.project.id)}
            >
              BibTeX
            </Button>
          </span>
        )}
      </div>
      {surface === 'agent' && (
        <p className="shrink-0 border-b border-hairline px-5 py-2 text-[12px] leading-relaxed text-muted">
          Nur zum Zuschauen, während die KI sucht und liest. Übernehmen passiert auf dem Human Desk.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {visible.length === 0 ? (
          <EmptyState
            icon="folder"
            title="Keine Ordner in diesem Filter"
            hint={surface === 'human' ? 'Wechsle den Filter oben, oder warte bis der Agent eine Quelle anlegt.' : 'Wechsle den Filter oben, oder warte bis die KI neue Treffer legt.'}
          />
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
                  <div className="flex flex-wrap justify-end gap-1">
                    {surface === 'agent' && (
                      <Badge tone="slate">{folder.documentId ? 'gelesen' : 'Treffer'}</Badge>
                    )}
                    {pendingBiblio(state, folder.source?.id) && <Badge tone="sky">DOI-Vorschlag</Badge>}
                    {pileBadge(folder.pile, surface)}
                  </div>
                </div>
                <div className="text-sm font-medium leading-snug">{folder.title}</div>
                <div className="mt-1 truncate text-xs text-muted">
                  {folder.source?.citekey ? `${folder.source.citekey} · ` : ''}
                  {folder.source?.entry_type ? `${entryTypeLabel(folder.source.entry_type)} · ` : ''}
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
  surface,
  state,
  range,
  backLabel,
  onBack,
  onReload,
}: {
  folder: DeskFolder
  surface: DeskSurface
  state: ProjectState
  range: { start: number; end: number } | null
  backLabel: string
  onBack: () => void
  onReload: () => void
}) {
  const source = folder.source
  const candidate = folder.candidate
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [full, setFull] = useState<FetchedDocument | null>(null)
  const [biblioBusy, setBiblioBusy] = useState(false)
  const [biblioError, setBiblioError] = useState<string | null>(null)
  const meta = folder.documentId ? state.documents.find((d) => d.id === folder.documentId) ?? null : null
  const watchOnly = surface === 'agent'

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

  const flags = source ? state.uncertaintyFlags.filter((f) => f.entity_type === 'source' && f.entity_id === source.id) : []
  const carrier = source?.carrier_id ? state.carriers.find((c) => c.id === source.carrier_id) : undefined
  const profile = source?.carrier_id ? state.carrierProfiles.find((p) => p.carrier_id === source.carrier_id) : undefined
  const suggestion = pendingBiblio(state, source?.id)

  const decideBiblio = async (verdict: 'accept' | 'reject') => {
    if (!suggestion) return
    setBiblioBusy(true)
    setBiblioError(null)
    try {
      if (verdict === 'accept') await window.api.acceptBiblioSuggestion(suggestion.id)
      else await window.api.rejectBiblioSuggestion(suggestion.id)
      onReload()
    } catch (err) {
      setBiblioError(err instanceof Error ? err.message : String(err))
    } finally {
      setBiblioBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
        <Button variant="ghost" icon="arrow_back" onClick={onBack} title={`Zurück zum ${backLabel}`}>
          {backLabel}
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{folder.title}</h2>
        {pileBadge(folder.pile, surface)}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[min(380px,42%)] shrink-0 flex-col overflow-y-auto border-r border-hairline p-4">
          <div className="mb-3 flex flex-wrap gap-1.5">
            {source && statusBadge(source.review_status)}
            {source && quoteBadge(source.quote_verified, source.quote_match_score)}
            {watchOnly && <Badge tone="slate">{folder.documentId ? 'gelesen' : 'Treffer'}</Badge>}
            {folder.year && <Badge tone="slate">{folder.year}</Badge>}
            {suggestion && <Badge tone="sky">DOI-Vorschlag</Badge>}
          </div>
          <Field label="Woher">
            <a href={source?.url ?? candidate?.url ?? folder.origin} target="_blank" rel="noreferrer" className="break-all underline decoration-dotted">
              {source?.url ?? candidate?.url ?? folder.origin}
            </a>
          </Field>
          {source && (
            <>
              <Field label="Citekey">
                <span className="font-mono text-[13px]">{source.citekey || 'noch ohne Citekey'}</span>
              </Field>
              <Field label="Typ">
                {entryTypeLabel(source.entry_type)}
                {source.entry_type ? ` (@${source.doi ? source.entry_type : 'misc'})` : ''}
              </Field>
              <Field label="DOI">
                {source.doi ? (
                  <a href={`https://doi.org/${source.doi}`} target="_blank" rel="noreferrer" className="break-all underline decoration-dotted">
                    {source.doi}
                  </a>
                ) : (
                  <span className="text-muted">keine DOI — die KI kann Crossref vorschlagen</span>
                )}
              </Field>
              {sourceAuthors(source) && <Field label="Autor:innen">{sourceAuthors(source)}</Field>}
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
            <p className="text-sm text-muted">Volltext liegt vor. Die KI-Anmerkung kommt, sobald der Agent den Ordner mit add_source füllt — dann wandert er auf den Human Desk.</p>
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
          {suggestion && (
            <div className="mb-3 border border-hairline bg-wash p-3">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">DOI-Vorschlag der KI</div>
              <p className="text-sm leading-relaxed">{suggestion.reason}</p>
              <p className="mt-2 font-mono text-[13px]">
                <a href={`https://doi.org/${suggestion.proposed_doi}`} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                  {suggestion.proposed_doi}
                </a>
              </p>
              {suggestion.proposed_title && <p className="mt-1 text-sm">{suggestion.proposed_title}</p>}
              {authorsLine(suggestion.proposed_authors) && (
                <p className="text-xs text-muted">{authorsLine(suggestion.proposed_authors)}</p>
              )}
              <p className="mt-1 text-xs text-muted">
                {suggestion.proposed_year ? `${suggestion.proposed_year} · ` : ''}
                {entryTypeLabel(suggestion.proposed_entry_type)}
                {suggestion.proposed_venue ? ` · ${suggestion.proposed_venue}` : ''}
                {suggestion.found_via === 'document_offset' ? ' · aus dem gespeicherten Text' : ' · Crossref'}
              </p>
              {suggestion.title_overlap != null && suggestion.title_overlap < 0.25 && (
                <p className="mt-2 text-xs text-warn">Titel weicht stark von der Quelle ab — vor dem Übernehmen gegenlesen.</p>
              )}
              {watchOnly ? (
                <p className="mt-2 text-[12px] text-muted">Übernehmen nur auf dem Human Desk.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" icon="menu_book" onClick={() => void decideBiblio('accept')} disabled={biblioBusy}>
                    Metadaten übernehmen
                  </Button>
                  <Button variant="ghost" onClick={() => void decideBiblio('reject')} disabled={biblioBusy}>
                    Vorschlag ablehnen
                  </Button>
                </div>
              )}
              {biblioError && <p className="mt-2 text-xs text-warn">{biblioError}</p>}
              {!watchOnly && source?.review_status === 'human_signed' && source.citekey && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  Die Quelle ist schon übernommen — der Citekey {source.citekey} bleibt.
                </p>
              )}
            </div>
          )}

          <div className="mt-auto border-t border-hairline pt-4">
            {watchOnly ? (
              <p className="text-[12px] leading-relaxed text-muted">
                Zuschauen, während die KI arbeitet. Übernehmen und Ablehnen nur auf dem Human Desk, sobald eine Quelle
                angelegt ist.
              </p>
            ) : (
              <>
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
                  <p className="text-[12px] leading-relaxed text-muted">
                    Übernehmen geht, sobald der Agent diesen Ordner als Quelle angelegt hat.
                  </p>
                )}
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  Nur du setzt Übernehmen der Quelle — die KI kann das nicht. DOI-Metadaten übernimmst du oben gesondert.
                </p>
              </>
            )}
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
              {watchOnly
                ? 'Noch kein Volltext — die KI hat bisher nur den Treffer, nicht den Text.'
                : 'Noch kein Volltext. Abstracts allein sind kein Ordner-Inhalt — der Agent holt den Text, bevor du übernimmst.'}
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
