import { useMemo, useState } from 'react'
import type {
  Carrier,
  CarrierProfile,
  CarrierSignal,
  CarrierWatchlistEntry,
  ProjectState,
  ReviewStatus,
} from '../../../../shared/types'
import { Badge, Button, EmptyState } from '../../components/ui'

export default function CarriersTab({ state, onReload }: { state: ProjectState; onReload: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [domain, setDomain] = useState('')
  const [listKind, setListKind] = useState<'exclude' | 'caution' | 'prefer'>('exclude')
  const [watchNote, setWatchNote] = useState('')

  const profilesByCarrier = useMemo(() => {
    const map = new Map<string, CarrierProfile>()
    for (const p of state.carrierProfiles) map.set(p.carrier_id, p)
    return map
  }, [state.carrierProfiles])

  const signalsByProfile = useMemo(() => {
    const map = new Map<string, CarrierSignal[]>()
    for (const s of state.carrierSignals) {
      const list = map.get(s.carrier_profile_id) ?? []
      list.push(s)
      map.set(s.carrier_profile_id, list)
    }
    return map
  }, [state.carrierSignals])

  const rows = useMemo(() => {
    const all = state.carriers.map((carrier) => {
      const profile = profilesByCarrier.get(carrier.id) ?? null
      return { carrier, profile, signals: profile ? signalsByProfile.get(profile.id) ?? [] : [] }
    })
    if (filter === 'open') {
      return all.filter((r) => !r.profile || r.profile.review_status === 'pending' || r.profile.review_status === 'ai_checked')
    }
    return all
  }, [state.carriers, profilesByCarrier, signalsByProfile, filter])

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

  const addWatch = async () => {
    setNotice(null)
    try {
      await window.api.addCarrierWatchlist({
        project_id: state.project.id,
        list_kind: listKind,
        domain,
        note: watchNote,
      })
      setDomain('')
      setWatchNote('')
      onReload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }

  if (state.carriers.length === 0 && state.carrierWatchlist.length === 0) {
    return (
      <EmptyState
        icon="domain"
        title="Noch keine Träger"
        hint="Sobald der Agent eine URL holt, liegt die Domain hier. Du sichtest gebündelt — nicht einzeln während der Recherche."
      />
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {notice && <p className="text-sm text-bad">{notice}</p>}

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter('open')}
            className={`border px-2.5 py-1 text-xs ${filter === 'open' ? 'border-line bg-fg text-bg' : 'border-hairline text-muted hover:text-fg'}`}
          >
            Offen
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`border px-2.5 py-1 text-xs ${filter === 'all' ? 'border-line bg-fg text-bg' : 'border-hairline text-muted hover:text-fg'}`}
          >
            Alle
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">Keine offenen Trägerprofile.</p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <CarrierCard
                key={row.carrier.id}
                carrier={row.carrier}
                profile={row.profile}
                signals={row.signals}
                watch={state.carrierWatchlist.filter(
                  (w) =>
                    row.carrier.registrable_domain === w.domain ||
                    row.carrier.registrable_domain.endsWith(`.${w.domain}`)
                )}
                busy={busyId === row.carrier.id}
                onSign={() =>
                  void run(row.carrier.id, async () => {
                    if (row.profile) await window.api.signCarrier(row.profile.id, 'human_signed', null)
                  })
                }
                onReject={() =>
                  void run(row.carrier.id, async () => {
                    if (row.profile) await window.api.signCarrier(row.profile.id, 'rejected', null)
                  })
                }
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted">Watchlist (dieses Projekt)</h3>
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_8rem_1fr_auto]">
          <input
            className="field text-sm"
            placeholder="domain.example"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <select className="field text-sm" value={listKind} onChange={(e) => setListKind(e.target.value as typeof listKind)}>
            <option value="exclude">Ausschluss</option>
            <option value="caution">Vorsicht</option>
            <option value="prefer">Bevorzugt</option>
          </select>
          <input
            className="field text-sm"
            placeholder="Warum? (mind. 8 Zeichen)"
            value={watchNote}
            onChange={(e) => setWatchNote(e.target.value)}
          />
          <Button variant="primary" disabled={domain.trim().length < 3 || watchNote.trim().length < 8} onClick={() => void addWatch()}>
            Eintragen
          </Button>
        </div>
        <ul className="space-y-1">
          {state.carrierWatchlist.map((w) => (
            <li key={w.id} className="flex items-start justify-between gap-2 border border-hairline px-3 py-2 text-sm">
              <div>
                <span className="font-mono">{w.domain}</span>{' '}
                <WatchBadge kind={w.list_kind} />
                <p className="mt-0.5 text-xs text-muted">{w.note}</p>
              </div>
              <Button
                variant="ghost"
                disabled={busyId === w.id}
                onClick={() => void run(w.id, async () => { await window.api.removeCarrierWatchlist(w.id) })}
              >
                Entfernen
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function CarrierCard({
  carrier,
  profile,
  signals,
  watch,
  busy,
  onSign,
  onReject,
}: {
  carrier: Carrier
  profile: CarrierProfile | null
  signals: CarrierSignal[]
  watch: CarrierWatchlistEntry[]
  busy: boolean
  onSign: () => void
  onReject: () => void
}) {
  const canSign = Boolean(profile) && profile!.review_status !== 'human_signed' && profile!.review_status !== 'rejected'
  return (
    <article className="border border-hairline p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{carrier.display_name || carrier.registrable_domain}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="font-mono">{carrier.registrable_domain}</span>
            <span>{kindLabel(carrier.carrier_kind)}</span>
            {profile && <StatusBadge status={profile.review_status} />}
            {!profile && <Badge tone="amber">ohne Profil</Badge>}
            {watch.map((w) => (
              <WatchBadge key={w.id} kind={w.list_kind} />
            ))}
          </div>
        </div>
      </div>
      {profile && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            <span className="text-[11px] uppercase tracking-wider text-muted">Beobachtet · </span>
            {profile.observed}
          </p>
          <p>
            <span className="text-[11px] uppercase tracking-wider text-muted">Deutung · </span>
            {profile.interpretation}
          </p>
          <p className="text-muted">
            <span className="text-[11px] uppercase tracking-wider">Unsicher · </span>
            {profile.uncertainty}
          </p>
          <p className="text-[11px] text-muted">
            Basis: {profile.evidence_basis}
            {profile.confidence ? ` · ${profile.confidence}` : ''}
          </p>
        </div>
      )}
      {signals.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {signals.map((s) => (
            <li key={s.id}>
              {s.label}: {s.detail}
            </li>
          ))}
        </ul>
      )}
      {canSign && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={onSign}>
            Freigeben
          </Button>
          <Button variant="danger" disabled={busy} onClick={onReject}>
            Ablehnen
          </Button>
        </div>
      )}
    </article>
  )
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  switch (status) {
    case 'pending':
      return <Badge tone="amber">offen</Badge>
    case 'ai_checked':
      return <Badge tone="slate">automatisch</Badge>
    case 'human_signed':
      return <Badge tone="emerald">freigegeben</Badge>
    case 'rejected':
      return <Badge tone="red">abgelehnt</Badge>
    default: {
      const _never: never = status
      return _never
    }
  }
}

function WatchBadge({ kind }: { kind: CarrierWatchlistEntry['list_kind'] }) {
  switch (kind) {
    case 'exclude':
      return <Badge tone="red">Ausschluss</Badge>
    case 'caution':
      return <Badge tone="amber">Vorsicht</Badge>
    case 'prefer':
      return <Badge tone="emerald">bevorzugt</Badge>
    default: {
      const _never: never = kind
      return _never
    }
  }
}

function kindLabel(kind: Carrier['carrier_kind']): string {
  switch (kind) {
    case 'academic_publisher':
      return 'Verlag'
    case 'journal':
      return 'Journal'
    case 'government':
      return 'Behörde'
    case 'ngo':
      return 'NGO'
    case 'thinktank':
      return 'Thinktank'
    case 'news':
      return 'News'
    case 'blog':
      return 'Blog'
    case 'party_media':
      return 'Parteimedium'
    case 'commercial':
      return 'kommerziell'
    case 'personal':
      return 'persönlich'
    case 'unknown':
      return 'unbekannt'
    default: {
      const _never: never = kind
      return _never
    }
  }
}
