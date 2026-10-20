-- 0008 Hosted Supabase hardening. Every statement is a no-op on plain Postgres.
--
-- 1. The application is the only way into the data. Supabase grants anon broad table rights by default
--    (for its REST API); anon never needs any, so they are removed here and for future tables.
--    Row-level security already hides every row from anon; this is a second layer.
--    TRUNCATE is not subject to row-level security, so the signed-in role loses it on every table, and
--    append-only tables (those guarded by reject_mutation) lose UPDATE and DELETE again.
-- 2. A private Storage bucket for knowledge files and creatives (STORAGE_DRIVER=supabase).

do $$
begin
  execute 'revoke all on all tables in schema public from anon';
  execute 'revoke all on all sequences in schema public from anon';
  execute 'revoke execute on all functions in schema public from anon';
  begin
    execute 'alter default privileges in schema public revoke all on tables from anon';
    execute 'alter default privileges in schema public revoke all on sequences from anon';
    execute 'alter default privileges in schema public revoke execute on functions from anon';
  exception when insufficient_privilege then
    null;
  end;
end $$;

do $$
declare t record;
begin
  execute 'revoke truncate on all tables in schema public from authenticated';
  begin
    execute 'alter default privileges in schema public revoke truncate on tables from authenticated';
  exception when insufficient_privilege then
    null;
  end;
  for t in
    select distinct c.relname from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and g.tgfoid = 'public.reject_mutation'::regproc
  loop
    execute format('revoke update, delete on public.%I from authenticated', t.relname);
  end loop;
end $$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    execute $q$insert into storage.buckets (id, name, public) values ('knowledge', 'knowledge', false) on conflict (id) do nothing$q$;
  end if;
end $$;
