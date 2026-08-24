import { app, BrowserWindow, Menu, shell } from 'electron'

/** Öffnet das Manual-Modal im Renderer des vordersten Fensters. */
export function notifyOpenManual(): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('ui:openManual')
}

export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const openManual: Electron.MenuItemConstructorOptions = {
    label: 'Manual',
    accelerator: 'CmdOrCtrl+/',
    click: () => notifyOpenManual(),
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              openManual,
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      label: 'Manual',
      submenu: [isMac ? { label: 'Manual öffnen', click: () => notifyOpenManual() } : openManual],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Manual', click: () => notifyOpenManual() },
        { type: 'separator' },
        {
          label: 'Easy Writing (GitHub)',
          click: () => void shell.openExternal('https://github.com/renejes/easy-writing'),
        },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}
