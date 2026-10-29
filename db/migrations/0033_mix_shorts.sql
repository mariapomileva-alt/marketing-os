-- 0033 Mixed shorts: approved shorts are spread so that the same look (shorts cut from one long calm video, or the
-- owner's own face videos) does not go out several times in a row. The owner can switch the automatic mixing off.
alter table public.calm_settings add column mix_shorts boolean not null default true;
