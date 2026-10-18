import { useState } from 'react'
import { repos } from '../../data'
import { setCardSuspended, updateNote } from '../../data/services'
import { validateContent } from '../../domain/parser'
import { formatInterval } from '../../domain/scheduler'
import { templateLabel } from '../../domain/templates'
import type { Card, Note, NoteContent } from '../../domain/types'
import { useRepoQuery } from '../hooks'
import { cleanContent, parseTags } from '../noteForm'
import { NoteFields, TagsField } from './NoteEditor'
import { Button, Modal } from './ui'

const STATE_LABEL = ['New', 'Learning', 'Review', 'Relearning']

export function EditNoteModal({ note, onClose, showCards }: { note: Note; onClose: (saved: boolean) => void; showCards?: boolean }) {
  const [content, setContent] = useState<NoteContent>({ type: note.type, fields: note.fields } as NoteContent)
  const [tags, setTags] = useState(note.tags.join(', '))
  const [busy, setBusy] = useState(false)
  const cards = useRepoQuery(() => repos.cards.byNote(note.id), [note.id])
  const errors = validateContent(content).errors

  const save = async () => {
    setBusy(true)
    await updateNote(repos, note.id, cleanContent(content), parseTags(tags))
    onClose(true)
  }

  return (
    <Modal title="Edit note" onClose={() => onClose(false)} wide={showCards}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!errors.length) void save()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !errors.length) {
            e.preventDefault()
            void save()
          }
        }}
        className="space-y-3"
      >
        <NoteFields content={content} onChange={setContent} />
        <TagsField value={tags} onChange={setTags} />
        <p className="muted text-xs">Cards whose question changes restart their schedule; the others keep it.</p>
        {showCards && cards && <CardTable cards={cards} />}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={() => onClose(false)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || errors.length > 0}>
            Save <span className="text-xs opacity-75">Ctrl+Enter</span>
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function CardTable({ cards }: { cards: Card[] }) {
  const now = Date.now()
  const sorted = [...cards].sort((a, b) => a.order - b.order || a.template.localeCompare(b.template))
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="muted text-xs">
          <tr>
            <th className="py-1 pr-2 font-medium">Card</th>
            <th className="pr-2 font-medium">State</th>
            <th className="pr-2 font-medium">Due</th>
            <th className="pr-2 font-medium">Stability</th>
            <th className="pr-2 font-medium">Lapses</th>
            <th className="font-medium" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id} className="border-t border-slate-200 dark:border-slate-800">
              <td className="py-1.5 pr-2">
                {templateLabel(c.template)}
                {c.leech && <span className="ml-1 text-xs text-rose-600">leech</span>}
              </td>
              <td className="pr-2">{!c.unlocked ? 'Locked' : c.suspended ? 'Suspended' : STATE_LABEL[c.fsrs.state]}</td>
              <td className="pr-2 tabular-nums">{c.fsrs.state === 0 ? '–' : c.fsrs.due <= now ? 'now' : formatInterval(c.fsrs.due - now)}</td>
              <td className="pr-2 tabular-nums">{c.fsrs.stability ? `${c.fsrs.stability.toFixed(1)}d` : '–'}</td>
              <td className="pr-2 tabular-nums">{c.fsrs.lapses}</td>
              <td className="text-right">
                <Button size="sm" variant="ghost" onClick={() => void setCardSuspended(repos, c.id, !c.suspended)}>
                  {c.suspended ? 'Unsuspend' : 'Suspend'}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
