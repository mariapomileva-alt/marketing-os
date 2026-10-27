-- 0029 Content desk: every morning, research (web + our own data) turns into ready Instagram posts and carousels
-- (rendered in Back's look) and article ideas for the website. Each waits for the owner's approval; approved posts
-- go on the calendar and are published at their time, approved article ideas become planned articles.
create table public.content_desk_settings (
  product_id uuid primary key,
  workspace_id uuid not null,
  enabled boolean not null default true,
  posts_per_day integer not null default 1 check (posts_per_day between 0 and 3),
  carousels_per_day integer not null default 1 check (carousels_per_day between 0 and 3),
  articles_per_week integer not null default 2 check (articles_per_week between 0 and 7),
  post_time text not null default '18:30' check (post_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),      -- Riga time
  carousel_time text not null default '12:30' check (carousel_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  web_research boolean not null default true,
  last_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create table public.content_desk_items (
  content_item_id uuid primary key references public.content_items (id) on delete cascade,
  workspace_id uuid not null,
  product_id uuid not null,
  kind text not null check (kind in ('post', 'carousel', 'article')),
  topic text not null default '',
  insight text not null default '',
  why_now text not null default '',
  sources jsonb not null default '[]'::jsonb,     -- [{title, url}]
  hooks jsonb not null default '[]'::jsonb,       -- [{text, mechanism}]
  chosen_hook integer not null default 0,
  image_asset_ids uuid[] not null default '{}',
  rendered_version_id uuid,                       -- the content version the images were drawn from
  render_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index content_desk_items_product on public.content_desk_items (product_id, created_at desc);

select public.setup_table('public.content_desk_settings');
select public.setup_table('public.content_desk_items');
revoke all on public.content_desk_settings, public.content_desk_items from anon;
