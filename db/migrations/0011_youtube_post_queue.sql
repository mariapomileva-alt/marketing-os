-- Approved YouTube comments go out one by one from a queue (every few minutes, within the posting limits).
-- The scheduler records when it last looked, so the admin can show whether automatic posting is running.
alter table public.yt_settings add column last_queue_check_at timestamptz;
