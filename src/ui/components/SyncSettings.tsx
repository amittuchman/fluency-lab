import { useEffect, useState } from 'react'
import { pendingChanges, sendCode, signOut, syncNow, useSyncState, verifyCode } from '../../sync/manager'
import { formatAgo } from '../format'
import { useNow } from '../hooks'
import { Button, Confirm } from './ui'

const RESEND_SECONDS = 60

/** Settings → Sync: sign in with an emailed code, see status, sync now, sign out. */
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

function SignIn() {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentAt, setSentAt] = useState(0)
  const now = useNow(1000)
  const wait = Math.max(0, RESEND_SECONDS - Math.floor((now - sentAt) / 1000))

  const send = async (to: string) => {
    setBusy(true)
    setError(null)
    try {
      await sendCode(to)
      setSentTo(to)
      setSentAt(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    if (!sentTo) return
    setBusy(true)
    setError(null)
    try {
      await verifyCode(sentTo, code)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="muted">
        Optional. Sign in on your laptop and phone with the same email and your notes, cards and review history stay in step. Without an account
        everything stays on this device, as now.
      </p>
      {!sentTo ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (email.includes('@')) void send(email.trim())
          }}
        >
          <input
            className="input max-w-xs flex-1"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button variant="primary" type="submit" disabled={busy || !email.includes('@')}>
            {busy ? 'Sending…' : 'Email me a code'}
          </Button>
        </form>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            void verify()
          }}
        >
          <p>
            We sent a 6-digit code to <strong>{sentTo}</strong>. Type it here (the email may take a minute; check spam).
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input w-40 font-mono text-lg tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              placeholder="123456"
              aria-label="Code from the email"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
            />
            <Button variant="primary" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <button type="button" className="text-sky-700 underline disabled:no-underline disabled:opacity-60 dark:text-sky-300" disabled={wait > 0 || busy} onClick={() => void send(sentTo)}>
              {wait > 0 ? `Send a new code in ${wait} s` : 'Send a new code'}
            </button>
            <button
              type="button"
              className="text-sky-700 underline dark:text-sky-300"
              onClick={() => {
                setSentTo(null)
                setCode('')
              }}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="text-rose-700 dark:text-rose-300" role="alert">
          {error}
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
        <Button onClick={() => setConfirmOut(true)}>Sign out</Button>
      </div>
      <p className="muted text-xs">Sync runs on its own: when the app opens, when you are back online, after each session and every few minutes.</p>
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
