import type { ProjectState, ResearchBrief, SubQuestion, Source, ReportVersion } from './types'

export type PlanStepId = 'brief' | 'adopt' | 'questions' | 'sources' | 'signoff' | 'report'

export type PlanStep = {
  id: PlanStepId
  label: string
  done: boolean
  detail: string
}

/** Entwurf nur anzeigen, wenn er nach der letzten Adoption entstanden ist. */
export function pendingBriefDraft(
  adopted: ResearchBrief | null | undefined,
  latestDraft: ResearchBrief | null | undefined
): ResearchBrief | null {
  if (!latestDraft || latestDraft.status !== 'draft') return null
  if (!adopted || adopted.status !== 'adopted') return null
  if (latestDraft.id === adopted.id) return null
  const adoptedAt = adopted.adopted_at ?? adopted.created_at
  return latestDraft.created_at >= adoptedAt ? latestDraft : null
}

export function buildPlanSteps(
  state: Pick<ProjectState, 'researchBrief' | 'pendingBriefDraft' | 'subQuestions' | 'sources' | 'reportVersions'>
): PlanStep[] {
  return buildPlanStepsFrom({
    brief: state.researchBrief,
    pending: state.pendingBriefDraft,
    subQuestions: state.subQuestions,
    sources: state.sources,
    reportVersions: state.reportVersions,
  })
}

export function buildPlanStepsFrom(input: {
  brief: ResearchBrief | null
  pending: ResearchBrief | null
  subQuestions: SubQuestion[]
  sources: Source[]
  reportVersions: ReportVersion[]
}): PlanStep[] {
  const brief = input.brief
  const adopted = brief?.status === 'adopted'
  const signed = input.sources.filter((s) => s.review_status === 'human_signed').length
  const open = input.sources.filter((s) => s.review_status === 'pending' || s.review_status === 'ai_checked').length
  const activeQ = input.subQuestions.filter((s) => s.status !== 'dropped')

  return [
    {
      id: 'brief',
      label: 'Briefing',
      done: !!brief,
      detail: brief ? 'liegt vor' : 'fehlt — Research starten oder von Hand anlegen',
    },
    {
      id: 'adopt',
      label: 'Bestätigt',
      done: adopted && !input.pending,
      detail: !brief
        ? '—'
        : input.pending
          ? 'neuer Entwurf wartet'
          : adopted
            ? 'bindend'
            : 'Entwurf — bitte bestätigen',
    },
    {
      id: 'questions',
      label: 'Teilfragen',
      done: activeQ.length > 0,
      detail:
        activeQ.length > 0
          ? `${activeQ.length} in Arbeit`
          : adopted
            ? 'übernimmt die KI mit plan_research'
            : 'nach Bestätigung',
    },
    {
      id: 'sources',
      label: 'Quellen',
      done: input.sources.length > 0,
      detail: input.sources.length > 0 ? `${input.sources.length} auf dem Human Desk` : 'noch keine Akten',
    },
    {
      id: 'signoff',
      label: 'Übernehmen',
      done: signed > 0 && open === 0,
      detail:
        input.sources.length === 0 ? '—' : open > 0 ? `${open} offen auf dem Human Desk` : `${signed} übernommen`,
    },
    {
      id: 'report',
      label: 'Bericht',
      done: input.reportVersions.length > 0,
      detail:
        input.reportVersions.length > 0
          ? `${input.reportVersions.length} Fassung${input.reportVersions.length === 1 ? '' : 'en'}`
          : 'erst aus übernommenen Quellen',
    },
  ]
}
