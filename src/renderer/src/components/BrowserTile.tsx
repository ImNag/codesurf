import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, RotateCcw, RotateCw, Home, Globe, Monitor, Smartphone } from 'lucide-react'

const HOMEPAGE = 'https://duckduckgo.com'

interface Props {
  tileId: string
  initialUrl?: string
  width: number
  height: number
  zIndex: number
}

type BrowserMode = 'desktop' | 'mobile'

function isLikelyUrl(value: string): boolean {
  if (!value) return false
  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(value)) return true
  if (/^localhost(?::\d+)?(\/|$)/i.test(value)) return true
  if (/^127\.0\.0\.1(?::\d+)?(\/|$)/.test(value)) return true
  if (value.includes('.') && !value.includes(' ')) return true
  return false
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return HOMEPAGE
  if (trimmed === 'about:blank') return trimmed
  if (trimmed.startsWith('file://')) return trimmed
  if (trimmed.startsWith('/')) return trimmed
  if (isLikelyUrl(trimmed)) {
    if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) return trimmed
    if (/^localhost(?::\d+)?(\/|$)/i.test(trimmed) || /^127\.0\.0\.1(?::\d+)?(\/|$)/.test(trimmed)) return `http://${trimmed}`
    return `https://${trimmed}`
  }
  return `${HOMEPAGE}/?q=${encodeURIComponent(trimmed)}`
}

function ToolbarButton({
  label,
  title,
  disabled,
  active,
  onClick,
  children
}: {
  label?: string
  title: string
  disabled?: boolean
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 26,
        height: 26,
        borderRadius: 6,
        border: `1px solid ${active ? '#4a9eff55' : '#333'}`,
        background: disabled ? '#222' : active ? '#1e3654' : '#2b2b2b',
        color: disabled ? '#555' : active ? '#9fc7ff' : '#ccc',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: 12
      }}
      onMouseEnter={e => {
        if (disabled || active) return
        e.currentTarget.style.background = '#3a3a3a'
      }}
      onMouseLeave={e => {
        if (disabled || active) return
        e.currentTarget.style.background = '#2b2b2b'
      }}
    >
      {children}
    </button>
  )
}

export function BrowserTile({ tileId, initialUrl, width, height, zIndex }: Props): JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const lastBoundsRef = useRef<string>('')
  const inputRef = useRef<HTMLInputElement>(null)
  const modeRef = useRef<BrowserMode>('desktop')
  const currentUrlRef = useRef(normalizeUrl(initialUrl ?? ''))

  const [addressBar, setAddressBar] = useState(currentUrlRef.current)
  const [currentUrl, setCurrentUrl] = useState(currentUrlRef.current)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [mode, setMode] = useState<BrowserMode>('desktop')

  // Keep modeRef in sync
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  // Update url when initialUrl changes
  useEffect(() => {
    const next = normalizeUrl(initialUrl ?? '')
    currentUrlRef.current = next
    setAddressBar(next)
    setCurrentUrl(next)
    // Tell main process to navigate
    void window.electron.browserTile.sync({
      tileId,
      url: next,
      mode: modeRef.current,
      zIndex,
      visible: true,
      bounds: { left: -10000, top: -10000, width: 1, height: 1 }
    })
  }, [initialUrl, tileId, zIndex])

  // Listen for events from the main-process BrowserView
  useEffect(() => {
    const unsub = window.electron.browserTile.onEvent((evt) => {
      if (evt.tileId !== tileId) return
      setCurrentUrl(evt.currentUrl)
      setCanGoBack(evt.canGoBack)
      setCanGoForward(evt.canGoForward)
      setIsLoading(evt.isLoading)
      if (document.activeElement !== inputRef.current) {
        setAddressBar(evt.currentUrl)
      }
      currentUrlRef.current = evt.currentUrl
    })
    return unsub
  }, [tileId])

  // rAF bounds sync loop — sends real screen-space coords to main process
  useEffect(() => {
    const syncBounds = () => {
      const el = contentRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        if (rect.width > 1 && rect.height > 1) {
          const bounds = {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
          const key = JSON.stringify(bounds)
          if (key !== lastBoundsRef.current) {
            lastBoundsRef.current = key
            void window.electron.browserTile.sync({
              tileId,
              url: currentUrlRef.current,
              mode: modeRef.current,
              zIndex,
              visible: true,
              bounds
            })
          }
        }
      }
      rafRef.current = requestAnimationFrame(syncBounds)
    }

    rafRef.current = requestAnimationFrame(syncBounds)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [tileId, zIndex])

  // Destroy BrowserView on unmount
  useEffect(() => {
    return () => {
      void window.electron.browserTile.destroy(tileId)
    }
  }, [tileId])

  const navigate = useCallback((rawUrl: string) => {
    const next = normalizeUrl(rawUrl)
    currentUrlRef.current = next
    setAddressBar(next)
    setCurrentUrl(next)
    setIsLoading(true)
    void window.electron.browserTile.command({ tileId, command: 'navigate', url: next })
  }, [tileId])

  const command = useCallback((cmd: 'back' | 'forward' | 'reload' | 'stop' | 'home') => {
    if (cmd === 'reload') setIsLoading(true)
    void window.electron.browserTile.command({ tileId, command: cmd })
  }, [tileId])

  const switchMode = useCallback((next: BrowserMode) => {
    setMode(next)
    modeRef.current = next
    void window.electron.browserTile.command({ tileId, command: 'mode', mode: next })
  }, [tileId])

  const headerSlot = typeof document !== 'undefined'
    ? document.getElementById(`tile-header-slot-${tileId}`)
    : null

  const toolbar = (
    <form
      onSubmit={e => {
        e.preventDefault()
        navigate(addressBar)
      }}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
        paddingRight: 6
      }}
    >
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <ToolbarButton label="Back" title="Back" disabled={!canGoBack} onClick={() => command('back')}>
          <ArrowLeft size={12} />
        </ToolbarButton>
        <ToolbarButton label="Forward" title="Forward" disabled={!canGoForward} onClick={() => command('forward')}>
          <ArrowRight size={12} />
        </ToolbarButton>
        <ToolbarButton label={isLoading ? 'Stop' : 'Reload'} title={isLoading ? 'Stop' : 'Reload'} onClick={() => command(isLoading ? 'stop' : 'reload')}>
          {isLoading ? <RotateCcw size={12} /> : <RotateCw size={12} />}
        </ToolbarButton>
        <ToolbarButton label="Home" title="Home" onClick={() => command('home')}>
          <Home size={12} />
        </ToolbarButton>
      </div>

      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <input
          ref={inputRef}
          aria-label="Address"
          value={addressBar}
          onChange={e => setAddressBar(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur()
          }}
          style={{
            width: '100%',
            height: 22,
            borderRadius: 6,
            border: '1px solid #3a3a3a',
            background: '#111',
            color: '#d4d4d4',
            padding: '0 8px 0 24px',
            fontSize: 11,
            outline: 'none',
            boxSizing: 'border-box'
          }}
          spellCheck={false}
        />
        <div style={{
          position: 'absolute',
          left: 7,
          top: '50%',
          transform: 'translateY(-50%)',
          color: currentUrl.startsWith('https://') ? '#3fb950' : '#6db33f',
          display: 'flex',
          alignItems: 'center'
        }}>
          <Globe size={10} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <ToolbarButton label="Desktop" title="Desktop mode" active={mode === 'desktop'} onClick={() => switchMode('desktop')}>
          <Monitor size={12} />
        </ToolbarButton>
        <ToolbarButton label="Mobile" title="Mobile mode" active={mode === 'mobile'} onClick={() => switchMode('mobile')}>
          <Smartphone size={12} />
        </ToolbarButton>
      </div>
    </form>
  )

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 0, background: '#111', position: 'relative', overflow: 'hidden' }}>
      {/* Toolbar portals into the tile header slot */}
      {headerSlot && createPortal(toolbar, headerSlot)}

      {/* Transparent placeholder — getBoundingClientRect() gives us real screen coords */}
      <div
        ref={contentRef}
        style={{ width: '100%', height: '100%', background: 'transparent' }}
      />

      {(width < 260 || height < 170) && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          right: 8,
          fontSize: 10,
          background: 'rgba(0,0,0,0.6)',
          border: '1px solid #333',
          color: '#777',
          padding: '2px 6px',
          borderRadius: 4,
          pointerEvents: 'none'
        }}>
          Small tiles may hide browser controls
        </div>
      )}
    </div>
  )
}
