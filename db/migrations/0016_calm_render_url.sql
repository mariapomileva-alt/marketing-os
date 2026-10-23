-- Where the rendered file can be downloaded (the GitHub Actions run with the video as an artifact), for uploading by
-- hand while YouTube keeps API uploads of unaudited projects private.
alter table public.calm_videos add column render_url text;
