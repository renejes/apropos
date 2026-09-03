import { app, ipcMain, dialog, clipboard, BrowserWindow, shell } from 'electron'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Repo } from './core/repo'
import type { RunningHttpServer } from './mcp/http'
import { reVerifyProject } from './core/enforce/verify'
import { exportProjectMarkdown } from './core/export/markdown'
import { exportBibliography } from './core/services/biblio'
import { writeWritingPack } from './core/export/writing-pack'
import { writeEasyWriting } from './core/export/easy-writing'
import { seedDemoProject } from './core/seed'
import { computeCoverage, ingestUploadedFiles, ServiceError, resolveCorpusProjectId, assertCorpusWritable } from './core/services/research'
import {
  createProject,
  deleteProject,
  loadProjectState,
  createNotebookFromResearch,
  linkNotebookToResearch,
} from './core/services/projects'
import { inspectDocumentOpen, readDocumentPdfBytes, resolveDocumentDiskPath } from './core/services/reader'
import { createNote, deleteNote, updateNote } from './core/services/notes'
import { ingestYoutubeUrl } from './core/services/youtube'
import { listArtifacts, readArtifact } from './core/services/artifacts'
import { getVisualVersion, prepareView, toggleMark, describeEvidenceMap } from './core/services/visual'
import {
  describeDataRoot,
  inspectDataRoot,
  saveRootSettings,
} from './core/data-root'
import type { DataRootInfo, ServerInfo } from '../shared/types'
import type { AgentSendInput, AgentSettings } from '../shared/agent'
import type { CursorAgentHost } from './core/agent/host'

/**
 * IPC-Brücke Renderer ↔ Main. Menschlicher Sign-off läuft AUSSCHLIESSLICH
 * hier (nie über MCP) — das ist Teil des Enforcement-Designs.
 */
interface IpcDeps {
  repo: Repo
  dbPath: string
  mcp: () => RunningHttpServer | null
  agent: CursorAgentHost
  lock?: { hostname: string; startedAt: string } | null
  changeDataRoot?: (input: {
    toRoot: string
    mode: 'copy' | 'use-existing'
    cloudSynced: boolean
  }) => Promise<{ ok: true } | { ok: false; error: string }>
}

function ipcError(err: unknown): Error {
  if (err instanceof ServiceError) return new Error(`FEHLER [${err.code}]: ${err.message} ${err.hint}`)
  return err instanceof Error ? err : new Error(String(err))
}

export function registerIpc(deps: IpcDeps): void {
  const { repo } = deps
  const HUMAN = 'human:ui'

  ipcMain.handle('projects:list', () => repo.listProjects())
  ipcMain.handle(
    'projects:create',
    (
      _e,
      input: {
        title: string
        research_question: string
        mode: 'academic' | 'business'
        kind?: 'research' | 'notebook'
        linked_research_id?: string | null
      }
    ) => {
      try {
        return createProject(repo, { ...input, policy_preset: null, actor: HUMAN })
      } catch (err) {
        throw ipcError(err)
      }
    }
  )
  ipcMain.handle('projects:createNotebook', (_e, researchId: string) => {
    try {
      return createNotebookFromResearch(repo, researchId, HUMAN)
    } catch (err) {
      throw ipcError(err)
    }
  })
  ipcMain.handle('projects:linkResearch', (_e, notebookId: string, researchId: string) => {
    try {
      return linkNotebookToResearch(repo, notebookId, researchId, HUMAN)
    } catch (err) {
      throw ipcError(err)
    }
  })
  ipcMain.handle('projects:delete', async (_e, projectId: string) => {
    try {
      await deps.agent.disposeProject(projectId)
    } catch {
      /* Session weg, Projekt trotzdem löschen */
    }
    try {
      const deleted = deleteProject(repo, projectId, HUMAN)
      return { deleted }
    } catch (err) {
      throw ipcError(err)
    }
  })
  ipcMain.handle('projects:state', (_e, projectId: string) => loadProjectState(repo, projectId))
  ipcMain.handle('projects:events', (_e, projectId: string) => repo.listEvents(projectId))
  ipcMain.handle('projects:search', (_e, projectId: string, query: string) => repo.searchSources(projectId, query))

  ipcMain.handle('sources:sign', (_e, sourceId: string, verdict: 'human_signed' | 'rejected', note: string | null) => {
    repo.signSourceHuman(sourceId, verdict, note, HUMAN)
    return repo.getSource(sourceId)
  })

  // Recherchetiefe: serverseitig berechnete Abdeckung — dieselbe Rechnung wie für die KI.
  ipcMain.handle('coverage:get', (_e, projectId: string) => computeCoverage(repo, projectId))

  ipcMain.handle('visual:describe', (_e, projectId: string, layoutKind?: 'theme_clusters' | 'argument_map') =>
    describeEvidenceMap(repo, { project_id: projectId, layout_kind: layoutKind })
  )
  ipcMain.handle(
    'visual:prepare',
    (
      _e,
      input: {
        project_id: string
        question: string
        layout_kind: 'theme_clusters' | 'argument_map'
        scope?: 'all' | 'marked'
        parent_version_id?: string | null
      }
    ) => prepareView(repo, input, HUMAN)
  )
  ipcMain.handle('visual:get', (_e, projectId: string, versionId: string) =>
    getVisualVersion(repo, { project_id: projectId, version_id: versionId })
  )
  ipcMain.handle('marks:toggle', (_e, projectId: string, entityType: 'source' | 'claim', entityId: string) =>
    toggleMark(repo, { project_id: projectId, entity_type: entityType, entity_id: entityId }, HUMAN)
  )

  ipcMain.handle('sources:assign', (_e, sourceId: string, subQuestionId: string | null) =>
    repo.assignSourceToSubQuestion(sourceId, subQuestionId, HUMAN)
  )

  ipcMain.handle('documents:list', (_e, projectId: string) => {
    const corpusId = resolveCorpusProjectId(repo, projectId)
    return repo.listDocuments(corpusId)
  })

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

  ipcMain.handle('documents:get', (_e, documentId: string) => {
    const doc = repo.getDocument(documentId)
    return doc ?? null
  })

  ipcMain.handle('documents:search', (_e, projectId: string, query: string) => {
    const corpusId = resolveCorpusProjectId(repo, projectId)
    return repo.searchDocuments(corpusId, query)
  })

  ipcMain.handle('documents:openOriginal', async (_e, documentId: string) => {
    const abs = resolveDocumentDiskPath(repo, documentId)
    if (!abs) return false
    const err = await shell.openPath(abs)
    return err === ''
  })

  ipcMain.handle('documents:showInFolder', (_e, documentId: string) => {
    const abs = resolveDocumentDiskPath(repo, documentId)
    if (!abs) return false
    shell.showItemInFolder(abs)
    return true
  })

  ipcMain.handle('documents:inspect', (_e, documentId: string) => {
    try {
      return inspectDocumentOpen(repo, documentId)
    } catch (err) {
      throw ipcError(err)
    }
  })

  ipcMain.handle('documents:pdfBytes', (_e, documentId: string) => {
    const buf = readDocumentPdfBytes(repo, documentId)
    if (!buf) return null
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  const fileDialogOptions = {
    title: 'PDFs und Texte in den Korpus',
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    filters: [
      { name: 'Dokumente', extensions: ['pdf', 'txt', 'md', 'markdown', 'html', 'htm', 'csv'] },
      { name: 'Alle Dateien', extensions: ['*'] },
    ],
  }

  ipcMain.handle('corpus:upload', async (e, projectId: string) => {
    try {
      assertCorpusWritable(repo, projectId)
    } catch (err) {
      const msg = err instanceof ServiceError ? err.message : String(err)
      return { filenames: [] as string[], documents: [], errors: [{ filename: '', message: msg }] }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, fileDialogOptions)
      : await dialog.showOpenDialog(fileDialogOptions)
    if (canceled || filePaths.length === 0) return { filenames: [] as string[], documents: [], errors: [] }
    const names = deps.agent.importFiles(projectId, filePaths)
    const ingested = await ingestUploadedFiles(repo, projectId, names, HUMAN)
    return { filenames: names, ...ingested }
  })

  ipcMain.handle('corpus:import', async (_e, projectId: string, filePaths: string[]) => {
    try {
      assertCorpusWritable(repo, projectId)
    } catch (err) {
      const msg = err instanceof ServiceError ? err.message : String(err)
      return { filenames: [] as string[], documents: [], errors: [{ filename: '', message: msg }] }
    }
    const names = deps.agent.importFiles(projectId, Array.isArray(filePaths) ? filePaths : [])
    const ingested = await ingestUploadedFiles(repo, projectId, names, HUMAN)
    return { filenames: names, ...ingested }
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

  ipcMain.handle('export:bibliography', async (e, projectId: string) => {
    const state = repo.getProjectState(projectId)
    const bibtex = exportBibliography(repo, projectId)
    const win = BrowserWindow.fromWebContents(e.sender)
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: 'Für Easy Writing exportieren',
      defaultPath: `${state.project.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60)}-references.bib`,
      filters: [{ name: 'BibTeX', extensions: ['bib'] }],
    })
    if (canceled || !filePath) return { saved: false }
    writeFileSync(filePath, bibtex, 'utf-8')
    repo.logEvent(projectId, 'human:ui', 'export.bibliography', { file: filePath })
    return { saved: true, filePath }
  })

  ipcMain.handle('dialog:pickDirectory', async (e, title: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = {
      title: title || 'Ordner wählen',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return null as string | null
    return filePaths[0] ?? null
  })

  ipcMain.handle(
    'export:writingPack',
    (
      _e,
      input: {
        project_id: string
        visual_version_id?: string
        scope?: 'marked'
        jpeg_base64?: string
      }
    ) => writeWritingPack(repo, input, HUMAN)
  )

  ipcMain.handle(
    'export:easyWriting',
    (
      _e,
      input: {
        project_id: string
        visual_version_id?: string
        scope?: 'marked'
        jpeg_base64?: string
        target: 'new' | 'existing'
        out_dir: string
        project_type?: 'blog' | 'paper'
      }
    ) => writeEasyWriting(repo, input, HUMAN)
  )

  ipcMain.handle('data:info', (): DataRootInfo => {
    return describeDataRoot({
      lockHostname: deps.lock?.hostname ?? null,
      lockStartedAt: deps.lock?.startedAt ?? null,
    })
  })

  ipcMain.handle('data:setCloudSynced', (_e, cloudSynced: boolean) => {
    const info = describeDataRoot()
    saveRootSettings(info.root, { cloudSynced })
    return describeDataRoot({
      lockHostname: deps.lock?.hostname ?? null,
      lockStartedAt: deps.lock?.startedAt ?? null,
    })
  })

  ipcMain.handle(
    'data:setRoot',
    async (
      _e,
      input: { toRoot: string; mode: 'copy' | 'use-existing'; cloudSynced: boolean }
    ): Promise<{ ok: true } | { ok: false; error: string; hasDb?: boolean }> => {
      const dest = input.toRoot
      if (!dest) return { ok: false, error: 'Kein Ordner gewählt.' }
      const inspect = inspectDataRoot(dest)
      if (input.mode === 'use-existing' && !inspect.hasDb) {
        return { ok: false, error: 'In diesem Ordner liegt keine Datenbank.', hasDb: false }
      }
      if (!deps.changeDataRoot) return { ok: false, error: 'Datenordner kann gerade nicht gewechselt werden.' }
      return deps.changeDataRoot(input)
    }
  )

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

  const { agent } = deps
  agent.setSink((projectId, event, sessionId) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      try {
        win.webContents.send('agent:event', { projectId, sessionId, event })
      } catch {
        /* Fenster weg */
      }
    }
  })

  ipcMain.handle('agent:authStatus', () => agent.authStatus())
  ipcMain.handle('agent:browserLogin', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const sendUrl = (url: string) => {
      if (!win || win.isDestroyed()) return
      try {
        win.webContents.send('agent:loginUrl', url)
      } catch {
        /* Fenster weg */
      }
    }
    return agent.browserLogin(async (url) => {
      if (!isCursorHttpsUrl(url)) throw new Error('Login-URL stammt nicht von cursor.com')
      await shell.openExternal(url)
    }, sendUrl)
  })
  ipcMain.handle('agent:cancelLogin', () => {
    agent.cancelBrowserLogin()
    return true
  })
  ipcMain.handle('agent:logout', () => agent.logout())
  ipcMain.handle('agent:listModels', () => agent.listModels())
  ipcMain.handle('agent:getSettings', () => agent.getSettings())
  ipcMain.handle('agent:setSettings', (_e, next: AgentSettings) => agent.setSettings(next))
  ipcMain.handle('agent:send', (_e, projectId: string, input: AgentSendInput) =>
    agent.send(projectId, { ...input, attached: input.attached ?? [], mentions: input.mentions ?? [] })
  )
  ipcMain.handle('agent:cancel', (_e, projectId: string) => agent.cancel(projectId))
  ipcMain.handle('agent:history', (_e, projectId: string) => agent.history(projectId))
  ipcMain.handle('agent:runState', (_e, projectId: string) => agent.runState(projectId))
  ipcMain.handle('agent:sessions', (_e, projectId: string) => agent.sessions(projectId))
  ipcMain.handle('agent:newSession', (_e, projectId: string) => agent.newSession(projectId))
  ipcMain.handle('agent:switchSession', (_e, projectId: string, sessionId: string) => agent.switchSession(projectId, sessionId))
  ipcMain.handle('agent:closeTab', (_e, projectId: string, sessionId: string) => agent.closeTab(projectId, sessionId))
  ipcMain.handle('agent:deleteSession', (_e, projectId: string, sessionId: string) => agent.deleteSession(projectId, sessionId))
  ipcMain.handle('agent:mentionables', (_e, projectId: string) => agent.mentionables(projectId))
  ipcMain.handle('notes:list', (_e, projectId: string) => repo.listNotes(projectId))
  ipcMain.handle('notes:get', (_e, noteId: string) => repo.getNote(noteId) ?? null)
  ipcMain.handle(
    'notes:create',
    (
      _e,
      input: { project_id: string; title: string; body_markdown: string; origin?: 'human' | 'chat' | 'agent'; citations?: unknown }
    ) => createNote(repo, input, HUMAN)
  )
  ipcMain.handle(
    'notes:update',
    (_e, input: { note_id: string; title?: string; body_markdown?: string; citations?: unknown }) => updateNote(repo, input, HUMAN)
  )
  ipcMain.handle('notes:delete', (_e, noteId: string) => ({ deleted: deleteNote(repo, noteId, HUMAN) }))
  ipcMain.handle('notebook:youtube', async (_e, projectId: string, url: string) => {
    try {
      return await ingestYoutubeUrl(repo, projectId, url, HUMAN)
    } catch (err) {
      throw ipcError(err)
    }
  })
  ipcMain.handle('notebook:artifacts', (_e, projectId: string) => listArtifacts(projectId))
  ipcMain.handle('notebook:artifact', (_e, projectId: string, relativePath: string) => readArtifact(projectId, relativePath))
  ipcMain.handle('agent:attach', async (e, projectId: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = {
      title: 'Dateien für den Research-Agenten',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [
        { name: 'Dokumente', extensions: ['pdf', 'txt', 'md', 'markdown', 'html', 'htm', 'csv'] },
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (canceled || filePaths.length === 0) return [] as string[]
    const names = agent.importFiles(projectId, filePaths)
    await ingestUploadedFiles(repo, projectId, names, HUMAN)
    return names
  })

  ipcMain.handle('open:external', (_e, url: string) => {
    if (!isCursorHttpsUrl(url)) return false
    return shell.openExternal(url)
  })
}

function isCursorHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname
    return host === 'cursor.com' || host.endsWith('.cursor.com')
  } catch {
    return false
  }
}
