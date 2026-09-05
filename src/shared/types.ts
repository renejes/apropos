/**
 * Gemeinsame Typen für Main-Prozess, Preload und Renderer.
 * Spiegeln das SQLite-Datenmodell (siehe documentation/01-implementationplan.md).
 */

export type ProjectMode = 'academic' | 'business'
export type ProjectKind = 'research' | 'notebook'
export type ReviewStatus = 'pending' | 'ai_checked' | 'human_signed' | 'rejected'
export type BriefStatus = 'draft' | 'adopted'
export type BriefDeliverable = 'blog' | 'academic' | 'both'
export type BriefDiscipline = 'psychology' | 'general'
export type SourceKind = 'empirical' | 'review' | 'textbook' | 'grey' | 'web'
export type BibEntryType = 'article' | 'book' | 'inproceedings' | 'misc'
export type SubQuestionStatus = 'open' | 'covered' | 'dropped'
export type SupportType = 'supports' | 'contrasts' | 'mentions'
export type VerificationStatus = 'pending' | 'supported' | 'partial' | 'unsupported' | 'source_unreachable'
export type Verdict = 'supported' | 'partial' | 'unsupported' | 'source_unreachable' | 'approved' | 'rejected' | 'flagged'
export type ReviewerType = 'human' | 'ai_judge' | 'deterministic'
export type ConfidenceLevel = 'low' | 'medium' | 'high'

export interface Project {
  id: string
  title: string
  research_question: string
  mode: ProjectMode
  /** research = Brief/Gates/Karte; notebook = Quellen-Chat und bearbeitbare Notizen. */
  kind: ProjectKind
  policy_preset: string | null
  /** Absoluter Pfad zum Easy-Writing-Ordner nach dem ersten Export; sonst null. */
  easy_writing_dir: string | null
  /**
   * Nur Notebook: lebendige Kopplung an ein Research-Projekt.
   * Der Korpus wird dort gelesen, nicht kopiert. Research: immer null.
   */
  linked_research_id: string | null
  created_at: string
  updated_at: string
}

export interface Source {
  id: string
  project_id: string
  url: string
  title: string
  retrieval_method: string
  accessed_at: string
  reason: string
  extraction: string
  contribution: string
  verbatim_quote: string
  quote_locator: string | null
  quote_verified: 0 | 1 | null // null = noch nicht geprüft
  quote_match_score: number | null
  url_resolved: 0 | 1 | null
  review_status: ReviewStatus
  confidence: ConfidenceLevel | null
  /** Welche Teilfrage beantwortet diese Quelle? null = nicht zugeordnet (zählt als Lücke). */
  sub_question_id: string | null
  /** Gesetzt, wenn das Zitat per Offset aus einem selbst abgerufenen Dokument stammt. */
  document_id: string | null
  quote_start: number | null
  quote_end: number | null
  /** Bibliografische Identität (Schema v8) — Citekey ist stabil, nicht [S#]. */
  doi: string | null
  authors_json: string | null
  year: number | null
  venue: string | null
  entry_type: BibEntryType | null
  citekey: string | null
  /** Semantik der Quelle (Schema v10) — steuert Coverage, nicht Wahrheit. */
  source_kind: SourceKind | null
  created_at: string
  created_by: string
}

export interface ResearchFrame {
  key: string
  label: string
  chosen: boolean
}

/** Intake-Artefakt: Blickwinkel und Stopp-Regel, bevor gesucht wird. */
export interface ResearchBrief {
  id: string
  project_id: string
  status: BriefStatus
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
  markdown: string
  year_from: number | null
  year_to: number | null
  min_empirical: number | null
  discipline: BriefDiscipline | null
  created_at: string
  created_by: string
  adopted_at: string | null
  adopted_by: string | null
}

export type DocumentStatus = 'open' | 'used' | 'excluded'
/** fetched = Netz/OA; upload = vom Menschen in den Projekt-Korpus gelegt; youtube = Transkript. */
export type DocumentOrigin = 'fetched' | 'upload' | 'youtube'

/** Belegstelle im Originaltext mit Kontext — für den menschlichen Sign-off. */
export interface DocumentExcerpt {
  document_id: string
  url: string
  char_len: number
  fetched_at: string
  content_hash: string
  before: string
  quote: string
  after: string
  truncated_start: boolean
  truncated_end: boolean
}

/** Treffer einer Volltextsuche über gespeicherte Dokumente (PDF/HTML). */
export interface DocumentSearchHit {
  document_id: string
  title: string | null
  url: string
  origin: DocumentOrigin
  char_len: number
  matches: Array<{ start: number; end: number; snippet: string }>
}

/** Von der App selbst abgerufener oder hochgeladener Quelltext — Grundlage für Offset-Zitate. */
export interface FetchedDocument {
  id: string
  project_id: string
  url: string
  title: string | null
  text: string
  char_len: number
  content_hash: string
  fetched_at: string
  fetched_by: string
  purpose: string | null
  status: DocumentStatus
  origin: DocumentOrigin
  filename: string | null
  /** Zeichenoffset des ersten Zeichens je PDF-Seite (0-basiert). null = kein Seitenumbruch bekannt. */
  page_starts: number[] | null
  /**
   * Gesetzt, solange der Volltext fehlt (Paywall/Campus). Status bleibt `open`.
   * Nach dem Nachlegen der PDF wird das Feld geleert — URL/DOI bleiben.
   */
  capture_reason: string | null
}

/** Offener Capture-Auftrag: Gate zählt ihn, Zitate sind noch nicht möglich. */
export function isCapturePending(doc: Pick<FetchedDocument, 'status' | 'capture_reason'>): boolean {
  return doc.status === 'open' && Boolean(doc.capture_reason)
}

export interface Extraction {
  id: string
  source_id: string
  reasoning_freetext: string
  extracted_fact: string
  verbatim_quote: string
  quote_locator: string | null
  created_at: string
}

export interface Claim {
  id: string
  project_id: string
  claim_text: string
  report_section: string | null
  created_at: string
}

export interface ClaimSourceLink {
  id: string
  claim_id: string
  source_id: string
  quote_span: string
  support_type: SupportType
  verification_status: VerificationStatus
  confidence: ConfidenceLevel | null
  created_at: string
}

export interface ReportVersion {
  id: string
  project_id: string
  parent_version_id: string | null
  content_markdown: string
  snapshot_hash: string
  change_summary: string | null
  /** Schreibpaket: Bericht an eine gespeicherte Karten-Version gebunden. */
  visual_version_id: string | null
  /** Schreibpaket: Bericht an das Mark-Set gebunden (scope=marked). */
  mark_scope: 0 | 1
  created_at: string
  created_by: string
}

export interface ChatMessage {
  id: string
  project_id: string
  role: string
  content: string
  model_id: string | null
  model_version: string | null
  provider: string | null
  turn_index: number | null
  created_at: string
}

export interface Review {
  id: string
  entity_type: 'source' | 'claim' | 'claim_source_link' | 'report_version'
  entity_id: string
  reviewer_type: ReviewerType
  reviewer_id: string
  verdict: Verdict
  confidence: ConfidenceLevel | null
  evidence_span: string | null
  source_snapshot_hash: string | null
  note: string | null
  method: string | null
  created_at: string
}

export interface UncertaintyFlag {
  id: string
  entity_type: string
  entity_id: string
  uncertainty_reason: string
  confidence_level: ConfidenceLevel
  created_at: string
  created_by: string
}

export interface SearchLogEntry {
  id: string
  project_id: string
  query: string
  engine: string | null
  results_found: number | null
  note: string | null
  /** Gesetzt, sobald reflect_search diese Suche einer Lage zugeordnet hat. */
  reflection_id: string | null
  created_at: string
  created_by: string
}

export type SearchNextAction = 'search' | 'read' | 'enough'

/**
 * Lage nach einer Suchwelle: was getroffen ist, was gegenüber dem Ziel fehlt,
 * und was als Nächstes passiert. Die nächste Query kommt aus diesem Eintrag,
 * nicht aus einem Algorithmus.
 */
export interface SearchReflection {
  id: string
  project_id: string
  covered: string
  underrepresented: string
  next_action: SearchNextAction
  next_query: string | null
  reason: string
  sub_question_id: string | null
  created_at: string
  created_by: string
}

export interface ExcludedSource {
  id: string
  project_id: string
  url: string
  title: string | null
  reason: string
  created_at: string
  created_by: string
}

/** Titel/Abstract-Sichtung — bevor Volltext geholt wird. */
export type ScreeningStatus = 'undecided' | 'maybe' | 'included' | 'excluded'

export interface ScreeningCandidate {
  id: string
  project_id: string
  doi: string | null
  url: string
  oa_url: string | null
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  abstract: string | null
  cited_by_count: number | null
  is_open_access: boolean | null
  found_via: string[]
  query: string | null
  search_log_id: string | null
  status: ScreeningStatus
  decision_reason: string | null
  decided_at: string | null
  decided_by: string | null
  document_id: string | null
  created_at: string
  updated_at: string
}

export interface EventLogEntry {
  seq: number
  project_id: string | null
  actor: string
  event_type: string
  payload_json: string
  created_at: string
}

/**
 * Teilfrage der Recherche (Recherchetiefe, Schema v3).
 * Ohne festgehaltene Teilfragen gibt es nichts, wogegen Abdeckung messbar wäre.
 */
export interface SubQuestion {
  id: string
  project_id: string
  question: string
  rationale: string | null
  status: SubQuestionStatus
  /** Ab wie vielen belegten Quellen gilt die Teilfrage als abgedeckt. */
  min_sources: number
  closed_reason: string | null
  created_at: string
  created_by: string
}

/** Eine Recherche-Runde. Sättigung = eine Runde bringt kaum noch neue belegte Quellen. */
export interface ResearchRound {
  id: string
  project_id: string
  round_index: number
  started_at: string
  ended_at: string | null
  /** Belegte Quellen im Projekt zu Rundenbeginn (Basis für das Delta). */
  verified_at_start: number
  /** Gesamt-Aktivität zu Rundenbeginn — erkennt Runden ohne jede Arbeit. */
  activity_at_start: number
  /** Beim Schließen berechnet: neue belegte Quellen in dieser Runde. */
  new_verified: number | null
  note: string | null
}

/**
 * Versionierte Evidenzkarte (Schema v6). Knoten ohne entity_id sind verboten.
 */
export type VisualLayoutKind = 'argument_map' | 'theme_clusters'
export type VisualNodeKind = 'source' | 'claim' | 'sub_question'
export type VisualRelation = 'supports' | 'contrasts' | 'mentions' | 'part_of' | 'needs_research'
export type VisualScope = 'all' | 'marked'
export type MarkEntityType = 'source' | 'claim'
export type NarrativeVerdict = 'durable' | 'mixed' | 'needs_research'

/** Immutable Aufbereitung der Evidenzkarte (Schema v6). */
export interface VisualVersion {
  id: string
  project_id: string
  parent_version_id: string | null
  prompt: string
  layout_kind: VisualLayoutKind
  scope: VisualScope
  interpretative: 0 | 1
  snapshot_hash: string
  created_at: string
  created_by: string
}

export interface VisualNode {
  id: string
  version_id: string
  kind: VisualNodeKind
  entity_id: string
  label: string
  cluster_key: string | null
  pos_x: number
  pos_y: number
}

export interface VisualEdge {
  id: string
  version_id: string
  from_node: string
  to_node: string
  relation: VisualRelation
}

/** Projektsweites Arbeitsset — hängt an der Entität, nicht an einer Karten-Version. */
export interface Mark {
  id: string
  project_id: string
  entity_type: MarkEntityType
  entity_id: string
  created_at: string
  created_by: string
}

/** Layout + Knoten für Live-Sicht und gespeicherte Versionen. */
export interface VisualGraph {
  layout_kind: VisualLayoutKind
  width: number
  height: number
  interpretative: boolean
  clusters: Array<{ key: string; label: string; unverified: boolean }>
  nodes: Array<{
    id: string
    kind: VisualNodeKind
    entity_id: string
    label: string
    cluster_key: string | null
    pos_x: number
    pos_y: number
  }>
  edges: Array<{
    id: string
    from_node: string
    to_node: string
    relation: VisualRelation
  }>
}

/**
 * Zustand eines Laufs der eingebauten Engine — der Checkpoint.
 *
 * 'interrupted' entsteht nicht während des Laufs, sondern beim nächsten App-Start:
 * Ein Datensatz mit 'running' kann keinen lebenden Prozess mehr haben, weil ein Lauf
 * nur im laufenden Prozess existiert. Genau diese Unterscheidung macht einen
 * Absturz von einem bewussten Abbruch unterscheidbar.
 */
export type EngineRunStatus = 'running' | 'finished' | 'aborted' | 'interrupted' | 'failed'

export interface EngineRun {
  id: string
  project_id: string
  model: string
  status: EngineRunStatus
  /** Woran der Lauf zuletzt gearbeitet hat — die eigentliche Checkpoint-Information. */
  phase: string | null
  round_index: number | null
  sub_question_id: string | null
  stop_reason: string | null
  prompt_tokens: number
  completion_tokens: number
  tool_calls: number
  failed_tool_calls: number
  /** Welchen Lauf dieser fortsetzt — macht die Kette der Fortsetzungen sichtbar. */
  resumed_from: string | null
  started_at: string
  updated_at: string
  ended_at: string | null
}

export type CoverageGapKind =
  | 'no_plan'
  | 'subquestion_uncovered'
  | 'subquestion_unverified'
  | 'source_unassigned'
  | 'source_quote_failed'
  | 'source_quote_unchecked'
  | 'claim_unlinked'
  | 'claim_missing'
  /** Belegkante von der geblindeten Prüfung WIDERLEGT — blockiert den Bericht. */
  | 'link_refuted'
  /** Belegkante noch nicht geprüft — informativ, blockiert NICHT (Verify-Session kommt nach dem Bericht). */
  | 'link_unverified'
  /** Brief verlangt n empirische Quellen; zu wenige sind belegt. */
  | 'empirical_shortfall'
  /** Belegte Quellen liegen außerhalb des Brief-Zeitraums bzw. fehlen darin. */
  | 'year_range_shortfall'

/** Eine konkrete, serverseitig berechnete Lücke — kein Modell-Urteil. */
export interface CoverageGap {
  kind: CoverageGapKind
  /** Betroffene Entität (Teilfrage, Quelle, Claim, Link). */
  entity_id: string
  label: string
  detail: string
  /** Vorgeschlagene nächste Handlung für die KI. */
  next_action: string
  /** false = Hinweis, blockiert den Bericht nicht. */
  blocking: boolean
}

/** Ergebnis von get_coverage_gaps — die Abbruchbedingung der Recherche-Schleife. */
export interface CoverageReport {
  project_id: string
  /** Keine BLOCKIERENDEN Lücken -> Bericht darf geschrieben werden. */
  ready_for_report: boolean
  /** Alle Lücken, blockierende zuerst. */
  gaps: CoverageGap[]
  /** Nur die blockierenden — das ist, was das Berichts-Gate prüft. */
  blocking_gaps: CoverageGap[]
  stats: {
    sub_questions_total: number
    sub_questions_active: number
    sub_questions_covered: number
    sub_questions_dropped: number
    sources_total: number
    sources_verified: number
    sources_quote_failed: number
    sources_quote_unchecked: number
    sources_unassigned: number
    claims_total: number
    claims_unlinked: number
    links_total: number
    links_pending: number
    links_refuted: number
    /** Kanten, die dieselbe Session selbst beurteilt hat (kein geblindetes Urteil). */
    links_selfjudged: number
    current_round: number | null
  }
  summary: string
}

/** Ergebnis von next_round — sagt der Schleife, ob sie weiterlaufen soll. */
export interface RoundResult {
  closed_round: number
  new_verified: number
  /** true = Runde brachte weniger als `dry_threshold` neue belegte Quellen. */
  dry: boolean
  dry_threshold: number
  opened_round: number | null
  /** false, wenn dry ODER Rundendeckel erreicht ODER keine Lücken mehr offen. */
  should_continue: boolean
  stop_reason: string | null
  coverage: CoverageReport
}

/** Offset-Beleg in einer Notiz — derselbe Vertrag wie add_source, ohne Zitat-Abschreiben. */
export interface NoteCitation {
  document_id: string
  quote_start: number
  quote_end: number
  quote: string
}

export type NoteOrigin = 'human' | 'chat' | 'agent'

/** Bearbeitbare Markdown-Notiz. citations leer = Entwurf, noch nicht gegroundet. */
export interface Note {
  id: string
  project_id: string
  title: string
  body_markdown: string
  file_name: string
  origin: NoteOrigin
  citations: NoteCitation[]
  created_at: string
  updated_at: string
}

export interface ArtifactFile {
  path: string
  kind: 'html' | 'markdown' | 'csv' | 'other'
  size: number
  updated_at: string
}

/** Aggregierter Projektzustand für UI und get_project_state-Tool. */
export interface ProjectState {
  project: Project
  sources: Source[]
  extractions: Extraction[]
  claims: Claim[]
  links: ClaimSourceLink[]
  reportVersions: ReportVersion[]
  chatMessages: ChatMessage[]
  reviews: Review[]
  uncertaintyFlags: UncertaintyFlag[]
  searchLog: SearchLogEntry[]
  searchReflections: SearchReflection[]
  excludedSources: ExcludedSource[]
  screeningCandidates: ScreeningCandidate[]
  subQuestions: SubQuestion[]
  rounds: ResearchRound[]
  marks: Mark[]
  visualVersions: VisualVersion[]
  researchBrief: ResearchBrief | null
  /** Korpus ohne Volltext — der Text kommt über documents:text / search_documents. */
  documents: Array<Omit<FetchedDocument, 'text'>>
  notes: Note[]
  /** Gesetzt, wenn ein Notebook den Korpus eines Research-Projekts liest. */
  linked_research: { id: string; title: string } | null
}

export interface ProjectSummary extends Project {
  source_count: number
  pending_count: number
  signed_count: number
  claim_count: number
  version_count: number
  note_count: number
}

export interface ServerInfo {
  httpUrl: string
  port: number
  dbPath: string
  running: boolean
  /** Fertige stdio-Bausteine (Electron-as-Node, gleiche ABI) — Fallback für Claude Desktop. */
  stdio: {
    command: string
    args: string[]
    env: Record<string, string>
  }
  /** Absoluter Pfad zum Claude-Code-Provenienz-Gate (Hook-Script), falls vorhanden. */
  hookScriptPath: string | null
}

export type JournalMode = 'wal' | 'delete'

export interface DataLock {
  hostname: string
  pid: number
  startedAt: string
  appVersion: string
}

export type ContactEmailSource = 'env' | 'settings' | 'default'

export interface ContactEmailInfo {
  /** Wirksame Adresse (Umgebung > Einstellungen > Fallback). */
  value: string
  /** In settings.json gespeichert, unabhängig von der Umgebung. */
  stored: string | null
  source: ContactEmailSource
  envLocked: boolean
}

export interface DataRootInfo {
  root: string
  dbPath: string
  defaultRoot: string
  envOverride: boolean
  cloudSynced: boolean
  cloudPathDetected: boolean
  journalMode: JournalMode
  lockHostname: string | null
  lockStartedAt: string | null
}

/** Wie eine Quelle im eingebetteten Leser geöffnet wird — kein Markup. */
export type DocumentOpenKind = 'pdf' | 'html' | 'youtube' | 'text' | 'missing'

export interface DocumentOpenInfo {
  document_id: string
  kind: DocumentOpenKind
  filename: string | null
  url: string
  file_exists: boolean
  origin: DocumentOrigin
  page_starts: number[] | null
}

/** Ergebnis eines deterministischen Re-Verify-Laufs (Ebene 1). */
export interface DeterministicVerifyResult {
  sourceId: string
  urlResolved: boolean | null
  quoteVerified: boolean | null
  quoteMatchScore: number | null
  verdict: Verdict
  note: string
}
