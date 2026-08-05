-- =====================================================================
--  0012 — remote MCP server connections
--
--  The seven built-in connectors talk to providers' REST APIs, which
--  means registering an OAuth app per provider before anything works.
--  Remote MCP servers avoid that entirely: the MCP auth spec mandates
--  Dynamic Client Registration (RFC 7591), so this app registers itself
--  with the server at connect time and is issued a client_id on the
--  spot. That is why "Connect" can be one button with no developer
--  console — the same mechanism by which claude.ai connects to *this*
--  app's MCP endpoint (see app/api/oauth/register).
--
--  Three tables:
--    mcp_servers      the remote server, plus the client credentials it
--                     issued us during registration
--    mcp_connections  an access token, either shared by the workspace or
--                     private to one member (same split as connectors)
--    mcp_auth_states  in-flight PKCE verifiers, short-lived
--
--  Run after 0011_doc_images.sql.
-- =====================================================================

create table if not exists mcp_servers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  url text not null,
  -- 'member': each person connects their own account, as with Gmail.
  -- 'workspace': one shared connection everyone uses, as with Slack.
  scope text not null default 'member' check (scope in ('member', 'workspace')),

  -- Filled in by discovery + dynamic registration, cached so the dance
  -- happens once per server rather than once per person.
  authorization_server text,
  registration_endpoint text,
  authorize_endpoint text,
  token_endpoint text,
  client_id text,
  client_secret_enc text,
  scopes_supported text,
  last_error text,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mcp_servers_workspace_url_idx
  on mcp_servers (workspace_id, url);

create table if not exists mcp_connections (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references mcp_servers(id) on delete cascade,
  -- null for a workspace-wide connection; set for a per-member one.
  user_id uuid references auth.users(id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  granted_scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mcp_connections_shared_idx
  on mcp_connections (server_id) where user_id is null;

create unique index if not exists mcp_connections_member_idx
  on mcp_connections (server_id, user_id) where user_id is not null;

create table if not exists mcp_auth_states (
  state text primary key,
  server_id uuid not null references mcp_servers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists mcp_auth_states_expires_idx on mcp_auth_states (expires_at);

-- --- RLS -------------------------------------------------------------------
-- Every read in the app goes through the service-role client, so these are
-- defence in depth; the scoping that actually matters is applied in
-- lib/mcp-client/store.ts. Tokens are never exposed to the browser at all.

alter table mcp_servers enable row level security;
alter table mcp_connections enable row level security;
alter table mcp_auth_states enable row level security;

drop policy if exists "workspace scoped" on mcp_servers;
create policy "workspace scoped" on mcp_servers
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- A member-scoped connection is visible only to its owner, matching how
-- per-person connectors behave.
drop policy if exists "workspace scoped" on mcp_connections;
create policy "workspace scoped" on mcp_connections
  for all using (
    exists (
      select 1 from mcp_servers s
       where s.id = mcp_connections.server_id
         and is_workspace_member(s.workspace_id)
    )
    and (user_id is null or user_id = auth.uid())
  )
  with check (
    exists (
      select 1 from mcp_servers s
       where s.id = mcp_connections.server_id
         and is_workspace_member(s.workspace_id)
    )
    and (user_id is null or user_id = auth.uid())
  );

-- In-flight authorization state belongs to one person mid-flow and to nobody
-- else; no policy is added, so only the service role can touch it.
