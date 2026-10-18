import { Link } from 'react-router'
import { repos } from '../../data'
import { tagStats } from '../../domain/stats'
import { Empty, PageHeader } from '../components/ui'
import { pct } from '../format'
import { useRepoQuery } from '../hooks'

const WINDOW_DAYS = 30

/** Tags ranked from weakest: lowest accuracy over the last 30 days, then most lapses. */
export function WeakSpots() {
  const rows = useRepoQuery(async () => {
    const [notes, cards, logs] = await Promise.all([repos.notes.all(), repos.cards.all(), repos.logs.since(Date.now() - WINDOW_DAYS * 86_400_000)])
    return tagStats(notes, cards, logs)
      .filter((s) => s.reviews > 0 || s.lapses > 0)
      .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1) || b.lapses - a.lapses)
  }, [])

  if (!rows) return <p className="muted">Loading…</p>
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Weak spots" />
      <p className="muted mb-3 text-sm">Accuracy is over the last {WINDOW_DAYS} days; lapses and leeches are current totals.</p>
      {rows.length === 0 ? (
        <Empty title="No data yet.">Study for a few days and your weakest tags will show up here.</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="muted border-b border-slate-200 text-xs dark:border-slate-800">
              <tr>
                <th className="px-3 py-2 font-medium">Tag</th>
                <th className="px-2 text-right font-medium">Answers</th>
                <th className="px-2 text-right font-medium">Accuracy</th>
                <th className="px-2 text-right font-medium">Lapses</th>
                <th className="px-2 text-right font-medium">Leeches</th>
                <th className="px-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tag} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-3 py-2">
                    <Link to={`/library?tag=${encodeURIComponent(r.tag)}`} className="hover:underline">
                      #{r.tag}
                    </Link>
                    <span className="muted ml-1 text-xs">({r.notes})</span>
                  </td>
                  <td className="px-2 text-right tabular-nums">{r.reviews}</td>
                  <td className={`px-2 text-right font-medium tabular-nums ${r.accuracy !== null && r.accuracy < 0.8 ? 'text-rose-700 dark:text-rose-300' : ''}`}>
                    {pct(r.accuracy)}
                  </td>
                  <td className="px-2 text-right tabular-nums">{r.lapses}</td>
                  <td className="px-2 text-right tabular-nums">{r.leeches}</td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <Link to={`/drill/tag/${encodeURIComponent(r.tag)}?all=1`} className="rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700">
                      Drill this tag
                    </Link>{' '}
                    <Link
                      to={`/quiz?tag=${encodeURIComponent(r.tag)}`}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      Quiz
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
