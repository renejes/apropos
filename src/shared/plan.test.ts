import { describe, expect, it } from 'vitest'
import { buildPlanStepsFrom, pendingBriefDraft } from './plan'
import type { ResearchBrief, ReportVersion, Source, SubQuestion } from './types'

function brief(over: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    id: 'b1',
    project_id: 'p',
    status: 'draft',
    deliverable: 'academic',
    audience: 'Seminarleitung Psychologie',
    goal: 'Nach dem Lesen ist klar, welche Belege die These tragen.',
    frames: [{ key: 'a', label: 'Methodenvergleich der Studien', chosen: true }],
    chosen_frame_key: 'a',
    inclusion: 'Peer-reviewed Studien.',
    exclusion: 'Ratgeber ohne Primärbeleg.',
    sub_questions: ['Welche Studien stützen die These der Forschungsfrage?'],
    stop_rule: 'Stopp, wenn jede Teilfrage passende Quellen hat.',
    taboos: 'Keine kausalen Heilversprechen.',
    markdown: '# Research-Plan',
    year_from: null,
    year_to: null,
    min_empirical: null,
    discipline: null,
    created_at: '2026-01-01T10:00:00.000Z',
    created_by: 'test',
    adopted_at: null,
    adopted_by: null,
    ...over,
  }
}

describe('pendingBriefDraft', () => {
  it('ist leer, solange nur ein Entwurf existiert', () => {
    const draft = brief()
    expect(pendingBriefDraft(null, draft)).toBeNull()
  })

  it('zeigt einen Entwurf nur, wenn er nach der Adoption liegt', () => {
    const adopted = brief({
      id: 'adopted',
      status: 'adopted',
      created_at: '2026-01-01T10:00:00.000Z',
      adopted_at: '2026-01-01T11:00:00.000Z',
    })
    const stale = brief({ id: 'old', created_at: '2026-01-01T09:00:00.000Z' })
    const next = brief({ id: 'new', created_at: '2026-01-01T12:00:00.000Z' })
    expect(pendingBriefDraft(adopted, stale)).toBeNull()
    expect(pendingBriefDraft(adopted, next)?.id).toBe('new')
    expect(pendingBriefDraft(adopted, brief({ id: 'same-second', created_at: '2026-01-01T11:00:00.000Z' }))?.id).toBe(
      'same-second'
    )
  })
})

describe('buildPlanSteps', () => {
  it('markiert Bestätigen als offen, solange der Plan Entwurf ist', () => {
    const steps = buildPlanStepsFrom({
      brief: brief(),
      pending: null,
      subQuestions: [],
      sources: [],
      reportVersions: [],
    })
    expect(steps.find((s) => s.id === 'brief')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'adopt')?.done).toBe(false)
    expect(steps.find((s) => s.id === 'adopt')?.detail).toMatch(/bestätigen/i)
  })

  it('zählt offene Quellen auf dem Human Desk', () => {
    const steps = buildPlanStepsFrom({
      brief: brief({ status: 'adopted', adopted_at: '2026-01-01T11:00:00.000Z' }),
      pending: null,
      subQuestions: [{ id: 'q1', status: 'open' } as SubQuestion],
      sources: [
        { id: 's1', review_status: 'pending' } as Source,
        { id: 's2', review_status: 'human_signed' } as Source,
      ],
      reportVersions: [],
    })
    expect(steps.find((s) => s.id === 'questions')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'signoff')?.done).toBe(false)
    expect(steps.find((s) => s.id === 'signoff')?.detail).toMatch(/1 offen/)
    expect(steps.find((s) => s.id === 'report')?.done).toBe(false)
  })

  it('ist beim Bericht fertig, sobald eine Fassung existiert', () => {
    const steps = buildPlanStepsFrom({
      brief: brief({ status: 'adopted' }),
      pending: null,
      subQuestions: [],
      sources: [{ id: 's1', review_status: 'human_signed' } as Source],
      reportVersions: [{ id: 'v1' } as ReportVersion],
    })
    expect(steps.find((s) => s.id === 'signoff')?.done).toBe(true)
    expect(steps.find((s) => s.id === 'report')?.done).toBe(true)
  })
})
