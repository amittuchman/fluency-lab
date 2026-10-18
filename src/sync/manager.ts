import type { SupabaseClient, User } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { db } from '../data'
import { onLocalChange } from '../data/changes'
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
}

const PERIODIC_MS = 5 * 60_000
const AFTER_CHANGE_MS = 20_000
const VISIBLE_AGAIN_MS = 60_000

let state: SyncState = { status: 'local', email: null, lastSyncedAt: null, error: null }
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
    auth: { storageKey: AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  })
  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') signedOut()
    else if (session?.user && session.user.id !== user?.id) void signedIn(session.user)
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

async function signedIn(u: User) {
  user = u
  const last = await new SyncEngine(db, new SupabaseRemote(client!, u.id), u.id).lastSyncedAt()
  set({ email: u.email ?? null, lastSyncedAt: last, status: navigator.onLine ? 'synced' : 'offline', error: null })
  void syncNow()
}

function signedOut() {
  user = null
  set({ status: 'local', email: null, lastSyncedAt: null, error: null })
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
  if (!hasStoredSession()) return
  const c = await getClient()
  const { data } = await c.auth.getSession()
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

/** Email a 6-digit sign-in code (creates the account on first use). */
export async function sendCode(email: string): Promise<void> {
  const c = await getClient()
  const { error } = await c.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
  if (error) throw new Error(error.message)
}

/** Check the code; on success the session is saved and the first sync (a merge) starts. */
export async function verifyCode(email: string, code: string): Promise<void> {
  const c = await getClient()
  const { data, error } = await c.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
  if (error) throw new Error(error.message)
  if (data.user) await signedIn(data.user)
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
