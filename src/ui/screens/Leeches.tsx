import { useState } from 'react'
import { repos } from '../../data'
import { setCardSuspended } from '../../data/services'
import { primaryText } from '../../domain/parser'
import { templateLabel } from '../../domain/templates'
import type { Card, Note } from '../../domain/types'
import { EditNoteModal } from '../components/EditNoteModal'
import { Button, Empty, PageHeader, TagList, TypeBadge } from '../components/ui'
import { useRepoQuery } from '../hooks'

/** Cards that keep failing (6+ lapses). Rewrite them or set them aside. */
export function Leeches() {
  const [editing, setEditing] = useState<Note | null>(null)
  const rows = useRepoQuery(async () => {
    const [notes, cards] = await Promise.all([repos.notes.all(), repos.cards.all()])
    const byId = new Map(notes.map((n) => [n.id, n]))
    return cards
      .filter((c) => c.leech && byId.has(c.noteId))
      .map((card) => ({ card, note: byId.get(card.noteId)! }))
      .sort((a, b) => b.card.fsrs.lapses - a.card.fsrs.lapses)
  }, [])

  if (!rows) return <p className="muted">Loading…</p>
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Leeches" />
      <p className="muted mb-3 text-sm">Cards you have forgotten 6 or more times. Usually the card itself needs work: a clearer example, a memory hook, or splitting it up.</p>
      {rows.length === 0 ? (
        <Empty title="No leeches." />
      ) : (
        <ul className="space-y-2">
          {rows.map(({ card, note }) => (
            <LeechRow key={card.id} card={card} note={note} onEdit={() => setEditing(note)} />
          ))}
        </ul>
      )}
      {editing && <EditNoteModal note={editing} onClose={() => setEditing(null)} showCards />}
    </div>
  )
}

function LeechRow({ card, note, onEdit }: { card: Card; note: Note; onEdit: () => void }) {
  return (
    <li className="card flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeBadge type={note.type} />
          <span>{primaryText(note)}</span>
        </div>
        <p className="muted mt-0.5 text-xs">
          {templateLabel(card.template)} · {card.fsrs.lapses} lapses {card.suspended && '· suspended'}
        </p>
        <TagList tags={note.tags} />
      </div>
      <div className="flex gap-1">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void setCardSuspended(repos, card.id, !card.suspended)}>
          {card.suspended ? 'Unsuspend' : 'Suspend'}
        </Button>
      </div>
    </li>
  )
}
