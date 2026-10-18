import { PGlite } from '@electric-sql/pglite'
import schemaSql from '../../../supabase/schema.sql?raw'

/**
 * A local stand-in for the Supabase database, for tests: real Postgres (PGlite) with the pieces of Supabase
 * that supabase/schema.sql relies on (auth.users, auth.uid(), the anon/authenticated roles), then the real
 * schema applied on top. Queries run as the `authenticated` role with a given user id, so RLS applies.
 */
export async function createTestDatabase(): Promise<PGlite> {
  const db = await PGlite.create()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `)
  await db.exec(schemaSql)
  return db
}

export async function addUser(db: PGlite, id: string): Promise<void> {
  await db.query('insert into auth.users (id) values ($1)', [id])
}

/** Run `fn` as a signed-in user (role authenticated, auth.uid() = userId), or as anon when userId is null. */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (tx: Pick<PGlite, 'query'>) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
    await tx.exec(`set local role ${userId ? 'authenticated' : 'anon'}`)
    return fn(tx)
  })
}
