export const NOTE_TYPES = ['vocab', 'sentence', 'fix', 'natural', 'tense', 'cloze'] as const
export type NoteType = (typeof NOTE_TYPES)[number]

export interface VocabFields {
  term: string
  definition: string
  examples: string[]
  he?: string
  pos?: string
  collocations?: string[]
  notes?: string
}
export interface SentenceFields {
  text: string
  he?: string
  notes?: string
}
export interface FixFields {
  wrong: string
  right: string
  rule: string
}
export interface NaturalFields {
  mine: string
  natural: string
  note?: string
}
export interface TenseFields {
  /** Sentence containing cloze markup, e.g. "I {{have been working::work}} here." */
  sentence: string
  /** Canonical tense name, e.g. "present-perfect-continuous". */
  tense: TenseName
  why?: string
}
export interface ClozeFields {
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
  newPerDay: 10,
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
