import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { join } from 'path'
import { APP_NAME } from '../shared/brand'
import { checkpointAndClose, openDb } from './core/db'
import { Repo } from './core/repo'
import { defaultDbPath, DEFAULT_MCP_PORT, appDataDir } from './core/paths'
import { startMcpHttpServer, type RunningHttpServer } from './mcp/http'
import { registerIpc } from './ipc'
import { CursorAgentHost } from './core/agent/host'
import { buildAppMenu } from './menu'
import { acquireDataLock, releaseDataLock, type AcquireLockResult } from './core/data-lock'
import {
  journalModeForRoot,
  relocateDataRoot,
  saveRootSettings,
  writeDataRootPointer,
} from './core/data-root'

/**
 * Electron Main: hostet DB, Repo und den eingebauten MCP-HTTP-Server
 * in-process (Architektur-Entscheidung aus documentation/01).
 */

let mcpServer: RunningHttpServer | null = null
let dbHandle: ReturnType<typeof openDb> | null = null
let agentHost: CursorAgentHost | null = null
let dataRootHeld: string | null = null
let lockHeld: { hostname: string; startedAt: string } | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Review-Finding: OS-Sandbox aktiv — Preload nutzt nur contextBridge/ipcRenderer
      sandbox: true,
    },
  })

  // Externe Links im System-Browser öffnen, nie im Electron-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function formatLockMessage(result: Extract<AcquireLockResult, { ok: false }>): string {
  const { lock } = result
  return (
    `Die Datenbank wird auf einem anderen Rechner genutzt.\n\n` +
    `Rechner: ${lock.hostname}\n` +
    `Seit: ${lock.startedAt || 'unbekannt'}\n` +
    `App-Version: ${lock.appVersion || 'unbekannt'}\n\n` +
    `Nicht auf zwei Rechnern gleichzeitig öffnen. Erst die App dort beenden, Sync abwarten, dann hier starten.\n\n` +
    `„Lock ignorieren“ nur nach einem Absturz, wenn der andere Rechner die App sicher nicht mehr offen hat.`
  )
}

app.whenReady().then(async () => {
  const root = appDataDir()
  let acquired = acquireDataLock(root, { appVersion: app.getVersion() })
  if (!acquired.ok) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Datenordner belegt',
      message: 'Dieser Datenordner ist auf einem anderen Rechner geöffnet.',
      detail: formatLockMessage(acquired),
      buttons: ['Beenden', 'Lock ignorieren'],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1) {
      app.exit(0)
      return
    }
    acquired = acquireDataLock(root, { appVersion: app.getVersion(), force: true })
    if (!acquired.ok) {
      app.exit(1)
      return
    }
  }
  dataRootHeld = root
  lockHeld = { hostname: acquired.lock.hostname, startedAt: acquired.lock.startedAt }

  const dbPath = defaultDbPath()
  const db = openDb(dbPath, { journalMode: journalModeForRoot(root) })
  dbHandle = db
  const repo = new Repo(db)
  const host = new CursorAgentHost(repo)
  agentHost = host

  // Phantomläufe heilen: Ein Engine-Lauf existiert nur im Prozess, der ihn treibt.
  // Steht beim Start noch einer auf 'running', ist dieser Prozess gestorben — der
  // Lauf ist damit unterbrochen und fortsetzbar, nicht laufend.
  const healed = repo.markRunningAsInterrupted()
  if (healed > 0) console.log(`[research-overview] ${healed} unterbrochene(r) Engine-Lauf als fortsetzbar markiert`)

  // Eingebauter MCP-Server (Streamable HTTP, 127.0.0.1)
  const desiredPort = Number(process.env.RESEARCH_MCP_PORT ?? DEFAULT_MCP_PORT)
  try {
    mcpServer = await startMcpHttpServer({ repo, actorLabel: 'http-client' }, desiredPort)
    console.log(`[research-overview] MCP server: ${mcpServer.url}`)
  } catch (err) {
    console.error('[research-overview] MCP server failed to start:', err)
  }

  registerIpc({
    repo,
    dbPath,
    mcp: () => mcpServer,
    agent: host,
    lock: lockHeld,
    changeDataRoot: async (input) => {
      const from = appDataDir()
      const to = input.toRoot
      try {
        if (dbHandle) {
          checkpointAndClose(dbHandle)
          dbHandle = null
        }
        if (input.mode === 'copy') relocateDataRoot(from, to, 'copy')
        if (dataRootHeld) releaseDataLock(dataRootHeld)
        dataRootHeld = null
        writeDataRootPointer(to)
        if (input.cloudSynced) saveRootSettings(to, { cloudSynced: true })
        app.relaunch()
        app.exit(0)
        return { ok: true as const }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
    },
  })

  if (process.platform === 'darwin') app.setName(APP_NAME)
  Menu.setApplicationMenu(buildAppMenu())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Review-Finding: Electron wartet async-Handler in before-quit NICHT ab.
// will-quit + preventDefault + explizites app.exit() nach dem Cleanup.
let cleanedUp = false
app.on('will-quit', (event) => {
  if (cleanedUp) return
  event.preventDefault()
  cleanedUp = true
  void (async () => {
    try {
      await agentHost?.disposeAll()
    } catch {
      /* egal */
    }
    try {
      await mcpServer?.close()
    } catch {
      /* egal */
    }
    try {
      if (dbHandle) checkpointAndClose(dbHandle)
    } catch {
      /* egal */
    }
    try {
      if (dataRootHeld) releaseDataLock(dataRootHeld)
    } catch {
      /* egal */
    }
    app.exit(0)
  })()
})
