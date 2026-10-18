import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type ReactNode } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router'
import { repos } from '../data'
import { initialize } from '../data/services'
import type { Settings as SettingsT } from '../domain/types'
import { Empty } from './components/ui'
import { SettingsContext } from './hooks'
import { Add } from './screens/Add'
import { Drill } from './screens/Drill'
import { FormatHelp } from './screens/FormatHelp'
import { Home } from './screens/Home'
import { Library } from './screens/Library'
import { Packages } from './screens/Packages'
import { Settings } from './screens/Settings'
import { StudySession } from './screens/StudySession'
import { Trash } from './screens/Trash'

const NAV: Array<{ to: string; label: string; mobile?: boolean }> = [
  { to: '/', label: 'Home', mobile: true },
  { to: '/study', label: 'Study', mobile: true },
  { to: '/add', label: 'Add', mobile: true },
  { to: '/library', label: 'Library', mobile: true },
  { to: '/packages', label: 'Packages' },
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

  useEffect(() => {
    initialize(repos)
      .then(() => setReady(true))
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
            <Route path="/settings" element={<Settings />} />
            <Route path="/trash" element={<Trash />} />
            <Route path="*" element={<Empty title="Page not found." />} />
          </Routes>
        </Layout>
      </HashRouter>
    </SettingsContext.Provider>
  )
}

function navClass({ isActive }: { isActive: boolean }) {
  return `block rounded-lg px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100' : 'text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800'
  }`
}

function Layout({ children }: { children: ReactNode }) {
  const [more, setMore] = useState(false)
  const location = useLocation()
  useEffect(() => setMore(false), [location.pathname])

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <aside className="hidden w-52 shrink-0 border-r border-slate-200 p-3 md:block dark:border-slate-800">
        <div className="mb-4 px-3 pt-1 text-lg font-semibold">Fluency Lab</div>
        <nav className="space-y-0.5" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={navClass}>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-8 md:pb-8 md:pt-6">
        {children}
      </main>

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
            {NAV.filter((n) => !n.mobile).map((n) => (
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
