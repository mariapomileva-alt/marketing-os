-- 0015 Calm affirmation videos for YouTube: script (AI) → voice (TTS) → nature footage → render (GitHub Actions,
-- ffmpeg) → uploaded to YouTube as PRIVATE → the owner watches and approves → scheduled publication.
-- Nothing becomes public without approval.

create table public.calm_settings (
  product_id uuid primary key,
  workspace_id uuid not null,
  enabled boolean not null default false,
  publish_days integer[] not null default array[2, 5],      -- ISO weekdays (1 = Monday): Tuesday and Friday
  publish_hour_utc integer not null default 16 check (publish_hour_utc between 0 and 23),
  minutes integer not null default 10 check (minutes between 3 and 30),
  voice text not null default 'sage',
  language text not null default 'en',
  topics text[] not null default array[
    'when panic rises out of nowhere', 'a panic attack at night', 'before a trip on the train or plane',
    'when your heart is racing', 'after a hard day', 'fear of the next panic attack', 'feeling unreal and far away',
    'a gentle morning reset', 'calm before sleep', 'when you feel alone with it'],
  themes text[] not null default array['river', 'forest', 'clouds', 'rain', 'ocean', 'snow', 'lake', 'meadow'],
  renderer_token_hash text,           -- sha256 of the token the GitHub renderer uses; the token itself is shown once
  renderer_seen_at timestamptz,
  last_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create table public.calm_videos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  topic text not null,
  theme text not null,
  title text not null,
  description text not null,
  tags text[] not null default '{}',
  lines jsonb not null,               -- [{ text, pause }] spoken in order
  audio_keys text[] not null default '{}',
  clips jsonb not null default '[]',  -- [{ url, author, source_url }] from Pexels
  status text not null default 'scripted' check (status in (
    'scripted', 'ready_to_render', 'rendering', 'review', 'approved', 'scheduled', 'published', 'rejected', 'failed')),
  error text,
  agent_run_id uuid,
  youtube_video_id text,
  publish_at timestamptz,
  render_started_at timestamptz,
  rendered_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  is_mock boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (id, product_id)
);
create index calm_videos_status on public.calm_videos (status, created_at);

select public.setup_table('public.calm_settings', true, 'renderer_token_hash');
select public.setup_table('public.calm_videos');
revoke all on public.calm_settings, public.calm_videos from anon;
revoke truncate on public.calm_settings, public.calm_videos from authenticated;
