-- 0035 Spaces and people. A person can belong to several workspaces ("spaces"), e.g. Back and Momentro, and the owner
-- invites a colleague by email into one space only. Invited people are editors: they make, edit and approve content,
-- but keys, tokens and account connections stay with the owners (enforced here for keys and connections, and in
-- the app for every connect/disconnect action).

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by uuid references public.users (id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workspace_invites_open on public.workspace_invites (workspace_id, email) where revoked_at is null;
select public.setup_table('public.workspace_invites');

create or replace function public.is_workspace_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid() and m.role = 'owner');
$$;

-- Only owners invite people.
drop policy member_insert on public.workspace_invites;
drop policy member_update on public.workspace_invites;
drop policy member_delete on public.workspace_invites;
create policy owner_insert on public.workspace_invites for insert to authenticated with check (public.is_workspace_owner(workspace_id));
create policy owner_update on public.workspace_invites for update to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));
create policy owner_delete on public.workspace_invites for delete to authenticated using (public.is_workspace_owner(workspace_id));

-- Owners manage members (remove a person); members can see who is in the space.
grant delete on public.workspace_members to authenticated;
create policy owner_delete on public.workspace_members for delete to authenticated using (public.is_workspace_owner(workspace_id) and user_id <> auth.uid());

-- Keys and tokens: only owners read or write them (the server reads them with the service role to publish).
drop policy member_select on public.secrets;
drop policy member_insert on public.secrets;
drop policy member_update on public.secrets;
drop policy member_delete on public.secrets;
create policy owner_all on public.secrets for all to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));

drop policy member_insert on public.ai_provider_connections;
drop policy member_update on public.ai_provider_connections;
drop policy member_delete on public.ai_provider_connections;
create policy owner_insert on public.ai_provider_connections for insert to authenticated with check (public.is_workspace_owner(workspace_id));
create policy owner_update on public.ai_provider_connections for update to authenticated using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));
create policy owner_delete on public.ai_provider_connections for delete to authenticated using (public.is_workspace_owner(workspace_id));

-- Connecting or removing an account is the owner's; status updates while publishing stay open to members.
drop policy member_insert on public.channel_connections;
drop policy member_delete on public.channel_connections;
create policy owner_insert on public.channel_connections for insert to authenticated with check (public.is_workspace_owner(workspace_id));
create policy owner_delete on public.channel_connections for delete to authenticated using (public.is_workspace_owner(workspace_id));

-- A new space: the creator becomes its owner.
create or replace function public.create_space(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.workspace_members where user_id = auth.uid() and role = 'owner') then raise exception 'only an owner can create a space'; end if;
  insert into public.workspaces (name) values (left(trim(p_name), 80)) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  return ws;
end $$;
revoke all on function public.create_space(text) from public;
grant execute on function public.create_space(text) to authenticated;

-- On sign-in: open invites for this email become memberships.
create or replace function public.accept_invites(p_user_id uuid, p_email text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  for r in select id, workspace_id, role from public.workspace_invites
            where email = lower(trim(p_email)) and revoked_at is null and accepted_at is null loop
    insert into public.users (id, email) values (p_user_id, lower(trim(p_email))) on conflict (id) do nothing;
    insert into public.workspace_members (workspace_id, user_id, role) values (r.workspace_id, p_user_id, r.role) on conflict do nothing;
    update public.workspace_invites set accepted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.accept_invites(uuid, text) from public;
grant execute on function public.accept_invites(uuid, text) to service_role;
