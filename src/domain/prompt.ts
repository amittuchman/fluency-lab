import type { CheckOptions } from './checker'
import { tokenize } from './checker'
import type { Chunk } from './templates'
import type { Level, Settings, TenseName } from './types'

/**
 * What the study screen renders: one exercise for one item. Built by ./exercises from the item's data,
 * its level, and how long it has been since it was last seen.
 */

/** Everything shown after the answer is revealed. */
export interface Reveal {
  answer: string
  full?: string
  definition?: string
  examples?: string[]
  collocations?: string[]
  he?: string
  rule?: string
  why?: string
  tense?: TenseName
  notes?: string
  original?: string
}

export interface Context {
  before: string
  after: string
}

interface PromptBase {
  /** Which exercise this is and at which level (logged with the review). */
  exercise: string
  level: Level
  instruction: string
  /** Main prompt text (above the input). */
  prompt?: string
  promptIsHebrew?: boolean
  /** The Hebrew meaning, shown under an English prompt (a situation). */
  promptHe?: string
  /** Sentence with a blank. */
  context?: Context
  hint?: string
  reveal: Reveal
  /** Text to read aloud. */
  speak: string
  /**
   * The audio is (part of) the question, so it may play before the reveal (recognition of a shown term,
   * "listen then type"). Otherwise audio would give the answer away and is offered only after the reveal.
   */
  audioPrompt?: boolean
  /** Shown because the item hasn't been seen for a while: a recall exercise instead of the usual one. */
  afterBreak?: boolean
}

export interface FlipPrompt extends PromptBase {
  kind: 'flip'
  front: string
  frontSub?: string
  /** A sentence shown under the front as context (the word in its original example). */
  example?: string
  /** The main line of the back (the meaning). */
  back: string
}

export interface TypedPrompt extends PromptBase {
  kind: 'typed'
  accepted: string[]
  check: CheckOptions
  multiline: boolean
  /** No automatic verdict: the answer is free (e.g. "write your own sentence"); compare with the model and grade. */
  selfCheck?: boolean
  /** For tense items: lets the UI explain a wrong tense. */
  tenseInfo?: { verb: string; tense: TenseName; before: string; sentence: string }
}

export interface ChoicePrompt extends PromptBase {
  kind: 'choice'
  options: string[]
  correctIndex: number
}

/** Say the target sentence aloud; checked with speech recognition. */
export interface SpeakPrompt extends PromptBase {
  kind: 'speak'
  target: string
}

export type Prompt = FlipPrompt | TypedPrompt | ChoicePrompt | SpeakPrompt

export interface PromptOptions {
  promptLanguage: Settings['promptLanguage']
  /** Text-to-speech with an English voice is available. */
  audio?: boolean
  /** Speech recognition is available. */
  speech?: boolean
}

/** Split a sentence around a token chunk, moving edge punctuation out of the answer. */
export function blankChunk(text: string, chunk: Chunk): { context: Context; answer: string } {
  const tokens = tokenize(text)
  let answer = tokens.slice(chunk.start, chunk.end).join(' ')
  const lead = /^[^\p{L}\p{N}]+/u.exec(answer)?.[0] ?? ''
  const trail = /[^\p{L}\p{N}]+$/u.exec(answer)?.[0] ?? ''
  answer = answer.slice(lead.length, answer.length - trail.length)
  const before = tokens.slice(0, chunk.start).join(' ')
  const after = tokens.slice(chunk.end).join(' ')
  return {
    context: { before: (before ? before + ' ' : '') + lead, after: trail + (after ? ' ' + after : '') },
    answer,
  }
}

/** "It depends on you." → "I d o y." */
export function firstLetters(text: string): string {
  return tokenize(text)
    .map((t) => t.replace(/\p{L}[\p{L}']*/gu, (w) => w[0]!))
    .join(' ')
}
