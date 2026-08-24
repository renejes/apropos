import { describe, expect, it } from 'vitest'
import { groupSearchWaves, isFailedSearchAttempt, nextActionLabel } from './search-waves'
import type { SearchLogEntry, SearchReflection } from './types'

function search(over: Partial<SearchLogEntry> & Pick<SearchLogEntry, 'id' | 'query'>): SearchLogEntry {
  return {
    project_id: 'p',
    engine: 'web',
    results_found: 3,
    note: null,
    reflection_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: 'test',
    ...over,
  }
}

function reflection(over: Partial<SearchReflection> & Pick<SearchReflection, 'id'>): SearchReflection {
  return {
    project_id: 'p',
    covered: 'Methodenfrage getroffen.',
    underrepresented: 'Gegenposition fehlt gegenüber dem Ziel.',
    next_action: 'read',
    next_query: null,
    reason: 'Erst die Volltexte lesen.',
    sub_question_id: null,
    created_at: '2026-01-01T00:01:00.000Z',
    created_by: 'test',
    ...over,
  }
}

describe('groupSearchWaves', () => {
  it('hängt Suchen derselben Lage an eine Welle', () => {
    const r = reflection({ id: 'r1' })
    const waves = groupSearchWaves(
      [search({ id: 's1', query: 'a', reflection_id: 'r1' }), search({ id: 's2', query: 'b', reflection_id: 'r1' })],
      [r]
    )
    expect(waves).toHaveLength(1)
    expect(waves[0]!.searches.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(waves[0]!.reflection?.id).toBe('r1')
    expect(waves[0]!.blocksSearch).toBe(false)
  })

  it('markiert unbewertete Discovery-Suchen als sperrend', () => {
    const waves = groupSearchWaves([search({ id: 's1', query: 'offset quotes' })], [])
    expect(waves).toHaveLength(1)
    expect(waves[0]!.blocksSearch).toBe(true)
    expect(waves[0]!.reflection).toBeNull()
  })

  it('zählt fehlgeschlagene Backends nicht als sperrende Welle', () => {
    const waves = groupSearchWaves(
      [
        search({
          id: 's1',
          query: 'oa',
          results_found: null,
          note: 'FEHLGESCHLAGEN: alle Register tot',
        }),
      ],
      []
    )
    expect(waves[0]!.blocksSearch).toBe(false)
    expect(isFailedSearchAttempt(waves[0]!.searches[0]!)).toBe(true)
  })

  it('trennt zwei Lagen und hängt eine ausstehende Welle an', () => {
    const r1 = reflection({ id: 'r1', next_action: 'search', next_query: 'counter' })
    const waves = groupSearchWaves(
      [
        search({ id: 's1', query: 'first', reflection_id: 'r1' }),
        search({ id: 's2', query: 'pending' }),
      ],
      [r1]
    )
    expect(waves).toHaveLength(2)
    expect(waves[0]!.reflection?.id).toBe('r1')
    expect(waves[1]!.blocksSearch).toBe(true)
    expect(waves[1]!.searches[0]!.query).toBe('pending')
  })
})

describe('nextActionLabel', () => {
  it('benennt die drei Schritte', () => {
    expect(nextActionLabel('search')).toBe('weiter suchen')
    expect(nextActionLabel('read')).toBe('erst lesen')
    expect(nextActionLabel('enough')).toBe('reicht')
  })
})
