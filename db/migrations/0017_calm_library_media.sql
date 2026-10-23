-- Calm videos can use the product's own Creative Library: clips/images tagged calm (or the nature theme) and music.
alter table public.calm_videos add column music_asset_id uuid;
