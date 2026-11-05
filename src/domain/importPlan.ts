import { duplicateKey } from './parser'
import type { Note, NoteContent, NoteType } from './types'

/**
 * Re-importing an item that's already in the library upgrades it: only the fields it doesn't have yet are
 * filled in from the imported line. Nothing that has a value is overwritten, the main fields (what the item
 * asks, so its progress) are never touched, and no duplicate is created.
 */

/** Fields that define the item (and its card's content hash): never changed by an import. */
const MAIN: Record<NoteType, readonly string[]> = {
  vocab: ['term', 'definition'],
  sentence: ['text'],
  fix: ['wrong', 'right'],
  natural: ['mine', 'natural'],
  tense: ['sentence', 'tense'],
  cloze: ['text'],
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)

export interface Filled {
  note: Note
  /** Names of the fields (and tags) that were added. */
  added: string[]
}

/** `note` with the fields it lacks taken from `content`, and the imported tags it lacks; null if nothing is new. */
export function fillMissing(note: Note, content: NoteContent, tags: readonly string[]): Filled | null {
  if (content.type !== note.type) return null
  const fields: Record<string, unknown> = { ...note.fields }
  const added: string[] = []
  for (const [k, v] of Object.entries(content.fields)) {
    if (MAIN[note.type].includes(k) || isEmpty(v) || !isEmpty(fields[k])) continue
    fields[k] = v
    added.push(k)
  }
  // A mistake has one pattern: an imported pattern is only added if the item has none.
  const hasPattern = note.tags.some((t) => t.startsWith('pattern:'))
  const newTags = tags.filter((t) => !note.tags.includes(t) && !(hasPattern && t.startsWith('pattern:')))
  if (!added.length && !newTags.length) return null
  return { note: { ...note, fields, tags: [...note.tags, ...newTags] } as unknown as Note, added: [...added, ...newTags.map((t) => `#${t}`)] }
}

export interface PlanLine {
  lineNo: number
  content: NoteContent
  tags: string[]
}

export type LineStatus =
  | { kind: 'new' }
  /** `toPackage`: the item has no package and joins the imported one. */
  | { kind: 'update'; note: Note; added: string[]; toPackage: boolean }
  | { kind: 'unchanged'; note: Note; toPackage: boolean }
  /** A second line for the same item in this import: merged into the first one. */
  | { kind: 'same-as'; lineNo: number }

export interface ImportPlan {
  create: PlanLine[]
  /** Existing items with what this import adds to them. */
  update: Array<{ lineNo: number; note: Note; added: string[]; toPackage: boolean }>
  unchanged: number
  /** Existing items no package groups (never had one, or it was deleted): they join the imported package. */
  toPackage: Note[]
  status: Map<number, LineStatus>
}

/**
 * Match each line to the library (type + normalized main text) and to earlier lines of the same import.
 * `packageIds`: the packages that exist; a matched item in none of them joins the imported package.
 */
export function planImport(lines: readonly PlanLine[], library: ReadonlyMap<string, Note>, packageIds: ReadonlySet<string> = new Set()): ImportPlan {
  const status = new Map<number, LineStatus>()
  const groups = new Map<string, PlanLine[]>()
  for (const line of lines) {
    const key = duplicateKey(line.content)
    const group = groups.get(key)
    if (group) {
      status.set(line.lineNo, { kind: 'same-as', lineNo: group[0]!.lineNo })
      group.push(line)
    } else groups.set(key, [line])
  }

  const plan: ImportPlan = { create: [], update: [], unchanged: 0, toPackage: [], status }
  for (const [key, group] of groups) {
    const first = group[0]!
    const existing = library.get(key)
    // Start from the library item, or from the first line as a new item; later lines only fill gaps.
    const base = existing ?? ({ ...first.content, id: '', tags: first.tags, packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null } as Note)
    let merged = base
    const added: string[] = []
    for (const line of existing ? group : group.slice(1)) {
      const f = fillMissing(merged, line.content, line.tags)
      if (f) {
        merged = f.note
        added.push(...f.added.filter((a) => !added.includes(a)))
      }
    }
    if (!existing) {
      plan.create.push({ lineNo: first.lineNo, content: { type: merged.type, fields: merged.fields } as NoteContent, tags: merged.tags })
      status.set(first.lineNo, { kind: 'new' })
      continue
    }
    const toPackage = existing.packageId === null || !packageIds.has(existing.packageId)
    if (toPackage) plan.toPackage.push(existing)
    if (added.length) {
      plan.update.push({ lineNo: first.lineNo, note: merged, added, toPackage })
      status.set(first.lineNo, { kind: 'update', note: existing, added, toPackage })
    } else {
      plan.unchanged++
      status.set(first.lineNo, { kind: 'unchanged', note: existing, toPackage })
    }
  }
  return plan
}
