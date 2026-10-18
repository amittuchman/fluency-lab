import type { SupabaseClient } from '@supabase/supabase-js'
import type { RemoteStore } from './engine'
import type { OutRow, RemoteRow, RemoteTable } from './model'

/** A failed sync call: `offline` for network problems (retry later), otherwise a real error. */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly offline: boolean,
  ) {
    super(message)
  }
}

function fail(error: { message: string; code?: string }): never {
  const offline = !navigator.onLine || /fetch|network|load failed/i.test(error.message)
  throw new SyncError(error.message, offline)
}

/** RemoteStore over Supabase (PostgREST). Row Level Security limits every call to the signed-in user's rows. */
export class SupabaseRemote implements RemoteStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  async pull(table: RemoteTable, since: string | null, offset: number, limit: number): Promise<RemoteRow[]> {
    let query = this.client.from(table).select('id, data, updated_at, deleted_at')
    if (since) query = query.gt('updated_at', since)
    const { data, error } = await query.order('updated_at').order('id').range(offset, offset + limit - 1)
    if (error) fail(error)
    return data as RemoteRow[]
  }

  async push(table: RemoteTable, rows: OutRow[], opts: { ignoreDuplicates: boolean }): Promise<void> {
    const { error } = await this.client
      .from(table)
      .upsert(
        rows.map((r) => ({ ...r, user_id: this.userId })),
        { onConflict: 'user_id,id', ignoreDuplicates: opts.ignoreDuplicates },
      )
    if (error) fail(error)
  }
}
