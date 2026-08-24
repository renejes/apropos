import { useEffect, useMemo, useState } from 'react'
import type { ProjectState, VisualGraph, VisualLayoutKind, VisualVersion } from '../../../../shared/types'
import { Badge, Button, Card, EmptyState, Icon } from '../../components/ui'
import MapCanvas, { type NodeDiff } from './MapCanvas'

type ViewMode = 'live' | 'version' | 'compare'

export default function MapTab({
  state,
  onOpenSource,
  onReload,
}: {
  state: ProjectState
  onOpenSource: (sourceId: string) => void
  onReload: () => void
}) {
  const projectId = state.project.id
  const [layout, setLayout] = useState<VisualLayoutKind>('theme_clusters')
  const [mode, setMode] = useState<ViewMode>('live')
  const [liveGraph, setLiveGraph] = useState<VisualGraph | null>(null)
  const [versionId, setVersionId] = useState<string>('')
  const [versionGraph, setVersionGraph] = useState<VisualGraph | null>(null)
  const [leftId, setLeftId] = useState<string>('')
  const [rightId, setRightId] = useState<string>('')
  const [leftGraph, setLeftGraph] = useState<VisualGraph | null>(null)
  const [rightGraph, setRightGraph] = useState<VisualGraph | null>(null)
  const [selected, setSelected] = useState<{ kind: 'source' | 'claim' | 'sub_question'; id: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const marked = useMemo(
    () => new Set(state.marks.map((m) => `${m.entity_type}:${m.entity_id}`)),
    [state.marks]
  )
  const versions = state.visualVersions

  useEffect(() => {
    let cancelled = false
    void window.api.describeMap(projectId, layout).then((res) => {
      if (!cancelled) setLiveGraph(res.graph)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, layout, state.sources.length, state.claims.length, state.subQuestions.length, state.links.length])

  useEffect(() => {
    if (!versionId) {
      setVersionGraph(null)
      return
    }
    let cancelled = false
    void window.api.getVisualVersion(projectId, versionId).then((res) => {
      if (!cancelled) setVersionGraph(res.graph)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, versionId])

  useEffect(() => {
    if (!leftId) {
      setLeftGraph(null)
      return
    }
    let cancelled = false
    void window.api.getVisualVersion(projectId, leftId).then((res) => {
      if (!cancelled) setLeftGraph(res.graph)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, leftId])

  useEffect(() => {
    if (!rightId) {
      setRightGraph(null)
      return
    }
    let cancelled = false
    void window.api.getVisualVersion(projectId, rightId).then((res) => {
      if (!cancelled) setRightGraph(res.graph)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, rightId])

  const empty = state.sources.length === 0 && state.claims.length === 0 && state.subQuestions.length === 0
  const graph = mode === 'live' ? liveGraph : mode === 'version' ? versionGraph : null

  const diffOf = (kind: string, entityId: string): NodeDiff => {
    if (!leftGraph || !rightGraph) return null
    const key = `${kind}:${entityId}`
    const inL = leftGraph.nodes.some((n) => `${n.kind}:${n.entity_id}` === key)
    const inR = rightGraph.nodes.some((n) => `${n.kind}:${n.entity_id}` === key)
    if (inL && inR) return 'both'
    if (inL) return 'only-left'
    if (inR) return 'only-right'
    return null
  }

  const onSelect = (kind: 'source' | 'claim' | 'sub_question', entityId: string) => {
    setSelected({ kind, id: entityId })
  }

  const onToggleMark = async (kind: 'source' | 'claim', entityId: string) => {
    await window.api.toggleMark(projectId, kind, entityId)
    onReload()
  }

  const exportPack = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const input =
        mode === 'version' && versionId
          ? { project_id: projectId, visual_version_id: versionId }
          : state.marks.length > 0
            ? { project_id: projectId, scope: 'marked' as const }
            : null
      if (!input) {
        setMsg('Erst eine Version speichern oder Punkte markieren — das Schreibpaket braucht immer einen Scope.')
        return
      }
      const pack = await window.api.exportWritingPack(input)
      setMsg(`Schreibpaket: ${pack.dir}`)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const snapshot = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const question =
        layout === 'theme_clusters' ? 'Live-Snapshot: Cluster nach Teilfragen.' : 'Live-Snapshot: Argumentkarte der Belegkanten.'
      const made = await window.api.prepareView({
        project_id: projectId,
        question,
        layout_kind: layout,
        scope: 'all',
      })
      setVersionId(made.version.id)
      setMode('version')
      setMsg('Version gespeichert — unveränderlich.')
      onReload()
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const detail = selected ? detailFor(state, selected) : null

  if (empty) {
    return (
      <EmptyState
        icon="account_tree"
        title="Noch keine Karte"
        hint="Sobald Teilfragen, Quellen oder Aussagen da sind, erscheinen sie hier. Bitte den Agenten, describe_evidence_map oder prepare_view aufzurufen."
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segment
          value={mode}
          onChange={setMode}
          options={[
            { id: 'live', label: 'Live' },
            { id: 'version', label: 'Version' },
            { id: 'compare', label: 'Vergleich' },
          ]}
        />
        {mode === 'live' && (
          <Segment
            value={layout}
            onChange={setLayout}
            options={[
              { id: 'theme_clusters', label: 'Themen' },
              { id: 'argument_map', label: 'Argumente' },
            ]}
          />
        )}
        {mode === 'version' && (
          <VersionSelect versions={versions} value={versionId} onChange={setVersionId} placeholder="Version wählen" />
        )}
        {mode === 'compare' && (
          <>
            <VersionSelect versions={versions} value={leftId} onChange={setLeftId} placeholder="Links" />
            <VersionSelect versions={versions} value={rightId} onChange={setRightId} placeholder="Rechts" />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Badge tone="amber">{state.marks.length} markiert</Badge>
          {mode === 'live' && (
            <Button icon="photo_camera" onClick={() => void snapshot()} disabled={busy}>
              Version speichern
            </Button>
          )}
          <Button
            icon="folder_zip"
            disabled={busy}
            onClick={() => void exportPack()}
            title="Markdown-Schreibpaket aus dieser Sicht"
          >
            Schreibpaket
          </Button>
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
        <Icon name="info" className="!text-[14px] mt-0.5 shrink-0" />
        Punkte sind Quellen und Aussagen — keine freien Zettel. Stern = Arbeitsset (projektsweit). Vergleich färbt nach entity_id:
        nur links amber, nur rechts sky, in beiden grün.
      </p>

      {mode === 'compare' ? (
        versions.length < 2 ? (
          <p className="text-sm text-muted">Zwei gespeicherte Versionen nötig. Erst Live-Karte als Version speichern oder prepare_view im Chat.</p>
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
            <Pane title={labelOf(versions, leftId)} graph={leftGraph} marked={marked} selected={selected} diffOf={diffOf} onSelect={onSelect} onToggleMark={onToggleMark} />
            <Pane title={labelOf(versions, rightId)} graph={rightGraph} marked={marked} selected={selected} diffOf={diffOf} onSelect={onSelect} onToggleMark={onToggleMark} />
          </div>
        )
      ) : graph ? (
        <div className="min-h-[28rem] flex-1">
          <MapCanvas
            graph={graph}
            marked={marked}
            selectedKey={selected ? `${selected.kind}:${selected.id}` : null}
            onSelect={onSelect}
            onToggleMark={onToggleMark}
          />
        </div>
      ) : (
        <p className="text-sm text-muted">{mode === 'version' ? 'Version wählen.' : 'Karte wird gebaut …'}</p>
      )}

      {detail && (
        <Card className="p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{detail.kind}</p>
          <p className="mt-1 text-sm leading-snug text-fg">{detail.title}</p>
          {detail.body && <p className="mt-1 text-xs leading-relaxed text-muted">{detail.body}</p>}
          {selected?.kind === 'source' && (
            <div className="mt-2">
              <Button icon="link" onClick={() => onOpenSource(selected.id)}>
                Quelle öffnen
              </Button>
            </div>
          )}
        </Card>
      )}
      {msg && <p className="text-xs text-ok">{msg}</p>}
    </div>
  )
}

function Pane({
  title,
  graph,
  marked,
  selected,
  diffOf,
  onSelect,
  onToggleMark,
}: {
  title: string
  graph: VisualGraph | null
  marked: Set<string>
  selected: { kind: string; id: string } | null
  diffOf: (kind: string, entityId: string) => NodeDiff
  onSelect: (kind: 'source' | 'claim' | 'sub_question', entityId: string) => void
  onToggleMark: (kind: 'source' | 'claim', entityId: string) => void
}) {
  return (
    <div className="min-h-[22rem]">
      <p className="mb-1 truncate text-xs font-medium text-muted">{title}</p>
      {graph ? (
        <MapCanvas
          graph={graph}
          marked={marked}
          selectedKey={selected ? `${selected.kind}:${selected.id}` : null}
          diffOf={diffOf}
          onSelect={onSelect}
          onToggleMark={onToggleMark}
        />
      ) : (
        <p className="text-xs text-muted">Version wählen</p>
      )}
    </div>
  )
}

function VersionSelect({
  versions,
  value,
  onChange,
  placeholder,
}: {
  versions: VisualVersion[]
  value: string
  onChange: (id: string) => void
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="field max-w-[16rem] text-xs"
    >
      <option value="">{placeholder}</option>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          {new Date(v.created_at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · {v.layout_kind === 'theme_clusters' ? 'Themen' : 'Argumente'}
        </option>
      ))}
    </select>
  )
}

function Segment<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ id: T; label: string }>
}) {
  return (
    <div className="inline-flex border border-hairline bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 text-xs ${value === o.id ? 'bg-fg text-bg' : 'text-muted hover:bg-fg hover:text-bg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function labelOf(versions: VisualVersion[], id: string): string {
  const v = versions.find((x) => x.id === id)
  if (!v) return '—'
  return v.prompt
}

function detailFor(
  state: ProjectState,
  selected: { kind: 'source' | 'claim' | 'sub_question'; id: string }
): { kind: string; title: string; body: string | null } | null {
  switch (selected.kind) {
    case 'source': {
      const s = state.sources.find((x) => x.id === selected.id)
      if (!s) return null
      return { kind: 'Quelle', title: s.title, body: s.verbatim_quote }
    }
    case 'claim': {
      const c = state.claims.find((x) => x.id === selected.id)
      if (!c) return null
      return { kind: 'Aussage', title: c.claim_text, body: null }
    }
    case 'sub_question': {
      const q = state.subQuestions.find((x) => x.id === selected.id)
      if (!q) return null
      return { kind: 'Teilfrage', title: q.question, body: q.status }
    }
    default: {
      const _never: never = selected.kind
      return _never
    }
  }
}
