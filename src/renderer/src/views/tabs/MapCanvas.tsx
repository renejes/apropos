import type { VisualGraph, VisualRelation } from '../../../../shared/types'
import { Icon } from '../../components/ui'

const NODE_W = 210
const NODE_H = 56

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

function isDashed(rel: VisualRelation): boolean {
  return rel === 'part_of' || rel === 'needs_research'
}

export type NodeDiff = 'both' | 'only-left' | 'only-right' | null

export default function MapCanvas({
  graph,
  marked,
  selectedKey,
  diffOf,
  onSelect,
  onToggleMark,
}: {
  graph: VisualGraph
  marked: Set<string>
  selectedKey: string | null
  diffOf?: (kind: string, entityId: string) => NodeDiff
  onSelect: (kind: 'source' | 'claim' | 'sub_question', entityId: string) => void
  onToggleMark: (kind: 'source' | 'claim', entityId: string) => void
}) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  return (
    <div className="relative overflow-auto border border-hairline bg-bg" style={{ backgroundImage: 'radial-gradient(#dddddd 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
      <div className="relative" style={{ width: graph.width, height: graph.height, minWidth: '100%' }}>
        <svg className="pointer-events-none absolute inset-0" width={graph.width} height={graph.height}>
          {graph.edges.map((e) => {
            const from = byId.get(e.from_node)
            const to = byId.get(e.to_node)
            if (!from || !to) return null
            const x1 = from.pos_x + NODE_W / 2
            const y1 = from.pos_y + NODE_H / 2
            const x2 = to.pos_x + NODE_W / 2
            const y2 = to.pos_y + NODE_H / 2
            const cx = (x1 + x2) / 2
            const cy = Math.min(y1, y2) - 24
            const color = relationColor(e.relation)
            return (
              <path
                key={e.id}
                d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeDasharray={isDashed(e.relation) ? '5 4' : undefined}
                opacity={0.85}
              />
            )
          })}
        </svg>

        {graph.nodes.map((n) => {
          const key = `${n.kind}:${n.entity_id}`
          const isMarked = n.kind !== 'sub_question' && marked.has(key)
          const selected = selectedKey === key
          const diff = diffOf?.(n.kind, n.entity_id) ?? null
          const inverted = selected || n.kind === 'sub_question'
          const ring =
            diff === 'only-left'
              ? 'outline outline-2 outline-warn'
              : diff === 'only-right'
                ? 'outline outline-2 outline-info'
                : diff === 'both'
                  ? 'outline outline-1 outline-ok'
                  : 'border border-hairline'
          const kindStyle = inverted
            ? 'bg-fg text-bg'
            : n.kind === 'claim'
              ? 'border-l-4 border-l-line bg-bg'
              : 'bg-bg'
          return (
            <div
              key={n.id}
              className={`absolute flex items-stretch overflow-hidden ${ring} ${kindStyle}`}
              style={{ left: n.pos_x, top: n.pos_y, width: NODE_W, height: NODE_H }}
            >
              <button
                type="button"
                onClick={() => onSelect(n.kind, n.entity_id)}
                className="min-w-0 flex-1 px-2 py-1.5 text-left"
              >
                <span className={`block font-mono text-[10px] uppercase tracking-wide ${inverted ? 'text-bg/70' : 'text-muted'}`}>
                  {n.kind === 'source' ? 'Quelle' : n.kind === 'claim' ? 'Aussage' : 'Teilfrage'}
                </span>
                <span className={`block truncate text-xs leading-snug ${inverted ? 'text-bg' : 'text-fg'}`}>
                  {n.label}
                </span>
              </button>
              {n.kind !== 'sub_question' && (
                <button
                  type="button"
                  title={isMarked ? 'Markierung lösen' : 'Für Arbeitsset markieren'}
                  onClick={() => {
                    if (n.kind === 'source' || n.kind === 'claim') onToggleMark(n.kind, n.entity_id)
                  }}
                  className={`shrink-0 px-1.5 ${isMarked ? 'text-warn' : inverted ? 'text-bg/40 hover:text-warn' : 'text-muted hover:text-warn'}`}
                >
                  <Icon name={isMarked ? 'star' : 'star'} className={`!text-[18px] ${isMarked ? '' : 'opacity-40'}`} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
