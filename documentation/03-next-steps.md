# 03 · Next Steps

> Der Bau der geplanten Phasen ist durch. Es fehlen die Tests mit einem echten Modell.

|  |  |
|---|---|
| **Projekt** | apROPos |
| **Dokument** | 03 — Next Steps |
| **Stand** | 2026-08-30 · v3.1 |
| **Phase** | Empirische Tests (Research) · Notebook gegen Unit-Tests grün |

**Dokument-Set:** [01 Implementationplan](01-implementationplan.md) · [02 Projekt-Status](02-project-status.md) · [03 Next Steps](03-next-steps.md) · [08 Notebook](08-notebook.md) · Archiv: [04 Feasibility](done/04-feasability.md) · [05 Markt-Research](done/05-market-research.md) · [06 Eigene Research-Engine](done/06-eigene-research-engine.md) · [07 KI-Clients](done/07-clients.md)

---

## Der Test, an dem alles hängt

**Ein echter Lauf mit einem echten Cursor-Modell.** Alles andere ist gegen Fixtures und ein Fake-Modell grün — das sagt nichts darüber, ob der Agent Brief, Offsets und Plan in einer echten Recherche einhält.

### Spike 1 — eine echte Research (Go/No-Go)

1. App starten (`npm start`), in den Einstellungen anmelden, **benanntes Modell** (nicht Auto).
2. Neues **Research**-Projekt. Im Agent-Chat Intake: Brief entwerfen, bestätigen, `adopt_research_brief`.
3. Erst danach suchen. Einstieg darf `start_transparent_research` sein — der Server muss trotzdem den Brief verlangen.
4. Eine überschaubare Frage (nicht Vierstundenlauf). Ziel: Quellen in der DB, Chat zeigt Tool-Chips, mindestens eine signierbare Quelle, Schreibpaket mit JPEG.

**Je Eintrag prüfen:**

| | Frage |
|---|---|
| (a) | Link/DOI auflösbar? |
| (b) | Thematisch zum Brief passend — oder nur „zur Sicherheit“ abgelegt? |
| (c) | Zeigt das Offset-Zitat auf die **richtige** Stelle? Trägt die Extraktion die Aussage? |

Die Zahlen liegen in der DB: `quote_verified`-Quote, Lücken je Teilfrage, Sättigung je Runde.

> Ein Zitat kann der Agent nicht mehr erfinden (Offset-Pfad). Gemessen wird **falsche Stelle** und **Extraktion trägt Aussage**. Erfolgskriterium: ≥80 % faktische Deckung, strukturelle Compliance ≥98 %. Unter ~60 % trotz Offset-Zwang: Kernannahme gefährdet.

### Gate

- **Unter ~60 %** → Versprechen gefährdet. Flow oder Modellwahl ändern, nicht mehr Features bauen.
- **≥ ~80 %** → Kernannahme trägt; erst dann lohnen sich Feinmessungen.
- Dazwischen → an der schwächsten Stelle nachbessern (Brief-Befolgung, Modell, Offset-Qualität) und denselben Lauf wiederholen.

---

## Wenn Spike 1 trägt

**Spike 2 — Reasoning vor Struktur** (1–2 Tage). Feldreihenfolge ist schon Begründung-vor-Ergebnis. Offen: ob ein zweistufiger Ablauf die inhaltliche Qualität hebt (≥5–10 pp).

**Spike 3 — Recall der Verifikations-Leiter** (1–2 Tage). Ebene 1 (deterministisch) und Ebene 2 (geblindete Session) sind gebaut. Offen: welcher Anteil faktisch falscher Einträge auf welcher Ebene auffliegt. Ziel: Ebene 1+2 ≥80 % der falschen Einträge.

Spike 4 (zwei MCP-Clients parallel) läuft in `npm run smoke`. Ein Ground-Truth-Set (50–100 Paare) macht Spike 1 quantitativ — erst nach dem ersten beobachteten Lauf.

---

## Manuell, nicht in CI

Braucht Cursor-Konto, einmalig:

Einstellungen → Anmelden → Projekt → Brief → erst danach Suche → Quelle in der DB → Karte → Schreibpaket enthält nur View-Claims und ein JPEG.

Vorher lokal:

```bash
npm run typecheck
npm run abi:node && npm test
npm run smoke
```

---

## Nicht der nächste Schritt

- **Phase C** (`disallowedTools` im SDK): kleiner Rest aus [01](01-implementationplan.md), blockiert Spike 1 nicht.
- **Phase D** (MCP-Apps-iframe): bewusst nicht Alltag.
- **Notebook-Modell-Lauf:** Unit-Tests decken Gates, Notizen, YouTube-Parsing. Ob der Agent `save_note` mit Offsets nutzt, ist derselbe empirische Test — **nach** Spike 1, nicht statt.
- RO-Crate, Lasttest mit 6–16 Agenten: erst wenn Spike 1 zeigt, dass der Alltagsweg trägt.

