-- YouTube allows about six uploads a day per project (each upload uses 1600 of 10,000 quota units), and new daily
-- videos need most of them. New music for videos already scheduled may re-upload to YouTube only a few times a day;
-- beyond that a short gets the new sound for Instagram and TikTok only, and keeps its YouTube version.
alter table public.calm_settings
  add column if not exists remix_youtube_per_day int not null default 1 check (remix_youtube_per_day between 0 and 6),
  add column if not exists remix_youtube_day date,
  add column if not exists remix_youtube_used int not null default 0;

alter table public.calm_shorts add column if not exists remix_skip_youtube boolean not null default false;
alter table public.calm_videos add column if not exists remix_skip_youtube boolean not null default false;
