-- 0024 The owner's morning brief: the facts it was built from, the AI's plain-language summary and its spoken version.
create table public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  day date not null,
  facts jsonb not null,
  brief jsonb,
  audio_path text,
  language text not null default 'ru',
  is_mock boolean not null default false,
  web_search boolean not null default false,
  agent_run_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, day)
);
select public.setup_table('public.daily_briefs');
revoke all on public.daily_briefs from anon;
