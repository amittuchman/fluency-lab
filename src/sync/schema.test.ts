// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite'
import { addUser, asUser, createTestDatabase } from './testing/pgSupabase'

const A = '00000000-0000-0000-0000-00000000000a'
const B = '00000000-0000-0000-0000-00000000000b'
let db: PGlite

beforeAll(async () => {
  db = await createTestDatabase()
  await addUser(db, A)
  await addUser(db, B)
}, 60_000)

const upsert = (table: string, id: string, data: object, deletedAt: string | null = null) =>
  `insert into public.${table} (id, data, deleted_at) values ('${id}', '${JSON.stringify(data)}'::jsonb, ${deletedAt ? `'${deletedAt}'` : 'null'})
   on conflict (user_id, id) do update set data = excluded.data, deleted_at = excluded.deleted_at`

describe('supabase/schema.sql', () => {
  it('is idempotent (can be run twice)', async () => {
    const { default: schemaSql } = await import('../../supabase/schema.sql?raw')
    await db.exec(schemaSql)
  })

  it('RLS: users only see and write their own rows; anon sees nothing', async () => {
    await asUser(db, A, (tx) => tx.query(upsert('notes', 'n1', { _clock: '1', text: 'A secret' })))
    expect((await asUser(db, A, (tx) => tx.query('select id from public.notes'))).rows).toHaveLength(1)
    expect((await asUser(db, B, (tx) => tx.query('select id from public.notes'))).rows).toHaveLength(0)
    await expect(asUser(db, null, (tx) => tx.query('select id from public.notes'))).rejects.toThrow(/permission denied/)
    // B cannot write a row owned by A, not even by naming A's user_id.
    await expect(
      asUser(db, B, (tx) => tx.query(`insert into public.notes (id, user_id, data) values ('x', '${A}', '{}')`)),
    ).rejects.toThrow(/row-level security/)
    // B's update of the same id creates B's own row; A's row is untouched.
    await asUser(db, B, (tx) => tx.query(upsert('notes', 'n1', { _clock: '9', text: 'B' })))
    const a = await asUser(db, A, (tx) => tx.query<{ data: { text: string } }>('select data from public.notes where id = $1', ['n1']))
    expect(a.rows[0]!.data.text).toBe('A secret')
  })

  it('no one can hard-delete rows (soft delete only)', async () => {
    await expect(asUser(db, A, (tx) => tx.query('delete from public.notes where id = $1', ['n1']))).rejects.toThrow(/permission denied/)
    expect((await asUser(db, A, (tx) => tx.query('select id from public.notes where id = $1', ['n1']))).rows).toHaveLength(1)
  })

  it('last write wins by _clock: an older version never overwrites a newer one', async () => {
    await asUser(db, A, (tx) => tx.query(upsert('cards', 'c1', { _clock: '0000000000002', v: 'new' })))
    await asUser(db, A, (tx) => tx.query(upsert('cards', 'c1', { _clock: '0000000000001', v: 'old' })))
    const r = await asUser(db, A, (tx) => tx.query<{ data: { v: string } }>('select data from public.cards where id = $1', ['c1']))
    expect(r.rows[0]!.data.v).toBe('new')
    await asUser(db, A, (tx) => tx.query(upsert('cards', 'c1', { _clock: '0000000000003', v: 'newer' })))
    const r2 = await asUser(db, A, (tx) => tx.query<{ data: { v: string } }>('select data from public.cards where id = $1', ['c1']))
    expect(r2.rows[0]!.data.v).toBe('newer')
  })

  it('review logs are append-only; only deleted_at can be set', async () => {
    await asUser(db, A, (tx) => tx.query(upsert('review_logs', 'l1', { rating: 3 })))
    await asUser(db, A, (tx) => tx.query(upsert('review_logs', 'l1', { rating: 1 })))
    let r = await asUser(db, A, (tx) => tx.query<{ data: { rating: number }; deleted_at: Date | null }>('select data, deleted_at from public.review_logs'))
    expect(r.rows[0]!.data.rating).toBe(3)
    await asUser(db, A, (tx) => tx.query(upsert('review_logs', 'l1', { rating: 1 }, '2026-10-18T10:00:00Z')))
    r = await asUser(db, A, (tx) => tx.query('select data, deleted_at from public.review_logs'))
    expect(r.rows[0]!.data.rating).toBe(3)
    expect(r.rows[0]!.deleted_at).not.toBeNull()
  })

  it('stamps updated_at on every accepted write and keeps the owner', async () => {
    const before = await asUser(db, A, (tx) => tx.query<{ updated_at: Date; user_id: string }>('select updated_at, user_id from public.cards where id = $1', ['c1']))
    await asUser(db, A, (tx) => tx.query(upsert('cards', 'c1', { _clock: '0000000000004', v: 'x' })))
    const after = await asUser(db, A, (tx) => tx.query<{ updated_at: Date; user_id: string }>('select updated_at, user_id from public.cards where id = $1', ['c1']))
    expect(after.rows[0]!.user_id).toBe(A)
    expect(after.rows[0]!.updated_at.getTime()).toBeGreaterThanOrEqual(before.rows[0]!.updated_at.getTime())
  })
})
