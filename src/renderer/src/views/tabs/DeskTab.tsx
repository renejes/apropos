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
  const [zoteroNote, setZoteroNote] = useState<string | null>(null)

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
          <span className="ml-auto flex gap-2">
            <Button
              title="BibTeX nur aus übernommenen Quellen"
              onClick={() => void window.api.exportBibliography(state.project.id)}
            >
              BibTeX
            </Button>
            <Button title="RIS für Citavi, nur übernommene Quellen" onClick={() => void window.api.exportRis(state.project.id)}>
              RIS
            </Button>
            <Button
              title="Übernommene Quellen in die lokale Zotero-Bibliothek"
              onClick={() => {
                setZoteroNote(null)
                void window.api.exportToZotero(state.project.id).then(
                  (result) => setZoteroNote(result.hint),
                  (err: unknown) => setZoteroNote(err instanceof Error ? err.message : String(err))
                )
              }}
            >
              Nach Zotero
            </Button>
          </span>
        )}
      </div>
      {zoteroNote && <p className="shrink-0 border-b border-hairline px-5 py-2 text-[12px] leading-relaxed text-muted">{zoteroNote}</p>}
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
                {source.entry_type === 'book' && source.booktitle?.trim()
                  ? 'Beitrag (@incollection)'
                  : source.entry_type
                    ? `${entryTypeLabel(source.entry_type)} (@${source.entry_type})`
                    : 'noch offen'}
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
              {!watchOnly && (
                <ImprintForm
                  source={source}
                  onSaved={onReload}
                />
              )}
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
                    {source.review_status === 'human_signed' && source.doi && (
                      <SnowballButton projectId={state.project.id} sourceId={source.id} onDone={onReload} />
                    )}
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

function jsonLines(raw: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').join('\n') : ''
  } catch {
    return ''
  }
}

function splitLines(raw: string): string[] {
  return raw
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function ImprintForm({ source, onSaved }: { source: Source; onSaved: () => void }) {
  const [entryType, setEntryType] = useState(source.entry_type ?? '')
  const [authors, setAuthors] = useState(jsonLines(source.authors_json))
  const [year, setYear] = useState(source.year ? String(source.year) : '')
  const [venue, setVenue] = useState(source.venue ?? '')
  const [booktitle, setBooktitle] = useState(source.booktitle ?? '')
  const [volume, setVolume] = useState(source.volume ?? '')
  const [issue, setIssue] = useState(source.issue ?? '')
  const [pages, setPages] = useState(source.pages ?? '')
  const [publisher, setPublisher] = useState(source.publisher ?? '')
  const [place, setPlace] = useState(source.place ?? '')
  const [edition, setEdition] = useState(source.edition ?? '')
  const [editors, setEditors] = useState(jsonLines(source.editors_json))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEntryType(source.entry_type ?? '')
    setAuthors(jsonLines(source.authors_json))
    setYear(source.year ? String(source.year) : '')
    setVenue(source.venue ?? '')
    setBooktitle(source.booktitle ?? '')
    setVolume(source.volume ?? '')
    setIssue(source.issue ?? '')
    setPages(source.pages ?? '')
    setPublisher(source.publisher ?? '')
    setPlace(source.place ?? '')
    setEdition(source.edition ?? '')
    setEditors(jsonLines(source.editors_json))
    setError(null)
  }, [source])

  const save = async () => {
    setBusy(true)
    setError(null)
    const yearNum = year.trim() ? Number(year.trim()) : null
    if (year.trim() && !Number.isInteger(yearNum)) {
      setError('Jahr als Zahl, oder leer lassen.')
      setBusy(false)
      return
    }
    try {
      await window.api.saveSourceImprint({
        source_id: source.id,
        entry_type: entryType === '' ? null : (entryType as BibEntryType),
        authors: splitLines(authors),
        year: yearNum,
        venue: venue.trim() || null,
        volume: volume.trim() || null,
        issue: issue.trim() || null,
        pages: pages.trim() || null,
        publisher: publisher.trim() || null,
        place: place.trim() || null,
        edition: edition.trim() || null,
        editors: splitLines(editors),
        booktitle: booktitle.trim() || null,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 border border-hairline p-3">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">Titelangaben</div>
      <p className="mb-2 text-[12px] leading-relaxed text-muted">
        Was Crossref nicht geliefert hat. Leer bleibt leer. Seiten hier sind der Umfang des Werks, nicht die Fundstelle des Zitats.
      </p>
      <label className="mb-2 block text-xs text-muted">
        Typ
        <select className="field mt-1 w-full text-sm" value={entryType} onChange={(e) => setEntryType(e.target.value)}>
          <option value="">offen</option>
          <option value="article">Artikel</option>
          <option value="book">Buch</option>
          <option value="inproceedings">Tagungsbeitrag</option>
          <option value="misc">Sonstiges</option>
        </select>
      </label>
      <label className="mb-2 block text-xs text-muted">
        Autor:innen, eine Zeile je Name
        <textarea className="field mt-1 w-full text-sm" rows={2} value={authors} onChange={(e) => setAuthors(e.target.value)} />
      </label>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Jahr
          <input className="field mt-1 w-full text-sm" value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Auflage
          <input className="field mt-1 w-full text-sm" value={edition} onChange={(e) => setEdition(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Band
          <input className="field mt-1 w-full text-sm" value={volume} onChange={(e) => setVolume(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Heft
          <input className="field mt-1 w-full text-sm" value={issue} onChange={(e) => setIssue(e.target.value)} />
        </label>
      </div>
      <label className="mb-2 block text-xs text-muted">
        Zeitschrift
        <input className="field mt-1 w-full text-sm" value={venue} onChange={(e) => setVenue(e.target.value)} />
      </label>
      <label className="mb-2 block text-xs text-muted">
        Titel des Sammelbands
        <input className="field mt-1 w-full text-sm" value={booktitle} onChange={(e) => setBooktitle(e.target.value)} />
      </label>
      <label className="mb-2 block text-xs text-muted">
        Seiten des Werks, z. B. 12-18
        <input className="field mt-1 w-full text-sm" value={pages} onChange={(e) => setPages(e.target.value)} />
      </label>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-xs text-muted">
          Verlag
          <input className="field mt-1 w-full text-sm" value={publisher} onChange={(e) => setPublisher(e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          Ort
          <input className="field mt-1 w-full text-sm" value={place} onChange={(e) => setPlace(e.target.value)} />
        </label>
      </div>
      <label className="mb-2 block text-xs text-muted">
        Herausgeber:innen, eine Zeile je Name
        <textarea className="field mt-1 w-full text-sm" rows={2} value={editors} onChange={(e) => setEditors(e.target.value)} />
      </label>
      {booktitle.trim() && entryType === 'book' && (
        <p className="mb-2 text-[12px] text-muted">Export als Beitrag in einem Sammelband.</p>
      )}
      <Button onClick={() => void save()} disabled={busy}>
        Titelangaben speichern
      </Button>
      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
    </div>
  )
}

function SnowballButton({ projectId, sourceId, onDone }: { projectId: string; sourceId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setNote(null)
    try {
      const result = await window.api.snowballLiterature(projectId, sourceId)
      setNote(`${result.references} im Literaturverzeichnis, ${result.citing} spätere Zitationen. Treffer liegen auf dem Agent-Desk.`)
      onDone()
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 w-full">
      <Button icon="account_tree" onClick={() => void run()} disabled={busy} title="Literaturverzeichnis und spätere Zitationen">
        Schneeball
      </Button>
      {note && <p className="mt-2 text-[12px] leading-relaxed text-muted">{note}</p>}
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
