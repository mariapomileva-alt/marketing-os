-- 0027 Threads Studio: our own Threads posts written daily from our articles, knowledge and product facts,
-- each approved by the owner and then posted at the next free slot; per-post reactions for "what works".
create table public.threads_studio_settings (
  product_id uuid primary key,
  workspace_id uuid not null,
  enabled boolean not null default true,
  posts_per_day integer not null default 2 check (posts_per_day between 1 and 4),
  slots text[] not null default array['09:30', '19:30'],   -- Riga time
  language text not null default 'en',
  web_trends boolean not null default true,
  last_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create table public.threads_studio_posts (
  content_item_id uuid primary key references public.content_items (id) on delete cascade,
  workspace_id uuid not null,
  product_id uuid not null,
  format text not null,
  topic text not null default '',
  source_kind text not null default 'knowledge',
  source_title text,
  source_url text,
  why text not null default '',
  views integer,
  likes integer,
  replies integer,
  reposts integer,
  quotes integer,
  stats_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index threads_studio_posts_product on public.threads_studio_posts (product_id, created_at desc);

select public.setup_table('public.threads_studio_settings');
select public.setup_table('public.threads_studio_posts');
revoke all on public.threads_studio_settings, public.threads_studio_posts from anon;
