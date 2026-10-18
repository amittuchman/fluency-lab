import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router'
import { repos } from '../data'
import { initialize } from '../data/services'
import { META } from '../data/repos'
import type { CheatSheetOverrides } from '../domain/cheatsheets'
import type { Settings as SettingsT } from '../domain/types'
import { startSync } from '../sync/manager'
import { ShortcutsOverlay } from './components/Shortcuts'
import { SyncBadge } from './components/SyncBadge'
import { Empty, Kbd } from './components/ui'
import { CheatSheetContext, openShortcuts, SettingsContext } from './hooks'
import { speechRecognitionSupported } from './speech'
import { Home } from './screens/Home'
import { StudySession } from './screens/StudySession'

// Home and the study session load with the app; other screens load on first visit (all are precached offline).
const Add = lazy(() => import('./screens/Add').then((m) => ({ default: m.Add })))
const Drill = lazy(() => import('./screens/Drill').then((m) => ({ default: m.Drill })))
const FormatHelp = lazy(() => import('./screens/FormatHelp').then((m) => ({ default: m.FormatHelp })))
const Library = lazy(() => import('./screens/Library').then((m) => ({ default: m.Library })))
const Leeches = lazy(() => import('./screens/Leeches').then((m) => ({ default: m.Leeches })))
const Packages = lazy(() => import('./screens/Packages').then((m) => ({ default: m.Packages })))
const Quiz = lazy(() => import('./screens/Quiz').then((m) => ({ default: m.Quiz })))
const Settings = lazy(() => import('./screens/Settings').then((m) => ({ default: m.Settings })))
const Stats = lazy(() => import('./screens/Stats').then((m) => ({ default: m.Stats })))
const Speak = lazy(() => import('./screens/Speak').then((m) => ({ default: m.Speak })))
const TenseLab = lazy(() => import('./screens/TenseLab').then((m) => ({ default: m.TenseLab })))
const Trash = lazy(() => import('./screens/Trash').then((m) => ({ default: m.Trash })))
const WeakSpots = lazy(() => import('./screens/WeakSpots').then((m) => ({ default: m.WeakSpots })))

const NAV: Array<{ to: string; label: string; mobile?: boolean; needsSpeech?: boolean }> = [
  { to: '/', label: 'Home', mobile: true },
  { to: '/study', label: 'Study', mobile: true },
  { to: '/add', label: 'Add', mobile: true },
  { to: '/library', label: 'Library', mobile: true },
  { to: '/packages', label: 'Packages' },
  { to: '/tenses', label: 'Tense Lab' },
  { to: '/speak', label: 'Speak', needsSpeech: true },
  { to: '/quiz', label: 'Quiz' },
  { to: '/weak', label: 'Weak spots' },
  { to: '/stats', label: 'Stats' },
  { to: '/leeches', label: 'Leeches' },
  { to: '/settings', label: 'Settings' },
  { to: '/trash', label: 'Trash' },
]

function applyTheme(theme: SettingsT['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  try {
    localStorage.setItem('fl-theme', theme)
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this page.
  }
}

export function App() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const settings = useLiveQuery(() => repos.settings.get(), [])
  const cheatSheets = useLiveQuery(() => repos.meta.get<CheatSheetOverrides>(META.cheatSheets), [])

  useEffect(() => {
    initialize(repos)
      .then(() => {
        setReady(true)
        // Restores a saved account session (if any) and starts background sync. Local-only otherwise.
        void startSync()
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
    // Ask the browser not to evict our IndexedDB data. Silently ignored where unsupported.
    void navigator.storage?.persist?.()
  }, [])

  useEffect(() => {
    if (!settings) return
    applyTheme(settings.theme)
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings])

  if (error) return <p className="p-6 text-rose-700">Could not open the local database: {error}</p>
  if (!ready || !settings) return <p className="muted p-6">Loading…</p>

  return (
    <SettingsContext.Provider value={settings}>
      <CheatSheetContext.Provider value={cheatSheets}>
        <HashRouter>
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/study" element={<StudySession source={{ kind: 'daily' }} />} />
              <Route path="/drill/:kind/:id" element={<Drill />} />
              <Route path="/add" element={<Add />} />
              <Route path="/help/format" element={<FormatHelp />} />
              <Route path="/library" element={<Library />} />
              <Route path="/packages" element={<Packages />} />
              <Route path="/tenses" element={<TenseLab />} />
              <Route path="/speak" element={<Speak />} />
              <Route path="/quiz" element={<Quiz />} />
              <Route path="/weak" element={<WeakSpots />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/leeches" element={<Leeches />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/trash" element={<Trash />} />
              <Route path="*" element={<Empty title="Page not found." />} />
            </Routes>
          </Layout>
        </HashRouter>
      </CheatSheetContext.Provider>
    </SettingsContext.Provider>
  )
}

function navClass({ isActive }: { isActive: boolean }) {
  return `block rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100' : 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800'
  }`
}

function Layout({ children }: { children: ReactNode }) {
  // Speak mode is hidden where the browser has no speech recognition.
  const nav = NAV.filter((n) => !n.needsSpeech || speechRecognitionSupported())
  const [more, setMore] = useState(false)
  const location = useLocation()
  useEffect(() => setMore(false), [location.pathname])
  // A distinct page title per screen, for screen readers and browser history.
  useEffect(() => {
    const p = location.pathname
    const label = p.startsWith('/drill') ? 'Drill' : p.startsWith('/help') ? 'Import format' : NAV.find((n) => n.to !== '/' && p.startsWith(n.to))?.label
    document.title = label ? `${label} · Fluency Lab` : 'Fluency Lab'
  }, [location.pathname])

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="hidden w-52 shrink-0 border-r border-slate-200 p-3 md:block dark:border-slate-800">
        <div className="mb-1 px-3 pt-1 text-lg font-semibold">Fluency Lab</div>
        <SyncBadge className="mb-3 ml-1" />
        <nav className="space-y-0.5" aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={navClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button className="muted mt-4 px-3 text-xs hover:underline" onClick={openShortcuts}>
          Keyboard shortcuts <Kbd>?</Kbd>
        </button>
      </aside>

      <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-6">
        <div className="-mt-2 mb-2 flex justify-end md:hidden">
          <SyncBadge />
        </div>
        <Suspense fallback={<p className="muted">Loading…</p>}>{children}</Suspense>
      </main>
      <ShortcutsOverlay />

      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden dark:border-slate-800 dark:bg-slate-950/95"
        aria-label="Main"
      >
        {NAV.filter((n) => n.mobile).map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `flex-1 py-3 text-center text-xs font-medium ${isActive ? 'text-sky-600 dark:text-sky-400' : 'text-slate-600 dark:text-slate-400'}`}
          >
            {n.label}
          </NavLink>
        ))}
        <button className="flex-1 py-3 text-center text-xs font-medium text-slate-600 dark:text-slate-400" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          More
        </button>
      </nav>
      {more && (
        <div className="fixed inset-x-0 bottom-14 z-40 border-t border-slate-200 bg-white p-3 shadow-lg md:hidden dark:border-slate-800 dark:bg-slate-900">
          <nav className="grid grid-cols-2 gap-1" aria-label="More">
            {nav.filter((n) => !n.mobile).map((n) => (
              <NavLink key={n.to} to={n.to} className={navClass}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </div>
  )
}
