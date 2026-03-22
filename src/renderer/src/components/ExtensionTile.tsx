/**
 * ExtensionTile — renders extension tile content inside a sandboxed iframe.
 *
 * Extension HTML is served through the custom contex-ext:// protocol so dev
 * renderer pages can load it safely, and a postMessage RPC bridge lets the
 * iframe talk back to the host renderer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../ThemeContext'

const el = (window as any).electron

interface ExtensionTileProps {
  tileId: string
  extType: string  // e.g. 'ext:timer'
  width: number
  height: number
  workspaceId?: string
  workspacePath?: string
}

export function ExtensionTile({ tileId, extType, width, height, workspaceId, workspacePath }: ExtensionTileProps) {
  const theme = useTheme()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const busUnsubsRef = useRef<Map<string, () => void>>(new Map())
  const bridgeReadyRef = useRef(false)

  const [entryUrl, setEntryUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [extId, setExtId] = useState<string | null>(null)

  const contentHeight = Math.max(0, height - 36)

  const themeColors = useMemo(() => ({
    background: theme.extension.background,
    panel: theme.extension.panel,
    border: theme.extension.border,
    text: theme.extension.text,
    muted: theme.extension.muted,
    accent: theme.extension.accent,
  }), [theme])

  const postToIframe = useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  const cleanupBusSubscriptions = useCallback(() => {
    for (const unsubscribe of busUnsubsRef.current.values()) unsubscribe()
    busUnsubsRef.current.clear()
  }, [])

  const ensureBusSubscription = useCallback((channel: string) => {
    if (!channel || busUnsubsRef.current.has(channel)) return

    const subscriberId = `exttile:${tileId}:${channel}`
    const unsubscribe = el.bus?.subscribe?.(channel, subscriberId, (event: any) => {
      postToIframe({
        type: 'contex-event',
        event: `bus.event.${channel}`,
        data: event,
      })
    })

    if (typeof unsubscribe === 'function') {
      busUnsubsRef.current.set(channel, unsubscribe)
    }
  }, [postToIframe, tileId])

  const handleRpc = useCallback(async (method: string, params: any) => {
    switch (method) {
      case 'tile.getState':
        if (!workspaceId) return null
        return el.canvas?.loadTileState?.(workspaceId, tileId) ?? null

      case 'tile.setState':
        if (!workspaceId) return false
        await el.canvas?.saveTileState?.(workspaceId, tileId, params ?? {})
        return true

      case 'tile.getSize':
        return { width, height: contentHeight }

      case 'tile.getMeta':
        return {
          tileId,
          extId,
          extType,
          width,
          height: contentHeight,
          workspaceId: workspaceId ?? '',
          workspacePath: workspacePath ?? '',
        }

      case 'bus.publish': {
        const channel = String(params?.channel ?? '')
        const type = String(params?.type ?? 'data')
        const payload = params?.payload ?? {}
        if (!channel) throw new Error('Missing bus channel')
        return el.bus?.publish?.(channel, type, `exttile:${tileId}`, payload)
      }

      case 'bus.subscribe': {
        const channel = String(params?.channel ?? '')
        if (!channel) throw new Error('Missing bus channel')
        ensureBusSubscription(channel)
        return true
      }

      case 'canvas.listTiles': {
        if (!workspaceId) return []
        const canvasState = await el.canvas?.load?.(workspaceId)
        return canvasState?.tiles ?? []
      }

      case 'canvas.createTile':
        throw new Error('canvas.createTile is not implemented yet')

      case 'settings.get': {
        if (!extId) return undefined
        const settings = await el.extensions?.getSettings?.(extId)
        const key = String(params?.key ?? '')
        return key ? settings?.[key] : settings
      }

      case 'workspace.getPath':
        return workspacePath ?? ''

      case 'theme.getColors':
        return themeColors

      default:
        throw new Error(`Unsupported extension RPC method: ${method}`)
    }
  }, [contentHeight, ensureBusSubscription, extId, extType, themeColors, tileId, width, workspaceId, workspacePath])

  useEffect(() => {
    bridgeReadyRef.current = false

    async function resolve() {
      try {
        const tiles = await el.extensions?.listTiles?.() ?? []
        const match = tiles.find((t: any) => t.type === extType)
        if (!match) {
          setError(`Extension tile type "${extType}" not found.`)
          setLoading(false)
          return
        }

        setExtId(match.extId)

        const url = await el.extensions?.tileEntry?.(match.extId, extType, tileId)
        if (!url) {
          setError(`No entry URL for extension "${match.extId}".`)
          setLoading(false)
          return
        }

        setEntryUrl(url)
        setError(null)
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    }

    resolve()
  }, [extType, tileId])

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return

      const message = event.data
      if (!message || typeof message !== 'object') return

      if (message.type === 'contex-bridge-ready' && message.tileId === tileId) {
        bridgeReadyRef.current = true
        postToIframe({
          type: 'contex-event',
          event: 'tile.resize',
          data: { width, height: contentHeight },
        })
        return
      }

      if (message.type !== 'contex-rpc' || message.tileId !== tileId) return

      try {
        const result = await handleRpc(String(message.method ?? ''), message.params)
        postToIframe({ type: 'contex-rpc-response', id: message.id, result })
      } catch (err) {
        postToIframe({
          type: 'contex-rpc-response',
          id: message.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [contentHeight, handleRpc, postToIframe, tileId, width])

  useEffect(() => {
    if (!bridgeReadyRef.current) return

    postToIframe({
      type: 'contex-event',
      event: 'tile.resize',
      data: { width, height: contentHeight },
    })
  }, [contentHeight, postToIframe, width])

  useEffect(() => {
    return () => {
      bridgeReadyRef.current = false
      cleanupBusSubscriptions()
    }
  }, [cleanupBusSubscriptions])

  if (loading) {
    return (
      <div style={{
        width,
        height: contentHeight,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: theme.text.disabled, fontSize: 12,
      }}>
        Loading extension…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        width,
        height: contentHeight,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: theme.status.danger, fontSize: 12, padding: 20, textAlign: 'center',
      }}>
        {error}
      </div>
    )
  }

  if (!entryUrl) return null

  return (
    <div style={{
      position: 'relative',
      width,
      height: contentHeight,
      overflow: 'hidden',
      background: theme.extension.background,
    }}>
      <iframe
        ref={iframeRef}
        src={entryUrl}
        sandbox="allow-scripts allow-same-origin"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
        }}
        title={extType}
      />
    </div>
  )
}
