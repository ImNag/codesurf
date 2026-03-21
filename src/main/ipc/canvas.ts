import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { CONTEX_HOME } from '../paths'

function assertSafeId(id: string): void {
  if (/[\/\\]|\.\./.test(id)) throw new Error(`Unsafe ID: ${id}`)
}

function canvasStatePath(workspaceId: string): string {
  assertSafeId(workspaceId)
  return join(CONTEX_HOME, 'workspaces', workspaceId, 'canvas-state.json')
}

function kanbanStatePath(workspaceId: string, tileId: string): string {
  assertSafeId(workspaceId)
  assertSafeId(tileId)
  return join(CONTEX_HOME, 'workspaces', workspaceId, `kanban-${tileId}.json`)
}

function tileStatePath(workspaceId: string, tileId: string): string {
  assertSafeId(workspaceId)
  assertSafeId(tileId)
  return join(CONTEX_HOME, 'workspaces', workspaceId, `tile-state-${tileId}.json`)
}

async function deleteFileIfExists(path: string): Promise<void> {
  try {
    await fs.unlink(path)
  } catch {
    // ignore missing files
  }
}

export function registerCanvasIPC(): void {
  ipcMain.handle('canvas:load', async (_, workspaceId: string) => {
    try {
      const raw = await fs.readFile(canvasStatePath(workspaceId), 'utf8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  })

  ipcMain.handle('canvas:save', async (_, workspaceId: string, state: unknown) => {
    const path = canvasStatePath(workspaceId)
    await fs.mkdir(join(CONTEX_HOME, 'workspaces', workspaceId), { recursive: true })
    await fs.writeFile(path, JSON.stringify(state, null, 2))
  })

  ipcMain.handle('kanban:load', async (_, workspaceId: string, tileId: string) => {
    try {
      const raw = await fs.readFile(kanbanStatePath(workspaceId, tileId), 'utf8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  })

  ipcMain.handle('kanban:save', async (_, workspaceId: string, tileId: string, state: unknown) => {
    const path = kanbanStatePath(workspaceId, tileId)
    await fs.mkdir(join(CONTEX_HOME, 'workspaces', workspaceId), { recursive: true })
    await fs.writeFile(path, JSON.stringify(state, null, 2))
  })

  ipcMain.handle('canvas:loadTileState', async (_, workspaceId: string, tileId: string) => {
    try {
      const raw = await fs.readFile(tileStatePath(workspaceId, tileId), 'utf8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  })

  ipcMain.handle('canvas:saveTileState', async (_, workspaceId: string, tileId: string, state: unknown) => {
    const path = tileStatePath(workspaceId, tileId)
    await fs.mkdir(join(CONTEX_HOME, 'workspaces', workspaceId), { recursive: true })
    await fs.writeFile(path, JSON.stringify(state, null, 2))
  })

  ipcMain.handle('canvas:clearTileState', async (_, workspaceId: string, tileId: string) => {
    await deleteFileIfExists(tileStatePath(workspaceId, tileId))
  })

  ipcMain.handle('canvas:deleteTileArtifacts', async (_, workspaceId: string, tileId: string) => {
    await Promise.all([
      deleteFileIfExists(tileStatePath(workspaceId, tileId)),
      deleteFileIfExists(kanbanStatePath(workspaceId, tileId)),
    ])
  })
}
