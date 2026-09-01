/**
 * Typen für den In-App-Cursor-Agenten (Renderer ↔ Main).
 * Keine SDK-Typen hier — der Renderer darf @cursor/sdk nicht laden.
 */

export interface AgentAuthStatus {
  signedIn: boolean
  email: string | null
  name: string | null
  keyName: string | null
  error: string | null
  /** Browser-Login, oder `CURSOR_API_KEY` in der Umgebung (kein Paste-Feld). */
  keySource: 'env' | 'browser' | null
  expiresAtMs: number | null
  /** true, wenn `expiresAtMs` in der Vergangenheit liegt. */
  expired: boolean
}

export interface AgentModelParamOption {
  value: string
  displayName: string
}

export interface AgentModelParam {
  id: string
  displayName: string
  values: AgentModelParamOption[]
}

export interface AgentModelInfo {
  id: string
  displayName: string
  description: string | null
  parameters: AgentModelParam[]
}

export interface AgentSettings {
  modelId: string
  /** z. B. { fast: "false", reasoning_effort: "medium" } — nur IDs, die das Modell kennt. */
  paramValues: Record<string, string>
  /**
   * YOLO: nach adoptiertem Brief keine Klärungsfragen mehr.
   * Das Briefing selbst bleibt; Offsets, Such-Lage und Sign-off bleiben Pflicht.
   * Notebook: keine Auswirkung aufs Speichern — das macht der Button unter der Antwort.
   */
  yolo: boolean
}

export type AgentMode = 'agent' | 'plan'

export type AgentMentionKind = 'source' | 'inbox' | 'question'

/** Kontext-Chip, der mit dem nächsten Turn mitgeht. */
export interface AgentMention {
  kind: AgentMentionKind
  id: string
  label: string
}

export interface AgentMentionable extends AgentMention {
  hint?: string
}

export type AgentChatEvent =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; callId: string; name: string; status: 'running' | 'completed' | 'error' }
  | { type: 'status'; text: string }
  | { type: 'request'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; totalTokens?: number }
  | { type: 'run_end'; status: 'finished' | 'error' | 'cancelled'; error?: string }

export interface AgentRunState {
  projectId: string
  running: boolean
  agentId: string | null
  sessionId: string | null
}

export interface AgentSendInput {
  text: string
  attached?: string[]
  mode?: AgentMode
  mentions?: AgentMention[]
  /** Überschreibt die gespeicherte YOLO-Einstellung für diesen Turn. */
  yolo?: boolean
}

export interface AgentSendResult {
  ok: boolean
  error?: string
  agentId?: string
}

export interface AgentSessionMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface AgentSessionsSnapshot {
  activeId: string | null
  open: AgentSessionMeta[]
  all: AgentSessionMeta[]
}

export interface AgentSessionResult {
  ok: boolean
  error?: string
  sessions: AgentSessionsSnapshot
  history: AgentChatEvent[]
}

export interface AgentEventPayload {
  projectId: string
  sessionId: string | null
  event: AgentChatEvent
}
