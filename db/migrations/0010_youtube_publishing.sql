-- 0010 YouTube publishing after approval: the comment thread id we posted, and when replies were last read.
alter table public.conversations
  add column external_thread_id text,
  add column replies_checked_at timestamptz;
create index conversations_external_thread on public.conversations (product_id, external_thread_id) where external_thread_id is not null;
create unique index conversation_messages_external on public.conversation_messages (conversation_id, external_id) where external_id is not null;
alter table public.channel_connections add column external_account_id text; -- e.g. the YouTube channel id we post as
