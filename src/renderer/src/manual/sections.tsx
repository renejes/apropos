import type { ReactNode } from 'react'

export type ManualSection = {
  id: string
  title: string
  body: ReactNode
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-fg">{children}</p>
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm leading-relaxed text-muted">{children}</p>
}

function Ul({ children }: { children: ReactNode }) {
  return <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">{children}</ul>
}

function Ol({ children }: { children: ReactNode }) {
  return <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">{children}</ol>
}

function H({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{children}</h3>
}

function Code({ children }: { children: ReactNode }) {
  return <code className="border border-hairline px-1 font-mono text-[0.85em]">{children}</code>
}

function Note({ children }: { children: ReactNode }) {
  return <div className="mt-3 border border-hairline bg-wash px-3 py-2 text-sm leading-relaxed">{children}</div>
}

function Warn({ children }: { children: ReactNode }) {
  return <div className="mt-3 border border-warn bg-warn-bg px-3 py-2 text-sm leading-relaxed text-warn">{children}</div>
}

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: 'wozu',
    title: 'Wozu diese App',
    body: (
      <>
        <Lead>
          Research Overview ist eine local-first Desktop-App. Du legst ein Projekt als{' '}
          <strong>Research</strong> oder als <strong>Notebook</strong> an. Im Research-Modus recherchiert die KI im
          Fenster, der Server erzwingt Provenienz, du signierst — und übergibst ein Dossier an Easy Writing. Im
          Notebook-Modus fragst du den Agenten zu PDFs und YouTube und speicherst Antworten als bearbeitbare Markdown-Notizen.
        </Lead>
        <P>
          Deep-Research-Werkzeuge liefern oft Berichte mit Fußnoten, deren faktische Deckung schwankt. Hier ist jede Quelle
          ein Artefakt: Begründung, Extraktion, wörtlicher Beleg, Status. Ein Eintrag der KI ist nie Wahrheit, sondern eine{' '}
          <em>zu verifizierende Behauptung</em>.
        </P>
        <H>Research — zwei Lieferformen, ein Korpus</H>
        <Ul>
          <li>
            <strong>Blogs / Kundenstücke:</strong> Blickwinkel und Frame. Wertvoll ist, was du behaupten darfst — nicht der
            Satz selbst.
          </li>
          <li>
            <strong>Hausarbeiten, Papers, Abschlussarbeiten:</strong> Zitate mit Seite, empirische Papers, ehrliche Lücken.
            Nicht „viele Quellen“, sondern passende.
          </li>
        </Ul>
        <P>
          Hochgeladene PDFs sind Seed-Quellen im selben Korpus. Sie bleiben im Projekt, unabhängig vom Chat.
        </P>
        <H>Notebook</H>
        <P>
          PDFs und YouTube-Links (nur mit Untertiteln) ablegen, im Chat fragen, die Antwort als Notiz speichern und die
          Notiz in der Mitte als Tab öffnen — Markdown, von dir editierbar. HTML-Folien legt der Agent unter artifacts/ ab.
          Ohne Offsets ist eine Notiz ein Entwurf; wörtliche Belege schneidet der Server.
        </P>
      </>
    ),
  },
  {
    id: 'prinzip',
    title: 'Leitprinzip',
    body: (
      <>
        <P>
          Kein Werkzeug — weder der Agent in der App noch ein MCP-Client — kann eine Quelle auf{' '}
          <Code>human_signed</Code> setzen. Sign-off gibt es nur in der Oberfläche, von dir.
        </P>
        <Ul>
          <li>Die SQLite-Datenbank auf deinem Rechner ist die Source of Truth. Modelle laufen über Cursor Cloud.</li>
          <li>Such-Snippets sind keine Quelle. Was in den Bericht soll, muss als Quelltext in der Datenbank liegen.</li>
          <li>Diese App schreibt und setzt keine Artikel. Schreiben ist Easy Writing, Setzen optional Penwright.</li>
        </Ul>
      </>
    ),
  },
  {
    id: 'alltag',
    title: 'Alltagsweg',
    body: (
      <>
        <Lead>Der normale Weg läuft in einem Fenster: Chat links, prüfbare Artefakte rechts.</Lead>
        <Ol>
          <li>
            App starten. In den <strong>Einstellungen</strong> bei Cursor anmelden (Systembrowser). Ein{' '}
            <strong>benanntes Modell</strong> wählen — nicht Auto, sonst feuern Such-Hooks oft nicht.
          </li>
          <li>
            Projekt anlegen: zuerst <strong>Research</strong> oder <strong>Notebook</strong>. Bei Research Titel,
            Forschungsfrage, Modus akademisch oder Business. PDFs kannst du in beiden Arten sofort in den Korpus legen.
          </li>
          <li>
            <strong>Research:</strong> Im Agent-Chat den Research-Brief erarbeiten. Du bestätigst; erst die Adoption macht
            den Plan verbindlich. Ohne adoptierten Brief lehnen Suche und Netzabruf ab.
          </li>
          <li>
            Erst danach suchen: zuerst den Korpus, dann Literaturregister und WebSearch gegen den Plan. Nach jeder
            Suchwelle schreibt die KI eine <strong>Lage</strong> (Getroffen / Unterrepräsentiert / nächster Schritt), bevor
            erneut gesucht wird.
          </li>
          <li>
            Was in den Bericht soll: Text abrufen, Quelle mit Zeichenpositionen belegen — das Modell tippt das Zitat nicht
            ab. Unpassendes verwerfen.
          </li>
          <li>
            Rechts prüfen: Übersicht (Lücken, „Was darfst du sagen“, Suchdokumentation), Korpus, Quellen (Sign-off),
            Aussagen, Karte.
          </li>
          <li>
            Karte aufbereiten, Punkte markieren oder eine Version speichern. Über <strong>Export</strong> nach Easy Writing
            schreiben. Artikel dort schreiben, Dossier beim Export in Easy Writing abwählen.
          </li>
        </Ol>
        <Note>
          Starter im leeren Research-Chat: <strong>Research starten</strong>, <strong>Zusammenfassen</strong>,{' '}
          <strong>Karte aufbereiten</strong>. Im Notebook: <strong>Quellen zusammenfassen</strong>,{' '}
          <strong>Als HTML aufbereiten</strong>. Chat-Antworten kannst du als Notiz speichern und in der Mitte bearbeiten.
        </Note>
      </>
    ),
  },
  {
    id: 'fenster',
    title: 'Fensteraufbau',
    body: (
      <>
        <Ul>
          <li>
            <strong>Linke Leiste:</strong> Projektliste, Neu (+), Löschen, Einstellungen. Der kleine Punkt an Einstellungen
            zeigt, ob der MCP-Server läuft (grün) oder nicht (rot).
          </li>
          <li>
            <strong>Projektkopf:</strong> Titel, Modus, Forschungsfrage. Rechts <strong>Kopieren</strong> (Provenienz in die
            Zwischenablage) und <strong>Export</strong> (Dialog).
          </li>
          <li>
            <strong>Links im Projekt (Research):</strong> Agent-Chat. <strong>Notebook:</strong> Quellen, Notizen,
            Artefakte; Chat und Notiz-Editor in der Mitte als Tabs.
          </li>
          <li>
            <strong>Rechts (nur Research):</strong> Tabs Übersicht, Korpus, Quellen, Aussagen, Karte, Berichte, Protokoll,
            Audit.
          </li>
          <li>
            <strong>Menüleiste (macOS):</strong> Unter dem App-Namen und unter <strong>Manual</strong> öffnet „Manual“ dieses
            Handbuch. Tastatur: <Code>⌘/</Code> (Windows/Linux: Strg+/).
          </li>
        </Ul>
      </>
    ),
  },
  {
    id: 'projekte',
    title: 'Projekte',
    body: (
      <>
        <H>Anlegen</H>
        <P>
          Plus-Button in der Leiste. Zuerst <strong>Research</strong> oder <strong>Notebook</strong>. Titel (mindestens drei
          Zeichen). Nur Research: Forschungsfrage und Modus <strong>Akademisch</strong> oder{' '}
          <strong>Business / Marketing</strong>. Der Modus steuert die Erwartung an Zitate und Frame, nicht die Werkzeuge.
        </P>
        <H>Kennzahlen in der Liste</H>
        <P>
          Research-Zeilen zeigen Quellenanzahl, Freigaben und den Modus. Notebook-Zeilen zeigen Notizen und Belege. Eine
          Zahl in Amber sind offene Reviews (pending) im Research-Modus.
        </P>
        <H>Löschen</H>
        <P>
          Papierkorb-Icon (Hover; beim aktiven Projekt immer sichtbar). Nach Bestätigung sind Datenbankeinträge, Chats und
          der Agent-Workspace weg. Ein Easy-Writing-Ordner auf der Platte bleibt — der Artikel gehört dir, nicht der
          Research-Datenbank.
        </P>
        <Warn>
          Löschen ist unwiderruflich in der App. Es gibt kein MCP-Werkzeug dafür — bewusst, weil es destruktiv ist.
        </Warn>
      </>
    ),
  },
  {
    id: 'chat',
    title: 'Agent-Chat',
    body: (
      <>
        <Lead>
          Hier läuft die Research. Der Agent darf nur über die Provenienz-Werkzeuge schreiben. Sign-off bleibt rechts bei
          dir.
        </Lead>
        <H>Anmeldung</H>
        <P>
          Ohne Cursor-Konto erscheint die Anmeldefläche. Der Browser öffnet cursor.com. Abgelaufene Sitzungen verlangen
          denselben Weg.
        </P>
        <H>Sessions</H>
        <Ul>
          <li>Mehrere Chats pro Projekt: neuer Chat, Tabs, Verlauf.</li>
          <li>
            Geblindete Prüfung (Verifikations-Leiter Stufe 2) braucht eine <strong>neue</strong> Session — sonst sieht das
            Modell die alte Begründung.
          </li>
        </Ul>
        <H>Composer</H>
        <Ul>
          <li>
            <strong>Agent</strong> — Tools ausführen (Alltag).
          </li>
          <li>
            <strong>Plan</strong> — erst nachdenken, weniger unmittelbare Tool-Aufrufe.
          </li>
          <li>Modell und Parameter (z. B. Fast) im selben Menü. Fast bleibt standardmäßig aus.</li>
          <li>
            <Code>@</Code> hängt Quellen, Inbox-Dateien oder Teilfragen an. Pfeiltasten in der Trefferliste, Enter übernimmt.
          </li>
          <li>Büroklammer: PDF oder Text in den Korpus (und in die Nachricht). Maximal acht Dateien pro Sendung.</li>
          <li>Enter sendet, Umschalt+Enter neue Zeile. Während eines Laufs: Stopp.</li>
        </Ul>
        <H>Was du siehst</H>
        <P>
          Stream der Antwort, Denken, Tool-Chips (läuft / fertig / Fehler), Token-Verbrauch, Hinweis wenn lange nichts
          kommt. Das ist der Arbeitschat — nicht das archivierte Protokoll rechts.
        </P>
      </>
    ),
  },
  {
    id: 'uebersicht',
    title: 'Tab Übersicht',
    body: (
      <>
        <P>Lagebild für dich und dieselbe Rechnung, die auch die KI sieht. Kein zweiter, weicherer Maßstab.</P>
        <H>Abdeckung</H>
        <P>
          Teilfragen mit Balken (belegte Quellen vs. Soll). Lückenarten u. a.: keine Planung, Teilfrage unbelegt, Zitat
          nicht auffindbar, Aussage ohne Beleg, zu wenige empirische Quellen, Zeitraum des Briefs nicht bedient. Klick auf
          eine Quelle springt in den Quellen-Tab.
        </P>
        <H>Was darfst du sagen</H>
        <Ul>
          <li>
            <strong>Grün:</strong> signiert und Zitat hält.
          </li>
          <li>
            <strong>Gelb:</strong> belegt, aber noch unsigniert.
          </li>
          <li>
            <strong>Rot:</strong> Widerspruch, Unsicherheits-Flag, Lücke oder Tabu aus dem Brief.
          </li>
        </Ul>
        <P>Das ist keine neue Wahrheitsspalte — nur die Lesart der vorhandenen Status.</P>
        <H>Kennzahlen</H>
        <P>Korpus, Quellen, offen, KI-geprüft, freigegeben, Beleg fehlt, Aussagen, Berichtsversionen, Unsicherheiten.</P>
        <H>Verifikations-Leiter</H>
        <Ol>
          <li>
            <strong>Deterministisch:</strong> Button „Jetzt prüfen“ — URL/DOI und wörtlicher Beleg gegen den gespeicherten
            Text. Kein Modell.
          </li>
          <li>
            <strong>Geblindete KI:</strong> neue Chat-Session, <Code>re_verify</Code> mit Tiefe ai_judge. Sieht nur Aussage
            + Quelltext.
          </li>
          <li>
            <strong>Mensch:</strong> Quellen-Tab, Freigeben oder Ablehnen.
          </li>
        </Ol>
        <H>Suchdokumentation</H>
        <P>
          Wellen mit Queries, Engine, Trefferzahl. Danach die Lage: Getroffen, Unterrepräsentiert, nächster Schritt
          (suchen / lesen / genug) und — wenn suchen — die nächste Query, die das Modell selbst formuliert hat. Amber-Kasten:
          Lage ausstehend, nächste Suche gesperrt. Unten: begründet ausgeschlossene URLs.
        </P>
      </>
    ),
  },
  {
    id: 'korpus',
    title: 'Tab Korpus',
    body: (
      <>
        <Lead>
          Der Korpus ist der selbst gespeicherte Quelltext: Uploads und per Netz abgerufene Seiten. Zitate werden daraus
          geschnitten, nicht aus dem Gedächtnis des Modells.
        </Lead>
        <H>Hineinlegen</H>
        <Ul>
          <li>
            <strong>Hochladen</strong> — Dateidialog.
          </li>
          <li>Dateien auf die Fläche ziehen (PDF, Text, Markdown, HTML, CSV).</li>
          <li>Im Chat anhängen — landet ebenfalls hier, nicht nur in der Session.</li>
        </Ul>
        <P>Uploads brauchen keinen Research-Brief und zählen nicht als offene Netzabrufe (Pending-Gate).</P>
        <H>Lesen</H>
        <P>
          Liste links, Volltext rechts. Suche (ab zwei Zeichen) durchsucht den Korpus per Volltext. Sprung aus einer Quelle
          mit Offset hebt die Stelle hervor. Originaldatei lässt sich öffnen, wenn sie noch auf der Platte liegt.
        </P>
        <Note>
          Status: genutzt, offen (abgerufen aber noch nicht dokumentiert), ausgeschlossen. Offene Netzabrufe blockieren
          weitere Fetches, bis sie als Quelle belegt oder verworfen sind.
        </Note>
      </>
    ),
  },
  {
    id: 'quellen',
    title: 'Tab Quellen',
    body: (
      <>
        <Lead>Kern der Review-UI. Hier entscheidest du, was belastbar ist.</Lead>
        <H>Liste</H>
        <P>
          Suche (Volltext plus URL). Filter: Alle, Zu reviewen (pending / KI-geprüft), Probleme (Zitat oder URL hält nicht),
          Ohne Teilfrage. Badge am Tab: offene Reviews.
        </P>
        <P>
          Jede Karte zeigt Titel, interne Nummer <Code>[S1]</Code>, Extrakt, URL, Zitat-Status und Review-Status. Offset-Beleg
          heißt: das Zitat stammt aus gespeichertem Text mit Zeichenpositionen.
        </P>
        <H>Detail</H>
        <Ul>
          <li>Warum diese Quelle, Extraktion, Beitrag — alles KI-Angaben, zu prüfen.</li>
          <li>Bibliografie: Typ, Jahr, Citekey <Code>nachnameJahrKurztitel</Code>.</li>
          <li>Teilfrage zuordnen (Dropdown) — sonst zählt die Quelle bei keiner Abdeckung.</li>
          <li>Wörtlicher Beleg mit Locator (z. B. S. 12). Kontextausschnitt und Sprung in den Korpus.</li>
          <li>Weitere Extraktionen und Unsicherheits-Flags.</li>
        </Ul>
        <H>Sign-off</H>
        <P>
          Optionale Notiz, dann <strong>Freigeben</strong> oder <strong>Ablehnen</strong>. Append-only im Audit. Ablehnen
          nimmt die Quelle aus der belastbaren Menge; sie bleibt nachvollziehbar.
        </P>
        <Warn>
          Solange du nicht signierst, bleibt „Was darfst du sagen“ höchstens gelb — auch bei perfektem Offset-Zitat.
        </Warn>
      </>
    ),
  },
  {
    id: 'aussagen',
    title: 'Tab Aussagen',
    body: (
      <>
        <P>
          Claims sind Sätze, die im Bericht stehen sollen, plus Belegkanten zu Quellen. Die KI legt sie mit{' '}
          <Code>link_claim_to_source</Code> an — inklusive widersprechender Quellen.
        </P>
        <H>Kanten</H>
        <Ul>
          <li>
            <strong>supports</strong> — stützt.
          </li>
          <li>
            <strong>contrasts</strong> — widerspricht.
          </li>
          <li>
            <strong>mentions</strong> — erwähnt, ohne klare Stütze.
          </li>
        </Ul>
        <P>
          Dazu Verifikationsstatus der Kante (pending, supported, partial, unsupported, source_unreachable) und Konfidenz.
          Klick auf eine Kante öffnet die Quelle zum Review. Rot: Aussage ohne jede Kante.
        </P>
      </>
    ),
  },
  {
    id: 'karte',
    title: 'Tab Karte',
    body: (
      <>
        <Lead>
          Die Karte zeigt nur Entitäten, die in der Datenbank existieren: Quellen, Aussagen, Teilfragen. Keine freien
          Zettel, keine erfundenen Knoten.
        </Lead>
        <H>Ansichten</H>
        <Ul>
          <li>
            <strong>Live</strong> — aktuelle Daten. Layout Themen-Cluster oder Argumentkarte.
          </li>
          <li>
            <strong>Version</strong> — gespeicherte Sicht (nach „Version speichern“ oder <Code>prepare_view</Code> im Chat).
          </li>
          <li>
            <strong>Vergleich</strong> — zwei Versionen nebeneinander. Nur links amber, nur rechts sky, in beiden grün.
          </li>
        </Ul>
        <H>Marks (Stern)</H>
        <P>
          Projektsweites Arbeitsset, nicht an eine Version gebunden. Easy-Writing-Export und Schreibpaket können auf
          markierte Punkte eingeschränkt werden. Ohne Marks und ohne gespeicherte Version verweigert Easy Writing den
          Export — kein Rohdump des ganzen Projekts.
        </P>
        <H>Schreibpaket</H>
        <P>
          Button auf der Karte. Markdown-Dump dieser Sicht: Plan, Bibliografie, Claims, Bericht,{' '}
          <Code>do-not-claim.md</Code>, JPEG der Karte. Das ist nicht Easy Writing, sondern ein Ordner zum Weiterreichen
          oder Archivieren.
        </P>
        <P>Knoten anklicken öffnet die Detailleiste; bei Quellen gibt es den Sprung in den Quellen-Tab.</P>
      </>
    ),
  },
  {
    id: 'berichte',
    title: 'Tab Berichte',
    body: (
      <>
        <P>
          Unveränderliche Versionen mit Snapshot-Hash. Nichts wird überschrieben: jede Bearbeitung ist eine neue Version,
          mit optionaler Änderungsnotiz und Verweis auf die Elternversion.
        </P>
        <P>
          Du kannst von einer Version aus überarbeiten oder einen Bericht von Hand beginnen. Die KI darf{' '}
          <Code>add_report_version</Code> nur, wenn blockierende Coverage-Lücken geschlossen oder begründet quittiert sind.
        </P>
        <Note>
          Der Artikel, den du veröffentlichst, entsteht nicht hier. Berichte in dieser App sind Synthese der Research-Sicht
          — Input für das Dossier, nicht das Layout.
        </Note>
      </>
    ),
  },
  {
    id: 'protokoll',
    title: 'Tab Protokoll',
    body: (
      <>
        <P>
          Archiviertes Sitzungsprotokoll, nur Ansicht. Kein zweiter Chat. Der Live-Chat bleibt links. Was die KI per{' '}
          <Code>add_chat_log</Code> mitschreibt (Rolle, Modell, Provider, Inhalt), ist der Provenienz-Beleg für den Export:
          wie das Ergebnis entstanden ist.
        </P>
        <P>Bitte den Agenten zu Beginn, den Dialog mitzuprotokollieren — sonst bleibt der Tab leer, obwohl links gesprochen wurde.</P>
      </>
    ),
  },
  {
    id: 'audit',
    title: 'Tab Audit',
    body: (
      <>
        <P>
          Append-only Ereignislog: wer (Mensch oder welche KI) hat wann was getan. Beispiele: Projekt angelegt, Quelle
          hinzugefügt, Sign-off, Berichtversion, Export, Lage, Easy-Writing-Pfad. Korrekturen sind neue Events, keine
          Streichungen.
        </P>
        <P>Nach dem Löschen eines Projekts bleibt ein Tombstone <Code>project.deleted</Code> unter derselben Projekt-ID.</P>
      </>
    ),
  },
  {
    id: 'export',
    title: 'Export und Kopieren',
    body: (
      <>
        <H>Kopieren</H>
        <P>
          Provenienz-Markdown in die Zwischenablage: Quellen, Lagen, Claims, Status — zum Gegenlesen oder in ein anderes
          Dokument.
        </P>
        <H>Export-Dialog</H>
        <Ul>
          <li>
            <strong>Provenienz-Markdown:</strong> Datei speichern. Enthält die Such-Lagen, nicht nur die Query-Liste.
          </li>
          <li>
            <strong>Easy Writing:</strong> Ordner für die Schwester-App. Braucht Scope: markierte Punkte oder die neueste
            (bzw. gewählte) Karten-Version.
          </li>
        </Ul>
        <P>Easy-Writing-Ziele im Dialog:</P>
        <Ul>
          <li>
            <strong>Erneut schreiben</strong> — gemerkter Ordner, falls schon einmal exportiert.
          </li>
          <li>
            <strong>Neuer Ordner — Blog</strong> — Unterordner mit leerem <Code>index.mdx</Code>.
          </li>
          <li>
            <strong>Neuer Ordner — Paper</strong> — Unterordner mit leeren Kapiteln unter <Code>chapters/</Code>.
          </li>
          <li>
            <strong>In bestehenden Ordner</strong> — Ordner mit <Code>project.yaml</Code> (ein Easy-Writing-Projekt).
          </li>
        </Ul>
      </>
    ),
  },
  {
    id: 'easy-writing',
    title: 'Workflow mit Easy Writing',
    body: (
      <>
        <Lead>
          Research Overview recherchiert und prüft. Easy Writing schreibt. Penwright setzt. Drei Apps, eine klare Grenze:
          Satz und Zitierstil entstehen nicht in der Research-Datenbank.
        </Lead>
        <H>Warum getrennt</H>
        <P>
          Wenn dieselbe Maschine recherchiert und den Artikel formuliert, vermischen sich Beleg und Prosa. Du kannst dann
          nicht mehr sehen, was geprüft ist und was nur glatt klingt. Deshalb schreibt diese App den Artikel nicht. Der
          Export ist ein <strong>Dossier</strong> neben leeren bzw. unangetasteten Schreibkapiteln.
        </P>
        <P>
          Easy Writing spricht <Code>[@citekey]</Code> und <Code>[@citekey, p. 12]</Code> plus eine <Code>.bib</Code> im
          Ordner. Diese App erzeugt dieselben Keys aus geprüften Metadaten (DOI, Autoren, Jahr, Venue) — nicht aus{' '}
          <Code>[S#]</Code> und nicht aus dem Gedächtnis des Modells. Ohne DOI wird ehrlich <Code>@misc</Code> mit URL, nie
          ein gefälschtes <Code>@article</Code>.
        </P>
        <H>Was der Export schreibt</H>
        <Ul>
          <li>
            <Code>research.mdx</Code> — Dossier: Forschungsfrage, Such-Lagen, Claims, Bericht der Sicht, Tabus
            (do-not-claim), Karte, Research-Plan. Oben steht: kein Artikel, beim Export in Easy Writing abwählen.
          </li>
          <li>
            <Code>references.bib</Code> — gemergt. Gleiche DOI oder URL behält den bestehenden Key. Kollision vergibt einen
            neuen Key nur im Dossier, damit dein Artikel nicht umbricht.
          </li>
          <li>
            Karte als JPEG und SVG unter <Code>assets/</Code>.
          </li>
          <li>
            <Code>project.yaml</Code> — Easy-Writing-Manifest. <Code>research.mdx</Code> wird als Kapitel eingetragen.
          </li>
        </Ul>
        <H>Neuer Ordner</H>
        <P>
          Blog: leeres <Code>index.mdx</Code> zum Schreiben. Paper: leere Kapitel (Einleitung, Methoden, …). Die
          Schreibdateien füllt diese App nicht. Du öffnest den Ordner in Easy Writing und schreibst dort.
        </P>
        <H>Bestehender Ordner / erneut schreiben</H>
        <P>
          <Code>research.mdx</Code> und die Bibliografie werden aktualisiert. Deine Schreibkapitel bleiben unangetastet. Der
          Pfad landet in <Code>easy_writing_dir</Code> — der nächste Export bietet „Erneut schreiben“.
        </P>
        <H>In Easy Writing</H>
        <Ol>
          <li>Denselben Ordner öffnen.</li>
          <li>
            Artikel in <Code>index.mdx</Code> bzw. den Paper-Kapiteln schreiben. Zitate per <Code>@</Code>-Autocomplete aus
            der <Code>.bib</Code>.
          </li>
          <li>
            Dossier <Code>research.mdx</Code> beim Artikel-Export <strong>abwählen</strong>, sonst wandert die Research in
            den Aufsatz.
          </li>
          <li>Optional nach Penwright: MDX-Export ohne das Dossier, dann setzen und PDF.</li>
        </Ol>
        <H>Scope</H>
        <P>
          Immer eine Sicht: gespeicherte Karten-Version oder Marks. Sonst würde ein ungesichteter Korpus als „fertig“
          wirken. Erst Version speichern oder Punkte markieren, dann Easy Writing im Export-Dialog.
        </P>
        <Note>
          Der Easy-Writing-Ordner wird beim Löschen des Research-Projekts nicht gelöscht. Umgekehrt überschreibt ein zweiter
          Export nicht deinen Artikel.
        </Note>
      </>
    ),
  },
  {
    id: 'einstellungen',
    title: 'Einstellungen',
    body: (
      <>
        <H>Cursor</H>
        <P>
          Anmelden, abmelden, Modell wählen. Dasselbe Konto wie in der IDE. Der Alltagsweg braucht kein zweites Fenster.
        </P>
        <H>MCP-HTTP</H>
        <P>
          Eingebauter Server auf <Code>127.0.0.1:8790/mcp</Code>, nur lokal. Fremdclients (Cursor-IDE, Goose, Claude Code)
          docken an dieselbe Datenbank und dieselben Regeln an. Werkzeuge greifen im <strong>Agent-Modus</strong>, nicht im
          Chat-Modus der IDE.
        </P>
        <P>
          Die Einstellungen kopieren mcp.json, Allowlist und die Cursor-Rule (Arbeitsvertrag). WebSearch darf entdecken;
          Berichtsquellen nur per Fetch in die DB. Die App muss laufen, sonst ist der Port tot.
        </P>
        <H>stdio / Claude Desktop</H>
        <P>Fallback-Config zum Kopieren, falls HTTP nicht passt. Alle Clients teilen dieselbe SQLite (WAL).</P>
        <H>Demo-Seed</H>
        <P>Legt ein Beispielprojekt mit Korpus an, zum Durchklicken der Tabs ohne echte Recherche.</P>
      </>
    ),
  },
  {
    id: 'erzwingung',
    title: 'Was der Server erzwingt',
    body: (
      <>
        <P>
          Agent in der App und MCP-Clients rufen dieselben Services. Wer die Datenbank umgeht, umgeht die Garantien — die
          UI tut das nicht.
        </P>
        <Ul>
          <li>
            <strong>Brief:</strong> Suche und Fetch erst nach Adoption. Uploads sind frei.
          </li>
          <li>
            <strong>Zitat:</strong> Fetch speichert HTML/PDF. <Code>add_source</Code> bekommt Offsets; der Server schneidet.
            Zusätzlicher Text, der nicht zu den Offsets passt, wird abgewiesen. Scans/Paywall: alter Pfad ohne Dokument, plus
            dein Sign-off.
          </li>
          <li>
            <strong>Pending:</strong> Weitere Netzabrufe gesperrt, solange abgerufene Seiten nicht belegt oder excluded sind
            (Standard: drei offen).
          </li>
          <li>
            <strong>Such-Lage:</strong> Nach einer Discovery-Welle keine neue Suche, bis covered / underrepresented /
            next_action stehen. Bei „search“ muss das Modell die nächste Query selbst schreiben — der Code erfindet keine.
            Register-Totalausfall zählt nicht als Welle.
          </li>
          <li>
            <strong>Tiefe:</strong> Teilfragen, Sättigung pro Runde, Bericht erst wenn Lücken zu oder quittiert.
          </li>
          <li>
            <strong>Fehler:</strong> Antworten beginnen mit Status und einem Imperativ, was als Nächstes zu tun ist.
          </li>
        </Ul>
      </>
    ),
  },
  {
    id: 'mcp',
    title: 'Werkzeuge (Auszug)',
    body: (
      <>
        <P>
          Du musst die Namen nicht tippen — der Agent kennt sie. Zur Orientierung, was hinter den Chips steckt:
        </P>
        <Ul>
          <li>
            <Code>draft_research_brief</Code> / <Code>adopt_research_brief</Code> — Plan, bevor gesucht wird.
          </li>
          <li>
            <Code>list_corpus</Code> / <Code>search_documents</Code> / <Code>read_document</Code> — Seed und gespeicherter
            Text.
          </li>
          <li>
            <Code>search_literature</Code> — OpenAlex, Crossref, Europe PMC. Danach <Code>reflect_search</Code>.
          </li>
          <li>
            <Code>fetch_source</Code> / <Code>add_source</Code> / <Code>exclude_source</Code> — Belegen oder verwerfen.
          </li>
          <li>
            <Code>plan_research</Code> / <Code>get_coverage_gaps</Code> / <Code>next_round</Code> — Teilfragen, Lücken,
            Sättigung.
          </li>
          <li>
            <Code>describe_evidence_map</Code> / <Code>prepare_view</Code> / <Code>toggle_mark</Code> — Karte.
          </li>
          <li>
            <Code>export_easy_writing</Code> / <Code>export_writing_pack</Code> — dieselben Wege wie im Export-Dialog bzw.
            Karten-Button.
          </li>
          <li>
            <Code>re_verify</Code> — Leiter, nicht dein Sign-off.
          </li>
        </Ul>
        <P>
          WebSearch der Cursor-Cloud darf entdecken und wird protokolliert. Der Hook fragt die laufende App; ist sie tot,
          darf die Suche durch (Fail-open), sonst wäre ohne App jede WebSearch tot.
        </P>
      </>
    ),
  },
  {
    id: 'grenzen',
    title: 'Was die App nicht tut',
    body: (
      <>
        <Ul>
          <li>Keine Artikelgenerierung, kein automatisches „Deep Research bis die Seite voll ist“.</li>
          <li>Keine Knoten auf der Karte ohne Datenbank-ID.</li>
          <li>Kein Sign-off durch die KI.</li>
          <li>Keine erfundene nächste Suchquery, kein SearXNG, kein Zotero als Pflichtweg.</li>
          <li>Kein Überschreiben deiner Easy-Writing-Kapitel.</li>
        </Ul>
        <P>
          Die Maschine ist gegen Fixtures und ein Fake-Modell verifiziert. Ob ein echtes Cursor-Modell den Arbeitsvertrag
          hält — Brief zuerst, Korpus vor Netz, Lage vor der nächsten Suche, Offsets an der richtigen Stelle — prüfst du in
          der Übersicht und in den Quellen.
        </P>
      </>
    ),
  },
]
