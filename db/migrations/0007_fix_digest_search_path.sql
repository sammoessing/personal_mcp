-- Fix: the audit-chain functions could not find digest().
--
-- pgcrypto lives in the `extensions` schema on Supabase, not `public`. Both
-- functions were declared `set search_path = public`, so digest() resolved to
-- nothing and every append/verify raised
--   ERROR: function digest(text, unknown) does not exist
--
-- MCP tool calls hid this, because usage tracking treats audit failures as
-- best-effort, but dashboard saves call appendAuditEvent directly and surfaced
-- it as a server error on every write.
--
-- Adding `extensions` to the search path is the whole fix; the bodies are
-- unchanged from 0005.
--
-- Run after 0006_workspace_branding.sql.

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
$$ language plpgsql security definer set search_path = public, extensions;

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
$$ language plpgsql security definer set search_path = public, extensions;

revoke all on function public.append_audit_event(uuid, text, text) from public, anon, authenticated;
revoke all on function public.verify_audit_chain(uuid) from public, anon, authenticated;
grant execute on function public.append_audit_event(uuid, text, text) to service_role;
grant execute on function public.verify_audit_chain(uuid) to service_role;
