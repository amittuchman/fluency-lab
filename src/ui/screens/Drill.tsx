import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { repos } from '../../data'
import { readinessFor, type Readiness } from '../../data/services'
import { Empty } from '../components/ui'
import { StudySession } from './StudySession'

/**
 * Mastery loop for one package (/drill/package/:id) or one tag (/drill/tag/:tag).
 * ?all=1 drills every card again, including cards that are already "ready".
 */
export function Drill() {
  const { kind, id = '' } = useParams()
  const [params] = useSearchParams()
  const all = params.get('all') === '1'
  // Snapshot once: cards unlocked during the drill must not restart it.
  const [data, setData] = useState<{ title: string; readiness: Readiness } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const notes = await repos.notes.all()
      const own = kind === 'package' ? notes.filter((n) => n.packageId === id) : notes.filter((n) => n.tags.includes(id))
      const title = kind === 'package' ? ((await repos.packages.get(id))?.name ?? 'Package') : `#${id}`
      const readiness = await readinessFor(repos, own)
      if (!cancelled) setData({ title, readiness })
    })()
    return () => {
      cancelled = true
    }
  }, [kind, id])

  if (!data) return <p className="muted">Loading…</p>
  if (!data.readiness.total) return <Empty title="Nothing to drill here." />

  return (
    <StudySession
      key={`${kind}:${id}:${all}`}
      source={{ kind: 'drill', title: data.title, cardIds: data.readiness.cardIds, readyIds: all ? [] : data.readiness.readyIds }}
    />
  )
}
