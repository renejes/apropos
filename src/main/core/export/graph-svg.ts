import type { VisualGraph, VisualRelation } from '../../../shared/types'

/** Dieselben Maße wie MapCanvas — eine Layout-Wahrheit. */
export const NODE_W = 210
export const NODE_H = 56

function relationColor(rel: VisualRelation): string {
  switch (rel) {
    case 'supports':
      return '#059669'
    case 'contrasts':
      return '#dc2626'
    case 'mentions':
      return '#64748b'
    case 'part_of':
      return '#94a3b8'
    case 'needs_research':
      return '#d97706'
    default: {
      const _never: never = rel
      return _never
    }
  }
}

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Raster-fähiges SVG der Evidenzkarte. Koordinaten identisch zur Live-Karte.
 */
export function graphToSvg(graph: VisualGraph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const edges = graph.edges
    .map((e) => {
      const from = byId.get(e.from_node)
      const to = byId.get(e.to_node)
      if (!from || !to) return ''
      const x1 = from.pos_x + NODE_W / 2
      const y1 = from.pos_y + NODE_H / 2
      const x2 = to.pos_x + NODE_W / 2
      const y2 = to.pos_y + NODE_H / 2
      const cx = (x1 + x2) / 2
      const cy = Math.min(y1, y2) - 24
      const dash = e.relation === 'part_of' || e.relation === 'needs_research' ? ' stroke-dasharray="5 4"' : ''
      return `<path d="M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}" fill="none" stroke="${relationColor(e.relation)}" stroke-width="1.5"${dash} opacity="0.85"/>`
    })
    .join('')

  const nodes = graph.nodes
    .map((n) => {
      const fill = n.kind === 'claim' ? '#eff6ff' : n.kind === 'source' ? '#f0fdf4' : '#fff7ed'
      const stroke = n.kind === 'claim' ? '#93c5fd' : n.kind === 'source' ? '#86efac' : '#fdba74'
      const label = xml(n.label.slice(0, 42))
      return `<g>
  <rect x="${n.pos_x}" y="${n.pos_y}" width="${NODE_W}" height="${NODE_H}" rx="10" fill="${fill}" stroke="${stroke}"/>
  <text x="${n.pos_x + 10}" y="${n.pos_y + 32}" font-family="system-ui,sans-serif" font-size="12" fill="#0f172a">${label}</text>
</g>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${graph.width}" height="${graph.height}" viewBox="0 0 ${graph.width} ${graph.height}">
  <rect width="100%" height="100%" fill="#f8fafc"/>
  ${edges}
  ${nodes}
</svg>`
}
