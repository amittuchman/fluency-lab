import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { repos } from '../../data'
import { META } from '../../data/repos'
import { cheatSheetFor, DEFAULT_CHEATSHEETS, type CheatSheet } from '../../domain/cheatsheets'
import { dayEnd } from '../../domain/scheduler'
import { tenseStats } from '../../domain/stats'
import { tenseLabel } from '../../domain/tags'
import { TENSE_ASPECTS, TENSE_TIMES, type TenseName } from '../../domain/types'
import { Button, PageHeader } from '../components/ui'
import { pct } from '../format'
import { useCheatSheets, useNow, useRepoQuery, useSettings } from '../hooks'

const ASPECT_LABEL = { simple: 'Simple', continuous: 'Continuous', perfect: 'Perfect', 'perfect-continuous': 'Perfect continuous' } as const
const TIME_LABEL = { past: 'Past', present: 'Present', future: 'Future' } as const

const PRESETS: TenseName[][] = [
  ['present-perfect', 'past-simple'],
  ['present-perfect', 'present-perfect-continuous'],
  ['present-perfect', 'past-simple', 'present-perfect-continuous'],
  ['past-simple', 'past-continuous'],
  ['past-perfect', 'past-simple'],
  ['future-simple', 'future-continuous', 'future-perfect'],
]

export function TenseLab() {
  const settings = useSettings()
  const now = useNow()
  const navigate = useNavigate()
  const [contrast, setContrast] = useState<TenseName[]>([])
  const [sheet, setSheet] = useState<TenseName>('present-perfect')

  const stats = useRepoQuery(async () => {
    const [notes, cards] = await Promise.all([repos.notes.all(), repos.cards.all()])
    return new Map(tenseStats(notes, cards, now, dayEnd(now, settings.rolloverHour)).map((s) => [s.tense, s]))
  }, [now, settings.rolloverHour])

  if (!stats) return <p className="muted">Loading…</p>
  const total = [...stats.values()].reduce((s, t) => s + t.items, 0)
  const toggle = (t: TenseName) => setContrast((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : cur.length < 3 ? [...cur, t] : cur))
  const drillUrl = (tenses: TenseName[] | 'all') => `/drill/tense/${tenses === 'all' ? 'all' : tenses.join(',')}?all=1`

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Tense Lab">
        <Button variant="primary" disabled={!total} onClick={() => navigate(drillUrl('all'))}>
          Mixed drill: all tenses
        </Button>
      </PageHeader>

      <section className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-separate border-spacing-2 text-sm">
          <thead>
            <tr>
              <th className="w-20" />
              {TENSE_ASPECTS.map((a) => (
                <th key={a} className="muted text-left text-xs font-medium uppercase tracking-wide">
                  {ASPECT_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TENSE_TIMES.map((time) => (
              <tr key={time}>
                <th className="muted text-left text-xs font-medium uppercase tracking-wide">{TIME_LABEL[time]}</th>
                {TENSE_ASPECTS.map((aspect) => {
                  const tense = `${time}-${aspect}` as TenseName
                  const s = stats.get(tense)!
                  const body = (
                    <>
                      <div className="font-medium">{tenseLabel(tense)}</div>
                      <div className="muted mt-1 text-xs">
                        {s.items} items · {s.due} due
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                          <div className="h-full bg-emerald-500" style={{ width: `${s.mastery * 100}%` }} />
                        </div>
                        <span className="text-xs tabular-nums">{s.items ? pct(s.mastery) : '–'}</span>
                      </div>
                    </>
                  )
                  return (
                    <td key={tense} className="align-top">
                      {s.items ? (
                        <Link
                          to={drillUrl([tense])}
                          className="card block p-3 transition-colors hover:border-sky-400"
                          aria-label={`Drill ${tenseLabel(tense)}: ${s.items} items, ${s.due} due, mastery ${pct(s.mastery)}`}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className="card p-3 opacity-50">{body}</div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted px-2 text-xs">Click a cell to drill that tense. Mastery is the average card stability relative to 21 days.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">Contrast drill</h2>
        <p className="muted text-sm">Pick 2–3 tenses you mix up. Their items are interleaved and the time signals in each sentence are highlighted.</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.join()} size="sm" onClick={() => setContrast(p)}>
              {p.map(tenseLabel).join(' vs ')}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
          {TENSE_TIMES.flatMap((time) =>
            TENSE_ASPECTS.map((aspect) => {
              const t = `${time}-${aspect}` as TenseName
              return (
                <label key={t} className={`flex items-center gap-2 ${stats.get(t)!.items ? '' : 'opacity-50'}`}>
                  <input type="checkbox" checked={contrast.includes(t)} onChange={() => toggle(t)} disabled={!stats.get(t)!.items} />
                  {tenseLabel(t)}
                </label>
              )
            }),
          )}
        </div>
        <Button variant="primary" disabled={contrast.length < 2 || contrast.every((t) => !stats.get(t)!.items)} onClick={() => navigate(drillUrl(contrast))}>
          Start contrast drill
        </Button>
      </section>

      <CheatSheets selected={sheet} onSelect={setSheet} />
    </div>
  )
}

function CheatSheets({ selected, onSelect }: { selected: TenseName; onSelect: (t: TenseName) => void }) {
  const overrides = useCheatSheets()
  const [editing, setEditing] = useState(false)
  const sheet = cheatSheetFor(selected, overrides)
  const custom = !!overrides?.[selected]

  const save = async (next: CheatSheet | null) => {
    const all = { ...(overrides ?? {}) }
    if (next) all[selected] = next
    else delete all[selected]
    await repos.meta.set(META.cheatSheets, all)
    setEditing(false)
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-medium">Cheat-sheets</h2>
      <div className="flex flex-wrap gap-1" role="tablist">
        {(Object.keys(DEFAULT_CHEATSHEETS) as TenseName[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={t === selected}
            onClick={() => {
              onSelect(t)
              setEditing(false)
            }}
            className={`rounded-md px-2 py-1 text-xs font-medium ${t === selected ? 'bg-sky-600 text-white' : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700'}`}
          >
            {tenseLabel(t)}
          </button>
        ))}
      </div>
      {editing ? (
        <SheetEditor key={selected} sheet={sheet} onSave={(s) => void save(s)} onCancel={() => setEditing(false)} />
      ) : (
        <div className="space-y-2 text-sm">
          <h3 className="text-base font-semibold">{tenseLabel(selected)}</h3>
          <p>
            <span className="muted">Form: </span>
            {sheet.form}
          </p>
          <p>
            <span className="muted">Use: </span>
            {sheet.use}
          </p>
          <p>
            <span className="muted">Signal words: </span>
            {sheet.signals.join(', ')}
          </p>
          <ul className="list-disc pl-5 italic">
            {sheet.examples.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            {custom && (
              <Button size="sm" variant="ghost" onClick={() => void save(null)}>
                Reset to default
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function SheetEditor({ sheet, onSave, onCancel }: { sheet: CheatSheet; onSave: (s: CheatSheet) => void; onCancel: () => void }) {
  const [form, setForm] = useState(sheet.form)
  const [use, setUse] = useState(sheet.use)
  const [signals, setSignals] = useState(sheet.signals.join(', '))
  const [ex1, setEx1] = useState(sheet.examples[0])
  const [ex2, setEx2] = useState(sheet.examples[1])
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSave({
          form: form.trim(),
          use: use.trim(),
          signals: signals
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          examples: [ex1.trim(), ex2.trim()],
        })
      }}
    >
      {(
        [
          ['Form', form, setForm],
          ['Use', use, setUse],
          ['Signal words (comma separated)', signals, setSignals],
          ['Example 1', ex1, setEx1],
          ['Example 2', ex2, setEx2],
        ] as const
      ).map(([label, value, set]) => (
        <label key={label} className="block">
          <span className="label">{label}</span>
          <input className="input" value={value} onChange={(e) => set(e.target.value)} />
        </label>
      ))}
      <div className="flex gap-2">
        <Button variant="primary" type="submit">
          Save
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}
