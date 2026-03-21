import React, { useEffect, useMemo, useState } from 'react'
import type { FontToken } from '../../../shared/types'
import { basename, isImagePath, toFileUrl } from '../utils/dnd'

interface Props {
  tileId: string
  filePath: string
  workspacePath?: string
  secondaryFont: FontToken
}

interface FileStats {
  size: number
  mtimeMs: number
  isFile: boolean
  isDir: boolean
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function extLabel(filePath: string): string {
  const match = filePath.match(/\.([^.\/]+)$/)
  return match ? match[1].toUpperCase() : 'FILE'
}

export function FileTile({ tileId, filePath, workspacePath, secondaryFont }: Props): JSX.Element {
  const [hovered, setHovered] = useState(false)
  const [stats, setStats] = useState<FileStats | null>(null)
  const [missing, setMissing] = useState(false)
  const image = isImagePath(filePath)
  const inWorkspace = !!workspacePath && filePath.startsWith(workspacePath)

  useEffect(() => {
    let cancelled = false
    setMissing(false)
    window.electron.fs.stat(filePath)
      .then(next => {
        if (cancelled) return
        setStats(next)
      })
      .catch(() => {
        if (cancelled) return
        setStats(null)
        setMissing(true)
      })
    return () => { cancelled = true }
  }, [filePath])

  const meta = useMemo(() => {
    const parts = [extLabel(filePath)]
    if (stats?.size !== undefined) parts.push(formatBytes(stats.size))
    parts.push(inWorkspace ? 'In workspace' : 'Reference')
    return parts.join(' · ')
  }, [filePath, stats?.size, inWorkspace])

  const startPathDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.stopPropagation()
    e.dataTransfer.setData('text/plain', filePath)
    e.dataTransfer.setData('text/uri-list', toFileUrl(filePath))
    e.dataTransfer.setData('application/file-reference-path', filePath)
    e.dataTransfer.setData('application/file-reference-tile-id', tileId)
    e.dataTransfer.effectAllowed = 'copyLink'
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        background: image ? '#090909' : 'linear-gradient(180deg, #1b1b1f 0%, #101014 100%)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {image ? (
        <img
          src={toFileUrl(filePath)}
          alt={basename(filePath)}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
            filter: missing ? 'grayscale(1)' : 'none',
            opacity: missing ? 0.28 : 1,
          }}
          onError={() => setMissing(true)}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at 30% 20%, rgba(74,158,255,0.18), transparent 40%), linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
          }}
        >
          <div
            style={{
              minWidth: 88,
              minHeight: 88,
              padding: '18px 20px',
              borderRadius: 24,
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'rgba(12,12,16,0.66)',
              boxShadow: '0 24px 48px rgba(0,0,0,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                color: '#d7ebff',
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {extLabel(filePath)}
            </span>
          </div>
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: missing
            ? 'linear-gradient(180deg, rgba(20,20,20,0.15) 0%, rgba(10,10,10,0.88) 100%)'
            : 'linear-gradient(180deg, rgba(20,20,20,0.04) 0%, rgba(10,10,10,0.78) 100%)',
          opacity: hovered ? 1 : 0.78,
          transition: 'opacity 0.14s ease',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: hovered ? 12 : 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          transition: 'transform 0.14s ease, opacity 0.14s ease, bottom 0.14s ease',
          transform: hovered ? 'translateY(0)' : 'translateY(4px)',
          opacity: hovered ? 1 : 0.92,
        }}
      >
        <div
          draggable
          onDragStart={startPathDrag}
          style={{
            display: 'inline-flex',
            alignSelf: 'flex-start',
            maxWidth: '100%',
            padding: '6px 10px',
            borderRadius: 999,
            background: 'rgba(8,8,10,0.78)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#f3f6fb',
            cursor: 'grab',
            boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            fontFamily: secondaryFont.family,
            fontSize: secondaryFont.size,
            lineHeight: secondaryFont.lineHeight,
            fontWeight: secondaryFont.weight ?? 500,
            letterSpacing: secondaryFont.letterSpacing,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title="Drag to another tile or the file explorer"
        >
          {basename(filePath)}
        </div>
        <div
          style={{
            color: missing ? '#ffb3b3' : '#a9b5c5',
            fontSize: 11,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 1px 10px rgba(0,0,0,0.45)',
          }}
        >
          {missing ? 'Missing file' : meta}
        </div>
      </div>
    </div>
  )
}
