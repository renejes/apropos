import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import type { JournalMode } from '../../shared/types'

/**
 * SQLite ist die Source of Truth (documentation/01, Abschnitt "Datenmodell").
 * FTS5-Tabellen + Trigger werden hier als Raw-SQL gepflegt.
 * Migrationen: naive user_version-basierte Vorwärts-Migration.
 */

export type DB = Database.Database

/** Exportiert, damit Tests gegen den tatsächlichen Stand prüfen statt gegen eine abgeschriebene Zahl. */
export const SCHEMA_VERSION = 17 // v17 Screening-Tisch — Treffer sichten bevor Volltext

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS projects (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  research_question TEXT NOT NULL DEFAULT '',
  mode         TEXT NOT NULL DEFAULT 'academic' CHECK (mode IN ('academic','business')),
  policy_preset TEXT,
  easy_writing_dir TEXT,
  kind         TEXT NOT NULL DEFAULT 'research' CHECK (kind IN ('research','notebook')),
  linked_research_id TEXT REFERENCES projects(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  title        TEXT NOT NULL,
  retrieval_method TEXT NOT NULL DEFAULT 'unknown',
  accessed_at  TEXT NOT NULL,
  reason       TEXT NOT NULL,
  extraction   TEXT NOT NULL,
  contribution TEXT NOT NULL,
  verbatim_quote TEXT NOT NULL,
  quote_locator TEXT,
  quote_verified INTEGER,           -- NULL = ungeprüft, 0/1
  quote_match_score REAL,
  url_resolved INTEGER,             -- NULL = ungeprüft, 0/1
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','ai_checked','human_signed','rejected')),
  confidence   TEXT CHECK (confidence IN ('low','medium','high')),
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);

CREATE TABLE IF NOT EXISTS extractions (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  reasoning_freetext TEXT NOT NULL,
  extracted_fact TEXT NOT NULL,
  verbatim_quote TEXT NOT NULL,
  quote_locator TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_extractions_source ON extractions(source_id);

CREATE TABLE IF NOT EXISTS claims (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_text   TEXT NOT NULL,
  report_section TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_project ON claims(project_id);

CREATE TABLE IF NOT EXISTS claim_source_links (
  id           TEXT PRIMARY KEY,
  claim_id     TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  quote_span   TEXT NOT NULL,
  support_type TEXT NOT NULL DEFAULT 'supports'
    CHECK (support_type IN ('supports','contrasts','mentions')),
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending','supported','partial','unsupported','source_unreachable')),
  confidence   TEXT CHECK (confidence IN ('low','medium','high')),
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_claim ON claim_source_links(claim_id);
CREATE INDEX IF NOT EXISTS idx_links_source ON claim_source_links(source_id);

CREATE TABLE IF NOT EXISTS report_versions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_version_id TEXT,
  content_markdown TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL,
  change_summary TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_reports_project ON report_versions(project_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  model_id     TEXT,
  model_version TEXT,
  provider     TEXT,
  turn_index   INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_project ON chat_messages(project_id);

-- v14: bearbeitbare Markdown-Notizen (Notebook). citations_json hält Offset-Belege.
CREATE TABLE IF NOT EXISTS notes (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  body_markdown  TEXT NOT NULL DEFAULT '',
  file_name      TEXT NOT NULL,
  origin         TEXT NOT NULL DEFAULT 'human' CHECK (origin IN ('human','chat','agent')),
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);

CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('human','ai_judge','deterministic')),
  reviewer_id  TEXT NOT NULL,
  verdict      TEXT NOT NULL,
  confidence   TEXT CHECK (confidence IN ('low','medium','high')),
  evidence_span TEXT,
  source_snapshot_hash TEXT,
  note         TEXT,
  method       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_entity ON reviews(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS uncertainty_flags (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  uncertainty_reason TEXT NOT NULL,
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('low','medium','high')),
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_flags_entity ON uncertainty_flags(entity_type, entity_id);

-- Suchprozess-Transparenz (PRISMA-S): Welche Queries liefen, was wurde
-- gesehen und bewusst NICHT genutzt (negative Provenienz).
CREATE TABLE IF NOT EXISTS search_log (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query        TEXT NOT NULL,
  engine       TEXT,
  results_found INTEGER,
  note         TEXT,
  reflection_id TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_searchlog_project ON search_log(project_id);

CREATE TABLE IF NOT EXISTS excluded_sources (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  title        TEXT,
  reason       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_excluded_project ON excluded_sources(project_id);

-- v17: Screening-Tisch. Identifizierte Treffer (Register/Web), noch kein Volltext.
-- status undecided/maybe = menschliche Sichtung; included → fetch_source/Capture;
-- excluded → exclude_source. Der Tisch zählt nicht ins Pending-Gate.
CREATE TABLE IF NOT EXISTS screening_candidates (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doi             TEXT,
  url             TEXT NOT NULL,
  oa_url          TEXT,
  title           TEXT NOT NULL,
  authors_json    TEXT NOT NULL DEFAULT '[]',
  year            INTEGER,
  venue           TEXT,
  abstract        TEXT,
  cited_by_count  INTEGER,
  is_open_access  INTEGER,
  found_via_json  TEXT NOT NULL DEFAULT '[]',
  query           TEXT,
  search_log_id   TEXT REFERENCES search_log(id),
  status          TEXT NOT NULL DEFAULT 'undecided'
    CHECK (status IN ('undecided','maybe','included','excluded')),
  decision_reason TEXT,
  decided_at      TEXT,
  decided_by      TEXT,
  document_id     TEXT REFERENCES documents(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_screening_project_status ON screening_candidates(project_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_doi ON screening_candidates(project_id, doi) WHERE doi IS NOT NULL AND doi != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_url ON screening_candidates(project_id, url);

-- Recherchetiefe (v3): Teilfragen sind das, wogegen Abdeckung gemessen wird.
-- Ohne sie kann niemand — auch kein Modell — sagen, ob eine Recherche vollständig ist.
CREATE TABLE IF NOT EXISTS sub_questions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  rationale    TEXT,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','covered','dropped')),
  min_sources  INTEGER NOT NULL DEFAULT 2,
  closed_reason TEXT,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_subq_project ON sub_questions(project_id);

-- Runden dienen der Sättigungsmessung: bringt eine Runde kaum neue belegte
-- Quellen, ist die Recherche "dry" und die Schleife bricht ab.
CREATE TABLE IF NOT EXISTS research_rounds (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  round_index  INTEGER NOT NULL,
  started_at   TEXT NOT NULL,
  ended_at     TEXT,
  verified_at_start INTEGER NOT NULL DEFAULT 0,
  -- Zähler statt Zeitstempel: so ist "hat diese Runde überhaupt Arbeit gesehen?"
  -- immun gegen Zeitstempel-Kollisionen in derselben Millisekunde.
  activity_at_start INTEGER NOT NULL DEFAULT 0,
  new_verified INTEGER,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_rounds_project ON research_rounds(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_project_index ON research_rounds(project_id, round_index);

-- v4: Von der App SELBST abgerufener Quelltext.
-- Zweck 1 (Provenienz): Zitate werden als {document_id, start, end} eingetragen. Der
--   Server schneidet sie aus DIESEM Text — ein erfundenes Zitat ist damit unmöglich,
--   statt hinterher erkannt zu werden.
-- Zweck 2 (Vollständigkeit): Der Abruf läuft durch ein eigenes Tool, also sieht ihn der
--   Server. Er kann weitere Abrufe verweigern, solange ein Dokument undokumentiert ist —
--   unabhängig von Harness-Hooks, die in Subagenten nicht verlässlich feuern.
CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  title        TEXT,
  text         TEXT NOT NULL,
  char_len     INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at   TEXT NOT NULL,
  fetched_by   TEXT NOT NULL DEFAULT 'unknown',
  purpose      TEXT,
  -- 'open' = abgerufen, aber noch nicht dokumentiert (blockiert weitere Abrufe)
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','used','excluded')),
  -- v11: Seed-Korpus (Upload) vs. Discovery (Netz). Uploads starten als 'used' und zählen nicht ins Pending-Gate.
  origin       TEXT NOT NULL DEFAULT 'fetched' CHECK (origin IN ('fetched','upload','youtube')),
  filename     TEXT,
  page_starts_json TEXT,
  -- v16: Paywall/Zugang — Stub bleibt status=open (Gate zählt mit). Text kommt vom Menschen.
  capture_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(project_id, status);

-- v5: Läufe der eingebauten Engine.
-- Zweck: Ein Research-Lauf dauert Minuten bis Stunden. Bricht er ab — durch den
-- Abbruch-Knopf, ein erschöpftes Kontingent oder einen Absturz —, war bisher nur
-- der Zustand IN der DB erhalten, aber nichts wusste, dass ein Lauf offen ist.
-- Diese Tabelle ist der Checkpoint: Sie hält fest, wo der Lauf stand, und macht
-- ihn damit fortsetzbar statt nur nachträglich rekonstruierbar.
--
-- 'running' beim App-Start bedeutet zwingend einen gestorbenen Prozess: Es läuft
-- höchstens ein Lauf gleichzeitig, und der lebt nur im laufenden Prozess.
CREATE TABLE IF NOT EXISTS engine_runs (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','finished','aborted','interrupted','failed')),
  phase        TEXT,
  round_index  INTEGER,
  sub_question_id TEXT,
  stop_reason  TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  tool_calls   INTEGER NOT NULL DEFAULT 0,
  failed_tool_calls INTEGER NOT NULL DEFAULT 0,
  -- Kette der Fortsetzungen: welcher Lauf wurde hier weitergeführt?
  resumed_from TEXT,
  started_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  ended_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_engine_runs_project ON engine_runs(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_engine_runs_status ON engine_runs(status);

-- v6: Versionierte Evidenzkarte. Knoten ohne entity_id sind verboten —
-- die Karte zeigt nur Quellen, Aussagen und Teilfragen, die in der DB existieren.
-- Layout ist Interpretation; die Entitäten bleiben Behauptungen mit Status.
CREATE TABLE IF NOT EXISTS visual_versions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_version_id TEXT REFERENCES visual_versions(id),
  prompt       TEXT NOT NULL,
  layout_kind  TEXT NOT NULL CHECK (layout_kind IN ('argument_map','theme_clusters')),
  scope        TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all','marked')),
  interpretative INTEGER NOT NULL DEFAULT 0 CHECK (interpretative IN (0,1)),
  snapshot_hash TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_visual_versions_project ON visual_versions(project_id, created_at);

CREATE TABLE IF NOT EXISTS visual_nodes (
  id           TEXT PRIMARY KEY,
  version_id   TEXT NOT NULL REFERENCES visual_versions(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('source','claim','sub_question')),
  entity_id    TEXT NOT NULL,
  label        TEXT NOT NULL,
  cluster_key  TEXT,
  pos_x        REAL NOT NULL,
  pos_y        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visual_nodes_version ON visual_nodes(version_id);
CREATE INDEX IF NOT EXISTS idx_visual_nodes_entity ON visual_nodes(kind, entity_id);

CREATE TABLE IF NOT EXISTS visual_edges (
  id           TEXT PRIMARY KEY,
  version_id   TEXT NOT NULL REFERENCES visual_versions(id) ON DELETE CASCADE,
  from_node    TEXT NOT NULL REFERENCES visual_nodes(id) ON DELETE CASCADE,
  to_node      TEXT NOT NULL REFERENCES visual_nodes(id) ON DELETE CASCADE,
  relation     TEXT NOT NULL CHECK (relation IN ('supports','contrasts','mentions','part_of','needs_research'))
);
CREATE INDEX IF NOT EXISTS idx_visual_edges_version ON visual_edges(version_id);

-- Markierungen sind projektsweit (stabile source_id / claim_id), nicht versionsgebunden.
CREATE TABLE IF NOT EXISTS marks (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('source','claim')),
  entity_id    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL DEFAULT 'unknown',
  UNIQUE (project_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_marks_project ON marks(project_id);

-- v7: Research-Brief — Blickwinkel und Stopp-Regel, bevor gesucht wird.
CREATE TABLE IF NOT EXISTS research_briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('draft','adopted')),
  deliverable TEXT NOT NULL CHECK (deliverable IN ('blog','academic','both')),
  audience TEXT NOT NULL,
  goal TEXT NOT NULL,
  frames_json TEXT NOT NULL,
  chosen_frame_key TEXT NOT NULL,
  inclusion TEXT NOT NULL,
  exclusion TEXT NOT NULL,
  sub_questions_json TEXT NOT NULL,
  stop_rule TEXT NOT NULL,
  taboos TEXT NOT NULL,
  markdown TEXT NOT NULL,
  year_from INTEGER,
  year_to INTEGER,
  min_empirical INTEGER,
  discipline TEXT CHECK (discipline IS NULL OR discipline IN ('psychology','general')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'unknown',
  adopted_at TEXT,
  adopted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_briefs_project ON research_briefs(project_id, created_at);

-- v12: Lage nach einer Suchwelle — nächste Suche erst nach diesem Eintrag.
-- Das Modell schreibt covered/underrepresented/next_step; der Code erzwingt nur, dass es passiert.
CREATE TABLE IF NOT EXISTS search_reflections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  covered TEXT NOT NULL,
  underrepresented TEXT NOT NULL,
  next_action TEXT NOT NULL CHECK (next_action IN ('search','read','enough')),
  next_query TEXT,
  reason TEXT NOT NULL,
  sub_question_id TEXT REFERENCES sub_questions(id),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_search_reflections_project ON search_reflections(project_id, created_at);

-- Append-only Audit-Trail (Event Sourcing light): nichts wird gelöscht,
-- Korrekturen sind neue Events.
CREATE TABLE IF NOT EXISTS event_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT,
  actor        TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_project ON event_log(project_id);

-- FTS5-Volltextsuche (Raw-SQL, per Trigger synchron; siehe documentation/01)
CREATE VIRTUAL TABLE IF NOT EXISTS sources_fts USING fts5(
  title, reason, extraction, contribution, verbatim_quote,
  content='sources', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS sources_ai AFTER INSERT ON sources BEGIN
  INSERT INTO sources_fts(rowid, title, reason, extraction, contribution, verbatim_quote)
  VALUES (new.rowid, new.title, new.reason, new.extraction, new.contribution, new.verbatim_quote);
END;
CREATE TRIGGER IF NOT EXISTS sources_ad AFTER DELETE ON sources BEGIN
  INSERT INTO sources_fts(sources_fts, rowid, title, reason, extraction, contribution, verbatim_quote)
  VALUES ('delete', old.rowid, old.title, old.reason, old.extraction, old.contribution, old.verbatim_quote);
END;
CREATE TRIGGER IF NOT EXISTS sources_au AFTER UPDATE ON sources BEGIN
  INSERT INTO sources_fts(sources_fts, rowid, title, reason, extraction, contribution, verbatim_quote)
  VALUES ('delete', old.rowid, old.title, old.reason, old.extraction, old.contribution, old.verbatim_quote);
  INSERT INTO sources_fts(rowid, title, reason, extraction, contribution, verbatim_quote)
  VALUES (new.rowid, new.title, new.reason, new.extraction, new.contribution, new.verbatim_quote);
END;

-- v11: Volltext über den Korpus (hochgeladene PDFs und gefetchte Seiten), nicht nur über Zitate.
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title, text,
  content='documents', content_rowid='rowid'
);
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, text)
  VALUES (new.rowid, new.title, new.text);
END;
CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, text)
  VALUES ('delete', old.rowid, old.title, old.text);
END;
CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, text)
  VALUES ('delete', old.rowid, old.title, old.text);
  INSERT INTO documents_fts(rowid, title, text)
  VALUES (new.rowid, new.title, new.text);
END;
`

export function openDb(dbPath: string, opts?: { journalMode?: JournalMode }): DB {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  applyJournalMode(db, opts?.journalMode ?? 'wal')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

/**
 * WAL ist der Default (App + stdio auf derselben Datei, lokaler Platte).
 * In Cloud-Sync-Ordnern (Dropbox/Drive) WAL-Dateien zerstören die DB —
 * dort DELETE nach Checkpoint.
 */
export function applyJournalMode(db: DB, mode: JournalMode): void {
  switch (mode) {
    case 'delete':
      try {
        db.pragma('wal_checkpoint(TRUNCATE)')
      } catch {
        /* noch kein WAL */
      }
      db.pragma('journal_mode = DELETE')
      break
    case 'wal':
      db.pragma('journal_mode = WAL')
      break
    default: {
      const _never: never = mode
      return _never
    }
  }
}

export function checkpointAndClose(db: DB): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* egal */
  }
  db.close()
}

/**
 * Vorwärts-Migration, mehrprozess-sicher.
 *
 * WICHTIG (Review-Finding, gemessen): `db.transaction()` setzt BEGIN DEFERRED ab.
 * Die ersten Statements von SCHEMA sind auf einer bestehenden DB reine No-ops
 * (CREATE ... IF NOT EXISTS) und eröffnen nur eine LESE-Transaktion. Committet ein
 * zweiter Prozess (App + stdio-Server!) in diesem Fenster, liefert SQLite
 * SQLITE_BUSY_SNAPSHOT — und dafür wird der Busy-Handler NICHT aufgerufen,
 * `busy_timeout` ist also wirkungslos. Ergebnis waren reproduzierbare Startabbrüche.
 *
 * Deshalb: BEGIN IMMEDIATE (nimmt die Schreibsperre sofort) + Re-Check der Version
 * INNERHALB der Transaktion (der andere Prozess kann inzwischen fertig sein)
 * + begrenzter Retry für den Fall, dass die Sperre belegt ist.
 */
function migrate(db: DB): void {
  if ((db.pragma('user_version', { simple: true }) as number) >= SCHEMA_VERSION) return

  const applyOnce = (): boolean => {
    db.exec('BEGIN IMMEDIATE')
    try {
      // Re-Check unter der Schreibsperre: ein anderer Prozess war womöglich schneller.
      if ((db.pragma('user_version', { simple: true }) as number) >= SCHEMA_VERSION) {
        db.exec('COMMIT')
        return true
      }
      db.exec(SCHEMA)
      // Spalten-Migrationen brauchen ALTER TABLE — CREATE IF NOT EXISTS erreicht sie nicht.
      addColumnIfMissing(db, 'sources', 'sub_question_id', 'TEXT REFERENCES sub_questions(id)')
      // v4: Herkunft des Zitats. Ist document_id gesetzt, stammt verbatim_quote aus einem
      // vom Server selbst gespeicherten Text — nicht aus dem Gedächtnis des Modells.
      addColumnIfMissing(db, 'sources', 'document_id', 'TEXT REFERENCES documents(id)')
      addColumnIfMissing(db, 'sources', 'quote_start', 'INTEGER')
      addColumnIfMissing(db, 'sources', 'quote_end', 'INTEGER')
      // v8: bibliografische Identität — Citekey ist stabil, nicht aus [S#] abgeleitet.
      addColumnIfMissing(db, 'sources', 'doi', 'TEXT')
      addColumnIfMissing(db, 'sources', 'authors_json', 'TEXT')
      addColumnIfMissing(db, 'sources', 'year', 'INTEGER')
      addColumnIfMissing(db, 'sources', 'venue', 'TEXT')
      addColumnIfMissing(db, 'sources', 'entry_type', "TEXT CHECK (entry_type IS NULL OR entry_type IN ('article','book','inproceedings','misc'))")
      addColumnIfMissing(db, 'sources', 'citekey', 'TEXT')
      // v9: Bericht an Karten-Arbeit binden.
      addColumnIfMissing(db, 'report_versions', 'visual_version_id', 'TEXT REFERENCES visual_versions(id)')
      addColumnIfMissing(db, 'report_versions', 'mark_scope', 'INTEGER NOT NULL DEFAULT 0 CHECK (mark_scope IN (0,1))')
      // v10: Quellentyp für Coverage-Regeln des Briefs.
      addColumnIfMissing(db, 'sources', 'source_kind', "TEXT CHECK (source_kind IS NULL OR source_kind IN ('empirical','review','textbook','grey','web'))")
      // v11: Korpus-Metadaten auf bestehenden documents-Tabellen.
      addColumnIfMissing(db, 'documents', 'origin', "TEXT NOT NULL DEFAULT 'fetched'")
      addColumnIfMissing(db, 'documents', 'filename', 'TEXT')
      addColumnIfMissing(db, 'documents', 'page_starts_json', 'TEXT')
      // v12: Such-Lage an das Protokoll hängen (bestehende search_log-Zeilen ohne Lage).
      addColumnIfMissing(db, 'search_log', 'reflection_id', 'TEXT')
      // v13: verknüpfter Easy-Writing-Ordner für erneutes Schreiben ohne Picker.
      addColumnIfMissing(db, 'projects', 'easy_writing_dir', 'TEXT')
      // v14: Research bleibt Default; bestehende Projekte sind Research-Projekte.
      addColumnIfMissing(db, 'projects', 'kind', "TEXT NOT NULL DEFAULT 'research' CHECK (kind IN ('research','notebook'))")
      // v15: Notebook liest den Korpus eines Research-Projekts, besitzt ihn nicht.
      addColumnIfMissing(db, 'projects', 'linked_research_id', 'TEXT REFERENCES projects(id)')
      db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_linked_research ON projects(linked_research_id)`)
      // v16: Paywall-Capture. Kein neuer status-Wert — SQLite-CHECK auf status bleibt.
      addColumnIfMissing(db, 'documents', 'capture_reason', 'TEXT')
      // v17: Screening-Tisch (CREATE IF NOT EXISTS in SCHEMA). Indexe idempotent.
      db.exec(`CREATE INDEX IF NOT EXISTS idx_screening_project_status ON screening_candidates(project_id, status, created_at)`)
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_doi ON screening_candidates(project_id, doi) WHERE doi IS NOT NULL AND doi != ''`)
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_url ON screening_candidates(project_id, url)`)
      // FTS5 mit external content: Wurde der Index je neu angelegt (oder lief er aus dem
      // Tritt), zerstört der erste UPDATE-Trigger die Datei mit "database disk image is
      // malformed", weil er eine nicht indizierte Zeile löschen will. Ein Rebuild nach
      // jeder Migration ist billig und schließt das aus.
      db.exec(`INSERT INTO sources_fts(sources_fts) VALUES('rebuild')`)
      db.exec(`INSERT INTO documents_fts(documents_fts) VALUES('rebuild')`)
      db.pragma(`user_version = ${SCHEMA_VERSION}`)
      db.exec('COMMIT')
      return true
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* Transaktion war schon beendet */
      }
      throw err
    }
  }

  const DEADLINE = Date.now() + 10_000
  for (;;) {
    try {
      applyOnce()
      return
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      if (!code.startsWith('SQLITE_BUSY') || Date.now() > DEADLINE) throw err
      // Kurz warten und erneut versuchen. Synchron, weil openDb synchron ist.
      const until = Date.now() + 50
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
}

/** Idempotentes ADD COLUMN (SQLite kennt kein "ADD COLUMN IF NOT EXISTS"). */
function addColumnIfMissing(db: DB, table: string, column: string, definition: string): void {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (cols.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function nowIso(): string {
  return new Date().toISOString()
}
