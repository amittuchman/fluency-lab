import { Link } from 'react-router'
import { useSyncState, type SyncStatus } from '../../sync/manager'
import { formatAgo } from '../format'

const LOOK: Record<SyncStatus, [string, string]> = {
  local: ['Local only', 'bg-slate-400'],
  syncing: ['Syncing…', 'bg-sky-500 animate-pulse'],
  synced: ['Synced', 'bg-emerald-500'],
  offline: ['Offline', 'bg-amber-500'],
  error: ['Sync error', 'bg-rose-500'],
}

/** Small sync status indicator; links to the Sync section in Settings. */
export function SyncBadge({ className = '' }: { className?: string }) {
  const s = useSyncState()
  const [label, dot] = LOOK[s.status]
  const title =
    s.status === 'error'
      ? `Sync error: ${s.error ?? 'unknown'}`
      : s.status === 'local'
        ? 'Not signed in: data stays on this device'
        : s.lastSyncedAt
          ? `Last synced ${formatAgo(s.lastSyncedAt)}`
          : label
  return (
    <Link to="/settings#sync" className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800 ${className}`} title={title}>
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
      <span role="status">{label}</span>
    </Link>
  )
}
