-- 0001 Foundation: extensions, Supabase compatibility, helpers, tenancy, product profile, audit.
-- Conventions (see docs/product-architecture.md §5):
--   * every product-scoped table has workspace_id + product_id NOT NULL and UNIQUE (id, product_id);
--   * children reference parents with composite keys (child_id, product_id) so cross-product links are impossible;
--   * RLS on every table: rows are visible only to members of their workspace;
--   * enumerations are text + CHECK so they can evolve without type migrations.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Supabase compatibility. On Supabase these objects already exist and are left untouched.
-- Locally (plain Postgres) they are created so that the same migrations and RLS policies run.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

-- The application connects as the database owner and switches role per transaction (SET LOCAL ROLE).
-- On Supabase the owner (postgres) is already a member of these roles; granting again may be refused there.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not pg_has_role(current_user, r, 'MEMBER') then
      execute format('grant %I to %I', r, current_user);
    end if;
  end loop;
end $$;

create schema if not exists auth;
do $$
begin
  grant usage on schema auth to anon, authenticated, service_role;
exception when insufficient_privilege then
  null; -- Supabase owns the auth schema and already grants this.
end $$;

do $$
begin
  if to_regclass('auth.users') is null then
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      created_at timestamptz not null default now()
    );
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $f$
      create function auth.uid() returns uuid language sql stable as $b$
        select coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        )::uuid
      $b$;
    $f$;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.reject_mutation() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'P0001';
end $$;

-- Actor context set by the application per transaction (see src/server/db/context.ts).
create or replace function public.current_actor_type() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.actor_type', true), ''),
                  case when auth.uid() is null then 'system' else 'user' end)
$$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  )
$$;

-- First login: create the profile, a workspace and the owner membership (idempotent).
create or replace function public.bootstrap_owner(p_user_id uuid, p_email text, p_workspace_name text default 'My workspace')
returns uuid language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  insert into public.users (id, email) values (p_user_id, p_email)
    on conflict (id) do update set email = excluded.email;
  select workspace_id into ws from public.workspace_members where user_id = p_user_id order by created_at limit 1;
  if ws is null then
    insert into public.workspaces (name) values (p_workspace_name) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, p_user_id, 'owner');
  end if;
  return ws;
end $$;

-- ---------------------------------------------------------------------------
-- Products and profile
-- ---------------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  name text not null check (length(trim(name)) > 0),
  short_description text not null default '',
  category text not null default '',
  website_url text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  is_demo boolean not null default false,
  -- Free-form profile fields from the brief §6 that are lists of short strings.
  countries text[] not null default '{}',
  pain_points text[] not null default '{}',
  triggers text[] not null default '{}',
  desired_emotional_states text[] not null default '{}',
  customer_vocabulary text[] not null default '{}',
  advantages text[] not null default '{}',
  prohibited_topics text[] not null default '{}',
  legal_restrictions text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id)
);

create table public.product_locales (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  language text not null check (language ~ '^[a-z]{2,3}(-[A-Za-z]{2,4})?$'),
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, language, country)
);

create table public.brand_profiles (
  product_id uuid primary key,
  workspace_id uuid not null,
  tone_of_voice text not null default '',
  colors jsonb not null default '[]'::jsonb,       -- [{name, hex}]
  fonts jsonb not null default '[]'::jsonb,        -- [{name, usage}]
  visual_references jsonb not null default '[]'::jsonb,
  good_examples jsonb not null default '[]'::jsonb, -- [{text, why}]
  bad_examples jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create table public.product_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  kind text not null check (kind in ('approved_fact', 'prohibited_claim')),
  statement text not null check (length(trim(statement)) > 0),
  rationale text not null default '',
  evidence_source_id uuid,          -- FK added in 0002 (knowledge_sources)
  approved_by uuid references public.users (id),
  approved_at timestamptz,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (id, product_id)
);

create table public.product_guardrails (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  code text not null check (code ~ '^[a-z0-9_.-]+$'),
  rule_type text not null check (rule_type in ('forbidden_phrase', 'forbidden_topic', 'required_disclaimer', 'tone', 'claim_check', 'conditional_disclaimer')),
  -- forbidden_phrase / conditional_disclaimer: JSON list of regex patterns (case-insensitive, unicode);
  -- other types: natural-language instruction used by the AI reviewer.
  patterns jsonb not null default '[]'::jsonb,
  instruction text not null default '',
  severity text not null check (severity in ('block', 'warn')),
  rationale text not null default '',
  version int not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, code),
  unique (id, product_id)
);

create table public.product_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  kind text not null check (kind in ('website', 'landing', 'app_store', 'google_play', 'social', 'cta', 'other')),
  label text not null,
  url text not null check (url ~* '^https?://'),
  cta_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (id, product_id)
);

create table public.utm_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  channel text not null,
  utm_source text not null,
  utm_medium text not null,
  campaign_pattern text not null default '{product}-{yyyymm}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, channel)
);

create table public.taxonomy_terms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  vocabulary text not null check (vocabulary in ('format', 'topic', 'cta', 'goal', 'funnel_stage', 'visual_device', 'emotional_trigger')),
  label text not null check (length(trim(label)) > 0),
  description text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, vocabulary, label),
  unique (id, product_id)
);

-- Workspace settings (thresholds, budgets). One row per workspace.
create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  min_publications_per_group int not null default 5 check (min_publications_per_group > 0),
  min_impressions_per_group int not null default 1000 check (min_impressions_per_group > 0),
  min_n_share_cell int not null default 20 check (min_n_share_cell > 0),
  ai_run_budget_usd numeric(10, 2) not null default 0.50,
  ai_daily_budget_usd numeric(10, 2) not null default 5.00,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Secrets: ciphertext only (AES-256-GCM, encrypted by the application). Never audited in clear.
-- ---------------------------------------------------------------------------
create table public.secrets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  label text not null,
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_version int not null,
  last_four text,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit log (append-only) and internal product events
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  workspace_id uuid,
  product_id uuid,
  actor_type text not null check (actor_type in ('user', 'ai', 'system', 'integration')),
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  reason text,
  request_id text,
  agent_run_id uuid
);
create index audit_logs_ws_time on public.audit_logs (workspace_id, occurred_at desc);
create index audit_logs_product_time on public.audit_logs (product_id, occurred_at desc);
create index audit_logs_entity on public.audit_logs (entity_type, entity_id);

create table public.app_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  workspace_id uuid references public.workspaces (id) on delete cascade,
  user_id uuid,
  name text not null,
  properties jsonb not null default '{}'::jsonb
);

-- Explicit domain events (export created, approval decided, ...). Security definer so that
-- the authenticated role never needs INSERT on audit_logs directly.
create or replace function public.log_event(
  p_workspace uuid, p_product uuid, p_action text, p_entity_type text, p_entity_id text,
  p_after jsonb default null, p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_workspace is not null and auth.uid() is not null and not public.is_workspace_member(p_workspace) then
    raise exception 'not a member of workspace %', p_workspace;
  end if;
  insert into public.audit_logs (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, after, reason, request_id, agent_run_id)
  values (p_workspace, p_product, public.current_actor_type(), auth.uid(), p_action, p_entity_type, p_entity_id, p_after, p_reason,
          nullif(current_setting('app.request_id', true), ''),
          nullif(current_setting('app.agent_run_id', true), '')::uuid);
end $$;

-- Row-change audit for every audited table. TG_ARGV[0] (optional) = comma-separated columns to redact.
create or replace function public.audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  redact text[] := case when tg_nargs > 0 then string_to_array(tg_argv[0], ',') else '{}' end;
  old_j jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_j jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  rec jsonb := coalesce(new_j, old_j);
  col text;
begin
  foreach col in array redact loop
    if old_j ? col then old_j := jsonb_set(old_j, array[col], '"[redacted]"'); end if;
    if new_j ? col then new_j := jsonb_set(new_j, array[col], '"[redacted]"'); end if;
  end loop;
  if tg_op = 'UPDATE' and old_j = new_j then
    return new;
  end if;
  insert into public.audit_logs (workspace_id, product_id, actor_type, actor_id, action, entity_type, entity_id, before, after, reason, request_id, agent_run_id)
  values (
    nullif(rec ->> 'workspace_id', '')::uuid,
    case when tg_table_name = 'products' then nullif(rec ->> 'id', '')::uuid else nullif(rec ->> 'product_id', '')::uuid end,
    public.current_actor_type(),
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'product_id'),
    old_j, new_j,
    nullif(current_setting('app.reason', true), ''),
    nullif(current_setting('app.request_id', true), ''),
    nullif(current_setting('app.agent_run_id', true), '')::uuid
  );
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Policy helpers used by every later migration.
-- ---------------------------------------------------------------------------
-- Standard table: RLS by workspace membership, full CRUD for members, row-change audit, updated_at.
create or replace function public.setup_table(
  t regclass, audited boolean default true, redact text default null, append_only boolean default false
) returns void language plpgsql as $$
declare
  has_ws boolean := exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t::text and column_name = 'workspace_id');
  has_updated boolean := exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t::text and column_name = 'updated_at');
begin
  execute format('alter table %s enable row level security', t);
  -- RLS is not FORCEd: the table owner (migrations, security-definer helpers) bypasses it by design;
  -- the application always switches to the authenticated role inside a transaction.
  if has_ws then
    execute format('create policy member_select on %s for select to authenticated using (public.is_workspace_member(workspace_id))', t);
    execute format('create policy member_insert on %s for insert to authenticated with check (public.is_workspace_member(workspace_id))', t);
    if not append_only then
      execute format('create policy member_update on %s for update to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))', t);
      execute format('create policy member_delete on %s for delete to authenticated using (public.is_workspace_member(workspace_id))', t);
    end if;
  end if;
  execute format('create policy service_all on %s for all to service_role using (true) with check (true)', t);
  if append_only then
    execute format('grant select, insert on %s to authenticated', t);
    execute format('create trigger %I before update or delete on %s for each row execute function public.reject_mutation()', t::text || '_append_only', t);
  else
    execute format('grant select, insert, update, delete on %s to authenticated', t);
  end if;
  execute format('grant all on %s to service_role', t);
  if has_updated and not append_only then
    execute format('create trigger %I before update on %s for each row execute function public.set_updated_at()', t::text || '_updated_at', t);
  end if;
  if audited then
    if redact is null then
      execute format('create trigger %I after insert or update or delete on %s for each row execute function public.audit_row_change()', t::text || '_audit', t);
    else
      execute format('create trigger %I after insert or update or delete on %s for each row execute function public.audit_row_change(%L)', t::text || '_audit', t, redact);
    end if;
  end if;
end $$;

-- users: a user sees and edits only their own profile.
alter table public.users enable row level security;
create policy self_select on public.users for select to authenticated using (id = auth.uid());
create policy self_update on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy service_all on public.users for all to service_role using (true) with check (true);
grant select, update on public.users to authenticated;
grant all on public.users to service_role;
create trigger users_updated_at before update on public.users for each row execute function public.set_updated_at();

-- workspaces / members
alter table public.workspaces enable row level security;
create policy member_select on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy member_update on public.workspaces for update to authenticated using (public.is_workspace_member(id)) with check (public.is_workspace_member(id));
create policy service_all on public.workspaces for all to service_role using (true) with check (true);
grant select, update on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
create trigger workspaces_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
create trigger workspaces_audit after insert or update or delete on public.workspaces for each row execute function public.audit_row_change();

alter table public.workspace_members enable row level security;
create policy member_select on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy service_all on public.workspace_members for all to service_role using (true) with check (true);
grant select on public.workspace_members to authenticated;
grant all on public.workspace_members to service_role;

select public.setup_table('public.products');
select public.setup_table('public.product_locales');
select public.setup_table('public.brand_profiles');
select public.setup_table('public.product_claims');
select public.setup_table('public.product_guardrails');
select public.setup_table('public.product_links');
select public.setup_table('public.utm_templates');
select public.setup_table('public.taxonomy_terms');
select public.setup_table('public.workspace_settings');
select public.setup_table('public.secrets', true, 'ciphertext,iv,auth_tag');

-- audit_logs: members read their workspace's log; nobody updates or deletes.
alter table public.audit_logs enable row level security;
create policy member_select on public.audit_logs for select to authenticated using (workspace_id is not null and public.is_workspace_member(workspace_id));
create policy service_insert on public.audit_logs for insert to service_role with check (true);
create policy service_select on public.audit_logs for select to service_role using (true);
grant select on public.audit_logs to authenticated;
grant select, insert on public.audit_logs to service_role;
create trigger audit_logs_append_only before update or delete on public.audit_logs for each row execute function public.reject_mutation();

select public.setup_table('public.app_events', false, null, true);
