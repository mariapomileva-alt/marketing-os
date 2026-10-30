-- Daily plan: one long video a day, each cut into N pieces (default 6). Pieces are split at random into two lanes:
-- YouTube Shorts, and Instagram Reels + TikTok, so every platform gets different pieces. Each lane publishes at the
-- short slots (UTC), several a day, mixed by look.
alter table public.calm_settings
  add column if not exists shorts_per_video int not null default 6 check (shorts_per_video between 1 and 15),
  add column if not exists short_slots text[] not null default '{06:30,11:30,17:30}',
  add column if not exists pipeline int not null default 3 check (pipeline between 1 and 7);

alter table public.calm_shorts add column if not exists lane text check (lane in ('youtube', 'social'));
