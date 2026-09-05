import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTACT_EMAIL,
  describeContactEmail,
  normalizeContactEmail,
  resolveContactEmail,
  setStoredContactEmail,
} from './contact-email'

describe('Kontakt-Mail', () => {
  let root: string
  const prev = process.env.ROP_CONTACT_EMAIL

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    if (prev === undefined) delete process.env.ROP_CONTACT_EMAIL
    else process.env.ROP_CONTACT_EMAIL = prev
  })

  it('weist leere und kaputte Adressen ab', () => {
    expect(normalizeContactEmail('')).toBeNull()
    expect(normalizeContactEmail('  ')).toBeNull()
    expect(normalizeContactEmail('nicht-mail')).toBeNull()
    expect(normalizeContactEmail('a@localhost')).toBeNull()
    expect(normalizeContactEmail('name@domain.de')).toBe('name@domain.de')
  })

  it('nimmt Einstellungen, Umgebung hat Vorrang', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-mail-'))
    delete process.env.ROP_CONTACT_EMAIL
    expect(resolveContactEmail(root)).toBe(DEFAULT_CONTACT_EMAIL)
    expect(setStoredContactEmail('name@domain.de', root).ok).toBe(true)
    expect(resolveContactEmail(root)).toBe('name@domain.de')
    process.env.ROP_CONTACT_EMAIL = 'env@example.org'
    const info = describeContactEmail(root)
    expect(info.value).toBe('env@example.org')
    expect(info.envLocked).toBe(true)
    expect(info.stored).toBe('name@domain.de')
  })

  it('leert die gespeicherte Adresse und lehnt Ungültiges ab', () => {
    root = mkdtempSync(join(tmpdir(), 'rop-mail2-'))
    delete process.env.ROP_CONTACT_EMAIL
    setStoredContactEmail('name@domain.de', root)
    const cleared = setStoredContactEmail('', root)
    expect(cleared.ok).toBe(true)
    expect(cleared.info.value).toBe(DEFAULT_CONTACT_EMAIL)
    const bad = setStoredContactEmail('kein-at', root)
    expect(bad.ok).toBe(false)
    expect(bad.info.stored).toBeNull()
  })
})
