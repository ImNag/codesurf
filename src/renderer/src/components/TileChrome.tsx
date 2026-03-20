import React, { useState, useRef, useEffect } from 'react'
import type { TileState } from '../../../shared/types'

// --- Drawer data types ---

interface TaskItem {
  id: string
  title: string
  status: 'pending' | 'in-progress' | 'done' | 'error'
  detail?: string
  timestamp: number
}

interface ToolItem {
  id: string
  name: string
  status: 'running' | 'done' | 'error'
  input?: string
  output?: string
  elapsed?: number
  timestamp: number
}

interface FileItem {
  id: string
  path: string
  action: 'read' | 'write' | 'create' | 'delete' | 'edit'
  timestamp: number
}

interface NoteItem {
  id: string
  content: string
  source?: string
  timestamp: number
}

type DrawerTab = 'tasks' | 'tools' | 'files' | 'notes'

interface DrawerData {
  tasks: TaskItem[]
  tools: ToolItem[]
  files: FileItem[]
  notes: NoteItem[]
}

// --- TileChrome props ---

interface Props {
  tile: TileState
  onClose: () => void
  onTitlebarMouseDown: (e: React.MouseEvent) => void
  onResizeMouseDown: (e: React.MouseEvent, dir: 'e' | 's' | 'se' | 'w' | 'n' | 'nw' | 'ne' | 'sw') => void
  onContextMenu?: (e: React.MouseEvent) => void
  onExpandChange?: (expanded: boolean) => void
  children: React.ReactNode
  isSelected?: boolean
  forceExpanded?: boolean
  busChannel?: string
  busUnreadCount?: number
  onBusPopupToggle?: () => void
  showBusPopup?: boolean
  busEvents?: Array<{
    id: string
    type: string
    timestamp: number
    source: string
    payload: Record<string, unknown>
  }>
}

const DRAWER_WIDTH = 260
const DRAWER_TYPES = new Set(['terminal', 'chat'])

const TYPE_LABELS: Record<string, string> = {
  terminal: 'Terminal', note: 'Note', code: 'Code', image: 'Image', kanban: 'Board', browser: 'Browser', chat: 'Chat'
}

export function fileLabel(tile: TileState): string {
  if (!tile.filePath) return TYPE_LABELS[tile.type] ?? tile.type
  return tile.filePath.replace(/\\/g, '/').split('/').pop() || tile.filePath
}

function ResizeHandle({ dir, onMouseDown }: {
  dir: 'e' | 's' | 'se' | 'w' | 'n' | 'nw' | 'ne' | 'sw'
  onMouseDown: (e: React.MouseEvent) => void
}): JSX.Element {
  const S = 8
  const style: React.CSSProperties = { position: 'absolute', zIndex: 10 }
  if (dir === 'e')  Object.assign(style, { right: 0, top: S, bottom: S, width: S, cursor: 'col-resize' })
  if (dir === 'w')  Object.assign(style, { left: 0, top: S, bottom: S, width: S, cursor: 'col-resize' })
  if (dir === 's')  Object.assign(style, { bottom: 0, left: S, right: S, height: S, cursor: 'row-resize' })
  if (dir === 'n')  Object.assign(style, { top: 0, left: S, right: S, height: S, cursor: 'row-resize' })
  if (dir === 'se') Object.assign(style, { right: 0, bottom: 0, width: S, height: S, cursor: 'se-resize' })
  if (dir === 'sw') Object.assign(style, { left: 0, bottom: 0, width: S, height: S, cursor: 'sw-resize' })
  if (dir === 'ne') Object.assign(style, { right: 0, top: 0, width: S, height: S, cursor: 'ne-resize' })
  if (dir === 'nw') Object.assign(style, { left: 0, top: 0, width: S, height: S, cursor: 'nw-resize' })
  return <div style={style} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onMouseDown(e) }} />
}

// ─── Tab icons (12x12 SVGs) ──────────────────────────────────────────────────

function TabIcon({ tab }: { tab: DrawerTab }): JSX.Element {
  if (tab === 'tasks') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="1.5" width="3" height="3" rx="0.6" stroke="currentColor" strokeWidth="1" />
      <rect x="1" y="7.5" width="3" height="3" rx="0.6" stroke="currentColor" strokeWidth="1" />
      <path d="M6 3h5M6 9h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
  if (tab === 'tools') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M7.5 2.5l2 2-5 5-2.5.5.5-2.5 5-5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M6.5 3.5l2 2" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
  if (tab === 'files') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 1.5h4l2.5 2.5V10.5H3z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M7 1.5V4h2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  // notes
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <path d="M3.5 4h5M3.5 6h5M3.5 8h3" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  )
}

// ─── Tab labels ──────────────────────────────────────────────────────────────

const TAB_LABELS: Record<DrawerTab, string> = {
  tasks: 'Tasks', tools: 'Tools', files: 'Files', notes: 'Notes'
}

const ALL_TABS: DrawerTab[] = ['tasks', 'tools', 'files', 'notes']

// ─── Status icons ────────────────────────────────────────────────────────────

function TaskStatusIcon({ status }: { status: TaskItem['status'] }): JSX.Element {
  if (status === 'done') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="#3fb950" strokeWidth="1.2" />
      <path d="M3.5 6l2 2 3-3.5" stroke="#3fb950" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  if (status === 'error') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="#e54d2e" strokeWidth="1.2" />
      <path d="M4 4l4 4M8 4l-4 4" stroke="#e54d2e" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
  if (status === 'in-progress') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="#4a9eff" strokeWidth="1.2" />
      <path d="M6 3v3.5l2.5 1.5" stroke="#4a9eff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="#555" strokeWidth="1.2" />
    </svg>
  )
}

function ToolStatusIcon({ status }: { status: ToolItem['status'] }): JSX.Element {
  if (status === 'done') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="#3fb950" strokeWidth="1.2" />
      <path d="M3.5 6l2 2 3-3.5" stroke="#3fb950" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
  if (status === 'error') return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="#e54d2e" strokeWidth="1.2" />
      <path d="M4 4l4 4M8 4l-4 4" stroke="#e54d2e" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
  // running - pulsing dot
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="#4a9eff" strokeWidth="1.2" />
      <circle cx="6" cy="6" r="2" fill="#4a9eff" opacity="0.6" />
    </svg>
  )
}

const FILE_ACTION_COLORS: Record<FileItem['action'], string> = {
  read: '#888', write: '#e2c08d', create: '#73c991', delete: '#f44747', edit: '#4a9eff'
}

const FILE_ACTION_LABELS: Record<FileItem['action'], string> = {
  read: 'R', write: 'W', create: '+', delete: 'D', edit: 'E'
}

// ─── Drawer tab content panels ───────────────────────────────────────────────

function TasksPanel({ tasks }: { tasks: TaskItem[] }): JSX.Element {
  const pending = tasks.filter(t => t.status !== 'done')
  const done = tasks.filter(t => t.status === 'done')
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
      {tasks.length === 0 ? (
        <EmptyState text="No tasks yet" />
      ) : (
        <>
          {pending.map(t => (
            <div key={t.id} style={{ padding: '5px 12px', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <div style={{ marginTop: 1, flexShrink: 0 }}><TaskStatusIcon status={t.status} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                {t.detail && <div style={{ fontSize: 10, color: '#444', marginTop: 1 }}>{t.detail}</div>}
              </div>
            </div>
          ))}
          {done.length > 0 && pending.length > 0 && <Divider />}
          {done.map(t => (
            <div key={t.id} style={{ padding: '5px 12px', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <div style={{ marginTop: 1, flexShrink: 0 }}><TaskStatusIcon status={t.status} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#555', textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function ToolsPanel({ tools }: { tools: ToolItem[] }): JSX.Element {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
      {tools.length === 0 ? (
        <EmptyState text="No tool calls yet" />
      ) : (
        tools.slice().reverse().map(t => (
          <div key={t.id} style={{ padding: '5px 12px', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <div style={{ marginTop: 1, flexShrink: 0 }}><ToolStatusIcon status={t.status} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#bbb', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
              {t.input && <div style={{ fontSize: 10, color: '#555', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.input}</div>}
              {t.elapsed != null && t.status === 'done' && (
                <div style={{ fontSize: 9, color: '#444', marginTop: 1 }}>{(t.elapsed / 1000).toFixed(1)}s</div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function FilesPanel({ files }: { files: FileItem[] }): JSX.Element {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
      {files.length === 0 ? (
        <EmptyState text="No file activity yet" />
      ) : (
        files.slice().reverse().map(f => (
          <div key={f.id} style={{ padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, width: 14, textAlign: 'center',
              color: FILE_ACTION_COLORS[f.action],
            }}>
              {FILE_ACTION_LABELS[f.action]}
            </span>
            <span style={{
              fontSize: 11, color: '#aaa', flex: 1, minWidth: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              direction: 'rtl', textAlign: 'left',
            }}>
              {f.path.split('/').pop()}
            </span>
            <span style={{ fontSize: 9, color: '#333', flexShrink: 0 }}>
              {new Date(f.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))
      )}
    </div>
  )
}

function NotesPanel({ notes }: { notes: NoteItem[] }): JSX.Element {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
      {notes.length === 0 ? (
        <EmptyState text="No notes yet" />
      ) : (
        notes.slice().reverse().map(n => (
          <div key={n.id} style={{ padding: '5px 12px', borderBottom: '1px solid #1a1a1a' }}>
            <div style={{ fontSize: 11, color: '#bbb', lineHeight: 1.4 }}>{n.content}</div>
            <div style={{ fontSize: 9, color: '#444', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
              {n.source && <span>{n.source}</span>}
              <span>{new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }): JSX.Element {
  return <div style={{ padding: '24px 12px', textAlign: 'center', color: '#444', fontSize: 11 }}>{text}</div>
}

function Divider(): JSX.Element {
  return <div style={{ height: 1, background: '#1a1a1a', margin: '4px 12px' }} />
}

// ─── Tabbed drawer container ─────────────────────────────────────────────────

function DrawerPanel({ data, activeTab, onTabChange }: {
  data: DrawerData
  activeTab: DrawerTab
  onTabChange: (tab: DrawerTab) => void
}): JSX.Element {
  const counts: Record<DrawerTab, number> = {
    tasks: data.tasks.filter(t => t.status !== 'done').length,
    tools: data.tools.filter(t => t.status === 'running').length,
    files: data.files.length,
    notes: data.notes.length,
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Tab bar — same style as old header */}
      <div style={{
        height: 32, flexShrink: 0,
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid #222',
        padding: '0 4px',
        gap: 0,
      }}>
        {ALL_TABS.map(tab => {
          const active = tab === activeTab
          const count = counts[tab]
          return (
            <TabButton
              key={tab}
              tab={tab}
              active={active}
              count={count}
              onClick={() => onTabChange(tab)}
            />
          )
        })}
      </div>

      {/* Active panel */}
      {activeTab === 'tasks' && <TasksPanel tasks={data.tasks} />}
      {activeTab === 'tools' && <ToolsPanel tools={data.tools} />}
      {activeTab === 'files' && <FilesPanel files={data.files} />}
      {activeTab === 'notes' && <NotesPanel notes={data.notes} />}
    </div>
  )
}

function TabButton({ tab, active, count, onClick }: {
  tab: DrawerTab; active: boolean; count: number; onClick: () => void
}): JSX.Element {
  const [h, setH] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
        height: 28,
        background: active ? 'rgba(255,255,255,0.05)' : (h ? 'rgba(255,255,255,0.02)' : 'transparent'),
        border: 'none',
        borderBottom: active ? '1.5px solid #4a9eff' : '1.5px solid transparent',
        cursor: 'pointer',
        color: active ? '#ccc' : (h ? '#888' : '#555'),
        fontSize: 10, fontWeight: active ? 600 : 400,
        padding: '0 4px',
        transition: 'color 0.1s, background 0.1s',
      }}
    >
      <TabIcon tab={tab} />
      <span>{TAB_LABELS[tab]}</span>
      {count > 0 && (
        <span style={{
          fontSize: 8, fontWeight: 700,
          color: active ? '#4a9eff' : '#555',
          minWidth: 10, textAlign: 'center',
        }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

// ─── Event processing helpers ────────────────────────────────────────────────

function processEvent(evt: { type: string; payload: Record<string, unknown>; id: string; timestamp: number }, setData: React.Dispatch<React.SetStateAction<DrawerData>>): void {
  const p = evt.payload as any

  if (evt.type === 'task') {
    if (p?.action === 'create' || (!p?.action && p?.title)) {
      setData(prev => {
        if (prev.tasks.some(t => t.id === (p.task_id ?? p.id))) return prev
        return { ...prev, tasks: [...prev.tasks, {
          id: p.task_id ?? p.id ?? evt.id,
          title: p.title ?? 'Untitled task',
          status: p.status ?? 'pending',
          detail: p.detail,
          timestamp: evt.timestamp,
        }]}
      })
    } else if (p?.action === 'update' && p?.task_id) {
      setData(prev => ({ ...prev, tasks: prev.tasks.map(t =>
        t.id === p.task_id
          ? { ...t, status: p.status ?? t.status, title: p.title ?? t.title, detail: p.detail ?? t.detail }
          : t
      )}))
    }
  }

  if (evt.type === 'tool_start' || evt.type === 'tool') {
    setData(prev => {
      const toolId = p?.tool_id ?? p?.id ?? evt.id
      if (evt.type === 'tool_start') {
        if (prev.tools.some(t => t.id === toolId)) return prev
        return { ...prev, tools: [...prev.tools, {
          id: toolId,
          name: p?.name ?? p?.tool ?? 'Unknown tool',
          status: 'running',
          input: typeof p?.input === 'string' ? p.input.slice(0, 120) : undefined,
          timestamp: evt.timestamp,
        }]}
      }
      // tool complete/update
      return { ...prev, tools: prev.tools.map(t =>
        t.id === toolId
          ? { ...t, status: p?.error ? 'error' : 'done', output: p?.output?.toString()?.slice(0, 120), elapsed: p?.elapsed }
          : t
      )}
    })
  }

  if (evt.type === 'file' || evt.type === 'file_activity') {
    setData(prev => {
      const fileId = p?.file_id ?? evt.id
      if (prev.files.some(f => f.id === fileId)) return prev
      return { ...prev, files: [...prev.files, {
        id: fileId,
        path: p?.path ?? p?.file ?? 'unknown',
        action: (p?.action as FileItem['action']) ?? 'read',
        timestamp: evt.timestamp,
      }]}
    })
  }

  if (evt.type === 'note' || evt.type === 'notification' || evt.type === 'progress') {
    setData(prev => {
      if (prev.notes.some(n => n.id === evt.id)) return prev
      return { ...prev, notes: [...prev.notes, {
        id: evt.id,
        content: p?.message ?? p?.text ?? p?.title ?? p?.status ?? JSON.stringify(p).slice(0, 200),
        source: p?.source ?? evt.type,
        timestamp: evt.timestamp,
      }]}
    })
  }
}

// ─── Main TileChrome ─────────────────────────────────────────────────────────

export function TileChrome({
  tile, onClose, onTitlebarMouseDown, onResizeMouseDown, onContextMenu,
  onExpandChange, children, isSelected, forceExpanded,
  busUnreadCount, onBusPopupToggle, showBusPopup, busEvents
}: Props): JSX.Element {
  const [localExpanded, setLocalExpanded] = useState(false)
  const expanded = forceExpanded ?? localExpanded
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<DrawerTab>('tasks')
  const [data, setData] = useState<DrawerData>({ tasks: [], tools: [], files: [], notes: [] })
  const hasDrawer = DRAWER_TYPES.has(tile.type)

  const toggle = () => {
    const next = !expanded
    setLocalExpanded(next)
    onExpandChange?.(next)
  }

  // Listen for all event types on this tile's bus channel
  useEffect(() => {
    if (!hasDrawer) return
    const channel = `tile:${tile.id}`
    const unsub = window.electron?.bus?.subscribe(channel, (event: any) => {
      if (!event?.type) return
      processEvent(event, setData)
    })
    return () => { unsub?.then?.(fn => fn?.()) ?? unsub?.() }
  }, [tile.id, hasDrawer])

  // Also extract from busEvents prop
  useEffect(() => {
    if (!busEvents || !hasDrawer) return
    for (const evt of busEvents) {
      processEvent(evt as any, setData)
    }
  }, [busEvents, hasDrawer])

  // Native mousedown listener on the titlebar
  const titlebarRef = useRef<HTMLDivElement>(null)
  const mouseDownRef = useRef(onTitlebarMouseDown)
  useEffect(() => { mouseDownRef.current = onTitlebarMouseDown })

  useEffect(() => {
    const el = titlebarRef.current
    if (!el) return
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-no-drag]')) return
      mouseDownRef.current(e as unknown as React.MouseEvent)
    }
    el.addEventListener('mousedown', handler)
    return () => el.removeEventListener('mousedown', handler)
  }, [])

  const pendingTasks = data.tasks.filter(t => t.status !== 'done').length
  const totalActivity = pendingTasks + data.tools.filter(t => t.status === 'running').length

  return (
    <div
      data-tile-chrome="true"
      className="absolute"
      style={{
        left: tile.x, top: tile.y,
        width: tile.width, height: tile.height,
        zIndex: tile.zIndex,
        visibility: forceExpanded ? 'hidden' : 'visible',
        pointerEvents: forceExpanded ? 'none' : 'all',
      }}
      onDoubleClick={e => e.stopPropagation()}
    >
      {/* Drawer panel — sits behind the tile, slides right */}
      {hasDrawer && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: tile.width - 12,
          width: DRAWER_WIDTH + 12,
          height: '100%',
          background: '#141414',
          borderRadius: 8,
          border: '1px solid #252525',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          zIndex: -1,
          transform: drawerOpen ? 'translateX(0)' : `translateX(-${DRAWER_WIDTH}px)`,
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
          paddingLeft: 12,
        }}>
          <DrawerPanel data={data} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      )}

      {/* Main tile panel */}
      <div
        className="flex flex-col"
        style={{
          width: '100%', height: '100%',
          borderRadius: 8, overflow: 'hidden',
          border: isSelected ? '0.5px solid #4a9eff' : '1px solid #3a3a3a',
          boxShadow: isSelected
            ? '0 8px 32px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(74,158,255,0.3)'
            : '0 4px 20px rgba(0,0,0,0.4)',
          background: '#1e1e1e',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Titlebar */}
        <div
          ref={titlebarRef}
          style={{
            height: 32, background: '#252525', borderBottom: '1px solid #333',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 8px 0 0', userSelect: 'none', flexShrink: 0, cursor: 'move'
          }}
          onDoubleClick={e => { e.stopPropagation(); toggle() }}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e) }}
        >
          {/* Drag handle */}
          <div
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('application/tile-id', tile.id)
              e.dataTransfer.setData('application/tile-type', tile.type)
              e.dataTransfer.setData('application/tile-label', fileLabel(tile))
              e.dataTransfer.effectAllowed = 'link'
              const ghost = document.createElement('div')
              ghost.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px'
              document.body.appendChild(ghost)
              e.dataTransfer.setDragImage(ghost, 0, 0)
              requestAnimationFrame(() => document.body.removeChild(ghost))
              e.stopPropagation()
            }}
            style={{
              width: 28, height: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'grab', flexShrink: 0, color: '#666', fontSize: 11
            }}
          >
            ::
          </div>

          {tile.type === 'browser' ? (
            <div
              id={`tile-header-slot-${tile.id}`}
              style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center' }}
            />
          ) : (
            <span style={{
              flex: 1, fontSize: 12, fontWeight: 500, color: '#cccccc',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              {fileLabel(tile)}
            </span>
          )}

          {/* Drawer toggle — only for terminal/chat */}
          {hasDrawer && (
            <button
              data-no-drag=""
              style={{
                width: 24, height: 24, borderRadius: 4, background: 'transparent',
                border: 'none', cursor: 'pointer', flexShrink: 0,
                color: drawerOpen ? '#4a9eff' : '#666',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}
              onClick={e => { e.stopPropagation(); setDrawerOpen(p => !p) }}
              onMouseDown={e => e.stopPropagation()}
              onMouseEnter={e => { if (!drawerOpen) e.currentTarget.style.color = '#aaa' }}
              onMouseLeave={e => { if (!drawerOpen) e.currentTarget.style.color = '#666' }}
              title={drawerOpen ? 'Hide panel' : 'Show panel'}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3.5h8M3 7h8M3 10.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {totalActivity > 0 && !drawerOpen && (
                <span style={{
                  position: 'absolute', top: 1, right: 1,
                  minWidth: 12, height: 12, borderRadius: 6,
                  background: '#4a9eff', color: '#fff',
                  fontSize: 8, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: '0 2px',
                }}>
                  {totalActivity > 9 ? '9+' : totalActivity}
                </span>
              )}
            </button>
          )}

          {/* Expand/collapse */}
          <button
            data-no-drag=""
            style={{
              width: 24, height: 24, borderRadius: 4, background: 'transparent',
              border: 'none', cursor: 'pointer', flexShrink: 0,
              color: '#666', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
            onClick={e => { e.stopPropagation(); toggle() }}
            onMouseDown={e => e.stopPropagation()}
            onMouseEnter={e => (e.currentTarget.style.color = '#aaa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#666')}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              {expanded ? (
                <path d="M3 5.5h8M3 8.5h8M5.5 3v8M8.5 3v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              ) : (
                <path d="M2 2h4v4H2zM8 2h4v4H8zM2 8h4v4H2zM8 8h4v4H8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
              )}
            </svg>
          </button>

          {/* Bus event indicator */}
          {(busUnreadCount ?? 0) > 0 && (
            <button
              data-no-drag=""
              onClick={e => { e.stopPropagation(); onBusPopupToggle?.() }}
              onMouseDown={e => e.stopPropagation()}
              style={{
                minWidth: 18, height: 18, borderRadius: 9,
                background: '#4a9eff',
                border: 'none', cursor: 'pointer',
                color: '#fff', fontSize: 10, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 5px',
                marginLeft: 4,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#5ab0ff')}
              onMouseLeave={e => (e.currentTarget.style.background = '#4a9eff')}
              title={`${busUnreadCount} new event${busUnreadCount !== 1 ? 's' : ''}`}
            >
              {busUnreadCount! > 99 ? '99+' : busUnreadCount}
            </button>
          )}

          <button
            data-no-drag=""
            style={{
              width: 24, height: 24, borderRadius: 4, background: 'transparent',
              border: 'none', cursor: 'pointer', flexShrink: 0,
              color: '#666', display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginLeft: 4
            }}
            onClick={e => { e.stopPropagation(); onClose() }}
            onMouseDown={e => e.stopPropagation()}
            onMouseEnter={e => (e.currentTarget.style.color = '#ff5f56')}
            onMouseLeave={e => (e.currentTarget.style.color = '#666')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div
          style={{ flex: 1, overflow: 'hidden', minHeight: 0, position: 'relative', userSelect: 'text', WebkitUserSelect: 'text' } as React.CSSProperties}
          onDragOver={e => { if (tile.type !== 'kanban') e.stopPropagation() }}
          onDrop={e => { if (tile.type !== 'kanban') e.stopPropagation() }}
        >
          {forceExpanded ? null : children}
        </div>

        {(['n','s','e','w','ne','nw','se','sw'] as const).map(dir => (
          <ResizeHandle key={dir} dir={dir} onMouseDown={e => onResizeMouseDown(e, dir)} />
        ))}

        {/* Bus event popup */}
        {showBusPopup && busEvents && (
          <div
            data-no-drag=""
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: 34, right: 4,
              width: 300, maxHeight: 280,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              zIndex: 20,
              overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{
              padding: '6px 10px',
              borderBottom: '1px solid #2d2d2d',
              fontSize: 11, fontWeight: 600, color: '#888',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>Events</span>
              <button
                onClick={e => { e.stopPropagation(); onBusPopupToggle?.() }}
                style={{
                  background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 12
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
              {busEvents.length === 0 ? (
                <div style={{ padding: '12px', textAlign: 'center', color: '#555', fontSize: 11 }}>
                  No events yet
                </div>
              ) : (
                busEvents.slice(-30).reverse().map(evt => (
                  <div key={evt.id} style={{
                    padding: '4px 10px',
                    borderBottom: '1px solid #1f1f1f',
                    fontSize: 11,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{
                        color: evt.type === 'notification' ? '#ffb432' :
                               evt.type === 'progress' ? '#4a9eff' :
                               evt.type === 'task' ? '#66bb6a' :
                               '#888',
                        fontWeight: 500,
                      }}>
                        {evt.type}
                      </span>
                      <span style={{ color: '#555', fontSize: 10 }}>
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div style={{ color: '#aaa' }}>
                      {(evt.payload as any).message ?? (evt.payload as any).status ?? (evt.payload as any).title ?? JSON.stringify(evt.payload).slice(0, 80)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
