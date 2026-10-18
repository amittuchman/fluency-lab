import { clozeCount, clozePlain, parseCloze } from './cloze'
import { normalizeTag, normalizeTense, tenseTag } from './tags'
import { NOTE_TYPES, type NoteContent, type NoteType } from './types'
import { straightenQuotes, uniq } from './util'
import { findTermInExample } from './templates'

export type LineStatus = 'ok' | 'warn' | 'error'

export interface ParsedItem {
  lineNo: number
  raw: string
  status: LineStatus
  messages: string[]
  /** The line has content but no @type; the UI offers to assign one. */
  needsType: boolean
  content: NoteContent | null
  tags: string[]
}

export interface ParseResult {
  format: 'text' | 'json'
  packageName: string | null
  items: ParsedItem[]
}

const KEYS = ['he', 'pos', 'rule', 'note', 'notes', 'tense', 'why', 'coll'] as const
type Key = (typeof KEYS)[number]
const KEY_RE = new RegExp(`^(${KEYS.join('|')})\\s*:\\s*(.*)$`, 'i')
const PACKAGE_RE = /^#\s*package\s*:\s*(.*)$/i
const TYPE_RE = /^@([a-z]+)\b\s*/i

export function parseImport(input: string): ParseResult {
  const trimmed = input.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const json = parseJsonImport(trimmed)
    if (json) return json
  }
  return parseTextImport(input)
}

export function parseTextImport(input: string): ParseResult {
  let packageName: string | null = null
  const items: ParsedItem[] = []
  input.split(/\r?\n/).forEach((rawLine, i) => {
    const line = straightenQuotes(rawLine).trim()
    if (!line || line.startsWith('//')) return
    const pkg = PACKAGE_RE.exec(line)
    if (pkg) {
      packageName = pkg[1]!.trim() || null
      return
    }
    // Other lines starting with "#" (but not "#tag | …") are headings/comments.
    if (line.startsWith('#') && !line.includes('|')) return
    items.push(parseLine(line, i + 1))
  })
  return { format: 'text', packageName, items }
}

/** Parse one item line. Exported so the preview can re-parse an edited line. */
export function parseLine(rawLine: string, lineNo: number): ParsedItem {
  const raw = straightenQuotes(rawLine).trim()
  const base: ParsedItem = { lineNo, raw, status: 'error', messages: [], needsType: false, content: null, tags: [] }
  const typeMatch = TYPE_RE.exec(raw)
  if (!typeMatch) {
    return { ...base, needsType: true, messages: ['No item type. Start the line with @vocab, @sentence, @fix, @natural, @tense or @cloze.'] }
  }
  const type = typeMatch[1]!.toLowerCase()
  if (!(NOTE_TYPES as readonly string[]).includes(type)) {
    return { ...base, needsType: true, messages: [`Unknown type "@${type}".`] }
  }
  const body = raw.slice(typeMatch[0].length)
  const segments = body
    .split(/\s*\|\s*/)
    .map((s) => s.trim())
    .filter(Boolean)

  const positional: string[] = []
  const keyed: Partial<Record<Key, string>> = {}
  const tags: string[] = []
  for (const seg of segments) {
    if (seg.startsWith('#')) {
      for (const t of seg.split(/\s+/)) {
        const tag = normalizeTag(t)
        if (tag) tags.push(tag)
      }
      continue
    }
    const km = KEY_RE.exec(seg)
    if (km) {
      const key = km[1]!.toLowerCase() as Key
      keyed[key === 'notes' ? 'note' : key] = km[2]!.trim()
      continue
    }
    positional.push(seg)
  }
  const built = buildContent(type as NoteType, positional, keyed)
  return finish(base, built.content, uniq([...tags, ...built.extraTags]), built.errors, built.warnings)
}

interface Built {
  content: NoteContent | null
  extraTags: string[]
  errors: string[]
  warnings: string[]
}

function splitArrow(s: string): [string, string] | null {
  const m = /\s*(?:=>|->|→)\s*/.exec(s)
  if (!m) return null
  return [s.slice(0, m.index).trim(), s.slice(m.index + m[0].length).trim()]
}

function buildContent(type: NoteType, pos: string[], keyed: Partial<Record<Key, string>>): Built {
  const errors: string[] = []
  const warnings: string[] = []
  const extraTags: string[] = []
  const opt = <T extends string>(k: T, v: string | undefined) => (v ? { [k]: v } : {}) as Partial<Record<T, string>>

  switch (type) {
    case 'vocab': {
      const [term = '', definition = '', ...examples] = pos
      const collocations = keyed.coll
        ? keyed.coll
            .split(/\s*[;,]\s*/)
            .map((c) => c.trim())
            .filter(Boolean)
        : undefined
      return {
        content: {
          type,
          fields: {
            term,
            definition,
            examples,
            ...opt('he', keyed.he),
            ...opt('pos', keyed.pos),
            ...(collocations?.length ? { collocations } : {}),
            ...opt('notes', keyed.note),
          },
        },
        extraTags,
        errors,
        warnings,
      }
    }
    case 'sentence': {
      if (pos.length > 1) warnings.push(`Extra segment ignored: "${pos.slice(1).join(' | ')}".`)
      return {
        content: { type, fields: { text: pos[0] ?? '', ...opt('he', keyed.he), ...opt('notes', keyed.note) } },
        extraTags,
        errors,
        warnings,
      }
    }
    case 'fix':
    case 'natural': {
      let pair = pos[0] ? splitArrow(pos[0]) : null
      let rest = pos.slice(1)
      if (!pair && pos.length >= 2) {
        pair = [pos[0]!, pos[1]!]
        rest = pos.slice(2)
      }
      if (!pair) errors.push('Expected "original => corrected".')
      if (rest.length) warnings.push(`Extra segment ignored: "${rest.join(' | ')}".`)
      const [a = '', b = ''] = pair ?? []
      if (type === 'fix') {
        return { content: { type, fields: { wrong: a, right: b, rule: keyed.rule ?? keyed.note ?? '' } }, extraTags, errors, warnings }
      }
      return { content: { type, fields: { mine: a, natural: b, ...opt('note', keyed.note ?? keyed.why) } }, extraTags, errors, warnings }
    }
    case 'tense': {
      const sentence = pos[0] ?? ''
      const tense = keyed.tense ? normalizeTense(keyed.tense) : null
      if (!keyed.tense) errors.push('Missing "tense: <name>".')
      else if (!tense) errors.push(`Unknown tense "${keyed.tense}".`)
      if (tense) extraTags.push(tenseTag(tense))
      if (pos.length > 1) warnings.push(`Extra segment ignored: "${pos.slice(1).join(' | ')}".`)
      return {
        content: tense ? { type, fields: { sentence, tense, ...opt('why', keyed.why) } } : null,
        extraTags,
        errors,
        warnings,
      }
    }
    case 'cloze': {
      if (pos.length > 1) warnings.push(`Extra segment ignored: "${pos.slice(1).join(' | ')}".`)
      return { content: { type, fields: { text: pos[0] ?? '' } }, extraTags, errors, warnings }
    }
  }
}

function finish(base: ParsedItem, content: NoteContent | null, tags: string[], errors: string[], warnings: string[]): ParsedItem {
  if (content) {
    const v = validateContent(content)
    errors.push(...v.errors)
    warnings.push(...v.warnings)
  }
  const status: LineStatus = errors.length || !content ? 'error' : warnings.length ? 'warn' : 'ok'
  return { ...base, status, messages: [...errors, ...warnings], content: errors.length ? null : content, tags }
}

/** Field-level checks shared by text import, JSON import, Quick Add and the note editor. */
export function validateContent(content: NoteContent): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  switch (content.type) {
    case 'vocab': {
      const f = content.fields
      if (!f.term.trim()) errors.push('Missing term.')
      if (!f.definition.trim()) errors.push('Missing English definition.')
      if (!f.examples.length) warnings.push('No example sentence, so no cloze card.')
      else if (f.term && !f.examples.some((e) => findTermInExample(f.term, e))) {
        warnings.push(`No example contains "${f.term}", so no cloze card.`)
      }
      break
    }
    case 'sentence':
      if (!content.fields.text.trim()) errors.push('Missing sentence.')
      break
    case 'fix':
      if (!content.fields.wrong.trim() || !content.fields.right.trim()) errors.push('Need both the wrong and the right version.')
      if (!content.fields.rule.trim()) warnings.push('No rule. Add "rule: …" so the reveal can explain it.')
      break
    case 'natural':
      if (!content.fields.mine.trim() || !content.fields.natural.trim()) errors.push('Need both your phrasing and the natural one.')
      break
    case 'tense': {
      const segs = parseCloze(content.fields.sentence)
      const clozes = segs.filter((s) => s.kind === 'cloze')
      if (!clozes.length) errors.push('Mark the verb with {{answer::base verb}}.')
      else {
        if (clozes.length > 1) warnings.push('Only the first {{…}} is tested.')
        const first = clozes[0]
        if (first && first.kind === 'cloze' && !first.hint) warnings.push('No base-verb hint ({{answer::verb}}); multiple choice falls back to typing.')
      }
      break
    }
    case 'cloze':
      if (!clozeCount(content.fields.text)) errors.push('No {{cloze}} found.')
      break
  }
  return { errors, warnings }
}

// ---------- JSON ----------

type Json = Record<string, unknown>

function str(o: Json, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string') return straightenQuotes(v).trim()
  }
  return undefined
}

function strList(v: unknown): string[] {
  if (typeof v === 'string') return v.trim() ? [straightenQuotes(v).trim()] : []
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string').map((x) => straightenQuotes(x).trim()).filter(Boolean)
  return []
}

function parseJsonImport(text: string): ParseResult | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  let packageName: string | null = null
  let list: unknown[]
  if (Array.isArray(data)) list = data
  else if (data && typeof data === 'object' && Array.isArray((data as Json).items)) {
    list = (data as Json).items as unknown[]
    const p = (data as Json).package ?? (data as Json).name
    if (typeof p === 'string') packageName = p.trim() || null
  } else return null

  const items = list.map((entry, i): ParsedItem => {
    const raw = JSON.stringify(entry)
    const base: ParsedItem = { lineNo: i + 1, raw, status: 'error', messages: [], needsType: false, content: null, tags: [] }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ...base, messages: ['Item is not an object.'] }
    const outer = entry as Json
    const o: Json = { ...outer, ...(outer.fields && typeof outer.fields === 'object' ? (outer.fields as Json) : {}) }
    const type = str(o, 'type')?.toLowerCase().replace(/^@/, '')
    if (!type || !(NOTE_TYPES as readonly string[]).includes(type)) {
      return { ...base, needsType: true, messages: [type ? `Unknown type "${type}".` : 'Missing "type".'] }
    }
    const tags = strList(o.tags)
      .map(normalizeTag)
      .filter((t): t is string => !!t)
    const keyed: Partial<Record<Key, string>> = {}
    for (const k of ['he', 'pos', 'rule', 'why'] as const) {
      const v = str(o, k)
      if (v) keyed[k] = v
    }
    const note = str(o, 'note', 'notes')
    if (note) keyed.note = note
    const tenseName = str(o, 'tense')
    if (tenseName) keyed.tense = tenseName
    const coll = strList(o.collocations ?? o.coll)
    if (coll.length) keyed.coll = coll.join('; ')

    let pos: string[]
    switch (type as NoteType) {
      case 'vocab':
        pos = [str(o, 'term') ?? '', str(o, 'definition') ?? '', ...strList(o.examples ?? o.example)]
        break
      case 'sentence':
        pos = [str(o, 'text', 'sentence') ?? '']
        break
      case 'fix':
        pos = [str(o, 'wrong') ?? '', str(o, 'right') ?? '']
        break
      case 'natural':
        pos = [str(o, 'mine') ?? '', str(o, 'natural') ?? '']
        break
      case 'tense':
        pos = [str(o, 'sentence', 'text') ?? '']
        break
      case 'cloze':
        pos = [str(o, 'text') ?? '']
        break
    }
    const built = buildContent(type as NoteType, pos, keyed)
    return finish(base, built.content, uniq([...tags, ...built.extraTags]), built.errors, built.warnings)
  })
  return { format: 'json', packageName, items }
}

// ---------- duplicates ----------

/** The field that identifies a note, as plain text. */
export function primaryText(content: NoteContent): string {
  switch (content.type) {
    case 'vocab':
      return content.fields.term
    case 'sentence':
      return clozePlain(content.fields.text)
    case 'fix':
      return content.fields.wrong
    case 'natural':
      return content.fields.mine
    case 'tense':
      return clozePlain(content.fields.sentence)
    case 'cloze':
      return clozePlain(content.fields.text)
  }
}

/** Normalized key for duplicate detection: type + primary field without case, punctuation or extra spaces. */
export function duplicateKey(content: NoteContent): string {
  const norm = straightenQuotes(primaryText(content))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${content.type}:${norm}`
}

export function defaultPackageName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
}
