import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { authMessage } from '../sync/authMessages'
import type { SyncState } from '../sync/manager'
import { SyncSettings } from './components/SyncSettings'

const state: { current: SyncState } = { current: { status: 'local', email: null, lastSyncedAt: null, error: null, recovery: false } }

vi.mock('../sync/manager', () => ({
  MIN_PASSWORD_LENGTH: 8,
  useSyncState: () => state.current,
  signInWithPassword: vi.fn(async () => {}),
  createAccount: vi.fn(async () => 'signed-in'),
  sendPasswordReset: vi.fn(async () => {}),
  changePassword: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
  pendingChanges: vi.fn(async () => 3),
}))

const manager = await import('../sync/manager')

beforeEach(() => {
  vi.clearAllMocks()
  state.current = { status: 'local', email: null, lastSyncedAt: null, error: null, recovery: false }
})

describe('sign in with email and password', () => {
  it('signs in with what was typed', async () => {
    const user = userEvent.setup()
    render(<SyncSettings />)
    await user.type(screen.getByLabelText('Email'), 'amit@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(manager.signInWithPassword).toHaveBeenCalledWith('amit@example.com', 'correct horse')
  })

  it('shows the error in plain words', async () => {
    vi.mocked(manager.signInWithPassword).mockRejectedValueOnce(new Error(authMessage('Invalid login credentials')))
    const user = userEvent.setup()
    render(<SyncSettings />)
    await user.type(screen.getByLabelText('Email'), 'amit@example.com')
    await user.type(screen.getByLabelText('Password'), 'nope')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')
  })

  it('create account: needs 8+ characters typed twice, then creates it', async () => {
    const user = userEvent.setup()
    render(<SyncSettings />)
    await user.click(screen.getByRole('tab', { name: 'Create account' }))
    await user.type(screen.getByLabelText('Email'), 'amit@example.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Password'), 'long enough pw')
    await user.type(screen.getByLabelText('Password again'), 'long enough pX')
    expect(screen.getByText("The two passwords don't match.")).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Password again'))
    await user.type(screen.getByLabelText('Password again'), 'long enough pw')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(manager.createAccount).toHaveBeenCalledWith('amit@example.com', 'long enough pw')
  })

  it('create account while Supabase still requires confirmation: explains what to change', async () => {
    vi.mocked(manager.createAccount).mockResolvedValueOnce('confirmation-required')
    const user = userEvent.setup()
    render(<SyncSettings />)
    await user.click(screen.getByRole('tab', { name: 'Create account' }))
    await user.type(screen.getByLabelText('Email'), 'amit@example.com')
    await user.type(screen.getByLabelText('Password'), 'long enough pw')
    await user.type(screen.getByLabelText('Password again'), 'long enough pw')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/turn off "Confirm email"/i)
  })

  it('forgot password sends a reset link', async () => {
    const user = userEvent.setup()
    render(<SyncSettings />)
    await user.click(screen.getByRole('button', { name: 'Forgot password?' }))
    await user.type(screen.getByLabelText('Email'), 'amit@example.com')
    await user.click(screen.getByRole('button', { name: 'Email me a reset link' }))
    expect(manager.sendPasswordReset).toHaveBeenCalledWith('amit@example.com')
    expect(await screen.findByRole('status')).toHaveTextContent(/same browser or app/)
  })
})

describe('signed in', () => {
  it('shows the account, pending changes, and changes the password', async () => {
    state.current = { status: 'synced', email: 'amit@example.com', lastSyncedAt: Date.now(), error: null, recovery: false }
    const user = userEvent.setup()
    render(<SyncSettings />)
    expect(screen.getByText('amit@example.com')).toBeInTheDocument()
    expect(await screen.findByText('3 changes')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await user.type(screen.getByLabelText('New password'), 'a new password')
    await user.type(screen.getByLabelText('New password again'), 'a new password')
    await user.click(screen.getByRole('button', { name: 'Save password' }))
    expect(manager.changePassword).toHaveBeenCalledWith('a new password')
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument()
  })
})

describe('authMessage', () => {
  it('maps Supabase errors to plain advice', () => {
    expect(authMessage('Invalid login credentials')).toBe('Wrong email or password.')
    expect(authMessage('User already registered')).toMatch(/Use "Sign in"/)
    expect(authMessage('Email not confirmed')).toMatch(/Confirm email/)
    expect(authMessage('Signups not allowed for this instance')).toMatch(/turned off/)
    expect(authMessage('Something else')).toBe('Something else')
  })
})
