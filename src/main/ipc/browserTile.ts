import { ipcMain, BrowserView, BrowserWindow, session } from 'electron'

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const HOMEPAGE = 'https://duckduckgo.com'

type BrowserMode = 'desktop' | 'mobile'

interface BrowserTileState {
  view: BrowserView
  windowId: number
  tileId: string
  mode: BrowserMode
  currentUrl: string
  bounds: { left: number; top: number; width: number; height: number }
}

// windowId → tileId → state
const tiles = new Map<number, Map<string, BrowserTileState>>()

function getWindowTiles(windowId: number): Map<string, BrowserTileState> {
  if (!tiles.has(windowId)) tiles.set(windowId, new Map())
  return tiles.get(windowId)!
}

function applyMode(state: BrowserTileState): void {
  const wc = state.view.webContents
  wc.setUserAgent(state.mode === 'mobile' ? MOBILE_UA : DESKTOP_UA)
  wc.setZoomFactor(1)
}

function applyBounds(state: BrowserTileState, win: BrowserWindow): void {
  const { left, top, width, height } = state.bounds
  if (width > 0 && height > 0) {
    state.view.setBounds({
      x: Math.round(left),
      y: Math.round(top),
      width: Math.round(width),
      height: Math.round(height)
    })
  }
}

function sendEvent(win: BrowserWindow, tileId: string, view: BrowserView): void {
  const wc = view.webContents
  win.webContents.send('browserTile:event', {
    tileId,
    currentUrl: wc.getURL(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    isLoading: wc.isLoading(),
    mode: 'desktop' // updated by command handler
  })
}

function attachListeners(state: BrowserTileState, win: BrowserWindow): void {
  const wc = state.view.webContents

  wc.on('did-navigate', () => {
    state.currentUrl = wc.getURL()
    sendEvent(win, state.tileId, state.view)
  })

  wc.on('did-navigate-in-page', () => {
    state.currentUrl = wc.getURL()
    sendEvent(win, state.tileId, state.view)
  })

  wc.on('did-start-loading', () => sendEvent(win, state.tileId, state.view))
  wc.on('did-stop-loading', () => sendEvent(win, state.tileId, state.view))
  wc.on('did-finish-load', () => {
    wc.setZoomFactor(1)
    sendEvent(win, state.tileId, state.view)
  })

  // Open links that would create new windows in the system browser instead
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}

function getOrCreateTile(
  windowId: number,
  tileId: string,
  initialUrl: string,
  mode: BrowserMode
): BrowserTileState | null {
  const win = BrowserWindow.fromId(windowId)
  if (!win) return null

  const windowTiles = getWindowTiles(windowId)

  if (windowTiles.has(tileId)) {
    return windowTiles.get(tileId)!
  }

  const view = new BrowserView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: session.fromPartition(`browser-tile-${windowId}-${tileId}`)
    }
  })

  const state: BrowserTileState = {
    view,
    windowId,
    tileId,
    mode,
    currentUrl: initialUrl || HOMEPAGE,
    bounds: { left: 0, top: 0, width: 1, height: 1 }
  }

  win.addBrowserView(view)
  applyMode(state)
  attachListeners(state, win)

  // Load the initial URL
  void view.webContents.loadURL(state.currentUrl)

  windowTiles.set(tileId, state)
  return state
}

export function registerBrowserTileIPC(): void {
  // sync: update bounds (and navigate only if URL changed)
  ipcMain.handle('browserTile:sync', (event, payload: {
    tileId: string
    url: string
    mode: BrowserMode
    zIndex: number
    visible: boolean
    bounds: { left: number; top: number; width: number; height: number }
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const state = getOrCreateTile(win.id, payload.tileId, payload.url, payload.mode)
    if (!state) return

    // Update bounds
    state.bounds = payload.bounds
    applyBounds(state, win)

    // Only navigate if the URL has actually changed
    const incoming = payload.url || HOMEPAGE
    if (incoming && incoming !== state.currentUrl && incoming !== 'about:blank') {
      state.currentUrl = incoming
      void state.view.webContents.loadURL(incoming)
    }

    // Set z-order: remove + re-add all views in z-index order
    // (BrowserView ordering reflects add order — newest = on top)
    // For simplicity, just ensure this view is on top if zIndex is high
    // TODO: proper z-ordering across tiles
  })

  // command: back/forward/reload/stop/home/navigate/mode
  ipcMain.handle('browserTile:command', (event, payload: {
    tileId: string
    command: 'back' | 'forward' | 'reload' | 'stop' | 'home' | 'navigate' | 'mode'
    url?: string
    mode?: BrowserMode
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const windowTiles = getWindowTiles(win.id)
    const state = windowTiles.get(payload.tileId)
    if (!state) return

    const wc = state.view.webContents

    switch (payload.command) {
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        break
      case 'forward':
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
        break
      case 'reload':
        wc.reload()
        break
      case 'stop':
        wc.stop()
        break
      case 'home':
        state.currentUrl = HOMEPAGE
        void wc.loadURL(HOMEPAGE)
        break
      case 'navigate':
        if (payload.url) {
          state.currentUrl = payload.url
          void wc.loadURL(payload.url)
        }
        break
      case 'mode':
        if (payload.mode) {
          state.mode = payload.mode
          applyMode(state)
          // Reload to apply new UA
          wc.reload()
        }
        break
    }
  })

  // destroy: remove BrowserView from window
  ipcMain.handle('browserTile:destroy', (event, tileId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const windowTiles = getWindowTiles(win.id)
    const state = windowTiles.get(tileId)
    if (!state) return

    try {
      win.removeBrowserView(state.view)
      ;(state.view.webContents as any).destroy?.()
    } catch { /* ignore */ }

    windowTiles.delete(tileId)
  })
}

export function cleanupBrowserTilesForWindow(windowId: number): void {
  const windowTiles = tiles.get(windowId)
  if (!windowTiles) return

  const win = BrowserWindow.fromId(windowId)

  for (const [, state] of windowTiles) {
    try {
      if (win) win.removeBrowserView(state.view)
      ;(state.view.webContents as any).destroy?.()
    } catch { /* ignore */ }
  }

  tiles.delete(windowId)
}
