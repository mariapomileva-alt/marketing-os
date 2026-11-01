-- Explainer Reels from the content desk also go out as YouTube Shorts, at the same time as on Instagram.
alter table public.content_desk_items
  add column if not exists youtube_status text check (youtube_status in ('queued', 'uploaded', 'failed', 'skipped')),
  add column if not exists youtube_video_id text,
  add column if not exists youtube_error text;
