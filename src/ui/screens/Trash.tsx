import { useState } from 'react'
import { repos } from '../../data'
import { purgeNotes, restoreNotes, TRASH_DAYS } from '../../data/services'
import { primaryText } from '../../domain/parser'
import { daysAgo } from '../../domain/stats'
import { Button, Confirm, Empty, PageHeader, TypeBadge } from '../components/ui'
import { useNow, useRepoQuery } from '../hooks'

export function Trash() {
  const now = useNow()
  const notes = useRepoQuery(async () => (await repos.notes.trashed()).sort((a, b) => b.deletedAt! - a.deletedAt!), [])
  const [purging, setPurging] = useState<string[] | null>(null)

  if (!notes) return <p className="muted">Loading…</p>
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Trash">
        {notes.length > 0 && (
          <>
            <Button onClick={() => void restoreNotes(repos, notes.map((n) => n.id))}>Restore all</Button>
            <Button variant="danger" onClick={() => setPurging(notes.map((n) => n.id))}>
              Empty trash
            </Button>
          </>
        )}
      </PageHeader>
      <p className="muted mb-3 text-sm">Deleted notes stay here for {TRASH_DAYS} days, then they are removed for good.</p>
      {notes.length === 0 ? (
        <Empty title="Trash is empty." />
      ) : (
        <ul className="card divide-y divide-slate-100 p-0 dark:divide-slate-800">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <TypeBadge type={n.type} /> <span>{primaryText(n)}</span>
                <p className="muted text-xs">{Math.max(0, TRASH_DAYS - daysAgo(n.deletedAt!, now))} days left</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" onClick={() => void restoreNotes(repos, [n.id])}>
                  Restore
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPurging([n.id])}>
                  Delete forever
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {purging && (
        <Confirm
          title={purging.length > 1 ? `Permanently delete ${purging.length} notes?` : 'Permanently delete this note?'}
          body="This removes the notes and their cards for good. It cannot be undone (unless you have a backup)."
          confirmLabel="Delete forever"
          danger
          onCancel={() => setPurging(null)}
          onConfirm={async () => {
            await purgeNotes(repos, purging)
            setPurging(null)
          }}
        />
      )}
    </div>
  )
}
