-- Our own generated music for calm videos and their Shorts (scripts/reels/ambient.py, music.py), and re-making
-- upcoming videos with it ("remix"): the new version replaces the old one at the same publish time.
alter table public.calm_settings add column if not exists own_music boolean not null default true;

alter table public.calm_videos
  add column if not exists remix text check (remix in ('queued', 'rendering')),
  add column if not exists remix_started_at timestamptz,
  add column if not exists music_version int not null default 1,
  add column if not exists replaced_youtube_ids text[] not null default '{}';

alter table public.calm_shorts
  add column if not exists remix text check (remix in ('queued', 'rendering')),
  add column if not exists remix_started_at timestamptz,
  add column if not exists music_version int not null default 1,
  add column if not exists replaced_youtube_ids text[] not null default '{}';

-- Videos not rendered yet get our own music instead of a library track.
update public.calm_videos set music_asset_id = null where status in ('scripted', 'ready_to_render', 'failed');
