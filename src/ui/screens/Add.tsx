import { useDeferredValue, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { repos } from '../../data'
import { sampleText } from '../../data/sample'
import { createNote, duplicateIndex, importPackage, type ImportItem, type ImportSummary } from '../../data/services'
import { defaultPackageName, duplicateKey, parseImport, parseLine, primaryText, validateContent, type ParsedItem } from '../../domain/parser'
import { buildPrompt } from '../../domain/prompt'
import { emptyFsrs } from '../../domain/scheduler'
import { templateLabel, templatesFor } from '../../domain/templates'
import { NOTE_TYPES, type Card, type Note, type NoteContent } from '../../domain/types'
import { NoteFields, TagsField } from '../components/NoteEditor'
import { cleanContent, emptyContent, parseTags } from '../noteForm'
import { Button, PageHeader, TagList, TypeBadge } from '../components/ui'
import { useRepoQuery } from '../hooks'

export function Add() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'quick' ? 'quick' : 'import'
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Add material" />
      <div className="mb-4 inline-flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-700" role="tablist">
        {(['import', 'quick'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-sky-600 text-white' : 'muted hover:bg-slate-100 dark:hover:bg-slate-800'}`}
            onClick={() => setParams(t === 'quick' ? { tab: 'quick' } : {})}
          >
            {t === 'import' ? 'Paste a package' : 'Quick add'}
          </button>
        ))}
      </div>
      {tab === 'import' ? <ImportPane /> : <QuickAdd />}
    </div>
  )
}

// ---------------- Import ----------------

/** Blank block to hand to the AI coach (or fill in by hand): one example line per item type. */
const IMPORT_TEMPLATE = `# Package: <date> – <topic>
@vocab <term> | <English definition> | <example sentence using the term> | he: <Hebrew> | pos: <part of speech> | coll: <collocation>; <collocation> | #<tag>
@sentence <key sentence> | he: <Hebrew> | #<tag>
@fix <what I said> => <correct version> | rule: <the rule in one line> | #<tag>
@natural <what I said> => <more natural version> | note: <why it sounds better> | #<tag>
@tense <sentence with the verb as {{answer::base verb}}> | tense: <e.g. present-perfect-continuous> | why: <the time signal / reason> | #tenses
@cloze <sentence with {{answer}} or {{answer//alternative::hint}}> | #<tag>
`

type DupChoice = 'skip' | 'update' | 'keep'

interface Row {
  item: ParsedItem
  dupOf: { note?: Note; line?: number } | null
  choice: DupChoice
  cards: number
}

function ImportPane() {
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const [name, setName] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Record<number, string>>({})
  const [choices, setChoices] = useState<Record<number, DupChoice>>({})
  const [editing, setEditing] = useState<number | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<(ImportSummary & { name: string }) | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const dupIndex = useRepoQuery(() => duplicateIndex(repos), [])

  const parsed = useMemo(() => parseImport(deferred), [deferred])

  const rows: Row[] = useMemo(() => {
    const seen = new Map<string, number>()
    return parsed.items.map((orig) => {
      const item = overrides[orig.lineNo] !== undefined ? parseLine(overrides[orig.lineNo]!, orig.lineNo) : orig
      let dupOf: Row['dupOf'] = null
      if (item.content) {
        const key = duplicateKey(item.content)
        const existing = dupIndex?.get(key)
        if (existing) dupOf = { note: existing }
        else if (seen.has(key)) dupOf = { line: seen.get(key)! }
        if (!seen.has(key)) seen.set(key, item.lineNo)
      }
      return { item, dupOf, choice: choices[item.lineNo] ?? 'skip', cards: item.content ? templatesFor(item.content).length : 0 }
    })
  }, [parsed, overrides, choices, dupIndex])

  const plan = rows.map((r): (ImportItem & { lineNo: number }) | null => {
    if (!r.item.content) return null
    const action: ImportItem['action'] = !r.dupOf ? 'create' : r.choice === 'skip' ? 'skip' : r.choice === 'update' && r.dupOf.note ? 'update' : 'create'
    return { lineNo: r.item.lineNo, content: r.item.content, tags: r.item.tags, action, ...(action === 'update' ? { targetNoteId: r.dupOf!.note!.id } : {}) }
  })
  const counts = {
    create: plan.filter((p) => p?.action === 'create').length,
    update: plan.filter((p) => p?.action === 'update').length,
    skip: plan.filter((p) => p?.action === 'skip').length,
    errors: rows.filter((r) => !r.item.content).length,
    warnings: rows.filter((r) => r.item.status === 'warn').length,
    cards: rows.reduce((s, r, i) => s + (plan[i]?.action === 'create' ? r.cards : 0), 0),
  }
  const pkgName = name ?? parsed.packageName ?? defaultPackageName()
  const problems = (r: Row) => r.item.status !== 'ok' || r.dupOf !== null
  const shown = (onlyProblems ? rows.filter(problems) : rows).slice(0, onlyProblems ? undefined : 300)

  const save = async () => {
    setSaving(true)
    const items = plan.filter((p): p is ImportItem & { lineNo: number } => !!p)
    const summary = await importPackage(repos, { name: pkgName, sourceText: text, items })
    setDone({ ...summary, name: pkgName })
    setSaving(false)
  }

  if (done) {
    return (
      <div className="card space-y-3">
        <p className="text-lg font-medium">Saved “{done.name}”</p>
        <p className="text-sm">
          {done.created} new notes, {done.updated} updated, {done.skipped} skipped · {done.cards} new cards.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to={`/drill/package/${done.packageId}`} className="rounded-lg bg-sky-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-sky-700">
            Drill this package
          </Link>
          <Link to="/study" className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
            Daily session
          </Link>
          <Button
            onClick={() => {
              setDone(null)
              setText('')
              setName(null)
              setOverrides({})
              setChoices({})
            }}
          >
            Import another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="import-text" className="font-medium">
            Paste the Study Package (text or JSON)
          </label>
          <div className="flex flex-wrap gap-2 text-sm">
            <label className="cursor-pointer rounded-lg px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
              Open file…
              <input
                type="file"
                accept=".txt,.json,.md,text/plain,application/json"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) setText(await f.text())
                  e.target.value = ''
                }}
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(IMPORT_TEMPLATE)
                  setCopied('Template copied')
                } catch {
                  // Clipboard can be blocked (permissions, insecure context): fall back to the text box.
                  setText(IMPORT_TEMPLATE)
                  setCopied('Clipboard blocked: template put in the box instead')
                }
                setTimeout(() => setCopied(null), 3000)
              }}
            >
              Copy import template
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setText(sampleText)}>
              Paste the sample
            </Button>
            <Link to="/help/format" className="rounded-lg px-2.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
              Format reference
            </Link>
          </div>
        </div>
        {copied && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300" role="status">
            {copied}
          </p>
        )}
        <textarea
          id="import-text"
          className="input min-h-48 font-mono text-sm"
          placeholder={'# Package: 2026-10-19 – Economics debate\n@vocab reluctant | unwilling and hesitant | He was reluctant to commit. | he: מסויג | #adjectives'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOverrides({})
          }}
          spellCheck={false}
          // Package text is line-based and starts with @type, so it is LTR; dir="auto" doubled layout time on big pastes.
          dir="ltr"
        />
      </div>

      {rows.length > 0 && (
        <>
          <div className="card space-y-3">
            <label className="block max-w-md">
              <span className="label">Package name</span>
              <input className="input" value={pkgName} onChange={(e) => setName(e.target.value)} />
            </label>
            <p className="text-sm">
              <strong>{counts.create}</strong> new notes ({counts.cards} cards)
              {counts.update > 0 && (
                <>
                  , <strong>{counts.update}</strong> updates
                </>
              )}
              {counts.skip > 0 && <>, {counts.skip} skipped duplicates</>}
              {counts.errors > 0 && <span className="text-rose-700 dark:text-rose-300">, {counts.errors} lines with errors (not saved)</span>}
              {counts.warnings > 0 && <span className="text-amber-700 dark:text-amber-300">, {counts.warnings} with warnings</span>}.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => void save()} disabled={saving || counts.create + counts.update === 0}>
                {saving ? 'Saving…' : 'Confirm and save'}
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                Only show problems and duplicates
              </label>
            </div>
          </div>

          <div className="card overflow-x-auto p-0">
            <table className="w-full text-left text-sm">
              <thead className="muted border-b border-slate-200 text-xs dark:border-slate-800">
                <tr>
                  <th className="px-3 py-2 font-medium">Line</th>
                  <th className="px-2 font-medium">Status</th>
                  <th className="px-2 font-medium">Item</th>
                  <th className="px-2 font-medium">Cards</th>
                  <th className="px-2 font-medium">Duplicate</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <ImportRow
                    key={r.item.lineNo}
                    row={r}
                    editable={parsed.format === 'text'}
                    editing={editing === r.item.lineNo}
                    onEdit={() => setEditing(editing === r.item.lineNo ? null : r.item.lineNo)}
                    onChangeLine={(raw) => setOverrides((o) => ({ ...o, [r.item.lineNo]: raw }))}
                    onChoice={(c) => setChoices((s) => ({ ...s, [r.item.lineNo]: c }))}
                  />
                ))}
              </tbody>
            </table>
            {!onlyProblems && rows.length > shown.length && <p className="muted px-3 py-2 text-xs">Showing the first {shown.length} of {rows.length} lines.</p>}
          </div>
        </>
      )}
    </div>
  )
}

function ImportRow({
  row,
  editable,
  editing,
  onEdit,
  onChangeLine,
  onChoice,
}: {
  row: Row
  editable: boolean
  editing: boolean
  onEdit: () => void
  onChangeLine: (raw: string) => void
  onChoice: (c: DupChoice) => void
}) {
  const { item, dupOf } = row
  const icon = { ok: ['✓', 'text-emerald-600'], warn: ['!', 'text-amber-600'], error: ['✕', 'text-rose-600'] }[item.status]
  return (
    <tr className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800/60">
      <td className="muted px-3 py-2 tabular-nums">{item.lineNo}</td>
      <td className={`px-2 py-2 font-bold ${icon[1]}`} aria-label={item.status}>
        {icon[0]}
      </td>
      <td className="px-2 py-2">
        {item.content ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <TypeBadge type={item.content.type} />
            <span>{primaryText(item.content)}</span>
            <TagList tags={item.tags} />
          </div>
        ) : (
          <code className="text-xs break-all">{item.raw}</code>
        )}
        {item.messages.length > 0 && (
          <ul className={`mt-1 text-xs ${item.status === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
            {item.messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
        {item.needsType && editable && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
            <span className="muted">Assign type:</span>
            {NOTE_TYPES.map((t) => (
              <button
                key={t}
                className="rounded border border-slate-300 px-1.5 py-0.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                onClick={() => onChangeLine(`@${t} ${item.raw.replace(/^@\S+\s*/, '')}`)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        {item.status !== 'ok' && editable && (
          <div className="mt-1">
            <button className="text-xs text-sky-700 underline dark:text-sky-300" onClick={onEdit}>
              {editing ? 'Done' : 'Edit line'}
            </button>
            {editing && (
              <input className="input mt-1 font-mono text-xs" value={item.raw} onChange={(e) => onChangeLine(e.target.value)} autoFocus dir="auto" />
            )}
          </div>
        )}
      </td>
      <td className="px-2 py-2 tabular-nums">{row.cards || '–'}</td>
      <td className="px-2 py-2">
        {dupOf && (
          <div className="space-y-1">
            <span className="muted block text-xs">{dupOf.note ? 'Already in library' : `Same as line ${dupOf.line}`}</span>
            <select className="input py-1 text-xs" value={row.choice} onChange={(e) => onChoice(e.target.value as DupChoice)} aria-label="Duplicate handling">
              <option value="skip">Skip</option>
              {dupOf.note && <option value="update">Update existing</option>}
              <option value="keep">Keep both</option>
            </select>
          </div>
        )}
      </td>
    </tr>
  )
}

// ---------------- Quick Add ----------------

function QuickAdd() {
  const [content, setContent] = useState<NoteContent>(emptyContent('vocab'))
  const [tags, setTags] = useState('')
  const [packageId, setPackageId] = useState('')
  const [added, setAdded] = useState<string | null>(null)
  const [count, setCount] = useState(0)
  const packages = useRepoQuery(() => repos.packages.all(), [])
  const clean = cleanContent(content)
  const errors = validateContent(clean).errors

  const previews = useMemo(() => {
    if (errors.length) return []
    const note = { ...clean, id: 'preview', tags: [], packageId: null, createdAt: 0, updatedAt: 0, suspended: false, deletedAt: null } as Note
    return templatesFor(clean).map((spec) => {
      const card: Card = {
        id: `preview-${spec.template}`,
        noteId: 'preview',
        template: spec.template,
        order: spec.order,
        fsrs: emptyFsrs(0),
        suspended: false,
        buriedUntil: null,
        leech: false,
        unlocked: true,
        contentHash: spec.contentHash,
        priority: false,
        createdAt: 0,
      }
      return { spec, prompt: buildPrompt(note, card, { promptLanguage: 'english' }) }
    })
  }, [clean, errors.length])

  const add = async () => {
    if (errors.length) return
    await createNote(repos, clean, parseTags(tags), packageId || null)
    setAdded(`Added ${clean.type} · ${previews.length} cards`)
    setContent(emptyContent(content.type))
    setCount((n) => n + 1) // remount the fields so focus returns to the first one
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            void add()
          }
        }}
      >
        <NoteFields key={count} content={content} onChange={setContent} typeEditable />
        <TagsField value={tags} onChange={setTags} />
        <label className="block">
          <span className="label">Package</span>
          <select className="input" value={packageId} onChange={(e) => setPackageId(e.target.value)}>
            <option value="">None</option>
            {packages?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="muted text-xs" role="status">
            {added}
          </span>
          <Button variant="primary" type="submit" disabled={errors.length > 0}>
            Add <span className="text-xs opacity-75">Ctrl+Enter</span>
          </Button>
        </div>
      </form>
      <div className="space-y-2">
        <h2 className="font-medium">Cards this creates</h2>
        {previews.length === 0 && <p className="muted text-sm">Fill in the required fields to see the cards.</p>}
        {previews.map(({ spec, prompt }) => (
          <div key={spec.template} className="card py-3">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{templateLabel(spec.template)}</span>
              <span className="muted">{spec.order === 0 ? 'available now' : `unlocks after step ${spec.order}`}</span>
            </div>
            <p className="muted text-xs">{prompt.instruction}</p>
            <p className="mt-1 text-sm" dir="auto">
              {prompt.kind === 'flip'
                ? prompt.front
                : prompt.context
                  ? `${prompt.context.before}___${prompt.context.after}`
                  : (prompt.prompt ?? '')}
            </p>
            {prompt.kind === 'choice' && <p className="muted mt-1 text-xs">Options: {prompt.options.join(' / ')}</p>}
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">→ {prompt.kind === 'flip' ? prompt.reveal.definition : prompt.reveal.answer}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
