import type { SupabaseClient, User } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { db } from '../data'
import { onLocalChange } from '../data/changes'
import { authMessage } from './authMessages'
import { AUTH_STORAGE_KEY, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config'
import { SyncEngine } from './engine'
import { SupabaseRemote, SyncError } from './supabaseRemote'

/**
 * Account + background sync for the app. Without an account the app is local-only and none of this loads.
 * Sync runs on start, when the connection comes back, when the app becomes visible again, after study
 * sessions and quizzes, a little after local changes, and every few minutes while open.
 */
export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'

export interface SyncState {
  status: SyncStatus
  email: string | null
  lastSyncedAt: number | null
  error: string | null
  /** Opened from a password-reset link: the user should choose a new password now. */
  recovery: boolean
}

export const MIN_PASSWORD_LENGTH = 8

const PERIODIC_MS = 5 * 60_000
const AFTER_CHANGE_MS = 20_000
const VISIBLE_AGAIN_MS = 60_000

let state: SyncState = { status: 'local', email: null, lastSyncedAt: null, error: null, recovery: false }
const listeners = new Set<() => void>()
function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}

let client: SupabaseClient | null = null
let user: User | null = null

/** supabase-js is loaded only when an account is used, keeping the local-only app small. */
async function getClient(): Promise<SupabaseClient> {
  if (client) return client
  const { createClient } = await import('@supabase/supabase-js')
  client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      // PKCE: a password-reset link comes back as ?code=… (query, not hash, so it can't clash with the
      // app's hash routes) and is exchanged for a session here.
      flowType: 'pkce',
      detectSessionInUrl: true,
    },
  })
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') signedOut()
    else if (event === 'PASSWORD_RECOVERY') set({ recovery: true })
    if (session?.user && event !== 'SIGNED_OUT') void signedIn(session.user)
  })
  return client
}

function hasStoredSession(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

/** A password-reset link landed here (?code=…). */
function authCodeInUrl(): boolean {
  return new URLSearchParams(location.search).has('code')
}

function clearAuthCodeFromUrl() {
  history.replaceState(null, '', location.pathname + location.hash)
}

async function signedIn(u: User) {
  if (user?.id === u.id) return
  user = u
  const last = await new SyncEngine(db, new SupabaseRemote(client!, u.id), u.id).lastSyncedAt()
  set({ email: u.email ?? null, lastSyncedAt: last, status: navigator.onLine ? 'synced' : 'offline', error: null })
  void syncNow()
}

function signedOut() {
  user = null
  set({ status: 'local', email: null, lastSyncedAt: null, error: null, recovery: false })
}

let started = false
let changeTimer: ReturnType<typeof setTimeout> | undefined

/** Call once at app start. Restores a saved session (if any) and wires up the sync triggers. */
export async function startSync(): Promise<void> {
  if (started) return
  started = true
  window.addEventListener('online', () => void syncNow())
  window.addEventListener('offline', () => user && set({ status: 'offline' }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (state.lastSyncedAt ?? 0) > VISIBLE_AGAIN_MS) void syncNow()
  })
  setInterval(() => document.visibilityState === 'visible' && void syncNow(), PERIODIC_MS)
  onLocalChange(() => {
    if (!user) return
    clearTimeout(changeTimer)
    changeTimer = setTimeout(() => void syncNow(), AFTER_CHANGE_MS)
  })
  const fromResetLink = authCodeInUrl()
  if (!hasStoredSession() && !fromResetLink) return
  const c = await getClient()
  const { data } = await c.auth.getSession()
  if (fromResetLink) {
    clearAuthCodeFromUrl()
    // The link can only be used where the reset was requested (PKCE keeps a secret there).
    if (!data.session) set({ error: 'This password-reset link has to be opened in the same browser (or installed app) where you asked for it, within an hour. Ask for a new one there.' })
  }
  if (data.session?.user) await signedIn(data.session.user)
}

let running: Promise<void> | null = null
let again = false

/** Sync now (or right after the sync in progress). Safe to call often; does nothing when signed out. */
export function syncNow(): Promise<void> {
  if (!user || !client) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      if (!navigator.onLine) {
        set({ status: 'offline' })
        break
      }
      set({ status: 'syncing', error: null })
      try {
        await new SyncEngine(db, new SupabaseRemote(client!, user!.id), user!.id).sync()
        set({ status: 'synced', lastSyncedAt: Date.now() })
      } catch (e) {
        if (e instanceof SyncError && e.offline) set({ status: 'offline' })
        else set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
        break
      }
    } while (again && user)
  })().finally(() => {
    running = null
  })
  return running
}

/** Sign in; the session is saved on this device and the first sync (a merge) starts. */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const c = await getClient()
  const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(authMessage(error.message))
  await signedIn(data.user)
}

/**
 * Create the account (once, on the first device). With "Confirm email" turned off in Supabase this signs
 * in right away; if it is still on, Supabase sends a confirmation email instead and there is no session yet.
 */
export async function createAccount(email: string, password: string): Promise<'signed-in' | 'confirmation-required'> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  const c = await getClient()
  const { data, error } = await c.auth.signUp({ email: email.trim(), password })
  if (error) throw new Error(authMessage(error.message))
  if (!data.session || !data.user) return 'confirmation-required'
  await signedIn(data.user)
  return 'signed-in'
}

/** Set a new password (while signed in, or after opening a reset link). */
export async function changePassword(password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  const c = await getClient()
  const { error } = await c.auth.updateUser({ password })
  if (error) throw new Error(authMessage(error.message))
  set({ recovery: false, error: null })
}

/**
 * Forgotten password: Supabase emails a reset link (its default email; no template changes needed). The link
 * must be opened where it was requested: it comes back here as ?code=… and opens "choose a new password".
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const c = await getClient()
  const { error } = await c.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname })
  if (error) throw new Error(authMessage(error.message))
}

/** Sign out on this device only. Local data stays; it keeps working local-only. */
export async function signOut(): Promise<void> {
  if (!client) return
  await client.auth.signOut({ scope: 'local' })
  signedOut()
}

/** Number of local changes not yet in the cloud. */
export function pendingChanges(): Promise<number> {
  return db.dirty.count()
}
