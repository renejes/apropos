/**
 * Gemeinsame Typen für Main-Prozess, Preload und Renderer.
 * Spiegeln das SQLite-Datenmodell (siehe documentation/01-implementationplan.md).
 */

export type ProjectMode = 'academic' | 'business'
export type ReviewStatus = 'pending' | 'ai_checked' | 'human_signed' | 'rejected'
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
  policy_preset: string | null
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
  created_at: string
  created_by: string
}

export type DocumentStatus = 'open' | 'used' | 'excluded'

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

/** Von der App selbst abgerufener Quelltext — Grundlage für Offset-Zitate. */
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
  excludedSources: ExcludedSource[]
  subQuestions: SubQuestion[]
  rounds: ResearchRound[]
}

export interface ProjectSummary extends Project {
  source_count: number
  pending_count: number
  signed_count: number
  claim_count: number
  version_count: number
}

export interface ServerInfo {
  httpUrl: string
  port: number
  dbPath: string
  running: boolean
  /** Fertige claude_desktop_config-Bausteine für den stdio-Weg (Electron-as-Node, gleiche ABI). */
  stdio: {
    command: string
    args: string[]
    env: Record<string, string>
  }
  /** Absoluter Pfad zum Claude-Code-Provenienz-Gate (Hook-Script), falls vorhanden. */
  hookScriptPath: string | null
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
