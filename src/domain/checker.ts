import { IRREGULAR_VERBS } from './irregulars'
import type { Grade } from './types'
import { straightenQuotes } from './util'

/**
 * Unambiguous contractions and their expansions. 's and 'd are ambiguous (is/has, had/would)
 * and are deliberately absent: they must match exactly.
 */
const CONTRACTIONS: Record<string, string> = {
  "i'm": 'i am',
  "you're": 'you are',
  "we're": 'we are',
  "they're": 'they are',
  "who're": 'who are',
  "i've": 'i have',
  "you've": 'you have',
  "we've": 'we have',
  "they've": 'they have',
  "who've": 'who have',
  "could've": 'could have',
  "would've": 'would have',
  "should've": 'should have',
  "might've": 'might have',
  "must've": 'must have',
  "i'll": 'i will',
  "you'll": 'you will',
  "he'll": 'he will',
  "she'll": 'she will',
  "it'll": 'it will',
  "we'll": 'we will',
  "they'll": 'they will',
  "that'll": 'that will',
  "there'll": 'there will',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "don't": 'do not',
  "doesn't": 'does not',
  "didn't": 'did not',
  "haven't": 'have not',
  "hasn't": 'has not',
  "hadn't": 'had not',
  "won't": 'will not',
  "wouldn't": 'would not',
  "can't": 'cannot',
  "couldn't": 'could not',
  "shouldn't": 'should not',
  "mustn't": 'must not',
  "needn't": 'need not',
  "mightn't": 'might not',
  "shan't": 'shall not',
  "let's": 'let us',
}

const CONTRACTION_RE = new RegExp(`(?<![\\p{L}'])(${Object.keys(CONTRACTIONS).join('|')})(?![\\p{L}'])`, 'giu')

/** Expand unambiguous contractions; keeps the capital "I". */
export function expandContractions(text: string): string {
  return straightenQuotes(text)
    .replace(CONTRACTION_RE, (m) => {
      const exp = CONTRACTIONS[m.toLowerCase()] ?? m
      const capital = m[0] !== m[0]!.toLowerCase()
      return capital ? exp.charAt(0).toUpperCase() + exp.slice(1) : exp
    })
    .replace(/\bcan not\b/gi, (m) => (m[0] === 'C' ? 'Cannot' : 'cannot'))
}

/** Whitespace tokens of the original text (punctuation attached). */
export function tokenize(text: string): string[] {
  return straightenQuotes(text).trim().split(/\s+/).filter(Boolean)
}

/** Strip leading/trailing punctuation; keep internal apostrophes and hyphens. */
function stripEdges(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

export interface Word {
  display: string
  key: string
}

/** Words used for comparison: quotes straightened, contractions expanded, edge punctuation removed. */
export function compareWords(text: string): Word[] {
  return tokenize(expandContractions(text))
    .map(stripEdges)
    .filter(Boolean)
    .map((w) => ({ display: w, key: w.toLowerCase() }))
}

export function normalizeAnswer(text: string): string {
  return compareWords(text)
    .map((w) => w.key)
    .join(' ')
}

/** Index pairs [i, j] of a longest common subsequence of a and b. */
export function lcsPairs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++
    else j++
  }
  return pairs
}

export type DiffOp =
  | { kind: 'equal'; text: string }
  /** In the reference, not typed. */
  | { kind: 'missing'; text: string }
  /** Typed, not in the reference. */
  | { kind: 'extra'; text: string }
  /** Typed `text` where the reference has `expected`. */
  | { kind: 'wrong'; text: string; expected: string }

/** Word-level diff of a typed answer against a reference. */
export function wordDiff(typed: string, reference: string): DiffOp[] {
  const u = compareWords(typed)
  const r = compareWords(reference)
  const pairs = lcsPairs(
    u.map((w) => w.key),
    r.map((w) => w.key),
  )
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  const flush = (iEnd: number, jEnd: number) => {
    const us = u.slice(i, iEnd)
    const rs = r.slice(j, jEnd)
    const k = Math.min(us.length, rs.length)
    for (let x = 0; x < k; x++) ops.push({ kind: 'wrong', text: us[x]!.display, expected: rs[x]!.display })
    for (const w of rs.slice(k)) ops.push({ kind: 'missing', text: w.display })
    for (const w of us.slice(k)) ops.push({ kind: 'extra', text: w.display })
  }
  for (const [pi, pj] of pairs) {
    flush(pi, pj)
    ops.push({ kind: 'equal', text: r[pj]!.display })
    i = pi + 1
    j = pj + 1
  }
  flush(u.length, r.length)
  return ops
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  let prev = Array.from({ length: b.length + 1 }, (_, k) => k)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]!
}

export type Verdict = 'correct' | 'almost' | 'wrong'

export interface CheckResult {
  verdict: Verdict
  diff: DiffOp[]
  /** The reference answer the typed text was compared with (best of the alternatives). */
  reference: string
  /** Spelling slips that were forgiven (typed → expected). */
  typos: Array<{ typed: string; expected: string }>
  /** 0–1 word overlap with the reference (2·LCS / total), typos counted as matches. */
  similarity: number
}

export interface CheckOptions {
  /**
   * exact: every word must match (contractions, case and punctuation aside).
   * meaning: for free production; a close answer that keeps the key words is "almost" (compare with the model).
   */
  mode?: 'exact' | 'meaning'
  /** tolerate (default): small spelling slips count as correct. strict: spelling is the point. */
  typos?: 'tolerate' | 'strict'
  /** The words that are the point of the exercise (the corrected word, the verb form…): never forgiven. */
  protect?: readonly string[]
}

const INFLECTION = /(ies|ied|ing|es|ed|ly|s|d)$/
const ENDING = /^(s|es|d|ed|ing|ly|er|est|ies|ied)$/

/** A grammar change ("work" → "worked", "advice" → "advices", "rise" → "rose") is not a typo. */
function sameStemDifferentEnding(a: string, b: string): boolean {
  if (a === b) return false
  const strip = (w: string) => w.replace(INFLECTION, '')
  const extends_ = (x: string, y: string) => x.startsWith(y) && ENDING.test(x.slice(y.length))
  return strip(a) === strip(b) || extends_(a, b) || extends_(b, a) || (VERB_FORMS.has(a) && VERB_FORMS.has(b))
}

/** Every form of the irregular verbs (rise, rose, risen…): swapping two of them is grammar, not spelling. */
const VERB_FORMS = new Set(
  Object.entries(IRREGULAR_VERBS).flatMap(([base, [past, pp]]) => [base, ...past.split('|'), ...pp.split('|')]),
)

/** A small spelling slip: 1 letter off in words of 4+ letters, 2 in words of 8+, never on protected words. */
function isForgivableTypo(op: DiffOp, protect: ReadonlySet<string>): boolean {
  if (op.kind !== 'wrong') return false
  const a = op.text.toLowerCase()
  const b = op.expected.toLowerCase()
  if (protect.has(b) || protect.has(a) || sameStemDifferentEnding(a, b)) return false
  const len = Math.min(a.length, b.length)
  if (len < 4) return false
  return levenshtein(a, b) <= (len >= 8 ? 2 : 1)
}

const keyOf = (w: string) => compareWords(w).map((x) => x.key)

/** Close enough in meaning mode: most words shared and every protected word present. */
export const MEANING_ALMOST = 0.75

/**
 * Check a typed answer against one or more accepted answers (alternatives also inside each with //).
 * Small spelling slips are forgiven (the target is speaking), except on the protected words.
 */
export function checkAnswer(typed: string, accepted: readonly string[], opts: CheckOptions = {}): CheckResult {
  const protect = new Set((opts.protect ?? []).flatMap(keyOf))
  const tolerate = (opts.typos ?? 'tolerate') === 'tolerate'
  const rank = { correct: 0, almost: 1, wrong: 2 }
  const typedKeys = new Set(compareWords(typed).map((w) => w.key))
  let best: (CheckResult & { cost: number }) | null = null
  for (const reference of accepted.flatMap((a) => a.split('//')).map((a) => a.trim()).filter(Boolean)) {
    const diff = wordDiff(typed, reference)
    if (tolerate && onlyHyphensDiffer(typed, reference)) {
      // "trade off" / "tradeoff" for "trade-off": spelling only.
      const typos = diff.filter((d) => d.kind !== 'equal').map((d) => ({ typed: d.kind === 'missing' ? '' : d.text, expected: d.kind === 'wrong' ? d.expected : d.kind === 'missing' ? d.text : '' }))
      const merged = { typed: typos.map((t) => t.typed).filter(Boolean).join(' '), expected: typos.map((t) => t.expected).filter(Boolean).join(' ') }
      best = { verdict: 'correct', diff, reference, cost: 1, similarity: 1, typos: [merged] }
      break
    }
    const off = diff.filter((d) => d.kind !== 'equal')
    const forgiven = tolerate ? off.filter((d) => isForgivableTypo(d, protect)) : []
    const matched = diff.filter((d) => d.kind === 'equal').length + forgiven.length
    const typedCount = diff.filter((d) => d.kind !== 'missing').length
    const refCount = diff.filter((d) => d.kind !== 'extra').length
    const similarity = typedCount + refCount ? (2 * matched) / (typedCount + refCount) : 0
    let verdict: Verdict = off.length === forgiven.length ? 'correct' : 'wrong'
    if (verdict === 'wrong' && opts.mode === 'meaning') {
      const keepsPoint = [...protect].every((p) => typedKeys.has(p))
      if (similarity >= MEANING_ALMOST && keepsPoint) verdict = 'almost'
    }
    const cost = rank[verdict] * 1000 + (off.length - forgiven.length) * 10 + forgiven.length
    if (!best || cost < best.cost) {
      best = {
        verdict,
        diff,
        reference,
        cost,
        similarity,
        typos: forgiven.map((d) => ({ typed: (d as { text: string }).text, expected: (d as { expected: string }).expected })),
      }
    }
  }
  if (!best) return { verdict: 'wrong', diff: [], reference: '', typos: [], similarity: 0 }
  const { cost: _, ...result } = best
  return result
}

/** True when two answers differ only in hyphens (written as a space or left out), e.g. "trade off" vs "trade-off". */
function onlyHyphensDiffer(a: string, b: string): boolean {
  const x = normalizeAnswer(a)
  const y = normalizeAnswer(b)
  if (x === y || !/-/.test(x + y)) return false
  const spaced = (s: string) => s.replace(/-/g, ' ')
  const joined = (s: string) => s.replace(/-/g, '')
  return spaced(x) === spaced(y) || joined(x) === joined(y)
}

/** Words of `right` that are not in `wrong`: the actual correction (what a fix exercise is about). */
export function correctionWords(wrong: string, right: string): string[] {
  const a = compareWords(wrong)
  const b = compareWords(right)
  const kept = new Set(lcsPairs(a.map((w) => w.key), b.map((w) => w.key)).map(([, j]) => j))
  return b.filter((_, j) => !kept.has(j)).map((w) => w.display)
}

export interface SpeechCheck {
  verdict: Verdict
  /** 0–1: shared words relative to both lengths (2·LCS / (|said| + |target|)). */
  similarity: number
  transcript: string
  diff: DiffOp[]
}

/** Spoken answers: every word must match for "correct" (a skipped "on" is a real error); near matches are "almost". */
export const SPEECH_CORRECT = 0.98
export const SPEECH_ALMOST = 0.75

/** Compare what the recognizer heard (its alternatives) with the target sentence; the best alternative wins. */
export function checkSpeech(alternatives: readonly string[], target: string): SpeechCheck {
  const t = compareWords(target).map((w) => w.key)
  let best: SpeechCheck = { verdict: 'wrong', similarity: 0, transcript: '', diff: wordDiff('', target) }
  for (const alt of alternatives) {
    const a = compareWords(alt).map((w) => w.key)
    const similarity = a.length + t.length ? (2 * lcsPairs(a, t).length) / (a.length + t.length) : 0
    if (similarity > best.similarity || !best.transcript) {
      const verdict: Verdict = similarity >= SPEECH_CORRECT ? 'correct' : similarity >= SPEECH_ALMOST ? 'almost' : 'wrong'
      best = { verdict, similarity, transcript: alt, diff: wordDiff(alt, target) }
    }
  }
  return best
}

export function suggestedGrade(verdict: Verdict): Grade {
  return verdict === 'correct' ? 3 : verdict === 'almost' ? 2 : 1
}
