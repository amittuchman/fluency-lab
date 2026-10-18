export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${min % 60} min`
}

export function pct(x: number | null): string {
  return x === null || Number.isNaN(x) ? '–' : `${Math.round(x * 100)}%`
}

/** "just now", "5 min ago", "3 h ago", or a date. */
export function formatAgo(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 24 * 60) return `${Math.floor(min / 60)} h ago`
  return formatDate(ts)
}
