-- 0025 The brief in two languages: English (written first, with web search) and Russian (translated), each with its voice.
alter table public.daily_briefs add column brief_en jsonb, add column audio_path_en text;
