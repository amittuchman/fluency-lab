import type { ReviewLog } from './types'

/** Correct answers in a row a card needs to count as "ready". */
export const DRILL_REQUIRED = 2

export interface DrillState {
  total: string[]
  queue: string[]
  streak: Record<string, number>
  ready: string[]
}

export function startDrill(cardIds: string[], alreadyReady: string[] = []): DrillState {
  const ready = cardIds.filter((id) => alreadyReady.includes(id))
  return {
    total: cardIds,
    queue: cardIds.filter((id) => !ready.includes(id)),
    streak: {},
    ready,
  }
}

/**
 * Record an answer to the card at the front of the queue. A card leaves the loop after
 * DRILL_REQUIRED correct answers in a row; otherwise it comes back a few cards later.
 */
export function answerDrill(state: DrillState, cardId: string, correct: boolean): DrillState {
  const queue = [...state.queue]
  const idx = queue.indexOf(cardId)
  if (idx >= 0) queue.splice(idx, 1)
  const streak = { ...state.streak, [cardId]: correct ? (state.streak[cardId] ?? 0) + 1 : 0 }
  if (streak[cardId]! >= DRILL_REQUIRED) {
    return { ...state, queue, streak, ready: [...state.ready, cardId] }
  }
  const gap = correct ? 5 : 3
  queue.splice(Math.min(gap, queue.length), 0, cardId)
  return { ...state, queue, streak }
}

/** Undo the last answer for a card: put it back at the front and restore its previous streak. */
export function undoDrill(state: DrillState, cardId: string, prevStreak: number): DrillState {
  const queue = state.queue.filter((id) => id !== cardId)
  return {
    ...state,
    queue: [cardId, ...queue],
    streak: { ...state.streak, [cardId]: prevStreak },
    ready: state.ready.filter((id) => id !== cardId),
  }
}

/** A card is ready when its last DRILL_REQUIRED answers (any mode) were correct. */
export function isReadyFromLogs(logs: readonly ReviewLog[]): boolean {
  const recent = [...logs].sort((a, b) => b.timestamp - a.timestamp).slice(0, DRILL_REQUIRED)
  return recent.length === DRILL_REQUIRED && recent.every((l) => l.correct)
}
