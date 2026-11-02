-- New daily plan: 2 explainer Reels (also as YouTube Shorts) + 1 calm meditation on Instagram and on YouTube Shorts.
-- Each long calm video gives 4 pieces: 1 to YouTube Shorts, 3 to Instagram/TikTok (1 of them also a Reel).
alter table public.calm_settings add column if not exists youtube_per_video int not null default 1 check (youtube_per_video between 0 and 15);
alter table public.calm_settings alter column shorts_per_video set default 4;
alter table public.calm_settings alter column reels_per_video set default 1;
update public.calm_settings set shorts_per_video = 4 where shorts_per_video = 6;
update public.calm_settings set reels_per_video = 1 where reels_per_video = 2;
