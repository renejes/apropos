import { describe, expect, it } from 'vitest'
import { exportProjectMarkdown } from './markdown'
import type { ProjectState, SearchLogEntry, SearchReflection } from '../../../shared/types'

function state(over: Partial<ProjectState> = {}): ProjectState {
  return {
    project: {
      id: 'p1',
      title: 'Lage sichtbar',
      research_question: 'Trägt die Lage ins Artefakt?',
      mode: 'academic',
      policy_preset: null,
      easy_writing_dir: null,
      kind: 'research',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    sources: [],
    extractions: [],
    claims: [],
    links: [],
    reportVersions: [],
    chatMessages: [],
    reviews: [],
    uncertaintyFlags: [],
    searchLog: [],
    searchReflections: [],
    excludedSources: [],
    subQuestions: [],
    rounds: [],
    marks: [],
    visualVersions: [],
    researchBrief: null,
    documents: [],
    notes: [],
    ...over,
  }
}

function search(over: Partial<SearchLogEntry> & Pick<SearchLogEntry, 'id' | 'query'>): SearchLogEntry {
  return {
    project_id: 'p1',
    engine: 'web',
    results_found: 4,
    note: null,
    reflection_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: 'agent',
    ...over,
  }
}

function reflection(over: Partial<SearchReflection> = {}): SearchReflection {
  return {
    id: 'r1',
    project_id: 'p1',
    covered: 'Die Treffer bedienen die Methodenfrage zum Offset-Zitat.',
    underrepresented: 'Gegenpositionen fehlen gegenüber dem Brief-Ziel.',
    next_action: 'search',
    next_query: 'historical reviews of provenance',
    reason: 'Die Methodenfrage ist grob getroffen; als Nächstes die Gegenposition suchen.',
    sub_question_id: null,
    created_at: '2026-01-01T00:01:00.000Z',
    created_by: 'agent',
    ...over,
  }
}

describe('Markdown-Export Such-Lage', () => {
  it('schreibt Getroffen, Unterrepräsentiert und den nächsten Schritt ins Artefakt', () => {
    const md = exportProjectMarkdown(
      state({
        searchLog: [search({ id: 's1', query: 'offset quote provenance', reflection_id: 'r1' })],
        searchReflections: [reflection()],
      })
    )
    expect(md).toMatch(/## Suchdokumentation/)
    expect(md).toMatch(/offset quote provenance/)
    expect(md).toMatch(/\*\*Getroffen:\*\* Die Treffer bedienen die Methodenfrage/)
    expect(md).toMatch(/\*\*Unterrepräsentiert:\*\* Gegenpositionen fehlen/)
    expect(md).toMatch(/weiter suchen/)
    expect(md).toMatch(/historical reviews of provenance/)
  })

  it('weist eine ausstehende Lage aus', () => {
    const md = exportProjectMarkdown(state({ searchLog: [search({ id: 's1', query: 'noch offen' })] }))
    expect(md).toMatch(/Lage ausstehend/)
    expect(md).not.toMatch(/Getroffen:/)
  })
})
