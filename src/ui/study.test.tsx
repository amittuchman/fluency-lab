import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { db, repos } from '../data'
import { createNote, initialize } from '../data/services'
import { buildPrompt } from '../domain/prompt'
import { emptyFsrs } from '../domain/scheduler'
import type { Card, Note } from '../domain/types'
import { StudyCard } from './components/StudyCard'
import { StudySession } from './screens/StudySession'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initialize(repos)
})

function renderSession() {
  return render(
    <MemoryRouter>
      <StudySession source={{ kind: 'daily' }} />
    </MemoryRouter>,
  )
}

describe('study loop', () => {
  it('answers a multiple-choice card twice (learning step), then shows the summary; undo brings it back', async () => {
    const user = userEvent.setup()
    await createNote(repos, { type: 'fix', fields: { wrong: 'I very agree.', right: 'I completely agree.', rule: 'very + verb' } }, ['adverbs'], null)
    renderSession()

    expect(await screen.findByText('Which one is correct?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /I completely agree\./ }))
    expect(screen.getByText('Correct')).toBeInTheDocument()
    expect(screen.getByText(/very \+ verb/)).toBeInTheDocument()
    await user.keyboard('{Enter}')

    // New card graded Good goes to a 10-minute learning step and comes back in the same session.
    await waitFor(() => expect(screen.getByText('1 done · 1 left')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /I completely agree\./ }))
    await user.keyboard('{Enter}')

    expect(await screen.findByText('Session finished')).toBeInTheDocument()
    expect((await repos.logs.all()).length).toBe(2)

    await user.keyboard('z')
    await waitFor(() => expect(screen.getByText('Which one is correct?')).toBeInTheDocument())
    expect((await repos.logs.all()).length).toBe(1)
  })

  it('typed card: Enter checks, shows the diff, Enter again accepts the suggested grade', async () => {
    const user = userEvent.setup()
    await createNote(repos, { type: 'cloze', fields: { text: 'Rates {{rose}} sharply.' } }, [], null)
    renderSession()

    const input = await screen.findByRole('textbox', { name: 'Your answer' })
    await user.type(input, 'fell{Enter}')
    expect(screen.getByText('Not quite')).toBeInTheDocument()
    expect(screen.getByTitle('wrong')).toHaveTextContent('fell')
    expect(screen.getByTitle('expected')).toHaveTextContent('rose')
    await user.keyboard('{Enter}')
    await waitFor(async () => expect((await repos.logs.all())[0]?.rating).toBe(1))
  })
})

describe('StudyCard', () => {
  const note = {
    id: 'n',
    type: 'vocab',
    fields: { term: 'reluctant', definition: 'unwilling', examples: ['He was reluctant to go.'], he: 'מסויג' },
    tags: [],
    packageId: null,
    createdAt: 0,
    updatedAt: 0,
    suspended: false,
    deletedAt: null,
  } as Note
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
  const intervals = { 1: '1m', 2: '6m', 3: '10m', 4: '5d' } as const

  it('hides Hebrew until the answer is revealed and grades with number keys', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<StudyCard prompt={buildPrompt(note, card('recog'), { promptLanguage: 'english' })} intervals={intervals} onDone={onDone} />)
    expect(screen.queryByText('מסויג')).not.toBeInTheDocument()
    await user.keyboard(' ')
    expect(screen.getByText('מסויג')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Good.*10m/ })).toBeInTheDocument()
    await act(() => user.keyboard('4'))
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ grade: 4, correct: true }))
  })

  it('accepts a 1-letter typo on vocab as "almost" with Hard suggested', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<StudyCard prompt={buildPrompt(note, card('produce'), { promptLanguage: 'english' })} intervals={intervals} onDone={onDone} />)
    await user.type(screen.getByRole('textbox'), 'reluctent{Enter}')
    expect(screen.getByText(/Almost/)).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ grade: 2, userAnswer: 'reluctent' }))
  })
})
