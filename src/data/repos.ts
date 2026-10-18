import type { Card, Note, Package, QuizResult, ReviewLog, Settings } from '../domain/types'

/**
 * Persistence boundary. UI and services only use these interfaces; the Dexie implementation
 * lives in ./dexie.ts and can be swapped for a syncing backend later.
 */
export interface NoteRepo {
  get(id: string): Promise<Note | undefined>
  getMany(ids: string[]): Promise<Note[]>
  /** Live notes (not in Trash). */
  all(): Promise<Note[]>
  trashed(): Promise<Note[]>
  byPackage(packageId: string): Promise<Note[]>
  put(note: Note): Promise<void>
  bulkPut(notes: Note[]): Promise<void>
  bulkDelete(ids: string[]): Promise<void>
  count(): Promise<number>
}

export interface CardRepo {
  get(id: string): Promise<Card | undefined>
  getMany(ids: string[]): Promise<Card[]>
  all(): Promise<Card[]>
  byNote(noteId: string): Promise<Card[]>
  byNotes(noteIds: string[]): Promise<Card[]>
  put(card: Card): Promise<void>
  bulkPut(cards: Card[]): Promise<void>
  bulkDelete(ids: string[]): Promise<void>
}

export interface ReviewLogRepo {
  add(log: ReviewLog): Promise<void>
  bulkPut(logs: ReviewLog[]): Promise<void>
  /** Most recent log, optionally limited to some modes. */
  last(): Promise<ReviewLog | undefined>
  since(timestamp: number): Promise<ReviewLog[]>
  byCard(cardId: string): Promise<ReviewLog[]>
  byCards(cardIds: string[]): Promise<ReviewLog[]>
  all(): Promise<ReviewLog[]>
  delete(id: string): Promise<void>
}

export interface PackageRepo {
  get(id: string): Promise<Package | undefined>
  all(): Promise<Package[]>
  put(pkg: Package): Promise<void>
  bulkPut(pkgs: Package[]): Promise<void>
  delete(id: string): Promise<void>
}

export interface QuizRepo {
  add(result: QuizResult): Promise<void>
  bulkPut(results: QuizResult[]): Promise<void>
  all(): Promise<QuizResult[]>
}

export interface SettingsRepo {
  get(): Promise<Settings>
  save(settings: Settings): Promise<void>
}

export interface MetaRepo {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  all(): Promise<Array<{ key: string; value: unknown }>>
}

export interface Repos {
  notes: NoteRepo
  cards: CardRepo
  logs: ReviewLogRepo
  packages: PackageRepo
  quizzes: QuizRepo
  settings: SettingsRepo
  meta: MetaRepo
  /** Run `fn` atomically across all stores. */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  /** Delete every record in every store (used by backup "replace"). */
  clearAll(): Promise<void>
}

export const META = {
  schemaVersion: 'schemaVersion',
  templateVersion: 'templateVersion',
  lastBackupAt: 'lastBackupAt',
  onboarding: 'onboarding',
  backupReminderSnoozedAt: 'backupReminderSnoozedAt',
} as const
