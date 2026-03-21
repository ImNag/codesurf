import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppFonts } from '../FontContext'
import { getDroppedPaths, shellEscapePath } from '../utils/dnd'

interface Props {
  tileId: string
  workspaceDir: string
  width: number
  height: number
  fontSize?: number
  fontFamily?: string
}

export function TerminalTile({ tileId, workspaceDir, width, height, fontSize = 13, fontFamily }: Props): JSX.Element {
  const appFonts = useAppFonts()
  const resolvedFont = fontFamily ?? appFonts.mono
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const mountedRef = useRef(false)
  const [isDropTarget, setIsDropTarget] = useState(false)

  const doFit = () => {
    if (!fitRef.current || !termRef.current) return
    try {
      fitRef.current.fit()
      const dims = fitRef.current.proposeDimensions()
      if (dims?.cols && dims?.rows) {
        window.electron?.terminal?.resize(tileId, dims.cols, dims.rows)
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return
    mountedRef.current = true

    const term = new Terminal({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        cursorAccent: '#1a1a1a',
        selectionBackground: 'rgba(74,158,255,0.3)',
        black: '#1e1e1e', red: '#f44747', green: '#6a9955',
        yellow: '#d7ba7d', blue: '#569cd6', magenta: '#c586c0',
        cyan: '#4ec9b0', white: '#d4d4d4',
        brightBlack: '#808080', brightRed: '#f44747', brightGreen: '#6a9955',
        brightYellow: '#d7ba7d', brightBlue: '#569cd6', brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0', brightWhite: '#ffffff'
      },
      fontFamily: resolvedFont,
      fontSize,
      lineHeight: 1,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    // Apply padding inside xterm element so viewport bg covers behind it
    const xtermEl = containerRef.current.querySelector('.xterm') as HTMLElement | null
    if (xtermEl) {
      xtermEl.style.paddingLeft = '8px'
      xtermEl.style.paddingTop = '8px'
    }

    termRef.current = term
    fitRef.current = fitAddon

    // ResizeObserver so fit runs whenever the container actually changes size
    const ro = new ResizeObserver(() => doFit())
    ro.observe(containerRef.current)

    // Initial fit after paint
    requestAnimationFrame(() => requestAnimationFrame(() => doFit()))

    window.electron.terminal.create(tileId, workspaceDir).then(({ buffer }) => {
      if (buffer) term.write(buffer)
      const cleanup = window.electron.terminal.onData(tileId, (data: string) => {
        term.write(data)
      })
      cleanupRef.current = cleanup

      term.onData((data: string) => {
        window.electron.terminal.write(tileId, data)
      })

      // Fit once more after pty is ready
      doFit()
    }).catch(err => {
      term.write(`\r\n\x1b[31mFailed to start terminal: ${err?.message ?? err}\x1b[0m\r\n`)
    })

    return () => {
      mountedRef.current = false
      ro.disconnect()
      cleanupRef.current?.()
      term.dispose()
    }
  }, [tileId, workspaceDir])

  // Also refit when tile width/height props change (drag resize)
  useEffect(() => {
    doFit()
  }, [width, height])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (getDroppedPaths(e.dataTransfer).length === 0) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDropTarget(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setIsDropTarget(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const droppedPaths = getDroppedPaths(e.dataTransfer)
    if (droppedPaths.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setIsDropTarget(false)
    const payload = droppedPaths.map(shellEscapePath).join(' ')
    if (!payload) return
    termRef.current?.focus()
    window.electron?.terminal?.write(tileId, `${payload} `)
  }, [tileId])

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        width: '100%', height: '100%', background: isDropTarget ? '#202734' : '#1e1e1e', overflow: 'hidden', position: 'relative',
        boxShadow: isDropTarget ? 'inset 0 0 0 2px rgba(88,166,255,0.9), 0 0 22px rgba(56,139,253,0.14)' : 'none',
        transition: 'background 120ms ease, box-shadow 120ms ease'
      }}
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%', background: '#1e1e1e', overflow: 'hidden' }}
      />
      {isDropTarget && (
        <div style={{
          position: 'absolute', inset: 12, zIndex: 2,
          border: '1px dashed rgba(88,166,255,0.85)', borderRadius: 10,
          background: 'rgba(13, 33, 55, 0.12)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  )
}
