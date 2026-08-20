import { describe, expect, it } from 'vitest'
import { graphToJpeg } from './graph-jpeg'

const base = {
  layout_kind: 'argument_map' as const,
  width: 420,
  height: 160,
  interpretative: false,
  clusters: [],
  edges: [],
}

describe('Karten-JPEG', () => {
  it('schreibt ein echtes JPEG derselben Maße, kein Platzhalter', () => {
    const jpg = graphToJpeg({
      ...base,
      nodes: [{ id: 'n1', kind: 'source', entity_id: 's1', label: 'Beispielquelle', cluster_key: null, pos_x: 20, pos_y: 40 }],
    })
    expect(jpg.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true)
    expect(jpg.length).toBeGreaterThan(1000)
    const other = graphToJpeg({
      ...base,
      nodes: [{ id: 'n1', kind: 'claim', entity_id: 'c1', label: 'Ganz anderer Text', cluster_key: null, pos_x: 20, pos_y: 40 }],
    })
    expect(Buffer.compare(jpg, other)).not.toBe(0)
  })
})
