import { describe, expect, it } from 'vitest'
import { citedSourcesInMarkdown } from './citations'
import type { Source } from './types'

function src(over: Partial<Source> = {}): Source {
  return {
    id: 's1',
    project_id: 'p',
    url: 'https://example.org/a',
    title: 'A',
    retrieval_method: 'test',
    accessed_at: '2026-01-01',
    reason: 'r',
    extraction: 'e',
    contribution: 'c',
    verbatim_quote: 'q',
    quote_locator: null,
    quote_verified: 1,
    quote_match_score: 1,
    url_resolved: 1,
    review_status: 'pending',
    confidence: null,
    sub_question_id: null,
    document_id: null,
    quote_start: null,
    quote_end: null,
    doi: null,
    authors_json: null,
    year: null,
    venue: null,
    entry_type: null,
    citekey: 'muster2020beispiel',
    source_kind: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    place: null,
    edition: null,
    editors_json: null,
    booktitle: null,
    context_id: null,
    carrier_id: null,
    created_at: '2026-01-01',
    created_by: 'test',
    ...over,
  }
}

describe('citedSourcesInMarkdown', () => {
  it('findet [S#] und [@citekey]', () => {
    const a = src()
    const b = src({ id: 's2', citekey: 'other2021', url: 'https://example.org/b' })
    expect(citedSourcesInMarkdown('Siehe [S1] und [@other2021, p. 3].', [a, b]).map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('ignoriert unbekannte Marker', () => {
    expect(citedSourcesInMarkdown('[S9] [@ghost2020]', [src()])).toEqual([])
  })
})
