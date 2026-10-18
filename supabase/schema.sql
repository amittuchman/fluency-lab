-- Fluency Lab: cloud sync schema.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again (idempotent).
--
-- Every table has the same shape: one row per local record, stored whole in `data`.
--   id          the record's id in the app (text)
--   user_id     owner; defaults to the signed-in user, and RLS only ever shows a user their own rows
--   data        the record as JSON, plus `_clock`, a sortable string the app computes for conflict resolution
--   updated_at  server time of the last accepted write (set by trigger; the app pulls changes since its cursor)
--   deleted_at  soft delete: the record was deleted on some device (rows are never hard-deleted)
--
-- Conflict rules are enforced here as well as in the app, so an old device can never overwrite newer data:
--   notes, cards, packages, settings: an update is accepted only if its `_clock` is not older than the stored one
--   review_logs, quiz_results: append-only; `data` never changes after insert, only `deleted_at` can be set

create or replace function public.fl_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- The owner of a row can never change.
    new.user_id := old.user_id;
    if tg_table_name in ('review_logs', 'quiz_results') then
      -- Append-only: keep the original data; allow only setting deleted_at (undo of a review).
      if new.deleted_at is null or old.deleted_at is not null then
        return null; -- nothing to change: skip the update
      end if;
      new.data := old.data;
    elsif coalesce(new.data ->> '_clock', '') collate "C" < coalesce(old.data ->> '_clock', '') collate "C" then
      return null; -- the incoming version is older: keep the stored one
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['notes', 'cards', 'review_logs', 'packages', 'quiz_results', 'settings'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id          text        not null,
        user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
        data        jsonb       not null,
        updated_at  timestamptz not null default now(),
        deleted_at  timestamptz,
        primary key (user_id, id)
      )$f$, t);

    -- Pulling "everything changed since my cursor" uses this index.
    execute format('create index if not exists %1$I on public.%2$I (user_id, updated_at)', t || '_user_updated_idx', t);

    execute format('drop trigger if exists fl_before_write on public.%I', t);
    execute format('create trigger fl_before_write before insert or update on public.%I for each row execute function public.fl_before_write()', t);

    -- Row Level Security: a signed-in user sees and writes only their own rows. No delete policy: rows are
    -- soft-deleted (deleted_at), never removed. Anonymous visitors get nothing.
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    -- Supabase grants everything to `authenticated` by default; take hard delete and truncate away.
    execute format('revoke delete, truncate on table public.%I from authenticated', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);

    execute format('drop policy if exists "own rows: select" on public.%I', t);
    execute format('drop policy if exists "own rows: insert" on public.%I', t);
    execute format('drop policy if exists "own rows: update" on public.%I', t);
    execute format($f$create policy "own rows: select" on public.%I for select to authenticated using ((select auth.uid()) = user_id)$f$, t);
    execute format($f$create policy "own rows: insert" on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)$f$, t);
    execute format($f$create policy "own rows: update" on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)$f$, t);
  end loop;
end;
$$;
