import { clockOf, decide, fromRemote, toOutRow, type RemoteRow } from './model'

const row = (data: Record<string, unknown>, deleted_at: string | null = null): RemoteRow => ({ id: 'x', data, updated_at: '2026-10-18T10:00:00Z', deleted_at })
const card = (lastReview: number | null, mtime: number, extra: Record<string, unknown> = {}) => ({ id: 'x', fsrs: { lastReview }, _mtime: mtime, ...extra })

describe('clocks', () => {
  it('notes order by last write', () => {
    expect(clockOf('notes', { _mtime: 2 }) > clockOf('notes', { _mtime: 1 })).toBe(true)
    // Records written before sync existed fall back to their own timestamp.
    expect(clockOf('notes', { updatedAt: 5 })).toBe(clockOf('notes', { _mtime: 5 }))
  })
  it('cards order by latest review first, then last write', () => {
    expect(clockOf('cards', card(200, 1)) > clockOf('cards', card(100, 999))).toBe(true)
    expect(clockOf('cards', card(100, 2)) > clockOf('cards', card(100, 1))).toBe(true)
    // A reset/undo counts like a review at that moment.
    expect(clockOf('cards', card(null, 1, { resetAt: 300 })) > clockOf('cards', card(200, 1))).toBe(true)
  })
})

describe('decide', () => {
  it('takes newer cloud versions and keeps newer local ones', () => {
    const local = { _mtime: 10 }
    expect(decide('notes', local, undefined, row({ _clock: clockOf('notes', { _mtime: 20 }) }))).toBe('take-remote')
    expect(decide('notes', local, undefined, row({ _clock: clockOf('notes', { _mtime: 5 }) }))).toBe('keep-local')
    expect(decide('notes', local, undefined, row({ _clock: clockOf('notes', local) }))).toBe('same')
  })
  it('a record missing locally is added, unless it was deleted here more recently', () => {
    const remote = row({ _clock: clockOf('notes', { _mtime: 10 }) })
    expect(decide('notes', undefined, undefined, remote)).toBe('take-remote')
    expect(decide('notes', undefined, 20, remote)).toBe('keep-local')
    expect(decide('notes', undefined, 5, remote)).toBe('take-remote')
  })
  it('tombstones delete older local records only', () => {
    const tomb = row({ _tombstone: true, _clock: clockOf('notes', { _mtime: 10 }) }, '2026-10-18T10:00:00Z')
    expect(decide('notes', { _mtime: 5 }, undefined, tomb)).toBe('delete-local')
    expect(decide('notes', { _mtime: 50 }, undefined, tomb)).toBe('keep-local')
    expect(decide('notes', undefined, undefined, tomb)).toBe('same')
  })
  it('review logs are append-only: added once, never replaced, removed only by a deletion', () => {
    expect(decide('reviewLogs', undefined, undefined, row({ rating: 3 }))).toBe('take-remote')
    expect(decide('reviewLogs', { rating: 1 }, undefined, row({ rating: 3 }))).toBe('same')
    expect(decide('reviewLogs', { rating: 3 }, undefined, row({ rating: 3 }, '2026-10-18T10:00:00Z'))).toBe('delete-local')
    // Undone here, not pushed yet: don't bring it back.
    expect(decide('reviewLogs', undefined, 99, row({ rating: 3 }))).toBe('same')
  })
})

describe('row mapping', () => {
  it('round-trips a record through the cloud format', () => {
    const note = { id: 'n1', type: 'vocab', fields: {}, deletedAt: null, _mtime: 7 }
    const out = toOutRow('notes', 'n1', note, 0)
    expect(out.deleted_at).toBeNull()
    expect(fromRemote('notes', { ...out, updated_at: '' })).toEqual(note)
  })
  it('a trashed note syncs with deleted_at set; a removed one as a tombstone', () => {
    expect(toOutRow('notes', 'n1', { id: 'n1', deletedAt: Date.UTC(2026, 9, 18) }, 0).deleted_at).toBe('2026-10-18T00:00:00.000Z')
    const tomb = toOutRow('cards', 'c1', undefined, 1_000)
    expect(tomb.data._tombstone).toBe(true)
    expect(tomb.deleted_at).not.toBeNull()
  })
  it('settings and cheat-sheets travel as { value }', () => {
    const out = toOutRow('settings', 'settings', { key: 'settings', value: { newPerDay: 30 }, _mtime: 3 }, 0)
    expect(out.data.value).toEqual({ newPerDay: 30 })
    expect(fromRemote('settings', { ...out, updated_at: '' })).toEqual({ key: 'settings', value: { newPerDay: 30 }, _mtime: 3 })
  })
})
