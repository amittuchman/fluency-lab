import { useEffect, useState, type ReactNode } from 'react'
import { repos } from '../../data'
import { importBackup } from '../../data/backup'
import { SCHEMA_VERSION } from '../../data/dexie'
import { META } from '../../data/repos'
import { validateBackup, type BackupValidation } from '../../domain/backup'
import type { Settings as SettingsT } from '../../domain/types'
import { saveBackupFile } from '../backupFile'
import { Banner, Button, Confirm, PageHeader } from '../components/ui'
import { formatDate } from '../format'
import { useRepoQuery, useSettings } from '../hooks'

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[1fr_14rem] sm:items-center sm:gap-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="muted text-xs">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function NumberInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (n: number) => void; min: number; max: number; step?: number }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <input
      className="input"
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Number(text)
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        else setText(String(value))
      }}
    />
  )
}

export function Settings() {
  const settings = useSettings()
  const save = (patch: Partial<SettingsT>) => void repos.settings.save({ ...settings, ...patch })

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Settings" />

      <section className="card divide-y divide-slate-100 py-1 dark:divide-slate-800">
        <h2 className="pb-2 pt-2 font-medium">Study</h2>
        <Row label="New cards per day">
          <NumberInput value={settings.newPerDay} min={0} max={500} onChange={(n) => save({ newPerDay: n })} />
        </Row>
        <Row label="Maximum reviews per day">
          <NumberInput value={settings.maxReviewsPerDay} min={1} max={5000} onChange={(n) => save({ maxReviewsPerDay: n })} />
        </Row>
        <Row label="Desired retention" hint="Higher means shorter intervals and more reviews. 0.90 is a good default.">
          <NumberInput value={settings.desiredRetention} min={0.7} max={0.97} step={0.01} onChange={(n) => save({ desiredRetention: n })} />
        </Row>
        <Row label="New day starts at" hint="Hour (0–23). Reviews before this hour count for the previous day.">
          <NumberInput value={settings.rolloverHour} min={0} max={23} onChange={(n) => save({ rolloverHour: Math.round(n) })} />
        </Row>
        <Row label="Unlock thresholds (days)" hint="Stability the previous card needs before the next, harder card unlocks.">
          <div className="grid grid-cols-3 gap-1">
            {settings.unlockThresholds.map((v, i) => (
              <NumberInput
                key={i}
                value={v}
                min={0}
                max={365}
                onChange={(n) => {
                  const t = [...settings.unlockThresholds] as SettingsT['unlockThresholds']
                  t[i] = n
                  save({ unlockThresholds: t })
                }}
              />
            ))}
          </div>
        </Row>
        <Row label="Prompt language" hint="English-first shows Hebrew only after you answer.">
          <select className="input" value={settings.promptLanguage} onChange={(e) => save({ promptLanguage: e.target.value as SettingsT['promptLanguage'] })}>
            <option value="english">English-first</option>
            <option value="hebrew">Hebrew prompts</option>
          </select>
        </Row>
        <Row label="Session cap" hint="Stop the daily session after a number of cards or minutes.">
          <div className="grid grid-cols-2 gap-1">
            <select
              className="input"
              value={settings.sessionCap.kind}
              onChange={(e) => {
                const kind = e.target.value as SettingsT['sessionCap']['kind']
                save({ sessionCap: kind === 'none' ? { kind } : { kind, value: kind === 'cards' ? 50 : 15 } })
              }}
            >
              <option value="none">None</option>
              <option value="cards">Cards</option>
              <option value="minutes">Minutes</option>
            </select>
            {settings.sessionCap.kind !== 'none' && (
              <NumberInput
                value={settings.sessionCap.value}
                min={1}
                max={1000}
                onChange={(n) => save({ sessionCap: { kind: settings.sessionCap.kind as 'cards' | 'minutes', value: Math.round(n) } })}
              />
            )}
          </div>
        </Row>
      </section>

      <section className="card divide-y divide-slate-100 py-1 dark:divide-slate-800">
        <h2 className="pb-2 pt-2 font-medium">Appearance</h2>
        <Row label="Theme">
          <select className="input" value={settings.theme} onChange={(e) => save({ theme: e.target.value as SettingsT['theme'] })}>
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Row>
      </section>

      <BackupSection />
      <StorageSection />
    </div>
  )
}

function BackupSection() {
  const lastBackupAt = useRepoQuery(() => repos.meta.get<number>(META.lastBackupAt), [])
  const [validation, setValidation] = useState<BackupValidation | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const restore = async (mode: 'merge' | 'replace') => {
    if (!validation?.ok) return
    await importBackup(repos, validation.file, mode)
    setValidation(null)
    setConfirmReplace(false)
    setStatus(mode === 'merge' ? 'Backup merged.' : 'Backup restored. All previous data was replaced.')
  }

  return (
    <section className="card space-y-3" id="backup">
      <h2 className="font-medium">Backup</h2>
      <p className="muted text-sm">
        Everything is stored only in this browser. Last backup: {lastBackupAt ? formatDate(lastBackupAt) : 'never'}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          onClick={async () => {
            if (await saveBackupFile()) setStatus('Backup saved.')
          }}
        >
          Export backup (JSON)
        </Button>
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
          Restore from file…
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              setStatus(null)
              try {
                setValidation(validateBackup(JSON.parse(await f.text()), SCHEMA_VERSION))
              } catch {
                setValidation({ ok: false, errors: ['The file is not valid JSON.'] })
              }
            }}
          />
        </label>
      </div>
      {status && (
        <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
          {status}
        </p>
      )}
      {validation && !validation.ok && (
        <Banner tone="error">
          <p className="font-medium">This backup can't be used:</p>
          <ul className="list-disc pl-5">
            {validation.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Banner>
      )}
      {validation?.ok && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
          <p className="mb-2">
            Backup from {formatDate(validation.file.exportedAt)}: {validation.counts.notes} notes, {validation.counts.cards} cards, {validation.counts.reviewLogs}{' '}
            reviews, {validation.counts.packages} packages, {validation.counts.quizzes} quizzes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void restore('merge')}>
              Merge into current data
            </Button>
            <Button variant="danger" onClick={() => setConfirmReplace(true)}>
              Replace everything
            </Button>
            <Button variant="ghost" onClick={() => setValidation(null)}>
              Cancel
            </Button>
          </div>
          <p className="muted mt-2 text-xs">Merge adds what's missing and keeps the newer version of each note. Replace deletes all current data first.</p>
        </div>
      )}
      {confirmReplace && (
        <Confirm
          title="Replace all data?"
          body="Every note, card, review and setting in this browser will be deleted and replaced by the backup. Export a backup first if you might need the current data."
          confirmLabel="Replace everything"
          danger
          onCancel={() => setConfirmReplace(false)}
          onConfirm={() => void restore('replace')}
        />
      )}
    </section>
  )
}

function StorageSection() {
  const [info, setInfo] = useState<{ persisted: boolean | null; usage: number | null }>({ persisted: null, usage: null })
  useEffect(() => {
    void (async () => {
      const persisted = (await navigator.storage?.persisted?.()) ?? null
      const est = await navigator.storage?.estimate?.()
      setInfo({ persisted, usage: est?.usage ?? null })
    })()
  }, [])
  return (
    <section className="card space-y-2 text-sm">
      <h2 className="font-medium">Storage</h2>
      <p>
        Persistent storage:{' '}
        {info.persisted === null ? 'unknown' : info.persisted ? 'granted (the browser will not evict your data)' : 'not granted (the browser may clear data under storage pressure; keep backups)'}
      </p>
      {info.usage !== null && <p className="muted">Using about {(info.usage / 1024 / 1024).toFixed(1)} MB.</p>}
      {info.persisted === false && (
        <Button
          size="sm"
          onClick={async () => {
            const ok = await navigator.storage.persist()
            setInfo((i) => ({ ...i, persisted: ok }))
          }}
        >
          Request persistent storage
        </Button>
      )}
    </section>
  )
}
