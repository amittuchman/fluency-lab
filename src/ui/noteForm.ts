import { normalizeTag } from '../domain/tags'
import type { NoteContent, NoteType } from '../domain/types'
import { uniq } from '../domain/util'

export function emptyContent(type: NoteType): NoteContent {
  switch (type) {
    case 'vocab':
      return { type, fields: { term: '', definition: '', examples: [] } }
    case 'sentence':
      return { type, fields: { text: '' } }
    case 'fix':
      return { type, fields: { wrong: '', right: '', rule: '' } }
    case 'natural':
      return { type, fields: { mine: '', natural: '' } }
    case 'tense':
      return { type, fields: { sentence: '', tense: 'present-simple' } }
    case 'cloze':
      return { type, fields: { text: '' } }
  }
}

export function parseTags(text: string): string[] {
  return uniq(
    text
      .split(/[\s,]+/)
      .map(normalizeTag)
      .filter((t): t is string => !!t),
  )
}

const REQUIRED_FIELDS = new Set(['term', 'definition', 'examples', 'text', 'wrong', 'right', 'rule', 'mine', 'natural', 'sentence', 'tense'])

/** Trim values and drop empty optional fields so stored notes stay clean. */
export function cleanContent(c: NoteContent): NoteContent {
  const fields: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(c.fields)) {
    const val = typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.map((s: string) => s.trim()).filter(Boolean) : v
    const empty = val === '' || (Array.isArray(val) && val.length === 0)
    if (empty && !REQUIRED_FIELDS.has(k)) continue
    fields[k] = val
  }
  return { type: c.type, fields } as unknown as NoteContent
}
