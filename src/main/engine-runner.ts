import { BrowserWindow } from 'electron'
import type { Repo } from './core/repo'
import { OllamaProvider } from './core/providers/ollama'
import { ResearchEngine, type EngineEvent, type EngineRunResult } from './core/engine/research-engine'
import type { EngineRun } from '../shared/types'

/**
 * Verwaltet den EINEN laufenden Engine-Lauf.
 *
 * Bewusst nur einer gleichzeitig: Es ist eine Einzelplatz-Desktop-App, und zwei
 * parallele Läufe im selben Projekt würden die Rundenzählung durcheinanderbringen
 * (der Sättigungs-Vergleich stützt sich auf „neue belegte Quellen dieser Runde").
 */

export interface StartEngineInput {
  projectId: string
  model: string
  maxRounds?: number
  maxTurnsPerSubQuestion?: number
  maxTokens?: number
  think?: boolean
  temperature?: number
  contextLength?: number
  /** Token-Obergrenze für den GESAMTEN Lauf — der Quota-Guard. 0 = unbegrenzt. */
  maxTotalTokens?: number
  /** Einen abgebrochenen oder abgestürzten Lauf fortsetzen. */
  resume?: boolean
}

export interface EngineStatus {
  running: boolean
  projectId: string | null
  model: string | null
  startedAt: string | null
  /** Letzte Ereignisse, damit die UI nach einem Fensterwechsel nicht blind ist. */
  recent: EngineEvent[]
}

const RECENT_MAX = 200

export class EngineRunner {
  private controller: AbortController | null = null
  private projectId: string | null = null
  private model: string | null = null
  private startedAt: string | null = null
  private recent: EngineEvent[] = []

  constructor(private readonly repo: Repo) {}

  status(): EngineStatus {
    return {
      running: this.controller !== null,
      projectId: this.projectId,
      model: this.model,
      startedAt: this.startedAt,
      recent: this.recent,
    }
  }

  stop(): boolean {
    if (!this.controller) return false
    this.controller.abort()
    return true
  }

  /** Der jüngste unterbrochene Lauf dieses Projekts — Grundlage für „Fortsetzen". */
  resumable(projectId: string): EngineRun | null {
    return this.repo.getResumableRun(projectId)
  }

  async start(input: StartEngineInput, sender: Electron.WebContents): Promise<EngineRunResult> {
    if (this.controller) throw new Error('Es läuft bereits eine Recherche. Bitte zuerst abbrechen.')
    const project = this.repo.getProject(input.projectId)
    if (!project) throw new Error(`Projekt ${input.projectId} existiert nicht.`)

    const provider = new OllamaProvider()
    // Vorab prüfen, statt mitten im Lauf mit einem kryptischen Fehler zu scheitern.
    const health = await provider.health()
    if (!health.reachable) {
      throw new Error(`Ollama ist nicht erreichbar (${provider.endpoint}). ${health.note}`)
    }

    this.controller = new AbortController()
    this.projectId = input.projectId
    this.model = input.model
    this.startedAt = new Date().toISOString()
    this.recent = []

    const win = BrowserWindow.fromWebContents(sender)
    const emit = (e: EngineEvent) => {
      this.recent.push(e)
      if (this.recent.length > RECENT_MAX) this.recent.splice(0, this.recent.length - RECENT_MAX)
      try {
        // Fenster kann geschlossen worden sein — der Lauf soll deshalb nicht abbrechen.
        if (win && !win.isDestroyed()) win.webContents.send('engine:event', e)
      } catch {
        /* Fenster weg, Lauf läuft weiter */
      }
    }

    const engine = new ResearchEngine(this.repo, {
      provider,
      model: input.model,
      maxRounds: input.maxRounds,
      temperature: input.temperature,
      contextLength: input.contextLength,
      think: input.think,
      limits: {
        ...(input.maxTurnsPerSubQuestion ? { maxTurns: input.maxTurnsPerSubQuestion } : {}),
        ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
      },
      budget: { maxTotalTokens: input.maxTotalTokens ?? 0 },
    })

    // Der Lauf-Datensatz (und damit auch engine.run_started) entsteht in der Engine —
    // sonst hätte der Checkpoint keine ID, auf die sich das Ereignis beziehen kann.
    try {
      return await engine.run({
        projectId: input.projectId,
        researchQuestion: project.research_question,
        signal: this.controller.signal,
        onEvent: emit,
        resume: input.resume,
      })
    } finally {
      this.controller = null
      this.projectId = null
      this.model = null
      this.startedAt = null
    }
  }
}
