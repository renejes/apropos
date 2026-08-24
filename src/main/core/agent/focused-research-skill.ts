/**
 * Intake-Skill, den die App in jeden Projekt-Workspace seedet.
 * Kein Deep-Research-Prompt: erst verstehen, dann den Plan schreiben, dann suchen.
 */
export const FOCUSED_RESEARCH_SKILL = `---
name: focused-research
description: Gezielte Research. Erst Blickwinkel und Plan mit dem Menschen klären, dann wenige passende Quellen suchen. Nicht Deep Research.
---

# Focused Research

Du maximierst nicht die Trefferzahl. Du findest **passende** Belege für EINEN gewählten Blickwinkel.

## Reihenfolge (verbindlich)

1. \`get_research_brief\` und \`get_project_state\`. Ist kein Brief **adoptiert**, darfst du NICHT suchen.
2. Intake im Chat: Für wen? Lieferform (Blog, Hausarbeit, beides)? Ziel in einem Satz (was nach dem Lesen *anders* ist)? 2–3 konkurrierende Frames, einer empfohlen. Einschluss/Ausschluss. Teilfragen. Stopp-Regel (Passung, nicht Vollständigkeit). Tabus / Nicht-Behaupten.
3. \`draft_research_brief\` mit den Pflichtfeldern. Den Markdown-Plan dem Menschen zeigen.
4. Erst nach ausdrücklicher Bestätigung: \`adopt_research_brief\`.
5. \`plan_research\` — Teilfragen aus dem Brief, keine parallele Agenda.
6. Dann erst den Korpus und das Netz: list_corpus / search_documents (hochgeladene PDFs), danach \`search_literature\` / WebSearch. Jede Suche nennt das Plan-Ziel. Nach jeder Suchwelle \`reflect_search\` (Getroffen / Unterrepräsentiert vs Ziel / nächster Schritt), bevor du erneut suchst. Die nächste Query kommt aus dieser Lage, nicht aus einem Algorithmus. Treffer, die den Plan nicht treffen: \`exclude_source\`, nicht „zur Sicherheit“ ablegen.
7. \`fetch_source\` → sofort \`add_source\` mit Offsets. Nie Zitate abtippen. Sign-off nur der Mensch.

## Stopp

Genug = der Plan ist bedient, nicht das Internet. \`get_coverage_gaps\` ist die Arbeitsliste.

## Nie

- Beim ersten „Research starten“ sofort suchen.
- Quellen aus dem Gedächtnis eintragen.
- Generic Deep Research (möglichst viele Tabs).
`
