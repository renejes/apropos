import { loadRootSettings, resolvedDataRoot, saveRootSettings } from './data-root'
import type { ContactEmailInfo } from '../../shared/types'

/** Fallback, wenn weder Umgebung noch Einstellungen eine Mail setzen. */
export const DEFAULT_CONTACT_EMAIL = 'apropos@localhost'

const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeContactEmail(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!LOOKS_LIKE_EMAIL.test(trimmed)) return null
  return trimmed
}

export function resolveContactEmail(root = resolvedDataRoot()): string {
  const env = process.env.ROP_CONTACT_EMAIL?.trim()
  if (env) return env
  const stored = loadRootSettings(root).contactEmail?.trim()
  if (stored) return stored
  return DEFAULT_CONTACT_EMAIL
}

export function contactUserAgent(root = resolvedDataRoot()): string {
  return `ResearchOverviewPlatform/0.1 (+mailto:${resolveContactEmail(root)})`
}

export function describeContactEmail(root = resolvedDataRoot()): ContactEmailInfo {
  const env = process.env.ROP_CONTACT_EMAIL?.trim() || null
  const stored = loadRootSettings(root).contactEmail?.trim() || null
  const source = env ? 'env' : stored ? 'settings' : 'default'
  return {
    value: resolveContactEmail(root),
    stored,
    source,
    envLocked: Boolean(env),
  }
}

export function setStoredContactEmail(
  raw: string,
  root = resolvedDataRoot()
): { ok: true; info: ContactEmailInfo } | { ok: false; error: string; info: ContactEmailInfo } {
  const normalized = normalizeContactEmail(raw)
  if (raw.trim() && !normalized) {
    return {
      ok: false,
      error: 'Das sieht nicht nach einer E-Mail aus (z. B. name@domain.de).',
      info: describeContactEmail(root),
    }
  }
  saveRootSettings(root, { contactEmail: normalized })
  return { ok: true, info: describeContactEmail(root) }
}
