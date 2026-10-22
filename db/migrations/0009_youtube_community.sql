-- 0009 YouTube community work: found videos, per-product settings, richer conversation drafts.
-- Drafts only. Nothing here can publish: publishing goes through approval_items + outbound_actions like every
-- other external action, and the YouTube adapter is off by default (YOUTUBE_PUBLISHING_ENABLED).

create table public.yt_settings (
  product_id uuid primary key,
  workspace_id uuid not null,
  enabled boolean not null default false,
  queries text[] not null default array[
    'panic attack', 'how to stop a panic attack', 'what to do during a panic attack', 'grounding during panic',
    'паническая атака', 'что делать при панической атаке', 'как пережить приступ паники', 'первая помощь при панической атаке'],
  languages text[] not null default array['en', 'ru'],
  min_duration_seconds integer not null default 61 check (min_duration_seconds >= 0),
  channel_cooldown_days integer not null default 30 check (channel_cooldown_days >= 1),
  drafts_per_run integer not null default 3 check (drafts_per_run between 0 and 10),
  daily_publish_limit integer not null default 3 check (daily_publish_limit between 0 and 10),
  published_within_days integer not null default 14 check (published_within_days between 1 and 90),
  brand_name text, -- how the team names the product in comments (e.g. "Back"); defaults to the product name
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create table public.yt_videos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{6,20}$'),
  url text not null,
  title text not null,
  description text not null default '',
  channel_id text not null,
  channel_title text not null default '',
  published_at timestamptz,
  language text,
  views bigint,
  duration_seconds integer,
  matched_keywords text[] not null default '{}',
  found_by_query text,
  relevance integer not null check (relevance between 0 and 100),
  reason text not null,
  flags text[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'skipped', 'drafted', 'reviewed', 'approved', 'rejected', 'published')),
  conversation_id uuid,
  is_demo boolean not null default false,
  found_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (conversation_id, product_id) references public.conversations (id, product_id),
  unique (product_id, video_id),
  unique (id, product_id)
);
create index yt_videos_channel on public.yt_videos (product_id, channel_id);

alter table public.conversations
  add column external_ref text,
  add column subject text,
  add column risk text not null default 'low' check (risk in ('low', 'medium', 'high')),
  add column risk_reason text;

alter table public.conversation_messages
  add column kind text,
  add column variant text check (variant in ('helpful', 'with_mention', 'reply', 'safety')),
  add column mentions_product boolean not null default false,
  add column voice jsonb,
  add column external_id text;

alter table public.prompt_templates drop constraint prompt_templates_role_check;
alter table public.prompt_templates add constraint prompt_templates_role_check check (role in (
  'researcher', 'audience_analyst', 'ajtbd_analyst', 'signal_analyst', 'hook_analyst', 'content_strategist',
  'creator', 'brand_editor', 'compliance_editor', 'creative_director', 'publisher', 'performance_analyst', 'community_manager'));

select public.setup_table('public.yt_settings');
select public.setup_table('public.yt_videos');

-- Hosted Supabase: keep anon out of the new tables too (see 0008).
revoke all on public.yt_settings, public.yt_videos from anon;
revoke truncate on public.yt_settings, public.yt_videos from authenticated;
