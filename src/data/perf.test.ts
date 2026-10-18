import { parseImport } from '../domain/parser'
import { pickQuizQuestions } from '../domain/quiz'
import { buildDailyQueue } from '../domain/queue'
import { dayEnd, emptyFsrs } from '../domain/scheduler'
import { activityByDay, dueForecast, maturity, streak, tagStats, tenseStats } from '../domain/stats'
import { DEFAULT_SETTINGS, type ReviewLog } from '../domain/types'
import { createDexieRepos, FluencyDB } from './dexie'
import { importPackage, readinessFor } from './services'

const N = 5000
const DAY = 86_400_000
const TENSES = ['present simple', 'past simple', 'present perfect', 'future perfect continuous']

function line(i: number): string {
  const tag = `#topic-${i % 40}`
  switch (i % 6) {
    case 0:
      return `@vocab term${i} | meaning number ${i} | I used term${i} in a sentence. | he: מילה | ${tag}`
    case 1:
      return `@sentence This is key sentence number ${i} about markets. | he: משפט | ${tag}`
    case 2:
      return `@fix I very like item ${i}. => I really like item ${i}. | rule: very + verb | ${tag}`
    case 3:
      return `@natural This is very good ${i}. => This works well ${i}. | ${tag}`
    case 4:
      return `@tense They {{worked::work}} on item ${i} last year. | tense: ${TENSES[i % 4]} | ${tag}`
    default:
      return `@cloze Rates {{rose}} by ${i} points in {{May}}. | ${tag}`
  }
}

/**
 * Budgets are ~10–30x the measured times (5–90 ms): they catch real regressions (parsing once took 2.8 s)
 * without failing on a busy or slow machine.
 */
function time<T>(label: string, budgetMs: number, fn: () => T): T {
  const t0 = performance.now()
  const out = fn()
  const ms = performance.now() - t0
  console.info(`${label}: ${ms.toFixed(0)} ms`)
  expect(ms, label).toBeLessThan(budgetMs)
  return out
}

it(`stays fast with ${N} notes`, { timeout: 120_000 }, async () => {
  const db = new FluencyDB('perf')
  const repos = createDexieRepos(db)
  const now = new Date(2026, 9, 18, 12).getTime()
  const text = Array.from({ length: N }, (_, i) => line(i)).join('\n')

  const parsed = time('parse 5000 lines', 2000, () => parseImport(text))
  expect(parsed.items.filter((i) => i.status === 'error')).toHaveLength(0)
  const t0 = performance.now()
  await importPackage(repos, { name: 'big', sourceText: text, items: parsed.items.map((i) => ({ content: i.content!, tags: i.tags, action: 'create' as const })) }, now)
  console.info(`import 5000 notes: ${(performance.now() - t0).toFixed(0)} ms`)

  // Give half the cards review history and ~30k logs spread over 90 days.
  const cards = await repos.cards.all()
  const reviewed = cards.map((c, i) => (i % 2 ? c : { ...c, unlocked: true, fsrs: { ...emptyFsrs(now), state: 2 as const, stability: 10, scheduledDays: 10, reps: 3, due: now + ((i % 20) - 5) * DAY, lastReview: now - DAY } }))
  const logs: ReviewLog[] = []
  for (let i = 0; i < 30_000; i++) {
    const c = reviewed[i % reviewed.length]!
    logs.push({ id: `l${i}`, cardId: c.id, noteId: c.noteId, template: c.template, timestamp: now - (i % 90) * DAY, rating: 3, correct: i % 7 !== 0, responseMs: 4000, mode: 'session', userAnswer: null, scheduled: true, cardBefore: c, effects: { buried: [], unlocked: [] } })
  }
  // The computations below are what every screen runs on load; they get plain arrays (fake-indexeddb is far
  // slower than a browser's IndexedDB, so storage speed is checked in the browser instead).
  const notes = await repos.notes.all()
  const allCards = reviewed
  const allLogs = logs
  const noteMap = new Map(notes.map((n) => [n.id, n]))
  const liveIds = new Set(notes.map((n) => n.id))

  time('daily queue', 1000, () => buildDailyQueue({ cards: allCards, notes: noteMap, todayLogs: [], settings: DEFAULT_SETTINGS, now }))
  time('streak', 1000, () => streak(allLogs, now, 4))
  time('tag stats', 1500, () => tagStats(notes, allCards, allLogs))
  time('tense stats', 1000, () => tenseStats(notes, allCards, now, dayEnd(now, 4)))
  time('maturity', 500, () => maturity(allCards))
  time('forecast + heatmap', 1000, () => [dueForecast(allCards, liveIds, now, 4), activityByDay(allLogs, now, 4)])
  time('quiz pick (weak)', 1500, () =>
    pickQuizQuestions({ notes, cards: allCards, logs: allLogs, config: { source: { kind: 'weak' }, length: 20, formats: ['choice', 'cloze', 'production'], timerSeconds: null }, now, dayEndTs: dayEnd(now, 4) }),
  )
  const t2 = performance.now()
  const r = await readinessFor(repos, notes)
  console.info(`readiness for all notes (fake-indexeddb): ${(performance.now() - t2).toFixed(0)} ms, ${r.total} cards`)
  await db.delete()
})
