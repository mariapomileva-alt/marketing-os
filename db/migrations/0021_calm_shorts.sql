-- Vertical Shorts/Reels cut from a calm video's script (same voice, footage and music), each about 30-60 seconds.
-- The owner picks which to make and where (YouTube Shorts, Instagram Reels; TikTok by download), and approves each.
create table public.calm_shorts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  video_id uuid not null,
  idx integer not null,
  line_from integer not null,
  line_to integer not null,                 -- inclusive
  title text not null,
  targets text[] not null default '{}' check (targets <@ array['youtube', 'instagram']),
  status text not null default 'planned' check (status in ('planned', 'ready_to_render', 'rendering', 'review', 'scheduled', 'published', 'rejected', 'failed')),
  error text,
  youtube_video_id text,
  instagram_container_id text,
  instagram_media_id text,
  instagram_status text check (instagram_status in ('queued', 'processing', 'published', 'failed')),
  preview_asset_id uuid,
  publish_at timestamptz,
  render_started_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  foreign key (video_id, product_id) references public.calm_videos (id, product_id) on delete cascade,
  unique (video_id, idx)
);
select public.setup_table('public.calm_shorts');
revoke all on public.calm_shorts from anon;
revoke truncate on public.calm_shorts from authenticated;
