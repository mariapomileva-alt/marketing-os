-- 0006 Prompt templates, workflow and agent runs, assertions with evidence (fact / quote / hypothesis ...).

create table public.prompt_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9_.-]+$'),
  role text not null check (role in (
    'researcher', 'audience_analyst', 'ajtbd_analyst', 'signal_analyst', 'hook_analyst', 'content_strategist',
    'creator', 'brand_editor', 'compliance_editor', 'creative_director', 'publisher', 'performance_analyst')),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, key),
  unique (id, workspace_id)
);

create table public.prompt_template_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  template_id uuid not null,
  version int not null check (version > 0),
  system_prompt text not null,
  output_schema_name text not null,
  change_note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (template_id, workspace_id) references public.prompt_templates (id, workspace_id) on delete cascade,
  unique (template_id, version)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  workflow text not null default 'content_pipeline',
  idea_id uuid,
  input jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (status in ('running', 'waiting_for_human', 'completed', 'failed', 'cancelled')),
  current_step text,
  total_cost_usd numeric(12, 6) not null default 0,
  final_human_decision text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (idea_id, product_id) references public.ideas (id, product_id),
  unique (id, product_id)
);

-- One row per model call, written when the call finishes (success or failure). Append-only.
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  workflow_run_id uuid,
  step text not null,
  role text not null,
  provider text not null,
  model text not null,
  is_mock boolean not null,
  prompt_template_version_id uuid references public.prompt_template_versions (id),
  input_snapshot jsonb not null,
  source_ids jsonb not null default '[]'::jsonb,
  output jsonb,
  raw_output text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6),
  duration_ms int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (workflow_run_id, product_id) references public.workflow_runs (id, product_id),
  unique (id, product_id)
);
create index agent_runs_day on public.agent_runs (workspace_id, created_at);

alter table public.hooks add foreign key (agent_run_id, product_id) references public.agent_runs (id, product_id);
alter table public.angles add foreign key (agent_run_id, product_id) references public.agent_runs (id, product_id);
alter table public.content_versions add foreign key (agent_run_id, product_id) references public.agent_runs (id, product_id);
alter table public.content_reviews add foreign key (agent_run_id, product_id) references public.agent_runs (id, product_id);
alter table public.conversation_messages add foreign key (agent_run_id, product_id) references public.agent_runs (id, product_id);

-- ---------------------------------------------------------------------------
-- Assertions: every statement shown to the owner carries an epistemic status and its evidence.
-- ---------------------------------------------------------------------------
create table public.assertions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  kind text not null check (kind in ('fact', 'quote', 'observation', 'hypothesis', 'recommendation', 'confirmed_result')),
  origin text not null check (origin in ('human', 'ai', 'computed')),
  statement text not null check (length(trim(statement)) > 0),
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  subject_type text,  -- e.g. 'experiment', 'segment', 'idea'
  subject_id uuid,
  agent_run_id uuid,
  confirmed_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (agent_run_id, product_id) references public.agent_runs (id, product_id),
  -- AI never asserts facts, quotes or confirmed results on its own.
  check (origin <> 'ai' or kind in ('observation', 'hypothesis', 'recommendation')),
  check (kind <> 'confirmed_result' or (origin = 'human' and confirmed_by is not null and subject_type = 'experiment')),
  unique (id, product_id)
);

create table public.assertion_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  assertion_id uuid not null,
  chunk_id uuid references public.knowledge_chunks (id) on delete restrict,
  quote_id uuid,
  metric_event_id uuid,
  experiment_id uuid,
  playbook_rule_id uuid references public.playbook_rules (id),
  product_claim_id uuid,
  note text not null default '',
  created_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (assertion_id, product_id) references public.assertions (id, product_id) on delete cascade,
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id),
  foreign key (metric_event_id, product_id) references public.metric_events (id, product_id),
  foreign key (experiment_id, product_id) references public.experiments (id, product_id),
  foreign key (product_claim_id, product_id) references public.product_claims (id, product_id),
  check (num_nonnulls(chunk_id, quote_id, metric_event_id, experiment_id, playbook_rule_id, product_claim_id) = 1)
);

-- Methodology (workspace-scope) sources and playbook rules can support hypotheses and recommendations,
-- never facts, quotes or confirmed results about a product.
create or replace function public.assertion_evidence_scope() returns trigger language plpgsql as $$
declare k text; sc text; sp uuid;
begin
  select kind into k from public.assertions where id = new.assertion_id;
  if new.chunk_id is not null then
    select s.scope, s.product_id into sc, sp from public.knowledge_chunks c join public.knowledge_sources s on s.id = c.source_id
     where c.id = new.chunk_id;
    if sc = 'product' and sp <> new.product_id then
      raise exception 'evidence belongs to another product';
    end if;
    if sc = 'workspace' and k in ('fact', 'quote', 'confirmed_result') then
      raise exception 'methodology sources cannot support a % about a product', k;
    end if;
  end if;
  if new.playbook_rule_id is not null and k in ('fact', 'quote', 'confirmed_result') then
    raise exception 'playbook rules cannot support a % about a product', k;
  end if;
  if k = 'quote' and new.quote_id is null and new.chunk_id is null then
    raise exception 'a quote assertion needs a client quote or source chunk';
  end if;
  return new;
end $$;
create trigger assertion_evidence_scope before insert or update on public.assertion_evidence
  for each row execute function public.assertion_evidence_scope();

-- Facts, quotes and confirmed results must have at least one evidence row by the end of the transaction.
create or replace function public.assertions_require_evidence() returns trigger language plpgsql as $$
begin
  if new.kind in ('fact', 'quote', 'confirmed_result')
     and not exists (select 1 from public.assertion_evidence e where e.assertion_id = new.id) then
    raise exception 'a % must cite at least one source', new.kind using errcode = 'P0005';
  end if;
  return null;
end $$;
create constraint trigger assertions_require_evidence after insert or update on public.assertions
  deferrable initially deferred for each row execute function public.assertions_require_evidence();

select public.setup_table('public.prompt_templates');
select public.setup_table('public.prompt_template_versions', true, null, true);
select public.setup_table('public.workflow_runs');
select public.setup_table('public.agent_runs', false, null, true);
select public.setup_table('public.assertions');
select public.setup_table('public.assertion_evidence');
