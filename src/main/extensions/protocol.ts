import { net, protocol } from 'electron'
import { promises as fs } from 'fs'
import { isAbsolute, join, relative } from 'path'
import { pathToFileURL } from 'url'
import type { ExtensionRegistry } from './registry'
import { getBridgeScript } from './bridge'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'contex-ext',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

function injectBridge(html: string, bridgeScript: string): string {
  const tag = `<script>${bridgeScript}</script>`

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, match => `${match}\n${tag}`)
  }

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, match => `${match}\n${tag}`)
  }

  return `${tag}\n${html}`
}

export function registerExtensionProtocol(registry: ExtensionRegistry): void {
  protocol.handle('contex-ext', async request => {
    try {
      const url = new URL(request.url)
      const segments = url.pathname
        .split('/')
        .filter(Boolean)
        .map(segment => decodeURIComponent(segment))

      const [extId, ...fileSegments] = segments
      if (!extId || fileSegments.length === 0) {
        return new Response('Invalid extension URL', { status: 400 })
      }

      const ext = registry.get(extId)
      const root = ext?.manifest._path
      if (!root || ext?.manifest._enabled === false) {
        return new Response('Extension not found', { status: 404 })
      }

      const filePath = join(root, ...fileSegments)
      const rel = relative(root, filePath)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
        return new Response('Forbidden', { status: 403 })
      }

      if (/\.html?$/i.test(filePath)) {
        const raw = await fs.readFile(filePath, 'utf8')
        const tileId = url.searchParams.get('tileId')
        const html = tileId ? injectBridge(raw, getBridgeScript(tileId, extId)) : raw
        return new Response(html, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
          },
        })
      }

      return net.fetch(pathToFileURL(filePath).toString())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(`Extension load failed: ${message}`, { status: 500 })
    }
  })
}
