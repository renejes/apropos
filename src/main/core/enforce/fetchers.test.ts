import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractPdfText, isPdfMagic, urlLooksLikePdf } from './pdf'
import { buildMinimalPdf } from './minimal-pdf'
import { fetchSourceText } from './fetchers'

const QUOTE = 'Verifiable provenance is the foundation of trustworthy AI research.'

describe('PDF-Erkennung', () => {
  it('erkennt %PDF-Magic', () => {
    expect(isPdfMagic(buildMinimalPdf(QUOTE))).toBe(true)
    expect(isPdfMagic(Buffer.from('<html>'))).toBe(false)
  })

  it('erkennt arXiv-PDF-Pfade ohne .pdf-Endung', () => {
    expect(urlLooksLikePdf('https://arxiv.org/pdf/1706.03762')).toBe(true)
    expect(urlLooksLikePdf('https://arxiv.org/abs/1706.03762')).toBe(false)
    expect(urlLooksLikePdf('https://example.org/paper.pdf?download=1')).toBe(true)
  })
})

describe('PDF-Textextraktion', () => {
  it('schneidet den bekannten Satz aus der Fixture-PDF', async () => {
    const bytes = buildMinimalPdf(QUOTE)
    const { text, pages } = await extractPdfText(bytes)
    expect(pages).toBe(1)
    expect(text).toContain(QUOTE)
  })
})

describe('fetchSourceText: HTML und PDF', () => {
  let server: Server
  let port: number

  beforeAll(async () => {
    process.env.RESEARCH_ALLOW_PRIVATE_FETCH = '1'
    server = createServer((req, res) => {
      if (req.url === '/paper') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(`<p>${QUOTE}</p>`)
        return
      }
      if (req.url === '/paper.pdf') {
        const pdf = buildMinimalPdf(QUOTE)
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdf.length })
        res.end(pdf)
        return
      }
      if (req.url === '/octet.pdf') {
        const pdf = buildMinimalPdf(QUOTE)
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.end(pdf)
        return
      }
      if (req.url === '/pic.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
        return
      }
      res.writeHead(404)
      res.end('nope')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  it('liefert weiterhin HTML-Text', async () => {
    const r = await fetchSourceText(`http://127.0.0.1:${port}/paper`)
    expect(r.ok).toBe(true)
    expect(r.text).toContain(QUOTE)
  })

  it('extrahiert PDF-Text — Offset trifft den bekannten Satz', async () => {
    const r = await fetchSourceText(`http://127.0.0.1:${port}/paper.pdf`)
    expect(r.ok).toBe(true)
    expect(r.note).toMatch(/pdf/i)
    const start = r.text.indexOf(QUOTE)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(r.text.slice(start, start + QUOTE.length)).toBe(QUOTE)
  })

  it('erkennt PDF auch hinter application/octet-stream (Magic)', async () => {
    const r = await fetchSourceText(`http://127.0.0.1:${port}/octet.pdf`)
    expect(r.ok).toBe(true)
    expect(r.text).toContain(QUOTE)
  })

  it('lehnt Bilder weiterhin ab', async () => {
    const r = await fetchSourceText(`http://127.0.0.1:${port}/pic.png`)
    expect(r.ok).toBe(false)
    expect(r.note).toMatch(/image\//i)
  })
})
