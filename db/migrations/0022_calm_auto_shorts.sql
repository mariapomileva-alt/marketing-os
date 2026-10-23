-- Shorts are made automatically from every rendered calm video (each still waits for approval).
alter table public.calm_settings
  add column auto_shorts boolean not null default true,
  add column auto_shorts_targets text[] not null default array['youtube'] check (auto_shorts_targets <@ array['youtube', 'instagram']);
