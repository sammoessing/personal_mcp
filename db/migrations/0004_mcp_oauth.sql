-- OAuth 2.1 authorization server for the MCP endpoint.
--
-- claude.ai's web connectors can't hold a static bearer token — they perform
-- Dynamic Client Registration (RFC 7591) against the resource server and then
-- run a normal authorization-code + PKCE flow. These tables back that.
--
-- Prefixed mcp_oauth_ to keep them distinct from `oauth_tokens`, which stores
-- OUR credentials for third-party connectors (GitHub, Slack, ...). These are
-- the reverse direction: credentials other clients use to reach us.
--
-- Codes and tokens are stored as SHA-256 hashes, never in plaintext, so a
-- database leak does not hand over live access to the MCP endpoint.
--
-- Run after 0003_lock_down_rpc.sql.

create table if not exists mcp_oauth_clients (
  client_id text primary key,
  -- Null for public clients (PKCE only), which is what claude.ai registers as.
  client_secret_hash text,
  client_name text not null default 'Unknown client',
  redirect_uris text[] not null,
  grant_types text[] not null default '{authorization_code,refresh_token}',
  token_endpoint_auth_method text not null default 'none',
  created_at timestamptz not null default now()
);

create table if not exists mcp_oauth_codes (
  code_hash text primary key,
  client_id text not null references mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),
  scope text not null default '',
  user_email text not null,
  expires_at timestamptz not null,
  -- Authorization codes are single-use; replay must be rejected.
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists mcp_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token_hash text not null unique,
  refresh_token_hash text unique,
  client_id text references mcp_oauth_clients(client_id) on delete cascade,
  user_email text not null,
  scope text not null default '',
  expires_at timestamptz not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists mcp_oauth_codes_expires_idx on mcp_oauth_codes (expires_at);
create index if not exists mcp_oauth_tokens_expires_idx on mcp_oauth_tokens (expires_at);
create index if not exists mcp_oauth_tokens_client_idx on mcp_oauth_tokens (client_id);

-- All three are written only by server-side code holding the service-role key,
-- which bypasses RLS. Enabling RLS with no policy therefore denies every
-- anon/authenticated request by default, which is exactly what we want.
alter table mcp_oauth_clients enable row level security;
alter table mcp_oauth_codes enable row level security;
alter table mcp_oauth_tokens enable row level security;

-- Housekeeping: drop expired codes and long-dead tokens.
create or replace function prune_mcp_oauth()
returns void as $$
begin
  delete from mcp_oauth_codes where expires_at < now() - interval '1 day';
  delete from mcp_oauth_tokens where revoked = true and created_at < now() - interval '30 days';
end;
$$ language plpgsql security definer set search_path = public;

revoke all on function public.prune_mcp_oauth() from public, anon, authenticated;
grant execute on function public.prune_mcp_oauth() to service_role;
