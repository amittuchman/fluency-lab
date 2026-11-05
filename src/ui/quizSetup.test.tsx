import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { db, repos } from '../data'
import { createNote, initialize } from '../data/services'
import { Quiz } from './screens/Quiz'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initialize(repos)
  await repos.packages.put({ id: 'p1', name: 'Monday', createdAt: 1, sourceText: '' })
  await repos.packages.put({ id: 'p2', name: 'Tuesday', createdAt: 2, sourceText: '' })
  await repos.packages.put({ id: 'p3', name: 'Wednesday', createdAt: 3, sourceText: '' })
  const fix = (wrong: string, right: string, pkg: string, tags: string[]) =>
    createNote(repos, { type: 'fix', fields: { wrong, right, rule: 'r' } }, tags, pkg)
  await fix('It depends of it.', 'It depends on it.', 'p1', ['prepositions'])
  await fix('I very agree.', 'I completely agree.', 'p1', ['adverbs', 'prepositions'])
  await fix('He explained me it.', 'He explained it to me.', 'p2', ['verb-patterns'])
  await fix('I didn’t went.', 'I didn’t go.', 'p3', ['tenses'])
})

function renderQuiz(url = '/quiz') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Quiz />
    </MemoryRouter>,
  )
}

it('several packages: checkboxes, Select all / Clear, the number of items, and a quiz from all of them', async () => {
  const user = userEvent.setup()
  renderQuiz()
  await user.click(await screen.findByText('Package'))
  const list = screen.getByRole('list', { name: 'Packages' })
  const start = screen.getByRole('button', { name: 'Start quiz' })
  expect(screen.getByText('Select at least one package.')).toBeInTheDocument()
  expect(start).toBeDisabled()

  await user.click(within(list).getByLabelText('Monday'))
  await user.click(within(list).getByLabelText('Tuesday'))
  expect(screen.getByRole('status')).toHaveTextContent('3 items available')
  expect(screen.getByText('Packages: 2 of 3 selected')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Select all' }))
  expect(screen.getByRole('status')).toHaveTextContent('4 items available')
  await user.click(screen.getByRole('button', { name: 'Clear' }))
  expect(start).toBeDisabled()

  await user.click(within(list).getByLabelText('Tuesday'))
  await user.click(within(list).getByLabelText('Wednesday'))
  await user.click(start)
  // The quiz runs with the 2 items of Tuesday and Wednesday.
  expect(await screen.findByText(/Question 1\/2/)).toBeInTheDocument()
})

it('several tags: an item with two of them is counted once; a tag link preselects it', async () => {
  const user = userEvent.setup()
  renderQuiz('/quiz?tag=prepositions')
  const list = await screen.findByRole('list', { name: 'Tags' })
  expect(within(list).getByLabelText('#prepositions')).toBeChecked()
  expect(screen.getByRole('status')).toHaveTextContent('2 items available')
  await user.click(within(list).getByLabelText('#adverbs'))
  expect(screen.getByRole('status')).toHaveTextContent('2 items available')
  await user.click(within(list).getByLabelText('#tenses'))
  expect(screen.getByRole('status')).toHaveTextContent('3 items available')
})

it('a tag link for a tag no item has selects nothing', async () => {
  renderQuiz('/quiz?tag=nope')
  expect(await screen.findByText('Tags: 0 of 4 selected')).toBeInTheDocument()
  expect(screen.getByText('Select at least one tag.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start quiz' })).toBeDisabled()
})
