export interface Workspace {
  id: string
  name: string
  path: string
}

export type TileType = 'terminal' | 'note' | 'code' | 'image' | 'kanban' | 'browser'

export interface AppSettings {
  // Canvas
  gridSize: number
  snapToGrid: boolean
  canvasBackground: string
  // Terminal
  terminalFontSize: number
  terminalFontFamily: string
  // Appearance
  uiFontSize: number
  // Sidebar
  sidebarDefaultSort: 'name' | 'type' | 'ext'
  sidebarIgnored: string[]
  // Behaviour
  autoSaveIntervalMs: number
  defaultTileSizes: Record<TileType, { w: number; h: number }>
}

export const DEFAULT_SETTINGS: AppSettings = {
  gridSize: 20,
  snapToGrid: true,
  canvasBackground: '#3c3c3c',
  terminalFontSize: 13,
  terminalFontFamily: '"JetBrains Mono", "Menlo", "Monaco", "SF Mono", monospace',
  uiFontSize: 12,
  sidebarDefaultSort: 'name',
  sidebarIgnored: ['.git', 'node_modules', '.next', 'dist', 'dist-electron', '.DS_Store', '__pycache__', '.cache', 'out'],
  autoSaveIntervalMs: 500,
  defaultTileSizes: {
    terminal: { w: 600, h: 400 },
    code:     { w: 680, h: 500 },
    note:     { w: 500, h: 400 },
    image:    { w: 440, h: 360 },
    kanban:   { w: 900, h: 560 },
    browser:  { w: 1000, h: 700 },
  }
}

export function withDefaultSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const settings = input ?? {}
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    sidebarIgnored: settings.sidebarIgnored ?? DEFAULT_SETTINGS.sidebarIgnored,
    defaultTileSizes: {
      ...DEFAULT_SETTINGS.defaultTileSizes,
      ...(settings.defaultTileSizes ?? {})
    }
  } as AppSettings
}

export interface Config {
  workspaces: Workspace[]
  activeWorkspaceIndex: number
  settings: AppSettings
}

export interface TileState {
  id: string
  type: TileType
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  filePath?: string
  groupId?: string
}

export interface GroupState {
  id: string
  label?: string
  color?: string
  parentGroupId?: string
}

export interface CanvasState {
  tiles: TileState[]
  groups: GroupState[]
  viewport: { tx: number; ty: number; zoom: number }
  nextZIndex: number
}
