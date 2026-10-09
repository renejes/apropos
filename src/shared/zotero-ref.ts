/** Dokument-URL eines aus Zotero geholten PDFs. Die Citekey steckt im Fragment, nicht im Belegtext. */
export function zoteroDocumentUrl(itemKey: string, citekey: string | null): string {
  const base = `zotero://select/library/items/${itemKey}`
  if (!citekey) return base
  return `${base}#citekey=${encodeURIComponent(citekey)}`
}

export function citekeyPinnedOnDocument(url: string): string | null {
  if (!url.startsWith('zotero://')) return null
  const marker = '#citekey='
  const at = url.indexOf(marker)
  if (at < 0) return null
  try {
    const key = decodeURIComponent(url.slice(at + marker.length)).trim()
    return /^[A-Za-z][A-Za-z0-9_:-]{0,80}$/.test(key) ? key : null
  } catch {
    return null
  }
}
