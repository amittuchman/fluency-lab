import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { db, repos } from '../data'
import { createNote, initialize, reviewCard } from '../data/services'
import { Add } from './screens/Add'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initialize(repos)
})

it('re-import preview: counts updated / new / unchanged, and Confirm upgrades in place', async () => {
  const user = userEvent.setup()
  const old = await createNote(repos, { type: 'tense', fields: { sentence: 'She usually {{studies::study}} in the library.', tense: 'present-simple' } }, ['tense:present-simple'], null)
  await createNote(repos, { type: 'sentence', fields: { text: 'It depends on you.' } }, [], null)
  const [card] = await repos.cards.byNote(old.id)
  await reviewCard(repos, { cardId: card!.id, grade: 3, correct: true, responseMs: 1, mode: 'session', userAnswer: null })
  const cardBefore = await repos.cards.get(card!.id)

  render(
    <MemoryRouter>
      <Add />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText(/Paste the Study Package/), {
    target: {
      value: `@tense She usually {{studies::study}} in the library. | tense: present simple | why: a habit | he: היא בדרך כלל לומדת בספרייה.
@sentence It depends on you.
@vocab hedge | to reduce a risk | Firms hedge risk.`,
    },
  })
  await waitFor(() => expect(screen.getByText(/will be updated/).textContent).toBe('1 item will be updated, 1 new, 1 unchanged.'))
  expect(screen.getByText('Update: adds why, he')).toBeInTheDocument()
  expect(screen.getByText('Unchanged (nothing new)')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(await screen.findByText(/^1 new, 1 updated, 1 unchanged.$/)).toBeInTheDocument()
  expect(await repos.notes.count()).toBe(3)
  expect((await repos.notes.get(old.id))!.fields).toMatchObject({ why: 'a habit', he: 'היא בדרך כלל לומדת בספרייה.' })
  expect(await repos.cards.get(card!.id)).toEqual(cardBefore)
})
