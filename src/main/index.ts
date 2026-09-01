import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'path'
import { APP_NAME } from '../shared/brand'
import { openDb } from './core/db'
import { Repo } from './core/repo'
import { defaultDbPath, DEFAULT_MCP_PORT } from './core/paths'
import { startMcpHttpServer, type RunningHttpServer } from './mcp/http'
import { registerIpc } from './ipc'
import { CursorAgentHost } from './core/agent/host'
import { buildAppMenu } from './menu'

/**
 * Electron Main: hostet DB, Repo und den eingebauten MCP-HTTP-Server
 * in-process (Architektur-Entscheidung aus documentation/01).
 */

let mcpServer: RunningHttpServer | null = null
let dbHandle: ReturnType<typeof openDb> | null = null
let agentHost: CursorAgentHost | null = null

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

app.whenReady().then(async () => {
  const dbPath = defaultDbPath()
  const db = openDb(dbPath)
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

  registerIpc({ repo, dbPath, mcp: () => mcpServer, agent: host })

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
      dbHandle?.close()
    } catch {
      /* egal */
    }
    app.exit(0)
  })()
})
