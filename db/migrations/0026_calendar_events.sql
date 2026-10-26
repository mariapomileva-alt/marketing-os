-- 0026 Posts that live on the platforms themselves (published or scheduled there, also outside God of Marketing),
-- read from the official APIs so the calendar shows everything in one place. Read-only mirror; nothing is posted from it.
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  source text not null check (source in ('instagram', 'threads', 'youtube', 'facebook', 'tiktok')),
  external_id text not null,
  kind text not null default 'post' check (kind in ('post', 'reel', 'video', 'short', 'story', 'carousel', 'image', 'text')),
  status text not null check (status in ('published', 'scheduled', 'private')),
  title text not null default '',
  url text,
  thumbnail_url text,
  at timestamptz not null,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, source, external_id)
);
create index calendar_events_time on public.calendar_events (product_id, at);
select public.setup_table('public.calendar_events', false);
revoke all on public.calendar_events from anon;
