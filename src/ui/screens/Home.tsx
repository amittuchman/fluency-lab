import { useState } from 'react'
import { Link } from 'react-router'
import { repos } from '../../data'
import { META } from '../../data/repos'
import { loadSampleData } from '../../data/sample'
import { readinessFor } from '../../data/services'
import { buildDailyQueue } from '../../domain/queue'
import { dayStart } from '../../domain/scheduler'
import { daysAgo, streak } from '../../domain/stats'
import { saveBackupFile } from '../backupFile'
import { Banner, Button } from '../components/ui'
import { formatDate } from '../format'
import { useNow, useRepoQuery, useSettings } from '../hooks'

const BACKUP_REMINDER_DAYS = 7

export function Home() {
  const settings = useSettings()
  const now = useNow()
  const [busy, setBusy] = useState(false)

  const data = useRepoQuery(async () => {
    const t = Date.now()
    const [cards, notes, logs, packages, onboarding, lastBackupAt] = await Promise.all([
      repos.cards.all(),
      repos.notes.all(),
      repos.logs.all(),
      repos.packages.all(),
      repos.meta.get<string>(META.onboarding),
      repos.meta.get<number>(META.lastBackupAt),
    ])
    const noteMap = new Map(notes.map((n) => [n.id, n]))
    const start = dayStart(t, settings.rolloverHour)
    const q = buildDailyQueue({ cards, notes: noteMap, todayLogs: logs.filter((l) => l.timestamp >= start), settings, now: t })
    const latest = packages[0]
    const readiness = latest ? await readinessFor(repos, notes.filter((n) => n.packageId === latest.id)) : null
    return {
      q,
      noteCount: notes.length,
      streak: streak(logs, t, settings.rolloverHour),
      reviewedToday: logs.filter((l) => l.timestamp >= start).length,
      latest,
      readiness,
      onboarding,
      lastBackupAt,
    }
  }, [settings, now])

  if (!data) return <p className="muted">Loading…</p>

  const total = data.q.dueToday + data.q.newToday
  const showSample = !data.onboarding && data.noteCount === 0
  const backupAge = data.lastBackupAt ? daysAgo(data.lastBackupAt, now) : null
  const showBackup = data.noteCount > 0 && (backupAge === null || backupAge >= BACKUP_REMINDER_DAYS)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {showSample && (
        <Banner>
          <p className="mb-2 font-medium">Welcome. Start with sample data or with an empty library?</p>
          <p className="mb-3">The sample has vocabulary, fixes, natural phrasing and two items for each of the 12 tenses.</p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await loadSampleData(repos)
                setBusy(false)
              }}
            >
              Load sample data
            </Button>
            <Button onClick={() => void repos.meta.set(META.onboarding, 'done')}>Start empty</Button>
          </div>
        </Banner>
      )}
      {showBackup && (
        <Banner tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{backupAge === null ? 'You have never backed up. Your data lives only in this browser.' : `Last backup ${backupAge} days ago.`}</span>
            <Button size="sm" onClick={() => void saveBackupFile()}>
              Back up now
            </Button>
          </div>
        </Banner>
      )}

      <section className="card text-center">
        <div className="mb-4 flex justify-center gap-8">
          <div>
            <div className="text-3xl font-semibold tabular-nums">{data.q.dueToday}</div>
            <div className="muted text-sm">due</div>
          </div>
          <div>
            <div className="text-3xl font-semibold tabular-nums">{data.q.newToday}</div>
            <div className="muted text-sm">new</div>
          </div>
          <div>
            <div className="text-3xl font-semibold tabular-nums">{data.streak}</div>
            <div className="muted text-sm">day streak</div>
          </div>
        </div>
        {total > 0 ? (
          <Link
            to="/study"
            className="block w-full rounded-xl bg-sky-600 px-6 py-4 text-lg font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-offset-4"
          >
            Start session
          </Link>
        ) : (
          <p className="muted py-3">{data.noteCount ? 'All done for today.' : 'Add material to start studying.'}</p>
        )}
        <p className="muted mt-3 text-xs">{data.reviewedToday} answers today</p>
      </section>

      {data.latest && data.readiness && (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-medium">Ready for next voice session</h2>
              <p className="muted text-sm">
                {data.latest.name} · {formatDate(data.latest.createdAt)}
              </p>
            </div>
            <span className="text-lg font-semibold tabular-nums">
              {data.readiness.ready}/{data.readiness.total}
            </span>
          </div>
          <div className="my-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="h-full bg-emerald-500" style={{ width: `${(data.readiness.ready / Math.max(1, data.readiness.total)) * 100}%` }} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="muted text-xs">A card is ready after two correct answers in a row.</p>
            <Link
              to={`/drill/package/${data.latest.id}${data.readiness.ready < data.readiness.total ? '' : '?all=1'}`}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
              {data.readiness.ready < data.readiness.total ? 'Drill this package' : 'Drill again'}
            </Link>
          </div>
        </section>
      )}

      <nav className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-label="Shortcuts">
        {[
          ['/add', 'Add / import'],
          ['/quiz', 'Quiz'],
          ['/weak', 'Weak spots'],
          ['/stats', 'Stats'],
        ].map(([to, label]) => (
          <Link key={to} to={to!} className="card py-3 text-center font-medium hover:border-sky-400">
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
