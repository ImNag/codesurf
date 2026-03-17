import { app, BrowserWindow, shell, ipcMain, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initWorkspaces, registerWorkspaceIPC } from './ipc/workspace'
import { registerFsIPC } from './ipc/fs'
import { registerCanvasIPC } from './ipc/canvas'
import { registerTerminalIPC } from './ipc/terminal'
import { startMCPServer, getMCPPort } from './mcp-server'
import { registerAgentsIPC } from './ipc/agents'
import { registerStreamIPC } from './ipc/stream'
import { registerGitIPC } from './ipc/git'
import { cleanupBrowserTilesForWindow, registerBrowserTileIPC } from './ipc/browserTile'

function createWindow(asTab = false): BrowserWindow {
  const focused = BrowserWindow.getFocusedWindow()

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    // macOS native tabs — all windows share the same tabbing group
    tabbingIdentifier: 'collaborator',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })

  win.on('ready-to-show', () => {
    // Add as a tab to the focused window if requested and on macOS
    if (asTab && focused && process.platform === 'darwin') {
      focused.addTabbedWindow(win)
    }
    win.show()
  })

  win.on('closed', () => {
    cleanupBrowserTilesForWindow(win.id)
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.vibeclaw.collaborator')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Init workspace dirs + register all IPC handlers
  await initWorkspaces()
  registerWorkspaceIPC()
  registerFsIPC()
  registerCanvasIPC()
  registerTerminalIPC()
  registerAgentsIPC()
  registerStreamIPC()
  registerGitIPC()
  registerBrowserTileIPC()

  // Start local MCP server for agent→kanban callbacks
  startMCPServer().then(port => {
    console.log(`[MCP] Kanban tools available at http://127.0.0.1:${port}`)
  }).catch(err => console.error('[MCP] Failed to start:', err))

  // Expose MCP port to renderer
  ipcMain.handle('mcp:getPort', () => getMCPPort())

  // MCP config read/write
  const { join: pjoin } = await import('path')
  const { homedir: phome } = await import('os')
  const mcpConfigPath = pjoin(phome(), 'clawd-collab', 'mcp-server.json')

  ipcMain.handle('mcp:getConfig', async () => {
    try {
      const { promises: fsP } = await import('fs')
      const raw = await fsP.readFile(mcpConfigPath, 'utf8')
      return JSON.parse(raw)
    } catch { return null }
  })

  ipcMain.handle('mcp:saveServers', async (_, servers: Record<string, unknown>) => {
    try {
      const { promises: fsP } = await import('fs')
      const raw = await fsP.readFile(mcpConfigPath, 'utf8')
      const cfg = JSON.parse(raw)
      const collaborator = cfg.mcpServers?.collaborator ?? { url: cfg.url }
      cfg.mcpServers = { collaborator, ...servers }
      cfg.updatedAt = new Date().toISOString()
      await fsP.writeFile(mcpConfigPath, JSON.stringify(cfg, null, 2))
      return cfg
    } catch (e) { return null }
  })

  // Per-workspace MCP servers
  ipcMain.handle('mcp:getWorkspaceServers', async (_, workspaceId: string) => {
    try {
      const { promises: fsP } = await import('fs')
      const p = pjoin(phome(), 'clawd-collab', 'workspaces', workspaceId, 'mcp-servers.json')
      const raw = await fsP.readFile(p, 'utf8')
      return JSON.parse(raw)
    } catch { return {} }
  })

  ipcMain.handle('mcp:saveWorkspaceServers', async (_, workspaceId: string, servers: Record<string, unknown>) => {
    try {
      const { promises: fsP } = await import('fs')
      const dir = pjoin(phome(), 'clawd-collab', 'workspaces', workspaceId)
      await fsP.mkdir(dir, { recursive: true })
      const p = pjoin(dir, 'mcp-servers.json')
      await fsP.writeFile(p, JSON.stringify(servers, null, 2))
      return servers
    } catch (e) { return null }
  })

  // Merged config for a workspace — global + workspace servers combined
  // This is what you'd point Claude Code / Cursor / any MCP client at
  ipcMain.handle('mcp:getMergedConfig', async (_, workspaceId: string) => {
    try {
      const { promises: fsP } = await import('fs')

      // Global config
      let globalCfg: Record<string, unknown> = {}
      try {
        const raw = await fsP.readFile(mcpConfigPath, 'utf8')
        globalCfg = JSON.parse(raw)
      } catch { /**/ }

      // Workspace servers
      let wsServers: Record<string, unknown> = {}
      try {
        const wsPath = pjoin(phome(), 'clawd-collab', 'workspaces', workspaceId, 'mcp-servers.json')
        const raw = await fsP.readFile(wsPath, 'utf8')
        wsServers = JSON.parse(raw)
      } catch { /**/ }

      // Merge: global mcpServers + workspace servers
      const globalServers = (globalCfg as Record<string, Record<string, unknown>>).mcpServers ?? {}
      const merged = {
        ...(globalCfg as object),
        mcpServers: { ...globalServers, ...wsServers },
        workspace: workspaceId,
        mergedAt: new Date().toISOString()
      }

      // Also write a merged file the workspace dir so agents can reference it
      const wsDir = pjoin(phome(), 'clawd-collab', 'workspaces', workspaceId)
      await fsP.mkdir(wsDir, { recursive: true })
      await fsP.writeFile(
        pjoin(wsDir, 'mcp-merged.json'),
        JSON.stringify(merged, null, 2)
      )

      return merged
    } catch (e) { return null }
  })

  // Window management
  ipcMain.handle('window:new', () => { createWindow(false); return null })
  ipcMain.handle('window:newTab', () => { createWindow(true); return null })

  // Native app menu with Cmd+N / Cmd+T
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(false)
        },
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => createWindow(true)
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'selectNextTab' },
        { role: 'selectPreviousTab' },
        { role: 'showAllTabs' },
        { role: 'mergeAllWindows' },
        { role: 'moveTabToNewWindow' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
