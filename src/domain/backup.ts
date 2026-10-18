import { NOTE_TYPES, type Card, type Note, type Package, type QuizResult, type ReviewLog, type Settings } from './types'

export const BACKUP_APP = 'fluency-lab'

export interface BackupFile {
  app: typeof BACKUP_APP
  schemaVersion: number
  exportedAt: number
  tables: {
    notes: Note[]
    cards: Card[]
    reviewLogs: ReviewLog[]
    packages: Package[]
    quizzes: QuizResult[]
    settings: Settings
    meta: Array<{ key: string; value: unknown }>
  }
}

export interface BackupCounts {
  notes: number
  cards: number
  reviewLogs: number
  packages: number
  quizzes: number
}

export type BackupValidation = { ok: true; file: BackupFile; counts: BackupCounts } | { ok: false; errors: string[] }

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** Structural validation of a backup file before anything is written. */
export function validateBackup(data: unknown, currentSchemaVersion: number): BackupValidation {
  const errors: string[] = []
  const fail = (msg: string) => {
    if (errors.length < 12) errors.push(msg)
  }
  if (!isObj(data)) return { ok: false, errors: ['Not a JSON object.'] }
  if (data.app !== BACKUP_APP) fail('Not a Fluency Lab backup (missing "app": "fluency-lab").')
  if (typeof data.schemaVersion !== 'number') fail('Missing schemaVersion.')
  else if (data.schemaVersion > currentSchemaVersion) fail(`Backup is from a newer version (schema ${data.schemaVersion}). Update the app first.`)
  const t = data.tables
  if (!isObj(t)) return { ok: false, errors: [...errors, 'Missing "tables".'] }

  const arr = (name: string, check: (r: Obj, i: number) => void) => {
    const list = t[name]
    if (!Array.isArray(list)) {
      fail(`"${name}" must be an array.`)
      return 0
    }
    list.forEach((r, i) => {
      if (!isObj(r) || typeof r.id !== 'string') fail(`${name}[${i}]: missing id.`)
      else check(r, i)
    })
    return list.length
  }
  const counts: BackupCounts = {
    notes: arr('notes', (r, i) => {
      if (!(NOTE_TYPES as readonly string[]).includes(r.type as string)) fail(`notes[${i}]: bad type.`)
      if (!isObj(r.fields)) fail(`notes[${i}]: missing fields.`)
      if (!Array.isArray(r.tags)) fail(`notes[${i}]: missing tags.`)
    }),
    cards: arr('cards', (r, i) => {
      if (typeof r.noteId !== 'string') fail(`cards[${i}]: missing noteId.`)
      if (!isObj(r.fsrs) || typeof r.fsrs.due !== 'number') fail(`cards[${i}]: bad FSRS state.`)
    }),
    reviewLogs: arr('reviewLogs', (r, i) => {
      if (typeof r.cardId !== 'string' || typeof r.timestamp !== 'number') fail(`reviewLogs[${i}]: missing cardId/timestamp.`)
    }),
    packages: arr('packages', (r, i) => {
      if (typeof r.name !== 'string') fail(`packages[${i}]: missing name.`)
    }),
    quizzes: arr('quizzes', () => {}),
  }
  if (!isObj(t.settings)) fail('Missing settings.')
  if (!Array.isArray(t.meta)) fail('"meta" must be an array.')
  if (errors.length) return { ok: false, errors }
  return { ok: true, file: data as unknown as BackupFile, counts }
}
