import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { db, repos } from '../data'
import { importPackage, initialize } from '../data/services'
import { Add } from './screens/Add'
import { Packages } from './screens/Packages'

const NAME = '2026-11-05 – Past Simple'
const BLOCK = `# Package: ${NAME}
@tense We {{met::meet}} at a conference in 2019. | tense: past simple
@tense I {{saw::see}} her at the office yesterday. | tense: past simple`

beforeEach(async () => {
  await db.delete()
  await db.open()
  await initialize(repos)
})

async function imported() {
  const items = [
    { type: 'tense', fields: { sentence: 'We {{met::meet}} at a conference in 2019.', tense: 'past-simple' } },
    { type: 'tense', fields: { sentence: 'I {{saw::see}} her at the office yesterday.', tense: 'past-simple' } },
  ].map((content) => ({ content, tags: ['tense:past-simple'], action: 'create' as const })) as Parameters<typeof importPackage>[1]['items']
  return importPackage(repos, { name: NAME, sourceText: BLOCK, items })
}
const renderPackages = () =>
  render(
    <MemoryRouter>
      <Packages />
    </MemoryRouter>,
  )

it('deleting a package asks clearly: package only (notes kept, listed as without a package), or with its notes', async () => {
  const user = userEvent.setup()
  await imported()
  renderPackages()
  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  expect(screen.getByRole('button', { name: 'Delete the package and move its notes to Trash' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Delete the package only (keep its notes)' }))

  expect(await screen.findByText('Items without a package (2)')).toBeInTheDocument()
  expect(await repos.packages.all()).toEqual([])
  expect(await repos.notes.count()).toBe(2)
  expect(await repos.notes.trashed()).toEqual([])
})

it('the other choice moves the notes to Trash', async () => {
  const user = userEvent.setup()
  await imported()
  renderPackages()
  await user.click(await screen.findByRole('button', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: 'Delete the package and move its notes to Trash' }))
  await waitFor(async () => expect(await repos.notes.trashed()).toHaveLength(2))
  expect(await repos.packages.all()).toEqual([])
})

it('items without a package can be put in a new package by name', async () => {
  const user = userEvent.setup()
  const s = await imported()
  await repos.notes.bulkPut((await repos.notes.all()).map((n) => ({ ...n, packageId: null })))
  await repos.packages.delete(s.packageId!)
  renderPackages()
  await user.type(await screen.findByRole('textbox', { name: 'New package name' }), NAME)
  await user.click(screen.getByRole('button', { name: 'Put in package' }))
  expect(await screen.findByRole('heading', { name: NAME })).toBeInTheDocument()
  expect(screen.queryByText(/Items without a package/)).not.toBeInTheDocument()
})

it('re-importing the block shows and does "added to package"', async () => {
  const user = userEvent.setup()
  const s = await imported()
  await repos.notes.bulkPut((await repos.notes.all()).map((n) => ({ ...n, packageId: null })))
  await repos.packages.delete(s.packageId!)
  render(
    <MemoryRouter>
      <Add />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText(/Paste the Study Package/), { target: { value: BLOCK } })
  await waitFor(() =>
    expect(screen.getByText(/will be updated/).textContent).toBe(`0 items will be updated, 0 new, 2 unchanged · 2 items will be added to package “${NAME}”.`),
  )
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(await screen.findByText(new RegExp(`2 added to package “${NAME}”`))).toBeInTheDocument()
  const pkgs = await repos.packages.all()
  expect(pkgs.map((p) => p.name)).toEqual([NAME])
  expect((await repos.notes.all()).every((n) => n.packageId === pkgs[0]!.id)).toBe(true)
})
