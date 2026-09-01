import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { agentSettingsPath } from '../paths'
import type { AgentSettings } from '../../../shared/agent'

const DEFAULT_MODEL = 'composer-2.5'

export function defaultAgentSettings(): AgentSettings {
  return { modelId: DEFAULT_MODEL, paramValues: { fast: 'false' }, yolo: false }
}

/** Nur Umgebung — kein gespeicherter Paste-Key. Das SDK liest denselben Wert selbst. */
export function loadApiKey(): string | null {
  const fromEnv = process.env.CURSOR_API_KEY?.trim()
  return fromEnv ? fromEnv : null
}

export function apiKeySource(): 'env' | null {
  return loadApiKey() ? 'env' : null
}

interface StoredSettings extends AgentSettings {
  agentIds?: Record<string, string>
}

export function loadAgentSettings(): StoredSettings {
  if (!existsSync(agentSettingsPath())) return { ...defaultAgentSettings(), agentIds: {} }
  try {
    const raw = JSON.parse(readFileSync(agentSettingsPath(), 'utf-8')) as Partial<StoredSettings>
    return {
      modelId: typeof raw.modelId === 'string' && raw.modelId ? raw.modelId : DEFAULT_MODEL,
      paramValues: raw.paramValues && typeof raw.paramValues === 'object' ? raw.paramValues : { fast: 'false' },
      yolo: raw.yolo === true,
      agentIds: raw.agentIds && typeof raw.agentIds === 'object' ? raw.agentIds : {},
    }
  } catch {
    return { ...defaultAgentSettings(), agentIds: {} }
  }
}

export function saveAgentSettings(next: StoredSettings): void {
  mkdirSync(dirname(agentSettingsPath()), { recursive: true })
  writeFileSync(agentSettingsPath(), JSON.stringify(next, null, 2), 'utf-8')
}

export function rememberAgentId(projectId: string, agentId: string): void {
  const cur = loadAgentSettings()
  saveAgentSettings({ ...cur, agentIds: { ...(cur.agentIds ?? {}), [projectId]: agentId } })
}

export function rememberedAgentId(projectId: string): string | null {
  return loadAgentSettings().agentIds?.[projectId] ?? null
}

/** Behält gültige Parameter; Fast defaulted auf aus, sonst erster erlaubter Wert. */
export function normalizeParamValues(
  parameters: Array<{ id: string; values: Array<{ value: string }> }>,
  saved: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of parameters) {
    const allowed = new Set(p.values.map((v) => v.value))
    const want = saved[p.id]
    if (want && allowed.has(want)) out[p.id] = want
    else if (p.id === 'fast' && allowed.has('false')) out[p.id] = 'false'
    else if (p.values[0]) out[p.id] = p.values[0].value
  }
  return out
}
