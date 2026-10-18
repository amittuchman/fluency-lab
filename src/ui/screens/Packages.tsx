import { useState } from 'react'
import { Link } from 'react-router'
import { repos } from '../../data'
import { moveToPackage, readinessFor, trashNotes } from '../../data/services'
import type { Package } from '../../domain/types'
import { Button, Confirm, Empty, Modal, PageHeader } from '../components/ui'
import { formatDate } from '../format'
import { useRepoQuery } from '../hooks'

export function Packages() {
  const [source, setSource] = useState<Package | null>(null)
  const [deleting, setDeleting] = useState<{ pkg: Package; noteIds: string[] } | null>(null)
  const [renaming, setRenaming] = useState<Package | null>(null)

  const list = useRepoQuery(async () => {
    const [packages, notes] = await Promise.all([repos.packages.all(), repos.notes.all()])
    return Promise.all(
      packages.map(async (pkg) => {
        const own = notes.filter((n) => n.packageId === pkg.id)
        return { pkg, noteIds: own.map((n) => n.id), readiness: await readinessFor(repos, own) }
      }),
    )
  }, [])

  if (!list) return <p className="muted">Loading…</p>

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Packages">
        <Link to="/add" className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-700">
          Import a package
        </Link>
      </PageHeader>
      {list.length === 0 && <Empty title="No packages yet.">Every import creates a package.</Empty>}
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
  const [withNotes, setWithNotes] = useState(false)
  return (
    <Confirm
      title={`Delete “${pkg.name}”?`}
      danger
      confirmLabel="Delete package"
      onCancel={onClose}
      onConfirm={async () => {
        if (withNotes) await trashNotes(repos, noteIds)
        else await moveToPackage(repos, noteIds, null)
        await repos.packages.delete(pkg.id)
        onClose()
      }}
      body={
        <div className="space-y-2">
          <p>The package record and its source text are removed.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
            Also move its {noteIds.length} notes to Trash (restorable for 30 days)
          </label>
          {!withNotes && <p className="muted">The notes stay in your library without a package.</p>}
        </div>
      }
    />
  )
}
