import { useCallback, useEffect, useRef, useState } from 'react'
import { cheatSheetFor, highlightSignals } from '../../domain/cheatsheets'
import { checkAnswer, suggestedGrade, type CheckResult } from '../../domain/checker'
import { acceptedTwin, detectTenses, guessPerson } from '../../domain/conjugator'
import type { Prompt, Reveal as RevealInfo } from '../../domain/prompt'
import { tenseLabel } from '../../domain/tags'
import type { Grade, TenseName } from '../../domain/types'
import { isTypingTarget, useCheatSheets } from '../hooks'
import { Diff } from './Diff'
import { Button, Kbd } from './ui'

export interface CardAnswer {
  grade: Grade
  correct: boolean
  userAnswer: string | null
  responseMs: number
}

interface Props {
  prompt: Prompt
  /** Interval labels per grade ("4d"); null in quiz mode (no grading, just Next). */
  intervals: Record<Grade, string> | null
  onDone: (answer: CardAnswer) => void
  /** Time-signal phrases to highlight in the sentence (Tense Lab drills). */
  signals?: string[]
}

function Signals({ text, signals }: { text: string; signals?: string[] }) {
  if (!signals?.length) return <>{text}</>
  return (
    <>
      {highlightSignals(text, signals).map((part, i) =>
        part.signal ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-inherit dark:bg-amber-900/50" title="time signal">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

function CheatSheetDetails({ tense }: { tense: TenseName }) {
  const sheet = cheatSheetFor(tense, useCheatSheets())
  return (
    <details className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
      <summary className="cursor-pointer text-sm font-medium">Cheat-sheet: {tenseLabel(tense)}</summary>
      <dl className="mt-2 space-y-1 text-sm">
        <div>
          <dt className="muted inline">Form: </dt>
          <dd className="inline">{sheet.form}</dd>
        </div>
        <div>
          <dt className="muted inline">Use: </dt>
          <dd className="inline">{sheet.use}</dd>
        </div>
        <div>
          <dt className="muted inline">Signals: </dt>
          <dd className="inline">{sheet.signals.join(', ')}</dd>
        </div>
        {sheet.examples.map((e) => (
          <dd key={e} className="italic">
            {e}
          </dd>
        ))}
      </dl>
    </details>
  )
}

const GRADE_LABELS: Record<Grade, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }

/**
 * One card: answer → reveal → grade. Remount (via key) for each new card.
 * Keys: Enter submits / accepts the suggested grade; 1–4 grade; Space reveals a flip card;
 * number keys pick a multiple-choice option.
 */
export function StudyCard({ prompt, intervals, onDone, signals }: Props) {
  const started = useRef(Date.now())
  const answeredAt = useRef<number | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [text, setText] = useState('')
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const [almostNote, setAlmostNote] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  const suggested: Grade | null =
    prompt.kind === 'flip' ? null : prompt.kind === 'choice' ? (chosen === prompt.correctIndex ? 3 : 1) : check ? suggestedGrade(check.verdict) : null

  const reveal = useCallback(() => {
    answeredAt.current = Date.now()
    setRevealed(true)
  }, [])

  const submitTyped = () => {
    if (prompt.kind !== 'typed' || revealed) return
    const result = checkAnswer(text, prompt.accepted, { typoTolerance: prompt.typoTolerance })
    const twin = result.verdict === 'wrong' && prompt.tenseInfo ? acceptedTwin(text, prompt.tenseInfo) : null
    if (twin) {
      setCheck({ ...result, verdict: 'almost' })
      setAlmostNote(`Also correct here: the ${tenseLabel(twin).toLowerCase()} works with this duration. The target form is the ${tenseLabel(prompt.tenseInfo!.tense).toLowerCase()}.`)
    } else {
      setCheck(result)
      setAlmostNote(result.verdict === 'almost' ? 'Almost: one-letter typo, accepted' : null)
    }
    reveal()
  }

  const choose = useCallback(
    (i: number) => {
      if (prompt.kind !== 'choice' || revealed) return
      setChosen(i)
      reveal()
    },
    [prompt, revealed, reveal],
  )

  const finish = useCallback(
    (grade: Grade) => {
      const userAnswer = prompt.kind === 'typed' ? text : prompt.kind === 'choice' && chosen !== null ? (prompt.options[chosen] ?? null) : null
      onDone({ grade, correct: grade > 1, userAnswer, responseMs: (answeredAt.current ?? Date.now()) - started.current })
    },
    [prompt, text, chosen, onDone],
  )

  useEffect(() => {
    if (revealed) panelRef.current?.focus()
  }, [revealed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e)) return
      if (!revealed) {
        if (prompt.kind === 'flip' && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault()
          reveal()
        } else if (prompt.kind === 'choice' && /^[1-9]$/.test(e.key) && Number(e.key) <= prompt.options.length) {
          e.preventDefault()
          choose(Number(e.key) - 1)
        }
        return
      }
      if (e.key === 'Enter' || (e.key === ' ' && !intervals)) {
        e.preventDefault()
        finish(suggested ?? 3)
      } else if (intervals && /^[1-4]$/.test(e.key)) {
        e.preventDefault()
        finish(Number(e.key) as Grade)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, prompt, intervals, suggested, reveal, choose, finish])

  const verdict = prompt.kind === 'typed' ? check?.verdict : prompt.kind === 'choice' && chosen !== null ? (chosen === prompt.correctIndex ? 'correct' : 'wrong') : undefined

  return (
    <div className="card outline-none" ref={panelRef} tabIndex={-1}>
      <p className="muted mb-3 text-sm">{prompt.instruction}</p>

      {prompt.kind === 'flip' && (
        <div className="py-4 text-center">
          <p className="text-3xl font-semibold">{prompt.front}</p>
          {prompt.frontSub && <p className="muted mt-1 text-sm italic">{prompt.frontSub}</p>}
        </div>
      )}

      {prompt.prompt && (
        <p
          className={`mb-3 text-lg ${prompt.promptIsHebrew ? 'he text-xl' : ''} ${prompt.kind !== 'flip' && !prompt.context ? 'font-medium' : 'muted'}`}
          dir="auto"
        >
          {prompt.kind === 'typed' && prompt.instruction.startsWith('Complete the natural') ? <span className="muted">Your version: </span> : null}
          {prompt.prompt}
        </p>
      )}

      {prompt.context && (
        <p className="mb-3 text-xl leading-9">
          <Signals text={prompt.context.before} signals={signals} />
          <span
            className={`mx-0.5 inline-block min-w-16 rounded border-b-2 px-1 text-center font-semibold ${
              revealed
                ? verdict === 'wrong'
                  ? 'border-rose-500 text-rose-700 dark:text-rose-300'
                  : 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
                : 'border-sky-500 text-sky-700 dark:text-sky-300'
            }`}
          >
            {revealed ? prompt.reveal.answer : ' ? '}
          </span>
          <Signals text={prompt.context.after} signals={signals} />
        </p>
      )}

      {prompt.hint && !(prompt.kind === 'typed' && prompt.prompt === prompt.hint) && (
        <p className="muted mb-3 text-sm">
          Hint: <span className="italic">{prompt.hint}</span>
        </p>
      )}

      {prompt.kind === 'typed' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitTyped()
          }}
        >
          {prompt.multiline ? (
            <textarea
              ref={inputRef}
              className="input min-h-20 resize-y"
              value={text}
              autoFocus
              readOnly={revealed}
              aria-label="Your answer"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submitTyped()
                }
              }}
            />
          ) : (
            <input
              ref={inputRef}
              className="input"
              value={text}
              autoFocus
              readOnly={revealed}
              aria-label="Your answer"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
            />
          )}
          {!revealed && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="muted text-xs">
                <Kbd>Enter</Kbd> check{prompt.multiline ? ' · Shift+Enter new line' : ''}
              </span>
              <Button variant="primary" type="submit">
                Check
              </Button>
            </div>
          )}
        </form>
      )}

      {prompt.kind === 'choice' && (
        <div className="grid gap-2">
          {prompt.options.map((opt, i) => {
            const state = !revealed ? '' : i === prompt.correctIndex ? 'correct' : i === chosen ? 'wrong' : 'other'
            return (
              <button
                key={i}
                type="button"
                disabled={revealed}
                onClick={() => choose(i)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-base transition-colors ${
                  state === 'correct'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40'
                    : state === 'wrong'
                      ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40'
                      : 'border-slate-300 hover:border-sky-500 hover:bg-sky-50 dark:border-slate-700 dark:hover:bg-slate-800'
                } ${state === 'other' ? 'opacity-60' : ''}`}
              >
                <Kbd>{i + 1}</Kbd>
                <span>{opt}</span>
              </button>
            )
          })}
        </div>
      )}

      {prompt.kind === 'flip' && !revealed && (
        <div className="mt-2 flex justify-center">
          <Button variant="primary" size="lg" onClick={reveal} autoFocus>
            Show answer <Kbd>Space</Kbd>
          </Button>
        </div>
      )}

      {revealed && (
        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800" aria-live="polite">
          {verdict && <VerdictLine verdict={verdict} almostNote={almostNote} />}
          {prompt.kind === 'typed' && check && check.verdict !== 'correct' && (
            <div>
              <Diff ops={check.diff} />
            </div>
          )}
          {prompt.kind === 'typed' && check?.verdict === 'wrong' && prompt.tenseInfo && (
            <TenseFeedback typed={text} info={prompt.tenseInfo} why={prompt.reveal.why} />
          )}
          <RevealDetails reveal={prompt.reveal} kind={prompt.kind} showAnswer={prompt.kind === 'flip' || (prompt.kind === 'typed' && check?.verdict !== 'correct' && !prompt.context)} />
          {prompt.reveal.tense && <CheatSheetDetails tense={prompt.reveal.tense} />}
          <GradeBar intervals={intervals} suggested={suggested} onGrade={finish} />
        </div>
      )}
    </div>
  )
}

function VerdictLine({ verdict, almostNote }: { verdict: 'correct' | 'almost' | 'wrong'; almostNote: string | null }) {
  const map = {
    correct: ['Correct', 'text-emerald-700 dark:text-emerald-300'],
    almost: [almostNote ?? 'Almost', 'text-amber-700 dark:text-amber-300'],
    wrong: ['Not quite', 'text-rose-700 dark:text-rose-300'],
  } as const
  return <p className={`font-semibold ${map[verdict][1]}`}>{map[verdict][0]}</p>
}

function TenseFeedback({ typed, info, why }: { typed: string; info: { verb: string; tense: TenseName; before: string }; why?: string }) {
  const person = guessPerson(info.before)
  const persons = [person, 'I', 'he', 'they'] as const
  let used: TenseName | undefined
  for (const p of persons) {
    used = detectTenses(typed, info.verb, p).find((t) => t !== info.tense)
    if (used) break
  }
  if (!used) return null
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      You used the <strong>{tenseLabel(used).toLowerCase()}</strong>; this context needs the <strong>{tenseLabel(info.tense).toLowerCase()}</strong>
      {why ? ` because ${why.replace(/\.$/, '')}.` : '.'}
    </p>
  )
}

function RevealDetails({ reveal, kind, showAnswer }: { reveal: RevealInfo; kind: Prompt['kind']; showAnswer: boolean }) {
  return (
    <div className="space-y-2 text-sm">
      {showAnswer && <p className="text-lg font-medium">{kind === 'flip' ? reveal.definition : reveal.answer}</p>}
      {kind !== 'flip' && reveal.full && reveal.full !== reveal.answer && <p className="text-base">{reveal.full}</p>}
      {reveal.original && kind !== 'flip' && (
        <p>
          <span className="muted">Original: </span>
          <span className="line-through decoration-rose-500/70">{reveal.original}</span>
        </p>
      )}
      {reveal.rule && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
          <span className="font-medium">Rule: </span>
          {reveal.rule}
        </p>
      )}
      {(reveal.tense || reveal.why) && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800">
          {reveal.tense && <span className="font-medium">{tenseLabel(reveal.tense)}</span>}
          {reveal.tense && reveal.why ? ': ' : ''}
          {reveal.why}
        </p>
      )}
      {kind !== 'flip' && reveal.definition && <p className="muted">{reveal.definition}</p>}
      {reveal.examples && reveal.examples.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {reveal.examples.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
      {reveal.collocations && reveal.collocations.length > 0 && <p className="muted">Collocations: {reveal.collocations.join(' · ')}</p>}
      {reveal.he && (
        <p className="he text-base" dir="auto">
          {reveal.he}
        </p>
      )}
      {reveal.notes && <p className="muted italic">{reveal.notes}</p>}
    </div>
  )
}

function GradeBar({ intervals, suggested, onGrade }: { intervals: Record<Grade, string> | null; suggested: Grade | null; onGrade: (g: Grade) => void }) {
  if (!intervals) {
    return (
      <div className="flex justify-end pt-2">
        <Button variant="primary" onClick={() => onGrade(suggested ?? 3)}>
          Next <Kbd>Enter</Kbd>
        </Button>
      </div>
    )
  }
  const tones: Record<Grade, string> = {
    1: 'border-rose-400 text-rose-700 dark:text-rose-300',
    2: 'border-amber-400 text-amber-700 dark:text-amber-300',
    3: 'border-emerald-500 text-emerald-700 dark:text-emerald-300',
    4: 'border-sky-500 text-sky-700 dark:text-sky-300',
  }
  return (
    <div className="pt-2">
      <div className="grid grid-cols-4 gap-2">
        {([1, 2, 3, 4] as Grade[]).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => onGrade(g)}
            className={`rounded-lg border-2 px-1 py-2 text-sm font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${tones[g]} ${
              (suggested ?? 3) === g ? 'bg-slate-100 ring-2 ring-offset-1 ring-current dark:bg-slate-800 dark:ring-offset-slate-900' : ''
            }`}
          >
            <span className="block">{GRADE_LABELS[g]}</span>
            <span className="block text-xs opacity-80">
              {g} · {intervals[g]}
            </span>
          </button>
        ))}
      </div>
      <p className="muted mt-2 text-center text-xs">
        <Kbd>Enter</Kbd> accepts {GRADE_LABELS[suggested ?? 3]} · <Kbd>1</Kbd>–<Kbd>4</Kbd> to choose
      </p>
    </div>
  )
}
