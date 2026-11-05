import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { repos } from '../../data'
import { markForRelearn } from '../../data/services'
import { syncNow } from '../../sync/manager'
import { buildPrompt, createPool } from '../../domain/exercises'
import type { Prompt } from '../../domain/prompt'
import { availableQuizItems, FORMAT_LABELS, pickQuizQuestions, quizTagTrends, sourcePackageIds, sourceTags, type QuizQuestion } from '../../domain/quiz'
import { dayEnd } from '../../domain/scheduler'
import { tenseLabel } from '../../domain/tags'
import type { Note, QuizConfig, QuizFormat, QuizQuestionResult, QuizResult, QuizSource } from '../../domain/types'
import { newId } from '../../domain/util'
import { StudyCard } from '../components/StudyCard'
import { Button, Empty, PageHeader } from '../components/ui'
import { formatDate, formatDuration, pct } from '../format'
import { useRepoQuery, useSettings } from '../hooks'
import { useVoices } from '../speech'

type Phase = { kind: 'setup' } | { kind: 'run'; questions: QuizQuestion[]; config: QuizConfig; startedAt: number; allNotes: Note[] } | { kind: 'done'; result: QuizResult; prompts: Map<string, Prompt> }

export function Quiz() {
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })
  if (phase.kind === 'run') return <QuizRun {...phase} onFinish={(result, prompts) => setPhase({ kind: 'done', result, prompts })} />
  if (phase.kind === 'done') return <QuizDone result={phase.result} prompts={phase.prompts} onAgain={() => setPhase({ kind: 'setup' })} />
  return <QuizSetup onStart={(questions, config, allNotes) => setPhase({ kind: 'run', questions, config, startedAt: Date.now(), allNotes })} />
}

function sourceLabel(s: QuizSource, pkgNames: Map<string, string>): string {
  switch (s.kind) {
    case 'package':
      return sourcePackageIds(s).map((id) => pkgNames.get(id) ?? 'Package').join(', ')
    case 'tag':
      return sourceTags(s).map((t) => `#${t}`).join(', ')
    case 'weak':
      return 'Weak items'
    case 'due':
      return 'Due items'
    case 'random':
      return 'Random'
  }
}

function QuizSetup({ onStart }: { onStart: (q: QuizQuestion[], c: QuizConfig, allNotes: Note[]) => void }) {
  const settings = useSettings()
  const [params] = useSearchParams()
  const [kind, setKind] = useState<QuizSource['kind']>((params.get('tag') ? 'tag' : 'random') as QuizSource['kind'])
  const [packageIds, setPackageIds] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>(params.get('tag') ? [params.get('tag')!] : [])
  const [length, setLength] = useState(10)
  const [formats, setFormats] = useState<QuizFormat[]>(['choice', 'cloze', 'production'])
  const [timerMin, setTimerMin] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const data = useRepoQuery(async () => {
    const now = Date.now()
    const [packages, notes, quizzes, cards, logs] = await Promise.all([
      repos.packages.all(),
      repos.notes.all(),
      repos.quizzes.all(),
      repos.cards.all(),
      repos.logs.since(now - 30 * 86_400_000),
    ])
    return { packages, tags: [...new Set(notes.flatMap((n) => n.tags))].sort(), quizzes, notes, cards, logs }
  }, [])
  const pkgNames = useMemo(() => new Map(data?.packages.map((p) => [p.id, p.name])), [data])
  const trends = useMemo(() => quizTagTrends(data?.quizzes ?? []).slice(0, 12), [data])

  // Only what exists counts as selected (a tag link can name a tag no item has any more).
  const chosenPackages = packageIds.filter((id) => data?.packages.some((p) => p.id === id))
  const chosenTags = tags.filter((t) => data?.tags.includes(t))
  const source: QuizSource = kind === 'package' ? { kind, packageIds: chosenPackages } : kind === 'tag' ? { kind, tags: chosenTags } : { kind }
  const multi = kind === 'package' || kind === 'tag'
  const nothingSelected = (kind === 'package' && !chosenPackages.length) || (kind === 'tag' && !chosenTags.length)
  // Items the selected packages / tags can give, in the chosen question types (each item once).
  const available = useMemo(() => {
    if (!data || !multi) return null
    const now = Date.now()
    return availableQuizItems({ notes: data.notes, cards: data.cards, logs: data.logs, config: { source, length, formats, timerSeconds: null }, now, dayEndTs: dayEnd(now, settings.rolloverHour) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `source` is rebuilt from these each render
  }, [data, multi, kind, packageIds, tags, formats, settings.rolloverHour])

  const start = async () => {
    const config: QuizConfig = { source, length, formats, timerSeconds: timerMin > 0 ? timerMin * 60 : null }
    const now = Date.now()
    const [notes, cards, logs] = await Promise.all([repos.notes.all(), repos.cards.all(), repos.logs.since(now - 30 * 86_400_000)])
    const questions = pickQuizQuestions({ notes, cards, logs, config, now, dayEndTs: dayEnd(now, settings.rolloverHour) })
    if (!questions.length) setError('No questions match this source and these formats.')
    else onStart(questions, config, notes)
  }

  if (!data) return <p className="muted">Loading…</p>

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Quiz" />
      <p className="muted text-sm">An assessment: it doesn't change your schedule, except that misses become due now.</p>
      <div className="card space-y-4">
        <fieldset>
          <legend className="label">Source</legend>
          <div className="flex flex-wrap gap-2">
            {(['package', 'tag', 'weak', 'due', 'random'] as const).map((k) => (
              <label key={k} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${kind === k ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40' : 'border-slate-300 dark:border-slate-700'}`}>
                <input type="radio" className="sr-only" name="source" checked={kind === k} onChange={() => setKind(k)} />
                {{ package: 'Package', tag: 'Tag', weak: 'Weak items', due: 'Due', random: 'Random' }[k]}
              </label>
            ))}
          </div>
          {kind === 'package' && (
            <CheckList label="Packages" items={data.packages.map((p) => ({ id: p.id, label: p.name }))} selected={chosenPackages} onChange={setPackageIds} />
          )}
          {kind === 'tag' && <CheckList label="Tags" items={data.tags.map((t) => ({ id: t, label: `#${t}` }))} selected={chosenTags} onChange={setTags} />}
          {multi && (
            <p className="mt-2 text-sm" role="status">
              {nothingSelected ? (
                <span className="muted">Select at least one {kind === 'package' ? 'package' : 'tag'}.</span>
              ) : (
                <>
                  <strong>{available}</strong> {available === 1 ? 'item' : 'items'} available
                </>
              )}
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend className="label">Length</legend>
          <div className="flex items-center gap-2">
            {[10, 20].map((n) => (
              <Button key={n} size="sm" variant={length === n ? 'primary' : 'secondary'} onClick={() => setLength(n)}>
                {n}
              </Button>
            ))}
            <input
              type="number"
              className="input w-24"
              min={1}
              max={200}
              value={length}
              onChange={(e) => setLength(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              aria-label="Custom length"
            />
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">Question types</legend>
          <div className="flex flex-wrap gap-3 text-sm">
            {(Object.keys(FORMAT_LABELS) as QuizFormat[]).map((f) => (
              <label key={f} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formats.includes(f)}
                  onChange={(e) => setFormats((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))}
                />
                {FORMAT_LABELS[f]}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="label">Timer (minutes, 0 = off)</span>
          <input type="number" className="input w-24" min={0} max={120} value={timerMin} onChange={(e) => setTimerMin(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <Button variant="primary" size="lg" disabled={!formats.length || nothingSelected} onClick={() => void start()}>
          Start quiz
        </Button>
      </div>

      {data.quizzes.length > 0 && (
        <section className="card">
          <h2 className="mb-2 font-medium">History</h2>
          <table className="w-full text-sm">
            <tbody>
              {[...data.quizzes]
                .reverse()
                .slice(0, 10)
                .map((q) => (
                  <tr key={q.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1.5">{formatDate(q.timestamp)}</td>
                    <td>{sourceLabel(q.config.source, pkgNames)}</td>
                    <td className="text-right tabular-nums">
                      {q.questions.filter((x) => x.correct).length}/{q.questions.length}
                    </td>
                    <td className="text-right font-medium tabular-nums">{pct(q.score)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {trends.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-sm font-medium">Score trend per tag</h3>
              <ul className="space-y-0.5 text-sm">
                {trends.map((t) => (
                  <li key={t.tag} className="flex justify-between gap-2">
                    <span>#{t.tag}</span>
                    <span className="muted tabular-nums">{t.points.slice(-5).map((p) => pct(p)).join(' → ')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}

/** A list of checkboxes with Select all / Clear. */
function CheckList({
  label,
  items,
  selected,
  onChange,
}: {
  label: string
  items: Array<{ id: string; label: string }>
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const chosen = new Set(selected)
  return (
    <div className="mt-2 rounded-lg border border-slate-300 dark:border-slate-700">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-1.5 text-sm dark:border-slate-800">
        <span className="muted">
          {label}: {selected.length} of {items.length} selected
        </span>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => onChange(items.map((i) => i.id))}>
            Select all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange([])}>
            Clear
          </Button>
        </span>
      </div>
      <ul className="max-h-60 overflow-y-auto px-3 py-1.5" aria-label={label}>
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(i.id)}
                onChange={(e) => onChange(e.target.checked ? [...selected, i.id] : selected.filter((x) => x !== i.id))}
              />
              <span className="break-all">{i.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

function QuizRun({
  questions,
  config,
  startedAt,
  allNotes,
  onFinish,
}: {
  questions: QuizQuestion[]
  config: QuizConfig
  startedAt: number
  allNotes: Note[]
  onFinish: (r: QuizResult, p: Map<string, Prompt>) => void
}) {
  const settings = useSettings()
  const audioOn = useVoices().length > 0
  const [index, setIndex] = useState(0)
  const answers = useRef<QuizQuestionResult[]>([])
  const prompts = useMemo(
    () => {
      // Same pool as when the questions were picked, so multiple choice gets the same distractors.
      const pool = createPool(allNotes)
      return questions.map((q) => buildPrompt(q.note, q.card, { promptLanguage: settings.promptLanguage, audio: audioOn, pool, exercise: q.exercise }))
    },
    [questions, settings.promptLanguage, audioOn, allNotes],
  )
  const [left, setLeft] = useState<number | null>(config.timerSeconds)
  const finished = useRef(false)

  const finish = async () => {
    if (finished.current) return
    finished.current = true
    const qs = answers.current
    const result: QuizResult = {
      id: newId(),
      timestamp: Date.now(),
      config,
      questions: qs,
      score: qs.length ? qs.filter((q) => q.correct).length / qs.length : 0,
      durationMs: Date.now() - startedAt,
    }
    await repos.quizzes.add(result)
    const misses = qs.filter((q) => !q.correct).map((q) => q.cardId)
    if (misses.length) await markForRelearn(repos, misses, false)
    void syncNow()
    onFinish(result, new Map(questions.map((q, i) => [q.card.id, prompts[i]!])))
  }

  useEffect(() => {
    if (config.timerSeconds === null) return
    const id = setInterval(() => {
      const remaining = Math.max(0, config.timerSeconds! - Math.floor((Date.now() - startedAt) / 1000))
      setLeft(remaining)
      if (remaining === 0) void finish()
    }, 500)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the timer runs once per quiz
  }, [])

  const q = questions[index]!
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="muted">
          Question {index + 1}/{questions.length}
        </span>
        {left !== null && <span className="font-medium tabular-nums">{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</span>}
      </div>
      <StudyCard
        key={q.card.id}
        prompt={prompts[index]!}
        intervals={null}
        onDone={(a) => {
          answers.current.push({
            cardId: q.card.id,
            noteId: q.note.id,
            template: q.card.template,
            correct: a.correct,
            userAnswer: a.userAnswer ?? '',
            expected: prompts[index]!.reveal.answer,
            tags: q.note.tags,
          })
          if (index + 1 < questions.length) setIndex(index + 1)
          else void finish()
        }}
      />
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void finish()}>
          End quiz now
        </Button>
      </div>
    </div>
  )
}

function QuizDone({ result, prompts, onAgain }: { result: QuizResult; prompts: Map<string, Prompt>; onAgain: () => void }) {
  const misses = result.questions.filter((q) => !q.correct)
  const [queued, setQueued] = useState(false)
  if (!result.questions.length) return <Empty title="No questions answered." />
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title={`Score: ${pct(result.score)}`}>
        <span className="muted text-sm">
          {result.questions.length - misses.length}/{result.questions.length} correct · {formatDuration(result.durationMs)}
        </span>
      </PageHeader>
      {misses.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={queued}
              onClick={async () => {
                await markForRelearn(
                  repos,
                  misses.map((m) => m.cardId),
                  true,
                )
                setQueued(true)
              }}
            >
              {queued ? 'Misses are first in your next session' : 'Put misses at the front of my queue'}
            </Button>
            <Button onClick={onAgain}>New quiz</Button>
          </div>
          <ul className="space-y-3">
            {misses.map((m) => {
              const p = prompts.get(m.cardId)
              return (
                <li key={m.cardId} className="card space-y-1 text-sm">
                  <p className="muted text-xs">{p?.instruction}</p>
                  {p?.prompt && <p dir="auto">{p.prompt}</p>}
                  {p?.promptHe && (
                    <p className="he" dir="rtl" lang="he">
                      {p.promptHe}
                    </p>
                  )}
                  {p?.context && (
                    <p>
                      {p.context.before}
                      <strong>___</strong>
                      {p.context.after}
                    </p>
                  )}
                  <p>
                    <span className="muted">Your answer: </span>
                    <span className="text-rose-700 line-through dark:text-rose-300">{m.userAnswer || '(empty)'}</span>
                  </p>
                  <p>
                    <span className="muted">Correct: </span>
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">{m.expected}</span>
                  </p>
                  {p?.reveal.rule && <p className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">Rule: {p.reveal.rule}</p>}
                  {(p?.reveal.why || p?.reveal.tense) && (
                    <p className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
                      {p.reveal.tense ? `${tenseLabel(p.reveal.tense)}: ` : ''}
                      {p.reveal.why}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="space-y-3">
          <p>No misses.</p>
          <Button onClick={onAgain}>New quiz</Button>
        </div>
      )}
    </div>
  )
}
