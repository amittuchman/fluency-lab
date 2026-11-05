import { fillMissing, planImport, type PlanLine } from './importPlan'
import { duplicateKey, parseImport } from './parser'
import type { Note, NoteContent } from './types'

const note = (content: NoteContent, tags: string[] = [], id = 'n1'): Note =>
  ({ ...content, id, tags, packageId: 'p', createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null }) as Note
const lines = (text: string): PlanLine[] => parseImport(text).items.map((i) => ({ lineNo: i.lineNo, content: i.content!, tags: i.tags }))
const library = (...notes: Note[]) => new Map(notes.map((n) => [duplicateKey(n), n]))

const oldTense = note({ type: 'tense', fields: { sentence: 'She usually {{studies::study}} in the library.', tense: 'present-simple' } }, ['tense:present-simple'])

describe('filling missing fields', () => {
  it('adds only what the item lacks; never overwrites, never touches the main fields', () => {
    const existing = note({ type: 'fix', fields: { wrong: 'a b', right: 'a c', rule: 'kept', he: 'קיים' } })
    const f = fillMissing(existing, { type: 'fix', fields: { wrong: 'a b', right: 'a DIFFERENT', rule: 'new', he: 'חדש', prompt: 'p', distractors: ['a d'] } }, [])
    expect(f!.note.fields).toEqual({ wrong: 'a b', right: 'a c', rule: 'kept', he: 'קיים', prompt: 'p', distractors: ['a d'] })
    expect(f!.added).toEqual(['prompt', 'distractors'])
  })
  it('an empty value counts as missing; a pattern is added only if the item has none', () => {
    const existing = note({ type: 'fix', fields: { wrong: 'a b', right: 'a c', rule: '' } }, ['pattern:x'])
    const f = fillMissing(existing, { type: 'fix', fields: { wrong: 'a b', right: 'a c', rule: 'r' } }, ['pattern:y', 'spelling'])
    expect(f!.note).toMatchObject({ fields: { rule: 'r' }, tags: ['pattern:x', 'spelling'] })
  })
  it('null when there is nothing new', () => {
    expect(fillMissing(oldTense, { type: 'tense', fields: { sentence: 'She usually {{studies::study}} in the library.', tense: 'present-simple' } }, ['tense:present-simple'])).toBeNull()
  })
})

describe('import plan', () => {
  it('counts updated, new and unchanged items; an old item gets the new optional fields', () => {
    const unchanged = note({ type: 'sentence', fields: { text: 'It depends on you.', he: 'זה תלוי בך.' } }, [], 'n2')
    const plan = planImport(
      lines(`@tense She usually {{studies::study}} in the library. | tense: present simple | why: a habit | he: היא בדרך כלל לומדת בספרייה. | also: He {{works::work}} from home on Fridays.
@sentence It depends on you. | he: זה תלוי בך.
@vocab hedge | to reduce a risk | Firms hedge risk.`),
      library(oldTense, unchanged),
    )
    expect({ updated: plan.update.length, created: plan.create.length, unchanged: plan.unchanged }).toEqual({ updated: 1, created: 1, unchanged: 1 })
    expect(plan.update[0]!.note.id).toBe('n1')
    expect(plan.update[0]!.note.fields).toMatchObject({ why: 'a habit', he: 'היא בדרך כלל לומדת בספרייה.', also: ['He {{works::work}} from home on Fridays.'] })
    expect(plan.status.get(1)).toMatchObject({ kind: 'update', added: ['why', 'he', 'also'] })
    expect(plan.status.get(2)).toMatchObject({ kind: 'unchanged' })
    expect(plan.status.get(3)).toMatchObject({ kind: 'new' })
  })
  it('matching ignores case, spacing and punctuation of the main text', () => {
    const plan = planImport(lines('@tense she usually  {{studies::study}} in the library | tense: present simple | why: a habit'), library(oldTense))
    expect(plan.create).toEqual([])
    expect(plan.update).toHaveLength(1)
  })
  it('the same item twice in one import is one item: the second line only fills gaps', () => {
    const plan = planImport(
      lines(`@fix It depends of it. => It depends on it. | rule: first
@fix It depends of it. => It depends on it. | rule: second | he: זה תלוי בזה.`),
      new Map(),
    )
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]!.content.fields).toMatchObject({ rule: 'first', he: 'זה תלוי בזה.' })
    expect(plan.status.get(2)).toEqual({ kind: 'same-as', lineNo: 1 })
  })
})

describe('items without a package', () => {
  it('a matched item with no package, or whose package is gone, joins the imported package', () => {
    const none = { ...oldTense, packageId: null } as Note
    const gone = note({ type: 'sentence', fields: { text: 'It depends on you.' } }, [], 'n2')
    const kept = note({ type: 'sentence', fields: { text: 'Fair enough.' } }, [], 'n3')
    const plan = planImport(
      lines(`@tense She usually {{studies::study}} in the library. | tense: present simple
@sentence It depends on you. | he: זה תלוי בך.
@sentence Fair enough.`),
      library(none, { ...gone, packageId: 'deleted' } as Note, { ...kept, packageId: 'live' } as Note),
      new Set(['live']),
    )
    expect(plan.toPackage.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(plan.status.get(1)).toMatchObject({ kind: 'unchanged', toPackage: true })
    expect(plan.status.get(2)).toMatchObject({ kind: 'update', toPackage: true })
    expect(plan.status.get(3)).toMatchObject({ kind: 'unchanged', toPackage: false })
  })
})
