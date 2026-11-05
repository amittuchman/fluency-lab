import { useState } from 'react'
import { Link } from 'react-router'
import { repos } from '../../data'
import { assignToPackage, moveToPackage, notesWithoutPackage, readinessFor, trashNotes } from '../../data/services'
import { primaryText } from '../../domain/parser'
import type { Note, Package } from '../../domain/types'
import { Button, Empty, Modal, PageHeader } from '../components/ui'
import { formatDate } from '../format'
import { useRepoQuery } from '../hooks'

export function Packages() {
  const [source, setSource] = useState<Package | null>(null)
  const [deleting, setDeleting] = useState<{ pkg: Package; noteIds: string[] } | null>(null)
  const [renaming, setRenaming] = useState<Package | null>(null)

  const data = useRepoQuery(async () => {
    const [packages, notes] = await Promise.all([repos.packages.all(), repos.notes.all()])
    const rows = await Promise.all(
      packages.map(async (pkg) => {
        const own = notes.filter((n) => n.packageId === pkg.id)
        return { pkg, noteIds: own.map((n) => n.id), readiness: await readinessFor(repos, own) }
      }),
    )
    return { rows, packages, orphans: notesWithoutPackage(notes, packages) }
  }, [])

  if (!data) return <p className="muted">Loading…</p>
  const list = data.rows

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Packages">
        <Link to="/add" className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-700">
          Import a package
        </Link>
      </PageHeader>
      {list.length === 0 && data.orphans.length === 0 && <Empty title="No packages yet.">Every import creates a package.</Empty>}
      {data.orphans.length > 0 && <WithoutPackage notes={data.orphans} packages={data.packages} />}
      <div className="space-y-3">
        {list.map(({ pkg, noteIds, readiness }) => (
          <div key={pkg.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">{pkg.name}</h2>
                <p className="muted text-sm">
                  {formatDate(pkg.createdAt)} · {noteIds.length} notes · {readiness.total} active cards
                </p>
              </div>
              <span className="text-lg font-semibold tabular-nums" title="Cards answered correctly twice in a row">
                {readiness.ready}/{readiness.total} ready
              </span>
            </div>
            <div className="my-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div className="h-full bg-emerald-500" style={{ width: `${(readiness.ready / Math.max(1, readiness.total)) * 100}%` }} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={`/drill/package/${pkg.id}`} className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
                Drill
              </Link>
              <Link
                to={`/library?package=${pkg.id}`}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                View notes
              </Link>
              <Button size="sm" variant="ghost" onClick={() => setSource(pkg)}>
                Source text
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(pkg)}>
                Rename
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleting({ pkg, noteIds })}>
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {source && (
        <Modal title={source.name} onClose={() => setSource(null)} wide>
          <pre className="max-h-[60vh] overflow-auto rounded-lg bg-slate-100 p-3 text-xs whitespace-pre-wrap dark:bg-slate-800" dir="auto">
            {source.sourceText || '(no source text: notes were added individually)'}
          </pre>
          <div className="mt-3 flex justify-end">
            <Button onClick={() => void navigator.clipboard?.writeText(source.sourceText)}>Copy</Button>
          </div>
        </Modal>
      )}
      {renaming && <RenameModal pkg={renaming} onClose={() => setRenaming(null)} />}
      {deleting && (
        <DeletePackage
          pkg={deleting.pkg}
          noteIds={deleting.noteIds}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function RenameModal({ pkg, onClose }: { pkg: Package; onClose: () => void }) {
  const [name, setName] = useState(pkg.name)
  return (
    <Modal title="Rename package" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault()
          await repos.packages.put({ ...pkg, name: name.trim() || pkg.name })
          onClose()
        }}
      >
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="flex justify-end">
          <Button variant="primary" type="submit">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function DeletePackage({ pkg, noteIds, onClose }: { pkg: Package; noteIds: string[]; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const run = async (withNotes: boolean) => {
    setBusy(true)
    if (withNotes) await trashNotes(repos, noteIds)
    else await moveToPackage(repos, noteIds, null)
    await repos.packages.delete(pkg.id)
    onClose()
  }
  return (
    <Modal title={`Delete “${pkg.name}”?`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>
          It has {noteIds.length} {noteIds.length === 1 ? 'note' : 'notes'}. Progress and history are kept either way.
        </p>
        <div className="flex flex-col gap-2">
          <Button disabled={busy} onClick={() => void run(false)}>
            Delete the package only (keep its notes)
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void run(true)}>
            Delete the package and move its notes to Trash
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
        <p className="muted text-xs">
          Kept notes appear under “Items without a package”, where you can put them in a package again. Trash can be
          restored for 30 days.
        </p>
      </div>
    </Modal>
  )
}

/** Notes added within a minute of each other came from one import (or one session of Quick add). */
function batches(notes: readonly Note[]): Note[][] {
  const sorted = [...notes].sort((a, b) => a.createdAt - b.createdAt)
  const out: Note[][] = []
  for (const n of sorted) {
    const last = out.at(-1)
    if (last && n.createdAt - last.at(-1)!.createdAt <= 60_000) last.push(n)
    else out.push([n])
  }
  return out
}

function WithoutPackage({ notes, packages }: { notes: Note[]; packages: Package[] }) {
  return (
    <section className="card mb-3 space-y-3">
      <div>
        <h2 className="font-medium">Items without a package ({notes.length})</h2>
        <p className="muted text-sm">
          No package groups these (none was set, or theirs was deleted). Grouped by when they were added. Putting them in a
          package keeps their progress and history.
        </p>
      </div>
      {batches(notes).map((batch) => (
        <AssignBatch key={batch[0]!.id} notes={batch} packages={packages} />
      ))}
    </section>
  )
}

function AssignBatch({ notes, packages }: { notes: Note[]; packages: Package[] }) {
  const [target, setTarget] = useState('new')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = target !== 'new' || name.trim() !== ''
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <p className="text-sm font-medium">
        Added {formatDate(notes[0]!.createdAt)} · {notes.length} {notes.length === 1 ? 'item' : 'items'}
      </p>
      <p className="muted mb-2 truncate text-xs" dir="auto">
        {notes
          .slice(0, 3)
          .map((n) => primaryText(n))
          .join(' · ')}
        {notes.length > 3 ? ' …' : ''}
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!ready) return
          setBusy(true)
          const ids = notes.map((n) => n.id)
          await assignToPackage(repos, ids, target === 'new' ? { name: name.trim() } : { packageId: target })
        }}
      >
        <select className="input w-auto py-1.5 text-sm" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Put them in">
          <option value="new">New package…</option>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {target === 'new' && (
          <input
            className="input w-auto min-w-0 flex-1 py-1.5 text-sm"
            placeholder="Package name, e.g. 2026-11-05 – Past Simple"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="New package name"
          />
        )}
        <Button size="sm" variant="primary" type="submit" disabled={!ready || busy}>
          Put in package
        </Button>
      </form>
    </div>
  )
}
