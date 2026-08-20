import { writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { Repo } from '../repo'
import { projectWorkspace, registeredWorkspace } from '../agent/workspace'
import type { BriefDeliverable, ResearchBrief, ResearchFrame } from '../../../shared/types'
import { ServiceError } from './research'

/**
 * Research-Brief: Blickwinkel und Stopp-Regel, bevor gesucht wird.
 * Der Server prüft Präsenz der Pflichtabschnitte, nicht Stil.
 */

const frameSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(3),
  chosen: z.boolean().optional(),
})

export const briefFieldsSchema = z
  .object({
    project_id: z.string().min(1),
    deliverable: z.enum(['blog', 'academic', 'both']),
    audience: z.string().min(8),
    goal: z.string().min(20),
    frames: z.array(frameSchema).min(2).max(3),
    chosen_frame_key: z.string().min(1).optional(),
    inclusion: z.string().min(10),
    exclusion: z.string().min(10),
    sub_questions: z.array(z.string().min(10)).min(3).max(8),
    stop_rule: z.string().min(10),
    taboos: z.string().min(10),
    year_from: z.number().int().min(1500).max(2100).optional().nullable(),
    year_to: z.number().int().min(1500).max(2100).optional().nullable(),
    min_empirical: z.number().int().min(0).max(20).optional().nullable(),
    discipline: z.enum(['psychology', 'general']).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const keys = new Set(v.frames.map((f) => f.key))
    if (keys.size !== v.frames.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['frames'], message: 'Frame-Keys müssen eindeutig sein.' })
    }
    const marked = v.frames.filter((f) => f.chosen)
    const byKey = v.chosen_frame_key ? v.frames.find((f) => f.key === v.chosen_frame_key) : undefined
    if (marked.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['frames'],
        message: 'Genau EIN Frame darf chosen=true sein.',
      })
    }
    if (v.chosen_frame_key && !byKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['chosen_frame_key'],
        message: 'chosen_frame_key muss zu einem der Frames gehören.',
      })
    }
    if (marked.length === 0 && !v.chosen_frame_key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['frames'],
        message: 'Ein Frame muss gewählt sein (chosen=true oder chosen_frame_key).',
      })
    }
    if (v.year_from && v.year_to && v.year_from > v.year_to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['year_from'],
        message: 'year_from muss vor year_to liegen.',
      })
    }
  })

export const draftBriefSchema = briefFieldsSchema

export const adoptBriefSchema = z
  .object({
    project_id: z.string().min(1),
    brief_id: z.string().min(1).optional(),
  })
  .passthrough()

export const getBriefSchema = z.object({
  project_id: z.string().min(1),
})

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, input: unknown, code: string): z.infer<T> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    throw new ServiceError(code, `Eingabe ungültig — ${detail}`, 'Korrigiere GENAU die oben genannten Felder und rufe dasselbe Werkzeug erneut auf.')
  }
  return parsed.data
}

function assertProject(repo: Repo, projectId: string): void {
  if (!repo.getProject(projectId)) {
    throw new ServiceError(
      'project_not_found',
      `Projekt ${projectId} existiert nicht.`,
      'Rufe list_projects auf und verwende eine der dort genannten project_id. Erfinde keine ID. Gibt es noch kein Projekt, lege es mit create_project an.'
    )
  }
}

function resolveFrames(input: z.infer<typeof briefFieldsSchema>): { frames: ResearchFrame[]; chosen_frame_key: string } {
  const chosenKey = input.chosen_frame_key ?? input.frames.find((f) => f.chosen)?.key
  if (!chosenKey) {
    throw new ServiceError(
      'brief_invalid',
      'Kein Frame gewählt.',
      'Setze chosen=true bei genau einem Frame oder chosen_frame_key auf dessen key.'
    )
  }
  const frames: ResearchFrame[] = input.frames.map((f) => ({
    key: f.key,
    label: f.label,
    chosen: f.key === chosenKey,
  }))
  return { frames, chosen_frame_key: chosenKey }
}

export function renderBriefMarkdown(input: {
  deliverable: BriefDeliverable
  audience: string
  goal: string
  frames: ResearchFrame[]
  chosen_frame_key: string
  inclusion: string
  exclusion: string
  sub_questions: string[]
  stop_rule: string
  taboos: string
  year_from?: number | null
  year_to?: number | null
  min_empirical?: number | null
  discipline?: string | null
}): string {
  const deliverableLabel =
    input.deliverable === 'blog' ? 'Blog' : input.deliverable === 'academic' ? 'Wissenschaftliche Arbeit' : 'Blog und wissenschaftliche Arbeit'
  const frameLines = input.frames.map((f) => {
    const mark = f.chosen || f.key === input.chosen_frame_key ? ' **(gewählt)**' : ''
    return `- \`${f.key}\` — ${f.label}${mark}`
  })
  const range =
    input.year_from || input.year_to ? `${input.year_from ?? '…'}–${input.year_to ?? '…'}` : '(kein Zeitraum festgelegt)'
  const discipline =
    input.discipline === 'psychology'
      ? 'Psychologie (OpenAlex / Crossref / Europe PMC; PSYNDEX ist nicht angebunden — deutschsprachige Fachdatenbank bleibt eine Lücke)'
      : input.discipline === 'general'
        ? 'allgemein'
        : '(nicht festgelegt)'
  const empirical = input.min_empirical != null ? String(input.min_empirical) : '(kein Minimum)'

  return [
    '# Research-Plan',
    '',
    '## 1. Lieferform und Adressat',
    '',
    `- Lieferform: ${deliverableLabel}`,
    `- Adressat: ${input.audience}`,
    '',
    '## 2. Ziel in einem Satz',
    '',
    input.goal,
    '',
    '## 3. Blickwinkel',
    '',
    ...frameLines,
    '',
    '## 4. Einschluss / Ausschluss',
    '',
    `**Einschluss:** ${input.inclusion}`,
    '',
    `**Ausschluss:** ${input.exclusion}`,
    '',
    `- Zeitraum: ${range}`,
    `- Disziplin: ${discipline}`,
    `- Mindestzahl empirischer Quellen: ${empirical}`,
    '',
    '## 5. Teilfragen',
    '',
    ...input.sub_questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    '## 6. Stopp-Regel',
    '',
    input.stop_rule,
    '',
    '## 7. Tabus / Nicht-Behaupten',
    '',
    input.taboos,
    '',
  ].join('\n')
}

export function mirrorBriefToWorkspace(projectId: string, markdown: string): void {
  try {
    const ws = registeredWorkspace(projectId) ?? (process.env.ROP_AGENT_ROOT ? projectWorkspace(projectId) : null)
    if (!ws) return
    writeFileSync(join(ws, 'RESEARCH-PLAN.md'), markdown, 'utf-8')
  } catch {
    /* Workspace nicht schreibbar — Brief steht in der DB. */
  }
}

export function draftResearchBrief(repo: Repo, rawInput: unknown, actor: string): { brief: ResearchBrief; next_action: string } {
  const input = parseOrThrow(draftBriefSchema, rawInput, 'brief_invalid')
  assertProject(repo, input.project_id)
  const { frames, chosen_frame_key } = resolveFrames(input)
  const markdown = renderBriefMarkdown({ ...input, frames, chosen_frame_key })
  const brief = repo.addResearchBrief({
    project_id: input.project_id,
    status: 'draft',
    deliverable: input.deliverable,
    audience: input.audience,
    goal: input.goal,
    frames,
    chosen_frame_key,
    inclusion: input.inclusion,
    exclusion: input.exclusion,
    sub_questions: input.sub_questions,
    stop_rule: input.stop_rule,
    taboos: input.taboos,
    markdown,
    year_from: input.year_from ?? null,
    year_to: input.year_to ?? null,
    min_empirical: input.min_empirical ?? null,
    discipline: input.discipline ?? null,
    actor,
  })
  return {
    brief,
    next_action:
      'Zeige dem Menschen den Plan. Nach ausdrücklicher Bestätigung rufe adopt_research_brief mit dieser brief_id auf. Suche erst danach.',
  }
}

export function adoptResearchBrief(repo: Repo, rawInput: unknown, actor: string): ResearchBrief {
  const parsed = parseOrThrow(adoptBriefSchema, rawInput, 'brief_invalid')
  assertProject(repo, parsed.project_id)

  if (parsed.brief_id) {
    const existing = repo.getResearchBrief(parsed.brief_id)
    if (!existing) {
      throw new ServiceError(
        'brief_not_found',
        `Brief ${parsed.brief_id} existiert nicht.`,
        'Rufe get_research_brief oder draft_research_brief auf und übernimm die brief_id aus der Antwort. Erfinde keine ID.'
      )
    }
    if (existing.project_id !== parsed.project_id) {
      throw new ServiceError(
        'brief_project_mismatch',
        `Brief ${parsed.brief_id} gehört zu einem anderen Projekt.`,
        'Prüfe get_research_brief in DIESEM Projekt und nimm die brief_id von dort.'
      )
    }
    const adopted = existing.status === 'adopted' ? existing : repo.markBriefAdopted(existing.id, actor)
    mirrorBriefToWorkspace(adopted.project_id, adopted.markdown)
    return adopted
  }

  const full = parseOrThrow(briefFieldsSchema, rawInput, 'brief_invalid')
  const { frames, chosen_frame_key } = resolveFrames(full)
  const markdown = renderBriefMarkdown({ ...full, frames, chosen_frame_key })
  const brief = repo.addResearchBrief({
    project_id: full.project_id,
    status: 'adopted',
    deliverable: full.deliverable,
    audience: full.audience,
    goal: full.goal,
    frames,
    chosen_frame_key,
    inclusion: full.inclusion,
    exclusion: full.exclusion,
    sub_questions: full.sub_questions,
    stop_rule: full.stop_rule,
    taboos: full.taboos,
    markdown,
    year_from: full.year_from ?? null,
    year_to: full.year_to ?? null,
    min_empirical: full.min_empirical ?? null,
    discipline: full.discipline ?? null,
    actor,
  })
  mirrorBriefToWorkspace(brief.project_id, brief.markdown)
  return brief
}

export function getResearchBrief(
  repo: Repo,
  rawInput: unknown
): { brief: ResearchBrief | null; adopted: boolean; next_action: string } {
  const input = parseOrThrow(getBriefSchema, rawInput, 'brief_invalid')
  assertProject(repo, input.project_id)
  const adopted = repo.getAdoptedBrief(input.project_id)
  if (adopted) {
    return {
      brief: adopted,
      adopted: true,
      next_action:
        'Der Plan gilt. Teilfragen mit plan_research übernehmen (sub_questions weglassen). Danach gezielt search_literature — nicht Deep Research.',
    }
  }
  const draft = repo.getLatestBrief(input.project_id)
  if (draft) {
    return {
      brief: draft,
      adopted: false,
      next_action:
        'Es gibt nur einen Entwurf. Zeige ihn dem Menschen. Nach Bestätigung adopt_research_brief mit dieser brief_id. Erst danach suchen.',
    }
  }
  return {
    brief: null,
    adopted: false,
    next_action:
      'Es gibt noch keinen Brief. Kläre Lieferform, Adressat, Ziel, Frames, Einschluss/Ausschluss, Teilfragen, Stopp-Regel und Tabus. Dann draft_research_brief.',
  }
}

export const MINIMAL_BRIEF_INPUT = {
  deliverable: 'academic' as const,
  audience: 'Seminarleitung Psychologie',
  goal: 'Nach dem Lesen ist klar, welche Belege die These tragen und was nicht behauptet werden darf.',
  frames: [
    { key: 'method', label: 'Methodenvergleich der einschlägigen Studien', chosen: true },
    { key: 'history', label: 'Historische Entwicklung des Konzepts', chosen: false },
  ],
  inclusion: 'Peer-reviewed Studien, Deutsch und Englisch, passend zur Forschungsfrage.',
  exclusion: 'Ratgeber, Popularwissenschaft ohne Primärbeleg, bloße Meinungsstücke.',
  sub_questions: [
    'Welche empirischen Studien stützen die Kernhypothese der Forschungsfrage?',
    'Welche methodischen Grenzen haben die einschlägigen Arbeiten zum Thema?',
    'Was darf aufgrund der Beleglage nicht behauptet werden?',
  ],
  stop_rule: 'Stopp, wenn jede Teilfrage passende Quellen hat — nicht wenn das Internet erschöpft ist.',
  taboos: 'Keine kausalen Heilversprechen; keine Diagnose aus Sekundärquellen.',
}

/** Testhilfe: gültiger Brief, sofort adoptiert. */
export function adoptMinimalBrief(repo: Repo, projectId: string, actor = 'test'): ResearchBrief {
  return adoptResearchBrief(repo, { project_id: projectId, ...MINIMAL_BRIEF_INPUT }, actor)
}
