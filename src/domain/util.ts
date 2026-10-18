/** Straighten curly quotes and apostrophes. */
export function straightenQuotes(s: string): string {
  return s.replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
}

/** 32-bit FNV-1a hash as a short hex string. Stable across sessions. */
export function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Small seeded PRNG (mulberry32) so shuffles are stable for a given card + review count. */
export function seededRandom(seed: string): () => number {
  let a = parseInt(hashString(seed), 16)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

export function newId(): string {
  return crypto.randomUUID()
}

export function uniq<T>(items: readonly T[]): T[] {
  return [...new Set(items)]
}

/** Group items by key (linear time; keeps input order within each group). */
export function groupBy<T>(items: Iterable<T>, key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const k = key(it)
    const list = map.get(k)
    if (list) list.push(it)
    else map.set(k, [it])
  }
  return map
}
