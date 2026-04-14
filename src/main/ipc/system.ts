import { ipcMain, BrowserWindow } from 'electron'
import { getHeapStatistics } from 'v8'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { bus } from '../event-bus'
import { removeTile as removePeerTile } from '../peer-state'
import { getDaemonStatus, restartDaemon } from '../daemon/manager'
import { CONTEX_HOME } from '../paths'

// Debounce GC — if cleanupTile is called many times in quick succession we don't
// want to hammer global.gc(). Runs ~1s after the last cleanup.
let gcTimer: NodeJS.Timeout | null = null

function scheduleGC(): void {
  if (gcTimer) clearTimeout(gcTimer)
  gcTimer = setTimeout(() => {
    gcTimer = null
    runGC()
  }, 1000)
}

function runGC(): void {
  // Main process — requires electron launched with --js-flags=--expose-gc
  const g = globalThis as unknown as { gc?: () => void }
  if (typeof g.gc === 'function') {
    try {
      g.gc()
    } catch (err) {
      console.warn('[system] main gc() threw:', err)
    }
  }
  // Renderers — request they run gc too (window.gc requires --expose-gc on renderer)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    try {
      win.webContents.send('system:gc-requested')
    } catch { /* sender dead */ }
  }
}

function sanitizeDaemonState(result: { running: boolean; info: Awaited<ReturnType<typeof getDaemonStatus>>['info'] }): {
  running: boolean
  info: {
    pid: number
    port: number
    startedAt: string
    protocolVersion: number
    appVersion: string | null
  } | null
} {
  if (!result.info) {
    return { running: result.running, info: null }
  }

  return {
    running: result.running,
    info: {
      pid: result.info.pid,
      port: result.info.port,
      startedAt: result.info.startedAt,
      protocolVersion: result.info.protocolVersion,
      appVersion: result.info.appVersion,
    },
  }
}

type DaemonJobRecord = {
  id: string
  status: string
  provider?: string
  model?: string
  workspaceDir?: string | null
  requestedAt?: string
  updatedAt?: string
  completedAt?: string | null
  lastSequence?: number
  error?: string | null
}

function readDaemonJobSummary(): {
  total: number
  active: number
  completed: number
  failed: number
  cancelled: number
  other: number
  recent: Array<{
    id: string
    status: string
    provider: string | null
    model: string | null
    workspaceDir: string | null
    updatedAt: string | null
    requestedAt: string | null
    lastSequence: number
    error: string | null
  }>
} {
  const jobsDir = join(CONTEX_HOME, 'jobs')
  if (!existsSync(jobsDir)) {
    return {
      total: 0,
      active: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      other: 0,
      recent: [],
    }
  }

  const records: DaemonJobRecord[] = []
  for (const entry of readdirSync(jobsDir)) {
    if (!entry.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(join(jobsDir, entry), 'utf8')) as DaemonJobRecord
      if (parsed && typeof parsed.id === 'string') records.push(parsed)
    } catch {
      // ignore corrupt metadata files
    }
  }

  const normalized = records
    .map(record => ({
      id: record.id,
      status: typeof record.status === 'string' ? record.status : 'unknown',
      provider: typeof record.provider === 'string' ? record.provider : null,
      model: typeof record.model === 'string' ? record.model : null,
      workspaceDir: typeof record.workspaceDir === 'string' ? record.workspaceDir : null,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
      requestedAt: typeof record.requestedAt === 'string' ? record.requestedAt : null,
      lastSequence: typeof record.lastSequence === 'number' ? record.lastSequence : 0,
      error: typeof record.error === 'string' ? record.error : null,
    }))
    .sort((a, b) => {
      const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0
      const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0
      return bTime - aTime
    })

  const counts = normalized.reduce((acc, record) => {
    if (record.status === 'running' || record.status === 'starting' || record.status === 'queued' || record.status === 'reconnecting') {
      acc.active += 1
    } else if (record.status === 'completed') {
      acc.completed += 1
    } else if (record.status === 'failed' || record.status === 'lost') {
      acc.failed += 1
    } else if (record.status === 'cancelled') {
      acc.cancelled += 1
    } else {
      acc.other += 1
    }
    return acc
  }, {
    active: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    other: 0,
  })

  return {
    total: normalized.length,
    active: counts.active,
    completed: counts.completed,
    failed: counts.failed,
    cancelled: counts.cancelled,
    other: counts.other,
    recent: normalized.slice(0, 6),
  }
}

export function registerSystemIPC(): void {
  ipcMain.handle('system:cleanupTile', (_, tileId: string) => {
    if (!tileId || typeof tileId !== 'string') return { ok: false }
    // 1. Drop all bus history pinned to this tile
    const channelsDropped = bus.dropChannelsMatching(`tile:${tileId}`)
    // 2. Clear peer state (agent state, messages, links)
    removePeerTile(tileId)
    // 3. Schedule a debounced GC
    scheduleGC()
    return { ok: true, channelsDropped }
  })

  ipcMain.handle('system:gc', () => {
    runGC()
    return { ok: true, exposed: typeof (globalThis as { gc?: unknown }).gc === 'function' }
  })

  ipcMain.handle('system:memStats', () => {
    const mem = process.memoryUsage()
    const heap = getHeapStatistics()
    return {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      heapLimit: heap.heap_size_limit,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      bus: bus.getStats(),
    }
  })

  ipcMain.handle('system:daemonStatus', async () => {
    return sanitizeDaemonState(await getDaemonStatus())
  })

  ipcMain.handle('system:daemonSummary', async () => {
    const status = sanitizeDaemonState(await getDaemonStatus())
    return {
      ...status,
      jobs: readDaemonJobSummary(),
    }
  })

  ipcMain.handle('system:restartDaemon', async () => {
    const info = await restartDaemon()
    return sanitizeDaemonState({ running: true, info })
  })
}
