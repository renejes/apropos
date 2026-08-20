import { encode as encodeJpeg } from 'jpeg-js'
import type { VisualGraph, VisualRelation } from '../../../shared/types'
import { NODE_H, NODE_W } from './graph-svg'

/** JPEG der Evidenzkarte — dieselben Koordinaten wie SVG/MapCanvas, ohne Chromium. */

type Rgba = [number, number, number, number]

const BG: Rgba = [248, 250, 252, 255]
const INK: Rgba = [15, 23, 42, 255]
const MUTED: Rgba = [148, 163, 184, 255]

function relationRgb(rel: VisualRelation): Rgba {
  switch (rel) {
    case 'supports':
      return [5, 150, 105, 255]
    case 'contrasts':
      return [220, 38, 38, 255]
    case 'mentions':
      return [100, 116, 139, 255]
    case 'part_of':
      return [148, 163, 184, 255]
    case 'needs_research':
      return [217, 119, 6, 255]
    default: {
      const _never: never = rel
      return _never
    }
  }
}

function kindFill(kind: VisualGraph['nodes'][number]['kind']): { fill: Rgba; stroke: Rgba } {
  switch (kind) {
    case 'claim':
      return { fill: [239, 246, 255, 255], stroke: [147, 197, 253, 255] }
    case 'source':
      return { fill: [240, 253, 244, 255], stroke: [134, 239, 172, 255] }
    case 'sub_question':
      return { fill: [255, 247, 237, 255], stroke: [253, 186, 116, 255] }
    default: {
      const _never: never = kind
      return _never
    }
  }
}

class Raster {
  readonly w: number
  readonly h: number
  readonly data: Buffer

  constructor(w: number, h: number) {
    this.w = Math.max(1, Math.floor(w))
    this.h = Math.max(1, Math.floor(h))
    this.data = Buffer.alloc(this.w * this.h * 4)
    this.fill(BG)
  }

  private idx(x: number, y: number): number {
    return (y * this.w + x) * 4
  }

  fill(c: Rgba): void {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i] = c[0]
      this.data[i + 1] = c[1]
      this.data[i + 2] = c[2]
      this.data[i + 3] = c[3]
    }
  }

  plot(x: number, y: number, c: Rgba): void {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return
    const i = this.idx(xi, yi)
    this.data[i] = c[0]
    this.data[i + 1] = c[1]
    this.data[i + 2] = c[2]
    this.data[i + 3] = c[3]
  }

  fillRect(x: number, y: number, w: number, h: number, c: Rgba): void {
    const x0 = Math.max(0, Math.floor(x))
    const y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(this.w, Math.ceil(x + w))
    const y1 = Math.min(this.h, Math.ceil(y + h))
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) this.plot(xx, yy, c)
    }
  }

  strokeRect(x: number, y: number, w: number, h: number, c: Rgba, t = 1): void {
    this.fillRect(x, y, w, t, c)
    this.fillRect(x, y + h - t, w, t, c)
    this.fillRect(x, y, t, h, c)
    this.fillRect(x + w - t, y, t, h, c)
  }

  line(x0: number, y0: number, x1: number, y1: number, c: Rgba, width = 1.5): void {
    const dx = x1 - x0
    const dy = y1 - y0
    const steps = Math.max(2, Math.ceil(Math.hypot(dx, dy)))
    const r = Math.max(1, width)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = x0 + dx * t
      const y = y0 + dy * t
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy <= r * r) this.plot(x + ox, y + oy, c)
        }
      }
    }
  }

  quad(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, c: Rgba, dashed: boolean): void {
    const steps = 28
    let px = x1
    let py = y1
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      const x = u * u * x1 + 2 * u * t * cx + t * t * x2
      const y = u * u * y1 + 2 * u * t * cy + t * t * y2
      if (!dashed || i % 3 !== 0) this.line(px, py, x, y, c, 1.4)
      px = x
      py = y
    }
  }

  text(x: number, y: number, raw: string, c: Rgba, scale = 1.4): void {
    const s = foldLabel(raw)
    let cx = x
    for (const ch of s) {
      const segs = glyph(ch)
      for (const [ax, ay, bx, by] of segs) {
        this.line(cx + ax * scale, y + ay * scale, cx + bx * scale, y + by * scale, c, 0.9)
      }
      cx += 6 * scale
      if (cx > x + NODE_W - 16) break
    }
  }
}

/** Umlaute zu ASCII, damit die Stick-Schrift greift — keine erfundene Glyphe. */
function foldLabel(s: string): string {
  return s
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

/** Stick-Schrift 5×7, öffentliche geometrische Grundformen. */
function glyph(ch: string): Array<[number, number, number, number]> {
  const g = GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()]
  return g ?? [[0, 6, 4, 6]]
}

const GLYPHS: Record<string, Array<[number, number, number, number]>> = {
  ' ': [],
  '-': [[0, 3.5, 4, 3.5]],
  '.': [[1.5, 6.5, 2.5, 6.5]],
  ',': [[2, 6, 1, 7.5]],
  ':': [[2, 2, 2, 2.5], [2, 5, 2, 5.5]],
  '?': [[0, 2, 0, 1], [0, 1, 2, 0], [2, 0, 4, 1], [4, 1, 4, 2.5], [4, 2.5, 2, 3.5], [2, 5, 2, 5.5], [2, 6.5, 2, 7]],
  '!': [[2, 0, 2, 5], [2, 6.5, 2, 7]],
  '/': [[4, 0, 0, 7]],
  '(': [[3, 0, 1, 2], [1, 2, 1, 5], [1, 5, 3, 7]],
  ')': [[1, 0, 3, 2], [3, 2, 3, 5], [3, 5, 1, 7]],
  '&': [[4, 7, 0, 3], [0, 3, 0, 1], [0, 1, 2, 0], [2, 0, 4, 2], [4, 2, 0, 6]],
  '0': [[1, 0, 3, 0], [3, 0, 4, 2], [4, 2, 4, 5], [4, 5, 3, 7], [3, 7, 1, 7], [1, 7, 0, 5], [0, 5, 0, 2], [0, 2, 1, 0], [0, 5, 4, 2]],
  '1': [[1, 1, 2, 0], [2, 0, 2, 7], [0, 7, 4, 7]],
  '2': [[0, 2, 1, 0], [1, 0, 3, 0], [3, 0, 4, 2], [4, 2, 0, 7], [0, 7, 4, 7]],
  '3': [[0, 0, 4, 0], [4, 0, 2, 3], [2, 3, 4, 4], [4, 4, 4, 6], [4, 6, 2, 7], [2, 7, 0, 6]],
  '4': [[3, 0, 0, 5], [0, 5, 4, 5], [3, 0, 3, 7]],
  '5': [[4, 0, 0, 0], [0, 0, 0, 3], [0, 3, 3, 3], [3, 3, 4, 5], [4, 5, 3, 7], [3, 7, 0, 7]],
  '6': [[3, 0, 0, 4], [0, 4, 0, 6], [0, 6, 2, 7], [2, 7, 4, 6], [4, 6, 4, 4], [4, 4, 2, 3], [2, 3, 0, 4]],
  '7': [[0, 0, 4, 0], [4, 0, 1, 7]],
  '8': [[1, 0, 3, 0], [3, 0, 4, 1.5], [4, 1.5, 3, 3], [3, 3, 1, 3], [1, 3, 0, 1.5], [0, 1.5, 1, 0], [1, 3, 0, 5], [0, 5, 1, 7], [1, 7, 3, 7], [3, 7, 4, 5], [4, 5, 3, 3]],
  '9': [[1, 7, 4, 3], [4, 3, 4, 1], [4, 1, 2, 0], [2, 0, 0, 1], [0, 1, 0, 3], [0, 3, 2, 4], [2, 4, 4, 3]],
  A: [[0, 7, 2, 0], [2, 0, 4, 7], [1, 4, 3, 4]],
  B: [[0, 0, 0, 7], [0, 0, 3, 0], [3, 0, 4, 1.5], [4, 1.5, 3, 3], [3, 3, 0, 3], [3, 3, 4, 5], [4, 5, 3, 7], [3, 7, 0, 7]],
  C: [[4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 2], [0, 2, 0, 5], [0, 5, 1, 7], [1, 7, 3, 7], [3, 7, 4, 6]],
  D: [[0, 0, 0, 7], [0, 0, 2.5, 0], [2.5, 0, 4, 2], [4, 2, 4, 5], [4, 5, 2.5, 7], [2.5, 7, 0, 7]],
  E: [[4, 0, 0, 0], [0, 0, 0, 7], [0, 7, 4, 7], [0, 3.5, 3, 3.5]],
  F: [[4, 0, 0, 0], [0, 0, 0, 7], [0, 3.5, 3, 3.5]],
  G: [[4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 2], [0, 2, 0, 5], [0, 5, 1, 7], [1, 7, 3, 7], [3, 7, 4, 5], [4, 5, 4, 3.5], [4, 3.5, 2, 3.5]],
  H: [[0, 0, 0, 7], [4, 0, 4, 7], [0, 3.5, 4, 3.5]],
  I: [[1, 0, 3, 0], [2, 0, 2, 7], [1, 7, 3, 7]],
  J: [[2, 0, 4, 0], [4, 0, 4, 5], [4, 5, 2, 7], [2, 7, 0, 5]],
  K: [[0, 0, 0, 7], [4, 0, 0, 4], [1.5, 3.5, 4, 7]],
  L: [[0, 0, 0, 7], [0, 7, 4, 7]],
  M: [[0, 7, 0, 0], [0, 0, 2, 3], [2, 3, 4, 0], [4, 0, 4, 7]],
  N: [[0, 7, 0, 0], [0, 0, 4, 7], [4, 7, 4, 0]],
  O: [[1, 0, 3, 0], [3, 0, 4, 2], [4, 2, 4, 5], [4, 5, 3, 7], [3, 7, 1, 7], [1, 7, 0, 5], [0, 5, 0, 2], [0, 2, 1, 0]],
  P: [[0, 7, 0, 0], [0, 0, 3, 0], [3, 0, 4, 1.5], [4, 1.5, 3, 3.5], [3, 3.5, 0, 3.5]],
  Q: [[1, 0, 3, 0], [3, 0, 4, 2], [4, 2, 4, 5], [4, 5, 3, 7], [3, 7, 1, 7], [1, 7, 0, 5], [0, 5, 0, 2], [0, 2, 1, 0], [2, 5, 4, 7]],
  R: [[0, 7, 0, 0], [0, 0, 3, 0], [3, 0, 4, 1.5], [4, 1.5, 3, 3.5], [3, 3.5, 0, 3.5], [2, 3.5, 4, 7]],
  S: [[4, 1, 3, 0], [3, 0, 1, 0], [1, 0, 0, 1.5], [0, 1.5, 1, 3], [1, 3, 3, 4], [3, 4, 4, 5.5], [4, 5.5, 3, 7], [3, 7, 1, 7], [1, 7, 0, 6]],
  T: [[0, 0, 4, 0], [2, 0, 2, 7]],
  U: [[0, 0, 0, 5], [0, 5, 1, 7], [1, 7, 3, 7], [3, 7, 4, 5], [4, 5, 4, 0]],
  V: [[0, 0, 2, 7], [2, 7, 4, 0]],
  W: [[0, 0, 1, 7], [1, 7, 2, 3], [2, 3, 3, 7], [3, 7, 4, 0]],
  X: [[0, 0, 4, 7], [4, 0, 0, 7]],
  Y: [[0, 0, 2, 3.5], [4, 0, 2, 3.5], [2, 3.5, 2, 7]],
  Z: [[0, 0, 4, 0], [4, 0, 0, 7], [0, 7, 4, 7]],
}

export function graphToJpeg(graph: VisualGraph, quality = 82): Buffer {
  const w = Math.max(1, Math.ceil(graph.width))
  const h = Math.max(1, Math.ceil(graph.height))
  const r = new Raster(w, h)
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  for (const e of graph.edges) {
    const from = byId.get(e.from_node)
    const to = byId.get(e.to_node)
    if (!from || !to) continue
    const x1 = from.pos_x + NODE_W / 2
    const y1 = from.pos_y + NODE_H / 2
    const x2 = to.pos_x + NODE_W / 2
    const y2 = to.pos_y + NODE_H / 2
    const cx = (x1 + x2) / 2
    const cy = Math.min(y1, y2) - 24
    const dashed = e.relation === 'part_of' || e.relation === 'needs_research'
    r.quad(x1, y1, cx, cy, x2, y2, relationRgb(e.relation), dashed)
  }

  for (const n of graph.nodes) {
    const { fill, stroke } = kindFill(n.kind)
    r.fillRect(n.pos_x, n.pos_y, NODE_W, NODE_H, fill)
    r.strokeRect(n.pos_x, n.pos_y, NODE_W, NODE_H, stroke, 2)
    const caption = n.kind === 'source' ? 'QUELLE' : n.kind === 'claim' ? 'AUSSAGE' : 'TEILFRAGE'
    r.text(n.pos_x + 10, n.pos_y + 8, caption, MUTED, 1)
    r.text(n.pos_x + 10, n.pos_y + 26, n.label.slice(0, 28), INK, 1.45)
  }

  return encodeJpeg({ data: r.data, width: w, height: h }, quality).data
}
