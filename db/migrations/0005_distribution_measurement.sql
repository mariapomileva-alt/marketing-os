-- 0005 Connections, approvals, outbound actions, publications, UTM, metrics, conversations, conversions, paid ads.

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------
create table public.channel_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  channel text not null,
  adapter_kind text not null check (adapter_kind in ('official_api', 'export', 'browser_automation')),
  account_label text not null default '',
  -- Hard red line for v0.1: 'automatic' cannot be stored (a later migration lifts this deliberately).
  mode text not null default 'draft_only' check (mode in ('draft_only', 'requires_approval')),
  status text not null default 'connected' check (status in ('connected', 'paused', 'revoked', 'error')),
  paused_reason text,
  paused_until timestamptz,
  limits jsonb not null default '{"daily_limit": 3, "account_daily_cap": 0, "min_gap_minutes": 60, "author_cooldown_days": 30, "active_hours": {"start": 9, "end": 21, "tz": "Europe/Riga"}}'::jsonb,
  secret_id uuid references public.secrets (id) on delete set null,
  scopes text[] not null default '{}',
  last_health_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete restrict,
  check (status <> 'revoked' or (secret_id is null and revoked_at is not null)),
  check (adapter_kind <> 'browser_automation' or status <> 'connected'),
  unique (id, product_id)
);

create table public.ai_provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete restrict,
  provider text not null check (provider in ('anthropic', 'openai')),
  label text not null default '',
  status text not null default 'connected' check (status in ('connected', 'revoked', 'error')),
  secret_id uuid references public.secrets (id) on delete set null,
  default_model text,
  last_health_at timestamptz,
  last_error text,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (status <> 'revoked' or (secret_id is null and revoked_at is not null))
);
create unique index ai_provider_one_active on public.ai_provider_connections (workspace_id, provider) where status <> 'revoked';

-- ---------------------------------------------------------------------------
-- UTM links
-- ---------------------------------------------------------------------------
create table public.utm_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  content_item_id uuid,
  experiment_id uuid,
  campaign_id uuid,
  channel text not null,
  landing_url text not null check (landing_url ~* '^https?://'),
  utm_source text not null check (utm_source ~ '^[a-z0-9_.-]+$'),
  utm_medium text not null check (utm_medium ~ '^[a-z0-9_.-]+$'),
  utm_campaign text not null check (utm_campaign ~ '^[a-z0-9_.-]+$'),
  utm_content text not null check (utm_content ~ '^[a-z0-9_.-]+$'),
  utm_term text check (utm_term is null or utm_term ~ '^[a-z0-9_.-]+$'),
  full_url text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (content_item_id, product_id) references public.content_items (id, product_id),
  foreign key (experiment_id, product_id) references public.experiments (id, product_id),
  foreign key (campaign_id, product_id) references public.campaigns (id, product_id),
  unique (product_id, full_url),
  unique (product_id, utm_campaign, utm_content),
  unique (id, product_id)
);

-- ---------------------------------------------------------------------------
-- Conversations (comments and replies on our posts)
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  publication_id uuid,
  channel text not null,
  thread_url text,
  status text not null default 'open' check (status in ('open', 'needs_reply', 'replied', 'closed')),
  sensitive boolean not null default false, -- e.g. a person describing a crisis: never auto-handled
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (id, product_id)
);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  conversation_id uuid not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  author_handle text,
  text text not null,
  occurred_at timestamptz not null default now(),
  status text not null default 'logged' check (status in ('logged', 'draft', 'approved', 'posted', 'rejected')),
  agent_run_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (conversation_id, product_id) references public.conversations (id, product_id) on delete cascade,
  check (direction = 'outbound' or status = 'logged'),
  unique (id, product_id)
);

-- ---------------------------------------------------------------------------
-- Paid advertising
-- ---------------------------------------------------------------------------
create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  platform text not null check (platform in ('meta_ads', 'google_ads', 'tiktok_ads', 'linkedin_ads', 'other')),
  external_account_id text not null,
  name text not null default '',
  currency text not null default 'EUR',
  connection_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (connection_id, product_id) references public.channel_connections (id, product_id),
  unique (product_id, platform, external_account_id),
  unique (id, product_id)
);

create table public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  ad_account_id uuid not null,
  external_id text not null,
  name text not null,
  objective text,
  status text,
  campaign_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (ad_account_id, product_id) references public.ad_accounts (id, product_id) on delete cascade,
  foreign key (campaign_id, product_id) references public.campaigns (id, product_id),
  unique (ad_account_id, external_id),
  unique (id, product_id)
);

create table public.ad_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  ad_campaign_id uuid not null,
  external_id text not null,
  name text not null,
  audience_note text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (ad_campaign_id, product_id) references public.ad_campaigns (id, product_id) on delete cascade,
  unique (ad_campaign_id, external_id),
  unique (id, product_id)
);

create table public.ads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  ad_group_id uuid not null,
  external_id text not null,
  name text not null,
  status text,
  content_item_id uuid,
  creative_asset_id uuid,
  utm_link_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (ad_group_id, product_id) references public.ad_groups (id, product_id) on delete cascade,
  foreign key (content_item_id, product_id) references public.content_items (id, product_id),
  foreign key (creative_asset_id, product_id) references public.creative_assets (id, product_id),
  foreign key (utm_link_id, product_id) references public.utm_links (id, product_id),
  unique (ad_group_id, external_id),
  unique (id, product_id)
);

-- Daily stats as reported by the ad platform. Platform-reported conversions are platform claims,
-- kept apart from our own conversions. Append-only; the latest import for (ad, day) wins in views.
create table public.ad_daily_stats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  ad_id uuid not null,
  day date not null,
  spend numeric(14, 2) not null check (spend >= 0),
  currency text not null,
  impressions bigint not null default 0 check (impressions >= 0),
  reach bigint check (reach >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  platform_conversions numeric(14, 2) check (platform_conversions >= 0),
  platform_conversion_value numeric(14, 2),
  import_batch_id uuid not null references public.import_batches (id) on delete restrict,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (ad_id, product_id) references public.ads (id, product_id) on delete cascade,
  unique (ad_id, day, import_batch_id)
);

-- Reverted import batches are excluded (append-only rows are never deleted; undo = revert the batch).
create view public.ad_daily_stats_latest with (security_invoker = true) as
select distinct on (s.ad_id, s.day) s.*
from public.ad_daily_stats s
join public.import_batches b on b.id = s.import_batch_id and b.status <> 'reverted'
order by s.ad_id, s.day, s.created_at desc;

create table public.ad_change_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  ad_account_id uuid not null,
  target_level text not null check (target_level in ('campaign', 'ad_group', 'ad')),
  target_external_id text not null,
  change jsonb not null, -- {action: pause|resume|set_budget|create_ad, ...}
  rationale text not null default '',
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'applied', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (ad_account_id, product_id) references public.ad_accounts (id, product_id),
  unique (id, product_id)
);

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------
create table public.approval_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  item_type text not null check (item_type in ('content_version', 'reply', 'ad_change', 'segment_change')),
  content_version_id uuid,
  conversation_message_id uuid,
  ad_change_request_id uuid,
  subject_summary text not null default '',
  -- Exactly what would be sent and where: {channel, account, target_url, text, media, utm_url}
  payload_snapshot jsonb not null,
  payload_hash text not null,
  destination jsonb not null default '{}'::jsonb,
  reason_in_queue text not null default '',
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'changes_requested', 'invalidated')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (content_version_id, product_id) references public.content_versions (id, product_id),
  foreign key (conversation_message_id, product_id) references public.conversation_messages (id, product_id),
  foreign key (ad_change_request_id, product_id) references public.ad_change_requests (id, product_id),
  check (num_nonnulls(content_version_id, conversation_message_id, ad_change_request_id) <= 1),
  check (item_type <> 'content_version' or content_version_id is not null),
  check (item_type <> 'reply' or conversation_message_id is not null),
  check (item_type <> 'ad_change' or ad_change_request_id is not null),
  unique (id, product_id)
);
create unique index approval_one_open_per_version on public.approval_items (content_version_id)
  where state in ('pending', 'approved');

create table public.approval_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  approval_item_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  payload_hash text not null,
  note text not null default '',
  decided_by uuid not null default auth.uid() references public.users (id),
  decided_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (approval_item_id, product_id) references public.approval_items (id, product_id)
);

-- A decision must match the hash currently in the queue item (no approving a stale preview).
create or replace function public.approval_decisions_apply() returns trigger language plpgsql as $$
declare item record;
begin
  select * into item from public.approval_items where id = new.approval_item_id for update;
  if item.state <> 'pending' then
    raise exception 'approval item is %, not pending', item.state;
  end if;
  if item.payload_hash <> new.payload_hash then
    raise exception 'payload changed since it was shown; review the current version';
  end if;
  update public.approval_items set state = new.decision, decided_at = new.decided_at where id = item.id;
  return new;
end $$;
create trigger approval_decisions_apply before insert on public.approval_decisions
  for each row execute function public.approval_decisions_apply();

-- Content can only become 'approved' when its current version holds an approved queue item.
create or replace function public.content_items_require_approval() returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status <> 'approved' then
    if not exists (select 1 from public.approval_items a
                   where a.content_version_id = new.current_version_id and a.state = 'approved') then
      raise exception 'content cannot be approved without a human approval of its current version' using errcode = 'P0003';
    end if;
  end if;
  return new;
end $$;
create trigger content_items_require_approval before update of status on public.content_items
  for each row execute function public.content_items_require_approval();

-- A new current version invalidates open approvals of older versions and sends approved/scheduled items back to draft.
create or replace function public.content_items_new_version() returns trigger language plpgsql as $$
begin
  if new.current_version_id is distinct from old.current_version_id then
    update public.approval_items set state = 'invalidated', updated_at = now()
     where product_id = new.product_id and state in ('pending', 'approved')
       and content_version_id in (select id from public.content_versions where content_item_id = new.id)
       and content_version_id is distinct from new.current_version_id;
    if old.status in ('approved', 'scheduled', 'needs_human_review', 'ai_review') and new.status = old.status then
      new.status := 'draft';
      new.scheduled_for := null;
    end if;
    if old.status = 'published' then
      raise exception 'published content cannot get a new version; duplicate it instead';
    end if;
  end if;
  return new;
end $$;
create trigger content_items_new_version before update of current_version_id on public.content_items
  for each row execute function public.content_items_new_version();

-- ---------------------------------------------------------------------------
-- Publications and outbound actions
-- ---------------------------------------------------------------------------
create table public.publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  content_item_id uuid not null,
  content_version_id uuid not null,
  channel text not null,
  connection_id uuid,
  method text not null check (method in ('export', 'api', 'manual')),
  external_url text,
  utm_link_id uuid,
  approval_item_id uuid not null,
  published_at timestamptz not null default now(),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (content_item_id, product_id) references public.content_items (id, product_id),
  foreign key (content_version_id, product_id) references public.content_versions (id, product_id),
  foreign key (connection_id, product_id) references public.channel_connections (id, product_id) on delete restrict,
  foreign key (utm_link_id, product_id) references public.utm_links (id, product_id),
  foreign key (approval_item_id, product_id) references public.approval_items (id, product_id),
  unique (id, product_id)
);

-- Publishing requires the exact version to be approved; it locks the experiment's pre-registration.
create or replace function public.publications_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.approval_items a
                 where a.id = new.approval_item_id and a.state = 'approved'
                   and a.content_version_id = new.content_version_id) then
    raise exception 'publication requires an approved queue item for this exact version' using errcode = 'P0004';
  end if;
  update public.experiments set locked_at = coalesce(locked_at, now()) where content_item_id = new.content_item_id;
  return new;
end $$;
create trigger publications_guard before insert on public.publications
  for each row execute function public.publications_guard();

alter table public.conversations
  add foreign key (publication_id, product_id) references public.publications (id, product_id);

create table public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  kind text not null,
  status text not null default 'running' check (status in ('running', 'ok', 'error', 'skipped')),
  stats jsonb not null default '{}'::jsonb,
  log text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (id, product_id)
);

-- Every attempted external action with the policy evaluation and a visible reason.
create table public.outbound_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  connection_id uuid,
  approval_item_id uuid,
  automation_run_id uuid,
  action text not null check (action in ('export', 'publish', 'reply', 'ad_change')),
  dedupe_key text,
  target_author text,
  result text not null check (result in ('executed', 'skipped', 'failed')),
  reason text not null,
  policy_checks jsonb not null default '[]'::jsonb,
  error_class text check (error_class in ('captcha', 'restriction', 'auth_lost', 'rate_limited', 'other')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (connection_id, product_id) references public.channel_connections (id, product_id) on delete restrict,
  foreign key (approval_item_id, product_id) references public.approval_items (id, product_id),
  foreign key (automation_run_id, product_id) references public.automation_runs (id, product_id)
);
create unique index outbound_dedupe on public.outbound_actions (product_id, dedupe_key)
  where result = 'executed' and dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- Metrics, conversions, attribution, spend
-- ---------------------------------------------------------------------------
create table public.metric_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  publication_id uuid not null,
  metric text not null check (metric in (
    'reach', 'impressions', 'views', 'retention_avg_pct', 'likes', 'saves', 'shares', 'comments',
    'clicks', 'profile_visits', 'follows')),
  value numeric(16, 4) not null check (value >= 0),
  observed_at timestamptz not null,
  source text not null check (source in ('manual', 'csv', 'api')),
  import_batch_id uuid references public.import_batches (id) on delete restrict,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (publication_id, product_id) references public.publications (id, product_id) on delete cascade,
  check (metric <> 'retention_avg_pct' or value <= 100),
  unique (id, product_id)
);
create index metric_events_pub on public.metric_events (publication_id, metric, observed_at desc);

-- Latest observed value per publication and metric (platforms report cumulative counters).
create view public.metric_latest with (security_invoker = true) as
select distinct on (m.publication_id, m.metric)
  m.workspace_id, m.product_id, m.publication_id, m.metric, m.value, m.observed_at, m.source, m.is_demo
from public.metric_events m
left join public.import_batches b on b.id = m.import_batch_id
where b.id is null or b.status <> 'reverted'
order by m.publication_id, m.metric, m.observed_at desc, m.created_at desc;

create table public.conversions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  lead_id uuid,
  type text not null check (type in ('registration', 'trial_start', 'payment', 'cancellation', 'refund', 'lead')),
  amount numeric(14, 2),
  currency text,
  occurred_at timestamptz not null,
  external_ref text,
  utm_link_id uuid,
  raw_utm jsonb not null default '{}'::jsonb,
  match_status text not null default 'unmatched' check (match_status in ('matched', 'unmatched', 'ambiguous')),
  import_batch_id uuid references public.import_batches (id) on delete restrict,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (lead_id, product_id) references public.leads (id, product_id),
  foreign key (utm_link_id, product_id) references public.utm_links (id, product_id),
  check ((match_status = 'matched') = (utm_link_id is not null)),
  unique (product_id, type, external_ref)
);

create table public.attribution_touchpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  lead_id uuid not null,
  utm_link_id uuid not null,
  touch_kind text not null check (touch_kind in ('first', 'last_non_direct', 'other')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (lead_id, product_id) references public.leads (id, product_id) on delete cascade,
  foreign key (utm_link_id, product_id) references public.utm_links (id, product_id)
);

create table public.spend_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  experiment_id uuid,
  campaign_id uuid,
  day date not null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null,
  kind text not null default 'ad_spend' check (kind in ('ad_spend', 'production', 'tooling')),
  source text not null default 'manual' check (source in ('manual', 'csv', 'ads_import')),
  note text not null default '',
  import_batch_id uuid references public.import_batches (id) on delete restrict,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (experiment_id, product_id) references public.experiments (id, product_id),
  foreign key (campaign_id, product_id) references public.campaigns (id, product_id)
);

select public.setup_table('public.channel_connections', true, null);
select public.setup_table('public.ai_provider_connections');
select public.setup_table('public.utm_links', true, null, true);
select public.setup_table('public.conversations');
select public.setup_table('public.conversation_messages');
select public.setup_table('public.ad_accounts');
select public.setup_table('public.ad_campaigns');
select public.setup_table('public.ad_groups');
select public.setup_table('public.ads');
select public.setup_table('public.ad_daily_stats', false, null, true);
select public.setup_table('public.ad_change_requests');
select public.setup_table('public.approval_items');
select public.setup_table('public.approval_decisions', true, null, true);
select public.setup_table('public.publications');
select public.setup_table('public.automation_runs');
select public.setup_table('public.outbound_actions');
select public.setup_table('public.metric_events', false, null, true);
select public.setup_table('public.conversions');
select public.setup_table('public.attribution_touchpoints');
select public.setup_table('public.spend_entries');

grant select on public.metric_latest, public.ad_daily_stats_latest to authenticated, service_role;
