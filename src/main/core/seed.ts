import type { Repo } from './repo'

/**
 * Demo-Projekt zum Kennenlernen der UI (per Button in den Einstellungen).
 * Die Quellen sind real und stabil; die Zitate stammen aus den Seiten,
 * können sich aber ändern — genau das demonstriert den Quote-Check ehrlich.
 */
export function seedDemoProject(repo: Repo): string {
  const actor = 'demo-seed'
  const project = repo.createProject({
    title: 'Demo: Transparente KI-Research',
    research_question: 'Wie zuverlässig können LLMs Aussagen korrekt ihren Quellen zuordnen?',
    mode: 'academic',
    policy_preset: 'PRISMA',
    actor,
  })

  const s1 = repo.addSource({
    project_id: project.id,
    url: 'https://en.wikipedia.org/wiki/Model_Context_Protocol',
    title: 'Model Context Protocol — Wikipedia',
    retrieval_method: 'web_search: "model context protocol"',
    accessed_at: new Date().toISOString(),
    reason: 'Überblicksquelle zum MCP-Standard und seiner Adoption — Grundlage für die Andockbarkeits-Annahme.',
    extraction: 'MCP ist ein offener Standard, mit dem KI-Systeme strukturiert an externe Werkzeuge und Datenquellen angebunden werden.',
    contribution: 'Belegt, dass ein herstellerneutrales Andock-Protokoll existiert und breit unterstützt wird.',
    verbatim_quote: 'The Model Context Protocol (MCP) is an open standard',
    quote_locator: 'Einleitung, erster Satz',
    confidence: 'high',
    actor,
  })

  const s2 = repo.addSource({
    project_id: project.id,
    url: 'https://arxiv.org/abs/2407.12861',
    title: 'CiteME: Can Language Models Accurately Cite Scientific Claims?',
    retrieval_method: 'citation_follow aus Feasibility-Research',
    accessed_at: new Date().toISOString(),
    reason: 'Zentraler Benchmark dafür, wie schlecht LLMs aus dem Gedächtnis korrekt zitieren.',
    extraction: 'Reine LLMs erreichen auf CiteME nur einstellige bis niedrige zweistellige Genauigkeit beim Zuordnen der korrekt zu zitierenden Arbeit.',
    contribution: 'Begründet, warum erzwungenes Grounding + Verifikation Kern des Produkts sein müssen.',
    verbatim_quote: 'CiteME',
    quote_locator: 'Titel/Abstract',
    confidence: 'medium',
    actor,
  })

  const claimLink = repo.addClaim({
    project_id: project.id,
    claim_text: 'Ohne Retrieval-Zwang sind LLM-Zitate überwiegend unzuverlässig.',
    report_section: 'Feasibility',
    actor,
  })
  repo.linkClaimToSource({
    claim_id: claimLink.id,
    source_id: s2.id,
    quote_span: 'CiteME',
    support_type: 'supports',
    confidence: 'medium',
    actor,
  })

  repo.addChatMessage({
    project_id: project.id,
    role: 'user',
    content: 'Recherchiere bitte, wie zuverlässig LLMs Quellen korrekt zuordnen.',
    turn_index: 0,
    actor,
  })
  repo.addChatMessage({
    project_id: project.id,
    role: 'assistant',
    content: 'Ich habe zwei Quellen erfasst (MCP-Überblick, CiteME-Benchmark) und einen Claim mit Belegkante angelegt.',
    model_id: 'demo-model',
    provider: 'demo',
    turn_index: 1,
    actor,
  })

  repo.addUncertaintyFlag({
    entity_type: 'source',
    entity_id: s1.id,
    uncertainty_reason: 'Wikipedia als Überblicksquelle — für akademische Zwecke durch Primärquellen ersetzen.',
    confidence_level: 'medium',
    actor,
  })

  repo.addReportVersion({
    project_id: project.id,
    content_markdown:
      '## Zwischenstand\n\nDie Belegbarkeit von LLM-Zitaten ist ohne Grounding gering [S2]. MCP bietet die Andock-Infrastruktur [S1].\n\n_(Demo-Bericht — mit einer echten Research-Session ersetzen.)_',
    change_summary: 'Erstfassung (Demo)',
    actor,
  })

  return project.id
}
