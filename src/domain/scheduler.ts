import { fsrs, generatorParameters, type Card as TsCard, type FSRS, type Grade as TsGrade } from 'ts-fsrs'
import type { FsrsState, FsrsStateValue, Grade } from './types'

export const MAX_INTERVAL_DAYS = 365

export function emptyFsrs(now: number): FsrsState {
  return {
    due: now,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
  }
}

function toTs(s: FsrsState): TsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    ...(s.lastReview != null ? { last_review: new Date(s.lastReview) } : {}),
  }
}

function fromTs(c: TsCard): FsrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as FsrsStateValue,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  }
}

/**
 * ts-fsrs keeps Easy > Good > Hard by at least a day, which can push an interval 1–2 days past
 * maximum_interval. Enforce the hard cap here.
 */
function capInterval(s: FsrsState, now: number): FsrsState {
  if (s.scheduledDays <= MAX_INTERVAL_DAYS) return s
  const due = new Date(now)
  due.setDate(due.getDate() + MAX_INTERVAL_DAYS)
  return { ...s, scheduledDays: MAX_INTERVAL_DAYS, due: due.getTime() }
}

export interface SchedulerOptions {
  desiredRetention: number
  /** Interval fuzz; on in the app, off in tests for determinism. */
  fuzz?: boolean
}

export class Scheduler {
  private readonly f: FSRS

  constructor(opts: SchedulerOptions) {
    this.f = fsrs(
      generatorParameters({
        request_retention: opts.desiredRetention,
        maximum_interval: MAX_INTERVAL_DAYS,
        enable_fuzz: opts.fuzz ?? true,
        enable_short_term: true,
      }),
    )
  }

  review(state: FsrsState, grade: Grade, now: number): FsrsState {
    return capInterval(fromTs(this.f.next(toTs(state), new Date(now), grade as TsGrade).card), now)
  }

  /** Next state for each grade, for the "Good · 4d" button labels. */
  preview(state: FsrsState, now: number): Record<Grade, FsrsState> {
    const p = this.f.repeat(toTs(state), new Date(now))
    const c = (g: TsGrade) => capInterval(fromTs(p[g].card), now)
    return { 1: c(1), 2: c(2), 3: c(3), 4: c(4) }
  }

  retrievability(state: FsrsState, now: number): number {
    if (state.state === 0) return 0
    return this.f.get_retrievability(toTs(state), new Date(now), false)
  }
}

/** "1m", "10m", "3h", "4d", "2.5mo", "1.2y". */
export function formatInterval(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `${min}m`
  const hours = min / 60
  if (hours < 24) return `${Math.round(hours)}h`
  const days = hours / 24
  if (days < 30) return `${Math.round(days)}d`
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}mo`
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}y`
}

// ---------- study days (rollover at a local hour, default 4:00) ----------

/** Start of the study day containing `ts`. */
export function dayStart(ts: number, rolloverHour: number): number {
  const d = new Date(ts)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), rolloverHour)
  if (d.getTime() < start.getTime()) start.setDate(start.getDate() - 1)
  return start.getTime()
}

/** Start of the next study day (DST-safe: uses calendar arithmetic, not +24h). */
export function dayEnd(ts: number, rolloverHour: number): number {
  const start = new Date(dayStart(ts, rolloverHour))
  start.setDate(start.getDate() + 1)
  return start.getTime()
}

/** "YYYY-MM-DD" label of the study day containing `ts`. */
export function dayKey(ts: number, rolloverHour: number): string {
  const d = new Date(dayStart(ts, rolloverHour))
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The study-day key `offset` days before the day containing `ts`. */
export function shiftDayKey(ts: number, rolloverHour: number, offset: number): string {
  const d = new Date(dayStart(ts, rolloverHour))
  d.setDate(d.getDate() - offset)
  return dayKey(d.getTime(), rolloverHour)
}
