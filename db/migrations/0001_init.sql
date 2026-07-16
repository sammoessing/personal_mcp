-- Manifest / personal_mcp initial schema.
-- Run against the Supabase project's Postgres database (SQL editor or `supabase db push`).

create extension if not exists "pgcrypto";

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  version text not null default '0.1.0',
  status text not null default 'draft' check (status in ('draft', 'review', 'approved', 'published')),
  mcp_exposed boolean not null default false,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists connectors (
  id uuid primary key default gen_random_uuid(),
  provider text not null unique check (provider in ('github', 'linear', 'google_calendar', 'gmail', 'notion', 'slack', 'discord')),
  display_name text not null,
  status text not null default 'disconnected' check (status in ('connected', 'disconnected', 'error')),
  scopes text[] not null default '{}',
  account_label text,
  connected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists oauth_tokens (
  connector_id uuid primary key references connectors(id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_version text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('live', 'idle', 'closed'))
);

create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  tool_name text not null,
  connector_id uuid references connectors(id) on delete set null,
  session_id uuid references sessions(id) on delete set null,
  status text not null check (status in ('success', 'error')),
  latency_ms integer,
  error_message text,
  called_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  event_type text not null,
  payload jsonb not null default '{}',
  -- Exact JSON text that was hashed. jsonb does not guarantee stable
  -- key order/formatting on round-trip, so verification re-hashes this
  -- raw text rather than payload::text, keeping the chain reproducible.
  payload_text text not null,
  prev_hash text not null,
  hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists tool_calls_called_at_idx on tool_calls (called_at desc);
create index if not exists tool_calls_tool_name_idx on tool_calls (tool_name);
create index if not exists audit_log_seq_idx on audit_log (seq);
create index if not exists skills_status_idx on skills (status);

-- Single-user app: RLS just requires an authenticated Supabase session.
-- The allowed email itself is enforced in application middleware (ALLOWED_EMAIL env var),
-- not in SQL, so it can be changed without a migration.
alter table skills enable row level security;
alter table connectors enable row level security;
alter table oauth_tokens enable row level security;
alter table sessions enable row level security;
alter table tool_calls enable row level security;
alter table audit_log enable row level security;

create policy "authenticated full access" on skills for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on connectors for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on oauth_tokens for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on sessions for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on tool_calls for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on audit_log for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Atomically appends a hash-chained audit_log row. p_payload_json must be the
-- exact JSON.stringify() text of the payload the caller wants hashed — it is
-- stored verbatim in payload_text and parsed into payload for querying/display.
-- The advisory lock serializes concurrent callers so the chain never forks.
create or replace function append_audit_event(p_event_type text, p_payload_json text)
returns table (seq bigint, hash text) as $$
declare
  v_prev_hash text;
  v_created_at timestamptz := clock_timestamp();
  v_hash text;
  v_seq bigint;
begin
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));

  select audit_log.hash into v_prev_hash from audit_log order by audit_log.seq desc limit 1;
  if v_prev_hash is null then
    v_prev_hash := repeat('0', 64);
  end if;

  v_hash := encode(
    digest(v_prev_hash || '|' || p_event_type || '|' || p_payload_json || '|' || v_created_at::text, 'sha256'),
    'hex'
  );

  insert into audit_log (event_type, payload, payload_text, prev_hash, hash, created_at)
  values (p_event_type, p_payload_json::jsonb, p_payload_json, v_prev_hash, v_hash, v_created_at)
  returning audit_log.seq, audit_log.hash into v_seq, v_hash;

  return query select v_seq, v_hash;
end;
$$ language plpgsql security definer set search_path = public;

-- Recomputes every row's hash from payload_text + prev_hash and reports the
-- first seq where the chain breaks (tampering, manual edits, etc), if any.
create or replace function verify_audit_chain()
returns table (verified boolean, broken_at_seq bigint, total_rows bigint) as $$
declare
  v_prev_hash text := repeat('0', 64);
  v_expected_hash text;
  rec record;
  v_broken bigint := null;
  v_count bigint := 0;
begin
  for rec in select seq, event_type, payload_text, created_at, prev_hash, hash from audit_log order by seq asc loop
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

-- Seed the 7 known connectors so the Connections page always has a row to render/configure.
insert into connectors (provider, display_name, scopes) values
  ('github', 'GitHub', '{repo,read:org,read:user}'),
  ('linear', 'Linear', '{read,write}'),
  ('google_calendar', 'Google Calendar', '{https://www.googleapis.com/auth/calendar}'),
  ('gmail', 'Gmail', '{https://www.googleapis.com/auth/gmail.readonly}'),
  ('notion', 'Notion', '{}'),
  ('slack', 'Slack', '{channels:read,chat:write,users:read}'),
  ('discord', 'Discord', '{identify,guilds}')
on conflict (provider) do nothing;
