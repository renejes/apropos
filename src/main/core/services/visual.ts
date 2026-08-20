import { createHash } from 'crypto'
import { z } from 'zod'
import type { Repo } from '../repo'
import type {
  Mark,
  MarkEntityType,
  ProjectState,
  VisualGraph,
  VisualLayoutKind,
  VisualNodeKind,
  VisualRelation,
  VisualScope,
  VisualVersion,
} from '../../../shared/types'
import { ServiceError } from './research'

const COL_W = 250
const NODE_W = 210
const NODE_H = 56
const SQ_H = 44
const GAP_Y = 14
const PAD = 36
const CLAIM_ROW_H = 72

export const layoutKindSchema = z.enum(['argument_map', 'theme_clusters'])
export const visualScopeSchema = z.enum(['all', 'marked'])
export const markEntitySchema = z.enum(['source', 'claim'])

export const placementSchema = z.object({
  kind: z.enum(['source', 'claim']),
  entity_id: z.string().min(1),
  cluster_key: z.string().min(1),
  cluster_label: z.string().min(3),
})

export const prepareViewSchema = z.object({
  project_id: z.string().min(1),
  question: z.string().min(10).describe('Aufbereitungsfrage — warum diese Sicht?'),
  layout_kind: layoutKindSchema,
  scope: visualScopeSchema.optional().default('all'),
  parent_version_id: z.string().optional().nullable(),
  placements: z.array(placementSchema).optional(),
})

export const describeMapSchema = z.object({
  project_id: z.string().min(1),
  layout_kind: layoutKindSchema.optional(),
})

export const getVersionSchema = z.object({
  project_id: z.string().min(1),
  version_id: z.string().min(1),
})

export const listVersionsSchema = z.object({
  project_id: z.string().min(1),
})

export const toggleMarkSchema = z.object({
  project_id: z.string().min(1),
  entity_type: markEntitySchema,
  entity_id: z.string().min(1),
})

export const askNarrativeSchema = z.object({
  project_id: z.string().min(1),
  items: z
    .array(
      z.object({
        entity_type: markEntitySchema,
        entity_id: z.string().min(1),
        verdict: z.enum(['durable', 'mixed', 'needs_research']),
        note: z.string().min(10),
        claim_text: z.string().min(20).optional(),
        quote_span: z.string().min(10).optional(),
        source_id: z.string().optional(),
        support_type: z.enum(['supports', 'contrasts', 'mentions']).optional(),
        new_sub_question: z.string().min(20).optional(),
      })
    )
    .min(1),
})

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, code: string): z.infer<T> {
  const r = schema.safeParse(input)
  if (!r.success) {
    throw new ServiceError(code, r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 'Korrigiere die Felder und rufe das Werkzeug erneut auf.')
  }
  return r.data
}

function assertProject(repo: Repo, projectId: string): void {
  if (!repo.getProject(projectId)) {
    throw new ServiceError(
      'project_not_found',
      `Projekt ${projectId} existiert nicht.`,
      'Rufe list_projects auf und verwende eine der dort genannten project_id. Erfinde keine ID. Gibt es noch kein Projekt, lege es mit create_project an.'
    )
  }
}

function nodeKey(kind: VisualNodeKind, entityId: string): string {
  return `${kind}:${entityId}`
}

function truncate(text: string, n: number): string {
  const t = text.trim()
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`
}

interface BuiltNode {
  id: string
  kind: VisualNodeKind
  entity_id: string
  label: string
  cluster_key: string | null
  pos_x: number
  pos_y: number
}

interface BuiltEdge {
  id: string
  from_node: string
  to_node: string
  relation: VisualRelation
}

export interface Placement {
  kind: 'source' | 'claim'
  entity_id: string
  cluster_key: string
  cluster_label: string
}

function belongToProject(state: ProjectState, entityType: MarkEntityType, entityId: string): boolean {
  switch (entityType) {
    case 'source':
      return state.sources.some((s) => s.id === entityId)
    case 'claim':
      return state.claims.some((c) => c.id === entityId)
    default: {
      const _never: never = entityType
      return _never
    }
  }
}

/**
 * Baut eine Karte ausschließlich aus vorhandenen Entitäten.
 * `placements` dürfen Cluster umhängen, keine Knoten erfinden.
 */
export function buildVisualGraph(
  state: ProjectState,
  layoutKind: VisualLayoutKind,
  options?: { scope?: VisualScope; placements?: Placement[]; marks?: Mark[] }
): VisualGraph {
  const scope = options?.scope ?? 'all'
  const marks = options?.marks ?? state.marks ?? []
  const marked = new Set(marks.map((m) => `${m.entity_type}:${m.entity_id}`))

  const sources =
    scope === 'marked' ? state.sources.filter((s) => marked.has(`source:${s.id}`)) : state.sources
  const claims = scope === 'marked' ? state.claims.filter((c) => marked.has(`claim:${c.id}`)) : state.claims
  const sourceIds = new Set(sources.map((s) => s.id))
  const claimIds = new Set(claims.map((c) => c.id))
  const links = state.links.filter((l) => claimIds.has(l.claim_id) && sourceIds.has(l.source_id))

  const placementByEntity = new Map<string, Placement>()
  for (const p of options?.placements ?? []) {
    const exists = p.kind === 'source' ? sourceIds.has(p.entity_id) || state.sources.some((s) => s.id === p.entity_id) : state.claims.some((c) => c.id === p.entity_id)
    if (!exists) {
      throw new ServiceError(
        'visual_unknown_entity',
        `${p.kind} ${p.entity_id} existiert nicht in diesem Projekt — Knoten ohne Beleg sind verboten.`,
        'Nur IDs aus describe_evidence_map / get_project_state verwenden. Keine neuen Knoten erfinden.'
      )
    }
    if (p.kind === 'source' && scope === 'marked' && !sourceIds.has(p.entity_id)) continue
    if (p.kind === 'claim' && scope === 'marked' && !claimIds.has(p.entity_id)) continue
    placementByEntity.set(`${p.kind}:${p.entity_id}`, p)
  }

  const interpretative = (options?.placements?.length ?? 0) > 0
  const sqById = new Map(state.subQuestions.map((q) => [q.id, q]))

  const clusterMeta = new Map<string, { label: string; unverified: boolean }>()
  const UNASSIGNED = 'unassigned'
  clusterMeta.set(UNASSIGNED, { label: 'Nicht zugeordnet', unverified: false })
  for (const sq of state.subQuestions) {
    const stillUsed =
      scope === 'all' ||
      sources.some((s) => s.sub_question_id === sq.id) ||
      [...placementByEntity.values()].some((p) => p.cluster_key === sq.id)
    if (stillUsed) clusterMeta.set(sq.id, { label: sq.question, unverified: false })
  }
  for (const p of placementByEntity.values()) {
    if (!clusterMeta.has(p.cluster_key)) clusterMeta.set(p.cluster_key, { label: p.cluster_label, unverified: true })
  }

  const clusterOf = (kind: 'source' | 'claim', entityId: string, fallback: string | null): string => {
    const p = placementByEntity.get(`${kind}:${entityId}`)
    if (p) return p.cluster_key
    return fallback ?? UNASSIGNED
  }

  const nodes: BuiltNode[] = []
  const edges: BuiltEdge[] = []
  const index = new Map<string, number>()

  const addNode = (n: Omit<BuiltNode, 'id' | 'pos_x' | 'pos_y'> & { pos_x?: number; pos_y?: number }): BuiltNode => {
    const id = nodeKey(n.kind, n.entity_id)
    const node: BuiltNode = { id, pos_x: n.pos_x ?? 0, pos_y: n.pos_y ?? 0, kind: n.kind, entity_id: n.entity_id, label: n.label, cluster_key: n.cluster_key }
    index.set(id, nodes.length)
    nodes.push(node)
    return node
  }

  const addEdge = (from: string, to: string, relation: VisualRelation) => {
    if (!index.has(from) || !index.has(to)) return
    edges.push({ id: `${from}->${to}:${relation}`, from_node: from, to_node: to, relation })
  }

  switch (layoutKind) {
    case 'theme_clusters': {
      const keys = [...clusterMeta.keys()]
      const cols = Math.max(1, keys.length)
      const colH: number[] = Array(cols).fill(PAD + SQ_H + GAP_Y)
      keys.forEach((key, i) => {
        const sq = sqById.get(key)
        if (sq && (scope === 'all' || sources.some((s) => clusterOf('source', s.id, s.sub_question_id) === key))) {
          addNode({
            kind: 'sub_question',
            entity_id: sq.id,
            label: truncate(sq.question, 80),
            cluster_key: key,
            pos_x: PAD + i * COL_W + (COL_W - NODE_W) / 2,
            pos_y: PAD,
          })
        }
      })
      for (const s of sources) {
        const key = clusterOf('source', s.id, s.sub_question_id)
        const i = Math.max(0, keys.indexOf(key))
        const y = colH[i] ?? PAD
        addNode({
          kind: 'source',
          entity_id: s.id,
          label: truncate(s.title, 72),
          cluster_key: key,
          pos_x: PAD + i * COL_W + (COL_W - NODE_W) / 2,
          pos_y: y,
        })
        colH[i] = y + NODE_H + GAP_Y
        const sqId = s.sub_question_id
        if (sqId && index.has(nodeKey('sub_question', sqId))) {
          addEdge(nodeKey('source', s.id), nodeKey('sub_question', sqId), 'part_of')
        }
      }
      const claimY = Math.max(PAD + 160, ...colH) + 24
      const claimN = Math.max(1, claims.length)
      claims.forEach((c, i) => {
        const key = clusterOf('claim', c.id, null)
        addNode({
          kind: 'claim',
          entity_id: c.id,
          label: truncate(c.claim_text, 90),
          cluster_key: key === UNASSIGNED ? null : key,
          pos_x: PAD + (i * (cols * COL_W - NODE_W)) / Math.max(1, claimN - 1 || 1),
          pos_y: claimY,
        })
      })
      if (claims.length === 1) {
        const n = nodes.find((x) => x.kind === 'claim')
        if (n) n.pos_x = PAD + (cols * COL_W - NODE_W) / 2
      }
      const width = Math.max(720, PAD * 2 + cols * COL_W)
      const height = Math.max(420, claimY + CLAIM_ROW_H + PAD)
      for (const l of links) {
        addEdge(nodeKey('claim', l.claim_id), nodeKey('source', l.source_id), l.support_type)
      }
      return finishGraph(layoutKind, interpretative, clusterMeta, nodes, edges, width, height)
    }
    case 'argument_map': {
      const supporting = sources.filter((s) => links.some((l) => l.source_id === s.id && l.support_type === 'supports'))
      const contrasting = sources.filter((s) => links.some((l) => l.source_id === s.id && l.support_type === 'contrasts'))
      const mentioned = sources.filter(
        (s) => !supporting.includes(s) && !contrasting.includes(s) && links.some((l) => l.source_id === s.id && l.support_type === 'mentions')
      )
      const loose = sources.filter((s) => !supporting.includes(s) && !contrasting.includes(s) && !mentioned.includes(s))
      const left = [...supporting, ...loose]
      const right = [...contrasting]
      const stack = (list: typeof sources, x: number, startY: number) => {
        list.forEach((s, i) => {
          addNode({
            kind: 'source',
            entity_id: s.id,
            label: truncate(s.title, 72),
            cluster_key: clusterOf('source', s.id, s.sub_question_id),
            pos_x: x,
            pos_y: startY + i * (NODE_H + GAP_Y),
          })
        })
      }
      const topY = PAD + (state.subQuestions.length > 0 ? SQ_H + GAP_Y : 0)
      state.subQuestions.forEach((sq, i) => {
        if (scope === 'marked' && !sources.some((s) => s.sub_question_id === sq.id)) return
        addNode({
          kind: 'sub_question',
          entity_id: sq.id,
          label: truncate(sq.question, 80),
          cluster_key: sq.id,
          pos_x: PAD + i * COL_W,
          pos_y: PAD,
        })
      })
      stack(left, PAD, topY)
      claims.forEach((c, i) => {
        addNode({
          kind: 'claim',
          entity_id: c.id,
          label: truncate(c.claim_text, 90),
          cluster_key: clusterOf('claim', c.id, null) === UNASSIGNED ? null : clusterOf('claim', c.id, null),
          pos_x: PAD + COL_W + 20,
          pos_y: topY + i * (NODE_H + GAP_Y),
        })
      })
      stack(right, PAD + COL_W * 2 + 40, topY)
      mentioned.forEach((s, i) => {
        if (index.has(nodeKey('source', s.id))) return
        addNode({
          kind: 'source',
          entity_id: s.id,
          label: truncate(s.title, 72),
          cluster_key: clusterOf('source', s.id, s.sub_question_id),
          pos_x: PAD + i * COL_W,
          pos_y: topY + Math.max(left.length, claims.length, right.length) * (NODE_H + GAP_Y) + 32,
        })
      })
      for (const s of sources) {
        if (s.sub_question_id && index.has(nodeKey('sub_question', s.sub_question_id))) {
          addEdge(nodeKey('source', s.id), nodeKey('sub_question', s.sub_question_id), 'part_of')
        }
      }
      for (const l of links) {
        addEdge(nodeKey('claim', l.claim_id), nodeKey('source', l.source_id), l.support_type)
      }
      const bottom = nodes.reduce((m, n) => Math.max(m, n.pos_y + NODE_H), 0)
      const width = Math.max(780, PAD * 2 + COL_W * 3 + 40)
      const height = Math.max(420, bottom + PAD)
      return finishGraph(layoutKind, interpretative, clusterMeta, nodes, edges, width, height)
    }
    default: {
      const _never: never = layoutKind
      return _never
    }
  }
}

function finishGraph(
  layoutKind: VisualLayoutKind,
  interpretative: boolean,
  clusterMeta: Map<string, { label: string; unverified: boolean }>,
  nodes: BuiltNode[],
  edges: BuiltEdge[],
  width: number,
  height: number
): VisualGraph {
  for (const n of nodes) {
    if (!n.entity_id) {
      throw new ServiceError(
        'visual_no_entity',
        'Knoten ohne entity_id sind verboten.',
        'Nur vorhandene Quellen, Aussagen oder Teilfragen eintragen.'
      )
    }
  }
  return {
    layout_kind: layoutKind,
    width,
    height,
    interpretative,
    clusters: [...clusterMeta.entries()].map(([key, v]) => ({ key, label: v.label, unverified: v.unverified })),
    nodes,
    edges,
  }
}

export function graphFromVersion(version: VisualVersion, nodes: VisualGraph['nodes'], edges: VisualGraph['edges']): VisualGraph {
  const clusters = new Map<string, { label: string; unverified: boolean }>()
  for (const n of nodes) {
    if (n.cluster_key && !clusters.has(n.cluster_key)) {
      clusters.set(n.cluster_key, { label: n.label, unverified: version.interpretative === 1 && n.kind !== 'sub_question' })
    }
  }
  const maxX = nodes.reduce((m, n) => Math.max(m, n.pos_x + NODE_W), 720)
  const maxY = nodes.reduce((m, n) => Math.max(m, n.pos_y + NODE_H), 420)
  return {
    layout_kind: version.layout_kind,
    width: maxX + PAD,
    height: maxY + PAD,
    interpretative: version.interpretative === 1,
    clusters: [...clusters.entries()].map(([key, v]) => ({ key, ...v })),
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      entity_id: n.entity_id,
      label: n.label,
      cluster_key: n.cluster_key,
      pos_x: n.pos_x,
      pos_y: n.pos_y,
    })),
    edges: edges.map((e) => ({ id: e.id, from_node: e.from_node, to_node: e.to_node, relation: e.relation })),
  }
}

function snapshotHash(graph: VisualGraph, question: string, layout: VisualLayoutKind, scope: VisualScope): string {
  const canon = {
    question,
    layout,
    scope,
    nodes: graph.nodes.map((n) => ({ kind: n.kind, entity_id: n.entity_id, cluster_key: n.cluster_key })).sort((a, b) => a.entity_id.localeCompare(b.entity_id)),
    edges: graph.edges.map((e) => ({ from: e.from_node, to: e.to_node, relation: e.relation })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
  }
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex')
}

export function describeEvidenceMap(
  repo: Repo,
  rawInput: unknown
): {
  layout_kind: VisualLayoutKind
  live: true
  graph: VisualGraph
  clusters: Array<{ id: string; question: string; unverified: boolean; sources: Array<{ id: string; title: string }> }>
  claims: Array<{ id: string; text: string; links: Array<{ source_id: string; relation: string }> }>
  marks: Mark[]
  versions: VisualVersion[]
  hint: string
} {
  const input = parseOrThrow(describeMapSchema, rawInput, 'map_invalid')
  assertProject(repo, input.project_id)
  const state = repo.getProjectState(input.project_id)
  const layout = input.layout_kind ?? 'theme_clusters'
  const graph = buildVisualGraph(state, layout, { marks: state.marks })
  const clusters = graph.clusters.map((c) => ({
    id: c.key,
    question: c.label,
    unverified: c.unverified,
    sources: graph.nodes.filter((n) => n.kind === 'source' && (n.cluster_key ?? 'unassigned') === c.key).map((n) => ({
      id: n.entity_id,
      title: n.label,
    })),
  }))
  const claims = graph.nodes
    .filter((n) => n.kind === 'claim')
    .map((n) => ({
      id: n.entity_id,
      text: n.label,
      links: graph.edges
        .filter((e) => e.from_node === n.id && (e.relation === 'supports' || e.relation === 'contrasts' || e.relation === 'mentions'))
        .map((e) => {
          const target = graph.nodes.find((x) => x.id === e.to_node)
          return { source_id: target?.entity_id ?? e.to_node, relation: e.relation }
        }),
    }))
  return {
    layout_kind: layout,
    live: true as const,
    graph,
    clusters,
    claims,
    marks: state.marks,
    versions: state.visualVersions,
    hint:
      'Nur diese Knoten existieren. Erfinde keine. Der Mensch sieht dieselbe Karte im Tab „Karte“. ' +
      'Eine unveränderliche Version speichern: prepare_view. Markierte Punkte triage: ask_narrative (nur markierte entity_id).',
  }
}

export function prepareView(
  repo: Repo,
  rawInput: unknown,
  actor: string
): { version: VisualVersion; graph: VisualGraph; hint: string } {
  const input = parseOrThrow(prepareViewSchema, rawInput, 'prepare_view_invalid')
  assertProject(repo, input.project_id)
  const state = repo.getProjectState(input.project_id)
  if (input.scope === 'marked' && state.marks.length === 0) {
    throw new ServiceError(
      'visual_no_marks',
      'scope=marked, aber es ist nichts markiert.',
      'Markiere Quellen oder Aussagen im Tab „Karte“ (Stern) oder per toggle_mark, danach prepare_view erneut.'
    )
  }
  if (input.parent_version_id) {
    const parent = repo.getVisualVersion(input.parent_version_id)
    if (!parent || parent.version.project_id !== input.project_id) {
      throw new ServiceError(
        'visual_parent_missing',
        `parent_version_id ${input.parent_version_id} gehört nicht zu diesem Projekt.`,
        'list_visual_versions liefert gültige IDs. Lass das Feld weg für eine Wurzel-Version.'
      )
    }
  }
  for (const p of input.placements ?? []) {
    if (p.kind === 'source' && !state.sources.some((s) => s.id === p.entity_id)) {
      throw new ServiceError(
        'visual_unknown_entity',
        `Quelle ${p.entity_id} existiert nicht.`,
        'Nur IDs aus describe_evidence_map verwenden.'
      )
    }
    if (p.kind === 'claim' && !state.claims.some((c) => c.id === p.entity_id)) {
      throw new ServiceError(
        'visual_unknown_entity',
        `Aussage ${p.entity_id} existiert nicht.`,
        'Nur IDs aus describe_evidence_map verwenden.'
      )
    }
  }
  const graph = buildVisualGraph(state, input.layout_kind, {
    scope: input.scope,
    placements: input.placements,
    marks: state.marks,
  })
  if (graph.nodes.length === 0) {
    throw new ServiceError(
      'visual_empty',
      'Keine Knoten für diese Sicht — erst Quellen oder Aussagen erfassen.',
      'Recherchiere mit fetch_source / add_source, oder wechsle scope=all.'
    )
  }
  const nodeIndex = new Map(graph.nodes.map((n, i) => [n.id, i]))
  const stored = repo.insertVisualVersion({
    project_id: input.project_id,
    parent_version_id: input.parent_version_id ?? null,
    prompt: input.question,
    layout_kind: input.layout_kind,
    scope: input.scope,
    interpretative: (input.placements?.length ?? 0) > 0,
    snapshot_hash: snapshotHash(graph, input.question, input.layout_kind, input.scope),
    nodes: graph.nodes.map((n) => ({
      kind: n.kind,
      entity_id: n.entity_id,
      label: n.label,
      cluster_key: n.cluster_key,
      pos_x: n.pos_x,
      pos_y: n.pos_y,
    })),
    edges: graph.edges.map((e) => ({
      from_index: nodeIndex.get(e.from_node)!,
      to_index: nodeIndex.get(e.to_node)!,
      relation: e.relation,
    })),
    actor,
  })
  return {
    version: stored.version,
    graph: graphFromVersion(stored.version, stored.nodes, stored.edges),
    hint: 'Version ist unveränderlich. Der Mensch sieht sie im Tab „Karte“. Splitscreen: zwei Versionen vergleichen, Diff über entity_id.',
  }
}

export function listVisualVersions(repo: Repo, rawInput: unknown): { versions: VisualVersion[] } {
  const input = parseOrThrow(listVersionsSchema, rawInput, 'visual_list_invalid')
  assertProject(repo, input.project_id)
  return { versions: repo.listVisualVersions(input.project_id) }
}

export function getVisualVersion(
  repo: Repo,
  rawInput: unknown
): { version: VisualVersion; graph: VisualGraph } {
  const input = parseOrThrow(getVersionSchema, rawInput, 'visual_get_invalid')
  assertProject(repo, input.project_id)
  const packed = repo.getVisualVersion(input.version_id)
  if (!packed || packed.version.project_id !== input.project_id) {
    throw new ServiceError(
      'visual_not_found',
      `Version ${input.version_id} existiert nicht in diesem Projekt.`,
      'list_visual_versions liefert die gespeicherten IDs.'
    )
  }
  return { version: packed.version, graph: graphFromVersion(packed.version, packed.nodes, packed.edges) }
}

export function toggleMark(
  repo: Repo,
  rawInput: unknown,
  actor: string
): { marked: boolean; mark: Mark | null } {
  const input = parseOrThrow(toggleMarkSchema, rawInput, 'mark_invalid')
  assertProject(repo, input.project_id)
  const state = repo.getProjectState(input.project_id)
  if (!belongToProject(state, input.entity_type, input.entity_id)) {
    throw new ServiceError(
      'mark_unknown_entity',
      `${input.entity_type} ${input.entity_id} gehört nicht zu diesem Projekt.`,
      'Nur Quellen- oder Aussage-IDs aus describe_evidence_map markieren.'
    )
  }
  const existing = repo.getMark(input.project_id, input.entity_type, input.entity_id)
  if (existing) {
    repo.removeMark(input.project_id, input.entity_type, input.entity_id, actor)
    return { marked: false, mark: null }
  }
  const mark = repo.addMark({
    project_id: input.project_id,
    entity_type: input.entity_type,
    entity_id: input.entity_id,
    actor,
  })
  return { marked: true, mark }
}

export function listMarks(repo: Repo, rawInput: unknown): { marks: Mark[] } {
  const input = parseOrThrow(listVersionsSchema, rawInput, 'mark_list_invalid')
  assertProject(repo, input.project_id)
  return { marks: repo.listMarks(input.project_id) }
}

export function askNarrative(
  repo: Repo,
  rawInput: unknown,
  actor: string
): {
  durable: Array<{ entity_id: string; claim_id: string }>
  mixed: Array<{ entity_id: string; flag_id: string }>
  needs_research: Array<{ entity_id: string; sub_question_id: string }>
  hint: string
} {
  const input = parseOrThrow(askNarrativeSchema, rawInput, 'narrative_invalid')
  assertProject(repo, input.project_id)
  const marks = repo.listMarks(input.project_id)
  const marked = new Set(marks.map((m) => `${m.entity_type}:${m.entity_id}`))
  const durable: Array<{ entity_id: string; claim_id: string }> = []
  const mixed: Array<{ entity_id: string; flag_id: string }> = []
  const needs_research: Array<{ entity_id: string; sub_question_id: string }> = []

  return repo.runInTransaction(() => {
    for (const item of input.items) {
      if (!marked.has(`${item.entity_type}:${item.entity_id}`)) {
        throw new ServiceError(
          'narrative_unmarked',
          `${item.entity_type} ${item.entity_id} ist nicht markiert — ask_narrative gilt nur für das Arbeitsset.`,
          'Markiere den Punkt im Tab „Karte“ oder per toggle_mark, dann erneut ask_narrative.'
        )
      }
      switch (item.verdict) {
        case 'durable': {
          if (item.entity_type === 'source') {
            if (!item.claim_text || !item.quote_span) {
              throw new ServiceError(
                'narrative_durable_incomplete',
                `Haltbares Narrativ für Quelle ${item.entity_id} braucht claim_text und quote_span.`,
                'Gib die Aussage und ein wörtliches Zitat aus dieser Quelle an — dasselbe wie link_claim_to_source.'
              )
            }
            const claim = repo.addClaim({
              project_id: input.project_id,
              claim_text: item.claim_text,
              actor,
            })
            repo.linkClaimToSource({
              claim_id: claim.id,
              source_id: item.entity_id,
              quote_span: item.quote_span,
              support_type: item.support_type ?? 'supports',
              actor,
            })
            durable.push({ entity_id: item.entity_id, claim_id: claim.id })
          } else {
            if (!item.source_id || !item.quote_span) {
              throw new ServiceError(
                'narrative_durable_incomplete',
                `Haltbares Narrativ für Aussage ${item.entity_id} braucht source_id und quote_span.`,
                'Verankere die markierte Aussage mit link_claim_to_source-Feldern an einer vorhandenen Quelle.'
              )
            }
            repo.linkClaimToSource({
              claim_id: item.entity_id,
              source_id: item.source_id,
              quote_span: item.quote_span,
              support_type: item.support_type ?? 'supports',
              actor,
            })
            durable.push({ entity_id: item.entity_id, claim_id: item.entity_id })
          }
          break
        }
        case 'mixed': {
          const flag = repo.addUncertaintyFlag({
            entity_type: item.entity_type,
            entity_id: item.entity_id,
            uncertainty_reason: item.note,
            confidence_level: 'medium',
            actor,
          })
          mixed.push({ entity_id: item.entity_id, flag_id: flag.id })
          break
        }
        case 'needs_research': {
          if (!item.new_sub_question) {
            throw new ServiceError(
              'narrative_gap_incomplete',
              `needs_research für ${item.entity_id} braucht new_sub_question.`,
              'Formuliere eine recherchierbare Teilfrage. Sie landet in get_coverage_gaps.'
            )
          }
          const sq = repo.addSubQuestion({
            project_id: input.project_id,
            question: item.new_sub_question,
            rationale: item.note,
            min_sources: 2,
            actor,
          })
          needs_research.push({ entity_id: item.entity_id, sub_question_id: sq.id })
          break
        }
        default: {
          const _never: never = item.verdict
          return _never
        }
      }
    }
    return {
      durable,
      mixed,
      needs_research,
      hint: 'Haltbares steht als Claim+Belegkante. Lücken sind neue Teilfragen (get_coverage_gaps). Kein Chat-Satz ersetzt das.',
    }
  })
}
