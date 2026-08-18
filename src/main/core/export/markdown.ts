import type { ProjectState, ReportVersion, Source } from '../../../shared/types'

/**
 * Zitierbarer Markdown-Export (documentation/01, "Markdown-Export").
 * Unveränderliche Fassung mit Snapshot-Hash im Header; Quellenverzeichnis
 * mit voller Provenienz (warum/Extraktion/Beitrag/Beleg/Verifikationsstatus).
 *
 * SICHERHEIT (Review-Finding): Alle per MCP gelieferten Felder sind untrusted
 * und werden vor der Interpolation neutralisiert (Newlines kollabiert,
 * Markdown-Strukturzeichen entschärft) — sonst könnte eine KI/Webquelle
 * gefälschte Status-/Verifikationszeilen in das Vertrauens-Artefakt injizieren.
 */

/** Untrusted Text für einzeilige Markdown-Interpolation neutralisieren. */
function inline(text: string | null | undefined, maxLen = 2000): string {
  if (!text) return ''
  return (
    text
      .replace(/\r?\n+/g, ' ') // Newlines kollabieren → kein Struktur-Ausbruch
      .replace(/[`|]/g, "'") // Backticks/Pipes (Code/Tabellen) entschärfen
      // Markdown-Strukturzeichen, die nach dem Newline-Kollaps noch am Anfang stehen könnten
      .replace(/^([#>\-*+=]|\d+\.)\s*/g, '')
      .slice(0, maxLen)
      .trim()
  )
}

/** URL nur übernehmen, wenn sie die <…>-Autolink-Syntax nicht aufbrechen kann. */
function safeUrl(url: string): string {
  const cleaned = url.replace(/[\s<>]/g, '')
  try {
    const u = new URL(cleaned)
    if (u.protocol === 'http:' || u.protocol === 'https:') return cleaned
  } catch {
    /* fällt durch */
  }
  return '(ungültige URL)'
}

export function exportProjectMarkdown(state: ProjectState, version?: ReportVersion | null): string {
  const { project } = state
  const v = version ?? state.reportVersions[state.reportVersions.length - 1] ?? null
  const sourceIndex = new Map<string, number>()
  state.sources.forEach((s, i) => sourceIndex.set(s.id, i + 1))

  const lines: string[] = []
  lines.push(`# ${inline(project.title, 200)}`)
  lines.push('')
  lines.push(
    `> **Research-Provenienz-Export** · Snapshot \`${v?.snapshot_hash ?? 'ohne-bericht'}\` · ${new Date().toISOString()} · Modus: ${project.mode}${project.policy_preset ? ` · Policy: ${inline(project.policy_preset, 60)}` : ''}`
  )
  lines.push('')
  lines.push('## Forschungsfrage')
  lines.push('')
  lines.push(inline(project.research_question, 1000) || '_(keine hinterlegt)_')
  lines.push('')

  if (v) {
    lines.push(`## Bericht (Version \`${v.snapshot_hash}\` vom ${v.created_at})`)
    lines.push('')
    lines.push(
      '> ⚠️ _Der folgende Berichtstext ist KI-generierter Inhalt und wird unverändert wiedergegeben. Verbindlich geprüfte Angaben stehen ausschließlich im Quellenverzeichnis unten._'
    )
    lines.push('')
    lines.push(v.content_markdown.trim())
    lines.push('')
  }

  lines.push('## Quellenverzeichnis')
  lines.push('')
  if (state.sources.length === 0) lines.push('_(keine Quellen erfasst)_')
  for (const s of state.sources) {
    lines.push(...renderSource(s, sourceIndex.get(s.id)!, state))
  }

  // Claims mit Belegkanten
  if (state.claims.length > 0) {
    lines.push('## Aussagen (Claims) und Belegkanten')
    lines.push('')
    for (const claim of state.claims) {
      const links = state.links.filter((l) => l.claim_id === claim.id)
      lines.push(`- **${inline(claim.claim_text, 500)}**${claim.report_section ? ` _(Abschnitt: ${inline(claim.report_section, 80)})_` : ''}`)
      for (const link of links) {
        const idx = sourceIndex.get(link.source_id)
        lines.push(
          `  - [S${idx ?? '? — Quelle nicht in diesem Projekt!'}] ${link.support_type} · Verifikation: **${link.verification_status}**${link.confidence ? ` (Konfidenz: ${link.confidence})` : ''}`
        )
        lines.push(`    Beleg: "${inline(link.quote_span, 600)}"`)
      }
      if (links.length === 0) lines.push('  - ⚠️ _unbelegt — keine Quelle verknüpft_')
    }
    lines.push('')
  }

  // Suchdokumentation (PRISMA-S): Queries + begründete Ausschlüsse
  if (state.searchLog.length > 0 || state.excludedSources.length > 0) {
    lines.push('## Suchdokumentation')
    lines.push('')
    if (state.searchLog.length > 0) {
      lines.push(`**Durchgeführte Suchen (${state.searchLog.length}):**`)
      lines.push('')
      for (const s of state.searchLog) {
        lines.push(
          `- \`${inline(s.query, 200)}\`${s.engine ? ` · ${inline(s.engine, 60)}` : ''}${s.results_found != null ? ` · ${s.results_found} Treffer` : ''} · ${s.created_at}${s.note ? ` — ${inline(s.note, 200)}` : ''}`
        )
      }
      lines.push('')
    }
    if (state.excludedSources.length > 0) {
      lines.push(`**Gesichtet, aber begründet ausgeschlossen (${state.excludedSources.length}):**`)
      lines.push('')
      for (const e of state.excludedSources) {
        lines.push(`- <${safeUrl(e.url)}>${e.title ? ` — ${inline(e.title, 150)}` : ''}`)
        lines.push(`  Ausschlussgrund: ${inline(e.reason, 300)}`)
      }
      lines.push('')
    }
  }

  // KI-Deklaration aus dem Chat-Protokoll
  lines.push('## KI-Nutzungs-Deklaration')
  lines.push('')
  const models = new Map<string, number>()
  for (const m of state.chatMessages) {
    if (m.model_id) {
      const key = `${inline(m.provider, 40) || 'unbekannt'} · ${inline(m.model_id, 60)}${m.model_version ? ` (${inline(m.model_version, 40)})` : ''}`
      models.set(key, (models.get(key) ?? 0) + 1)
    }
  }
  const actors = new Set<string>()
  for (const s of state.sources) actors.add(s.created_by)
  if (models.size === 0 && actors.size === 0) {
    lines.push('_(keine Modell-Metadaten protokolliert)_')
  } else {
    for (const [model, count] of models) lines.push(`- ${model} — ${count} protokollierte Nachrichten`)
    for (const a of actors) lines.push(`- Eintragender Client: \`${inline(a, 80)}\``)
  }
  lines.push('')
  lines.push(
    '_Hinweis: KI-Einträge sind als zu verifizierende Behauptungen modelliert. Der Verifikationsstatus jeder Quelle/Belegkante ist oben ausgewiesen; menschlicher Sign-off ist je Quelle vermerkt._'
  )
  lines.push('')

  // Provenienz / Audit
  lines.push('## Provenienz & Audit')
  lines.push('')
  lines.push(`- Berichts-Versionen: ${state.reportVersions.length}`)
  for (const rv of state.reportVersions) {
    // Die Lücken-Quittierung steht am Anfang der change_summary und darf NIE gekürzt
    // werden — sonst sähe ein Bericht mit offenen Lücken im Artefakt sauber aus.
    const ack = rv.change_summary?.startsWith('⚠️') ?? false
    lines.push(
      `  - \`${rv.snapshot_hash}\` · ${rv.created_at} · von \`${inline(rv.created_by, 80)}\`` +
        `${rv.change_summary ? ` — ${inline(rv.change_summary, ack ? 4000 : 200)}` : ''}` +
        `${rv.parent_version_id ? '' : ' _(Erstfassung)_'}`
    )
  }

  // Recherchetiefe: Teilfragen und Abdeckung gehören ins zitierbare Artefakt —
  // ohne sie lässt sich von außen nicht beurteilen, wie vollständig recherchiert wurde.
  if (state.subQuestions.length > 0) {
    lines.push('')
    lines.push('### Teilfragen & Abdeckung')
    lines.push('')
    lines.push('| Teilfrage | Ziel | Belegt | Status |')
    lines.push('|---|---|---|---|')
    for (const sq of state.subQuestions) {
      const belegt = state.sources.filter(
        (s) =>
          s.sub_question_id === sq.id &&
          s.review_status !== 'rejected' &&
          (s.quote_verified === 1 || s.review_status === 'human_signed')
      )
      const distinct = new Set(belegt.map((s) => s.url)).size
      const status = sq.status === 'dropped' ? 'verworfen' : distinct >= sq.min_sources ? 'abgedeckt' : 'offen'
      lines.push(`| ${inline(sq.question, 200)} | ${sq.min_sources} | ${distinct} | ${status} |`)
    }
    const rounds = state.rounds.filter((r) => r.ended_at)
    if (rounds.length > 0) {
      lines.push('')
      lines.push(
        `Recherche-Runden: ${rounds.length} (neue belegte Quellen je Runde: ${rounds.map((r) => r.new_verified ?? 0).join(', ')})`
      )
    }
  }
  lines.push(`- Chat-Protokoll: ${state.chatMessages.length} Nachrichten (in der Projekt-DB, Tabelle \`chat_messages\`)`)
  lines.push(`- Reviews/Verifikations-Kanten: ${state.reviews.length}`)
  lines.push(`- Unsicherheits-Flags: ${state.uncertaintyFlags.length}`)
  lines.push('')
  lines.push('---')
  lines.push(
    '_Erzeugt von Research Overview Platform. Die zugrunde liegende SQLite-Datenbank enthält den vollständigen append-only Audit-Trail (`event_log`)._'
  )
  return lines.join('\n')
}

function renderSource(s: Source, idx: number, state: ProjectState): string[] {
  const lines: string[] = []
  const verify =
    s.quote_verified === 1
      ? `✅ Beleg verifiziert (Score ${s.quote_match_score ?? '–'})`
      : s.quote_verified === 0
        ? `❌ Beleg NICHT im Quelltext gefunden`
        : '⚠️ Beleg nicht automatisch prüfbar'
  const urlNote = s.url_resolved === 1 ? 'URL erreichbar' : s.url_resolved === 0 ? 'URL NICHT erreichbar' : 'URL ungeprüft'
  // Neuester menschlicher Review zählt (Reviews sind chronologisch aufsteigend sortiert)
  const humanReview = [...state.reviews]
    .reverse()
    .find((r) => r.entity_type === 'source' && r.entity_id === s.id && r.reviewer_type === 'human')
  const aiReviews = state.reviews.filter((r) => r.entity_type === 'source' && r.entity_id === s.id && r.reviewer_type === 'ai_judge')

  lines.push(`### [S${idx}] ${inline(s.title, 200)}`)
  lines.push('')
  lines.push(`- **URL:** <${safeUrl(s.url)}> (Zugriff: ${s.accessed_at}, Methode: ${inline(s.retrieval_method, 120)})`)
  lines.push(`- **Warum diese Quelle:** ${inline(s.reason)}`)
  lines.push(`- **Extraktion:** ${inline(s.extraction)}`)
  lines.push(`- **Beitrag:** ${inline(s.contribution)}`)
  lines.push(`- **Beleg (wörtlich):** "${inline(s.verbatim_quote)}"${s.quote_locator ? ` _(${inline(s.quote_locator, 120)})_` : ''}`)
  lines.push(`- **Automatische Prüfung:** ${verify} · ${urlNote}`)
  lines.push(
    `- **Review-Status:** ${statusLabel(s.review_status)}${humanReview ? ` — Mensch: ${humanReview.verdict} (${humanReview.created_at})${humanReview.note ? `, "${inline(humanReview.note, 300)}"` : ''}` : ''}`
  )
  for (const r of aiReviews) {
    lines.push(
      `- **KI-Verifikation (${inline(r.method, 40) || 'ai_judge'}):** ${r.verdict}${r.confidence ? ` (Konfidenz ${r.confidence})` : ''}${r.note ? ` — ${inline(r.note, 300)}` : ''}`
    )
  }
  lines.push('')
  return lines
}

function statusLabel(status: Source['review_status']): string {
  switch (status) {
    case 'pending':
      return '⏳ offen (pending)'
    case 'ai_checked':
      return '🤖 automatisch geprüft (ai_checked)'
    case 'human_signed':
      return '✅ menschlich freigegeben (human_signed)'
    case 'rejected':
      return '⛔ abgelehnt (rejected)'
  }
}
