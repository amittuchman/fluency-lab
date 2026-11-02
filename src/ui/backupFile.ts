import { repos } from '../data'
import { exportBackup, recordBackup } from '../data/backup'
import { META } from '../data/repos'
import type { BackupFile } from '../domain/backup'

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName: string
    types: Array<{ description: string; accept: Record<string, string[]> }>
  }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>
}

/**
 * Export everything to a JSON file. Uses the File System Access API where available (Chrome/Edge),
 * otherwise a regular download. Returns false if the user cancelled the save dialog.
 */
export async function saveBackupFile(): Promise<boolean> {
  const now = Date.now()
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  const name = `fluency-lab-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`
  const saved = await writeJsonFile(await exportBackup(repos, now), name)
  if (saved) await recordBackup(repos, now)
  return saved
}

/** The automatic backup taken on this device just before the exercise update (if it had data then). */
export async function savePreUpdateBackup(): Promise<boolean> {
  const file = await repos.meta.get<BackupFile>(META.backupBeforeV3)
  return file ? writeJsonFile(file, 'fluency-lab-backup-before-exercise-update.json') : false
}

async function writeJsonFile(data: unknown, name: string): Promise<boolean> {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const picker = (window as unknown as SaveFilePickerWindow).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [{ description: 'Fluency Lab backup', accept: { 'application/json': ['.json'] } }] })
      const w = await handle.createWritable()
      await w.write(blob)
      await w.close()
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false
      throw e
    }
  } else {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return true
}
