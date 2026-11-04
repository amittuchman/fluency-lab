import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildPrompt } from '../domain/exercises'
import { emptyFsrs } from '../domain/scheduler'
import type { Card, Note } from '../domain/types'
import { StudyCard } from './components/StudyCard'
import { appendTranscript, dictate } from './speech'

/** A stand-in for the browser's SpeechRecognition that the test drives by hand. */
class FakeRecognition {
  static instances: FakeRecognition[] = []
  lang = ''
  interimResults = false
  maxAlternatives = 1
  continuous = false
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  stopped = false
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start() {
    this.started = true
  }
  stop() {
    this.stopped = true
    this.onend?.()
  }
  abort() {}
  /** Recognition so far in this session: [text, isFinal] per result. */
  hear(...results: Array<[string, boolean]>) {
    this.onresult?.({ results: results.map(([t, isFinal]) => Object.assign([{ transcript: t }], { isFinal })) })
  }
}
const last = () => FakeRecognition.instances.at(-1)!

beforeEach(() => {
  FakeRecognition.instances = []
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
  localStorage.clear()
})
afterEach(() => vi.unstubAllGlobals())

const note = {
  id: 'n',
  type: 'fix',
  fields: { wrong: 'I very agree with you.', right: 'I completely agree with you.', rule: '"Very" cannot modify a verb.' },
  tags: [],
  packageId: null,
  createdAt: 0,
  updatedAt: 0,
  suspended: false,
  deletedAt: null,
} as Note
const card: Card = {
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
  level: 3, // "You said this. Correct it": a typed answer
}
const intervals = { 1: '1m', 2: '6m', 3: '10m', 4: '5d' } as const
function renderCard() {
  const onDone = vi.fn()
  render(<StudyCard prompt={buildPrompt(note, card, { promptLanguage: 'english' })} intervals={intervals} onDone={onDone} />)
  return { onDone, field: screen.getByRole('textbox', { name: 'Your answer' }) }
}

describe('voice input in answer fields', () => {
  it('records in English, shows live text, appends the final text, and never submits', async () => {
    const user = userEvent.setup()
    const { onDone, field } = renderCard()
    await user.type(field, 'I completely')
    await user.click(screen.getByRole('button', { name: 'Voice input (Ctrl+M)' }))
    expect(screen.getByText('Recording…')).toBeInTheDocument()
    expect(last()).toMatchObject({ lang: 'en-US', interimResults: true, started: true })

    act(() => last().hear(['agree with', false]))
    expect(screen.getByText('agree with')).toBeInTheDocument()
    act(() => last().hear(['agree with you', true]))
    expect(field).toHaveValue('I completely agree with you')
    expect(screen.queryByText('agree with')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop voice input (Ctrl+M)' }))
    expect(last().stopped).toBe(true)
    expect(screen.queryByText('Recording…')).not.toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Check' })).toBeInTheDocument()

    // The transcript can be edited, then checked as usual.
    await user.type(field, '.{Enter}')
    expect(screen.getByText('Correct')).toBeInTheDocument()
  })

  it('Ctrl+M starts and stops it, also while typing in the field', async () => {
    const user = userEvent.setup()
    const { field } = renderCard()
    await user.click(field)
    await user.keyboard('{Control>}m{/Control}')
    expect(screen.getByText('Recording…')).toBeInTheDocument()
    await user.keyboard('{Control>}m{/Control}')
    expect(screen.queryByText('Recording…')).not.toBeInTheDocument()
    expect(field).toHaveValue('')
  })

  it('checking the answer stops the recording', async () => {
    const user = userEvent.setup()
    const { field } = renderCard()
    await user.click(screen.getByRole('button', { name: 'Voice input (Ctrl+M)' }))
    await user.type(field, 'x{Enter}')
    expect(last().stopped).toBe(true)
    expect(screen.queryByRole('button', { name: /Voice input/ })).not.toBeInTheDocument()
  })

  it('a blocked microphone gives a short message', async () => {
    const user = userEvent.setup()
    renderCard()
    await user.click(screen.getByRole('button', { name: 'Voice input (Ctrl+M)' }))
    act(() => {
      last().onerror?.({ error: 'not-allowed' })
      last().onend?.()
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access was blocked. Allow it in the browser settings.')
    expect(screen.queryByText('Recording…')).not.toBeInTheDocument()
  })

  it('without speech recognition: no button, and a note shown only the first time', () => {
    vi.unstubAllGlobals()
    const first = renderCard()
    expect(screen.queryByRole('button', { name: /Voice input/ })).not.toBeInTheDocument()
    expect(screen.getByText("Voice input isn't supported in this browser.")).toBeInTheDocument()
    first.field.remove()
    document.body.innerHTML = ''
    renderCard()
    expect(screen.queryByText("Voice input isn't supported in this browser.")).not.toBeInTheDocument()
  })
})

describe('dictation', () => {
  it('passes on each new final piece once, even when the recognizer repeats earlier text', () => {
    const finals: string[] = []
    dictate({ onInterim: () => {}, onFinal: (t) => finals.push(t), onError: () => {}, onEnd: () => {} })
    last().hear(['hello', true])
    last().hear(['hello', true], [' world', true])
    last().hear(['hello', true], [' world', true], [' again', false])
    expect(finals).toEqual(['hello', 'world'])
  })

  it('on Android it listens one phrase at a time and restarts until stopped', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Chrome/130')
    const ended = vi.fn()
    const s = dictate({ onInterim: () => {}, onFinal: () => {}, onError: () => {}, onEnd: ended })!
    expect(last().continuous).toBe(false)
    last().onend?.() // the phrase ended by itself
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(ended).not.toHaveBeenCalled()
    s.stop()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(FakeRecognition.instances).toHaveLength(2)
    vi.restoreAllMocks()
  })

  it('appends to what is already there', () => {
    expect(appendTranscript('', ' hello ')).toBe('hello')
    expect(appendTranscript('I think', 'so')).toBe('I think so')
    expect(appendTranscript('I think ', 'so')).toBe('I think so')
    expect(appendTranscript('I think', '')).toBe('I think')
  })
})
