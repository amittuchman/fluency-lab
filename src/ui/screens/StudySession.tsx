import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { repos } from '../../data'
import { reviewCard, setCardSuspended, undoLastReview } from '../../data/services'
import { allSignals } from '../../domain/cheatsheets'
import { answerDrill, startDrill, undoDrill, type DrillState } from '../../domain/drill'
import { buildPrompt } from '../../domain/prompt'
import { buildDailyQueue, roundRobin } from '../../domain/queue'
import { dayEnd, dayStart, formatInterval, Scheduler } from '../../domain/scheduler'
import { templateLabel } from '../../domain/templates'
import type { Card, Grade, Note } from '../../domain/types'
import { EditNoteModal } from '../components/EditNoteModal'
import { StudyCard, type CardAnswer } from '../components/StudyCard'
import { Banner, Button, Empty, Kbd, TagList, TypeBadge } from '../components/ui'
import { formatDuration, pct } from '../format'
import { isTypingTarget, useCheatSheets, useSettings } from '../hooks'
import { speechRecognitionSupported, useVoices } from '../speech'

export type SessionSource =
  | { kind: 'daily' }
  | {
      kind: 'drill'
      title: string
      cardIds: string[]
      readyIds: string[]
      /** Interleave by note type (default) or by tense (Tense Lab). */
      group?: 'type' | 'tense'
      /** Highlight time-signal phrases in sentences (Tense Lab). */
      highlight?: boolean
    }

interface Result {
  cardId: string
  noteId: string
  correct: boolean
  wasNew: boolean
  requeued: boolean
  prevStreak: number
}

interface State {
  cards: Map<string, Card>
  notes: Map<string, Note>
  queue: string[]
  drill: DrillState | null
  results: Result[]
  startedAt: number
  /** Bumped to remount the current card (after edit/undo). */
  attempt: number
}

/** Learning cards come back this many cards later in the same session. */
const REQUEUE_GAP = 3

export function StudySession({ source }: { source: SessionSource }) {
  const settings = useSettings()
  const cheatSheets = useCheatSheets()
  const audioOn = useVoices().length > 0
  const signals = useMemo(() => (source.kind === 'drill' && source.highlight ? allSignals(cheatSheets) : undefined), [source, cheatSheets])
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const scheduler = useMemo(() => new Scheduler({ desiredRetention: settings.desiredRetention }), [settings.desiredRetention])
  const sourceKey = source.kind === 'daily' ? 'daily' : source.cardIds.join(',')

  // Load once per session; the queue is fixed at start (plus in-session requeues).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const now = Date.now()
      const [cards, notes, todayLogs] = await Promise.all([repos.cards.all(), repos.notes.all(), repos.logs.since(dayStart(now, settings.rolloverHour))])
      const cardMap = new Map(cards.map((c) => [c.id, c]))
      const noteMap = new Map(notes.map((n) => [n.id, n]))
      let queue: string[]
      let drill: DrillState | null = null
      if (source.kind === 'daily') {
        queue = buildDailyQueue({ cards, notes: noteMap, todayLogs, settings, now }).queue.map((c) => c.id)
        if (settings.sessionCap.kind === 'cards') queue = queue.slice(0, settings.sessionCap.value)
      } else {
        const ids = source.cardIds.filter((id) => cardMap.has(id) && noteMap.has(cardMap.get(id)!.noteId))
        // Rotate across note types so the loop is interleaved, not blocked by type.
        drill = startDrill(
          roundRobin(ids, (id) => {
            const n = noteMap.get(cardMap.get(id)!.noteId)!
            return source.group === 'tense' && n.type === 'tense' ? n.fields.tense : n.type
          }),
          source.readyIds,
        )
        queue = drill.queue
      }
      if (!cancelled) setState({ cards: cardMap, notes: noteMap, queue, drill, results: [], startedAt: now, attempt: 0 })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a session starts once per source
  }, [sourceKey])

  const currentId = state?.queue[0]
  const card = currentId ? state?.cards.get(currentId) : undefined
  const note = card ? state?.notes.get(card.noteId) : undefined
  const capReached =
    !!state && source.kind === 'daily' && settings.sessionCap.kind === 'minutes' && Date.now() - state.startedAt >= settings.sessionCap.value * 60_000 && state.results.length > 0
  const finished = !!state && (!card || !note || capReached)

  const prompt = useMemo(
    () => (card && note ? buildPrompt(note, card, { promptLanguage: settings.promptLanguage, audio: audioOn, speech: speechRecognitionSupported() }) : null),
    // Rebuild when the card's review count changes (chunk rotation) or after an edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card?.id, card?.fsrs.reps, note, settings.promptLanguage, state?.attempt, audioOn],
  )

  const intervals = useMemo(() => {
    if (!card) return null
    const now = Date.now()
    const p = scheduler.preview(card.fsrs, now)
    return { 1: formatInterval(p[1].due - now), 2: formatInterval(p[2].due - now), 3: formatInterval(p[3].due - now), 4: formatInterval(p[4].due - now) } as Record<Grade, string>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, card?.fsrs, scheduler])

  const extraPass = !!card && source.kind === 'drill' && (card.fsrs.lastReview ?? 0) >= dayStart(Date.now(), settings.rolloverHour)

  const onDone = useCallback(
    async (answer: CardAnswer) => {
      if (!state || !card || busy) return
      setBusy(true)
      setMessage(null)
      try {
        const out = await reviewCard(repos, {
          cardId: card.id,
          grade: answer.grade,
          correct: answer.correct,
          responseMs: answer.responseMs,
          mode: source.kind === 'drill' ? 'drill' : 'session',
          userAnswer: answer.userAnswer,
        })
        setState((s) => {
          if (!s) return s
          const cards = new Map(s.cards).set(out.card.id, out.card)
          let queue = s.queue.slice(1)
          let drill = s.drill
          let requeued = false
          const prevStreak = s.drill?.streak[card.id] ?? 0
          if (drill) {
            drill = answerDrill(drill, card.id, answer.correct)
            queue = drill.queue
          } else if ((out.card.fsrs.state === 1 || out.card.fsrs.state === 3) && out.card.fsrs.due < dayEnd(Date.now(), settings.rolloverHour)) {
            queue.splice(Math.min(REQUEUE_GAP, queue.length), 0, card.id)
            requeued = true
          }
          const result: Result = { cardId: card.id, noteId: card.noteId, correct: answer.correct, wasNew: out.log.cardBefore.fsrs.state === 0, requeued, prevStreak }
          return { ...s, cards, queue, drill, results: [...s.results, result] }
        })
      } finally {
        setBusy(false)
      }
    },
    [state, card, busy, source.kind, settings.rolloverHour],
  )

  const undo = useCallback(async () => {
    if (!state?.results.length || busy) return
    setBusy(true)
    try {
      const log = await undoLastReview(repos)
      if (!log) return
      setState((s) => {
        if (!s) return s
        const last = s.results.at(-1)!
        const cards = new Map(s.cards).set(log.cardBefore.id, log.cardBefore)
        let queue = [...s.queue]
        let drill = s.drill
        if (drill) {
          drill = undoDrill(drill, last.cardId, last.prevStreak)
          queue = drill.queue
        } else {
          if (last.requeued) {
            const i = queue.indexOf(last.cardId)
            if (i >= 0) queue.splice(i, 1)
          }
          queue.unshift(last.cardId)
        }
        return { ...s, cards, queue, drill, results: s.results.slice(0, -1), attempt: s.attempt + 1 }
      })
      setMessage('Last review undone.')
    } finally {
      setBusy(false)
    }
  }, [state, busy])

  const suspend = useCallback(async () => {
    if (!card) return
    await setCardSuspended(repos, card.id, true)
    setState((s) => {
      if (!s) return s
      const queue = s.queue.filter((id) => id !== card.id)
      const drill = s.drill ? { ...s.drill, queue: s.drill.queue.filter((id) => id !== card.id), total: s.drill.total.filter((id) => id !== card.id) } : null
      return { ...s, queue, drill }
    })
    setMessage('Card suspended. Unsuspend it from the Library.')
  }, [card])

  const afterEdit = useCallback(
    async (saved: boolean) => {
      setEditing(null)
      if (!saved || !card) return
      const [fresh, freshNote] = await Promise.all([repos.cards.get(card.id), repos.notes.get(card.noteId)])
      setState((s) => {
        if (!s) return s
        const cards = new Map(s.cards)
        const notes = new Map(s.notes)
        if (freshNote) notes.set(freshNote.id, freshNote)
        let queue = s.queue
        if (fresh) cards.set(fresh.id, fresh)
        else queue = queue.filter((id) => id !== card.id)
        return { ...s, cards, notes, queue, attempt: s.attempt + 1 }
      })
    },
    [card],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return
      const key = e.key.toLowerCase()
      if (isTypingTarget(e)) {
        // Ctrl+Z in an empty answer box undoes the last review (otherwise it is text undo).
        if (key === 'z' && (e.ctrlKey || e.metaKey) && !(e.target as HTMLInputElement).value) {
          e.preventDefault()
          void undo()
        }
        return
      }
      if (key === 'z' && !e.altKey) {
        e.preventDefault()
        void undo()
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && key === 'e' && note) {
        e.preventDefault()
        setEditing(note)
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && key === 's' && card) {
        e.preventDefault()
        void suspend()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, undo, suspend, note, card])

  if (!state) return <p className="muted">Loading…</p>

  if (finished) {
    return <Summary state={state} source={source} capReached={capReached} onUndo={state.results.length ? undo : undefined} />
  }

  const progress =
    state.drill !== null
      ? `${state.drill.ready.length}/${state.drill.total.length} ready`
      : `${state.results.length} done · ${state.queue.length} left`

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <TypeBadge type={note!.type} />
          <span className="muted">{templateLabel(card!.template)}</span>
        </div>
        <span className="muted tabular-nums" aria-live="polite">
          {source.kind === 'drill' ? `${source.title}: ` : ''}
          {progress}
        </span>
      </div>
      {state.drill && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden>
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(state.drill.ready.length / Math.max(1, state.drill.total.length)) * 100}%` }} />
        </div>
      )}

      {card!.leech && (
        <Banner tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Leech:</strong> rewrite the example or add a memory hook.
            </span>
            <span className="flex gap-2">
              <Button size="sm" onClick={() => setEditing(note!)}>
                Edit
              </Button>
              <Button size="sm" onClick={() => void suspend()}>
                Suspend
              </Button>
            </span>
          </div>
        </Banner>
      )}
      {extraPass && <p className="muted mb-2 text-xs">Extra pass today: a correct answer won't change the schedule; a miss still counts.</p>}
      {message && (
        <p className="muted mb-2 text-xs" role="status">
          {message}
        </p>
      )}

      {prompt && <StudyCard key={`${card!.id}:${state.results.length}:${state.attempt}`} prompt={prompt} intervals={intervals} signals={signals} onDone={(a) => void onDone(a)} />}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {/* Tense tags would give the answer away. */}
        <TagList tags={note!.tags.filter((t) => !t.startsWith('tense:'))} />
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => void undo()} disabled={!state.results.length}>
            Undo <Kbd>Z</Kbd>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(note!)}>
            Edit <Kbd>E</Kbd>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void suspend()}>
            Suspend <Kbd>S</Kbd>
          </Button>
        </div>
      </div>
      {editing && <EditNoteModal note={editing} onClose={(saved) => void afterEdit(saved)} />}
    </div>
  )
}

function Summary({ state, source, capReached, onUndo }: { state: State; source: SessionSource; capReached: boolean; onUndo?: () => void }) {
  const r = state.results
  const correct = r.filter((x) => x.correct).length
  const misses = new Map<string, { miss: number; total: number }>()
  for (const x of r) {
    for (const tag of state.notes.get(x.noteId)?.tags ?? []) {
      const m = misses.get(tag) ?? { miss: 0, total: 0 }
      m.total++
      if (!x.correct) m.miss++
      misses.set(tag, m)
    }
  }
  const weakest = [...misses.entries()]
    .filter(([, m]) => m.miss > 0)
    .sort((a, b) => b[1].miss / b[1].total - a[1].miss / a[1].total || b[1].miss - a[1].miss)
    .slice(0, 3)

  if (!r.length) {
    return (
      <div className="mx-auto max-w-2xl">
        <Empty title={source.kind === 'drill' ? 'Everything here is already ready.' : 'Nothing due right now.'}>
          {source.kind === 'daily' ? (
            <>
              New cards follow your daily limit. <Link className="text-sky-600 underline" to="/add">Add material</Link> or come back later.
            </>
          ) : (
            <>
              Each card was answered correctly twice in a row. <Link className="text-sky-600 underline" to="/packages">Back to packages</Link>
            </>
          )}
        </Empty>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">{source.kind === 'drill' ? `${source.title}: drill finished` : capReached ? 'Session cap reached' : 'Session finished'}</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card">
          <div className="muted text-xs uppercase">Answers</div>
          <div className="text-2xl font-semibold tabular-nums">{r.length}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase">New</div>
          <div className="text-2xl font-semibold tabular-nums">{r.filter((x) => x.wasNew).length}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase">Accuracy</div>
          <div className="text-2xl font-semibold tabular-nums">{pct(correct / r.length)}</div>
        </div>
        <div className="card">
          <div className="muted text-xs uppercase">Time</div>
          <div className="text-2xl font-semibold tabular-nums">{formatDuration(Date.now() - state.startedAt)}</div>
        </div>
      </div>
      {weakest.length > 0 && (
        <div className="card">
          <h2 className="mb-2 font-medium">Weakest tags this session</h2>
          <ul className="space-y-1 text-sm">
            {weakest.map(([tag, m]) => (
              <li key={tag} className="flex justify-between">
                <span>#{tag}</span>
                <span className="muted tabular-nums">
                  {m.miss}/{m.total} missed
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {source.kind === 'drill' && state.drill && (
        <p className="text-sm">
          {state.drill.ready.length}/{state.drill.total.length} cards ready. They continue in your normal reviews.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Link to="/" className="inline-flex items-center rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-700">
          Home
        </Link>
        {onUndo && (
          <Button onClick={onUndo}>
            Undo last <Kbd>Z</Kbd>
          </Button>
        )}
      </div>
    </div>
  )
}
