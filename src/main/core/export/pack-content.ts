import type { Repo } from '../repo'
import type { Claim, ProjectState, Source, VisualGraph } from '../../../shared/types'
import { ServiceError } from '../services/research'
import { getVisualVersion, buildVisualGraph } from '../services/visual'
import { citeMarker, rewriteCiteMarkers } from '../services/biblio'

export interface WritingScope {
  state: ProjectState
  graph: VisualGraph | null
  scopeLabel: string
  sources: Source[]
  claims: Claim[]
  visualVersionId: string | null
  sourceIds: string[]
  claimIds: string[]
}

function collectFromGraph(graph: VisualGraph): { sourceIds: string[]; claimIds: string[] } {
  const sourceIds = graph.nodes.filter((n) => n.kind === 'source').map((n) => n.entity_id)
  const claimIds = graph.nodes.filter((n) => n.kind === 'claim').map((n) => n.entity_id)
  return { sourceIds, claimIds }
}

function collectFromMarks(state: ProjectState): { sourceIds: string[]; claimIds: string[] } {
  return {
    sourceIds: state.marks.filter((m) => m.entity_type === 'source').map((m) => m.entity_id),
    claimIds: state.marks.filter((m) => m.entity_type === 'claim').map((m) => m.entity_id),
  }
}

/** Sicht oder Marks — kein Rohdump des ganzen Projekts. */
export function resolveWritingScope(
  repo: Repo,
  input: { project_id: string; visual_version_id?: string; scope?: 'marked' }
): WritingScope {
  const state = repo.getProjectState(input.project_id)
  let graph: VisualGraph | null = null
  let scopeLabel: string
  let sourceIds: string[]
  let claimIds: string[]
  let visualVersionId: string | null = null

  if (input.visual_version_id) {
    const packed = getVisualVersion(repo, { project_id: input.project_id, version_id: input.visual_version_id })
    graph = packed.graph
    visualVersionId = packed.version.id
    scopeLabel = packed.version.id
    ;({ sourceIds, claimIds } = collectFromGraph(packed.graph))
  } else if (input.scope === 'marked') {
    scopeLabel = 'marked'
    ;({ sourceIds, claimIds } = collectFromMarks(state))
    if (sourceIds.length === 0 && claimIds.length === 0) {
      throw new ServiceError(
        'pack_empty',
        'Keine Markierungen — das Schreibpaket wäre leer.',
        'Markiere Quellen oder Aussagen auf der Karte, oder übergib visual_version_id einer gespeicherten Sicht.'
      )
    }
    graph = buildVisualGraph(state, 'argument_map', { scope: 'marked', marks: state.marks })
  } else {
    throw new ServiceError(
      'pack_invalid',
      'Schreibpaket braucht visual_version_id oder scope=marked — kein Rohdump des ganzen Projekts.',
      'Speichere eine Karten-Version oder markiere Punkte, und rufe dasselbe Werkzeug erneut auf.'
    )
  }

  const sourceSet = new Set(sourceIds)
  const claimSet = new Set(claimIds)
  const sources = state.sources.filter((s) => sourceSet.has(s.id))
  for (const link of state.links.filter((l) => claimSet.has(l.claim_id))) {
    const s = state.sources.find((x) => x.id === link.source_id)
    if (s && !sourceSet.has(s.id)) {
      sources.push(s)
      sourceSet.add(s.id)
    }
  }
  const claims = state.claims.filter((c) => claimSet.has(c.id))
  return {
    state,
    graph,
    scopeLabel,
    sources,
    claims,
    visualVersionId,
    sourceIds: [...sourceSet],
    claimIds,
  }
}

export function renderClaimsMd(state: ProjectState, claimIds: string[], sources: Source[]): string {
  const lines = ['# Aussagen dieser Sicht', '']
  const set = new Set(claimIds)
  const claims = state.claims.filter((c) => set.has(c.id))
  if (claims.length === 0) {
    lines.push('_Keine Aussagen in dieser Sicht._')
    return lines.join('\n') + '\n'
  }
  for (const claim of claims) {
    const links = state.links.filter((l) => l.claim_id === claim.id)
    const signed = links.some((l) => {
      const s = sources.find((x) => x.id === l.source_id)
      return s?.review_status === 'human_signed' && s.quote_verified !== 0
    })
    lines.push(`## ${claim.claim_text}`)
    lines.push('')
    lines.push(signed ? '- Status: **haltbar** (signiert und Quote ok)' : '- Status: belegt oder offen — prüfen')
    for (const link of links) {
      const src = sources.find((s) => s.id === link.source_id)
      const idx = src ? sources.indexOf(src) + 1 : undefined
      lines.push(`- ${src ? citeMarker(src, idx, true) : '[S?]'} ${link.support_type} · ${link.verification_status}`)
      lines.push(`  > ${link.quote_span}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function renderDoNotClaim(state: ProjectState, sources: Source[]): string {
  const lines = ['# Was du nicht behaupten darfst', '']
  const brief = state.researchBrief
  if (brief?.taboos) {
    lines.push('## Tabus aus dem Brief')
    lines.push('')
    lines.push(brief.taboos)
    lines.push('')
  }
  const pending = sources.filter((s) => s.review_status === 'pending' || s.quote_verified !== 1)
  if (pending.length) {
    lines.push('## Unsigniert / Beleg unsicher')
    lines.push('')
    for (const s of pending) lines.push(`- ${s.title}${s.citekey ? ` ([@${s.citekey}])` : ''}`)
    lines.push('')
  }
  const contrasts = state.links.filter((l) => l.support_type === 'contrasts')
  if (contrasts.length) {
    lines.push('## Widersprüche')
    lines.push('')
    for (const l of contrasts) {
      const claim = state.claims.find((c) => c.id === l.claim_id)
      lines.push(`- ${claim?.claim_text ?? l.claim_id}`)
    }
    lines.push('')
  }
  if (state.uncertaintyFlags.length) {
    lines.push('## Unsicherheits-Flags')
    lines.push('')
    for (const f of state.uncertaintyFlags) lines.push(`- ${f.uncertainty_reason}`)
    lines.push('')
  }
  if (state.excludedSources.length) {
    lines.push('## Gesichtet, verworfen')
    lines.push('')
    for (const e of state.excludedSources) lines.push(`- ${e.title ?? e.url}: ${e.reason}`)
    lines.push('')
  }
  if (lines.length === 2) lines.push('_Nichts explizit gesperrt._')
  return lines.join('\n') + '\n'
}

export function renderBericht(state: ProjectState, claims: Claim[], sources: Source[], visualVersionId: string | null): string {
  const bound = visualVersionId
    ? [...state.reportVersions].reverse().find((v) => v.visual_version_id === visualVersionId)
    : [...state.reportVersions].reverse().find((v) => v.mark_scope === 1)
  if (bound) return rewriteCiteMarkers(bound.content_markdown, sources)
  const lines = ['# Bericht dieser Sicht', '', '_Kein an diese Sicht gebundener Bericht — Aussagen aus der Karte:_', '']
  for (const c of claims) {
    const links = state.links.filter((l) => l.claim_id === c.id && l.support_type === 'supports')
    const markers = links
      .map((l) => {
        const s = sources.find((x) => x.id === l.source_id)
        return s ? citeMarker(s, undefined, true) : null
      })
      .filter(Boolean)
    lines.push(`- ${c.claim_text} ${markers.join(' ')}`.trim())
  }
  return lines.join('\n') + '\n'
}
