import React, { useRef, useEffect, useCallback } from 'react'
import type { TileState } from '../../../shared/types'

interface Props {
  tiles: TileState[]
  viewport: { tx: number; ty: number; zoom: number }
  canvasSize: { w: number; h: number }
  onPan: (tx: number, ty: number) => void
}

const TILE_COLORS: Record<string, string> = {
  terminal: '#4a9eff',
  code:     '#6db33f',
  note:     '#e2c08d',
  image:    '#e67e22',
  kanban:   '#c586c0',
  browser:  '#3fb950',
}

const W = 160
const H = 100
const PAD = 20

export function Minimap({ tiles, viewport, canvasSize, onPan }: Props): JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragging = useRef(false)

  const getBounds = useCallback(() => {
    if (tiles.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 600 }
    const minX = Math.min(...tiles.map(t => t.x)) - PAD
    const minY = Math.min(...tiles.map(t => t.y)) - PAD
    const maxX = Math.max(...tiles.map(t => t.x + t.width)) + PAD
    const maxY = Math.max(...tiles.map(t => t.y + t.height)) + PAD
    return { minX, minY, maxX, maxY }
  }, [tiles])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, W, H)

    const { minX, minY, maxX, maxY } = getBounds()
    const worldW = maxX - minX
    const worldH = maxY - minY
    const scale = Math.min(W / worldW, H / worldH) * 0.9
    const offX = (W - worldW * scale) / 2 - minX * scale
    const offY = (H - worldH * scale) / 2 - minY * scale

    // Draw tiles
    for (const t of tiles) {
      const x = t.x * scale + offX
      const y = t.y * scale + offY
      const w = Math.max(2, t.width * scale)
      const h = Math.max(2, t.height * scale)
      ctx.fillStyle = TILE_COLORS[t.type] + '88'
      ctx.strokeStyle = TILE_COLORS[t.type] + 'cc'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, 1)
      ctx.fill()
      ctx.stroke()
    }

    // Draw viewport rect
    const vx = (-viewport.tx / viewport.zoom) * scale + offX
    const vy = (-viewport.ty / viewport.zoom) * scale + offY
    const vw = (canvasSize.w / viewport.zoom) * scale
    const vh = (canvasSize.h / viewport.zoom) * scale
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1
    ctx.strokeRect(vx, vy, vw, vh)
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(vx, vy, vw, vh)
  }, [tiles, viewport, canvasSize, getBounds])

  const panTo = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = (clientX - rect.left) * (W / rect.width)
    const my = (clientY - rect.top) * (H / rect.height)

    const { minX, minY, maxX, maxY } = getBounds()
    const worldW = maxX - minX
    const worldH = maxY - minY
    const scale = Math.min(W / worldW, H / worldH) * 0.9
    const offX = (W - worldW * scale) / 2 - minX * scale
    const offY = (H - worldH * scale) / 2 - minY * scale

    const worldX = (mx - offX) / scale
    const worldY = (my - offY) / scale

    const newTx = canvasSize.w / 2 - worldX * viewport.zoom
    const newTy = canvasSize.h / 2 - worldY * viewport.zoom
    onPan(newTx, newTy)
  }, [getBounds, canvasSize, viewport.zoom, onPan])

  if (tiles.length === 0) return null

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: 16,
      background: 'rgba(18,18,18,0.88)',
      border: '1px solid #2d2d2d',
      borderRadius: 6,
      overflow: 'hidden',
      zIndex: 500,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      cursor: 'crosshair',
    }}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ display: 'block', width: W, height: H }}
        onMouseDown={e => { dragging.current = true; panTo(e.clientX, e.clientY) }}
        onMouseMove={e => { if (dragging.current) panTo(e.clientX, e.clientY) }}
        onMouseUp={() => { dragging.current = false }}
        onMouseLeave={() => { dragging.current = false }}
      />
    </div>
  )
}
