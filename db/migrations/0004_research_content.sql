-- 0004 Research (competitors, signals), ideas, hooks, angles, content, versions, reviews, experiments.

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  name text not null,
  website_url text,
  positioning text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, name),
  unique (id, product_id)
);

create table public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  kind text not null check (kind in ('image', 'video', 'carousel_slide', 'audio', 'document', 'other')),
  title text not null default '',
  storage_path text,
  external_url text,
  mime_type text,
  byte_size int,
  sha256 text,
  origin text not null default 'uploaded' check (origin in ('uploaded', 'generated', 'competitor_reference', 'demo')),
  visual_device_term_id uuid,
  tags text[] not null default '{}',
  rights_note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (visual_device_term_id, product_id) references public.taxonomy_terms (id, product_id),
  check (storage_path is not null or external_url is not null),
  unique (id, product_id)
);

-- Signals: market observations (own or competitors') decomposed into structure, never copied.
create table public.signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  competitor_id uuid,
  url text,
  platform text not null,
  author text,
  observed_on date,
  text_content text not null default '',
  asset_id uuid,
  topic text not null default '',
  format text not null default '',
  persona text not null default '',
  problem text not null default '',
  emotional_trigger text not null default '',
  hook text not null default '',
  angle text not null default '',
  mechanism text not null default '',
  proof text not null default '',
  body_summary text not null default '',
  cta text not null default '',
  visual_device text not null default '',
  funnel_destination text not null default '',
  -- Observed proxies only (e.g. days active, views relative to account median). Never treated as measured effectiveness.
  observed_performance jsonb not null default '{}'::jsonb,
  relevance_reason text not null default '',
  adaptation_idea text not null default '',
  validation_status text not null default 'new' check (validation_status in ('new', 'shortlisted', 'adapted', 'rejected')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (competitor_id, product_id) references public.competitors (id, product_id),
  foreign key (asset_id, product_id) references public.creative_assets (id, product_id),
  unique (id, product_id)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  name text not null,
  goal text not null default '',
  utm_campaign text not null check (utm_campaign ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  starts_on date,
  ends_on date,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, utm_campaign),
  unique (id, product_id)
);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  title text not null,
  insight text not null default '',
  audience_id uuid,
  segment_id uuid,
  job_id uuid,
  fear_id uuid,
  quote_id uuid,
  signal_id uuid,
  campaign_id uuid,
  topic_term_id uuid,
  funnel_stage text,
  status text not null default 'open' check (status in ('open', 'in_production', 'done', 'archived')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (audience_id, product_id) references public.audiences (id, product_id),
  foreign key (segment_id, product_id) references public.segments (id, product_id),
  foreign key (job_id, product_id) references public.jobs (id, product_id),
  foreign key (fear_id, product_id) references public.fears (id, product_id),
  foreign key (quote_id, product_id) references public.client_quotes (id, product_id),
  foreign key (signal_id, product_id) references public.signals (id, product_id),
  foreign key (campaign_id, product_id) references public.campaigns (id, product_id),
  foreign key (topic_term_id, product_id) references public.taxonomy_terms (id, product_id),
  unique (id, product_id)
);

-- Ideas may draw on several knowledge sources (product evidence and/or methodology).
create table public.idea_sources (
  idea_id uuid not null references public.ideas (id) on delete cascade,
  workspace_id uuid not null,
  source_id uuid not null,
  primary key (idea_id, source_id),
  foreign key (source_id, workspace_id) references public.knowledge_sources (id, workspace_id) on delete cascade
);

create table public.hooks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  idea_id uuid,
  text text not null check (length(trim(text)) > 0),
  hook_type text not null default '',
  rationale jsonb not null default '{}'::jsonb,
  origin text not null default 'human' check (origin in ('human', 'ai')),
  agent_run_id uuid,
  status text not null default 'proposed' check (status in ('proposed', 'chosen', 'rejected')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (idea_id, product_id) references public.ideas (id, product_id) on delete cascade,
  unique (id, product_id)
);

create table public.angles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  idea_id uuid,
  name text not null,
  description text not null default '',
  origin text not null default 'human' check (origin in ('human', 'ai')),
  agent_run_id uuid,
  status text not null default 'proposed' check (status in ('proposed', 'chosen', 'rejected')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (idea_id, product_id) references public.ideas (id, product_id) on delete cascade,
  unique (id, product_id)
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  idea_id uuid,
  campaign_id uuid,
  channel text not null check (channel in (
    'instagram', 'facebook', 'threads', 'website', 'youtube', 'tiktok', 'x', 'linkedin', 'snapchat',
    'pinterest', 'blog', 'email', 'meta_ads', 'google_ads')),
  format text not null check (format in (
    'hook', 'angle', 'caption', 'short_post', 'long_post', 'thread', 'reels_script', 'storyboard',
    'carousel', 'static_concept', 'email', 'article', 'helpful_comment', 'ad_creative')),
  goal text not null default '',
  funnel_stage text not null default '',
  language text not null default 'en',
  topic text not null default '',
  cta_term_id uuid,
  title text not null default '',
  status text not null default 'draft' check (status in (
    'draft', 'ai_review', 'needs_human_review', 'approved', 'scheduled', 'published', 'rejected', 'archived')),
  current_version_id uuid,
  scheduled_for timestamptz,
  published_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (idea_id, product_id) references public.ideas (id, product_id),
  foreign key (campaign_id, product_id) references public.campaigns (id, product_id),
  foreign key (cta_term_id, product_id) references public.taxonomy_terms (id, product_id),
  check (status <> 'scheduled' or scheduled_for is not null),
  unique (id, product_id)
);
create index content_items_queue on public.content_items (product_id, status);

-- Valid status transitions (docs/product-architecture.md §9).
create or replace function public.content_items_transition() returns trigger language plpgsql as $$
declare ok boolean;
begin
  if new.status = old.status then return new; end if;
  ok := case old.status
    when 'draft' then new.status in ('ai_review', 'archived')
    when 'ai_review' then new.status in ('needs_human_review', 'draft')
    when 'needs_human_review' then new.status in ('approved', 'rejected', 'draft')
    when 'approved' then new.status in ('scheduled', 'published', 'draft', 'archived')
    when 'scheduled' then new.status in ('published', 'approved', 'draft')
    when 'published' then new.status in ('archived')
    when 'rejected' then new.status in ('draft', 'archived')
    else false
  end;
  if not ok then
    raise exception 'invalid content status transition % -> %', old.status, new.status using errcode = 'P0002';
  end if;
  return new;
end $$;
create trigger content_items_transition before update of status on public.content_items
  for each row execute function public.content_items_transition();

-- Immutable versions. content_hash covers everything that would be sent.
create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  content_item_id uuid not null,
  version int not null check (version > 0),
  -- {hook, body, cta, caption, slides:[{title,text}], script:[{timecode,line,visual}], comment, ...}
  body jsonb not null,
  visual_concept text not null default '',
  hook_id uuid,
  angle_id uuid,
  -- Why this variant: {for_whom, job_or_fear, insight_source, difference, claims_to_verify[], brand_risk, intended_outcome}
  rationale jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb, -- [{kind: chunk|quote|playbook_rule|experiment, id}]
  author_type text not null check (author_type in ('ai', 'human')),
  agent_run_id uuid,
  diff_from_previous jsonb,
  edit_note text not null default '',
  content_hash text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (content_item_id, product_id) references public.content_items (id, product_id) on delete cascade,
  foreign key (hook_id, product_id) references public.hooks (id, product_id),
  foreign key (angle_id, product_id) references public.angles (id, product_id),
  unique (content_item_id, version),
  unique (id, product_id)
);

create or replace function public.content_versions_hash() returns trigger language plpgsql as $$
begin
  new.content_hash := encode(sha256(convert_to(new.body::text || '|' || new.visual_concept, 'UTF8')), 'hex');
  return new;
end $$;
create trigger content_versions_hash before insert on public.content_versions
  for each row execute function public.content_versions_hash();

alter table public.content_items
  add foreign key (current_version_id, product_id) references public.content_versions (id, product_id)
  deferrable initially deferred;

create table public.content_version_assets (
  content_version_id uuid not null references public.content_versions (id) on delete cascade,
  workspace_id uuid not null,
  product_id uuid not null,
  asset_id uuid not null,
  position int not null default 0,
  primary key (content_version_id, asset_id),
  foreign key (asset_id, product_id) references public.creative_assets (id, product_id)
);

-- Brand / compliance review findings for a specific version.
create table public.content_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  content_version_id uuid not null,
  reviewer text not null check (reviewer in ('guardrails', 'brand_ai', 'compliance_ai', 'human')),
  outcome text not null check (outcome in ('pass', 'warn', 'block')),
  findings jsonb not null default '[]'::jsonb, -- [{code, severity, message, excerpt, rule_id}]
  agent_run_id uuid,
  created_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (content_version_id, product_id) references public.content_versions (id, product_id) on delete cascade
);

-- One experiment per content item: the unit of learning of the Data Flywheel.
create table public.experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  content_item_id uuid not null unique,
  -- Snapshot of decision-time context: product, audience, segment, job, insight source, quote, channel, format,
  -- topic, angle, hook, cta, visual concept, funnel stage, goal, language. Never back-filled.
  dimensions_snapshot jsonb not null default '{}'::jsonb,
  hypothesis text not null default '',
  primary_metric text not null default 'clicks',
  counter_metric text,
  min_sample int,
  window_days int not null default 14 check (window_days between 1 and 365),
  production_cost numeric(12, 2),
  currency text not null default 'EUR',
  locked_at timestamptz,
  outcome_status text not null default 'open' check (outcome_status in ('open', 'inconclusive', 'supported', 'not_supported', 'stopped')),
  conclusion text not null default '',
  computed_summary jsonb,
  concluded_by uuid references public.users (id),
  concluded_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (content_item_id, product_id) references public.content_items (id, product_id) on delete cascade,
  check (outcome_status = 'open' or (concluded_by is not null and concluded_at is not null)),
  unique (id, product_id)
);

-- Pre-registration lock: once published, hypothesis/metrics/window and the dimension snapshot cannot change.
create or replace function public.experiments_preregistration_lock() returns trigger language plpgsql as $$
begin
  if old.locked_at is not null and (
       new.hypothesis is distinct from old.hypothesis or new.primary_metric is distinct from old.primary_metric
    or new.counter_metric is distinct from old.counter_metric or new.min_sample is distinct from old.min_sample
    or new.window_days is distinct from old.window_days or new.dimensions_snapshot is distinct from old.dimensions_snapshot) then
    raise exception 'experiment is locked after first publication; pre-registered fields cannot change';
  end if;
  return new;
end $$;
create trigger experiments_preregistration_lock before update on public.experiments
  for each row execute function public.experiments_preregistration_lock();

select public.setup_table('public.competitors');
select public.setup_table('public.creative_assets');
select public.setup_table('public.signals');
select public.setup_table('public.campaigns');
select public.setup_table('public.ideas');
select public.setup_table('public.idea_sources');
select public.setup_table('public.hooks');
select public.setup_table('public.angles');
select public.setup_table('public.content_items');
select public.setup_table('public.content_versions', true, null, true);
select public.setup_table('public.content_version_assets');
select public.setup_table('public.content_reviews', true, null, true);
select public.setup_table('public.experiments');
