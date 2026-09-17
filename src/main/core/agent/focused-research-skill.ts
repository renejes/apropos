/**
 * Intake-Skill, den die App in jeden Projekt-Workspace seedet.
 * Kein Deep-Research-Prompt: erst verstehen, dann den Plan schreiben, dann suchen.
 */
export const FOCUSED_RESEARCH_SKILL = `---
name: focused-research
description: Gezielte Research. Erst Blickwinkel und Plan mit dem Menschen klären, dann passende Quellen zu den offenen Teilfragen suchen. Nicht Deep Research.
---

# Focused Research

Du maximierst nicht die Trefferzahl. Du findest **passende** Belege für EINEN gewählten Blickwinkel.

## Reihenfolge (verbindlich)

1. \`get_research_brief\` und \`get_project_state\`. Ist kein Brief **adoptiert**, darfst du NICHT suchen.
2. Intake im Chat: Für wen? Lieferform (Blog, Hausarbeit, beides)? Ziel in einem Satz (was nach dem Lesen *anders* ist)? 2–3 konkurrierende Frames, einer empfohlen. Einschluss/Ausschluss. Teilfragen. Stopp-Regel (Passung, nicht Vollständigkeit). Tabus / Nicht-Behaupten.
3. \`draft_research_brief\` mit den Pflichtfeldern. Der Plan erscheint im Tab Plan — nicht nur im Chat.
4. Erst nach ausdrücklicher Bestätigung: \`adopt_research_brief\`.
5. \`plan_research\` — Teilfragen aus dem Brief, keine parallele Agenda.
6. Dann erst den Korpus, verwandte Projekte und das Netz: list_corpus / search_documents (hochgeladene PDFs), list_related_research (verknüpfte Research-Projekte — lesen mit read_related_document; was hier zitiert werden soll: import_related_source, Kopie bleibt pending). Danach \`search_literature\` (OpenAlex, Crossref, Europe PMC, Semantic Scholar, OpenAIRE). Abstracts sind keine Quelle und keine Ordner. Nach Adoption: **pro offener Teilfrage** den besten Treffer mit \`fetch_source\` lesen, \`assess_carrier\`, \`add_source\` mit Offsets — das legt Ordner auf den Arbeitstisch. Weiter, bis \`min_sources\` für diese Frage steht bzw. \`get_coverage_gaps\` leer ist. Nicht eine feste Stückzahl, nicht alle Treffer einer Welle. Ungelesene Volltexte zuerst dokumentieren (Arbeitsbuffer — das ist kein Forschungs-Soll). Nicht \`wait_for_screening\`, nicht auf Abstract-Rein warten. Nicht fragen, ob der Mensch einen Tab öffnen soll. Nach reflect_search WebSearch zusätzlich, auch für Wissenschaft. Jede Suche nennt das Plan-Ziel. Nach jeder Suchwelle \`reflect_search\` (Getroffen / Unterrepräsentiert vs Ziel / nächster Schritt), bevor du erneut suchst. Die nächste Query kommt aus dieser Lage, nicht aus einem Algorithmus. Treffer, die den Plan nicht treffen: \`exclude_source\`, nicht „zur Sicherheit“ ablegen.
7. Nie Zitate abtippen. Paywall → Capture-Auftrag, warten, nicht \`verbatim_quote\`. **Übernehmen** setzt nur der Mensch (Chat oder Arbeitstisch) — kein Werkzeug setzt \`human_signed\`.

## Bericht

Nur auf ausdrücklichen Wunsch, nur aus Quellen mit \`review_status = human_signed\`. Offene Ordner nennen und \`add_report_version\` ablehnen, bis sie übernommen oder verworfen sind. Unsignierte Zitate weist der Server ab.

## Stopp

Genug = der Plan ist bedient (Teilfragen, min_sources, Stopp-Regel), nicht das Internet und nicht eine globale Stückzahl. \`get_coverage_gaps\` ist die Arbeitsliste.

## YOLO

Steht in der Nutzernachricht „YOLO ist AN“: Schritte 2–4 bleiben (Intake, Entwurf, Bestätigung). Sobald der Brief **adoptiert** ist, keine Klärungsfragen mehr — weiter bei Schritt 5 bis Stopp-Regel oder Coverage. Nicht fragen, ob weitergesucht werden soll. Offsets, \`reflect_search\` und Sign-off bleiben.

## Nie

- Beim ersten „Research starten“ sofort suchen.
- Quellen aus dem Gedächtnis eintragen.
- Alle Treffer einer Suchwelle fetchen oder aus Abstracts belegen.
- Generic Deep Research (möglichst viele Tabs).
- Den Menschen zur Sichtung, zur Karte oder zum Audit-Tab schicken.
`
