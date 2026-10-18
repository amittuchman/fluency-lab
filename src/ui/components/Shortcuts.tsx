import { useEffect, useState } from 'react'
import { isTypingTarget } from '../hooks'
import { Kbd, Modal } from './ui'

const GROUPS: Array<[string, Array<[string, string]>]> = [
  [
    'Studying',
    [
      ['Enter', 'Check the answer, then accept the suggested grade'],
      ['Space', 'Reveal a flip card'],
      ['1 – 4', 'Grade: Again / Hard / Good / Easy (after the reveal)'],
      ['1 – 4', 'Pick a multiple-choice option (before the reveal)'],
      ['Shift + Enter', 'New line in a long answer'],
      ['R', 'Play the audio again'],
      ['Z  or  Ctrl + Z', 'Undo the last review'],
      ['E', 'Edit the note'],
      ['S', 'Suspend the card'],
    ],
  ],
  [
    'Anywhere',
    [
      ['?', 'Show this list'],
      ['Esc', 'Close a dialog'],
      ['Ctrl + Enter', 'Save in Quick Add and the note editor'],
    ],
  ],
]

/** Keyboard shortcuts overlay, opened with "?" from anywhere (except while typing). */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isTypingTarget(e)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('fl:shortcuts', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('fl:shortcuts', onOpen)
    }
  }, [])
  if (!open) return null
  return (
    <Modal title="Keyboard shortcuts" onClose={() => setOpen(false)}>
      <div className="space-y-4">
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h3 className="muted mb-1 text-xs font-medium uppercase tracking-wide">{title}</h3>
            <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {rows.map(([keys, what]) => (
                <div key={keys + what} className="flex items-baseline justify-between gap-4 py-1.5">
                  <dd>{what}</dd>
                  <dt className="shrink-0">
                    <Kbd>{keys}</Kbd>
                  </dt>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
