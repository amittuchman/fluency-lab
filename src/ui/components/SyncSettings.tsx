import { useEffect, useState, type ReactNode } from 'react'
import {
  changePassword,
  createAccount,
  MIN_PASSWORD_LENGTH,
  pendingChanges,
  sendPasswordReset,
  signInWithPassword,
  signOut,
  syncNow,
  useSyncState,
} from '../../sync/manager'
import { formatAgo } from '../format'
import { useNow } from '../hooks'
import { Button, Confirm, Modal } from './ui'

/** Settings → Sync: sign in with email + password, see status, sync now, change password, sign out. */
export function SyncSettings() {
  const s = useSyncState()
  return (
    <section className="card space-y-3" id="sync" aria-labelledby="sync-title">
      <h2 id="sync-title" className="font-medium">
        Sync between devices
      </h2>
      {s.email ? <SignedIn /> : <SignIn />}
    </section>
  )
}

type Mode = 'signin' | 'create' | 'forgot'

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run, setError }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block max-w-xs">
      <span className="label">{label}</span>
      {children}
    </label>
  )
}

function SignIn() {
  const s = useSyncState()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const { busy, error, run, setError } = useAction()

  const switchTo = (m: Mode) => {
    setMode(m)
    setError(null)
    setNotice(null)
  }
  const tooShort = mode === 'create' && password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  const mismatch = mode === 'create' && confirm.length > 0 && confirm !== password
  const ready = email.includes('@') && (mode === 'forgot' || (password.length > 0 && (mode === 'signin' || (!tooShort && confirm === password))))

  const submit = () =>
    run(async () => {
      if (mode === 'signin') await signInWithPassword(email, password)
      else if (mode === 'create') {
        if ((await createAccount(email, password)) === 'confirmation-required') {
          // Switch tabs first: switching clears notices.
          switchTo('signin')
          setNotice(
            'Account created, but Supabase still requires email confirmation, so you are not signed in yet. Turn off "Confirm email" in Supabase (see README), then use Sign in.',
          )
        }
      } else {
        await sendPasswordReset(email)
        setNotice('If an account exists for this email, a reset link is on its way. Open it on this device, in this same browser or app, within an hour.')
      }
    })

  return (
    <div className="space-y-3 text-sm">
      <p className="muted">
        Optional. Sign in with the same email and password on your laptop and phone and your notes, cards and review history stay in step. Without an
        account everything stays on this device, as now.
      </p>
      <div className="inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700" role="tablist" aria-label="Account">
        {(['signin', 'create'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`rounded-md px-3 py-1 text-sm font-medium ${mode === m ? 'bg-sky-600 text-white' : 'muted hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            onClick={() => switchTo(m)}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      {mode === 'create' && <p className="muted text-xs">Create the account once, on your first device. On every other device, use Sign in.</p>}
      {mode === 'forgot' && <p className="muted text-xs">We'll email you a link to choose a new password.</p>}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !busy) void submit()
        }}
      >
        <Field label="Email">
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        {mode !== 'forgot' && (
          <Field label="Password">
            <input
              className="input"
              type={show ? 'text' : 'password'}
              autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
        )}
        {mode === 'create' && (
          <Field label="Password again">
            <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
        )}
        {mode !== 'forgot' && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Show password
          </label>
        )}
        {tooShort && <p className="text-xs text-amber-700 dark:text-amber-300">At least {MIN_PASSWORD_LENGTH} characters.</p>}
        {mismatch && <p className="text-xs text-amber-700 dark:text-amber-300">The two passwords don't match.</p>}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button variant="primary" type="submit" disabled={!ready || busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'create' ? 'Create account' : 'Email me a reset link'}
          </Button>
          {mode === 'signin' && (
            <button type="button" className="text-xs text-sky-700 underline dark:text-sky-300" onClick={() => switchTo('forgot')}>
              Forgot password?
            </button>
          )}
          {mode === 'forgot' && (
            <button type="button" className="text-xs text-sky-700 underline dark:text-sky-300" onClick={() => switchTo('signin')}>
              Back to sign in
            </button>
          )}
        </div>
      </form>
      {(error ?? s.error) && (
        <p className="text-rose-700 dark:text-rose-300" role="alert">
          {error ?? s.error}
        </p>
      )}
      {notice && (
        <p className="text-emerald-700 dark:text-emerald-300" role="status">
          {notice}
        </p>
      )}
      <p className="muted text-xs">
        The first sign-in on a device merges this device's data with your account: nothing is deleted, and if both have data you get both.
      </p>
    </div>
  )
}

function SignedIn() {
  const s = useSyncState()
  const now = useNow(15_000)
  const [pending, setPending] = useState<number | null>(null)
  const [confirmOut, setConfirmOut] = useState(false)
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    void pendingChanges().then(setPending)
  }, [s.status, now])

  const statusText = {
    local: 'Not signed in',
    syncing: 'Syncing…',
    synced: 'Up to date',
    offline: 'Offline: changes are saved here and sync when you are back online',
    error: `Sync error: ${s.error ?? 'unknown'}`,
  }[s.status]

  return (
    <div className="space-y-3 text-sm">
      <p>
        Signed in as <strong>{s.email}</strong>.
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="muted">Status</dt>
        <dd className={s.status === 'error' ? 'text-rose-700 dark:text-rose-300' : ''} aria-live="polite">
          {statusText}
        </dd>
        <dt className="muted">Last synced</dt>
        <dd>{s.lastSyncedAt ? formatAgo(s.lastSyncedAt, now) : 'not yet'}</dd>
        <dt className="muted">Waiting to upload</dt>
        <dd>{pending === null ? '…' : pending === 0 ? 'nothing' : `${pending} changes`}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void syncNow()} disabled={s.status === 'syncing'}>
          Sync now
        </Button>
        <Button onClick={() => setChanging(true)}>Change password</Button>
        <Button onClick={() => setConfirmOut(true)}>Sign out</Button>
      </div>
      <p className="muted text-xs">Sync runs on its own: when the app opens, when you are back online, after each session and every few minutes.</p>
      {changing && <NewPasswordDialog title="Change password" onClose={() => setChanging(false)} />}
      {confirmOut && (
        <Confirm
          title="Sign out on this device?"
          body={
            <>
              Your data stays on this device and keeps working offline. Changes you make while signed out are uploaded the next time you sign in.
              {pending ? ` ${pending} changes have not been uploaded yet.` : ''}
            </>
          }
          confirmLabel="Sign out"
          onCancel={() => setConfirmOut(false)}
          onConfirm={async () => {
            setConfirmOut(false)
            await signOut()
          }}
        />
      )}
    </div>
  )
}

function NewPasswordDialog({ title, intro, onClose }: { title: string; intro?: string; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const { busy, error, run } = useAction()
  const valid = password.length >= MIN_PASSWORD_LENGTH && password === confirm
  return (
    <Modal title={title} onClose={onClose}>
      {done ? (
        <div className="space-y-3 text-sm">
          <p>Password changed. Use the new one when you sign in on your other devices; devices already signed in stay signed in.</p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) void run(async () => {
              await changePassword(password)
              setDone(true)
            })
          }}
        >
          {intro && <p>{intro}</p>}
          <Field label="New password">
            <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <Field label="New password again">
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <p className="muted text-xs">At least {MIN_PASSWORD_LENGTH} characters.</p>
          {error && (
            <p className="text-rose-700 dark:text-rose-300" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={!valid || busy}>
              {busy ? 'Saving…' : 'Save password'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

/** Shown app-wide after opening a password-reset link. */
export function PasswordRecoveryDialog() {
  const s = useSyncState()
  const [dismissed, setDismissed] = useState(false)
  if (!s.recovery || dismissed) return null
  return <NewPasswordDialog title="Choose a new password" intro={`Signed in as ${s.email ?? 'you'} from the reset link.`} onClose={() => setDismissed(true)} />
}
