#!/usr/bin/env node

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { homedir } from 'node:os'
import { findSessionEntryById, getExternalSessionChatState, invalidateExternalSessionCache, listExternalSessionEntries } from './session-index.mjs'
import { createChatJobManager } from './chat-jobs.mjs'

const HOME = process.env.CODESURF_HOME || join(homedir(), '.codesurf')
const PID_PATH = process.env.CODESURF_DAEMON_PID_PATH || join(HOME, 'daemon', 'pid.json')
const PROTOCOL_VERSION = 1
const APP_VERSION = String(process.env.CODESURF_APP_VERSION ?? '').trim() || null
const STARTED_AT = new Date().toISOString()
const LEGACY_CONFIG_PATH = join(HOME, 'config.json')
const WORKSPACES_FILE = join(HOME, 'workspaces', 'workspaces.json')
const PROJECTS_FILE = join(HOME, 'projects', 'projects.json')
const HOSTS_FILE = join(HOME, 'hosts', 'hosts.json')
const SETTINGS_FILE = join(HOME, 'settings.json')
const AUTH_TOKEN = randomUUID()
const SESSION_TEXT_LIMIT = 120
const chatJobs = createChatJobManager({ homeDir: HOME })

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true })
}

function normalizePath(value) {
  return String(value ?? '').trim().replace(/\/+$/, '')
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function atomicWriteJson(filePath, value) {
  ensureDir(dirname(filePath))
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return fallback
  }
}

function emptyLegacyConfig() {
  return {
    version: 2,
    projects: [],
    workspaces: [],
    activeWorkspaceId: null,
    settings: {},
  }
}

function normalizeProject(project) {
  const id = String(project?.id ?? '').trim()
  const path = normalizePath(project?.path)
  if (!id || !path) return null
  return {
    id,
    name: String(project?.name ?? basename(path) ?? 'Project').trim() || basename(path) || 'Project',
    path,
  }
}

function builtinExecutionHosts() {
  return [
    {
      id: 'local-runtime',
      type: 'runtime',
      label: 'This app',
      enabled: true,
      url: null,
      authToken: null,
    },
    {
      id: 'local-daemon',
      type: 'local-daemon',
      label: 'Local daemon',
      enabled: true,
      url: 'http://127.0.0.1',
      authToken: null,
    },
  ]
}

function normalizeExecutionHost(host) {
  const id = String(host?.id ?? '').trim()
  const type = String(host?.type ?? '').trim()
  if (!id || !type) return null
  if (!['runtime', 'local-daemon', 'remote-daemon'].includes(type)) return null
  return {
    id,
    type,
    label: String(host?.label ?? id).trim() || id,
    enabled: host?.enabled !== false,
    url: typeof host?.url === 'string' && host.url.trim().length > 0 ? host.url.trim() : null,
    authToken: typeof host?.authToken === 'string' && host.authToken.trim().length > 0 ? host.authToken.trim() : null,
  }
}

function mergeExecutionHosts(records) {
  const merged = new Map()
  for (const builtin of builtinExecutionHosts()) {
    merged.set(builtin.id, builtin)
  }
  for (const record of Array.isArray(records) ? records : []) {
    const normalized = normalizeExecutionHost(record)
    if (!normalized) continue
    const base = merged.get(normalized.id)
    merged.set(normalized.id, {
      ...(base ?? {}),
      ...normalized,
    })
  }
  return [...merged.values()].sort((a, b) => {
    const orderA = a.id === 'local-runtime' ? 0 : (a.id === 'local-daemon' ? 1 : 2)
    const orderB = b.id === 'local-runtime' ? 0 : (b.id === 'local-daemon' ? 1 : 2)
    if (orderA !== orderB) return orderA - orderB
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })
}

function normalizeWorkspaceRecord(workspace) {
  const id = String(workspace?.id ?? '').trim()
  if (!id) return null
  const projectIds = Array.from(new Set(
    Array.isArray(workspace?.projectIds)
      ? workspace.projectIds.map(projectId => String(projectId ?? '').trim()).filter(Boolean)
      : [],
  ))
  const explicitPrimary = typeof workspace?.primaryProjectId === 'string'
    ? workspace.primaryProjectId.trim()
    : null
  return {
    id,
    name: String(workspace?.name ?? '').trim() || 'Workspace',
    projectIds,
    primaryProjectId: explicitPrimary && projectIds.includes(explicitPrimary)
      ? explicitPrimary
      : (projectIds[0] ?? null),
  }
}

function ensureProjectForPath(state, folderPath) {
  const normalizedPath = normalizePath(folderPath)
  const existing = state.projects.find(project => normalizePath(project.path) === normalizedPath)
  if (existing) return { state, project: existing }
  const project = {
    id: makeId('project'),
    name: basename(normalizedPath) || 'Project',
    path: normalizedPath,
  }
  return {
    state: { ...state, projects: [...state.projects, project] },
    project,
  }
}

function migrateLegacyConfig(raw) {
  const config = emptyLegacyConfig()
  config.settings = typeof raw?.settings === 'object' && raw.settings ? raw.settings : {}
  const legacyWorkspaces = Array.isArray(raw?.workspaces) ? raw.workspaces : []
  for (const legacyWorkspace of legacyWorkspaces) {
    const id = String(legacyWorkspace?.id ?? '').trim() || makeId('ws')
    const name = String(legacyWorkspace?.name ?? '').trim() || 'Workspace'
    const candidatePaths = [
      ...(Array.isArray(legacyWorkspace?.projectPaths) ? legacyWorkspace.projectPaths : []),
      ...(typeof legacyWorkspace?.path === 'string' ? [legacyWorkspace.path] : []),
    ]
    let projectIds = []
    let next = config
    for (const candidatePath of candidatePaths) {
      const normalized = normalizePath(candidatePath)
      if (!normalized) continue
      const ensured = ensureProjectForPath(next, normalized)
      next = ensured.state
      if (!projectIds.includes(ensured.project.id)) projectIds.push(ensured.project.id)
    }
    config.projects = next.projects
    config.workspaces.push({
      id,
      name,
      projectIds,
      primaryProjectId: projectIds[0] ?? null,
    })
  }
  const activeWorkspaceIndex = Number.isInteger(raw?.activeWorkspaceIndex)
    ? Math.max(0, Number(raw.activeWorkspaceIndex))
    : 0
  config.activeWorkspaceId = config.workspaces[activeWorkspaceIndex]?.id ?? config.workspaces[0]?.id ?? null
  return config
}

function loadLegacyConfig() {
  const parsed = readJsonFile(LEGACY_CONFIG_PATH, emptyLegacyConfig())
  if (parsed?.version === 2 && Array.isArray(parsed?.projects) && Array.isArray(parsed?.workspaces)) {
    return {
      version: 2,
      projects: parsed.projects.map(normalizeProject).filter(Boolean),
      workspaces: parsed.workspaces.map(normalizeWorkspaceRecord).filter(Boolean),
      activeWorkspaceId: typeof parsed.activeWorkspaceId === 'string' ? parsed.activeWorkspaceId : null,
      settings: typeof parsed.settings === 'object' && parsed.settings ? parsed.settings : {},
    }
  }
  return migrateLegacyConfig(parsed)
}

function ensureStateFiles() {
  ensureDir(join(HOME, 'daemon'))
  ensureDir(join(HOME, 'workspaces'))
  ensureDir(join(HOME, 'projects'))
  ensureDir(join(HOME, 'hosts'))

  if (!existsSync(WORKSPACES_FILE) || !existsSync(PROJECTS_FILE) || !existsSync(SETTINGS_FILE) || !existsSync(HOSTS_FILE)) {
    const legacy = loadLegacyConfig()
    if (!existsSync(WORKSPACES_FILE)) {
      atomicWriteJson(WORKSPACES_FILE, {
        version: 1,
        activeWorkspaceId: legacy.activeWorkspaceId,
        workspaces: legacy.workspaces,
      })
    }
    if (!existsSync(PROJECTS_FILE)) {
      atomicWriteJson(PROJECTS_FILE, {
        version: 1,
        projects: legacy.projects,
      })
    }
    if (!existsSync(SETTINGS_FILE)) {
      atomicWriteJson(SETTINGS_FILE, {
        version: 1,
        settings: legacy.settings ?? {},
      })
    }
    if (!existsSync(HOSTS_FILE)) {
      atomicWriteJson(HOSTS_FILE, {
        version: 1,
        hosts: builtinExecutionHosts(),
      })
    }
  }
}

function readWorkspaceState() {
  ensureStateFiles()
  const workspaceDoc = readJsonFile(WORKSPACES_FILE, { version: 1, activeWorkspaceId: null, workspaces: [] })
  const projectDoc = readJsonFile(PROJECTS_FILE, { version: 1, projects: [] })
  const hostsDoc = readJsonFile(HOSTS_FILE, { version: 1, hosts: builtinExecutionHosts() })
  const settingsDoc = readJsonFile(SETTINGS_FILE, { version: 1, settings: {} })
  const projects = Array.isArray(projectDoc.projects) ? projectDoc.projects.map(normalizeProject).filter(Boolean) : []
  const projectIds = new Set(projects.map(project => project.id))
  const workspaces = Array.isArray(workspaceDoc.workspaces)
    ? workspaceDoc.workspaces
      .map(normalizeWorkspaceRecord)
      .filter(Boolean)
      .map(workspace => ({
        ...workspace,
        projectIds: workspace.projectIds.filter(projectId => projectIds.has(projectId)),
        primaryProjectId: workspace.primaryProjectId && projectIds.has(workspace.primaryProjectId)
          ? workspace.primaryProjectId
          : (workspace.projectIds.find(projectId => projectIds.has(projectId)) ?? null),
      }))
    : []
  return {
    projects,
    hosts: mergeExecutionHosts(hostsDoc.hosts),
    workspaces,
    activeWorkspaceId: typeof workspaceDoc.activeWorkspaceId === 'string'
      ? workspaceDoc.activeWorkspaceId
      : (workspaces[0]?.id ?? null),
    settings: typeof settingsDoc.settings === 'object' && settingsDoc.settings ? settingsDoc.settings : {},
  }
}

function writeWorkspaceState(state) {
  atomicWriteJson(WORKSPACES_FILE, {
    version: 1,
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces,
  })
  atomicWriteJson(PROJECTS_FILE, {
    version: 1,
    projects: state.projects,
  })
}

function writeHosts(hosts) {
  atomicWriteJson(HOSTS_FILE, {
    version: 1,
    hosts: mergeExecutionHosts(hosts),
  })
}

function writeSettings(settings) {
  atomicWriteJson(SETTINGS_FILE, {
    version: 1,
    settings,
  })
}

function materializeWorkspace(workspace, projects) {
  const byId = new Map(projects.map(project => [project.id, project]))
  const entries = workspace.projectIds.map(id => byId.get(id)).filter(Boolean)
  const primary = workspace.primaryProjectId ? (byId.get(workspace.primaryProjectId) ?? entries[0] ?? null) : (entries[0] ?? null)
  return {
    id: workspace.id,
    name: workspace.name,
    path: primary?.path ?? '',
    projectPaths: entries.map(project => project.path),
  }
}

function assertSafeId(id) {
  if (/[\/\\]|\.\./.test(String(id ?? ''))) {
    throw new Error(`Unsafe ID: ${id}`)
  }
}

function workspaceContexDir(workspaceId) {
  assertSafeId(workspaceId)
  return join(HOME, 'workspaces', workspaceId, '.contex')
}

function tileStatePath(workspaceId, tileId) {
  assertSafeId(workspaceId)
  assertSafeId(tileId)
  return join(workspaceContexDir(workspaceId), `tile-state-${tileId}.json`)
}

function tileSessionSummaryPath(workspaceId, tileId) {
  assertSafeId(workspaceId)
  assertSafeId(tileId)
  return join(workspaceContexDir(workspaceId), `tile-session-${tileId}.json`)
}

function truncateSessionText(text, length = SESSION_TEXT_LIMIT) {
  if (!text) return null
  const normalized = String(text).replace(/\s+/g, ' ').trim()
  return normalized.length > length ? normalized.slice(0, length) : normalized
}

function sessionTitleFromText(text, provider) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return `${provider} session`
  return trimmed.split(/\r?\n/, 1)[0].slice(0, 80)
}

function extractTileSessionSummary(tileId, state) {
  if (!state || typeof state !== 'object') return null
  const record = state
  const messages = Array.isArray(record.messages) ? record.messages : null
  if (!messages || messages.length === 0) return null

  let lastMessage = null
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || typeof message !== 'object') continue
    const text = truncateSessionText(typeof message.content === 'string' ? message.content : null)
    if (text) {
      lastMessage = text
      break
    }
  }

  const provider = typeof record.provider === 'string' && record.provider.trim()
    ? record.provider
    : 'claude'
  const model = typeof record.model === 'string' ? record.model : ''
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : null

  return {
    version: 1,
    tileId,
    sessionId,
    provider,
    model,
    messageCount: messages.length,
    lastMessage,
    title: sessionTitleFromText(lastMessage, provider),
    updatedAt: Date.now(),
  }
}

function pathExists(filePath) {
  return existsSync(filePath)
}

function moveFileToDeleted(filePath) {
  const sourceDir = dirname(filePath)
  const deletedDir = join(sourceDir, 'deleted')
  ensureDir(deletedDir)

  const base = basename(filePath)
  let targetPath = join(deletedDir, base)
  if (pathExists(targetPath)) {
    targetPath = join(deletedDir, `${Date.now()}-${base}`)
  }

  renameSync(filePath, targetPath)
  return targetPath
}

function deleteExternalSession(codesurfHome, workspacePath, sessionEntryId) {
  return findSessionEntryById(codesurfHome, workspacePath, sessionEntryId).then(entry => {
    if (!entry?.filePath) return { ok: false, error: 'Session file missing' }
    if (!pathExists(entry.filePath)) return { ok: false, error: 'Session file missing' }

    const deletedPath = moveFileToDeleted(entry.filePath)

    if (entry.source === 'openclaw') {
      const [, agentId, ...keyParts] = sessionEntryId.split(':')
      const sessionKey = keyParts.join(':')
      const indexPath = join(process.env.HOME || '', '.openclaw', 'agents', agentId, 'sessions', 'sessions.json')
      if (agentId && sessionKey && pathExists(indexPath)) {
        try {
          const raw = readFileSync(indexPath, 'utf8')
          const parsed = JSON.parse(raw)
          if (parsed?.[sessionKey] && typeof parsed[sessionKey] === 'object') {
            parsed[sessionKey] = {
              ...parsed[sessionKey],
              deletedAt: Date.now(),
              deletedFile: deletedPath,
              sessionFile: deletedPath,
            }
            atomicWriteJson(indexPath, parsed)
          }
        } catch {
          // ignore index update failures; file move already succeeded
        }
      }
    }

    invalidateExternalSessionCache(workspacePath)
    return { ok: true }
  })
}

function listLocalWorkspaceSessions(workspaceId) {
  const dotDir = workspaceContexDir(workspaceId)
  if (!existsSync(dotDir)) return []

  const entries = []
  for (const name of readDirNames(dotDir)) {
    if (!name.startsWith('tile-state-') || !name.endsWith('.json')) continue

    const filePath = join(dotDir, name)
    const tileId = name.replace('tile-state-', '').replace('.json', '')
    const summaryPath = tileSessionSummaryPath(workspaceId, tileId)

    let summary = readJsonFile(summaryPath, null)
    if (!summary) {
      const state = readJsonFile(filePath, null)
      if (!state) continue
      summary = extractTileSessionSummary(tileId, state)
      if (!summary) continue
      try {
        const stat = statSync(filePath)
        summary.updatedAt = stat.mtimeMs
      } catch {}
      atomicWriteJson(summaryPath, summary)
    }

    entries.push({
      id: `codesurf-tile:${name}`,
      source: 'codesurf',
      scope: 'workspace',
      tileId,
      sessionId: summary.sessionId ?? null,
      provider: summary.provider ?? 'claude',
      model: summary.model ?? '',
      messageCount: Number(summary.messageCount ?? 0),
      lastMessage: summary.lastMessage ?? null,
      updatedAt: Number(summary.updatedAt ?? Date.now()),
      title: summary.title ?? sessionTitleFromText(summary.lastMessage ?? null, summary.provider ?? 'claude'),
      filePath,
      sourceLabel: 'CodeSurf',
      sourceDetail: summary.provider || 'Workspace chat',
      canOpenInChat: true,
      canOpenInApp: false,
      nestingLevel: 0,
    })
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt)
  return entries
}

function getLocalSessionState(workspaceId, sessionEntryId) {
  if (!String(sessionEntryId).startsWith('codesurf-tile:')) return null
  const tileId = String(sessionEntryId).replace('codesurf-tile:tile-state-', '').replace('.json', '')
  return readJsonFile(tileStatePath(workspaceId, tileId), null)
}

function deleteLocalSession(workspaceId, sessionEntryId) {
  if (!String(sessionEntryId).startsWith('codesurf-tile:')) return { ok: false, error: 'Unsupported local session id' }
  const tileId = String(sessionEntryId).replace('codesurf-tile:tile-state-', '').replace('.json', '')
  const filePath = tileStatePath(workspaceId, tileId)
  if (!pathExists(filePath)) return { ok: false, error: 'Session file missing' }

  moveFileToDeleted(filePath)
  rmSync(tileSessionSummaryPath(workspaceId, tileId), { force: true })
  return { ok: true }
}

function readDirNames(dirPath) {
  try {
    return readdirSync(dirPath)
  } catch {
    return []
  }
}

function materializeWorkspaces(state) {
  return state.workspaces.map(workspace => materializeWorkspace(workspace, state.projects))
}

function getActiveWorkspace(state) {
  const match = state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)
  return match ?? state.workspaces[0] ?? null
}

function sortProjects(projects) {
  return [...projects].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    if (nameCompare !== 0) return nameCompare
    return a.path.localeCompare(b.path, undefined, { sensitivity: 'base' })
  })
}

function upsertExecutionHost(currentHosts, input) {
  const normalized = normalizeExecutionHost(input)
  if (!normalized || normalized.id === 'local-runtime' || normalized.id === 'local-daemon') {
    return mergeExecutionHosts(currentHosts)
  }
  const next = mergeExecutionHosts(currentHosts).filter(host => host.id !== normalized.id)
  next.push(normalized)
  return mergeExecutionHosts(next)
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(`${JSON.stringify(payload)}\n`)
}

function readPidInfo() {
  try {
    const parsed = JSON.parse(readFileSync(PID_PATH, 'utf8'))
    if (
      typeof parsed?.pid !== 'number'
      || typeof parsed?.port !== 'number'
      || typeof parsed?.token !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code ?? '') : ''
    return code === 'EPERM'
  }
}

async function healthcheck(info) {
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}/health`, {
      signal: AbortSignal.timeout(2_000),
      headers: {
        Authorization: `Bearer ${info.token}`,
      },
    })
    if (!response.ok) return false
    const payload = await response.json()
    return payload?.ok === true
  } catch {
    return false
  }
}

async function reuseExistingDaemonIfHealthy() {
  const existing = readPidInfo()
  if (!existing || !isProcessAlive(existing.pid)) return false
  return await healthcheck(existing)
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function authorized(req) {
  return req.headers.authorization === `Bearer ${AUTH_TOKEN}`
}

const server = createServer(async (req, res) => {
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'Unauthorized' })
    return
  }

  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const method = req.method || 'GET'

  try {
    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        pid: process.pid,
        startedAt: STARTED_AT,
        protocolVersion: PROTOCOL_VERSION,
        appVersion: APP_VERSION,
      })
      return
    }

    if (method === 'GET' && url.pathname === '/workspace/list') {
      const state = readWorkspaceState()
      sendJson(res, 200, materializeWorkspaces(state))
      return
    }

    if (method === 'GET' && url.pathname === '/workspace/projects') {
      const state = readWorkspaceState()
      sendJson(res, 200, sortProjects(state.projects))
      return
    }

    if (method === 'GET' && url.pathname === '/workspace/active') {
      const state = readWorkspaceState()
      const active = getActiveWorkspace(state)
      sendJson(res, 200, active ? materializeWorkspace(active, state.projects) : null)
      return
    }

    if (method === 'GET' && url.pathname === '/session/local/list') {
      const workspaceId = String(url.searchParams.get('workspaceId') ?? '').trim()
      if (!workspaceId) {
        sendJson(res, 400, { error: 'workspaceId is required' })
        return
      }
      sendJson(res, 200, listLocalWorkspaceSessions(workspaceId))
      return
    }

    if (method === 'POST' && url.pathname === '/chat/job/start') {
      const body = await parseRequestBody(req)
      if (!body?.request || typeof body.request !== 'object') {
        sendJson(res, 400, { error: 'request is required' })
        return
      }
      const job = await chatJobs.startJob(body.request)
      sendJson(res, 200, job)
      return
    }

    if (method === 'GET' && url.pathname === '/chat/job/state') {
      const jobId = String(url.searchParams.get('jobId') ?? '').trim()
      if (!jobId) {
        sendJson(res, 400, { error: 'jobId is required' })
        return
      }
      const state = await chatJobs.getJobState(jobId)
      sendJson(res, state ? 200 : 404, state ?? { error: 'Job not found' })
      return
    }

    if (method === 'GET' && url.pathname === '/chat/job/events') {
      const jobId = String(url.searchParams.get('jobId') ?? '').trim()
      const sinceSequence = Number(url.searchParams.get('since') ?? '0') || 0
      if (!jobId) {
        sendJson(res, 400, { error: 'jobId is required' })
        return
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      })

      const keepOpen = await chatJobs.streamJob(jobId, sinceSequence, res)
      if (!keepOpen) {
        res.end()
      } else {
        req.on('close', () => {
          res.end()
        })
      }
      return
    }

    if (method === 'POST' && url.pathname === '/chat/job/cancel') {
      const body = await parseRequestBody(req)
      const jobId = String(body?.jobId ?? '').trim()
      if (!jobId) {
        sendJson(res, 400, { error: 'jobId is required' })
        return
      }
      sendJson(res, 200, await chatJobs.cancelJob(jobId))
      return
    }

    if (method === 'GET' && url.pathname === '/session/external/list') {
      const workspacePath = String(url.searchParams.get('workspacePath') ?? '').trim() || null
      const force = url.searchParams.get('force') === '1'
      sendJson(res, 200, await listExternalSessionEntries(HOME, workspacePath, { force }))
      return
    }

    if (method === 'GET' && url.pathname === '/session/external/state') {
      const workspacePath = String(url.searchParams.get('workspacePath') ?? '').trim() || null
      const sessionEntryId = String(url.searchParams.get('sessionEntryId') ?? '').trim()
      if (!sessionEntryId) {
        sendJson(res, 400, { error: 'sessionEntryId is required' })
        return
      }
      sendJson(res, 200, await getExternalSessionChatState(HOME, workspacePath, sessionEntryId))
      return
    }

    if (method === 'GET' && url.pathname === '/session/local/state') {
      const workspaceId = String(url.searchParams.get('workspaceId') ?? '').trim()
      const sessionEntryId = String(url.searchParams.get('sessionEntryId') ?? '').trim()
      if (!workspaceId || !sessionEntryId) {
        sendJson(res, 400, { error: 'workspaceId and sessionEntryId are required' })
        return
      }
      sendJson(res, 200, getLocalSessionState(workspaceId, sessionEntryId))
      return
    }

    if (method === 'POST' && url.pathname === '/session/local/delete') {
      const body = await parseRequestBody(req)
      const workspaceId = String(body?.workspaceId ?? '').trim()
      const sessionEntryId = String(body?.sessionEntryId ?? '').trim()
      if (!workspaceId || !sessionEntryId) {
        sendJson(res, 400, { error: 'workspaceId and sessionEntryId are required' })
        return
      }
      sendJson(res, 200, deleteLocalSession(workspaceId, sessionEntryId))
      return
    }

    if (method === 'POST' && url.pathname === '/session/external/invalidate') {
      const body = await parseRequestBody(req)
      const workspacePath = String(body?.workspacePath ?? '').trim() || null
      invalidateExternalSessionCache(workspacePath)
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'POST' && url.pathname === '/session/external/delete') {
      const body = await parseRequestBody(req)
      const workspacePath = String(body?.workspacePath ?? '').trim() || null
      const sessionEntryId = String(body?.sessionEntryId ?? '').trim()
      if (!sessionEntryId) {
        sendJson(res, 400, { error: 'sessionEntryId is required' })
        return
      }
      sendJson(res, 200, await deleteExternalSession(HOME, workspacePath, sessionEntryId))
      return
    }

    if (method === 'POST' && url.pathname === '/workspace/create') {
      const body = await parseRequestBody(req)
      const state = readWorkspaceState()
      const workspace = {
        id: makeId('ws'),
        name: String(body?.name ?? '').trim() || 'Workspace',
        projectIds: [],
        primaryProjectId: null,
      }
      state.workspaces.push(workspace)
      state.activeWorkspaceId = workspace.id
      writeWorkspaceState(state)
      sendJson(res, 200, materializeWorkspace(workspace, state.projects))
      return
    }

    if (method === 'POST' && url.pathname === '/workspace/create-with-path') {
      const body = await parseRequestBody(req)
      let state = readWorkspaceState()
      const normalizedProjectPath = normalizePath(body?.projectPath)
      let projectIds = []
      if (normalizedProjectPath) {
        const ensured = ensureProjectForPath(state, normalizedProjectPath)
        state = ensured.state
        projectIds = [ensured.project.id]
      }
      const workspace = {
        id: makeId('ws'),
        name: String(body?.name ?? '').trim() || 'Workspace',
        projectIds,
        primaryProjectId: projectIds[0] ?? null,
      }
      state.workspaces.push(workspace)
      state.activeWorkspaceId = workspace.id
      writeWorkspaceState(state)
      sendJson(res, 200, materializeWorkspace(workspace, state.projects))
      return
    }

    if (method === 'POST' && url.pathname === '/workspace/create-from-folder') {
      const body = await parseRequestBody(req)
      let state = readWorkspaceState()
      const normalizedFolderPath = normalizePath(body?.folderPath)
      const existingProject = state.projects.find(project => normalizePath(project.path) === normalizedFolderPath) ?? null
      const existingWorkspace = existingProject
        ? (state.workspaces.find(workspace => workspace.projectIds.includes(existingProject.id)) ?? null)
        : null
      if (existingWorkspace) {
        state.activeWorkspaceId = existingWorkspace.id
        writeWorkspaceState(state)
        sendJson(res, 200, materializeWorkspace(existingWorkspace, state.projects))
        return
      }

      const ensured = ensureProjectForPath(state, normalizedFolderPath)
      state = ensured.state
      const workspace = {
        id: makeId('ws'),
        name: basename(normalizedFolderPath) || 'Workspace',
        projectIds: [ensured.project.id],
        primaryProjectId: ensured.project.id,
      }
      state.workspaces.push(workspace)
      state.activeWorkspaceId = workspace.id
      writeWorkspaceState(state)
      sendJson(res, 200, materializeWorkspace(workspace, state.projects))
      return
    }

    if (method === 'POST' && url.pathname === '/workspace/add-project-folder') {
      const body = await parseRequestBody(req)
      let state = readWorkspaceState()
      const index = state.workspaces.findIndex(workspace => workspace.id === body?.workspaceId)
      if (index === -1) {
        sendJson(res, 200, null)
        return
      }
      const ensured = ensureProjectForPath(state, body?.folderPath)
      state = ensured.state
      const current = state.workspaces[index]
      const projectIds = current.projectIds.includes(ensured.project.id)
        ? current.projectIds
        : [...current.projectIds, ensured.project.id]
      state.workspaces[index] = {
        ...current,
        projectIds,
        primaryProjectId: current.primaryProjectId ?? ensured.project.id,
      }
      writeWorkspaceState(state)
      sendJson(res, 200, materializeWorkspace(state.workspaces[index], state.projects))
      return
    }

    if (method === 'POST' && url.pathname === '/workspace/remove-project-folder') {
      const body = await parseRequestBody(req)
      const state = readWorkspaceState()
      const index = state.workspaces.findIndex(workspace => workspace.id === body?.workspaceId)
      if (index === -1) {
        sendJson(res, 200, null)
        return
      }
      const normalizedFolderPath = normalizePath(body?.folderPath)
      const projectToRemove = state.projects.find(project => normalizePath(project.path) === normalizedFolderPath) ?? null
      if (!projectToRemove) {
        sendJson(res, 200, materializeWorkspace(state.workspaces[index], state.projects))
        return
      }
      const current = state.workspaces[index]
      const projectIds = current.projectIds.filter(projectId => projectId !== projectToRemove.id)
      state.workspaces[index] = {
        ...current,
        projectIds,
        primaryProjectId: current.primaryProjectId === projectToRemove.id ? (projectIds[0] ?? null) : current.primaryProjectId,
      }
      const referencedIds = new Set(state.workspaces.flatMap(workspace => workspace.projectIds))
      state.projects = state.projects.filter(project => referencedIds.has(project.id))
      writeWorkspaceState(state)
      sendJson(res, 200, materializeWorkspace(state.workspaces[index], state.projects))
      return
    }

    if (method === 'POST' && url.pathname === '/workspace/set-active') {
      const body = await parseRequestBody(req)
      const state = readWorkspaceState()
      const workspace = state.workspaces.find(item => item.id === body?.id)
      if (!workspace) {
        sendJson(res, 404, { error: 'Workspace not found' })
        return
      }
      state.activeWorkspaceId = workspace.id
      writeWorkspaceState(state)
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'DELETE' && url.pathname.startsWith('/workspace/')) {
      const workspaceId = decodeURIComponent(url.pathname.slice('/workspace/'.length))
      const state = readWorkspaceState()
      state.workspaces = state.workspaces.filter(workspace => workspace.id !== workspaceId)
      if (state.activeWorkspaceId === workspaceId) {
        state.activeWorkspaceId = state.workspaces[0]?.id ?? null
      }
      const referencedIds = new Set(state.workspaces.flatMap(workspace => workspace.projectIds))
      state.projects = state.projects.filter(project => referencedIds.has(project.id))
      writeWorkspaceState(state)
      sendJson(res, 200, { ok: true })
      return
    }

    if (method === 'GET' && url.pathname === '/host/list') {
      const state = readWorkspaceState()
      sendJson(res, 200, state.hosts)
      return
    }

    if (method === 'POST' && url.pathname === '/host/upsert') {
      const body = await parseRequestBody(req)
      const state = readWorkspaceState()
      const nextHosts = upsertExecutionHost(state.hosts, body?.host)
      writeHosts(nextHosts)
      sendJson(res, 200, nextHosts)
      return
    }

    if (method === 'DELETE' && url.pathname.startsWith('/host/')) {
      const hostId = decodeURIComponent(url.pathname.slice('/host/'.length))
      if (hostId === 'local-runtime' || hostId === 'local-daemon') {
        sendJson(res, 400, { error: 'Built-in hosts cannot be deleted' })
        return
      }
      const state = readWorkspaceState()
      const nextHosts = mergeExecutionHosts(state.hosts).filter(host => host.id !== hostId)
      writeHosts(nextHosts)
      sendJson(res, 200, { ok: true, hosts: nextHosts })
      return
    }

    if (method === 'GET' && url.pathname === '/settings') {
      const state = readWorkspaceState()
      sendJson(res, 200, state.settings)
      return
    }

    if (method === 'POST' && url.pathname === '/settings') {
      const body = await parseRequestBody(req)
      writeSettings(typeof body?.settings === 'object' && body.settings ? body.settings : {})
      const state = readWorkspaceState()
      sendJson(res, 200, state.settings)
      return
    }

    if (method === 'GET' && url.pathname === '/settings/raw') {
      ensureStateFiles()
      sendJson(res, 200, { path: SETTINGS_FILE, content: readFileSync(SETTINGS_FILE, 'utf8') })
      return
    }

    if (method === 'POST' && url.pathname === '/settings/raw') {
      const body = await parseRequestBody(req)
      try {
        const parsed = JSON.parse(String(body?.json ?? '{}'))
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          sendJson(res, 200, { ok: false, error: 'Root must be a JSON object' })
          return
        }
        writeSettings(parsed)
        const state = readWorkspaceState()
        sendJson(res, 200, { ok: true, settings: state.settings })
      } catch (error) {
        sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
})

async function start() {
  ensureStateFiles()
  if (await reuseExistingDaemonIfHealthy()) {
    process.exit(0)
    return
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  atomicWriteJson(PID_PATH, {
    pid: process.pid,
    port,
    token: AUTH_TOKEN,
    startedAt: STARTED_AT,
    protocolVersion: PROTOCOL_VERSION,
    appVersion: APP_VERSION,
  })
}

let shuttingDown = false

function removeOwnedPidFile() {
  try {
    const parsed = readPidInfo()
    if (!parsed || parsed.pid === process.pid) {
      rmSync(PID_PATH, { force: true })
    }
  } catch {}
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try {
    removeOwnedPidFile()
  } catch {}
  await new Promise(resolve => server.close(() => resolve()))
}

process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0))
})
process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0))
})
process.on('exit', () => {
  try {
    removeOwnedPidFile()
  } catch {}
})
process.on('uncaughtException', (error) => {
  console.error('[codesurfd] uncaught exception', error)
  shutdown().finally(() => process.exit(1))
})
process.on('unhandledRejection', (error) => {
  console.error('[codesurfd] unhandled rejection', error)
  shutdown().finally(() => process.exit(1))
})

await start()
