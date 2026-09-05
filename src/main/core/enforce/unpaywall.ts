import { resolveContactEmail, contactUserAgent } from '../contact-email'

/**
 * Unpaywall ist ein Locator, keine Quelle: DOI → legale OA-URL.
 * Der Volltext kommt weiter über fetch_source (SSRF-Guard, Snapshot).
 * API: CC0, Pflichtparameter email, 100k Calls/Tag.
 * https://unpaywall.org/products/api
 */

const TIMEOUT_MS = 8_000

export interface UnpaywallLocation {
  url: string
  version: string | null
  host_type: string | null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function pickUrl(loc: Record<string, unknown> | null): string | null {
  if (!loc) return null
  const pdf = asString(loc.url_for_pdf)
  if (pdf && /^https?:\/\//i.test(pdf)) return pdf
  const landing = asString(loc.url)
  if (landing && /^https?:\/\//i.test(landing)) return landing
  return null
}

/**
 * Fragt Unpaywall nach einer legalen Volltext-URL.
 * Fehler, Timeout, kein OA → null (dann Capture wie bisher).
 */
export async function lookupBestOaUrl(doi: string): Promise<UnpaywallLocation | null> {
  const id = doi.trim().replace(/^https?:\/\/doi.org\//i, '').toLowerCase()
  if (!/^10\.\d{4,9}\/\S+$/.test(id)) return null
  const path = encodeURIComponent(id).replace(/%2F/g, '/')
  const url = `https://api.unpaywall.org/v2/${path}?email=${encodeURIComponent(resolveContactEmail())}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': contactUserAgent() },
    })
    if (!res.ok) return null
    const body = asRecord(await res.json())
    if (!body || body.is_oa !== true) return null
    const loc = asRecord(body.best_oa_location)
    const oa = pickUrl(loc)
    if (!oa) return null
    return {
      url: oa,
      version: asString(loc?.version),
      host_type: asString(loc?.host_type),
    }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
