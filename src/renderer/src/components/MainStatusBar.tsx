import React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppFonts } from '../FontContext'
import { useTheme } from '../ThemeContext'

type MemoryStats = {
  rss: number
  heapTotal: number
  heapUsed: number
  heapLimit: number
  external: number
  arrayBuffers: number
  bus: { channels: number; events: number; subscriptions: number; readCursors: number }
}

type DaemonStatus = {
  running: boolean
  info: {
    pid: number
    port: number
    startedAt: string
    protocolVersion: number
    appVersion: string | null
  } | null
}

type DaemonSummary = DaemonStatus & {
  jobs: {
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
  }
}

const REFRESH_MS = 1500
const DAEMON_REFRESH_MS = 5000

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function formatRelativeTime(value: string | null): string {
  if (!value) return 'Unknown'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (diffSeconds < 5) return 'just now'
  if (diffSeconds < 60) return `${diffSeconds}s ago`
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function statusTone(theme: ReturnType<typeof useTheme>, status: string): string {
  if (status === 'running' || status === 'starting' || status === 'queued' || status === 'reconnecting') return theme.status.success
  if (status === 'completed') return theme.text.secondary
  if (status === 'cancelled') return theme.status.warning
  if (status === 'failed' || status === 'lost') return theme.status.danger
  return theme.text.disabled
}

export function MainStatusBar(): React.JSX.Element {
  const theme = useTheme()
  const fonts = useAppFonts()
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [daemon, setDaemon] = useState<DaemonStatus | null>(null)
  const [daemonSummary, setDaemonSummary] = useState<DaemonSummary | null>(null)
  const [showDaemonSummary, setShowDaemonSummary] = useState(false)
  const daemonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    const load = () => {
      window.electron.system.memStats().then(next => {
        if (!cancelled) setStats(next)
      }).catch(() => {})
    }

    load()
    const interval = window.setInterval(load, REFRESH_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const load = () => {
      window.electron.system.daemonStatus().then(next => {
        if (!cancelled) setDaemon(next)
      }).catch(() => {
        if (!cancelled) setDaemon({ running: false, info: null })
      })
    }

    load()
    const interval = window.setInterval(load, DAEMON_REFRESH_MS)
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    if (!showDaemonSummary) return
    let cancelled = false

    const load = () => {
      window.electron.system.daemonSummary().then(next => {
        if (!cancelled) setDaemonSummary(next)
      }).catch(() => {
        if (!cancelled) setDaemonSummary(null)
      })
    }

    load()
    const interval = window.setInterval(load, DAEMON_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [showDaemonSummary])

  useEffect(() => {
    if (!showDaemonSummary) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!daemonRef.current?.contains(event.target as Node)) {
        setShowDaemonSummary(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowDaemonSummary(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showDaemonSummary])

  const usage = useMemo(() => {
    const heapLimit = stats?.heapLimit && stats.heapLimit > 0 ? stats.heapLimit : stats?.heapTotal ?? 0
    const heapUsed = stats?.heapUsed ?? 0
    const heapTotal = stats?.heapTotal ?? 0
    const ratio = heapLimit > 0 ? Math.min(1, heapUsed / heapLimit) : 0
    const committedRatio = heapLimit > 0 ? Math.min(1, heapTotal / heapLimit) : 0
    return { heapLimit, heapUsed, heapTotal, ratio, committedRatio }
  }, [stats])

  const fillColor = usage.ratio >= 0.85
    ? theme.status.danger
    : usage.ratio >= 0.7
      ? theme.status.warning
      : theme.accent.base

  const barBackground = theme.mode === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const title = stats
    ? `Main heap ${formatBytes(usage.heapUsed)} / ${formatBytes(usage.heapLimit || usage.heapTotal)} - RSS ${formatBytes(stats.rss)} - external ${formatBytes(stats.external)}`
    : 'Loading memory stats'
  const daemonTitle = daemon?.running
    ? `CodeSurf daemon active - PID ${daemon.info?.pid ?? 'unknown'} - port ${daemon.info?.port ?? 'unknown'}`
    : 'CodeSurf daemon offline'
  const daemonColor = daemon == null
    ? theme.text.disabled
    : daemon.running
      ? theme.text.secondary
      : theme.status.danger
  const daemonDot = daemon == null
    ? theme.text.disabled
    : daemon.running
      ? theme.status.success
      : theme.status.danger

  return (
    <div
      title={title}
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '0 16px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          minWidth: 0,
          width: 'min(760px, 100%)',
          justifyContent: 'flex-end',
          color: theme.text.secondary,
          fontFamily: fonts.secondary,
          fontSize: Math.max(10, fonts.secondarySize - 2),
          fontWeight: 500,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.2,
        }}
      >
        <div
          ref={daemonRef}
          title={daemonTitle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
            minWidth: 0,
            position: 'relative',
            pointerEvents: 'auto',
          }}
        >
          <button
            type="button"
            onMouseEnter={() => {
              window.electron.system.daemonSummary().then(setDaemonSummary).catch(() => {})
            }}
            onClick={() => {
              if (!showDaemonSummary) {
                window.electron.system.daemonSummary().then(setDaemonSummary).catch(() => {})
              }
              setShowDaemonSummary(current => !current)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              whiteSpace: 'nowrap',
              minWidth: 0,
              background: showDaemonSummary ? theme.surface.panelMuted : 'transparent',
              border: `1px solid ${showDaemonSummary ? theme.border.default : 'transparent'}`,
              color: daemonColor,
              borderRadius: 999,
              padding: '4px 8px',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: daemonDot,
                boxShadow: daemon?.running ? `0 0 8px ${daemonDot}66` : 'none',
                flexShrink: 0,
              }}
            />
            <span style={{ color: daemonColor }}>
              {daemon?.running ? 'Daemon active' : daemon == null ? 'Daemon' : 'Daemon offline'}
            </span>
          </button>
          {showDaemonSummary && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                bottom: 'calc(100% + 10px)',
                width: 340,
                maxWidth: 'min(340px, calc(100vw - 40px))',
                background: theme.surface.panel,
                border: `1px solid ${theme.border.default}`,
                borderRadius: 14,
                boxShadow: theme.mode === 'light'
                  ? '0 18px 40px rgba(0,0,0,0.12)'
                  : '0 18px 40px rgba(0,0,0,0.45)',
                padding: '12px 14px',
                pointerEvents: 'auto',
                zIndex: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: fonts.secondarySize, fontWeight: 700, color: theme.text.primary }}>
                    Daemon summary
                  </span>
                  <span style={{ fontSize: Math.max(10, fonts.secondarySize - 1), color: theme.text.disabled }}>
                    {daemonSummary?.running
                      ? `PID ${daemonSummary.info?.pid ?? '—'} · port ${daemonSummary.info?.port ?? '—'}`
                      : 'Daemon offline'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    window.electron.system.daemonSummary().then(setDaemonSummary).catch(() => {})
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: theme.text.muted,
                    cursor: 'pointer',
                    fontSize: Math.max(10, fonts.secondarySize - 1),
                    padding: 0,
                  }}
                >
                  Refresh
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
                {[
                  { label: 'Active', value: daemonSummary?.jobs.active ?? 0, color: theme.status.success },
                  { label: 'Done', value: daemonSummary?.jobs.completed ?? 0, color: theme.text.secondary },
                  { label: 'Failed', value: daemonSummary?.jobs.failed ?? 0, color: theme.status.danger },
                  { label: 'Total', value: daemonSummary?.jobs.total ?? 0, color: theme.text.primary },
                ].map(item => (
                  <div
                    key={item.label}
                    style={{
                      background: theme.surface.panelMuted,
                      border: `1px solid ${theme.border.subtle}`,
                      borderRadius: 10,
                      padding: '8px 10px',
                      minWidth: 0,
                    }}
                  >
                    <div style={{ fontSize: Math.max(9, fonts.secondarySize - 2), color: theme.text.disabled, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                      {item.label}
                    </div>
                    <div style={{ marginTop: 4, fontSize: fonts.secondarySize, fontWeight: 700, color: item.color }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: Math.max(10, fonts.secondarySize - 1), color: theme.text.disabled, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Recent jobs
                </div>
                {daemonSummary?.jobs.recent.length ? daemonSummary.jobs.recent.map(job => (
                  <div
                    key={job.id}
                    style={{
                      background: theme.surface.panelMuted,
                      border: `1px solid ${theme.border.subtle}`,
                      borderRadius: 10,
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: fonts.secondarySize, color: theme.text.primary, fontWeight: 600, textTransform: 'capitalize' }}>
                        {job.provider ?? 'Unknown'} · {job.model ?? 'Unknown model'}
                      </span>
                      <span style={{ fontSize: Math.max(10, fonts.secondarySize - 1), color: statusTone(theme, job.status), textTransform: 'capitalize' }}>
                        {job.status}
                      </span>
                    </div>
                    <div style={{ fontSize: Math.max(10, fonts.secondarySize - 1), color: theme.text.disabled }}>
                      {job.workspaceDir ?? 'No workspace'} · {formatRelativeTime(job.updatedAt ?? job.requestedAt)}
                    </div>
                    {job.error && (
                      <div style={{ fontSize: Math.max(10, fonts.secondarySize - 1), color: theme.status.danger, lineHeight: 1.35 }}>
                        {job.error}
                      </div>
                    )}
                  </div>
                )) : (
                  <div
                    style={{
                      background: theme.surface.panelMuted,
                      border: `1px solid ${theme.border.subtle}`,
                      borderRadius: 10,
                      padding: '10px 12px',
                      fontSize: fonts.secondarySize,
                      color: theme.text.disabled,
                    }}
                  >
                    No daemon jobs recorded yet.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <span style={{ color: theme.text.secondary, textTransform: 'uppercase', letterSpacing: 0.8, fontSize: Math.max(9, fonts.secondarySize - 3) }}>
          Memory
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, maxWidth: 320 }}>
          <div
            style={{
              position: 'relative',
              flex: 1,
              height: 8,
              borderRadius: 999,
              overflow: 'hidden',
              background: barBackground,
              minWidth: 90,
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${usage.committedRatio * 100}%`,
                background: theme.border.strong,
                opacity: 0.35,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${usage.ratio * 100}%`,
                background: fillColor,
                boxShadow: `0 0 10px ${fillColor}55`,
              }}
            />
          </div>
          <span style={{ whiteSpace: 'nowrap', color: usage.ratio >= 0.85 ? theme.status.danger : theme.text.secondary }}>
            {formatBytes(usage.heapUsed)} / {formatBytes(usage.heapLimit || usage.heapTotal)}
          </span>
        </div>

        <span style={{ whiteSpace: 'nowrap', color: theme.text.secondary }}>
          RSS {formatBytes(stats?.rss ?? 0)}
        </span>

        <span style={{ whiteSpace: 'nowrap', color: theme.text.secondary }}>
          {Math.round(usage.ratio * 100)}%
        </span>
      </div>
    </div>
  )
}

export default MainStatusBar
