import React, { useEffect, useState, useCallback, useRef } from 'react'
import type { Workspace } from '../../../shared/types'
import { ContextMenu, MenuItem } from './ContextMenu'


interface FsEntry {
  name: string
  path: string
  isDir: boolean
  ext: string
  mtime?: number
}

type GitStatus = 'modified' | 'untracked' | 'added' | 'deleted' | 'renamed' | 'conflict'
const GIT_COLORS: Record<GitStatus, string> = {
  modified:  '#e2c08d',
  untracked: '#73c991',
  added:     '#73c991',
  deleted:   '#f44747',
  renamed:   '#e2c08d',
  conflict:  '#f44747',
}
const GIT_LABELS: Record<GitStatus, string> = {
  modified:  'M',
  untracked: 'U',
  added:     'A',
  deleted:   'D',
  renamed:   'R',
  conflict:  '!',
}

interface Props {
  workspace: Workspace | null
  workspaces: Workspace[]
  onSwitchWorkspace: (id: string) => void
  onNewWorkspace: (name: string) => void
  onOpenFile: (filePath: string) => void
  onNewTerminal: () => void
  onNewKanban: () => void
  onNewBrowser: () => void
  collapsed: boolean
  onToggleCollapse: () => void
}

type SortMode = 'name' | 'ext' | 'type'
const SORT_MODES: SortMode[] = ['name', 'type', 'ext']
const SORT_LABELS: Record<SortMode, string> = { name: 'Name Z-A', type: 'Type', ext: 'Ext' }

const IGNORED = new Set(['.git', 'node_modules', '.next', 'dist', 'dist-electron', '.DS_Store', '__pycache__', '.cache', 'out'])

function sortEntries(entries: FsEntry[], mode: SortMode): FsEntry[] {
  const dirs = [...entries.filter(e => e.isDir)].sort((a, b) => a.name.localeCompare(b.name))
  const files = entries.filter(e => !e.isDir)
  let sorted: FsEntry[]
  if (mode === 'name') {
    sorted = [...files].sort((a, b) => a.name.localeCompare(b.name))
  } else if (mode === 'ext') {
    sorted = [...files].sort((a, b) => {
      const e = a.ext.localeCompare(b.ext)
      return e !== 0 ? e : a.name.localeCompare(b.name)
    })
  } else {
    sorted = [...files].sort((a, b) => a.name.localeCompare(b.name))
  }
  return [...dirs, ...sorted]
}

// ─── File icon — colored letter badge ────────────────────────────────────────
const EXT_META: Record<string, { label: string; color: string; bg: string }> = {
  '.ts':   { label: 'TS',  color: '#fff', bg: '#3178c6' },
  '.tsx':  { label: 'TX',  color: '#fff', bg: '#3178c6' },
  '.js':   { label: 'JS',  color: '#000', bg: '#f7df1e' },
  '.jsx':  { label: 'JX',  color: '#000', bg: '#f7df1e' },
  '.json': { label: '{ }', color: '#f7df1e', bg: '#2a2a1a' },
  '.md':   { label: 'MD',  color: '#fff', bg: '#4a7a3a' },
  '.mdx':  { label: 'MX',  color: '#fff', bg: '#4a7a3a' },
  '.txt':  { label: 'TXT', color: '#888', bg: '#252525' },
  '.css':  { label: 'CSS', color: '#fff', bg: '#563d7c' },
  '.html': { label: 'HTM', color: '#fff', bg: '#e34c26' },
  '.py':   { label: 'PY',  color: '#fff', bg: '#3572a5' },
  '.rs':   { label: 'RS',  color: '#fff', bg: '#a95028' },
  '.go':   { label: 'GO',  color: '#fff', bg: '#00acd7' },
  '.sh':   { label: 'SH',  color: '#fff', bg: '#4a6a1a' },
  '.yaml': { label: 'YML', color: '#fff', bg: '#7a1a1a' },
  '.yml':  { label: 'YML', color: '#fff', bg: '#7a1a1a' },
  '.toml': { label: 'TOM', color: '#fff', bg: '#6a2a1a' },
  '.svg':  { label: 'SVG', color: '#fff', bg: '#e67e22' },
  '.png':  { label: 'PNG', color: '#fff', bg: '#7a2a2a' },
  '.jpg':  { label: 'JPG', color: '#fff', bg: '#7a2a2a' },
  '.jpeg': { label: 'JPG', color: '#fff', bg: '#7a2a2a' },
  '.gif':  { label: 'GIF', color: '#fff', bg: '#7a2a2a' },
  '.webp': { label: 'WBP', color: '#fff', bg: '#7a2a2a' },
  '.lock': { label: 'LCK', color: '#888', bg: '#252525' },
  '.env':  { label: 'ENV', color: '#fff', bg: '#3a4a1a' },
}

function FileIcon({ ext }: { ext: string }): JSX.Element {
  const meta = EXT_META[ext] ?? { label: ext.replace('.','').slice(0,3).toUpperCase() || 'TXT', color: '#888', bg: '#252525' }
  return (
    <div style={{
      width: 22, height: 14, flexShrink: 0, marginRight: 6,
      background: meta.bg, borderRadius: 2,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <span style={{
        fontSize: 7, fontWeight: 700, color: meta.color,
        fontFamily: 'monospace', letterSpacing: '-0.02em',
        lineHeight: 1
      }}>
        {meta.label}
      </span>
    </div>
  )
}

function DirIcon({ expanded }: { expanded: boolean }): JSX.Element {
  return (
    <span style={{
      fontSize: 14, color: expanded ? '#bbb' : '#666',
      marginRight: 5, display: 'inline-block', width: 12,
      transform: expanded ? 'rotate(90deg)' : 'none',
      transition: 'transform 0.12s',
      userSelect: 'none', lineHeight: 1
    }}>
      ›
    </span>
  )
}

function Badge({ count }: { count: number }): JSX.Element {
  return (
    <span style={{
      fontSize: 10, color: '#aaa',
      background: '#2a2a2a', borderRadius: 8,
      padding: '1px 6px', marginLeft: 6,
      fontFamily: 'monospace', flexShrink: 0
    }}>
      {count}
    </span>
  )
}

function formatDate(mtime?: number): string {
  if (!mtime) return ''
  const d = new Date(mtime)
  const day = d.getDate()
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]
  return `${day} ${mon}`
}

// ─── Tree node ────────────────────────────────────────────────────────────────
interface CtxState { x: number; y: number; entry: FsEntry }

function TreeNode({
  entry, depth, sortMode, gitStatus, onOpenFile, onCtxMenu, onRefresh
}: {
  entry: FsEntry
  depth: number
  sortMode: SortMode
  gitStatus: Record<string, GitStatus>
  onOpenFile: (p: string) => void
  onCtxMenu: (e: React.MouseEvent, entry: FsEntry) => void
  onRefresh: () => void
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FsEntry[]>([])
  const [childCount, setChildCount] = useState<number | null>(null)
  const [hovered, setHovered] = useState(false)

  const loadChildren = useCallback(async () => {
    const items: FsEntry[] = await window.electron.fs.readDir(entry.path).catch(() => [])
    const filtered = items.filter(e => !IGNORED.has(e.name))
    setChildren(sortEntries(filtered, sortMode))
    setChildCount(filtered.length)
  }, [entry.path, sortMode])

  useEffect(() => {
    // Pre-load child count for dirs
    if (entry.isDir && childCount === null) {
      window.electron.fs.readDir(entry.path).then((items: FsEntry[]) => {
        setChildCount(items.filter(e => !IGNORED.has(e.name)).length)
      }).catch(() => setChildCount(0))
    }
  }, [entry.path, entry.isDir, childCount])

  useEffect(() => {
    if (expanded) {
      setChildren(prev => sortEntries(prev, sortMode))
    }
  }, [sortMode])

  const toggle = useCallback(async () => {
    if (!entry.isDir) { onOpenFile(entry.path); return }
    if (!expanded) await loadChildren()
    setExpanded(p => !p)
  }, [entry, expanded, loadChildren, onOpenFile])

  const indent = depth * 16

  return (
    <div>
      <div
        style={{
          display: 'flex', alignItems: 'center',
          height: 26,
          paddingLeft: 8 + indent,
          paddingRight: 12,
          cursor: 'pointer', userSelect: 'none',
          background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={toggle}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onCtxMenu(e, entry) }}
        draggable={!entry.isDir}
        onDragStart={e => {
          e.dataTransfer.setData('text/plain', entry.path)
          e.dataTransfer.effectAllowed = 'copy'
        }}
      >
        {/* Indent guide lines */}
        {Array.from({ length: depth }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: 8 + i * 16 + 5,
            width: 1, top: 0, bottom: 0,
            background: 'rgba(255,255,255,0.05)',
            pointerEvents: 'none'
          }} />
        ))}

        {entry.isDir
          ? <DirIcon expanded={expanded} />
          : <FileIcon ext={entry.ext} />
        }

        <span style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: entry.isDir ? '#d4d4d4' : '#b8b8b8',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1
        }}>
          {entry.isDir
            ? <><span style={{ fontWeight: 500 }}>{entry.name}</span>{childCount !== null && childCount > 0 && <Badge count={childCount} />}</>
            : <><span style={{ fontWeight: 400 }}>{entry.name.replace(entry.ext, '')}</span><span style={{ color: '#4a4a4a' }}>{entry.ext}</span></>
          }
        </span>

        {/* Git status indicator */}
        {(() => {
          const s = gitStatus[entry.path]
          if (!s) return null
          return (
            <span style={{
              fontSize: 10, fontWeight: 700, color: GIT_COLORS[s],
              marginLeft: 6, flexShrink: 0, fontFamily: 'monospace',
              lineHeight: 1
            }} title={s}>
              {GIT_LABELS[s]}
            </span>
          )
        })()}

        {!entry.isDir && entry.mtime && (
          <span style={{ fontSize: 10, color: '#3a3a3a', fontFamily: 'monospace', flexShrink: 0, marginLeft: 6 }}>
            {formatDate(entry.mtime)}
          </span>
        )}
      </div>

      {entry.isDir && expanded && (
        <div style={{ position: 'relative' }}>
          {children.length === 0 ? (
            <div style={{ paddingLeft: 8 + (depth + 1) * 16 + 16, height: 24, fontSize: 11, color: '#3a3a3a', display: 'flex', alignItems: 'center' }}>
              empty
            </div>
          ) : (
            children.map(child => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                sortMode={sortMode}
                gitStatus={gitStatus}
                onOpenFile={onOpenFile}
                onCtxMenu={onCtxMenu}
                onRefresh={loadChildren}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar({
  workspace, workspaces, onSwitchWorkspace, onNewWorkspace, onOpenFile, onNewTerminal, onNewKanban, onNewBrowser,
  collapsed, onToggleCollapse
}: Props): JSX.Element {
  const [rootEntries, setRootEntries] = useState<FsEntry[]>([])
  const [sortMode, setSortMode] = useState<SortMode>('name')
  const [search, setSearch] = useState('')
  const [gitStatus, setGitStatus] = useState<Record<string, GitStatus>>({})
  const [width, setWidth] = useState(260)
  const [refreshKey, setRefreshKey] = useState(0)
  const resizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false)
  const [newWsInput, setNewWsInput] = useState(false)
  const [newWsName, setNewWsName] = useState('')
  const [ctx, setCtx] = useState<CtxState | null>(null)
  const [creatingIn, setCreatingIn] = useState<{ dir: string; type: 'file' | 'folder' } | null>(null)
  const [createName, setCreateName] = useState('')

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const loadRoot = useCallback(() => {
    if (!workspace) return
    window.electron.fs.readDir(workspace.path)
      .then((items: FsEntry[]) => {
        const filtered = items.filter(e => !IGNORED.has(e.name))
        setRootEntries(sortEntries(filtered, sortMode))
      })
      .catch(() => setRootEntries([]))
  }, [workspace, sortMode])

  useEffect(() => { loadRoot() }, [loadRoot])
  useEffect(() => { setRootEntries(prev => sortEntries(prev, sortMode)) }, [sortMode])

  // Git status — load on mount and refresh every 5s
  const loadGit = useCallback(() => {
    if (!workspace) return
    window.electron.git?.status(workspace.path).then((result: { isRepo: boolean; root: string; files: { path: string; status: GitStatus }[] }) => {
      if (!result.isRepo) return
      const map: Record<string, GitStatus> = {}
      for (const f of result.files) {
        map[`${result.root}/${f.path}`] = f.status
        const parts = f.path.split('/')
        for (let i = 1; i < parts.length; i++) {
          const dir = `${result.root}/${parts.slice(0, i).join('/')}`
          if (!map[dir]) map[dir] = 'modified'
        }
      }
      setGitStatus(map)
    }).catch(() => {})
  }, [workspace])

  useEffect(() => {
    loadGit()
    const interval = setInterval(loadGit, 5000)
    return () => clearInterval(interval)
  }, [loadGit])

  useEffect(() => {
    if (!workspace) return
    const unsub = window.electron.fs.watch?.(workspace.path, refresh)
    return () => unsub?.()
  }, [workspace, refresh])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return
      setWidth(Math.max(180, Math.min(500, startWidth.current + e.clientX - startX.current)))
    }
    const onUp = () => { resizing.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const cycleSortMode = useCallback(() => {
    setSortMode(prev => SORT_MODES[(SORT_MODES.indexOf(prev) + 1) % SORT_MODES.length])
  }, [])

  const handleCtxMenu = useCallback((e: React.MouseEvent, entry: FsEntry) => {
    setCtx({ x: e.clientX, y: e.clientY, entry })
  }, [])

  const handleBgCtxMenu = useCallback((e: React.MouseEvent) => {
    if (!workspace) return
    e.preventDefault()
    setCtx({ x: e.clientX, y: e.clientY, entry: { name: workspace.name, path: workspace.path, isDir: true, ext: '' } })
  }, [workspace])

  const submitCreate = useCallback(async () => {
    if (!creatingIn || !createName.trim()) { setCreatingIn(null); return }
    const fullPath = `${creatingIn.dir}/${createName.trim()}`
    if (creatingIn.type === 'file') await window.electron.fs.createFile(fullPath)
    else await window.electron.fs.createDir?.(fullPath)
    setCreatingIn(null)
    setCreateName('')
    refresh()
  }, [creatingIn, createName, refresh])

  const ctxItems = useCallback((): MenuItem[] => {
    if (!ctx) return []
    const { entry } = ctx
    const dir = entry.isDir ? entry.path : entry.path.split('/').slice(0, -1).join('/')
    const items: MenuItem[] = []
    if (!entry.isDir) items.push({ label: 'Open', action: () => onOpenFile(entry.path) })
    items.push({ label: 'New File',   action: () => { setCreatingIn({ dir, type: 'file' });   setCreateName('') } })
    items.push({ label: 'New Folder', action: () => { setCreatingIn({ dir, type: 'folder' }); setCreateName('') } })
    items.push({ label: '', action: () => {}, divider: true })
    items.push({ label: 'Copy Path',        action: () => navigator.clipboard.writeText(entry.path) })
    items.push({ label: 'Reveal in Finder', action: () => window.electron.fs.revealInFinder?.(entry.path) })
    items.push({ label: '', action: () => {}, divider: true })
    items.push({
      label: `Delete ${entry.isDir ? 'Folder' : 'File'}`,
      danger: true,
      action: async () => { await window.electron.fs.deleteFile?.(entry.path); refresh() }
    })
    return items
  }, [ctx, onOpenFile, refresh])

  const filteredEntries = search.trim()
    ? rootEntries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : rootEntries

  return (
    <div style={{
      width: collapsed ? 0 : width,
      flexShrink: 0,
      background: '#1a1a1a',
      borderRight: collapsed ? 'none' : '1px solid #252525',
      display: 'flex', flexDirection: 'column',
      position: 'relative', overflow: 'hidden',
      transition: 'width 0.15s ease'
    }}>

      {/* Workspace switcher */}
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #252525' }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
            padding: '5px 10px', borderRadius: 8,
            background: '#252525',
            border: '1px solid #2d2d2d'
          }}
          onClick={() => setWsDropdownOpen(p => !p)}
        >
          <span style={{
            fontSize: 11, color: '#d4d4d4', fontWeight: 500,
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: 'monospace'
          }}>
            {workspace?.name ?? 'No workspace'}
          </span>
          <span style={{ fontSize: 9, color: '#555' }}>{wsDropdownOpen ? '▴' : '▾'}</span>
        </div>

        {wsDropdownOpen && (
          <div style={{ marginTop: 4, background: '#222', border: '1px solid #333', borderRadius: 8, overflow: 'hidden' }}>
            {workspaces.map(ws => (
              <div key={ws.id}
                style={{ padding: '7px 14px', fontSize: 12, fontFamily: 'monospace', color: ws.id === workspace?.id ? '#4a9eff' : '#ccc', cursor: 'pointer' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => { onSwitchWorkspace(ws.id); setWsDropdownOpen(false) }}
              >
                {ws.name}
              </div>
            ))}
            <div style={{ height: 1, background: '#2d2d2d', margin: '2px 0' }} />
            {newWsInput ? (
              <div style={{ padding: '4px 8px' }}>
                <input autoFocus value={newWsName} onChange={e => setNewWsName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newWsName.trim()) {
                      onNewWorkspace(newWsName.trim())
                      setNewWsName(''); setNewWsInput(false); setWsDropdownOpen(false)
                    }
                    if (e.key === 'Escape') { setNewWsInput(false); setNewWsName('') }
                  }}
                  placeholder="Workspace name…"
                  style={{ width: '100%', padding: '4px 8px', fontSize: 12, borderRadius: 4, background: '#1a1a1a', color: '#ccc', border: '1px solid #4a9eff', outline: 'none', fontFamily: 'monospace' }}
                />
              </div>
            ) : (
              <div style={{ padding: '7px 14px', fontSize: 12, color: '#555', cursor: 'pointer', fontFamily: 'monospace' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => setNewWsInput(true)}
              >
                + Add workspace
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search + sort */}
      <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid #1f1f1f', display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search  ⌘K"
          style={{
            flex: 1, padding: '4px 10px', fontSize: 11,
            background: '#222', color: '#ccc',
            border: '1px solid #2d2d2d', borderRadius: 6,
            outline: 'none', fontFamily: 'monospace'
          }}
        />
        <button
          onClick={cycleSortMode}
          style={{
            fontSize: 10, color: '#555', background: 'transparent', border: 'none',
            cursor: 'pointer', padding: '4px 6px', borderRadius: 4,
            whiteSpace: 'nowrap', fontFamily: 'monospace'
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#999' }}
          onMouseLeave={e => { e.currentTarget.style.color = '#555' }}
        >
          {SORT_LABELS[sortMode]}
        </button>
      </div>

      {/* File tree */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '4px 0', position: 'relative' }}
        onContextMenu={handleBgCtxMenu}
      >
        {!workspace ? (
          <div style={{ padding: '16px', fontSize: 12, color: '#444', fontFamily: 'monospace' }}>No workspace open</div>
        ) : filteredEntries.length === 0 ? (
          <div style={{ padding: '16px', fontSize: 12, color: '#444', fontFamily: 'monospace' }}>
            {search ? 'No matches' : 'Empty'}
          </div>
        ) : (
          filteredEntries.map(entry => (
            <TreeNode
              key={`${entry.path}-${refreshKey}`}
              entry={entry}
              depth={0}
              sortMode={sortMode}
              gitStatus={gitStatus}
              onOpenFile={onOpenFile}
              onCtxMenu={handleCtxMenu}
              onRefresh={loadRoot}
            />
          ))
        )}

        {creatingIn && (
          <div style={{ padding: '4px 12px' }}>
            <input
              autoFocus
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitCreate()
                if (e.key === 'Escape') { setCreatingIn(null); setCreateName('') }
                e.stopPropagation()
              }}
              onBlur={submitCreate}
              placeholder={creatingIn.type === 'file' ? 'filename.ts' : 'folder-name'}
              style={{
                width: '100%', padding: '4px 8px', fontSize: 12, borderRadius: 4,
                background: '#161616', color: '#ccc',
                border: '1px solid #4a9eff', outline: 'none',
                boxSizing: 'border-box', fontFamily: 'monospace'
              }}
            />
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{ borderTop: '1px solid #252525', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          style={{ width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid #2d2d2d', background: '#222', color: '#ccc', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#2a2a2a')}
          onMouseLeave={e => (e.currentTarget.style.background = '#222')}
          onClick={onNewTerminal}
        >
          New Terminal
        </button>
        <button
          style={{ width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid #2d2d2d', background: '#222', color: '#666', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#2a2a2a')}
          onMouseLeave={e => (e.currentTarget.style.background = '#222')}
          onClick={onNewKanban}
        >
          Agent Board
        </button>
        <button
          style={{ width: '100%', padding: '6px 0', borderRadius: 6, border: '1px solid #2d2d2d', background: '#222', color: '#666', fontSize: 12, cursor: 'pointer', fontFamily: 'monospace' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#2a2a2a')}
          onMouseLeave={e => (e.currentTarget.style.background = '#222')}
          onClick={onNewBrowser}
        >
          Browser
        </button>
      </div>

      {/* Resize handle */}
      <div
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 3, cursor: 'col-resize' }}
        onMouseDown={e => { resizing.current = true; startX.current = e.clientX; startWidth.current = width; e.preventDefault() }}
        onMouseEnter={e => (e.currentTarget.style.background = '#4a9eff44')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      />

      {ctx && (
        <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems()} onClose={() => setCtx(null)} />
      )}
    </div>
  )
}
