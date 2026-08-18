/**
 * Quote-in-Source-Prüfung (Verifikations-Ebene 1, deterministisch).
 * Prüft, ob ein wörtliches Exzerpt tatsächlich im Quelltext vorkommt —
 * exakt oder fuzzy (normalisiert + Token-Fenster-Ähnlichkeit).
 * Fängt fabrizierte/verdrehte Zitate ohne jedes KI-Modell.
 */

export interface QuoteMatchResult {
  found: boolean
  score: number // 0..1 — 1 = exakter Treffer nach Normalisierung
  method: 'exact' | 'normalized' | 'fuzzy' | 'none'
}

/** Whitespace, typografische Anführungszeichen/Striche und Ligaturen vereinheitlichen. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Dice-Koeffizient über Token-Bigramme zweier Tokenlisten. */
function diceBigrams(a: string[], b: string[]): number {
  if (a.length < 2 || b.length < 2) {
    // zu kurz für Bigramme → Token-Overlap
    const setB = new Set(b)
    const overlap = a.filter((t) => setB.has(t)).length
    return a.length === 0 ? 0 : overlap / a.length
  }
  const bigrams = (toks: string[]) => {
    const m = new Map<string, number>()
    for (let i = 0; i < toks.length - 1; i++) {
      const key = `${toks[i]} ${toks[i + 1]}`
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }
  const ma = bigrams(a)
  const mb = bigrams(b)
  let inter = 0
  for (const [k, v] of ma) inter += Math.min(v, mb.get(k) ?? 0)
  const total = a.length - 1 + (b.length - 1)
  return total === 0 ? 0 : (2 * inter) / total
}

// Obergrenzen, damit der synchrone Scan den Electron-Main-Thread nie
// länger als ~100 ms blockiert (Review-Finding: UI/MCP-Starvation).
const MAX_SOURCE_TOKENS = 60_000
const MAX_QUOTE_TOKENS = 400

/**
 * Prüft, ob `quote` im `sourceText` vorkommt.
 * Schwelle für fuzzy: bestes Token-Fenster mit Dice ≥ 0.8.
 * Fuzzy-Suche: grober Stride-Scan + lokale Verfeinerung um den besten Treffer.
 */
export function quoteInSource(quote: string, sourceText: string, fuzzyThreshold = 0.8): QuoteMatchResult {
  if (!quote.trim() || !sourceText.trim()) return { found: false, score: 0, method: 'none' }

  if (sourceText.includes(quote)) return { found: true, score: 1, method: 'exact' }

  const nQuote = normalizeText(quote)
  const nSource = normalizeText(sourceText)
  if (nQuote.length > 0 && nSource.includes(nQuote)) return { found: true, score: 1, method: 'normalized' }

  // Fuzzy: Sliding Window über Quelltext-Tokens in Zitatlänge (bounded)
  const qToks = tokenize(quote).slice(0, MAX_QUOTE_TOKENS)
  const sToks = tokenize(sourceText).slice(0, MAX_SOURCE_TOKENS)
  if (qToks.length === 0 || sToks.length === 0) return { found: false, score: 0, method: 'none' }
  if (qToks.length > sToks.length) {
    const score = diceBigrams(qToks, sToks)
    return { found: score >= fuzzyThreshold, score, method: score >= fuzzyThreshold ? 'fuzzy' : 'none' }
  }

  const win = qToks.length
  const coarseStride = Math.max(1, Math.floor(win / 4))

  // Pass 1: grob mit Stride scannen
  let bestIdx = 0
  let best = 0
  for (let i = 0; i + win <= sToks.length; i += coarseStride) {
    const score = diceBigrams(qToks, sToks.slice(i, i + win))
    if (score > best) {
      best = score
      bestIdx = i
      if (best >= 0.999) break
    }
  }
  // Pass 2: lokal um den besten Treffer mit Schrittweite 1 verfeinern
  if (best < 0.999) {
    const from = Math.max(0, bestIdx - coarseStride)
    const to = Math.min(sToks.length - win, bestIdx + coarseStride)
    for (let i = from; i <= to; i++) {
      const score = diceBigrams(qToks, sToks.slice(i, i + win))
      if (score > best) best = score
    }
  }
  return { found: best >= fuzzyThreshold, score: round3(best), method: best >= fuzzyThreshold ? 'fuzzy' : 'none' }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** Sehr einfache, dependency-freie HTML→Text-Extraktion für den Quote-Check. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code)
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : ' '
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const n = parseInt(hex, 16)
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : ' '
    })
    // &amp; ZULETZT dekodieren — sonst wird '&amp;lt;' fälschlich doppelt zu '<'
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
