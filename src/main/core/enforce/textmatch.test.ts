import { describe, expect, it } from 'vitest'
import { htmlToText, normalizeText, quoteInSource } from './textmatch'

describe('normalizeText', () => {
  it('vereinheitlicht Whitespace und typografische Zeichen', () => {
    expect(normalizeText('„Hello   World“')).toBe('"hello world"')
    expect(normalizeText('a–b — c')).toBe('a-b - c')
  })
})

describe('quoteInSource', () => {
  const source =
    'The Model Context Protocol (MCP) is an open standard that enables AI systems to connect with external tools. ' +
    'It was introduced by Anthropic in November 2024 and has since been widely adopted across the industry.'

  it('findet exakte Zitate', () => {
    const r = quoteInSource('The Model Context Protocol (MCP) is an open standard', source)
    expect(r.found).toBe(true)
    expect(r.method).toBe('exact')
    expect(r.score).toBe(1)
  })

  it('findet Zitate trotz abweichender Anführungszeichen/Whitespace', () => {
    const r = quoteInSource('the model context  protocol (mcp) is an open standard', source)
    expect(r.found).toBe(true)
    expect(r.method).toBe('normalized')
  })

  it('findet leicht abweichende Zitate fuzzy', () => {
    const r = quoteInSource('The Model Context Protocol is an open standard that enables AI systems to connect', source)
    expect(r.found).toBe(true)
    expect(r.method).toBe('fuzzy')
    expect(r.score).toBeGreaterThanOrEqual(0.8)
  })

  it('lehnt fabrizierte Zitate ab', () => {
    const r = quoteInSource('MCP guarantees that all citations are always factually correct and verified', source)
    expect(r.found).toBe(false)
  })

  it('lehnt leere Eingaben ab', () => {
    expect(quoteInSource('', source).found).toBe(false)
    expect(quoteInSource('quote', '').found).toBe(false)
  })

  it('verkraftet Zitate, die länger als der Quelltext sind', () => {
    const r = quoteInSource(source + ' plus extra text far beyond', 'short text')
    expect(r.found).toBe(false)
  })
})

describe('htmlToText', () => {
  it('entfernt Tags, Skripte und dekodiert Entities', () => {
    const html =
      '<html><head><style>.a{color:red}</style><script>alert(1)</script></head>' +
      '<body><h1>Titel</h1><p>Erster &amp; zweiter Satz.</p><div>N&#228;chster Block</div></body></html>'
    const text = htmlToText(html)
    expect(text).toContain('Titel')
    expect(text).toContain('Erster & zweiter Satz.')
    expect(text).toContain('Nächster Block')
    expect(text).not.toContain('alert')
    expect(text).not.toContain('color:red')
  })

  it('erhält Zeilenumbrüche an Blockgrenzen', () => {
    const text = htmlToText('<p>eins</p><p>zwei</p>')
    expect(text.split('\n').map((l) => l.trim())).toEqual(['eins', 'zwei'])
  })
})
