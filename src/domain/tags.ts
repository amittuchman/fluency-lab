import { TENSE_ASPECTS, TENSE_TIMES, type TenseName } from './types'

export const ALL_TENSES: TenseName[] = TENSE_TIMES.flatMap((t) => TENSE_ASPECTS.map((a) => `${t}-${a}` as TenseName))

export const TENSE_TAG_PREFIX = 'tense:'

/**
 * Map a free-form tense name to its canonical form.
 * "Present Perfect Continuous", "present perfect progressive", "simple past" → canonical; unknown → null.
 */
export function normalizeTense(input: string): TenseName | null {
  const words = input
    .toLowerCase()
    .replace(/^tense:/, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  const time = TENSE_TIMES.find((t) => words.includes(t))
  if (!time) return null
  const known = new Set<string>([...TENSE_TIMES, 'simple', 'continuous', 'progressive', 'perfect', 'tense'])
  if (words.some((w) => !known.has(w))) return null
  const perfect = words.includes('perfect')
  const continuous = words.includes('continuous') || words.includes('progressive')
  const aspect = perfect && continuous ? 'perfect-continuous' : perfect ? 'perfect' : continuous ? 'continuous' : 'simple'
  return `${time}-${aspect}`
}

export function tenseTag(t: TenseName): string {
  return TENSE_TAG_PREFIX + t
}

export function tenseLabel(t: TenseName): string {
  const s = t.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Lowercase, hyphenated tag. Tense names become tense:<canonical>. Returns null for empty input. */
export function normalizeTag(raw: string): string | null {
  const stripped = raw.trim().replace(/^#+/, '').trim()
  if (!stripped) return null
  const tense = /\b(past|present|future)\b/i.test(stripped.replace(/[-_]/g, ' ')) ? normalizeTense(stripped) : null
  if (tense) return tenseTag(tense)
  const tag = stripped
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9:\-\u0590-\u05ff]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return tag || null
}

export function tenseFromTags(tags: string[]): TenseName | null {
  const t = tags.find((x) => x.startsWith(TENSE_TAG_PREFIX))
  return t ? normalizeTense(t) : null
}
