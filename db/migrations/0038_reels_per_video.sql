-- Of each video's Instagram+TikTok pieces, how many also go to Instagram (the rest TikTok only), so Reels from calm
-- videos leave room for the content desk's own Reels (text and breathing formats) in the day's mix.
alter table public.calm_settings add column if not exists reels_per_video int not null default 2 check (reels_per_video between 0 and 15);
