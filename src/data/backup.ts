import { BACKUP_APP, type BackupFile } from '../domain/backup'
import { DEFAULT_SETTINGS, type Card } from '../domain/types'
import { SCHEMA_VERSION } from './dexie'
import { META, type Repos } from './repos'

export async function exportBackup(repos: Repos, now = Date.now()): Promise<BackupFile> {
  const [live, trashed, cards, reviewLogs, packages, quizzes, settings, meta] = await Promise.all([
    repos.notes.all(),
    repos.notes.trashed(),
    repos.cards.all(),
    repos.logs.all(),
    repos.packages.all(),
    repos.quizzes.all(),
    repos.settings.get(),
    repos.meta.all(),
  ])
  return {
    app: BACKUP_APP,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    tables: { notes: [...live, ...trashed], cards, reviewLogs, packages, quizzes, settings, meta },
  }
}

export async function recordBackup(repos: Repos, now = Date.now()): Promise<void> {
  await repos.meta.set(META.lastBackupAt, now)
}

/** The card with more review history wins a merge conflict. */
function newerCard(a: Card, b: Card): Card {
  return (b.fsrs.lastReview ?? 0) > (a.fsrs.lastReview ?? 0) || b.fsrs.reps > a.fsrs.reps ? b : a
}

/**
 * Restore a validated backup.
 * replace: wipe everything, then load the file. merge: add missing records; for notes the newer
 * updatedAt wins, for cards the one with more review history; current settings are kept.
 */
export async function importBackup(repos: Repos, file: BackupFile, mode: 'merge' | 'replace'): Promise<void> {
  const t = file.tables
  const lastBackupBefore = (await repos.meta.get<number>(META.lastBackupAt)) ?? 0
  await repos.transaction(async () => {
    if (mode === 'replace') {
      await repos.clearAll()
      await repos.notes.bulkPut(t.notes)
      await repos.cards.bulkPut(t.cards)
      await repos.logs.bulkPut(t.reviewLogs)
      await repos.packages.bulkPut(t.packages)
      await repos.quizzes.bulkPut(t.quizzes)
      await repos.settings.save({ ...DEFAULT_SETTINGS, ...t.settings })
      for (const m of t.meta) await repos.meta.set(m.key, m.value)
    } else {
      const notes = new Map([...(await repos.notes.all()), ...(await repos.notes.trashed())].map((n) => [n.id, n]))
      await repos.notes.bulkPut(t.notes.filter((n) => !notes.has(n.id) || n.updatedAt > notes.get(n.id)!.updatedAt))
      const cards = new Map((await repos.cards.all()).map((c) => [c.id, c]))
      await repos.cards.bulkPut(t.cards.filter((c) => !cards.has(c.id) || newerCard(cards.get(c.id)!, c) === c))
      const logs = new Set((await repos.logs.all()).map((l) => l.id))
      await repos.logs.bulkPut(t.reviewLogs.filter((l) => !logs.has(l.id)))
      const pkgs = new Set((await repos.packages.all()).map((p) => p.id))
      await repos.packages.bulkPut(t.packages.filter((p) => !pkgs.has(p.id)))
      const quizzes = new Set((await repos.quizzes.all()).map((q) => q.id))
      await repos.quizzes.bulkPut(t.quizzes.filter((q) => !quizzes.has(q.id)))
    }
    await repos.meta.set(META.onboarding, 'done')
    await repos.meta.set(META.schemaVersion, SCHEMA_VERSION)
    // The file itself is a backup as of its export time (its own meta predates that export).
    const fromFile = (t.meta.find((m) => m.key === META.lastBackupAt)?.value as number | undefined) ?? 0
    await repos.meta.set(META.lastBackupAt, Math.max(lastBackupBefore, fromFile, file.exportedAt))
  })
}
