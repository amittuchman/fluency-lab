import { duplicateKey, parseImport, parseLine } from './parser'
import { normalizeTag, normalizeTense } from './tags'
import { ALL_TENSES } from './tags'
import { parseCloze, clozeBlank, clozePlain } from './cloze'

const BRIEF_SAMPLE = `# Package: 2026-10-19 – Economics debate
@vocab reluctant | unwilling and hesitant | He was reluctant to commit. | he: מסויג | pos: adj | #adjectives
@sentence The trade-off isn't as clear-cut as it looks. | he: ... | #natural-phrasing
@fix I very agree with you. => I completely agree with you. | rule: "very" cannot modify a verb | #adverbs
@natural I think this solution is very good. => I think this approach makes a lot of sense. | #natural-phrasing
@tense I {{have been working::work}} here for five years. | tense: present perfect continuous | why: ongoing action up to now, duration | #tenses
@cloze The central bank {{raised//put up::raise}} rates last week. | #economics`

describe('text format', () => {
  const r = parseImport(BRIEF_SAMPLE)

  it('reads the package name and every item', () => {
    expect(r.format).toBe('text')
    expect(r.packageName).toBe('2026-10-19 – Economics debate')
    expect(r.items).toHaveLength(6)
    expect(r.items.every((i) => i.status === 'ok')).toBe(true)
  })

  it('parses vocab segments', () => {
    const v = r.items[0]!
    expect(v.content).toEqual({
      type: 'vocab',
      fields: { term: 'reluctant', definition: 'unwilling and hesitant', examples: ['He was reluctant to commit.'], he: 'מסויג', pos: 'adj' },
    })
    expect(v.tags).toEqual(['adjectives'])
  })

  it('parses fix with => and the rule', () => {
    expect(r.items[2]!.content).toEqual({
      type: 'fix',
      fields: { wrong: 'I very agree with you.', right: 'I completely agree with you.', rule: '"very" cannot modify a verb' },
    })
  })

  it('normalizes the tense and adds the canonical tag', () => {
    const t = r.items[4]!
    expect(t.content).toMatchObject({ type: 'tense', fields: { tense: 'present-perfect-continuous', why: 'ongoing action up to now, duration' } })
    expect(t.tags).toEqual(['tenses', 'tense:present-perfect-continuous'])
  })

  it('ignores blank lines and // comments, tolerates curly quotes and ->', () => {
    const r2 = parseImport('\n// comment\n\n@fix I’m agree. -> I agree. | rule: “agree” is a verb\n')
    expect(r2.items).toHaveLength(1)
    expect(r2.items[0]!.content).toEqual({ type: 'fix', fields: { wrong: "I'm agree.", right: 'I agree.', rule: '"agree" is a verb' } })
    expect(r2.packageName).toBeNull()
  })

  it('reads multiple examples and collocations', () => {
    const it = parseLine('@vocab hedge | to protect against loss | Firms hedge risk. | They hedged their bets. | coll: hedge risk; hedge against', 1)
    expect(it.content).toMatchObject({ fields: { examples: ['Firms hedge risk.', 'They hedged their bets.'], collocations: ['hedge risk', 'hedge against'] } })
  })
})

describe('errors and warnings', () => {
  it('flags lines without a type', () => {
    const it = parseLine('Just a sentence without type', 3)
    expect(it.status).toBe('error')
    expect(it.needsType).toBe(true)
  })
  it('flags unknown types', () => {
    expect(parseLine('@word hello', 1)).toMatchObject({ status: 'error', needsType: true })
  })
  it('errors on missing pieces', () => {
    expect(parseLine('@vocab lonely', 1).status).toBe('error')
    expect(parseLine('@fix just one side', 1).status).toBe('error')
    expect(parseLine('@tense I went home. | tense: past simple', 1).status).toBe('error')
    expect(parseLine('@tense I {{went::go}} home.', 1).status).toBe('error')
    expect(parseLine('@tense I {{went::go}} home. | tense: pluperfect-ish', 1).status).toBe('error')
    expect(parseLine('@cloze no blanks here', 1).status).toBe('error')
  })
  it('warns on optional gaps', () => {
    expect(parseLine('@vocab hedge | to protect against loss', 1).status).toBe('warn')
    expect(parseLine('@fix a => b', 1).status).toBe('warn')
    expect(parseLine('@tense I {{went}} home. | tense: past simple', 1).status).toBe('warn')
  })
})

describe('JSON format', () => {
  it('accepts an array of items', () => {
    const r = parseImport(
      JSON.stringify([
        { type: 'vocab', term: 'nuance', definition: 'a subtle difference', examples: ['There is nuance here.'], tags: ['Word Choice'] },
        { type: 'tense', sentence: 'I {{went::go}} home.', tense: 'Past Simple' },
        { type: 'nope' },
      ]),
    )
    expect(r.format).toBe('json')
    expect(r.items[0]!.status).toBe('ok')
    expect(r.items[0]!.tags).toEqual(['word-choice'])
    expect(r.items[1]!.content).toMatchObject({ fields: { tense: 'past-simple' } })
    expect(r.items[2]!.status).toBe('error')
  })
  it('accepts {package, items}', () => {
    const r = parseImport(JSON.stringify({ package: 'P1', items: [{ type: 'sentence', text: 'Hi there.' }] }))
    expect(r.packageName).toBe('P1')
    expect(r.items).toHaveLength(1)
  })
})

describe('duplicates', () => {
  it('normalizes the primary field', () => {
    const a = parseLine('@sentence The trade-off isn’t clear.', 1).content!
    const b = parseLine("@sentence the  trade-off isn't clear", 2).content!
    expect(duplicateKey(a)).toBe(duplicateKey(b))
    const c = parseLine('@vocab Reluctant | x', 1).content!
    const d = parseLine('@vocab reluctant | y', 1).content!
    expect(duplicateKey(c)).toBe(duplicateKey(d))
  })
})

describe('tags and tenses', () => {
  it('normalizes all 12 tense names', () => {
    for (const t of ALL_TENSES) expect(normalizeTense(t.replace(/-/g, ' '))).toBe(t)
    expect(normalizeTense('Present Perfect Progressive')).toBe('present-perfect-continuous')
    expect(normalizeTense('simple past')).toBe('past-simple')
    expect(normalizeTense('future')).toBe('future-simple')
    expect(normalizeTense('banana')).toBeNull()
  })
  it('normalizes tags', () => {
    expect(normalizeTag('#Natural Phrasing')).toBe('natural-phrasing')
    expect(normalizeTag('#present-perfect')).toBe('tense:present-perfect')
    expect(normalizeTag('#')).toBeNull()
  })
})

describe('cloze markup', () => {
  it('parses answers, alternatives and hints', () => {
    const segs = parseCloze('A {{raised//put up::raise}} b {{x}}.')
    expect(segs).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'cloze', n: 1, answers: ['raised', 'put up'], hint: 'raise' },
      { kind: 'text', text: ' b ' },
      { kind: 'cloze', n: 2, answers: ['x'] },
      { kind: 'text', text: '.' },
    ])
    expect(clozePlain('A {{raised//put up::raise}} b {{x}}.')).toBe('A raised b x.')
    expect(clozeBlank('A {{y}} b {{x}}.', 2)).toEqual({ before: 'A y b ', after: '.', answers: ['x'] })
  })
})

describe('a realistic 25-line package', () => {
  const PACKAGE = `# Package: 2026-10-21 – Housing market debate
// Vocabulary
@vocab affordable | cheap enough for most people to pay | Housing in the center is no longer affordable. | he: בר השגה | pos: adj | #housing
@vocab skyrocket | to rise very quickly and suddenly | Rents skyrocketed after the war. | he: לזנק | pos: verb | #housing
@vocab subsidy | money a government pays to lower a price | The subsidy only helps first-time buyers. | he: סובסידיה | pos: noun | #economics
@vocab red tape | slow official rules and paperwork | Builders complain about the red tape. | he: בירוקרטיה | pos: noun phrase | coll: cut red tape; bureaucratic red tape | #idioms
@vocab offset | to balance one effect with an opposite one | Higher wages partly offset the rise in rents. | he: לקזז | pos: verb | note: past tense is also "offset" | #economics
@vocab bottleneck | the point where a process slows down | Planning permits are the real bottleneck. | he: צוואר בקבוק | pos: noun | #housing
// Sentences
@sentence Supply simply hasn't kept up with demand. | he: ההיצע פשוט לא עמד בקצב הביקוש. | #economics
@sentence I'd push back on that a little. | he: הייתי חולק על זה קצת. | note: polite disagreement | #disagreeing
@sentence That's easier said than done. | he: קל לומר, קשה לעשות. | #idioms
// Mistakes
@fix The prices are very high in this days. => Prices are very high these days. | rule: "These days" is the fixed expression; no article before general "prices". | #articles
@fix I am agree with this policy. => I agree with this policy. | rule: "Agree" is a verb; don't add "am". | #verbs
@fix It depends of the government. => It depends on the government. | rule: "Depend" takes "on". | #prepositions
@fix He suggested me to wait. => He suggested that I wait.//He suggested waiting. | rule: "Suggest" doesn't take a person + to-infinitive. | #verb-patterns
// Natural phrasing
@natural The prices of houses went up very much. => House prices have shot up. | note: "shoot up" = rise fast and suddenly | #natural-phrasing
@natural I don't agree with you totally. => I'm not entirely convinced. | note: softer and more natural in a debate | #disagreeing
@natural This is a big problem for young people. => This hits young people hardest. | #natural-phrasing
// Tenses
@tense Rents {{have risen::rise}} by 30% since 2020. | tense: present-perfect | why: a change from a past point until now ("since") | #tenses
@tense Prices {{rose::rise}} sharply last year. | tense: past-simple | why: finished time ("last year") | #tenses
@tense They {{have been building::build}} that tower for three years. | tense: present-perfect-continuous | why: ongoing action with duration up to now | #tenses
@tense By 2030, the city {{will have built::build}} ten thousand new homes. | tense: future-perfect | why: completed before a future point ("by 2030") | #tenses
@tense When the law passed, prices {{had already doubled::double}}. | tense: past-perfect | why: earlier than another past event | #tenses
@tense At the moment, the government {{is reviewing::review}} the plan. | tense: present-continuous | why: happening now ("at the moment") | #tenses
@tense This time next year, we {{will be living::live}} in a smaller flat. | tense: future-continuous | why: in progress at a future moment | #tenses
// Cloze
@cloze The bank {{raised//put up::raise}} interest rates again. | #economics
@cloze Demand {{outstripped::exceeded}} supply for a {{decade}}. | #economics`

  it('imports with zero errors and zero warnings, reading every key', () => {
    const r = parseImport(PACKAGE)
    expect(r.packageName).toBe('2026-10-21 – Housing market debate')
    expect(r.items).toHaveLength(25)
    expect(r.items.filter((i) => i.status !== 'ok').map((i) => `${i.lineNo}: ${i.messages.join(' ')}`)).toEqual([])
    const [offset] = r.items.filter((i) => i.content?.type === 'vocab' && i.content.fields.term === 'offset')
    expect(offset!.content).toMatchObject({ fields: { pos: 'verb', notes: 'past tense is also "offset"', he: 'לקזז' } })
    const nat = r.items.find((i) => i.content?.type === 'natural')!
    expect(nat.content).toMatchObject({ fields: { note: '"shoot up" = rise fast and suddenly' } })
    const ppc = r.items.find((i) => i.content?.type === 'tense' && i.raw.includes('building'))!
    expect(ppc.content).toMatchObject({ fields: { tense: 'present-perfect-continuous' } })
    expect(ppc.tags).toContain('tense:present-perfect-continuous')
    const fix = r.items.find((i) => i.raw.includes('suggested'))!
    expect(fix.content).toMatchObject({ fields: { right: 'He suggested that I wait.//He suggested waiting.' } })
    expect(r.items.filter((i) => i.content?.type === 'cloze')).toHaveLength(2)
  })
})

it('handles a 1,000-line import quickly', () => {
  const lines = Array.from({ length: 1000 }, (_, i) => `@vocab word${i} | meaning ${i} | I used word${i} today. | #bulk`)
  const t0 = performance.now()
  const r = parseImport(lines.join('\n'))
  expect(r.items).toHaveLength(1000)
  expect(performance.now() - t0).toBeLessThan(2000)
})
