import { lcsPairs, levenshtein, normalizeAnswer, tokenize } from './checker'
import type { Note } from './types'

/**
 * Wrong options (`dist:`) are often written as just the part that differs ("have study") rather than as a
 * whole sentence. A multiple choice must not mix the two, so a fragment is spliced into the correct sentence
 * in place of the part it corresponds to; for a gap-fill it goes the other way (a whole sentence is cut down
 * to the part in the gap).
 */

const key = (token: string) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
const keys = (text: string) => tokenize(text).map(key)
const same = (a: string, b: string) => normalizeAnswer(a) === normalizeAnswer(b)

/**
 * True when `candidate` is a whole sentence of the same kind as `sentence` (about as long, and a variant of it:
 * at least half the words shared), not a fragment of it.
 */
export function isFullSentence(candidate: string, sentence: string): boolean {
  const c = keys(candidate)
  const s = keys(sentence)
  if (c.length < Math.min(s.length, Math.max(3, Math.ceil(s.length * 0.6)))) return false
  return (2 * lcsPairs(c, s).length) / (c.length + s.length) >= 0.5
}

/** The same word or a form of it (study / studied, go / going). */
function related(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  let p = 0
  while (p < a.length && p < b.length && a[p] === b[p]) p++
  return p >= 4 || (Math.min(a.length, b.length) >= 4 && levenshtein(a, b) <= 1)
}

/** Token range of `right` that a fix changed (the words of `right` not kept from `wrong`). */
function changedSpan(wrong: string, right: string): { start: number; end: number } | null {
  const a = keys(wrong)
  const b = keys(right)
  const kept = new Set(lcsPairs(a, b).map(([, j]) => j))
  const changed = b.map((_, j) => j).filter((j) => !kept.has(j))
  if (!changed.length) return null
  return { start: Math.min(...changed), end: Math.max(...changed) + 1 }
}

/**
 * Put a fragment in place of the part of `correct` it corresponds to: the stretch of the same length (±1)
 * that shares the most words with it, preferring the part the fix changed; with no shared word, the changed
 * part itself if it is about as long (±1 word). Null when there's no sensible place, or the result isn't actually wrong.
 */
export function spliceFragment(fragment: string, correct: string, original?: string): string | null {
  const S = tokenize(correct)
  const F = tokenize(fragment)
  if (!S.length || !F.length) return null
  const fk = F.map(key)
  const span = original ? changedSpan(original, correct) : null

  let best: { start: number; end: number; score: number } | null = null
  for (const len of [F.length, F.length - 1, F.length + 1]) {
    if (len < 1 || len > S.length) continue
    for (let i = 0; i + len <= S.length; i++) {
      const window = S.slice(i, i + len).map(key)
      const shared = fk.filter((f) => window.some((w) => related(f, w))).length
      if (!shared) continue
      const overlapsChange = span && i < span.end && i + len > span.start ? 0.5 : 0
      const score = shared + overlapsChange + (len === F.length ? 0.25 : 0)
      if (!best || score > best.score) best = { start: i, end: i + len, score }
    }
  }
  const at = best ?? (span && Math.abs(span.end - span.start - F.length) <= 1 ? span : null)
  if (!at) return null

  const words = [...F]
  const trailing = /[^\p{L}\p{N}'"’”)]+$/u.exec(S[at.end - 1]!)?.[0]
  if (at.end === S.length && trailing && !/[^\p{L}\p{N}'"’”)]$/u.test(words[words.length - 1]!)) words[words.length - 1] += trailing
  if (at.start === 0) words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1)
  const result = [...S.slice(0, at.start), ...words, ...S.slice(at.end)].join(' ')
  return same(result, correct) ? null : result
}

/**
 * Cut a whole-sentence option down to what goes in the gap (`before` ___ `after`). Null when the sentence
 * doesn't match around the gap.
 */
export function gapFragment(sentence: string, before: string, after: string): string | null {
  const t = tokenize(sentence)
  const b = keys(before).filter(Boolean)
  const a = keys(after).filter(Boolean)
  const tk = t.map(key)
  if (t.length <= b.length + a.length) return null
  if (b.some((w, i) => tk[i] !== w) || a.some((w, i) => tk[t.length - a.length + i] !== w)) return null
  const middle = t.slice(b.length, t.length - a.length).join(' ')
  return middle.replace(/[.!?]+$/, '') || null
}

/** Correct sentence and the original (wrong or less natural) one of a @fix / @natural item. */
function sentencePair(note: Note): { correct: string; original: string; accepted: string[] } | null {
  if (note.type === 'fix') {
    const accepted = note.fields.right.split('//').map((s) => s.trim()).filter(Boolean)
    return { correct: accepted[0] ?? '', original: note.fields.wrong, accepted }
  }
  if (note.type === 'natural') {
    const accepted = note.fields.natural.split('//').map((s) => s.trim()).filter(Boolean)
    return { correct: accepted[0] ?? '', original: note.fields.mine, accepted }
  }
  return null
}

/** One `dist:` entry as a whole sentence (as written, or spliced); null if that isn't possible. */
function asSentence(d: string, pair: { correct: string; original: string }): string | null {
  if (isFullSentence(d, pair.correct)) return d
  return spliceFragment(d, pair.correct, pair.original)
}

/**
 * The `dist:` options of a @fix / @natural item, all as whole sentences, for a sentence choice. Fragments
 * that can't be placed are left out; none equals the correct sentence, the original, or another option.
 */
export function sentenceDistractors(note: Note): string[] {
  const pair = sentencePair(note)
  if (!pair || !pair.correct) return []
  const taken = [...pair.accepted, pair.original]
  const out: string[] = []
  for (const d of (note.fields as { distractors?: string[] }).distractors ?? []) {
    const s = asSentence(d, pair)
    if (s && !taken.some((t) => same(t, s)) && !out.some((o) => same(o, s))) out.push(s)
  }
  return out
}

/**
 * Data repair: the item with its fragment `dist:` entries rewritten as whole sentences. Entries that are
 * already sentences, or can't be placed, are kept exactly as they are (nothing is removed). Null when there's
 * nothing to change, so running it again is a no-op.
 */
export function repairDistractors(note: Note): Note | null {
  const pair = sentencePair(note)
  const dist = (note.fields as { distractors?: string[] }).distractors
  if (!pair || !pair.correct || !dist?.length) return null
  const next = dist.map((d) => (isFullSentence(d, pair.correct) ? d : (spliceFragment(d, pair.correct, pair.original) ?? d)))
  if (next.every((d, i) => d === dist[i])) return null
  return { ...note, fields: { ...note.fields, distractors: next } } as Note
}
