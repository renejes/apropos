import { randomUUID, createHash } from 'crypto'
import type { DB } from './db'
import { nowIso } from './db'
import type {
  ChatMessage,
  Claim,
  ExcludedSource,
  SearchLogEntry,
  SearchReflection,
  SearchNextAction,
  ClaimSourceLink,
  ConfidenceLevel,
  EventLogEntry,
  Extraction,
  Project,
  ProjectMode,
  ProjectState,
  ProjectSummary,
  ReportVersion,
  Review,
  ReviewStatus,
  Source,
  SupportType,
  UncertaintyFlag,
  Verdict,
  VerificationStatus,
  ReviewerType,
  SubQuestion,
  SubQuestionStatus,
  ResearchRound,
  FetchedDocument,
  DocumentStatus,
  DocumentOrigin,
  DocumentSearchHit,
  EngineRun,
  EngineRunStatus,
  Mark,
  MarkEntityType,
  VisualEdge,
  VisualLayoutKind,
  VisualNode,
  VisualNodeKind,
  VisualRelation,
  VisualScope,
  VisualVersion,
  ResearchBrief,
  ResearchFrame,
  BriefDeliverable,
  BriefDiscipline,
  BriefStatus,
  SourceKind,
  BibEntryType,
  ProjectKind,
  Note,
  NoteCitation,
  NoteOrigin,
} from '../../shared/types'

/**
 * Datenzugriff + Append-only-Event-Log.
 * WICHTIG (Leitprinzip aus documentation/01): KI-Einträge werden nie als
 * Wahrheit gespeichert, sondern als zu verifizierende Behauptungen mit Status.
 * `human_signed` ist AUSSCHLIESSLICH über signSourceHuman() erreichbar (UI/IPC),
 * nie über einen MCP-Tool-Pfad.
 */
export class Repo {
  constructor(private db: DB) {}

  /**
   * Mehrschritt-Mutationen atomar ausführen.
   * `immediate` erzwingt BEGIN IMMEDIATE statt BEGIN DEFERRED — sonst startet die
   * Transaktion als Leser und kann beim ersten Schreibversuch mit
   * SQLITE_BUSY_SNAPSHOT scheitern, ohne dass busy_timeout greift (mehrprozess:
   * Electron-App + stdio-Server auf derselben Datei).
   */
  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate()
  }

  /** Für die Service-Schicht: mehrere Repo-Aufrufe als eine Einheit (BEGIN IMMEDIATE). */
  runInTransaction<T>(fn: () => T): T {
    return this.tx(fn)
  }

  // ---------- Event-Log ----------
  logEvent(projectId: string | null, actor: string, eventType: string, payload: unknown): void {
    this.db
      .prepare(
        `INSERT INTO event_log (project_id, actor, event_type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(projectId, actor, eventType, JSON.stringify(payload ?? {}), nowIso())
  }

  listEvents(projectId: string, limit = 500): EventLogEntry[] {
    return this.db
      .prepare(`SELECT * FROM event_log WHERE project_id = ? ORDER BY seq DESC LIMIT ?`)
      .all(projectId, limit) as EventLogEntry[]
  }

  // ---------- Projekte ----------
  createProject(input: {
    title: string
    research_question: string
    mode: ProjectMode
    policy_preset?: string | null
    kind?: ProjectKind
    actor: string
  }): Project {
    const id = randomUUID()
    const ts = nowIso()
    const kind: ProjectKind = input.kind === 'notebook' ? 'notebook' : 'research'
    this.db
      .prepare(
        `INSERT INTO projects (id, title, research_question, mode, policy_preset, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.title, input.research_question, input.mode, input.policy_preset ?? null, kind, ts, ts)
    this.logEvent(id, input.actor, 'project.created', { title: input.title, mode: input.mode, kind })
    return this.getProject(id)!
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined
    return row ? mapProject(row) : undefined
  }

  touchProject(id: string): void {
    this.db.prepare(`UPDATE projects SET updated_at = ? WHERE id = ?`).run(nowIso(), id)
  }

  setEasyWritingDir(projectId: string, dir: string | null, actor: string): void {
    if (!this.getProject(projectId)) return
    this.db
      .prepare(`UPDATE projects SET easy_writing_dir = ?, updated_at = ? WHERE id = ?`)
      .run(dir, nowIso(), projectId)
    this.logEvent(projectId, actor, 'project.easy_writing_dir', { dir })
  }

  deleteProject(projectId: string, actor: string): boolean {
    const project = this.getProject(projectId)
    if (!project) return false
    this.tx(() => {
      // Optionale FKs ohne CASCADE würden das Löschen sonst mit SQLITE_CONSTRAINT abbrechen.
      this.db.prepare(`UPDATE sources SET sub_question_id = NULL, document_id = NULL WHERE project_id = ?`).run(projectId)
      this.db.prepare(`UPDATE report_versions SET visual_version_id = NULL WHERE project_id = ?`).run(projectId)
      this.db.prepare(`UPDATE visual_versions SET parent_version_id = NULL WHERE project_id = ?`).run(projectId)
      this.db.prepare(`UPDATE search_reflections SET sub_question_id = NULL WHERE project_id = ?`).run(projectId)
      this.db
        .prepare(
          `DELETE FROM reviews
           WHERE (entity_type = 'source' AND entity_id IN (SELECT id FROM sources WHERE project_id = @p))
              OR (entity_type = 'claim' AND entity_id IN (SELECT id FROM claims WHERE project_id = @p))
              OR (entity_type = 'claim_source_link' AND entity_id IN
                   (SELECT l.id FROM claim_source_links l JOIN claims c ON c.id = l.claim_id WHERE c.project_id = @p))
              OR (entity_type = 'report_version' AND entity_id IN (SELECT id FROM report_versions WHERE project_id = @p))`
        )
        .run({ p: projectId })
      this.db
        .prepare(
          `DELETE FROM uncertainty_flags
           WHERE (entity_type = 'source' AND entity_id IN (SELECT id FROM sources WHERE project_id = @p))
              OR (entity_type = 'claim' AND entity_id IN (SELECT id FROM claims WHERE project_id = @p))
              OR (entity_type = 'project' AND entity_id = @p)`
        )
        .run({ p: projectId })
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId)
    })
    this.logEvent(projectId, actor, 'project.deleted', { title: project.title })
    return true
  }

  listProjects(): ProjectSummary[] {
    return this.db
      .prepare(
        `SELECT p.*,
           (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.id) AS source_count,
           (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.id AND s.review_status = 'pending') AS pending_count,
           (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.id AND s.review_status = 'human_signed') AS signed_count,
           (SELECT COUNT(*) FROM claims c WHERE c.project_id = p.id) AS claim_count,
           (SELECT COUNT(*) FROM report_versions r WHERE r.project_id = p.id) AS version_count,
           (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id) AS note_count
         FROM projects p ORDER BY p.updated_at DESC`
      )
      .all()
      .map((row) => mapProjectSummary(row as ProjectSummaryRow))
  }

  // ---------- Quellen ----------
  addSource(input: {
    project_id: string
    url: string
    title: string
    retrieval_method: string
    accessed_at: string
    reason: string
    extraction: string
    contribution: string
    verbatim_quote: string
    quote_locator?: string | null
    confidence?: ConfidenceLevel | null
    sub_question_id?: string | null
    document_id?: string | null
    quote_start?: number | null
    quote_end?: number | null
    doi?: string | null
    authors_json?: string | null
    year?: number | null
    venue?: string | null
    entry_type?: BibEntryType | null
    citekey?: string | null
    source_kind?: SourceKind | null
    actor: string
  }): Source {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO sources (id, project_id, url, title, retrieval_method, accessed_at,
           reason, extraction, contribution, verbatim_quote, quote_locator,
           confidence, sub_question_id, document_id, quote_start, quote_end,
           doi, authors_json, year, venue, entry_type, citekey, source_kind,
           review_status, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        id,
        input.project_id,
        input.url,
        input.title,
        input.retrieval_method,
        input.accessed_at,
        input.reason,
        input.extraction,
        input.contribution,
        input.verbatim_quote,
        input.quote_locator ?? null,
        input.confidence ?? null,
        input.sub_question_id ?? null,
        input.document_id ?? null,
        input.quote_start ?? null,
        input.quote_end ?? null,
        input.doi ?? null,
        input.authors_json ?? null,
        input.year ?? null,
        input.venue ?? null,
        input.entry_type ?? null,
        input.citekey ?? null,
        input.source_kind ?? null,
        nowIso(),
        input.actor
      )
    this.touchProject(input.project_id)
    this.logEvent(input.project_id, input.actor, 'source.added', { source_id: id, url: input.url, title: input.title })
    return this.getSource(id)!
  }

  getSource(id: string): Source | undefined {
    return this.db.prepare(`SELECT * FROM sources WHERE id = ?`).get(id) as Source | undefined
  }

  listSources(projectId: string): Source[] {
    return this.db
      .prepare(`SELECT * FROM sources WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as Source[]
  }

  /** Deterministische Check-Ergebnisse (Verifikations-Ebene 1) festhalten. */
  setSourceChecks(
    id: string,
    checks: { urlResolved: boolean | null; quoteVerified: boolean | null; quoteMatchScore: number | null },
    actor: string
  ): void {
    const src = this.getSource(id)
    if (!src) throw new Error(`source ${id} not found`)
    this.db
      .prepare(
        `UPDATE sources SET url_resolved = ?, quote_verified = ?, quote_match_score = ?,
           review_status = CASE WHEN review_status = 'pending' THEN 'ai_checked' ELSE review_status END
         WHERE id = ?`
      )
      .run(
        checks.urlResolved == null ? null : checks.urlResolved ? 1 : 0,
        checks.quoteVerified == null ? null : checks.quoteVerified ? 1 : 0,
        checks.quoteMatchScore,
        id
      )
    this.logEvent(src.project_id, actor, 'source.checked', { source_id: id, ...checks })
  }

  /** Menschlicher Sign-off — bewusst NUR über IPC/UI erreichbar, nie via MCP. Atomar. */
  signSourceHuman(id: string, verdict: 'human_signed' | 'rejected', note: string | null, reviewer: string): void {
    this.tx(() => {
      const src = this.getSource(id)
      if (!src) throw new Error(`source ${id} not found`)
      this.db.prepare(`UPDATE sources SET review_status = ? WHERE id = ?`).run(verdict, id)
      this.addReview({
        entity_type: 'source',
        entity_id: id,
        reviewer_type: 'human',
        reviewer_id: reviewer,
        verdict: verdict === 'human_signed' ? 'approved' : 'rejected',
        confidence: null,
        evidence_span: null,
        source_snapshot_hash: null,
        note,
        method: 'ui_signoff',
      })
      this.touchProject(src.project_id)
      this.logEvent(src.project_id, reviewer, 'source.human_signoff', { source_id: id, verdict, note })
    })
  }

  setSourceReviewStatus(id: string, status: ReviewStatus, actor: string): void {
    const src = this.getSource(id)
    if (!src) throw new Error(`source ${id} not found`)
    this.db.prepare(`UPDATE sources SET review_status = ? WHERE id = ?`).run(status, id)
    this.logEvent(src.project_id, actor, 'source.status_changed', { source_id: id, status })
  }

  // ---------- Extraktionen ----------
  addExtraction(input: {
    source_id: string
    reasoning_freetext: string
    extracted_fact: string
    verbatim_quote: string
    quote_locator?: string | null
    actor: string
  }): Extraction {
    const src = this.getSource(input.source_id)
    if (!src) throw new Error(`source ${input.source_id} not found`)
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO extractions (id, source_id, reasoning_freetext, extracted_fact, verbatim_quote, quote_locator, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.source_id, input.reasoning_freetext, input.extracted_fact, input.verbatim_quote, input.quote_locator ?? null, nowIso())
    this.logEvent(src.project_id, input.actor, 'extraction.added', { extraction_id: id, source_id: input.source_id })
    return this.db.prepare(`SELECT * FROM extractions WHERE id = ?`).get(id) as Extraction
  }

  listExtractions(projectId: string): Extraction[] {
    return this.db
      .prepare(
        `SELECT e.* FROM extractions e JOIN sources s ON s.id = e.source_id
         WHERE s.project_id = ? ORDER BY e.created_at ASC`
      )
      .all(projectId) as Extraction[]
  }

  // ---------- Claims & Links ----------
  addClaim(input: { project_id: string; claim_text: string; report_section?: string | null; actor: string }): Claim {
    const id = randomUUID()
    this.db
      .prepare(`INSERT INTO claims (id, project_id, claim_text, report_section, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, input.project_id, input.claim_text, input.report_section ?? null, nowIso())
    this.touchProject(input.project_id)
    this.logEvent(input.project_id, input.actor, 'claim.added', { claim_id: id })
    return this.db.prepare(`SELECT * FROM claims WHERE id = ?`).get(id) as Claim
  }

  getClaim(id: string): Claim | undefined {
    return this.db.prepare(`SELECT * FROM claims WHERE id = ?`).get(id) as Claim | undefined
  }

  listClaims(projectId: string): Claim[] {
    return this.db.prepare(`SELECT * FROM claims WHERE project_id = ? ORDER BY created_at ASC`).all(projectId) as Claim[]
  }

  linkClaimToSource(input: {
    claim_id: string
    source_id: string
    quote_span: string
    support_type: SupportType
    confidence?: ConfidenceLevel | null
    actor: string
  }): ClaimSourceLink {
    const claim = this.getClaim(input.claim_id)
    if (!claim) throw new Error(`claim ${input.claim_id} not found`)
    const src = this.getSource(input.source_id)
    if (!src) throw new Error(`source ${input.source_id} not found`)
    // Review-Finding: Cross-Projekt-Belegkanten verhindern
    if (claim.project_id !== src.project_id) {
      throw new Error(
        `claim ${input.claim_id} (Projekt ${claim.project_id}) und source ${input.source_id} (Projekt ${src.project_id}) gehören zu verschiedenen Projekten`
      )
    }
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO claim_source_links (id, claim_id, source_id, quote_span, support_type, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.claim_id, input.source_id, input.quote_span, input.support_type, input.confidence ?? null, nowIso())
    this.logEvent(claim.project_id, input.actor, 'claim.linked', { link_id: id, claim_id: input.claim_id, source_id: input.source_id })
    return this.db.prepare(`SELECT * FROM claim_source_links WHERE id = ?`).get(id) as ClaimSourceLink
  }

  getLink(id: string): ClaimSourceLink | undefined {
    return this.db.prepare(`SELECT * FROM claim_source_links WHERE id = ?`).get(id) as ClaimSourceLink | undefined
  }

  listLinks(projectId: string): ClaimSourceLink[] {
    return this.db
      .prepare(
        `SELECT l.* FROM claim_source_links l JOIN claims c ON c.id = l.claim_id
         WHERE c.project_id = ? ORDER BY l.created_at ASC`
      )
      .all(projectId) as ClaimSourceLink[]
  }

  setLinkVerification(id: string, status: VerificationStatus, confidence: ConfidenceLevel | null, actor: string): void {
    const link = this.db.prepare(`SELECT * FROM claim_source_links WHERE id = ?`).get(id) as ClaimSourceLink | undefined
    if (!link) throw new Error(`link ${id} not found`)
    this.db
      .prepare(`UPDATE claim_source_links SET verification_status = ?, confidence = ? WHERE id = ?`)
      .run(status, confidence, id)
    const claim = this.getClaim(link.claim_id)
    this.logEvent(claim?.project_id ?? null, actor, 'link.verification_set', { link_id: id, status })
  }

  // ---------- Berichte ----------
  addReportVersion(input: {
    project_id: string
    content_markdown: string
    parent_version_id?: string | null
    change_summary?: string | null
    visual_version_id?: string | null
    mark_scope?: boolean
    actor: string
  }): ReportVersion {
    const id = randomUUID()
    const ts = nowIso()
    const hash = createHash('sha256')
      .update(`${input.project_id}\n${input.parent_version_id ?? ''}\n${ts}\n${input.content_markdown}`)
      .digest('hex')
      .slice(0, 16)
    this.db
      .prepare(
        `INSERT INTO report_versions (id, project_id, parent_version_id, content_markdown, snapshot_hash, change_summary,
           visual_version_id, mark_scope, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.project_id,
        input.parent_version_id ?? null,
        input.content_markdown,
        hash,
        input.change_summary ?? null,
        input.visual_version_id ?? null,
        input.mark_scope ? 1 : 0,
        ts,
        input.actor
      )
    this.touchProject(input.project_id)
    this.logEvent(input.project_id, input.actor, 'report.version_added', { version_id: id, snapshot_hash: hash })
    return this.db.prepare(`SELECT * FROM report_versions WHERE id = ?`).get(id) as ReportVersion
  }

  listReportVersions(projectId: string): ReportVersion[] {
    return this.db
      .prepare(`SELECT * FROM report_versions WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as ReportVersion[]
  }

  // ---------- Chat-Protokoll ----------
  addChatMessage(input: {
    project_id: string
    role: string
    content: string
    model_id?: string | null
    model_version?: string | null
    provider?: string | null
    turn_index?: number | null
    actor: string
  }): ChatMessage {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO chat_messages (id, project_id, role, content, model_id, model_version, provider, turn_index, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.project_id,
        input.role,
        input.content,
        input.model_id ?? null,
        input.model_version ?? null,
        input.provider ?? null,
        input.turn_index ?? null,
        nowIso()
      )
    this.logEvent(input.project_id, input.actor, 'chat.logged', { message_id: id, role: input.role })
    return this.db.prepare(`SELECT * FROM chat_messages WHERE id = ?`).get(id) as ChatMessage
  }

  listChatMessages(projectId: string): ChatMessage[] {
    return this.db
      .prepare(`SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC, turn_index ASC`)
      .all(projectId) as ChatMessage[]
  }

  // ---------- Reviews (Verifikations-Kanten; überschreiben nie das Original) ----------
  /** Review-Finding: Reviews nur für real existierende Entitäten zulassen. */
  private assertEntityExists(entityType: Review['entity_type'], entityId: string): void {
    const table =
      entityType === 'source'
        ? 'sources'
        : entityType === 'claim'
          ? 'claims'
          : entityType === 'claim_source_link'
            ? 'claim_source_links'
            : 'report_versions'
    const row = this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(entityId)
    if (!row) throw new Error(`${entityType} ${entityId} not found — Review verweigert`)
  }

  addReview(input: {
    entity_type: Review['entity_type']
    entity_id: string
    reviewer_type: ReviewerType
    reviewer_id: string
    verdict: Verdict
    confidence: ConfidenceLevel | null
    evidence_span: string | null
    source_snapshot_hash: string | null
    note: string | null
    method: string | null
  }): Review {
    this.assertEntityExists(input.entity_type, input.entity_id)
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO reviews (id, entity_type, entity_id, reviewer_type, reviewer_id, verdict,
           confidence, evidence_span, source_snapshot_hash, note, method, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.entity_type,
        input.entity_id,
        input.reviewer_type,
        input.reviewer_id,
        input.verdict,
        input.confidence,
        input.evidence_span,
        input.source_snapshot_hash,
        input.note,
        input.method,
        nowIso()
      )
    return this.db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(id) as Review
  }

  listReviews(projectId: string): Review[] {
    return this.db
      .prepare(
        `SELECT r.* FROM reviews r
         WHERE (r.entity_type = 'source' AND r.entity_id IN (SELECT id FROM sources WHERE project_id = @p))
            OR (r.entity_type = 'claim' AND r.entity_id IN (SELECT id FROM claims WHERE project_id = @p))
            OR (r.entity_type = 'claim_source_link' AND r.entity_id IN
                 (SELECT l.id FROM claim_source_links l JOIN claims c ON c.id = l.claim_id WHERE c.project_id = @p))
            OR (r.entity_type = 'report_version' AND r.entity_id IN (SELECT id FROM report_versions WHERE project_id = @p))
         ORDER BY r.created_at ASC`
      )
      .all({ p: projectId }) as Review[]
  }

  // ---------- Uncertainty-Flags ----------
  addUncertaintyFlag(input: {
    entity_type: string
    entity_id: string
    uncertainty_reason: string
    confidence_level: ConfidenceLevel
    actor: string
  }): UncertaintyFlag {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO uncertainty_flags (id, entity_type, entity_id, uncertainty_reason, confidence_level, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.entity_type, input.entity_id, input.uncertainty_reason, input.confidence_level, nowIso(), input.actor)
    return this.db.prepare(`SELECT * FROM uncertainty_flags WHERE id = ?`).get(id) as UncertaintyFlag
  }

  listUncertaintyFlags(projectId: string): UncertaintyFlag[] {
    return this.db
      .prepare(
        `SELECT f.* FROM uncertainty_flags f
         WHERE (f.entity_type = 'source' AND f.entity_id IN (SELECT id FROM sources WHERE project_id = @p))
            OR (f.entity_type = 'claim' AND f.entity_id IN (SELECT id FROM claims WHERE project_id = @p))
            OR (f.entity_type = 'project' AND f.entity_id = @p)
         ORDER BY f.created_at ASC`
      )
      .all({ p: projectId }) as UncertaintyFlag[]
  }

  // ---------- Suchprozess-Transparenz (PRISMA-S) ----------
  addSearchLog(input: {
    project_id: string
    query: string
    engine?: string | null
    results_found?: number | null
    note?: string | null
    actor: string
  }): SearchLogEntry {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO search_log (id, project_id, query, engine, results_found, note, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.project_id, input.query, input.engine ?? null, input.results_found ?? null, input.note ?? null, nowIso(), input.actor)
    this.logEvent(input.project_id, input.actor, 'search.logged', { search_id: id, query: input.query })
    return this.db.prepare(`SELECT * FROM search_log WHERE id = ?`).get(id) as SearchLogEntry
  }

  listSearchLog(projectId: string): SearchLogEntry[] {
    return this.db.prepare(`SELECT * FROM search_log WHERE project_id = ? ORDER BY created_at ASC`).all(projectId) as SearchLogEntry[]
  }

  listUnreflectedSearches(projectId: string): SearchLogEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM search_log WHERE project_id = ? AND reflection_id IS NULL ORDER BY created_at ASC`
      )
      .all(projectId) as SearchLogEntry[]
  }

  addSearchReflection(input: {
    project_id: string
    covered: string
    underrepresented: string
    next_action: SearchNextAction
    next_query?: string | null
    reason: string
    sub_question_id?: string | null
    actor: string
  }): SearchReflection {
    const id = randomUUID()
    const ts = nowIso()
    return this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO search_reflections (
             id, project_id, covered, underrepresented, next_action, next_query, reason,
             sub_question_id, created_at, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          input.project_id,
          input.covered,
          input.underrepresented,
          input.next_action,
          input.next_query ?? null,
          input.reason,
          input.sub_question_id ?? null,
          ts,
          input.actor
        )
      this.db
        .prepare(`UPDATE search_log SET reflection_id = ? WHERE project_id = ? AND reflection_id IS NULL`)
        .run(id, input.project_id)
      this.logEvent(input.project_id, input.actor, 'search.reflected', {
        reflection_id: id,
        next_action: input.next_action,
      })
      return this.db.prepare(`SELECT * FROM search_reflections WHERE id = ?`).get(id) as SearchReflection
    })
  }

  listSearchReflections(projectId: string): SearchReflection[] {
    return this.db
      .prepare(`SELECT * FROM search_reflections WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as SearchReflection[]
  }

  getLatestSearchReflection(projectId: string): SearchReflection | undefined {
    return this.db
      .prepare(
        `SELECT * FROM search_reflections WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(projectId) as SearchReflection | undefined
  }

  addExcludedSource(input: { project_id: string; url: string; title?: string | null; reason: string; actor: string }): ExcludedSource {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO excluded_sources (id, project_id, url, title, reason, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.project_id, input.url, input.title ?? null, input.reason, nowIso(), input.actor)
    this.logEvent(input.project_id, input.actor, 'source.excluded', { exclusion_id: id, url: input.url, reason: input.reason })
    return this.db.prepare(`SELECT * FROM excluded_sources WHERE id = ?`).get(id) as ExcludedSource
  }

  listExcludedSources(projectId: string): ExcludedSource[] {
    return this.db
      .prepare(`SELECT * FROM excluded_sources WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as ExcludedSource[]
  }

  // ---------- Dokumente (selbst abgerufener Quelltext) ----------
  addDocument(input: {
    project_id: string
    url: string
    title?: string | null
    text: string
    content_hash: string
    purpose?: string | null
    actor: string
    origin?: DocumentOrigin
    filename?: string | null
    page_starts?: number[] | null
    status?: DocumentStatus
  }): FetchedDocument {
    const id = randomUUID()
    const origin: DocumentOrigin = input.origin ?? 'fetched'
    const status: DocumentStatus = input.status ?? 'open'
    const pageJson = input.page_starts && input.page_starts.length > 0 ? JSON.stringify(input.page_starts) : null
    this.db
      .prepare(
        `INSERT INTO documents (id, project_id, url, title, text, char_len, content_hash, fetched_at, fetched_by, purpose, status, origin, filename, page_starts_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.project_id,
        input.url,
        input.title ?? null,
        input.text,
        input.text.length,
        input.content_hash,
        nowIso(),
        input.actor,
        input.purpose ?? null,
        status,
        origin,
        input.filename ?? null,
        pageJson
      )
    this.logEvent(input.project_id, input.actor, origin === 'upload' ? 'document.uploaded' : 'document.fetched', {
      document_id: id,
      url: input.url,
      char_len: input.text.length,
      content_hash: input.content_hash,
      origin,
    })
    return this.getDocument(id)!
  }

  getDocument(id: string): FetchedDocument | undefined {
    const row = this.db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as DocumentRow | undefined
    return row ? mapDocument(row) : undefined
  }

  /** Dokumente ohne Text — für Listen/UI, damit nicht megabyteweise Text durchgereicht wird. */
  listDocuments(projectId: string): Array<Omit<FetchedDocument, 'text'>> {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, url, title, char_len, content_hash, fetched_at, fetched_by, purpose, status, origin, filename, page_starts_json
         FROM documents WHERE project_id = ? ORDER BY fetched_at ASC`
      )
      .all(projectId) as DocumentRow[]
    return rows.map(mapDocumentMeta)
  }

  /** Abgerufen, aber noch nicht dokumentiert — die Pflichten-Warteschlange des Gates. */
  listOpenDocuments(projectId: string): Array<Omit<FetchedDocument, 'text'>> {
    const rows = this.db
      .prepare(
        `SELECT id, project_id, url, title, char_len, content_hash, fetched_at, fetched_by, purpose, status, origin, filename, page_starts_json
         FROM documents WHERE project_id = ? AND status = 'open' ORDER BY fetched_at ASC`
      )
      .all(projectId) as DocumentRow[]
    return rows.map(mapDocumentMeta)
  }

  setDocumentStatus(id: string, status: DocumentStatus, actor: string): void {
    const doc = this.db.prepare(`SELECT project_id FROM documents WHERE id = ?`).get(id) as { project_id: string } | undefined
    if (!doc) return
    this.db.prepare(`UPDATE documents SET status = ? WHERE id = ?`).run(status, id)
    this.logEvent(doc.project_id, actor, 'document.status_changed', { document_id: id, status })
  }

  /** Offene Dokumente zu einer URL schließen (z. B. nach exclude_source). */
  closeOpenDocumentsForUrl(projectId: string, url: string, status: DocumentStatus, actor: string): number {
    const rows = this.db
      .prepare(`SELECT id FROM documents WHERE project_id = ? AND url = ? AND status = 'open'`)
      .all(projectId, url) as Array<{ id: string }>
    for (const r of rows) this.setDocumentStatus(r.id, status, actor)
    return rows.length
  }

  // ---------- Engine-Läufe (Checkpoint/Resume) ----------

  /**
   * Beginnt einen Lauf-Datensatz. Das ist der Checkpoint, nicht das Event-Log:
   * Ein Event sagt, DASS etwas geschah; dieser Datensatz sagt, WO der Lauf steht —
   * und ist damit die einzige Grundlage, auf der ein Abbruch fortsetzbar wird.
   */
  startEngineRun(input: { project_id: string; model: string; resumed_from: string | null }): EngineRun {
    const id = randomUUID()
    const now = nowIso()
    this.db
      .prepare(
        `INSERT INTO engine_runs (id, project_id, model, status, resumed_from, started_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, ?, ?)`
      )
      .run(id, input.project_id, input.model, input.resumed_from, now, now)
    this.logEvent(input.project_id, 'engine', 'engine.run_started', {
      run_id: id,
      model: input.model,
      resumed_from: input.resumed_from,
    })
    return this.getEngineRun(id)!
  }

  getEngineRun(id: string): EngineRun | undefined {
    return this.db.prepare(`SELECT * FROM engine_runs WHERE id = ?`).get(id) as EngineRun | undefined
  }

  /**
   * Fortschritt festhalten. Bewusst häufig aufgerufen und bewusst billig:
   * Ein Checkpoint, der erst am Rundenende geschrieben wird, verliert genau das,
   * was ein Abbruch mitten in einer Teilfrage hinterlässt.
   */
  checkpointEngineRun(
    id: string,
    patch: Partial<Pick<EngineRun, 'phase' | 'round_index' | 'sub_question_id' | 'prompt_tokens' | 'completion_tokens' | 'tool_calls' | 'failed_tool_calls'>>
  ): void {
    const fields = Object.keys(patch) as Array<keyof typeof patch>
    if (fields.length === 0) return
    const set = fields.map((f) => `${f} = ?`).join(', ')
    this.db
      .prepare(`UPDATE engine_runs SET ${set}, updated_at = ? WHERE id = ?`)
      .run(...fields.map((f) => patch[f] ?? null), nowIso(), id)
  }

  endEngineRun(id: string, status: Exclude<EngineRunStatus, 'running'>, stopReason: string | null): void {
    const now = nowIso()
    this.db
      .prepare(`UPDATE engine_runs SET status = ?, stop_reason = ?, ended_at = ?, updated_at = ? WHERE id = ?`)
      .run(status, stopReason, now, now, id)
    const run = this.getEngineRun(id)
    if (run) {
      this.logEvent(run.project_id, 'engine', 'engine.run_finished', {
        run_id: id,
        status,
        stop_reason: stopReason,
        rounds: run.round_index,
        prompt_tokens: run.prompt_tokens,
        completion_tokens: run.completion_tokens,
        tool_calls: run.tool_calls,
        failed_tool_calls: run.failed_tool_calls,
        model: run.model,
      })
    }
  }

  listEngineRuns(projectId: string): EngineRun[] {
    return this.db.prepare(`SELECT * FROM engine_runs WHERE project_id = ? ORDER BY started_at ASC`).all(projectId) as EngineRun[]
  }

  /**
   * Der jüngste Lauf, den fortzusetzen sich lohnt.
   * 'finished' zählt nicht — ein abgeschlossener Lauf wird neu gestartet, nicht fortgesetzt.
   */
  getResumableRun(projectId: string): EngineRun | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM engine_runs
           WHERE project_id = ? AND status IN ('aborted','interrupted','failed')
           ORDER BY started_at DESC LIMIT 1`
        )
        .get(projectId) as EngineRun | undefined) ?? null
    )
  }

  /**
   * Beim App-Start aufzurufen: Ein Lauf mit Status 'running' kann keinen lebenden
   * Prozess mehr haben — er existiert nur im Prozess, der ihn treibt. Ohne diese
   * Heilung bliebe ein abgestürzter Lauf für immer "läuft" und wäre weder
   * fortsetzbar noch als gescheitert erkennbar.
   */
  markRunningAsInterrupted(): number {
    const now = nowIso()
    const res = this.db
      .prepare(
        `UPDATE engine_runs SET status = 'interrupted', ended_at = ?, updated_at = ?,
           stop_reason = COALESCE(stop_reason, 'Prozess beendet, ohne den Lauf abzuschließen.')
         WHERE status = 'running'`
      )
      .run(now, now)
    return res.changes
  }

  // ---------- Teilfragen (Recherchetiefe) ----------
  addSubQuestion(input: {
    project_id: string
    question: string
    rationale?: string | null
    min_sources?: number
    actor: string
  }): SubQuestion {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO sub_questions (id, project_id, question, rationale, status, min_sources, created_at, created_by)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?)`
      )
      .run(id, input.project_id, input.question, input.rationale ?? null, input.min_sources ?? 2, nowIso(), input.actor)
    this.touchProject(input.project_id)
    this.logEvent(input.project_id, input.actor, 'subquestion.added', { sub_question_id: id, question: input.question })
    return this.getSubQuestion(id)!
  }

  getSubQuestion(id: string): SubQuestion | undefined {
    return this.db.prepare(`SELECT * FROM sub_questions WHERE id = ?`).get(id) as SubQuestion | undefined
  }

  listSubQuestions(projectId: string): SubQuestion[] {
    return this.db
      .prepare(`SELECT * FROM sub_questions WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as SubQuestion[]
  }

  setSubQuestionStatus(id: string, status: SubQuestionStatus, closedReason: string | null, actor: string): SubQuestion {
    const sq = this.getSubQuestion(id)
    if (!sq) throw new Error(`sub_question ${id} not found`)
    this.db
      .prepare(`UPDATE sub_questions SET status = ?, closed_reason = ? WHERE id = ?`)
      .run(status, closedReason, id)
    this.logEvent(sq.project_id, actor, 'subquestion.status_changed', { sub_question_id: id, status, reason: closedReason })
    return this.getSubQuestion(id)!
  }

  /** Ordnet eine bereits erfasste Quelle einer Teilfrage zu (Lücken-Nachpflege). */
  assignSourceToSubQuestion(sourceId: string, subQuestionId: string | null, actor: string): Source {
    const src = this.getSource(sourceId)
    if (!src) throw new Error(`source ${sourceId} not found`)
    if (subQuestionId) {
      const sq = this.getSubQuestion(subQuestionId)
      if (!sq) throw new Error(`sub_question ${subQuestionId} not found`)
      if (sq.project_id !== src.project_id) {
        throw new Error(`sub_question ${subQuestionId} gehört zu Projekt ${sq.project_id}, Quelle zu ${src.project_id}`)
      }
    }
    this.db.prepare(`UPDATE sources SET sub_question_id = ? WHERE id = ?`).run(subQuestionId, sourceId)
    this.logEvent(src.project_id, actor, 'source.assigned', { source_id: sourceId, sub_question_id: subQuestionId })
    return this.getSource(sourceId)!
  }

  /**
   * Was als BELEG zählt (eine Definition, überall gleich):
   *  - deterministisch bestätigtes Zitat (quote_verified = 1), ODER
   *  - menschlicher Sign-off (höchste Stufe der Verifikations-Leiter; greift auch
   *    bei PDFs/Paywalls, die maschinell nicht prüfbar sind)
   *  - und in keinem Fall abgelehnt.
   */
  private static readonly VERIFIED_SQL = `(quote_verified = 1 OR review_status = 'human_signed') AND review_status != 'rejected'`

  /**
   * Belegte Quellen je Teilfrage — Grundlage der Abdeckungsrechnung.
   * COUNT(DISTINCT url): dieselbe Fundstelle mehrfach einzutragen darf `min_sources`
   * nicht erfüllen (Review-Finding — sonst misst die Schwelle Tippfleiß statt Beleglage).
   */
  countVerifiedPerSubQuestion(projectId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT sub_question_id AS sq, COUNT(DISTINCT url) AS n FROM sources
         WHERE project_id = ? AND sub_question_id IS NOT NULL AND ${Repo.VERIFIED_SQL}
         GROUP BY sub_question_id`
      )
      .all(projectId) as Array<{ sq: string; n: number }>
    return new Map(rows.map((r) => [r.sq, r.n]))
  }

  /** Alle zugeordneten Quellen je Teilfrage, unabhängig vom Prüfstatus. */
  countAssignedPerSubQuestion(projectId: string): Map<string, number> {
    const rows = this.db
      .prepare(
        `SELECT sub_question_id AS sq, COUNT(DISTINCT url) AS n FROM sources
         WHERE project_id = ? AND sub_question_id IS NOT NULL AND review_status != 'rejected'
         GROUP BY sub_question_id`
      )
      .all(projectId) as Array<{ sq: string; n: number }>
    return new Map(rows.map((r) => [r.sq, r.n]))
  }

  countVerifiedSources(projectId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(DISTINCT url) AS n FROM sources WHERE project_id = ? AND ${Repo.VERIFIED_SQL}`)
      .get(projectId) as { n: number }
    return row.n
  }

  /**
   * Belegte Quellen, die IN dieser Runde hinzugekommen sind.
   * Bewusst nicht als Netto-Delta gegen den Rundenbeginn: sonst kippt eine einzelne
   * Ablehnung die Sättigungsmessung und beendet die Recherche vorzeitig (Review-Finding).
   */
  countVerifiedSourcesSince(projectId: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(DISTINCT url) AS n FROM sources
         WHERE project_id = ? AND created_at >= ? AND ${Repo.VERIFIED_SQL}`
      )
      .get(projectId, sinceIso) as { n: number }
    return row.n
  }

  // ---------- Runden (Sättigungsmessung) ----------
  openRound(projectId: string, actor: string): ResearchRound {
    const last = this.getLatestRound(projectId)
    if (last && last.ended_at === null) return last // bereits offen — idempotent
    const id = randomUUID()
    const index = (last?.round_index ?? 0) + 1
    this.db
      .prepare(
        `INSERT INTO research_rounds (id, project_id, round_index, started_at, verified_at_start, activity_at_start)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, projectId, index, nowIso(), this.countVerifiedSources(projectId), this.countActivity(projectId))
    this.logEvent(projectId, actor, 'round.opened', { round_id: id, round_index: index })
    return this.db.prepare(`SELECT * FROM research_rounds WHERE id = ?`).get(id) as ResearchRound
  }

  /**
   * Schließt die offene Runde. Der UPDATE ist bedingt (`ended_at IS NULL`) — bei zwei
   * gleichzeitigen next_round-Aufrufen gewinnt genau einer, der andere bekommt
   * `undefined` statt derselben Runde doppelt gemeldet (Review-Finding: Lost Update).
   */
  closeRound(projectId: string, note: string | null, actor: string): ResearchRound | undefined {
    const open = this.getLatestRound(projectId)
    if (!open || open.ended_at !== null) return undefined
    const newVerified = this.countVerifiedSourcesSince(projectId, open.started_at)
    const res = this.db
      .prepare(`UPDATE research_rounds SET ended_at = ?, new_verified = ?, note = ? WHERE id = ? AND ended_at IS NULL`)
      .run(nowIso(), newVerified, note, open.id)
    if (res.changes === 0) return undefined // ein anderer Client war schneller
    this.logEvent(projectId, actor, 'round.closed', { round_id: open.id, round_index: open.round_index, new_verified: newVerified })
    return this.db.prepare(`SELECT * FROM research_rounds WHERE id = ?`).get(open.id) as ResearchRound
  }

  /** Gesamte Recherche-Aktivität eines Projekts (Quellen, Ausschlüsse, Suchen). */
  countActivity(projectId: string): number {
    const row = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM sources WHERE project_id = @p)
              + (SELECT COUNT(*) FROM excluded_sources WHERE project_id = @p)
              + (SELECT COUNT(*) FROM search_log WHERE project_id = @p) AS n`
      )
      .get({ p: projectId }) as { n: number }
    return row.n
  }

  /** close + open atomar — sonst kann zwischen beiden eine zweite Runde entstehen. */
  advanceRoundAtomic(
    projectId: string,
    note: string | null,
    actor: string,
    shouldReopen: (closed: ResearchRound) => boolean
  ): { closed: ResearchRound | undefined; opened: ResearchRound | null } {
    return this.tx(() => {
      const closed = this.closeRound(projectId, note, actor)
      if (!closed) return { closed: undefined, opened: null }
      const opened = shouldReopen(closed) ? this.openRound(projectId, actor) : null
      return { closed, opened }
    })
  }

  getLatestRound(projectId: string): ResearchRound | undefined {
    return this.db
      .prepare(`SELECT * FROM research_rounds WHERE project_id = ? ORDER BY round_index DESC LIMIT 1`)
      .get(projectId) as ResearchRound | undefined
  }

  listRounds(projectId: string): ResearchRound[] {
    return this.db
      .prepare(`SELECT * FROM research_rounds WHERE project_id = ? ORDER BY round_index ASC`)
      .all(projectId) as ResearchRound[]
  }

  /**
   * Aussagen ohne TRAGFÄHIGEN Beleg — die häufigste stille Lücke.
   * Eine Belegkante trägt nicht, wenn die Quelle abgelehnt wurde oder die geblindete
   * Verifikation sie widerlegt hat. Sonst hätte die menschliche Ablehnung einer Quelle
   * keine Wirkung auf die Abdeckung (Review-Finding).
   */
  listUnlinkedClaims(projectId: string): Claim[] {
    return this.db
      .prepare(
        `SELECT c.* FROM claims c
         WHERE c.project_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM claim_source_links l
             JOIN sources s ON s.id = l.source_id
             WHERE l.claim_id = c.id
               AND s.review_status != 'rejected'
               AND l.verification_status NOT IN ('unsupported','source_unreachable')
           )
         ORDER BY c.created_at ASC`
      )
      .all(projectId) as Claim[]
  }

  // ---------- Evidenzkarte (v6) ----------
  insertVisualVersion(input: {
    project_id: string
    parent_version_id: string | null
    prompt: string
    layout_kind: VisualLayoutKind
    scope: VisualScope
    interpretative: boolean
    snapshot_hash: string
    nodes: Array<{
      kind: VisualNodeKind
      entity_id: string
      label: string
      cluster_key: string | null
      pos_x: number
      pos_y: number
    }>
    edges: Array<{ from_index: number; to_index: number; relation: VisualRelation }>
    actor: string
  }): { version: VisualVersion; nodes: VisualNode[]; edges: VisualEdge[] } {
    return this.tx(() => {
      const versionId = randomUUID()
      const ts = nowIso()
      this.db
        .prepare(
          `INSERT INTO visual_versions (id, project_id, parent_version_id, prompt, layout_kind, scope, interpretative, snapshot_hash, created_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          versionId,
          input.project_id,
          input.parent_version_id,
          input.prompt,
          input.layout_kind,
          input.scope,
          input.interpretative ? 1 : 0,
          input.snapshot_hash,
          ts,
          input.actor
        )
      const nodeIds: string[] = []
      const insertNode = this.db.prepare(
        `INSERT INTO visual_nodes (id, version_id, kind, entity_id, label, cluster_key, pos_x, pos_y)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      for (const n of input.nodes) {
        const id = randomUUID()
        nodeIds.push(id)
        insertNode.run(id, versionId, n.kind, n.entity_id, n.label, n.cluster_key, n.pos_x, n.pos_y)
      }
      const insertEdge = this.db.prepare(
        `INSERT INTO visual_edges (id, version_id, from_node, to_node, relation) VALUES (?, ?, ?, ?, ?)`
      )
      for (const e of input.edges) {
        const from = nodeIds[e.from_index]
        const to = nodeIds[e.to_index]
        if (!from || !to) throw new Error('visual_edge index out of range')
        insertEdge.run(randomUUID(), versionId, from, to, e.relation)
      }
      this.touchProject(input.project_id)
      this.logEvent(input.project_id, input.actor, 'visual.prepared', {
        version_id: versionId,
        layout_kind: input.layout_kind,
        node_count: input.nodes.length,
      })
      return this.getVisualVersion(versionId)!
    })
  }

  listVisualVersions(projectId: string): VisualVersion[] {
    return this.db
      .prepare(`SELECT * FROM visual_versions WHERE project_id = ? ORDER BY created_at DESC`)
      .all(projectId) as VisualVersion[]
  }

  getVisualVersion(id: string): { version: VisualVersion; nodes: VisualNode[]; edges: VisualEdge[] } | undefined {
    const version = this.db.prepare(`SELECT * FROM visual_versions WHERE id = ?`).get(id) as VisualVersion | undefined
    if (!version) return undefined
    const nodes = this.db
      .prepare(`SELECT * FROM visual_nodes WHERE version_id = ? ORDER BY kind, entity_id`)
      .all(id) as VisualNode[]
    const edges = this.db.prepare(`SELECT * FROM visual_edges WHERE version_id = ?`).all(id) as VisualEdge[]
    return { version, nodes, edges }
  }

  listMarks(projectId: string): Mark[] {
    return this.db
      .prepare(`SELECT * FROM marks WHERE project_id = ? ORDER BY created_at ASC`)
      .all(projectId) as Mark[]
  }

  getMark(projectId: string, entityType: MarkEntityType, entityId: string): Mark | undefined {
    return this.db
      .prepare(`SELECT * FROM marks WHERE project_id = ? AND entity_type = ? AND entity_id = ?`)
      .get(projectId, entityType, entityId) as Mark | undefined
  }

  addMark(input: { project_id: string; entity_type: MarkEntityType; entity_id: string; actor: string }): Mark {
    const existing = this.getMark(input.project_id, input.entity_type, input.entity_id)
    if (existing) return existing
    const id = randomUUID()
    this.db
      .prepare(`INSERT INTO marks (id, project_id, entity_type, entity_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, input.project_id, input.entity_type, input.entity_id, nowIso(), input.actor)
    this.logEvent(input.project_id, input.actor, 'mark.added', { entity_type: input.entity_type, entity_id: input.entity_id })
    return this.getMark(input.project_id, input.entity_type, input.entity_id)!
  }

  removeMark(projectId: string, entityType: MarkEntityType, entityId: string, actor: string): boolean {
    const res = this.db
      .prepare(`DELETE FROM marks WHERE project_id = ? AND entity_type = ? AND entity_id = ?`)
      .run(projectId, entityType, entityId)
    if (res.changes > 0)     this.logEvent(projectId, actor, 'mark.removed', { entity_type: entityType, entity_id: entityId })
    return res.changes > 0
  }

  // ---------- Research-Brief (v7) ----------
  addResearchBrief(input: {
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
    year_from?: number | null
    year_to?: number | null
    min_empirical?: number | null
    discipline?: BriefDiscipline | null
    actor: string
  }): ResearchBrief {
    const id = randomUUID()
    const ts = nowIso()
    const adopted = input.status === 'adopted'
    this.db
      .prepare(
        `INSERT INTO research_briefs (
           id, project_id, status, deliverable, audience, goal, frames_json, chosen_frame_key,
           inclusion, exclusion, sub_questions_json, stop_rule, taboos, markdown,
           year_from, year_to, min_empirical, discipline,
           created_at, created_by, adopted_at, adopted_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.project_id,
        input.status,
        input.deliverable,
        input.audience,
        input.goal,
        JSON.stringify(input.frames),
        input.chosen_frame_key,
        input.inclusion,
        input.exclusion,
        JSON.stringify(input.sub_questions),
        input.stop_rule,
        input.taboos,
        input.markdown,
        input.year_from ?? null,
        input.year_to ?? null,
        input.min_empirical ?? null,
        input.discipline ?? null,
        ts,
        input.actor,
        adopted ? ts : null,
        adopted ? input.actor : null
      )
    this.touchProject(input.project_id)
    this.logEvent(input.project_id, input.actor, adopted ? 'brief.adopted' : 'brief.drafted', { brief_id: id })
    return this.getResearchBrief(id)!
  }

  getResearchBrief(id: string): ResearchBrief | undefined {
    const row = this.db.prepare(`SELECT * FROM research_briefs WHERE id = ?`).get(id) as BriefRow | undefined
    return row ? mapBrief(row) : undefined
  }

  getAdoptedBrief(projectId: string): ResearchBrief | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM research_briefs WHERE project_id = ? AND status = 'adopted'
         ORDER BY adopted_at DESC, created_at DESC LIMIT 1`
      )
      .get(projectId) as BriefRow | undefined
    return row ? mapBrief(row) : undefined
  }

  getLatestBrief(projectId: string): ResearchBrief | undefined {
    const row = this.db
      .prepare(`SELECT * FROM research_briefs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`)
      .get(projectId) as BriefRow | undefined
    return row ? mapBrief(row) : undefined
  }

  markBriefAdopted(id: string, actor: string): ResearchBrief {
    const ts = nowIso()
    const existing = this.getResearchBrief(id)
    if (!existing) throw new Error(`brief ${id} not found`)
    this.db
      .prepare(`UPDATE research_briefs SET status = 'adopted', adopted_at = ?, adopted_by = ? WHERE id = ?`)
      .run(ts, actor, id)
    this.touchProject(existing.project_id)
    this.logEvent(existing.project_id, actor, 'brief.adopted', { brief_id: id })
    return this.getResearchBrief(id)!
  }

  listCitekeys(projectId: string): string[] {
    return (
      this.db.prepare(`SELECT citekey FROM sources WHERE project_id = ? AND citekey IS NOT NULL`).all(projectId) as Array<{
        citekey: string
      }>
    ).map((r) => r.citekey)
  }

  setSourceBiblio(
    sourceId: string,
    patch: {
      doi?: string | null
      authors_json?: string | null
      year?: number | null
      venue?: string | null
      entry_type?: BibEntryType | null
      citekey?: string | null
      source_kind?: SourceKind | null
    }
  ): Source {
    const src = this.getSource(sourceId)
    if (!src) throw new Error(`source ${sourceId} not found`)
    this.db
      .prepare(
        `UPDATE sources SET
           doi = COALESCE(?, doi),
           authors_json = COALESCE(?, authors_json),
           year = COALESCE(?, year),
           venue = COALESCE(?, venue),
           entry_type = COALESCE(?, entry_type),
           citekey = COALESCE(?, citekey),
           source_kind = COALESCE(?, source_kind)
         WHERE id = ?`
      )
      .run(
        patch.doi ?? null,
        patch.authors_json ?? null,
        patch.year ?? null,
        patch.venue ?? null,
        patch.entry_type ?? null,
        patch.citekey ?? null,
        patch.source_kind ?? null,
        sourceId
      )
    return this.getSource(sourceId)!
  }

  // ---------- Aggregat ----------
  getProjectState(projectId: string): ProjectState {
    const project = this.getProject(projectId)
    if (!project) throw new Error(`project ${projectId} not found`)
    return {
      project,
      sources: this.listSources(projectId),
      extractions: this.listExtractions(projectId),
      claims: this.listClaims(projectId),
      links: this.listLinks(projectId),
      reportVersions: this.listReportVersions(projectId),
      chatMessages: this.listChatMessages(projectId),
      reviews: this.listReviews(projectId),
      uncertaintyFlags: this.listUncertaintyFlags(projectId),
      searchLog: this.listSearchLog(projectId),
      searchReflections: this.listSearchReflections(projectId),
      excludedSources: this.listExcludedSources(projectId),
      subQuestions: this.listSubQuestions(projectId),
      rounds: this.listRounds(projectId),
      marks: this.listMarks(projectId),
      visualVersions: this.listVisualVersions(projectId),
      researchBrief: this.getAdoptedBrief(projectId) ?? this.getLatestBrief(projectId) ?? null,
      documents: this.listDocuments(projectId),
      notes: this.listNotes(projectId),
    }
  }

  // ---------- Notizen (Notebook) ----------
  addNote(input: {
    project_id: string
    title: string
    body_markdown: string
    file_name: string
    origin?: NoteOrigin
    citations?: NoteCitation[]
  }): Note {
    const id = randomUUID()
    const ts = nowIso()
    const origin: NoteOrigin = input.origin ?? 'human'
    const citations = input.citations ?? []
    this.db
      .prepare(
        `INSERT INTO notes (id, project_id, title, body_markdown, file_name, origin, citations_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.project_id, input.title, input.body_markdown, input.file_name, origin, JSON.stringify(citations), ts, ts)
    return this.getNote(id)!
  }

  getNote(id: string): Note | undefined {
    const row = this.db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id) as NoteRow | undefined
    return row ? mapNote(row) : undefined
  }

  listNotes(projectId: string): Note[] {
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE project_id = ? ORDER BY updated_at DESC`)
      .all(projectId) as NoteRow[]
    return rows.map(mapNote)
  }

  updateNote(
    id: string,
    patch: { title?: string; body_markdown?: string; file_name?: string; citations?: NoteCitation[] }
  ): Note | undefined {
    const current = this.getNote(id)
    if (!current) return undefined
    const title = patch.title ?? current.title
    const body = patch.body_markdown ?? current.body_markdown
    const fileName = patch.file_name ?? current.file_name
    const citations = patch.citations ?? current.citations
    this.db
      .prepare(`UPDATE notes SET title = ?, body_markdown = ?, file_name = ?, citations_json = ?, updated_at = ? WHERE id = ?`)
      .run(title, body, fileName, JSON.stringify(citations), nowIso(), id)
    this.touchProject(current.project_id)
    return this.getNote(id)
  }

  deleteNote(id: string): boolean {
    const current = this.getNote(id)
    if (!current) return false
    this.db.prepare(`DELETE FROM notes WHERE id = ?`).run(id)
    return true
  }

  searchSources(projectId: string, query: string): Source[] {
    if (!query.trim()) return []
    return this.db
      .prepare(
        `SELECT s.* FROM sources_fts f JOIN sources s ON s.rowid = f.rowid
         WHERE sources_fts MATCH ? AND s.project_id = ? LIMIT 50`
      )
      .all(ftsQuery(query), projectId) as Source[]
  }

  /** Volltextsuche im Korpus. Liefert Treffer mit Zeichenpositionen, kein Zitat-Abschreiben. */
  searchDocuments(projectId: string, query: string): DocumentSearchHit[] {
    const q = query.trim()
    if (!q) return []
    let rows: Array<{
      id: string
      title: string | null
      url: string
      origin: string | null
      char_len: number
      text: string
    }> = []
    try {
      rows = this.db
        .prepare(
          `SELECT d.id, d.title, d.url, d.origin, d.char_len, d.text
           FROM documents_fts f JOIN documents d ON d.rowid = f.rowid
           WHERE documents_fts MATCH ? AND d.project_id = ? AND d.status != 'excluded'
           LIMIT 20`
        )
        .all(ftsQuery(q), projectId) as typeof rows
    } catch {
      return []
    }
    return rows.map((row) => ({
      document_id: row.id,
      title: row.title,
      url: row.url,
      origin: mapDocumentOrigin(row.origin),
      char_len: row.char_len,
      matches: findTextMatches(row.text, q),
    }))
  }
}

/** Nutzer-Query in eine sichere FTS5-Prefix-Query übersetzen. */
function ftsQuery(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ')
}

interface DocumentRow {
  id: string
  project_id: string
  url: string
  title: string | null
  text?: string
  char_len: number
  content_hash: string
  fetched_at: string
  fetched_by: string
  purpose: string | null
  status: DocumentStatus
  origin?: string | null
  filename?: string | null
  page_starts_json?: string | null
}

interface ProjectRow {
  id: string
  title: string
  research_question: string
  mode: ProjectMode
  kind?: string | null
  policy_preset: string | null
  easy_writing_dir: string | null
  created_at: string
  updated_at: string
}

interface ProjectSummaryRow extends ProjectRow {
  source_count: number
  pending_count: number
  signed_count: number
  claim_count: number
  version_count: number
  note_count?: number
}

interface NoteRow {
  id: string
  project_id: string
  title: string
  body_markdown: string
  file_name: string
  origin: string
  citations_json: string
  created_at: string
  updated_at: string
}

function mapProjectKind(kind: string | null | undefined): ProjectKind {
  return kind === 'notebook' ? 'notebook' : 'research'
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    research_question: row.research_question,
    mode: row.mode,
    kind: mapProjectKind(row.kind),
    policy_preset: row.policy_preset,
    easy_writing_dir: row.easy_writing_dir,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function mapProjectSummary(row: ProjectSummaryRow): ProjectSummary {
  return {
    ...mapProject(row),
    source_count: Number(row.source_count) || 0,
    pending_count: Number(row.pending_count) || 0,
    signed_count: Number(row.signed_count) || 0,
    claim_count: Number(row.claim_count) || 0,
    version_count: Number(row.version_count) || 0,
    note_count: Number(row.note_count) || 0,
  }
}

function mapDocumentOrigin(origin: string | null | undefined): DocumentOrigin {
  if (origin === 'upload') return 'upload'
  if (origin === 'youtube') return 'youtube'
  return 'fetched'
}

function mapNoteOrigin(origin: string): NoteOrigin {
  if (origin === 'chat') return 'chat'
  if (origin === 'agent') return 'agent'
  return 'human'
}

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    body_markdown: row.body_markdown,
    file_name: row.file_name,
    origin: mapNoteOrigin(row.origin),
    citations: parseNoteCitations(row.citations_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function parseNoteCitations(raw: string): NoteCitation[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((c): c is NoteCitation => {
      if (!c || typeof c !== 'object') return false
      const rec = c as Record<string, unknown>
      return (
        typeof rec.document_id === 'string' &&
        typeof rec.quote_start === 'number' &&
        typeof rec.quote_end === 'number' &&
        typeof rec.quote === 'string'
      )
    })
  } catch {
    return []
  }
}

function parsePageStarts(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || !parsed.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    return parsed
  } catch {
    return null
  }
}

function mapDocument(row: DocumentRow): FetchedDocument {
  return {
    id: row.id,
    project_id: row.project_id,
    url: row.url,
    title: row.title,
    text: row.text ?? '',
    char_len: row.char_len,
    content_hash: row.content_hash,
    fetched_at: row.fetched_at,
    fetched_by: row.fetched_by,
    purpose: row.purpose,
    status: row.status,
    origin: mapDocumentOrigin(row.origin),
    filename: row.filename ?? null,
    page_starts: parsePageStarts(row.page_starts_json),
  }
}

function mapDocumentMeta(row: DocumentRow): Omit<FetchedDocument, 'text'> {
  const mapped = mapDocument(row)
  return {
    id: mapped.id,
    project_id: mapped.project_id,
    url: mapped.url,
    title: mapped.title,
    char_len: mapped.char_len,
    content_hash: mapped.content_hash,
    fetched_at: mapped.fetched_at,
    fetched_by: mapped.fetched_by,
    purpose: mapped.purpose,
    status: mapped.status,
    origin: mapped.origin,
    filename: mapped.filename,
    page_starts: mapped.page_starts,
  }
}

function findTextMatches(text: string, query: string, maxHits = 8): Array<{ start: number; end: number; snippet: string }> {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, ''))
    .filter((t) => t.length >= 2)
  const hits: Array<{ start: number; end: number; snippet: string }> = []
  const lower = text.toLowerCase()
  for (const term of terms) {
    const needle = term.toLowerCase()
    let from = 0
    while (hits.length < maxHits) {
      const i = lower.indexOf(needle, from)
      if (i < 0) break
      const end = i + needle.length
      const snipFrom = Math.max(0, i - 80)
      const snipTo = Math.min(text.length, end + 80)
      hits.push({
        start: i,
        end,
        snippet: `${snipFrom > 0 ? '…' : ''}${text.slice(snipFrom, snipTo)}${snipTo < text.length ? '…' : ''}`,
      })
      from = end
    }
  }
  return hits
}

interface BriefRow {
  id: string
  project_id: string
  status: BriefStatus
  deliverable: BriefDeliverable
  audience: string
  goal: string
  frames_json: string
  chosen_frame_key: string
  inclusion: string
  exclusion: string
  sub_questions_json: string
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

function mapBrief(row: BriefRow): ResearchBrief {
  let frames: ResearchFrame[] = []
  let subQuestions: string[] = []
  try {
    frames = JSON.parse(row.frames_json) as ResearchFrame[]
  } catch {
    frames = []
  }
  try {
    subQuestions = JSON.parse(row.sub_questions_json) as string[]
  } catch {
    subQuestions = []
  }
  return {
    id: row.id,
    project_id: row.project_id,
    status: row.status,
    deliverable: row.deliverable,
    audience: row.audience,
    goal: row.goal,
    frames,
    chosen_frame_key: row.chosen_frame_key,
    inclusion: row.inclusion,
    exclusion: row.exclusion,
    sub_questions: subQuestions,
    stop_rule: row.stop_rule,
    taboos: row.taboos,
    markdown: row.markdown,
    year_from: row.year_from,
    year_to: row.year_to,
    min_empirical: row.min_empirical,
    discipline: row.discipline,
    created_at: row.created_at,
    created_by: row.created_by,
    adopted_at: row.adopted_at,
    adopted_by: row.adopted_by,
  }
}
