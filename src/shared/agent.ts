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
}

export type AgentChatEvent =
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; callId: string; name: string; status: 'running' | 'completed' | 'error' }
  | { type: 'status'; text: string }
  | { type: 'request'; text: string }
  | { type: 'run_end'; status: 'finished' | 'error' | 'cancelled'; error?: string }

export interface AgentRunState {
  projectId: string
  running: boolean
  agentId: string | null
}

export interface AgentSendResult {
  ok: boolean
  error?: string
  agentId?: string
}
