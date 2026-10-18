import { useLiveQuery } from 'dexie-react-hooks'
import { createContext, useContext, useEffect, useState, type DependencyList } from 'react'
import type { CheatSheetOverrides } from '../domain/cheatsheets'
import { DEFAULT_SETTINGS, type Settings } from '../domain/types'

/**
 * Live query over the repositories. Currently backed by Dexie's liveQuery, which re-runs the
 * querier whenever the tables it read change. A sync backend would provide its own version here.
 */
export function useRepoQuery<T>(querier: () => Promise<T>, deps: DependencyList): T | undefined {
  return useLiveQuery(querier, [...deps])
}

export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS)

/** User edits to the tense cheat-sheets (defaults live in domain/cheatsheets). */
export const CheatSheetContext = createContext<CheatSheetOverrides | undefined>(undefined)

export function useCheatSheets(): CheatSheetOverrides | undefined {
  return useContext(CheatSheetContext)
}

export function useSettings(): Settings {
  return useContext(SettingsContext)
}

/** Re-render every `ms` milliseconds (for "due in" labels and the day rollover). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** True when a keyboard event comes from a text field (so single-letter shortcuts must not fire). */
export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (tag === 'INPUT' && !(el as HTMLInputElement).readOnly) || (tag === 'TEXTAREA' && !(el as HTMLTextAreaElement).readOnly) || tag === 'SELECT' || el.isContentEditable
}
