import { createHash } from 'crypto'
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import { contentTypeIsPdf, extractPdfText, isPdfMagic, MAX_PDF_BYTES, urlLooksLikePdf } from './pdf'
import { htmlToText } from './textmatch'

/**
 * Netz-Zugriffe der Verifikations-Ebene 1: URL-/DOI-Auflösung und
 * frisches Fetchen des Quelltexts (für Quote-in-Source und den geblindeten
 * Re-Verify-Pass). Quellinhalte werden strikt als DATEN behandelt, nie als
 * Instruktion (Prompt-Injection-Schutz, siehe documentation/01).
 *
 * SSRF-Schutz: Private/reservierte IP-Bereiche (localhost, RFC1918,
 * Link-Local/Cloud-Metadata 169.254.x, ULA/Loopback v6) werden geblockt —
 * pro Redirect-Hop neu geprüft. Override nur für Tests via
 * RESEARCH_ALLOW_PRIVATE_FETCH=1.
 */

const FETCH_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 4_000_000 // 4 MB reichen für HTML/Text-Checks
const MAX_REDIRECTS = 5
const USER_AGENT = 'ResearchOverviewPlatform/0.1 (provenance verification; +local)'

const allowPrivate = (): boolean => process.env.RESEARCH_ALLOW_PRIVATE_FETCH === '1'

export interface UrlCheckResult {
  reachable: boolean | null // null = Prüfung nicht möglich (z. B. offline)
  status: number | null
  finalUrl: string | null
  isDoi: boolean
  note: string
}

export interface SourceTextResult {
  ok: boolean
  text: string
  snapshotHash: string | null
  status: number | null
  note: string
  pageStarts?: number[] | null
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) }
}

export function extractDoi(url: string): string | null {
  const m = url.match(/10\.\d{4,9}\/[^\s"'<>]+/i)
  return m ? m[0].replace(/[.,;)\]]+$/, '') : null
}

// ---------------------------------------------------------------- SSRF-Guard

function isPrivateIpV4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true
  const [a, b] = parts
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local + Cloud-Metadata!
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 192 && b === 0) || // 192.0.0.0/24 & Doku-Netze
    (a === 198 && (b === 18 || b === 19)) || // Benchmarking
    a >= 224 // Multicast/Reserved
  )
}

function isPrivateIpV6(ip: string): boolean {
  const low = ip.toLowerCase()
  if (low === '::' || low === '::1') return true
  if (low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb')) return true // link-local
  if (low.startsWith('fc') || low.startsWith('fd')) return true // ULA
  if (low.startsWith('::ffff:')) return isPrivateIpV4(low.slice(7)) // v4-mapped
  return false
}

/** Wirft, wenn der Host der URL auf eine private/reservierte IP zeigt. */
async function assertPublicHost(url: URL): Promise<void> {
  if (allowPrivate()) return
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`blocked protocol ${url.protocol}`)
  const host = url.hostname
  const family = isIP(host)
  const addresses: string[] = []
  if (family !== 0) {
    addresses.push(host)
  } else {
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
      throw new Error(`blocked host ${host}`)
    }
    const resolved = await lookup(host, { all: true })
    for (const r of resolved) addresses.push(r.address)
  }
  for (const addr of addresses) {
    const priv = isIP(addr) === 6 ? isPrivateIpV6(addr) : isPrivateIpV4(addr)
    if (priv) throw new Error(`blocked private address ${addr} for host ${host} (SSRF-Schutz)`)
  }
}

/**
 * fetch mit manueller Redirect-Verfolgung: JEDER Hop wird gegen den
 * SSRF-Guard geprüft (redirect:'follow' würde nur den ersten Hop prüfen).
 */
async function guardedFetch(rawUrl: string, method: 'HEAD' | 'GET', accept: string): Promise<Response> {
  let current = new URL(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current)
    const { signal, cancel } = withTimeout(FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(current, {
        method,
        redirect: 'manual',
        signal,
        headers: { 'user-agent': USER_AGENT, accept },
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        cancel()
        try {
          await res.body?.cancel()
        } catch {
          /* egal */
        }
        if (!loc) return res
        current = new URL(loc, current)
        continue
      }
      // Kein cancel() hier: Timeout begrenzt weiterhin das Body-Lesen des Aufrufers.
      // (Timer-Cleanup übernimmt der Aufrufer implizit über GC nach abort/consume.)
      cancel()
      return res
    } catch (err) {
      cancel()
      throw err
    }
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`)
}

// ---------------------------------------------------------------- Checks

/** URL bzw. DOI auflösen. DOIs werden über doi.org verifiziert. */
export async function checkUrl(rawUrl: string): Promise<UrlCheckResult> {
  const doi = extractDoi(rawUrl)
  const target = doi ? `https://doi.org/${doi}` : rawUrl

  try {
    new URL(target)
  } catch {
    return { reachable: false, status: null, finalUrl: null, isDoi: !!doi, note: 'Invalid URL' }
  }

  // HEAD zuerst, GET als Fallback (viele Server beantworten HEAD nicht sauber)
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await guardedFetch(target, method, '*/*')
      if (method === 'GET' && res.body) {
        try {
          await res.body.cancel()
        } catch {
          /* egal */
        }
      }
      if (res.status < 400) {
        return { reachable: true, status: res.status, finalUrl: res.url, isDoi: !!doi, note: `${method} ${res.status}` }
      }
      if (method === 'GET') {
        return { reachable: false, status: res.status, finalUrl: res.url, isDoi: !!doi, note: `GET ${res.status}` }
      }
      // HEAD mit >=400: GET probieren
    } catch (err) {
      const msg = errMsg(err)
      if (msg.includes('SSRF') || msg.startsWith('blocked')) {
        return { reachable: false, status: null, finalUrl: null, isDoi: !!doi, note: msg }
      }
      if (method === 'GET') {
        return { reachable: null, status: null, finalUrl: null, isDoi: !!doi, note: `Network error: ${msg}` }
      }
    }
  }
  return { reachable: null, status: null, finalUrl: null, isDoi: !!doi, note: 'unreachable' }
}

/** Quelltext frisch fetchen (HTML → Text) inkl. Snapshot-Hash für Reproduzierbarkeit. */
export async function fetchSourceText(rawUrl: string): Promise<SourceTextResult> {
  try {
    new URL(rawUrl)
  } catch {
    return { ok: false, text: '', snapshotHash: null, status: null, note: 'Invalid URL' }
  }

  try {
    const res = await guardedFetch(rawUrl, 'GET', 'text/html,text/plain,application/xhtml+xml,application/pdf,*/*')
    if (res.status >= 400) {
      try {
        await res.body?.cancel()
      } catch {
        /* egal */
      }
      return { ok: false, text: '', snapshotHash: null, status: res.status, note: `HTTP ${res.status}` }
    }
    const contentType = res.headers.get('content-type') ?? ''
    const pdfHint = contentTypeIsPdf(contentType) || urlLooksLikePdf(rawUrl) || /octet-stream/i.test(contentType)
    const maxBytes = pdfHint ? MAX_PDF_BYTES : MAX_BODY_BYTES
    const bytes = await readBodyLimitedBytes(res, maxBytes)
    if (bytes.byteLength >= maxBytes && pdfHint) {
      return {
        ok: false,
        text: '',
        snapshotHash: null,
        status: res.status,
        note: `PDF größer als ${MAX_PDF_BYTES} Bytes — Limit überschritten`,
      }
    }

    if (contentTypeIsPdf(contentType) || isPdfMagic(bytes)) {
      try {
        const extracted = await extractPdfText(bytes)
        if (!extracted.text) {
          return {
            ok: false,
            text: '',
            snapshotHash: null,
            status: res.status,
            note: 'PDF ohne extrahierbare Textschicht (Scan/Bild). Fallback: add_source ohne document_id mit verbatim_quote — menschlicher Sign-off.',
          }
        }
        const snapshotHash = createHash('sha256').update(extracted.text).digest('hex').slice(0, 16)
        return {
          ok: true,
          text: extracted.text,
          snapshotHash,
          status: res.status,
          note: `ok (pdf, ${extracted.pages} Seite(n), ${contentType || 'application/pdf'})`,
          pageStarts: extracted.pageStarts,
        }
      } catch (err) {
        return {
          ok: false,
          text: '',
          snapshotHash: null,
          status: res.status,
          note: `PDF-Extraktion fehlgeschlagen: ${errMsg(err)}. Fallback: add_source ohne document_id mit verbatim_quote.`,
        }
      }
    }

    if (/image\/|video\/|audio\//i.test(contentType)) {
      return {
        ok: false,
        text: '',
        snapshotHash: null,
        status: res.status,
        note: `Binary content-type: ${contentType} (kein Text, Quote-Check nicht möglich)`,
      }
    }

    const raw = decodeUtf8(bytes)
    const text = /html/i.test(contentType) || raw.trimStart().startsWith('<') ? htmlToText(raw) : raw
    const snapshotHash = createHash('sha256').update(text).digest('hex').slice(0, 16)
    return { ok: true, text, snapshotHash, status: res.status, note: `ok (${contentType || 'unknown type'})` }
  } catch (err) {
    return { ok: false, text: '', snapshotHash: null, status: null, note: `Network error: ${errMsg(err)}` }
  }
}

async function readBodyLimitedBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    return buf.byteLength > maxBytes ? buf.subarray(0, maxBytes) : buf
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      chunks.push(value)
      if (total >= maxBytes) {
        try {
          await reader.cancel()
        } catch {
          /* egal */
        }
        break
      }
    }
  }
  const buf = new Uint8Array(Math.min(total, maxBytes))
  let offset = 0
  for (const c of chunks) {
    const slice = c.subarray(0, Math.min(c.byteLength, buf.byteLength - offset))
    buf.set(slice, offset)
    offset += slice.byteLength
    if (offset >= buf.byteLength) break
  }
  return buf
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.name === 'AbortError' ? 'timeout' : err.message
  return String(err)
}
