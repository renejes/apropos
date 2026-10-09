import { describe, expect, it } from 'vitest'
import { buildAgentDeskFolders, buildHumanDeskFolders, deskSurfaceForFocus, findDeskFolder } from './desk'
import type { FetchedDocument, ProjectState, ScreeningCandidate, Source } from './types'

function source(over: Partial<Source> = {}): Source {
  return {
    id: 's1',
    project_id: 'p',
    url: 'https://example.org/a',
    title: 'Quelle A',
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
    document_id: 'd1',
    quote_start: 0,
    quote_end: 10,
    doi: '10.1/a',
    authors_json: null,
    year: 2020,
    venue: null,
    entry_type: null,
    citekey: null,
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
    created_at: '2026-01-02',
    created_by: 'test',
    ...over,
  }
}

function candidate(over: Partial<ScreeningCandidate> = {}): ScreeningCandidate {
  return {
    id: 'c1',
    project_id: 'p',
    doi: '10.1/a',
    url: 'https://example.org/a',
    oa_url: null,
    title: 'Dieselbe Arbeit',
    authors: [],
    year: 2020,
    venue: 'Journal',
    abstract: 'Abs',
    cited_by_count: null,
    is_open_access: true,
    found_via: ['openalex'],
    query: 'q',
    search_log_id: null,
    status: 'included',
    decision_reason: null,
    decided_at: null,
    decided_by: null,
    document_id: 'd1',
    parent_url: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...over,
  }
}

function doc(over: Partial<Omit<FetchedDocument, 'text'>> = {}): Omit<FetchedDocument, 'text'> {
  return {
    id: 'd1',
    project_id: 'p',
    url: 'https://example.org/a',
    title: 'Doc',
    char_len: 10,
    content_hash: 'h',
    fetched_at: '2026-01-01',
    fetched_by: 'test',
    purpose: null,
    status: 'open',
    origin: 'fetched',
    filename: null,
    page_starts: null,
    capture_reason: null,
    document_role: 'work',
    ...over,
  }
}

function state(over: Partial<Pick<ProjectState, 'sources' | 'screeningCandidates' | 'documents'>> = {}) {
  return {
    sources: [] as Source[],
    screeningCandidates: [] as ScreeningCandidate[],
    documents: [] as Array<Omit<FetchedDocument, 'text'>>,
    ...over,
  }
}

describe('Human Desk', () => {
  it('zeigt nur angelegte Quellen, nicht denselben Screening-Treffer', () => {
    const folders = buildHumanDeskFolders(
      state({
        sources: [source()],
        screeningCandidates: [candidate()],
        documents: [doc()],
      })
    )
    expect(folders).toHaveLength(1)
    expect(folders[0]?.id).toBe('source:s1')
    expect(folders[0]?.surface).toBe('human')
    expect(folders[0]?.pile).toBe('open')
  })

  it('sortiert offen vor übernommen vor abgelehnt', () => {
    const folders = buildHumanDeskFolders(
      state({
        sources: [
          source({ id: 'rej', review_status: 'rejected', url: 'https://example.org/r', doi: null, document_id: null, created_at: '2026-01-03' }),
          source({ id: 'ok', review_status: 'human_signed', url: 'https://example.org/ok', doi: null, document_id: null, created_at: '2026-01-02' }),
          source({ id: 'pend', review_status: 'pending', url: 'https://example.org/p', doi: null, document_id: null, created_at: '2026-01-01' }),
        ],
      })
    )
    expect(folders.map((f) => f.source?.id)).toEqual(['pend', 'ok', 'rej'])
  })
})

describe('Agent-Desk', () => {
  it('lässt Screening ohne Quelle als Treffer liegen', () => {
    const folders = buildAgentDeskFolders(
      state({
        screeningCandidates: [candidate({ id: 'c2', doi: '10.2/b', url: 'https://example.org/b', document_id: null, status: 'undecided' })],
      })
    )
    expect(folders).toHaveLength(1)
    expect(folders[0]?.id).toBe('screening:c2')
    expect(folders[0]?.surface).toBe('agent')
    expect(folders[0]?.pile).toBe('open')
  })

  it('blendet Treffer aus, sobald dieselbe Arbeit eine Quelle ist', () => {
    const folders = buildAgentDeskFolders(
      state({
        sources: [source()],
        screeningCandidates: [candidate()],
        documents: [doc()],
      })
    )
    expect(folders).toHaveLength(0)
  })

  it('ordnet Fokus auf Quellen dem Desk zu, Treffer dem Agent-Desk', () => {
    const withSource = state({ sources: [source()], documents: [doc()] })
    expect(deskSurfaceForFocus(withSource, { sourceId: 's1' })).toBe('human')
    expect(deskSurfaceForFocus(withSource, { documentId: 'd1' })).toBe('human')
    expect(deskSurfaceForFocus(state({ screeningCandidates: [candidate({ doi: '10.9/x' })] }), { documentId: 'other' })).toBe('agent')
  })

  it('legt unzugeordnete Dokumente auf den Agent-Desk', () => {
    const folders = buildAgentDeskFolders(
      state({
        documents: [doc({ id: 'orphan', url: 'https://example.org/x', title: 'Gelesen ohne Quelle' })],
      })
    )
    expect(folders).toHaveLength(1)
    expect(folders[0]?.id).toBe('document:orphan')
    expect(folders[0]?.pile).toBe('open')
  })
})

describe('findDeskFolder', () => {
  it('findet den Ordner über Quelle oder Dokument', () => {
    const folders = buildHumanDeskFolders(state({ sources: [source()] }))
    expect(findDeskFolder(folders, { sourceId: 's1' })?.id).toBe('source:s1')
    expect(findDeskFolder(folders, { documentId: 'd1' })?.id).toBe('source:s1')
  })
})
