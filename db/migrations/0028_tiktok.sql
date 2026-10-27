-- 0028 TikTok as a destination for calm shorts.
-- Until TikTok audits the app, videos go to the account's TikTok inbox as drafts (the owner finishes the post in the
-- TikTok app); after the audit, Direct Post with the privacy and interaction choices the owner made at approval.
alter table public.calm_shorts drop constraint if exists calm_shorts_targets_check;
alter table public.calm_shorts add constraint calm_shorts_targets_check check (targets <@ array['youtube', 'instagram', 'tiktok']);
alter table public.calm_settings drop constraint if exists calm_settings_auto_shorts_targets_check;
alter table public.calm_settings add constraint calm_settings_auto_shorts_targets_check check (auto_shorts_targets <@ array['youtube', 'instagram', 'tiktok']);

alter table public.calm_shorts
  add column tiktok_status text check (tiktok_status in ('queued', 'processing', 'sent_to_inbox', 'published', 'failed')),
  add column tiktok_caption text check (tiktok_caption is null or length(tiktok_caption) <= 2200),
  -- {mode: 'inbox'|'direct', privacy_level, disable_comment, disable_duet, disable_stitch, brand_organic, is_aigc}
  add column tiktok_options jsonb,
  add column tiktok_publish_id text,
  add column tiktok_post_id text,
  add column tiktok_error text;
