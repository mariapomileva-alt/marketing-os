-- 0007 The same file may be evidence for two products; deduplicate per product (and once for workspace methodology).
alter table public.knowledge_sources drop constraint knowledge_sources_workspace_id_sha256_key;
alter table public.knowledge_sources add constraint knowledge_sources_scope_sha256_key unique nulls not distinct (workspace_id, product_id, sha256);
