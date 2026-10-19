-- 0002 Knowledge base: imports, sources with provenance, chunks, embeddings, methodology playbook.

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  product_id uuid,
  kind text not null check (kind in ('knowledge', 'course_methodology', 'metrics_csv', 'conversions_csv', 'ads_report', 'ajtbd_records')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'reverted')),
  source_label text not null default '',
  stats jsonb not null default '{}'::jsonb,
  error text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

create table public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid,
  scope text not null check (scope in ('product', 'workspace')),
  source_type text not null check (source_type in (
    'doc', 'transcript', 'interview', 'call', 'note', 'report', 'creative', 'url', 'image', 'dataset',
    'methodology')),
  title text not null check (length(trim(title)) > 0),
  original_filename text,
  mime_type text,
  storage_path text,
  author text,
  document_date date,
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  sha256 text not null,
  byte_size int,
  contains_personal_data boolean not null default false,
  consent_recorded boolean not null default false,
  provenance jsonb not null default '{}'::jsonb, -- course section/session/speaker, page counts, etc.
  import_batch_id uuid references public.import_batches (id) on delete set null,
  status text not null default 'ready' check (status in ('processing', 'ready', 'failed', 'archived')),
  error text,
  imported_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check ((scope = 'product') = (product_id is not null)),
  -- Customer evidence is always product-scoped; methodology is always workspace-scoped.
  check (scope = 'product' or source_type in ('methodology', 'report', 'note', 'doc')),
  check (source_type <> 'methodology' or scope = 'workspace'),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (id, workspace_id),
  unique (workspace_id, sha256)
);
create index knowledge_sources_product on public.knowledge_sources (workspace_id, product_id, status);

alter table public.product_claims
  add foreign key (evidence_source_id) references public.knowledge_sources (id) on delete set null;

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_id uuid not null,
  ordinal int not null,
  content text not null,
  -- Locator: {heading_path: [...], line_start, line_end, page, timestamp, json_path, row}
  locator jsonb not null default '{}'::jsonb,
  token_estimate int not null default 0,
  fts tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now(),
  foreign key (source_id, workspace_id) references public.knowledge_sources (id, workspace_id) on delete cascade,
  unique (source_id, ordinal),
  unique (id, workspace_id)
);
create index knowledge_chunks_fts on public.knowledge_chunks using gin (fts);

-- One row per chunk per embedding model; the model can change without re-chunking.
-- The vector column is untyped so models with different dimensions can coexist; queries filter by model.
create table public.knowledge_embeddings (
  chunk_id uuid not null references public.knowledge_chunks (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  model text not null,
  dims int not null,
  embedding vector not null,
  created_at timestamptz not null default now(),
  primary key (chunk_id, model),
  check (vector_dims(embedding) = dims)
);

-- Participant pseudonyms for the course import: HMAC of the real name -> stable pseudonym.
-- Real names are never stored.
create table public.pseudonyms (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name_hmac text not null,
  pseudonym text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, name_hmac),
  unique (workspace_id, pseudonym)
);

-- Methodology playbook: distilled, versioned, owner-approved rules with citations.
create table public.playbook_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_.-]+$'),
  version int not null default 1,
  kind text not null check (kind in ('principle', 'checklist_item', 'creative_formula', 'review_rule', 'anti_pattern')),
  area text not null check (area in ('data_flywheel', 'ajtbd', 'content', 'creative', 'distribution', 'attribution', 'analytics', 'onboarding', 'ethics')),
  title text not null,
  statement text not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'retired')),
  approved_by uuid references public.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code, version),
  unique (id, workspace_id)
);

create table public.playbook_rule_sources (
  rule_id uuid not null,
  workspace_id uuid not null,
  chunk_id uuid not null,
  note text not null default '',
  primary key (rule_id, chunk_id),
  foreign key (rule_id, workspace_id) references public.playbook_rules (id, workspace_id) on delete cascade,
  foreign key (chunk_id, workspace_id) references public.knowledge_chunks (id, workspace_id) on delete cascade
);

create table public.product_rule_overrides (
  workspace_id uuid not null,
  product_id uuid not null,
  rule_id uuid not null,
  applicability text not null check (applicability in ('applies', 'not_applicable', 'adapted')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (product_id, rule_id),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (rule_id, workspace_id) references public.playbook_rules (id, workspace_id) on delete cascade
);

select public.setup_table('public.import_batches');
select public.setup_table('public.knowledge_sources');
select public.setup_table('public.knowledge_chunks', false);
select public.setup_table('public.knowledge_embeddings', false);
select public.setup_table('public.pseudonyms', false, null, true);
select public.setup_table('public.playbook_rules');
select public.setup_table('public.playbook_rule_sources');
select public.setup_table('public.product_rule_overrides');
