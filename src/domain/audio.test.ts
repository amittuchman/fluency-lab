import { checkSpeech } from './checker'
import { buildPrompt } from './prompt'
import { emptyFsrs } from './scheduler'
import type { Card, Note, NoteContent } from './types'

const note = (content: NoteContent): Note =>
  ({ ...content, id: 'n', tags: [], packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null }) as Note
const card = (template: string): Card => ({
  id: 'c',
  noteId: 'n',
  template,
  order: 0,
  fsrs: emptyFsrs(0),
  suspended: false,
  buriedUntil: null,
  leech: false,
  unlocked: true,
  contentHash: '',
  priority: false,
  createdAt: 0,
})

describe('checkSpeech', () => {
  it('scores the best alternative and ignores case and punctuation', () => {
    const r = checkSpeech(['let me think out loud for a sec', 'Let me think out loud for a second'], 'Let me think out loud for a second.')
    expect(r.verdict).toBe('correct')
    expect(r.similarity).toBe(1)
    expect(r.transcript).toBe('Let me think out loud for a second')
  })
  it('near misses are "almost", far misses "wrong"', () => {
    expect(checkSpeech(['it depends how you define success'], 'It depends on how you define success.').verdict).toBe('almost')
    expect(checkSpeech(['I like turtles'], 'It depends on how you define success.').verdict).toBe('wrong')
    expect(checkSpeech([], 'Hello.').verdict).toBe('wrong')
  })
})

describe('audio-dependent prompts', () => {
  const vocab = note({ type: 'vocab', fields: { term: 'hedge', definition: 'to reduce risk', examples: [] } })
  const sentence = note({ type: 'sentence', fields: { text: 'It depends on you.' } })
  const withHe = note({ type: 'sentence', fields: { text: 'It depends on you.', he: 'זה תלוי בך.' } })

  it('dictation plays audio when available, otherwise falls back to production', () => {
    const a = buildPrompt(vocab, card('dictation'), { promptLanguage: 'english', audio: true })
    expect(a).toMatchObject({ kind: 'typed', audioPrompt: true, accepted: ['hedge'] })
    expect(a.prompt).toBeUndefined()
    const b = buildPrompt(vocab, card('dictation'), { promptLanguage: 'english', audio: false })
    expect(b).toMatchObject({ kind: 'typed', prompt: 'to reduce risk' })
    expect(b.audioPrompt).toBeUndefined()
  })

  it('full recall: Hebrew gloss first, then audio, then first letters', () => {
    expect(buildPrompt(withHe, card('recall-full'), { promptLanguage: 'english', audio: true })).toMatchObject({ prompt: 'זה תלוי בך.', promptIsHebrew: true })
    expect(buildPrompt(sentence, card('recall-full'), { promptLanguage: 'english', audio: true })).toMatchObject({ audioPrompt: true })
    expect(buildPrompt(sentence, card('recall-full'), { promptLanguage: 'english' })).toMatchObject({ prompt: 'I d o y.' })
  })

  it('speak uses speech recognition when available, otherwise a self-graded flip', () => {
    expect(buildPrompt(withHe, card('speak'), { promptLanguage: 'english', speech: true })).toMatchObject({ kind: 'speak', target: 'It depends on you.' })
    expect(buildPrompt(withHe, card('speak'), { promptLanguage: 'english', speech: false })).toMatchObject({ kind: 'flip', front: 'זה תלוי בך.' })
  })
})
