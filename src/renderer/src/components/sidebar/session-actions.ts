export const SESSION_ACTION_BUTTON_SIZE = 28
export const SESSION_ACTION_ICON_SIZE = 16
export const SESSION_ROW_EXTRA_WIDTH = 72

export function getSessionArchiveActionLabel(isArchived: boolean): string {
  return isArchived ? 'Unarchive conversation' : 'Archive conversation'
}

/**
 * Compact codex-style relative time for sidebar session rows.
 * Examples: "just now", "20s", "5m", "3h", "2d", "1w", "4mo", "2y"
 */
export function formatSessionSidebarRelativeTime(timestamp: number | null | undefined, now: number = Date.now()): string {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return ''
  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  const minutes = Math.max(1, Math.floor(diffSeconds / 60))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(days / 365)
  return `${years}y`
}
