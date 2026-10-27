-- 0030 Reels on the content desk: the desk also writes short Reels (intro card, 2–3 scenes from the real app with
-- captions, end card, original music). The GitHub renderer composes each from a recorded scene library; the owner
-- watches and approves; it is published as an Instagram Reel at its time.
alter table public.content_desk_items drop constraint if exists content_desk_items_kind_check;
alter table public.content_desk_items add constraint content_desk_items_kind_check check (kind in ('post', 'carousel', 'article', 'reel'));
alter table public.content_desk_items
  add column reel jsonb,                     -- {intro_style, intro_lines[], scenes:[{shot, caption}]}
  add column video_asset_id uuid,
  add column render_status text check (render_status in ('waiting', 'rendering', 'ready', 'failed')),
  add column render_started_at timestamptz,
  add column ig_container_id text;

alter table public.content_desk_settings
  add column reels_per_week integer not null default 3 check (reels_per_week between 0 and 7),
  add column reel_time text not null default '20:00' check (reel_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
