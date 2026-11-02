import { checkSpeech } from './checker'
import { buildPrompt } from './exercises'
import { emptyFsrs } from './scheduler'
import type { Card, Level, Note, NoteContent } from './types'

const note = (content: NoteContent): Note =>
  ({ ...content, id: 'n', tags: [], packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null }) as Note
const card = (level: Level): Card => ({
  id: 'n:item',
  noteId: 'n',
  template: 'item',
  order: 0,
  fsrs: emptyFsrs(0),
  suspended: false,
  buriedUntil: null,
  leech: false,
  unlocked: true,
  contentHash: '',
  priority: false,
  createdAt: 0,
  level,
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

describe('audio- and speech-dependent prompts', () => {
  const sentence = note({ type: 'sentence', fields: { text: 'It depends on you.' } })
  const withHe = note({ type: 'sentence', fields: { text: 'It depends on you.', he: 'זה תלוי בך.' } })

  it('guided recall: Hebrew first, then the audio, always with first letters', () => {
    expect(buildPrompt(withHe, card(2), { promptLanguage: 'english', audio: true })).toMatchObject({ prompt: 'זה תלוי בך.', promptIsHebrew: true, hint: 'I d o y.' })
    expect(buildPrompt(sentence, card(2), { promptLanguage: 'english', audio: true })).toMatchObject({ audioPrompt: true, hint: 'I d o y.' })
    expect(buildPrompt(sentence, card(2), { promptLanguage: 'english' }).audioPrompt).toBeUndefined()
  })

  it('L4 speaking uses speech recognition when available, otherwise typing the translation', () => {
    expect(buildPrompt(withHe, card(4), { promptLanguage: 'english', speech: true })).toMatchObject({ kind: 'speak', target: 'It depends on you.' })
    expect(buildPrompt(withHe, card(4), { promptLanguage: 'english', speech: false })).toMatchObject({ kind: 'typed', exercise: 'sentence-translate' })
  })
})
