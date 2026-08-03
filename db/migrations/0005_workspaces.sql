-- Multi-tenant workspaces.
--
-- Every piece of tenant data — brain docs, skills, connectors and their
-- credentials, sessions, tool calls, and the audit trail — is tagged with a
-- workspace_id and gated by row-level security keyed on membership. A member of
-- one workspace cannot read another's rows even if application code asks for
-- them, because Postgres refuses to return them.
--
-- Run after 0004_mcp_oauth.sql.

-- --- Core tenancy tables ---------------------------------------------------

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- owner: full control incl. deleting the workspace.
  -- admin: manage members, approve content.
  -- member: use content, propose changes that admins approve.
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx on workspace_members (user_id);

create table if not exists workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  -- Only the hash is stored; the raw token exists solely in the invite link.
  token_hash text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_invites_workspace_idx on workspace_invites (workspace_id);

-- --- Membership helpers used by every policy -------------------------------
-- SECURITY DEFINER so a policy on workspace_members can call them without
-- recursing into its own RLS check.

create or replace function is_workspace_member(ws uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = ws and user_id = auth.uid()
  );
$$ language sql security definer stable set search_path = public;

create or replace function is_workspace_admin(ws uuid)
returns boolean as $$
  select exists (
    select 1 from workspace_members
     where workspace_id = ws
       and user_id = auth.uid()
       and role in ('owner', 'admin')
  );
$$ language sql security definer stable set search_path = public;

revoke all on function public.is_workspace_member(uuid) from public, anon;
revoke all on function public.is_workspace_admin(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_admin(uuid) to authenticated, service_role;

-- --- Tag tenant data with its workspace ------------------------------------

alter table brain_folders    add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table brain_docs       add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table skills           add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table connectors       add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table sessions         add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table tool_calls       add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table audit_log        add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table mcp_oauth_codes  add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table mcp_oauth_tokens add column if not exists workspace_id uuid references workspaces(id) on delete cascade;

-- --- Backfill: existing rows become a personal workspace -------------------

insert into workspaces (name, slug)
values ('Personal', 'personal')
on conflict (slug) do nothing;

do $$
declare
  v_personal uuid;
begin
  select id into v_personal from workspaces where slug = 'personal';

  update brain_folders    set workspace_id = v_personal where workspace_id is null;
  update brain_docs       set workspace_id = v_personal where workspace_id is null;
  update skills           set workspace_id = v_personal where workspace_id is null;
  update connectors       set workspace_id = v_personal where workspace_id is null;
  update sessions         set workspace_id = v_personal where workspace_id is null;
  update tool_calls       set workspace_id = v_personal where workspace_id is null;
  update audit_log        set workspace_id = v_personal where workspace_id is null;
  update mcp_oauth_codes  set workspace_id = v_personal where workspace_id is null;
  update mcp_oauth_tokens set workspace_id = v_personal where workspace_id is null;
end $$;

alter table brain_folders    alter column workspace_id set not null;
alter table brain_docs       alter column workspace_id set not null;
alter table skills           alter column workspace_id set not null;
alter table connectors       alter column workspace_id set not null;
alter table audit_log        alter column workspace_id set not null;

-- Slugs and provider identities are unique per workspace, not globally: two
-- workspaces may each have a 'github' connector or an 'onboarding' skill.
alter table connectors drop constraint if exists connectors_provider_key;
alter table skills     drop constraint if exists skills_slug_key;
alter table brain_docs drop constraint if exists brain_docs_slug_key;
alter table brain_folders drop constraint if exists brain_folders_path_key;

create unique index if not exists connectors_workspace_provider_idx on connectors (workspace_id, provider);
create unique index if not exists skills_workspace_slug_idx         on skills (workspace_id, slug);
create unique index if not exists brain_docs_workspace_slug_idx     on brain_docs (workspace_id, slug);
create unique index if not exists brain_folders_workspace_path_idx  on brain_folders (workspace_id, path);

create index if not exists brain_docs_workspace_idx  on brain_docs (workspace_id);
create index if not exists skills_workspace_idx      on skills (workspace_id);
create index if not exists tool_calls_workspace_idx  on tool_calls (workspace_id);
create index if not exists audit_log_workspace_idx   on audit_log (workspace_id, seq);

-- --- Per-workspace audit chain ---------------------------------------------
-- One chain per workspace: verifying a tenant's trail must not require reading
-- any other tenant's rows.

drop function if exists append_audit_event(text, text);
create or replace function append_audit_event(
  p_workspace_id uuid,
  p_event_type text,
  p_payload_json text
)
returns table (seq bigint, hash text) as $$
declare
  v_prev_hash text;
  v_created_at timestamptz := clock_timestamp();
  v_hash text;
  v_seq bigint;
begin
  -- Lock per workspace so concurrent writers in different tenants don't serialize
  -- against each other, while a single chain still can't fork.
  perform pg_advisory_xact_lock(hashtext('audit_log_chain_' || p_workspace_id::text));

  select audit_log.hash into v_prev_hash
    from audit_log
   where audit_log.workspace_id = p_workspace_id
   order by audit_log.seq desc
   limit 1;

  if v_prev_hash is null then
    v_prev_hash := repeat('0', 64);
  end if;

  v_hash := encode(
    digest(v_prev_hash || '|' || p_event_type || '|' || p_payload_json || '|' || v_created_at::text, 'sha256'),
    'hex'
  );

  insert into audit_log (workspace_id, event_type, payload, payload_text, prev_hash, hash, created_at)
  values (p_workspace_id, p_event_type, p_payload_json::jsonb, p_payload_json, v_prev_hash, v_hash, v_created_at)
  returning audit_log.seq, audit_log.hash into v_seq, v_hash;

  return query select v_seq, v_hash;
end;
$$ language plpgsql security definer set search_path = public;

drop function if exists verify_audit_chain();
create or replace function verify_audit_chain(p_workspace_id uuid)
returns table (verified boolean, broken_at_seq bigint, total_rows bigint) as $$
declare
  v_prev_hash text := repeat('0', 64);
  v_expected_hash text;
  rec record;
  v_broken bigint := null;
  v_count bigint := 0;
begin
  for rec in
    select seq, event_type, payload_text, created_at, prev_hash, hash
      from audit_log
     where workspace_id = p_workspace_id
     order by seq asc
  loop
    v_count := v_count + 1;
    if rec.prev_hash <> v_prev_hash then
      v_broken := rec.seq;
      exit;
    end if;
    v_expected_hash := encode(
      digest(v_prev_hash || '|' || rec.event_type || '|' || rec.payload_text || '|' || rec.created_at::text, 'sha256'),
      'hex'
    );
    if v_expected_hash <> rec.hash then
      v_broken := rec.seq;
      exit;
    end if;
    v_prev_hash := rec.hash;
  end loop;

  return query select (v_broken is null), v_broken, v_count;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.append_audit_event(uuid, text, text) from public, anon, authenticated;
revoke all on function public.verify_audit_chain(uuid) from public, anon, authenticated;
grant execute on function public.append_audit_event(uuid, text, text) to service_role;
grant execute on function public.verify_audit_chain(uuid) to service_role;

-- Skill slugs are only unique within a workspace now, so the usage counter must
-- be keyed on both — otherwise one workspace's tool call would bump the counter
-- on every same-named skill in every other workspace.
drop function if exists increment_skill_usage(text);
create or replace function increment_skill_usage(p_workspace_id uuid, p_slug text)
returns void as $$
begin
  update skills
     set usage_count = usage_count + 1,
         last_used_at = now()
   where workspace_id = p_workspace_id and slug = p_slug;
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.increment_skill_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_skill_usage(uuid, text) to service_role;

-- --- Row-level security -----------------------------------------------------
-- Replaces the single-user "any authenticated session" policies from 0001/0002
-- with membership-scoped ones.

alter table workspaces        enable row level security;
alter table workspace_members enable row level security;
alter table workspace_invites enable row level security;

-- Replaces the single-user "any authenticated session" policies from 0001/0002.
drop policy if exists "authenticated full access" on skills;
drop policy if exists "authenticated full access" on connectors;
drop policy if exists "authenticated full access" on oauth_tokens;
drop policy if exists "authenticated full access" on sessions;
drop policy if exists "authenticated full access" on tool_calls;
drop policy if exists "authenticated full access" on audit_log;
drop policy if exists "authenticated full access" on brain_docs;
drop policy if exists "authenticated full access" on brain_folders;

drop policy if exists "members read workspace" on workspaces;
create policy "members read workspace" on workspaces
  for select using (is_workspace_member(id));
drop policy if exists "admins update workspace" on workspaces;
create policy "admins update workspace" on workspaces
  for update using (is_workspace_admin(id)) with check (is_workspace_admin(id));

drop policy if exists "members read membership" on workspace_members;
create policy "members read membership" on workspace_members
  for select using (is_workspace_member(workspace_id));
drop policy if exists "admins manage membership" on workspace_members;
create policy "admins manage membership" on workspace_members
  for all using (is_workspace_admin(workspace_id)) with check (is_workspace_admin(workspace_id));

drop policy if exists "admins manage invites" on workspace_invites;
create policy "admins manage invites" on workspace_invites
  for all using (is_workspace_admin(workspace_id)) with check (is_workspace_admin(workspace_id));

drop policy if exists "workspace scoped" on skills;
create policy "workspace scoped" on skills
  for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists "workspace scoped" on connectors;
create policy "workspace scoped" on connectors
  for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists "workspace scoped" on sessions;
create policy "workspace scoped" on sessions
  for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists "workspace scoped" on tool_calls;
create policy "workspace scoped" on tool_calls
  for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists "workspace scoped" on audit_log;
create policy "workspace scoped" on audit_log
  for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists "workspace scoped" on brain_docs;
create policy "workspace scoped" on brain_docs
  for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
drop policy if exists "workspace scoped" on brain_folders;
create policy "workspace scoped" on brain_folders
  for all using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

-- Connector credentials inherit their connector's workspace.
drop policy if exists "workspace scoped" on oauth_tokens;
create policy "workspace scoped" on oauth_tokens
  for all using (
    exists (
      select 1 from connectors c
       where c.id = oauth_tokens.connector_id and is_workspace_member(c.workspace_id)
    )
  )
  with check (
    exists (
      select 1 from connectors c
       where c.id = oauth_tokens.connector_id and is_workspace_member(c.workspace_id)
    )
  );

-- --- Seed the client workspaces --------------------------------------------

insert into workspaces (name, slug) values
  ('Evans Plumbing', 'evans-plumbing'),
  ('Snyder Green', 'snyder-green'),
  ('Sorenson Capital', 'sorenson-capital')
on conflict (slug) do nothing;

-- Every workspace gets its own connector rows, so each client connects its own
-- accounts and credentials never cross tenants.
insert into connectors (workspace_id, provider, display_name, scopes)
select w.id, c.provider, c.display_name, c.scopes
  from workspaces w
 cross join (values
    ('github', 'GitHub', '{repo,read:org,read:user}'::text[]),
    ('linear', 'Linear', '{read,write}'::text[]),
    ('google_calendar', 'Google Calendar', '{https://www.googleapis.com/auth/calendar}'::text[]),
    ('gmail', 'Gmail', '{https://www.googleapis.com/auth/gmail.readonly}'::text[]),
    ('notion', 'Notion', '{}'::text[]),
    ('slack', 'Slack', '{channels:read,chat:write,users:read}'::text[]),
    ('discord', 'Discord', '{identify,guilds}'::text[])
  ) as c(provider, display_name, scopes)
 where not exists (
   select 1 from connectors existing
    where existing.workspace_id = w.id and existing.provider = c.provider
 );

-- Make the existing single user an owner of every workspace. Safe to re-run.
insert into workspace_members (workspace_id, user_id, role)
select w.id, u.id, 'owner'
  from workspaces w
 cross join auth.users u
 where u.email = 'sam.moessing@gmail.com'
on conflict (workspace_id, user_id) do nothing;
