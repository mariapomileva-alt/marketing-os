-- 0034 Each product has its own marketing brief (who we are, who reads us, what we never say, how cards and Reels end,
-- brand colours). Prompts are written once with placeholders and filled from the brief of the product they work for.
-- Empty means "built from the product's basic facts"; Back gets its brief from the app's defaults.
alter table public.products add column marketing_brief jsonb not null default '{}'::jsonb;
