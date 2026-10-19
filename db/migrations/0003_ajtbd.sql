-- 0003 Audience & AJTBD (adapted from the course AJTBD pipeline; no example-company content).
-- Rules enforced here: quotes are immutable; fears and barriers are separate tables; segment codes are never
-- reused; an active codebook version is read-only; every change is audited by the row trigger.

create table public.audiences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (id, product_id)
);

create table public.codebook_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  version int not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  changelog text not null default '',
  approved_by uuid references public.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, version),
  unique (id, product_id)
);
create unique index codebook_one_active on public.codebook_versions (product_id) where status = 'active';

create table public.segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  audience_id uuid,
  code text not null check (code ~ '^[A-Z0-9]{1,6}-[A-Z0-9]{1,8}$'),
  name text not null,
  confidence_status text not null default 'hypothesis' check (confidence_status in ('solid', 'emerging', 'hypothesis')),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (audience_id, product_id) references public.audiences (id, product_id),
  unique (product_id, code),
  unique (id, product_id)
);

-- Segment codes are immutable once created (a new meaning needs a new code via a codebook migration).
create or replace function public.segments_code_immutable() returns trigger language plpgsql as $$
begin
  if new.code <> old.code then
    raise exception 'segment code % cannot change; create a new segment and a codebook migration', old.code;
  end if;
  return new;
end $$;
create trigger segments_code_immutable before update on public.segments
  for each row execute function public.segments_code_immutable();

create table public.segment_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  segment_id uuid not null,
  codebook_version_id uuid not null,
  core_job text not null,
  criteria_order jsonb not null default '[]'::jsonb,   -- [{criterion, direction, threshold}] in priority order
  distinguishing text not null default '',
  inclusion_rules jsonb not null default '[]'::jsonb,
  exclusion_rules jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active', 'merged_into', 'split_into', 'retired')),
  status_target text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (segment_id, product_id) references public.segments (id, product_id) on delete cascade,
  foreign key (codebook_version_id, product_id) references public.codebook_versions (id, product_id) on delete cascade,
  unique (segment_id, codebook_version_id)
);

-- Definitions of an active or archived codebook are frozen.
create or replace function public.segment_definitions_frozen() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from public.codebook_versions
   where id = coalesce(new.codebook_version_id, old.codebook_version_id);
  if st in ('active', 'archived') then
    raise exception 'codebook version is % and frozen; create a new draft version', st;
  end if;
  return coalesce(new, old);
end $$;
create trigger segment_definitions_frozen before insert or update or delete on public.segment_definitions
  for each row execute function public.segment_definitions_frozen();

create table public.segment_migrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  from_codebook_version_id uuid not null,
  to_codebook_version_id uuid not null,
  operation text not null check (operation in ('keep', 'refine', 'split', 'merge', 'new', 'retire')),
  from_segment_id uuid,
  to_segment_id uuid,
  recalculation_rule text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (from_codebook_version_id, product_id) references public.codebook_versions (id, product_id),
  foreign key (to_codebook_version_id, product_id) references public.codebook_versions (id, product_id),
  foreign key (from_segment_id, product_id) references public.segments (id, product_id),
  foreign key (to_segment_id, product_id) references public.segments (id, product_id)
);

-- Per-product causal profile fields (replace hardcoded country-specific fields of the template).
create table public.profile_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,40}$'),
  label text not null,
  field_type text not null check (field_type in ('text', 'enum', 'boolean', 'number')),
  options jsonb not null default '[]'::jsonb,
  why_causal text not null default '',
  qualification_question text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, key)
);

-- A pseudonymous person (research participant and/or converting user). No names required.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  external_ref text,
  origin text not null default 'research' check (origin in ('research', 'signup', 'import', 'manual')),
  causal_profile jsonb not null default '{}'::jsonb,
  consent_recorded boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, external_ref),
  unique (id, product_id)
);

create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  lead_id uuid,
  kind text not null check (kind in ('interview', 'call', 'review', 'survey', 'support', 'other')),
  occurred_on date,
  period text check (period is null or period ~ '^\d{4}-\d{2}$'),
  source_id uuid references public.knowledge_sources (id) on delete set null,
  consent_recorded boolean not null default false,
  gate_past_investment boolean,
  gate_own_experience boolean,
  gate_concrete_episode boolean,
  leading_contamination text check (leading_contamination in ('low', 'medium', 'high')),
  quality text not null default 'directional' check (quality in ('clean', 'directional', 'weak', 'not_usable')),
  weight numeric(3, 2) generated always as (
    case quality when 'clean' then 1.00 when 'directional' then 0.66 when 'weak' then 0.33 else 0 end) stored,
  diarization_ok boolean,
  schema_version text,
  raw_record jsonb,
  notes text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (lead_id, product_id) references public.leads (id, product_id),
  unique (id, product_id)
);

-- Verbatim customer quotes: immutable. Corrections create a new quote with supersedes_id.
create table public.client_quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  text_verbatim text not null check (length(text_verbatim) > 0),
  chunk_id uuid references public.knowledge_chunks (id) on delete restrict,
  span_start int,
  span_end int,
  interview_id uuid,
  speaker text not null default 'customer' check (speaker in ('customer', 'interviewer', 'other')),
  language text,
  supersedes_id uuid references public.client_quotes (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (interview_id, product_id) references public.interviews (id, product_id),
  check ((span_start is null) = (span_end is null)),
  check (span_start is null or span_end > span_start),
  unique (id, product_id)
);

-- A quote must be a verbatim substring of its chunk when a chunk is given.
create or replace function public.client_quotes_verbatim() returns trigger language plpgsql as $$
declare c text; src_scope text; src_product uuid;
begin
  if new.chunk_id is not null then
    select k.content, s.scope, s.product_id into c, src_scope, src_product
      from public.knowledge_chunks k join public.knowledge_sources s on s.id = k.source_id
     where k.id = new.chunk_id;
    if c is null or strpos(c, new.text_verbatim) = 0 then
      raise exception 'quote is not a verbatim excerpt of the referenced source chunk';
    end if;
    -- Customer quotes come only from this product's evidence, never from workspace methodology.
    if src_scope <> 'product' or src_product <> new.product_id then
      raise exception 'customer quotes must come from a source of the same product';
    end if;
  end if;
  return new;
end $$;
create trigger client_quotes_verbatim before insert on public.client_quotes
  for each row execute function public.client_quotes_verbatim();

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  interview_id uuid,
  segment_id uuid,
  parent_job_id uuid,
  level text not null check (level in ('micro', 'small', 'core', 'big', 'super_big')),
  job_type text not null default 'regular' check (job_type in ('regular', 'orientation', 'tax', 'fake', 'emotional', 'viral')),
  statement text not null check (length(trim(statement)) > 0),
  context text not null default '',
  evidence_level text not null default 'hypothesis' check (evidence_level in ('quote', 'observation', 'hypothesis')),
  quote_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (interview_id, product_id) references public.interviews (id, product_id) on delete cascade,
  foreign key (segment_id, product_id) references public.segments (id, product_id),
  foreign key (parent_job_id, product_id) references public.jobs (id, product_id),
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id),
  check (evidence_level <> 'quote' or quote_id is not null),
  unique (id, product_id)
);

create table public.success_criteria (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  job_id uuid not null,
  priority_rank int not null check (priority_rank > 0),
  criterion text not null,
  direction text not null default '',
  threshold text,
  concrete boolean generated always as (threshold is not null and length(trim(threshold)) > 0) stored,
  source text not null default 'self' check (source in ('self', 'echoed', 'prompted_by_interviewer')),
  quote_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (job_id, product_id) references public.jobs (id, product_id) on delete cascade,
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id),
  unique (job_id, priority_rank) deferrable initially deferred
);

create table public.triggers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  interview_id uuid,
  segment_id uuid,
  event text not null,
  kind text check (kind in ('external_planned', 'external_unexpected', 'internal_planned', 'internal_unexpected')),
  occurred_on date,
  quote_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (interview_id, product_id) references public.interviews (id, product_id) on delete cascade,
  foreign key (segment_id, product_id) references public.segments (id, product_id),
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id)
);

create table public.past_investments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  interview_id uuid not null,
  what text not null,
  when_text text,
  kind text check (kind in ('money', 'time', 'energy')),
  quote_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (interview_id, product_id) references public.interviews (id, product_id) on delete cascade,
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id)
);

create table public.fears (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  interview_id uuid,
  segment_id uuid,
  fear text not null,
  about_way text not null default '',
  class text check (class in ('chain_break', 'under_delivery', 'tax_job', 'personal_risk', 'irreversible_loss')),
  reducible_by_communication boolean,
  proof_available text not null default '',
  source text not null default 'self' check (source in ('self', 'echoed', 'prompted_by_interviewer')),
  quote_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (interview_id, product_id) references public.interviews (id, product_id) on delete cascade,
  foreign key (segment_id, product_id) references public.segments (id, product_id),
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id),
  unique (id, product_id)
);

create table public.barriers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  interview_id uuid,
  segment_id uuid,
  barrier text not null,
  class text check (class in ('missing_prerequisite', 'unsupported_context', 'broken_link', 'handoff_failure', 'cycle_rework', 'irreversible_loss')),
  chain_node text not null default '',
  owner text check (owner in ('us', 'client', 'third_party', 'platform', 'regulator')),
  removal_mechanic text check (removal_mechanic in ('repair', 'kill', 'take_off', 'route_to_partner', 'change_entry', 'make_reversible')),
  quote_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (interview_id, product_id) references public.interviews (id, product_id) on delete cascade,
  foreign key (segment_id, product_id) references public.segments (id, product_id),
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id),
  unique (id, product_id)
);

create table public.consideration_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  interview_id uuid,
  segment_id uuid,
  slot text not null check (slot in ('known_way', 'comparison', 'named_product', 'fear_by_way')),
  content text not null,
  quote_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (interview_id, product_id) references public.interviews (id, product_id) on delete cascade,
  foreign key (segment_id, product_id) references public.segments (id, product_id),
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id)
);

create table public.segment_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  lead_id uuid not null,
  segment_id uuid,
  codebook_version_id uuid not null,
  rule_matched text,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  candidate jsonb,  -- {proposed_name, distinguishing_criterion, why_not_existing} when segment_id is null
  assigned_by text not null default 'human' check (assigned_by in ('human', 'ai', 'migration')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (lead_id, product_id) references public.leads (id, product_id) on delete cascade,
  foreign key (segment_id, product_id) references public.segments (id, product_id),
  foreign key (codebook_version_id, product_id) references public.codebook_versions (id, product_id),
  check (segment_id is not null or candidate is not null),
  -- one person, one segment per codebook version
  unique (lead_id, codebook_version_id)
);

create table public.funnel_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  funnel text not null default 'main',
  position int not null,
  name text not null,
  job_statement text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, funnel, position),
  unique (id, product_id)
);

create table public.drop_offs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  lead_id uuid,
  funnel_stage_id uuid not null,
  mode text not null check (mode in ('interruption', 'switch', 'barrier', 'value_insufficient', 'none')),
  switched_to text,
  cycle_detected boolean not null default false,
  quote_id uuid,
  occurred_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (lead_id, product_id) references public.leads (id, product_id) on delete cascade,
  foreign key (funnel_stage_id, product_id) references public.funnel_stages (id, product_id),
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id)
);

create table public.hypotheses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  segment_id uuid,
  job_id uuid,
  assumption text not null,
  mechanic text not null default '',
  action text not null default '',
  cheapest_test text not null default '',
  kill_criterion text not null default '',
  evidence_level text not null default 'opinion' check (evidence_level in ('opinion', 'crm', 'quotes', 'test')),
  status text not null default 'open' check (status in ('open', 'testing', 'supported', 'rejected', 'parked')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (segment_id, product_id) references public.segments (id, product_id),
  foreign key (job_id, product_id) references public.jobs (id, product_id),
  unique (id, product_id)
);

select public.setup_table('public.audiences');
select public.setup_table('public.codebook_versions');
select public.setup_table('public.segments');
select public.setup_table('public.segment_definitions');
select public.setup_table('public.segment_migrations', true, null, true);
select public.setup_table('public.profile_field_definitions');
select public.setup_table('public.leads');
select public.setup_table('public.interviews');
select public.setup_table('public.client_quotes', true, null, true);
select public.setup_table('public.jobs');
select public.setup_table('public.success_criteria');
select public.setup_table('public.triggers');
select public.setup_table('public.past_investments');
select public.setup_table('public.fears');
select public.setup_table('public.barriers');
select public.setup_table('public.consideration_items');
select public.setup_table('public.segment_assignments');
select public.setup_table('public.funnel_stages');
select public.setup_table('public.drop_offs');
select public.setup_table('public.hypotheses');
