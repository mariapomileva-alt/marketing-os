-- 0031 The desk publishes on Instagram at fixed daily slots (default three a day: 09:30, 14:00, 20:00 Riga). Every
-- approved post, carousel or Reel takes the next free slot, so the feed gets a steady rhythm instead of one per kind.
-- Reels are now counted per day, and each piece keeps its craft notes (who would send it to whom and why, which
-- proven format mechanism it borrows).
alter table public.content_desk_settings
  add column slots text[] not null default array['09:30', '14:00', '20:00'],
  add column reels_per_day integer not null default 2 check (reels_per_day between 0 and 3);

update public.content_desk_settings set reels_per_day = 2, carousels_per_day = 1, posts_per_day = 0;

alter table public.content_desk_items add column craft jsonb not null default '{}'::jsonb;  -- {share_reason, borrowed_mechanism, cover}
