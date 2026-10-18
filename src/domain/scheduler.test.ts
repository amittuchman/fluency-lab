import { buildDailyQueue, interleave } from './queue'
import { dayEnd, dayKey, dayStart, emptyFsrs, formatInterval, Scheduler } from './scheduler'
import { DEFAULT_SETTINGS, type Card, type Note } from './types'
import { answerDrill, startDrill } from './drill'

const HOUR = 3_600_000
const DAY = 24 * HOUR

describe('Scheduler', () => {
  const s = new Scheduler({ desiredRetention: 0.9, fuzz: false })
  const t0 = new Date(2026, 9, 18, 12).getTime()

  it('new card: Again/Hard/Good stay in learning steps, Easy graduates', () => {
    const p = s.preview(emptyFsrs(t0), t0)
    expect(p[1].due - t0).toBe(60_000)
    expect(p[3].due - t0).toBe(10 * 60_000)
    expect(p[3].state).toBe(1)
    expect(p[4].state).toBe(2)
    expect(p[4].due - t0).toBeGreaterThanOrEqual(DAY)
  })

  it('a review card graded Good gets a longer interval than Hard', () => {
    let st = s.review(emptyFsrs(t0), 4, t0)
    const later = st.due
    const p = s.preview(st, later)
    expect(p[3].due).toBeGreaterThan(p[2].due)
    st = s.review(st, 1, later)
    expect(st.lapses).toBe(1)
    expect(st.state).toBe(3)
  })

  it('caps intervals at 365 days', () => {
    let st = s.review(emptyFsrs(t0), 4, t0)
    for (let i = 0; i < 15; i++) st = s.review(st, 4, st.due)
    expect(st.scheduledDays).toBeLessThanOrEqual(365)
  })
})

describe('day rollover', () => {
  it('counts 00:00–03:59 as the previous day at the default 4:00 rollover', () => {
    const lateNight = new Date(2026, 9, 19, 2, 30).getTime()
    expect(dayKey(lateNight, 4)).toBe('2026-10-18')
    expect(dayKey(new Date(2026, 9, 19, 4, 0).getTime(), 4)).toBe('2026-10-19')
    expect(dayStart(lateNight, 4)).toBe(new Date(2026, 9, 18, 4).getTime())
    expect(dayEnd(lateNight, 4)).toBe(new Date(2026, 9, 19, 4).getTime())
  })
  it('honors a custom rollover hour', () => {
    expect(dayKey(new Date(2026, 9, 19, 5).getTime(), 6)).toBe('2026-10-18')
    expect(dayKey(new Date(2026, 9, 19, 5).getTime(), 0)).toBe('2026-10-19')
  })
})

it('formats intervals', () => {
  expect(formatInterval(60_000)).toBe('1m')
  expect(formatInterval(10 * 60_000)).toBe('10m')
  expect(formatInterval(3 * HOUR)).toBe('3h')
  expect(formatInterval(4 * DAY)).toBe('4d')
  expect(formatInterval(75 * DAY)).toBe('2.5mo')
  expect(formatInterval(400 * DAY)).toBe('1.1y')
})

describe('daily queue', () => {
  const now = new Date(2026, 9, 18, 12).getTime()
  const mkNote = (id: string, type: Note['type'], tag: string, createdAt = 0): Note =>
    ({ id, type, fields: {}, tags: [tag], packageId: null, createdAt, updatedAt: 0, suspended: false, deletedAt: null }) as unknown as Note
  const mkCard = (id: string, noteId: string, opts: Partial<Card> & { state?: 0 | 2; due?: number } = {}): Card => ({
    id,
    noteId,
    template: 't',
    order: 0,
    fsrs: { ...emptyFsrs(now), state: opts.state ?? 0, due: opts.due ?? now },
    suspended: false,
    buriedUntil: null,
    leech: false,
    unlocked: true,
    contentHash: '',
    priority: false,
    createdAt: 0,
    ...opts,
  })

  it('puts due reviews first (most overdue first), then new up to the limit; one card per note', () => {
    const notes = new Map(
      [mkNote('a', 'vocab', 'x', 1), mkNote('b', 'fix', 'y', 2), mkNote('c', 'vocab', 'z', 3), mkNote('d', 'tense', 'w', 4)].map((n) => [n.id, n]),
    )
    const cards = [
      mkCard('a1', 'a', { state: 2, due: now - 2 * DAY }),
      mkCard('a2', 'a', { state: 2, due: now - 3 * DAY }),
      mkCard('b1', 'b', { state: 2, due: now - DAY }),
      mkCard('c1', 'c'),
      mkCard('d1', 'd'),
      mkCard('x', 'b', { state: 2, due: now + 10 * DAY }),
    ]
    const q = buildDailyQueue({ cards, notes, todayLogs: [], settings: { ...DEFAULT_SETTINGS, newPerDay: 1 }, now })
    expect(q.queue.map((c) => c.id)).toEqual(['a2', 'b1', 'c1'])
  })

  it('skips suspended, locked, buried and trashed', () => {
    const notes = new Map([mkNote('a', 'vocab', 'x'), { ...mkNote('b', 'vocab', 'x'), deletedAt: 1 }].map((n) => [n.id, n]))
    const cards = [
      mkCard('s', 'a', { suspended: true }),
      mkCard('l', 'a', { unlocked: false }),
      mkCard('bu', 'a', { buriedUntil: now + HOUR }),
      mkCard('t', 'b'),
    ]
    expect(buildDailyQueue({ cards, notes, todayLogs: [], settings: DEFAULT_SETTINGS, now }).queue).toEqual([])
  })

  it('mixes types when picking new cards', () => {
    const notes = new Map(
      [mkNote('a', 'vocab', 'x', 1), mkNote('b', 'vocab', 'x', 2), mkNote('c', 'vocab', 'x', 3), mkNote('d', 'fix', 'y', 4), mkNote('e', 'tense', 'z', 5)].map(
        (n) => [n.id, n],
      ),
    )
    const cards = ['a', 'b', 'c', 'd', 'e'].map((id) => mkCard(id + '1', id))
    const q = buildDailyQueue({ cards, notes, todayLogs: [], settings: { ...DEFAULT_SETTINGS, newPerDay: 3 }, now })
    expect(q.queue.map((c) => c.noteId).sort()).toEqual(['a', 'd', 'e'])
  })

  it('interleaves types', () => {
    const items = ['v1', 'v2', 'v3', 'f1', 'f2', 't1']
    const keys = (s: string): [string, string] => [s[0]!, '']
    expect(interleave(items, keys).map((s) => s[0]).join('')).toBe('vfvfvt')
  })
})

describe('drill loop', () => {
  it('needs two correct answers in a row', () => {
    let s = startDrill(['a', 'b'])
    s = answerDrill(s, 'a', true)
    expect(s.queue).toEqual(['b', 'a'])
    s = answerDrill(s, 'b', false)
    s = answerDrill(s, 'a', true)
    expect(s.ready).toEqual(['a'])
    s = answerDrill(s, 'b', true)
    s = answerDrill(s, 'b', true)
    expect(s.ready).toEqual(['a', 'b'])
    expect(s.queue).toEqual([])
  })
})
