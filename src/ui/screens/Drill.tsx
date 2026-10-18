import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { repos } from '../../data'
import { readinessFor, type Readiness } from '../../data/services'
import { normalizeTense, tenseLabel } from '../../domain/tags'
import type { Note, TenseName } from '../../domain/types'
import { Empty } from '../components/ui'
import { StudySession, type SessionSource } from './StudySession'

interface DrillTarget {
  title: string
  filter: (n: Note) => boolean
  group?: 'tense'
  highlight?: boolean
}

/** /drill/tense/all, /drill/tense/present-perfect, /drill/tense/present-perfect,past-simple */
function tenseTarget(id: string): DrillTarget {
  if (id === 'all') return { title: 'All tenses', filter: (n) => n.type === 'tense', group: 'tense', highlight: true }
  const tenses = id
    .split(',')
    .map(normalizeTense)
    .filter((t): t is TenseName => !!t)
  const title = tenses.length > 1 ? `Contrast: ${tenses.map(tenseLabel).join(' vs ')}` : tenseLabel(tenses[0] ?? 'present-simple')
  return { title, filter: (n) => n.type === 'tense' && tenses.includes(n.fields.tense), group: 'tense', highlight: true }
}

/**
 * Mastery loop for a package (/drill/package/:id), a tag (/drill/tag/:tag) or tenses (/drill/tense/:list).
 * ?all=1 drills every card again, including cards that are already "ready".
 */
export function Drill() {
  const { kind, id = '' } = useParams()
  const [params] = useSearchParams()
  const all = params.get('all') === '1'
  // Snapshot once: cards unlocked during the drill must not restart it.
  const [data, setData] = useState<{ target: DrillTarget; readiness: Readiness } | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let target: DrillTarget
      if (kind === 'package') target = { title: (await repos.packages.get(id))?.name ?? 'Package', filter: (n) => n.packageId === id }
      else if (kind === 'tense') target = tenseTarget(id)
      else target = { title: `#${id}`, filter: (n) => n.tags.includes(id) }
      const readiness = await readinessFor(repos, (await repos.notes.all()).filter(target.filter))
      if (!cancelled) setData({ target, readiness })
    })()
    return () => {
      cancelled = true
    }
  }, [kind, id])

  if (!data) return <p className="muted">Loading…</p>
  if (!data.readiness.total) return <Empty title="Nothing to drill here." />

  const source: SessionSource = {
    kind: 'drill',
    title: data.target.title,
    cardIds: data.readiness.cardIds,
    readyIds: all ? [] : data.readiness.readyIds,
    ...(data.target.group ? { group: data.target.group } : {}),
    ...(data.target.highlight ? { highlight: true } : {}),
  }
  return <StudySession key={`${kind}:${id}:${all}`} source={source} />
}
