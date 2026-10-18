import { repos } from '../../data'
import { dayEnd, dayStart } from '../../domain/scheduler'
import { maturity, streak, tagStats, tenseStats, timeStudied, trueRetention } from '../../domain/stats'
import { tenseLabel } from '../../domain/tags'
import { Empty, PageHeader, Stat } from '../components/ui'
import { formatDate, formatDuration, pct } from '../format'
import { useRepoQuery, useSettings } from '../hooks'

const DAY = 86_400_000

export function Stats() {
  const settings = useSettings()
  const data = useRepoQuery(async () => {
    const now = Date.now()
    const [notes, cards, logs, quizzes] = await Promise.all([repos.notes.all(), repos.cards.all(), repos.logs.all(), repos.quizzes.all()])
    const liveIds = new Set(notes.map((n) => n.id))
    const liveCards = cards.filter((c) => liveIds.has(c.noteId))
    const today = dayStart(now, settings.rolloverHour)
    const todayLogs = logs.filter((l) => l.timestamp >= today)
    const month = now - 30 * DAY
    return {
      notes: notes.length,
      today: {
        answers: todayLogs.length,
        newCards: todayLogs.filter((l) => l.scheduled && l.cardBefore.fsrs.state === 0).length,
        accuracy: todayLogs.length ? todayLogs.filter((l) => l.correct).length / todayLogs.length : null,
        time: timeStudied(todayLogs, today),
      },
      streak: streak(logs, now, settings.rolloverHour),
      retention: trueRetention(logs, month),
      maturity: maturity(liveCards),
      time30: timeStudied(logs, month),
      tags: tagStats(notes, liveCards, logs, month)
        .filter((t) => t.reviews > 0)
        .sort((a, b) => b.reviews - a.reviews)
        .slice(0, 20),
      tenses: tenseStats(notes, liveCards, now, dayEnd(now, settings.rolloverHour)),
      quizzes: [...quizzes].reverse().slice(0, 10),
    }
  }, [settings.rolloverHour])

  if (!data) return <p className="muted">Loading…</p>
  if (!data.notes) return <Empty title="No data yet." />

  const m = data.maturity
  const mTotal = m.new + m.learning + m.young + m.mature || 1
  const segments = [
    ['New', m.new, 'bg-slate-400'],
    ['Learning', m.learning, 'bg-amber-400'],
    ['Young', m.young, 'bg-sky-400'],
    ['Mature', m.mature, 'bg-emerald-500'],
  ] as const

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Stats" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Today" value={data.today.answers} sub={`${data.today.newCards} new · ${pct(data.today.accuracy)} correct`} />
        <Stat label="Streak" value={`${data.streak} d`} />
        <Stat label="True retention" value={pct(data.retention.rate)} sub={`last 30 days · ${data.retention.n} reviews`} />
        <Stat label="Time studied" value={formatDuration(data.today.time)} sub={`${formatDuration(data.time30)} in 30 days`} />
      </div>

      <section className="card">
        <h2 className="mb-2 font-medium">Cards by maturity</h2>
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" role="img" aria-label="Card maturity breakdown">
          {segments.map(([label, n, cls]) => (
            <div key={label} className={cls} style={{ width: `${(n / mTotal) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {segments.map(([label, n, cls]) => (
            <li key={label} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />
              {label} <span className="muted tabular-nums">{n}</span>
            </li>
          ))}
          <li className="muted">
            Locked {m.locked} · Suspended {m.suspended}
          </li>
        </ul>
        <p className="muted mt-1 text-xs">Young: interval under 21 days. Mature: 21 days or more.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="mb-2 font-medium">Tenses</h2>
          <table className="w-full text-sm">
            <thead className="muted text-xs">
              <tr>
                <th className="text-left font-medium">Tense</th>
                <th className="text-right font-medium">Items</th>
                <th className="w-28 text-right font-medium">Mastery</th>
                <th className="pl-3 text-right font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {data.tenses.map((t) => (
                <tr key={t.tense} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1">{tenseLabel(t.tense)}</td>
                  <td className="text-right tabular-nums">{t.items}</td>
                  <td className="pl-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div className="h-full bg-emerald-500" style={{ width: `${t.mastery * 100}%` }} />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums">{t.items ? pct(t.mastery) : '–'}</span>
                    </div>
                  </td>
                  <td className="text-right tabular-nums">{t.due}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted mt-2 text-xs">Mastery: average card stability relative to 21 days.</p>
        </section>

        <section className="card">
          <h2 className="mb-2 font-medium">Tags (last 30 days)</h2>
          {data.tags.length === 0 ? (
            <p className="muted text-sm">No reviews yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="muted text-xs">
                <tr>
                  <th className="text-left font-medium">Tag</th>
                  <th className="text-right font-medium">Answers</th>
                  <th className="text-right font-medium">Accuracy</th>
                  <th className="text-right font-medium">Lapses</th>
                </tr>
              </thead>
              <tbody>
                {data.tags.map((t) => (
                  <tr key={t.tag} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1">#{t.tag}</td>
                    <td className="text-right tabular-nums">{t.reviews}</td>
                    <td className="text-right tabular-nums">{pct(t.accuracy)}</td>
                    <td className="text-right tabular-nums">{t.lapses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="mb-2 font-medium">Quiz history</h2>
        {data.quizzes.length === 0 ? (
          <p className="muted text-sm">No quizzes yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {data.quizzes.map((q) => (
              <li key={q.id} className="flex justify-between">
                <span>{formatDate(q.timestamp)}</span>
                <span className="tabular-nums">
                  {pct(q.score)} <span className="muted">({q.questions.length} questions)</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
