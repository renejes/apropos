import { describe, expect, it } from 'vitest'
import { sayableItems } from './sayable'
import type { ClaimSourceLink, Project, ProjectState, ResearchBrief, Source, UncertaintyFlag } from './types'

function project(): Project {
  return {
    id: 'p1',
    title: 'T',
    research_question: 'Q?',
    mode: 'academic',
    policy_preset: null,
    easy_writing_dir: null,
    kind: 'research',
    linked_research_id: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }
}

function source(over: Partial<Source>): Source {
  return {
    id: 's1',
    project_id: 'p1',
    url: 'https://example.org/a',
    title: 'Studie A',
    retrieval_method: 'test',
    accessed_at: '2026-01-01',
    reason: 'r',
    extraction: 'e',
    contribution: 'c',
    verbatim_quote: 'q',
    quote_locator: null,
    quote_verified: null,
    quote_match_score: null,
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
    citekey: null,
    source_kind: null,
    created_at: '2026-01-01',
    created_by: 'test',
    ...over,
  }
}

function brief(over: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    id: 'b1',
    project_id: 'p1',
    status: 'adopted',
    deliverable: 'academic',
    audience: 'Seminar',
    goal: 'Ziel',
    frames: [{ key: 'a', label: 'Frame', chosen: true }],
    chosen_frame_key: 'a',
    inclusion: 'in',
    exclusion: 'ex',
    sub_questions: ['q'],
    stop_rule: 'stopp',
    taboos: 'Keine Kausalität behaupten.',
    markdown: '# plan',
    year_from: null,
    year_to: null,
    min_empirical: null,
    discipline: null,
    created_at: '2026-01-01',
    created_by: 'test',
    adopted_at: '2026-01-01',
    adopted_by: 'test',
    ...over,
  }
}

function state(over: Partial<ProjectState> = {}): ProjectState {
  return {
    project: project(),
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
    linked_research: over.linked_research ?? null,
  }
}

describe('Was darfst du sagen (Phase H)', () => {
  it('färbt signierte belegte Quellen grün, belegte unsignierte gelb, Rest rot', () => {
    const green = source({ id: 'g', title: 'Signiert', review_status: 'human_signed', quote_verified: 1 })
    const yellow = source({ id: 'y', title: 'Belegt', review_status: 'ai_checked', quote_verified: 1 })
    const pending = source({ id: 'p', title: 'Offen', review_status: 'pending', quote_verified: null })
    const items = sayableItems(state({ sources: [green, yellow, pending] }))
    expect(items.find((i) => i.id === 'g')?.tone).toBe('green')
    expect(items.find((i) => i.id === 'y')?.tone).toBe('yellow')
    expect(items.find((i) => i.id === 'p')?.tone).toBe('red')
  })

  it('färbt Contrasts und Flags rot und listet Brief-Tabus', () => {
    const src = source({ id: 'c', title: 'Widerspruch', review_status: 'human_signed', quote_verified: 1 })
    const link: ClaimSourceLink = {
      id: 'l1',
      claim_id: 'cl',
      source_id: 'c',
      support_type: 'contrasts',
      quote_span: 'span',
      verification_status: 'pending',
      confidence: null,
      created_at: '2026-01-01',
    }
    const contrastItems = sayableItems(state({ sources: [src], links: [link] }))
    expect(contrastItems.find((i) => i.id === 'c')?.tone).toBe('red')

    const flagged: UncertaintyFlag = {
      id: 'f1',
      entity_type: 'source',
      entity_id: 'c',
      uncertainty_reason: 'unsicher',
      confidence_level: 'low',
      created_at: '2026-01-01',
      created_by: 'test',
    }
    const flagItems = sayableItems(state({ sources: [src], uncertaintyFlags: [flagged] }))
    expect(flagItems.find((i) => i.id === 'c')?.tone).toBe('red')

    const tabooItems = sayableItems(state({ researchBrief: brief() }))
    expect(tabooItems[0]).toMatchObject({ id: 'brief-taboos', tone: 'red' })
    expect(tabooItems[0].reason).toMatch(/Kausalität/)
  })

  it('lässt abgelehnte Quellen weg', () => {
    const rejected = source({ id: 'r', review_status: 'rejected', quote_verified: 0 })
    expect(sayableItems(state({ sources: [rejected] }))).toHaveLength(0)
  })
})
