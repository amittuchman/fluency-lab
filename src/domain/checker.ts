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
}

function isTypo(op: DiffOp): boolean {
  if (op.kind !== 'wrong') return false
  const a = op.text.toLowerCase()
  const b = op.expected.toLowerCase()
  return a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1
}

/**
 * Check a typed answer against one or more accepted answers.
 * With typo tolerance, answers whose only differences are 1-letter typos in words of 5+ letters are "almost".
 */
export function checkAnswer(typed: string, accepted: readonly string[], opts: { typoTolerance: boolean }): CheckResult {
  const rank = { correct: 0, almost: 1, wrong: 2 }
  let best: (CheckResult & { cost: number }) | null = null
  for (const reference of accepted.flatMap((a) => a.split('//')).map((a) => a.trim()).filter(Boolean)) {
    const diff = wordDiff(typed, reference)
    const off = diff.filter((d) => d.kind !== 'equal')
    const verdict: Verdict = off.length === 0 ? 'correct' : opts.typoTolerance && off.every(isTypo) ? 'almost' : 'wrong'
    const cost = rank[verdict] * 1000 + off.length
    if (!best || cost < best.cost) best = { verdict, diff, reference, cost }
  }
  if (!best) return { verdict: 'wrong', diff: [], reference: '' }
  return { verdict: best.verdict, diff: best.diff, reference: best.reference }
}

export function suggestedGrade(verdict: Verdict): Grade {
  return verdict === 'correct' ? 3 : verdict === 'almost' ? 2 : 1
}
