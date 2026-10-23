-- Articles from the product's own blog/guides, read from the site's sitemap. Each becomes a knowledge source and
-- seeds an idea with drafted Threads posts (drafts only, approval as usual) and a calm video topic.
create table public.blog_articles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  product_id uuid not null,
  url text not null,
  title text not null default '',
  lastmod text,
  source_id uuid,
  idea_id uuid,
  status text not null default 'new' check (status in ('new', 'ingested', 'drafted', 'failed', 'skipped')),
  error text,
  found_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade,
  unique (product_id, url)
);
select public.setup_table('public.blog_articles');
revoke all on public.blog_articles from anon;
revoke truncate on public.blog_articles from authenticated;
