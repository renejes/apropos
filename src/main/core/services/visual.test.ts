import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../db'
import { Repo } from '../repo'
import { ServiceError, linkClaim, planResearch } from './research'
import { adoptMinimalBrief } from './brief'
import { askNarrative, describeEvidenceMap, getVisualVersion, prepareView, toggleMark } from './visual'

const ACTOR = 'test:visual'

describe('Evidenzkarte v6', () => {
  let db: DB
  let repo: Repo

  afterEach(() => {
    db?.close()
  })

  function setup() {
    db = openDb(':memory:')
    repo = new Repo(db)
    const project = repo.createProject({
      title: 'Kartenprojekt',
      research_question: 'Wie hängt A mit B zusammen?',
      mode: 'academic',
      policy_preset: null,
      actor: ACTOR,
    })
    adoptMinimalBrief(repo, project.id, ACTOR)
    return project
  }

  function seed() {
    const project = setup()
    const planned = planResearch(
      repo,
      { project_id: project.id, sub_questions: [{ question: 'Welche Belege stützen These A zum Sachverhalt?', min_sources: 1 }] },
      ACTOR
    )
    const sq = planned.sub_questions[0]!.id
    const src = repo.addSource({
      project_id: project.id,
      url: 'https://example.org/a',
      title: 'Beispielquelle',
      retrieval_method: 'test',
      accessed_at: new Date().toISOString(),
      reason: 'Weil sie das Kernargument der Studie dokumentiert.',
      extraction: 'Die Studie zeigt X unter Bedingung Y mit Effektstärke Z.',
      contribution: 'Stützt These 2 des Berichts.',
      verbatim_quote: 'Ein wörtliches Zitat mit ausreichender Länge.',
      sub_question_id: sq,
      actor: ACTOR,
    })
    linkClaim(
      repo,
      {
        project_id: project.id,
        claim_text: 'Zentrale Aussage des Berichts über den Sachverhalt.',
        source_id: src.id,
        quote_span: 'Ein wörtliches Zitat mit ausreichender Länge.',
        support_type: 'supports',
      },
      ACTOR
    )
    return { project, sq, src }
  }

  it('describe_evidence_map erzeugt nur Knoten mit entity_id', () => {
    const { src } = seed()
    const map = describeEvidenceMap(repo, { project_id: src.project_id })
    expect(map.graph.nodes.length).toBeGreaterThan(0)
    expect(map.graph.nodes.every((n) => n.entity_id.length > 0)).toBe(true)
    expect(map.graph.nodes.some((n) => n.kind === 'source' && n.entity_id === src.id)).toBe(true)
  })

  it('prepare_view lehnt unbekannte entity_id ab', () => {
    const { project } = seed()
    expect(() =>
      prepareView(
        repo,
        {
          project_id: project.id,
          question: 'Wie gruppieren wir die Belege um These A?',
          layout_kind: 'theme_clusters',
          placements: [{ kind: 'source', entity_id: 'gibt-es-nicht', cluster_key: 'theme-a', cluster_label: 'Thema A extra' }],
        },
        ACTOR
      )
    ).toThrow(ServiceError)
    try {
      prepareView(
        repo,
        {
          project_id: project.id,
          question: 'Wie gruppieren wir die Belege um These A?',
          layout_kind: 'theme_clusters',
          placements: [{ kind: 'source', entity_id: 'gibt-es-nicht', cluster_key: 'theme-a', cluster_label: 'Thema A extra' }],
        },
        ACTOR
      )
    } catch (err) {
      expect((err as ServiceError).code).toBe('visual_unknown_entity')
    }
  })

  it('prepare_view speichert eine unveränderliche Version aus Ist-Daten', () => {
    const { project, src } = seed()
    const made = prepareView(
      repo,
      { project_id: project.id, question: 'Welche Belege gehören zu These A im Korpus?', layout_kind: 'argument_map' },
      ACTOR
    )
    expect(made.version.layout_kind).toBe('argument_map')
    expect(made.graph.nodes.some((n) => n.entity_id === src.id)).toBe(true)
    const loaded = getVisualVersion(repo, { project_id: project.id, version_id: made.version.id })
    expect(loaded.graph.nodes.map((n) => n.entity_id).sort()).toEqual(made.graph.nodes.map((n) => n.entity_id).sort())
    expect(repo.listVisualVersions(project.id)).toHaveLength(1)
  })

  it('ask_narrative verweigert unmarkierte Entitäten', () => {
    const { project, src } = seed()
    expect(() =>
      askNarrative(
        repo,
        {
          project_id: project.id,
          items: [
            {
              entity_type: 'source',
              entity_id: src.id,
              verdict: 'needs_research',
              note: 'Hier fehlt noch eine zweite unabhängige Quelle.',
              new_sub_question: 'Gibt es eine unabhängige Replikation von Studie A zum Sachverhalt?',
            },
          ],
        },
        ACTOR
      )
    ).toThrow(ServiceError)
    try {
      askNarrative(
        repo,
        {
          project_id: project.id,
          items: [
            {
              entity_type: 'source',
              entity_id: src.id,
              verdict: 'needs_research',
              note: 'Hier fehlt noch eine zweite unabhängige Quelle.',
              new_sub_question: 'Gibt es eine unabhängige Replikation von Studie A zum Sachverhalt?',
            },
          ],
        },
        ACTOR
      )
    } catch (err) {
      expect((err as ServiceError).code).toBe('narrative_unmarked')
    }
  })

  it('ask_narrative needs_research legt eine Teilfrage an, die im Projekt landet', () => {
    const { project, src } = seed()
    toggleMark(repo, { project_id: project.id, entity_type: 'source', entity_id: src.id }, ACTOR)
    const out = askNarrative(
      repo,
      {
        project_id: project.id,
        items: [
          {
            entity_type: 'source',
            entity_id: src.id,
            verdict: 'needs_research',
            note: 'Nur eine Quelle, Replikation fehlt im Korpus.',
            new_sub_question: 'Gibt es eine unabhängige Replikation von Studie A zum Sachverhalt?',
          },
        ],
      },
      ACTOR
    )
    expect(out.needs_research).toHaveLength(1)
    const sq = repo.getSubQuestion(out.needs_research[0]!.sub_question_id)
    expect(sq?.project_id).toBe(project.id)
    expect(sq?.question).toMatch(/Replikation/)
  })

  it('ask_narrative durable erzeugt Claim und Belegkante', () => {
    const { project, src } = seed()
    toggleMark(repo, { project_id: project.id, entity_type: 'source', entity_id: src.id }, ACTOR)
    const out = askNarrative(
      repo,
      {
        project_id: project.id,
        items: [
          {
            entity_type: 'source',
            entity_id: src.id,
            verdict: 'durable',
            note: 'Diese Stelle trägt die Kernaussage haltbar.',
            claim_text: 'Die Studie zeigt X unter Bedingung Y mit messbarem Effekt.',
            quote_span: 'Ein wörtliches Zitat mit ausreichender Länge.',
            support_type: 'supports',
          },
        ],
      },
      ACTOR
    )
    expect(out.durable).toHaveLength(1)
    const claim = repo.getClaim(out.durable[0]!.claim_id)
    expect(claim?.claim_text).toMatch(/Studie zeigt X/)
    expect(repo.listLinks(project.id).some((l) => l.claim_id === claim?.id && l.source_id === src.id)).toBe(true)
  })
})
