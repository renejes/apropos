import { describe, expect, it } from 'vitest'
import { parseDocumentFollow } from './follow-doc'

describe('parseDocumentFollow', () => {
  it('liest Fenster und document_id aus fetch_source', () => {
    const follow = parseDocumentFollow(
      'fetch_source',
      JSON.stringify({
        document_id: 'doc-1',
        window: { offset: 8000, length: 120, text: '…' },
        needs_capture: false,
      })
    )
    expect(follow).toEqual({ documentId: 'doc-1', start: 8000, end: 8120, capture: false })
  })

  it('markiert Capture-Aufträge', () => {
    const follow = parseDocumentFollow(
      'read_document',
      JSON.stringify({
        document_id: 'doc-2',
        window: { offset: 0, length: 0, text: '' },
        needs_capture: true,
      })
    )
    expect(follow).toEqual({ documentId: 'doc-2', start: 0, end: 0, capture: true })
  })

  it('liest Fenster aus include_screening', () => {
    const follow = parseDocumentFollow(
      'include_screening',
      JSON.stringify({
        candidate_id: 'sc-1',
        document_id: 'doc-3',
        window: { offset: 0, length: 40, text: '…' },
        needs_capture: false,
      })
    )
    expect(follow).toEqual({ documentId: 'doc-3', start: 0, end: 40, capture: false })
  })

  it('ignoriert andere Werkzeuge und Fehler-JSON', () => {
    expect(parseDocumentFollow('add_source', JSON.stringify({ document_id: 'x', window: { offset: 0, length: 1 } }))).toBeNull()
    expect(parseDocumentFollow('fetch_source', '{nein')).toBeNull()
    expect(parseDocumentFollow('ingest_local_file', JSON.stringify({ status: 'FEHLER — der Aufruf wurde ABGELEHNT' }))).toBeNull()
  })
})
