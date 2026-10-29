-- 0032 App Store Connect, read-only: downloads by day, source, referrer and campaign token (ct=) from Apple's Analytics
-- Reports API. The API key (Issuer ID, Key ID, .p8) is stored encrypted in secrets and referenced from the connection;
-- the connection row is channel 'app_store'. Rows are replaced per report instance, so Apple's late corrections are
-- taken over instead of being counted twice.
create table public.app_store_sync (
  product_id uuid primary key,
  workspace_id uuid not null,
  app_apple_id text not null,
  app_name text,
  request_id text,
  report_name text,
  last_synced_at timestamptz,
  last_data_date date,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create table public.app_store_instances (
  instance_id text primary key,
  workspace_id uuid not null,
  product_id uuid not null,
  processing_date date not null,
  segments integer not null default 0,
  rows integer not null default 0,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create table public.app_store_downloads (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  product_id uuid not null,
  instance_id text not null references public.app_store_instances (instance_id) on delete cascade,
  day date not null,
  download_type text not null default '',
  source_type text not null default '',
  source_info text not null default '',
  campaign text not null default '',
  page_type text not null default '',
  territory text not null default '',
  device text not null default '',
  counts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);
create index app_store_downloads_product_day on public.app_store_downloads (product_id, day desc);

select public.setup_table('public.app_store_sync');
select public.setup_table('public.app_store_instances', false);
select public.setup_table('public.app_store_downloads', false);  -- report rows, not edits: not audited row by row
revoke all on public.app_store_sync, public.app_store_instances, public.app_store_downloads from anon;
