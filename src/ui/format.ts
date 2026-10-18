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
