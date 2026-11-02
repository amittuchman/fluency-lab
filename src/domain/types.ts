export const NOTE_TYPES = ['vocab', 'sentence', 'fix', 'natural', 'tense', 'cloze'] as const
export type NoteType = (typeof NOTE_TYPES)[number]

/**
 * Optional data any item may carry (import keys in brackets). All optional, so old imports keep working;
 * each one unlocks or sharpens specific exercises.
 */
export interface ItemExtras {
  /** [he:] Hebrew meaning of the correct sentence/word: enables "produce from Hebrew" exercises. */
  he?: string
  /** [prompt:] A situation in which you'd say it: enables "produce from the situation" exercises. */
  prompt?: string
  /** [rule:] Short explanation shown after every attempt. */
  rule?: string
  /** [dist:] Plausible wrong options for multiple choice (instead of guessed ones). */
  distractors?: string[]
  /** [also:] More practice sentences with the same mistake/rule, used for transfer exercises. */
  also?: string[]
}

export interface VocabFields extends ItemExtras {
  term: string
  definition: string
  examples: string[]
  pos?: string
  collocations?: string[]
  notes?: string
}
export interface SentenceFields extends ItemExtras {
  text: string
  notes?: string
}
export interface FixFields extends ItemExtras {
  wrong: string
  right: string
  rule: string
}
export interface NaturalFields extends ItemExtras {
  mine: string
  natural: string
  note?: string
}
export interface TenseFields extends ItemExtras {
  /** Sentence containing cloze markup, e.g. "I {{have been working::work}} here." */
  sentence: string
  /** Canonical tense name, e.g. "present-perfect-continuous". */
  tense: TenseName
  why?: string
}
export interface ClozeFields extends ItemExtras {
  text: string
}

export interface NoteFieldsMap {
  vocab: VocabFields
  sentence: SentenceFields
  fix: FixFields
  natural: NaturalFields
  tense: TenseFields
  cloze: ClozeFields
}

/** A note's type + fields, without storage metadata. */
export type NoteContent = { [K in NoteType]: { type: K; fields: NoteFieldsMap[K] } }[NoteType]

export interface NoteMeta {
  id: string
  tags: string[]
  packageId: string | null
  createdAt: number
  updatedAt: number
  suspended: boolean
  /** Soft delete timestamp; null when the note is live. */
  deletedAt: number | null
}

export type Note = NoteContent & NoteMeta

export const TENSE_TIMES = ['past', 'present', 'future'] as const
export const TENSE_ASPECTS = ['simple', 'continuous', 'perfect', 'perfect-continuous'] as const
export type TenseTime = (typeof TENSE_TIMES)[number]
export type TenseAspect = (typeof TENSE_ASPECTS)[number]
export type TenseName = `${TenseTime}-${TenseAspect}`

/** ts-fsrs State enum values: 0 New, 1 Learning, 2 Review, 3 Relearning. */
export type FsrsStateValue = 0 | 1 | 2 | 3

/** FSRS memory state, stored with plain numbers (dates as epoch ms). */
export interface FsrsState {
  due: number
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: FsrsStateValue
  lastReview: number | null
}

export interface Card {
  id: string
  noteId: string
  template: string
  /** Position in the note's unlock chain (0 = first). Independent templates all use 0. */
  order: number
  fsrs: FsrsState
  suspended: boolean
  buriedUntil: number | null
  leech: boolean
  unlocked: boolean
  /** Hash of what the card asks; when it changes on edit, scheduling resets. */
  contentHash: string
  /** Set by the quiz "put misses at the front" action; cleared after the next review. */
  priority: boolean
  createdAt: number
  /**
   * When the schedule was reset (note content edited) or restored (undo). Sync orders card versions by
   * max(last review, resetAt), so a reset or an undo is not overwritten by the older review state.
   */
  resetAt?: number
  /**
   * Exercise difficulty for this item, 1–5 (L1 recognize … L5 produce from Hebrew/situation, no support).
   * Up after 2 clean answers in a row, down after 2 mistakes in a row. Missing on old cards = 1.
   */
  level?: Level
  /** Clean answers in a row at the current level. */
  cleanStreak?: number
  /** Mistakes in a row at the current level. */
  missStreak?: number
}

/** 1 Again, 2 Hard, 3 Good, 4 Easy (same values as ts-fsrs Rating). */
export type Grade = 1 | 2 | 3 | 4

export type ReviewMode = 'session' | 'drill' | 'quiz'

export interface ReviewLog {
  id: string
  cardId: string
  noteId: string
  template: string
  timestamp: number
  rating: Grade
  correct: boolean
  responseMs: number
  mode: ReviewMode
  userAnswer: string | null
  /** Whether this review changed FSRS scheduling (extra drill passes do not). */
  scheduled: boolean
  /** Full card snapshot before the review, for exact undo and stats. */
  cardBefore: Card
  /** Side effects to revert on undo. */
  effects: { buried: string[]; unlocked: string[] }
  /** Which exercise was shown, at which level (absent on logs from before the exercise redesign). */
  exercise?: string
  level?: Level
}

export interface Package {
  id: string
  name: string
  createdAt: number
  sourceText: string
}

export type QuizSource =
  | { kind: 'package'; packageId: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'weak' }
  | { kind: 'due' }
  | { kind: 'random' }

export type QuizFormat = 'choice' | 'cloze' | 'production'

export interface QuizConfig {
  source: QuizSource
  length: number
  formats: QuizFormat[]
  timerSeconds: number | null
}

export interface QuizQuestionResult {
  cardId: string
  noteId: string
  template: string
  correct: boolean
  userAnswer: string
  expected: string
  tags: string[]
}

export interface QuizResult {
  id: string
  timestamp: number
  config: QuizConfig
  questions: QuizQuestionResult[]
  score: number
  durationMs: number
}

export type SessionCap = { kind: 'none' } | { kind: 'cards'; value: number } | { kind: 'minutes'; value: number }

export interface Settings {
  newPerDay: number
  maxReviewsPerDay: number
  desiredRetention: number
  rolloverHour: number
  /** Stability (days) the previous template needs before the next unlocks: [→2nd, →3rd, →4th]. */
  unlockThresholds: [number, number, number]
  promptLanguage: 'english' | 'hebrew'
  ttsVoiceURI: string | null
  ttsRate: number
  ttsAutoplay: boolean
  theme: 'system' | 'light' | 'dark'
  sessionCap: SessionCap
}

export const DEFAULT_SETTINGS: Settings = {
  newPerDay: 25,
  maxReviewsPerDay: 150,
  desiredRetention: 0.9,
  rolloverHour: 4,
  unlockThresholds: [2, 5, 14],
  promptLanguage: 'english',
  ttsVoiceURI: null,
  ttsRate: 1,
  ttsAutoplay: false,
  theme: 'system',
  sessionCap: { kind: 'none' },
}

export const LEECH_LAPSES = 6

export type Level = 1 | 2 | 3 | 4 | 5
