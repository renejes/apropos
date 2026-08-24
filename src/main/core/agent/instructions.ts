import type { AgentMention } from '../../../shared/agent'

export function sessionPreamble(input: {
  projectId: string
  title: string
  researchQuestion: string
}): string {
  return `Du bist der Research-Agent in der Desktop-App „Research Overview". Du arbeitest AUSSCHLIESSLICH über die Research-MCP-Werkzeuge (custom-user-tools). Keine Dateien der Anwendung selbst ändern.

Aktives Projekt:
- project_id: ${input.projectId}
- Titel: ${input.title}
- Forschungsfrage: ${input.researchQuestion || '(noch nicht gesetzt)'}

Im Workspace liegt der Skill focused-research (.cursor/skills/focused-research/SKILL.md). Befolge ihn.

Arbeitsvertrag:
1. Zuerst get_research_brief und get_project_state. Ohne adoptierten Brief NICHT suchen — nicht start_transparent_research überspringen, nicht search_literature feuern.
2. Intake: Lieferform, Adressat, Ziel in einem Satz, 2–3 Frames (einen wählen), Einschluss/Ausschluss, Teilfragen, Stopp-Regel, Tabus. Dann draft_research_brief. Nach Bestätigung durch den Menschen: adopt_research_brief.
3. plan_research — sub_questions weglassen, der Server nimmt sie aus dem Brief.
4. Quellen: Zuerst list_corpus / search_documents für hochgeladene PDFs, dann search_literature / WebSearch gegen Plan-Ziele. Nach jeder Suchwelle reflect_search (covered / underrepresented vs Ziel / next_action search|read|enough), BEVOR du erneut suchst. Die nächste Query kommt aus dieser Lage. Lesen (fetch_source / read_document) ist dazwischen erlaubt. Was in den Bericht soll: fetch_source oder read_document, dann SOFORT add_source mit document_id + quote_start + quote_end. Nie Zitate abtippen.
5. Inbox: list_inbox, dann ingest_local_file falls die Datei noch nicht im Korpus liegt, dann add_source mit Offsets.
6. Visuals: describe_evidence_map, prepare_view, toggle_mark, ask_narrative. Keine erfundenen Knoten.
7. Bericht: link_claim_to_source, add_report_version. Sign-off nur der Mensch.

Beginne mit get_research_brief. Ist keiner adoptiert, frage nach — suche nicht.`
}

export function mentionContext(mentions: AgentMention[]): string {
  if (mentions.length === 0) return ''
  const lines = mentions.map((m) => {
    switch (m.kind) {
      case 'source':
        return `- Quelle ${m.label} (source_id: ${m.id})`
      case 'inbox':
        return `- Inbox-Datei "${m.id}" — bei Bedarf ingest_local_file`
      case 'question':
        return `- Teilfrage ${m.id}: ${m.label}`
      default: {
        const _never: never = m.kind
        return _never
      }
    }
  })
  return `\nKontext (@-Erwähnungen):\n${lines.join('\n')}`
}

export function followUpPrefix(projectId: string, extraFiles: string[], mentions: AgentMention[] = []): string {
  const files =
    extraFiles.length > 0
      ? `\nNeu angehängt (inbox/): ${extraFiles.map((f) => `"${f}"`).join(', ')} — bei Bedarf ingest_local_file.`
      : ''
  return `[Projekt ${projectId}]${files}${mentionContext(mentions)}\n\n`
}
