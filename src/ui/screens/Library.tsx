import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { repos } from '../../data'
import { addTags, moveToPackage, removeTag, setNotesSuspended, trashNotes } from '../../data/services'
import { clozePlain } from '../../domain/cloze'
import { primaryText } from '../../domain/parser'
import { dayEnd, formatInterval } from '../../domain/scheduler'
import { NOTE_TYPES, type Card, type Note } from '../../domain/types'
import { groupBy } from '../../domain/util'
import { EditNoteModal } from '../components/EditNoteModal'
import { parseTags } from '../noteForm'
import { Button, Confirm, Empty, Modal, PageHeader, TagList, TypeBadge } from '../components/ui'
import { useNow, useRepoQuery, useSettings } from '../hooks'

const NOTE_STATES = ['new', 'learning', 'review', 'due', 'suspended', 'leech'] as const
type NoteState = (typeof NOTE_STATES)[number]

interface Row {
  note: Note
  text: string
  search: string
  states: Set<NoteState>
  nextDue: number | null
}

/** Full-text search key: every field value of the note. */
function searchText(n: Note): string {
  return Object.values(n.fields)
    .flat()
    .map((v) => (typeof v === 'string' ? clozePlain(v) : ''))
    .join(' ')
    .toLowerCase()
}

function noteStates(note: Note, cards: Card[], now: number, end: number): Set<NoteState> {
  const s = new Set<NoteState>()
  const live = cards.filter((c) => c.unlocked && !c.suspended)
  if (note.suspended || (cards.length > 0 && cards.every((c) => c.suspended))) s.add('suspended')
  if (cards.some((c) => c.leech)) s.add('leech')
  if (live.length && live.every((c) => c.fsrs.state === 0)) s.add('new')
  if (live.some((c) => c.fsrs.state === 1 || c.fsrs.state === 3)) s.add('learning')
  if (live.some((c) => c.fsrs.state === 2)) s.add('review')
  if (!note.suspended && live.some((c) => c.fsrs.state !== 0 && c.fsrs.due < end && (c.buriedUntil ?? 0) <= now)) s.add('due')
  return s
}

export function Library() {
  const settings = useSettings()
  const now = useNow()
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Note | null>(null)
  const [bulk, setBulk] = useState<null | 'tag' | 'untag' | 'move' | 'delete'>(null)
  const q = params.get('q') ?? ''
  const type = params.get('type') ?? ''
  const tag = params.get('tag') ?? ''
  const pkg = params.get('package') ?? ''
  const state = (params.get('state') ?? '') as NoteState | ''

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
    setSelected(new Set())
  }

  const data = useRepoQuery(async () => {
    const [notes, cards, packages] = await Promise.all([repos.notes.all(), repos.cards.all(), repos.packages.all()])
    return { notes, cards, packages }
  }, [])

  const rows: Row[] = useMemo(() => {
    if (!data) return []
    const end = dayEnd(now, settings.rolloverHour)
    const byNote = groupBy(data.cards, (c) => c.noteId)
    return data.notes
      .map((note) => {
        const cards = byNote.get(note.id) ?? []
        const reviewed = cards.filter((c) => c.fsrs.state !== 0 && c.unlocked && !c.suspended).map((c) => c.fsrs.due)
        return {
          note,
          text: primaryText(note),
          search: searchText(note),
          states: noteStates(note, cards, now, end),
          nextDue: reviewed.length ? Math.min(...reviewed) : null,
        }
      })
      .sort((a, b) => b.note.createdAt - a.note.createdAt)
  }, [data, now, settings.rolloverHour])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!needle || r.search.includes(needle) || r.note.tags.some((t) => t.includes(needle))) &&
        (!type || r.note.type === type) &&
        (!tag || r.note.tags.includes(tag)) &&
        (!pkg || (pkg === 'none' ? r.note.packageId === null : r.note.packageId === pkg)) &&
        (!state || r.states.has(state)),
    )
  }, [rows, q, type, tag, pkg, state])

  const allTags = useMemo(() => [...new Set(rows.flatMap((r) => r.note.tags))].sort(), [rows])
  const pkgName = new Map(data?.packages.map((p) => [p.id, p.name]))

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
  })

  const ids = [...selected].filter((id) => filtered.some((r) => r.note.id === id))
  const allSelected = filtered.length > 0 && ids.length === filtered.length
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  if (!data) return <p className="muted">Loading…</p>

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Library">
        <span className="muted text-sm">
          {filtered.length} of {rows.length} notes
        </span>
      </PageHeader>

      <div className="card mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        <input className="input col-span-2 lg:col-span-1" placeholder="Search…" value={q} onChange={(e) => setParam('q', e.target.value)} aria-label="Search" />
        <select className="input" value={type} onChange={(e) => setParam('type', e.target.value)} aria-label="Type">
          <option value="">All types</option>
          {NOTE_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className="input" value={tag} onChange={(e) => setParam('tag', e.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <select className="input" value={pkg} onChange={(e) => setParam('package', e.target.value)} aria-label="Package">
          <option value="">All packages</option>
          <option value="none">No package</option>
          {data.packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select className="input" value={state} onChange={(e) => setParam('state', e.target.value)} aria-label="State">
          <option value="">Any state</option>
          {NOTE_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.note.id)))} />
          Select all
        </label>
        {ids.length > 0 && (
          <>
            <span className="muted">{ids.length} selected:</span>
            <Button size="sm" onClick={() => setBulk('tag')}>
              Add tag
            </Button>
            <Button size="sm" onClick={() => setBulk('untag')}>
              Remove tag
            </Button>
            <Button size="sm" onClick={() => void setNotesSuspended(repos, ids, true)}>
              Suspend
            </Button>
            <Button size="sm" onClick={() => void setNotesSuspended(repos, ids, false)}>
              Unsuspend
            </Button>
            <Button size="sm" onClick={() => setBulk('move')}>
              Move
            </Button>
            <Button size="sm" variant="danger" onClick={() => setBulk('delete')}>
              Delete
            </Button>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <Empty title={rows.length ? 'No notes match these filters.' : 'Your library is empty.'} />
      ) : (
        <div ref={scrollRef} className="card h-[65vh] overflow-y-auto p-0" role="list">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((v) => {
              const r = filtered[v.index]!
              return (
                <div
                  key={r.note.id}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  role="listitem"
                  className="absolute left-0 top-0 flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800"
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  <input type="checkbox" className="mt-1" checked={selected.has(r.note.id)} onChange={() => toggle(r.note.id)} aria-label="Select note" />
                  <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r.note)}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TypeBadge type={r.note.type} />
                      <span className={`truncate ${r.states.has('suspended') ? 'muted line-through' : ''}`}>{r.text}</span>
                      {r.states.has('leech') && <span className="text-xs font-medium text-rose-600">leech</span>}
                    </div>
                    <div className="muted mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                      <TagList tags={r.note.tags} />
                      {r.note.packageId && <span>{pkgName.get(r.note.packageId)}</span>}
                      <span>
                        {r.states.has('new') ? 'new' : r.nextDue === null ? '' : r.nextDue <= now ? 'due now' : `due in ${formatInterval(r.nextDue - now)}`}
                      </span>
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {editing && <EditNoteModal note={editing} onClose={() => setEditing(null)} showCards />}
      {(bulk === 'tag' || bulk === 'untag') && (
        <TagPrompt
          title={bulk === 'tag' ? `Add tag to ${ids.length} notes` : `Remove tag from ${ids.length} notes`}
          onClose={() => setBulk(null)}
          onSubmit={async (t) => {
            if (bulk === 'tag') await addTags(repos, ids, parseTags(t))
            else for (const one of parseTags(t)) await removeTag(repos, ids, one)
            setBulk(null)
          }}
        />
      )}
      {bulk === 'move' && (
        <Modal title={`Move ${ids.length} notes`} onClose={() => setBulk(null)}>
          <div className="grid gap-2">
            <Button
              onClick={async () => {
                await moveToPackage(repos, ids, null)
                setBulk(null)
              }}
            >
              No package
            </Button>
            {data.packages.map((p) => (
              <Button
                key={p.id}
                onClick={async () => {
                  await moveToPackage(repos, ids, p.id)
                  setBulk(null)
                }}
              >
                {p.name}
              </Button>
            ))}
          </div>
        </Modal>
      )}
      {bulk === 'delete' && (
        <Confirm
          title={`Delete ${ids.length} notes?`}
          body="They move to Trash with their cards and review history. You can restore them for 30 days; after that they are removed for good."
          confirmLabel="Move to Trash"
          danger
          onCancel={() => setBulk(null)}
          onConfirm={async () => {
            await trashNotes(repos, ids)
            setSelected(new Set())
            setBulk(null)
          }}
        />
      )}
    </div>
  )
}

function TagPrompt({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (tags: string) => Promise<void> }) {
  const [value, setValue] = useState('')
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void onSubmit(value)
        }}
        className="space-y-3"
      >
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus placeholder="tag-name" />
        <div className="flex justify-end">
          <Button variant="primary" type="submit" disabled={!parseTags(value).length}>
            Apply
          </Button>
        </div>
      </form>
    </Modal>
  )
}
