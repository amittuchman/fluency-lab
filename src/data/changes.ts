/** Tiny pub/sub: the data layer announces local writes; the sync manager listens to schedule a push. */
type Listener = () => void
const listeners = new Set<Listener>()

export function onLocalChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function announceLocalChange(): void {
  for (const fn of listeners) fn()
}

let last = 0
/** Strictly increasing millisecond timestamp (two writes in the same millisecond still get different stamps). */
export function stamp(): number {
  last = Math.max(Date.now(), last + 1)
  return last
}
