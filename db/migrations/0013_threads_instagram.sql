-- 0013 Threads and Instagram community work, Threads publishing.
-- Same rules as YouTube: drafts only; every comment, reply and post needs approval; posting is a separate,
-- switchable step with limits and an audit trail (outbound_actions).

-- Posts by other people that we might answer: found by Threads keyword search, or added by hand (Instagram reels).
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  channel text not null check (channel in ('threads', 'instagram')),
  post_id text,                       -- platform id when known (Threads media id); null for hand-added reels
  url text,
  author text,
  text text not null default '',
  posted_at timestamptz,
  found_by_query text,
  relevance integer not null default 0 check (relevance between 0 and 100),
  reason text not null default '',
  flags text[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'skipped', 'drafted', 'reviewed', 'approved', 'rejected', 'published')),
  conversation_id uuid,
  is_demo boolean not null default false,
  found_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (conversation_id, product_id) references public.conversations (id, product_id),
  unique (id, product_id)
);
create unique index social_posts_platform_id on public.social_posts (product_id, channel, post_id) where post_id is not null;

-- Threads search settings (Instagram has no search here: reels are added by hand).
create table public.threads_settings (
  product_id uuid primary key,
  workspace_id uuid not null,
  enabled boolean not null default false,
  queries text[] not null default array['panic attack', 'anxiety attack', 'паническая атака', 'панические атаки'],
  drafts_per_run integer not null default 3 check (drafts_per_run between 0 and 10),
  author_cooldown_days integer not null default 30 check (author_cooldown_days >= 1),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

-- Long-lived platform tokens expire (Threads: 60 days); refreshed before that.
alter table public.channel_connections add column token_expires_at timestamptz;
-- The platform's id for what we published (Threads media id), for replies and insights.
alter table public.publications add column external_id text;

select public.setup_table('public.social_posts');
select public.setup_table('public.threads_settings');
revoke all on public.social_posts, public.threads_settings from anon;
revoke truncate on public.social_posts, public.threads_settings from authenticated;
