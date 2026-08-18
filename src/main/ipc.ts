import { app, ipcMain, dialog, clipboard, BrowserWindow } from 'electron'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Repo } from './core/repo'
import type { RunningHttpServer } from './mcp/http'
import { reVerifyProject } from './core/enforce/verify'
import { exportProjectMarkdown } from './core/export/markdown'
import { seedDemoProject } from './core/seed'
import { computeCoverage } from './core/services/research'
import { OllamaProvider } from './core/providers/ollama'
import { EngineRunner, type StartEngineInput } from './engine-runner'
import type { ServerInfo } from '../shared/types'

/**
 * IPC-Brücke Renderer ↔ Main. Menschlicher Sign-off läuft AUSSCHLIESSLICH
 * hier (nie über MCP) — das ist Teil des Enforcement-Designs.
 */
interface IpcDeps {
  repo: Repo
  dbPath: string
  mcp: () => RunningHttpServer | null
}

export function registerIpc(deps: IpcDeps): void {
  const { repo } = deps
  const HUMAN = 'human:ui'

  ipcMain.handle('projects:list', () => repo.listProjects())
  ipcMain.handle('projects:create', (_e, input: { title: string; research_question: string; mode: 'academic' | 'business' }) =>
    repo.createProject({ ...input, policy_preset: null, actor: HUMAN })
  )
  ipcMain.handle('projects:state', (_e, projectId: string) => repo.getProjectState(projectId))
  ipcMain.handle('projects:events', (_e, projectId: string) => repo.listEvents(projectId))
  ipcMain.handle('projects:search', (_e, projectId: string, query: string) => repo.searchSources(projectId, query))

  ipcMain.handle('sources:sign', (_e, sourceId: string, verdict: 'human_signed' | 'rejected', note: string | null) => {
    repo.signSourceHuman(sourceId, verdict, note, HUMAN)
    return repo.getSource(sourceId)
  })

  // Recherchetiefe: serverseitig berechnete Abdeckung — dieselbe Rechnung wie für die KI.
  ipcMain.handle('coverage:get', (_e, projectId: string) => computeCoverage(repo, projectId))

  ipcMain.handle('sources:assign', (_e, sourceId: string, subQuestionId: string | null) =>
    repo.assignSourceToSubQuestion(sourceId, subQuestionId, HUMAN)
  )

  ipcMain.handle('documents:list', (_e, projectId: string) => repo.listDocuments(projectId))

  /**
   * Belegstelle im Originaltext — mit Kontext davor/danach.
   * Macht den menschlichen Sign-off schnell: die Stelle ist markiert, statt dass
   * der Mensch die URL öffnet und selbst sucht.
   */
  ipcMain.handle('documents:excerpt', (_e, documentId: string, start: number, end: number, context = 600) => {
    const doc = repo.getDocument(documentId)
    if (!doc) return null
    const from = Math.max(0, start - context)
    const to = Math.min(doc.char_len, end + context)
    return {
      document_id: doc.id,
      url: doc.url,
      char_len: doc.char_len,
      fetched_at: doc.fetched_at,
      content_hash: doc.content_hash,
      before: doc.text.slice(from, start),
      quote: doc.text.slice(start, end),
      after: doc.text.slice(end, to),
      truncated_start: from > 0,
      truncated_end: to < doc.char_len,
    }
  })

  // Menschliche Berichts-Überarbeitung: erzeugt eine NEUE unveränderliche Version
  ipcMain.handle(
    'reports:add',
    (_e, projectId: string, contentMarkdown: string, parentVersionId: string | null, changeSummary: string | null) =>
      repo.addReportVersion({
        project_id: projectId,
        content_markdown: contentMarkdown,
        parent_version_id: parentVersionId,
        change_summary: changeSummary,
        actor: HUMAN,
      })
  )

  ipcMain.handle('verify:run', async (e, projectId: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const results = await reVerifyProject(repo, projectId, { scope: 'all_pending' }, 'deterministic:ui', (done, total, last) => {
      // Review-Finding: send() auf zerstörtem Fenster wirft und würde den Batch abbrechen
      try {
        if (win && !win.isDestroyed()) win.webContents.send('verify:progress', { done, total, last })
      } catch {
        /* Fenster weg — Pass läuft weiter */
      }
    })
    return results
  })

  ipcMain.handle('export:markdown', async (e, projectId: string, versionId: string | null) => {
    const state = repo.getProjectState(projectId)
    const version = versionId ? state.reportVersions.find((v) => v.id === versionId) : undefined
    const markdown = exportProjectMarkdown(state, version)

    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: 'Provenienz-Export speichern',
      defaultPath: `${state.project.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60)}-provenienz.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (canceled || !filePath) return { saved: false }
    writeFileSync(filePath, markdown, 'utf-8')
    repo.logEvent(projectId, 'human:ui', 'export.markdown', { file: filePath })
    return { saved: true, filePath }
  })

  ipcMain.handle('export:copy', (_e, projectId: string, versionId: string | null) => {
    const state = repo.getProjectState(projectId)
    const version = versionId ? state.reportVersions.find((v) => v.id === versionId) : undefined
    clipboard.writeText(exportProjectMarkdown(state, version))
    return { copied: true }
  })

  ipcMain.handle('server:info', (): ServerInfo => {
    const mcp = deps.mcp()
    return {
      httpUrl: mcp?.url ?? '(Server nicht gestartet)',
      port: mcp?.port ?? 0,
      dbPath: deps.dbPath,
      running: !!mcp,
      // process.execPath IST das Electron-Binary; stdio.js liegt neben index.js in out/main.
      // ELECTRON_RUN_AS_NODE=1 startet es als Node-Prozess mit der App-ABI (Review-Finding).
      stdio: {
        command: process.execPath,
        args: [join(__dirname, 'stdio.js')],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      },
      hookScriptPath: (() => {
        const p = join(app.getAppPath(), 'skills', 'transparent-research', 'hooks', 'provenance-gate.cjs')
        return existsSync(p) ? p : null
      })(),
    }
  })

  ipcMain.handle('demo:seed', () => seedDemoProject(repo))

  // Eingebaute Engine: Start/Stopp/Status. Ereignisse gehen per 'engine:event' an das Fenster.
  const runner = new EngineRunner(repo)
  ipcMain.handle('engine:start', (e, input: StartEngineInput) => runner.start(input, e.sender))
  ipcMain.handle('engine:stop', () => runner.stop())
  ipcMain.handle('engine:status', () => runner.status())
  // Checkpoint: Gibt es einen abgebrochenen oder abgestürzten Lauf zum Fortsetzen?
  ipcMain.handle('engine:resumable', (_e, projectId: string) => runner.resumable(projectId))
  ipcMain.handle('engine:runs', (_e, projectId: string) => repo.listEngineRuns(projectId))

  // Modell-Anbieter: Status und Modell-Liste für die Einstellungen.
  // Bewusst eine Instanz pro Aufruf — der Endpoint kann sich zur Laufzeit ändern.
  ipcMain.handle('provider:health', () => new OllamaProvider().health())
  ipcMain.handle('provider:models', async () => {
    try {
      return await new OllamaProvider().listModels()
    } catch {
      return []
    }
  })
}
