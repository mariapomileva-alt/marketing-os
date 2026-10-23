-- 0012 Website traffic by source (own cookieless counter) and engagement on our YouTube comments.

-- One tracked website per product. site_key is public (it sits in the page's script tag); it only lets a page
-- report visits for this product, nothing else. app_store_pt is the App Store Connect provider token used to add
-- campaign parameters to App Store links (installs per source then show in App Store Connect).
create table public.site_settings (
  product_id uuid primary key,
  workspace_id uuid not null,
  site_key text not null unique default replace(gen_random_uuid()::text, '-', ''),
  domain text,
  app_store_url text,
  app_store_pt text check (app_store_pt is null or app_store_pt ~ '^[0-9]{3,20}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

-- Visits and App Store clicks. No IP, no cookies: visitor_hash is a daily-rotating hash, unusable across days.
create table public.site_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  product_id uuid not null,
  kind text not null check (kind in ('pageview', 'app_store_click')),
  path text not null default '/',
  source text not null,
  medium text,
  campaign text,
  content text,
  referrer_host text,
  visitor_hash text not null,
  device text check (device in ('mobile', 'desktop')),
  country text,
  occurred_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index site_events_product_time on public.site_events (product_id, occurred_at desc);

select public.setup_table('public.site_settings');
select public.setup_table('public.site_events', false, null, true);
revoke all on public.site_settings, public.site_events from anon;
revoke truncate on public.site_settings from authenticated;

-- Likes and replies on what we posted (read from the platform, cumulative counters).
alter table public.conversation_messages
  add column like_count integer,
  add column reply_count integer,
  add column stats_checked_at timestamptz;
