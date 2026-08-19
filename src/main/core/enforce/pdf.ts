import { extractText, getDocumentProxy } from 'unpdf'

/** Eigenes Limit, getrennt von 4 MB HTML: Papers sind oft größer, aber 20 MB reicht. */
export const MAX_PDF_BYTES = 20_000_000

export function isPdfMagic(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/** arXiv liefert `/pdf/1706.03762` ohne `.pdf`-Endung. */
export function urlLooksLikePdf(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase()
    return path.endsWith('.pdf') || path.includes('/pdf/')
  } catch {
    return /\.pdf(\?|#|$)/i.test(url) || /\/pdf\//i.test(url)
  }
}

export function contentTypeIsPdf(contentType: string): boolean {
  return /application\/pdf/i.test(contentType)
}

/**
 * Text aus PDF-Bytes. Zweispaltig/Formeln/Scan bleiben ungenau — für
 * arXiv-typischen Fließtext muss es greifen. Leerer Text = Scan ohne Textschicht.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const data = new Uint8Array(bytes.byteLength)
  data.set(bytes)
  const pdf = await getDocumentProxy(data)
  try {
    const result = await extractText(pdf, { mergePages: true })
    const text = String(result.text).replace(/\u0000/g, '').trim()
    return { text, pages: result.totalPages }
  } finally {
    try {
      await pdf.destroy()
    } catch {
      /* egal */
    }
  }
}
