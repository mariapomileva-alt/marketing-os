-- 0023 The first page of each visit (the landing page), so articles can be measured by the visits they bring in.
alter table public.site_events add column landing_path text;
create index site_events_landing on public.site_events (product_id, landing_path, occurred_at desc);
