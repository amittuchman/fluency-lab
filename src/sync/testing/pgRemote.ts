import type { PGlite } from '@electric-sql/pglite'
import type { RemoteStore } from '../engine'
import type { OutRow, RemoteRow, RemoteTable } from '../model'
import { asUser } from './pgSupabase'

/**
 * RemoteStore over the test database, issuing the same SQL PostgREST generates for supabase-js
 * `select … order by updated_at` and `upsert(…, { onConflict: 'user_id,id', ignoreDuplicates })`.
 * `offline = true` makes every call fail like a dropped connection.
 */
export class PgRemote implements RemoteStore {
  offline = false
  pushes = 0

  constructor(
    private readonly db: PGlite,
    private readonly userId: string,
  ) {}

  async pull(table: RemoteTable, since: string | null, offset: number, limit: number): Promise<RemoteRow[]> {
    if (this.offline) throw new TypeError('Failed to fetch')
    const res = await asUser(this.db, this.userId, (tx) =>
      tx.query<{ id: string; data: Record<string, unknown>; updated_at: Date; deleted_at: Date | null }>(
        `select id, data, updated_at, deleted_at from public.${table}
         where ($1::timestamptz is null or updated_at > $1::timestamptz)
         order by updated_at, id offset $2 limit $3`,
        [since, offset, limit],
      ),
    )
    return res.rows.map((r) => ({ id: r.id, data: r.data, updated_at: r.updated_at.toISOString(), deleted_at: r.deleted_at ? r.deleted_at.toISOString() : null }))
  }

  async push(table: RemoteTable, rows: OutRow[], opts: { ignoreDuplicates: boolean }): Promise<void> {
    if (this.offline) throw new TypeError('Failed to fetch')
    this.pushes++
    await asUser(this.db, this.userId, async (tx) => {
      for (const r of rows) {
        await tx.query(
          `insert into public.${table} (id, user_id, data, deleted_at) values ($1, $2, $3::jsonb, $4)
           on conflict (user_id, id) do ${opts.ignoreDuplicates ? 'nothing' : 'update set data = excluded.data, deleted_at = excluded.deleted_at'}`,
          [r.id, this.userId, JSON.stringify(r.data), r.deleted_at],
        )
      }
    })
  }
}
