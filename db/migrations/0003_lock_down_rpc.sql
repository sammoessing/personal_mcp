-- Lock down the SECURITY DEFINER functions.
--
-- Supabase exposes every function in `public` over PostgREST, so
-- append_audit_event / verify_audit_chain / increment_skill_usage were
-- callable by the `anon` role using only the public anon key. For
-- append_audit_event that is a real hole: anyone could forge entries into the
-- hash chain, which is exactly what the chain is supposed to make impossible.
--
-- All three are only ever invoked from server-side code using the service-role
-- key (see lib/audit/hash-chain.ts and lib/mcp/tools/skills.ts), and
-- service_role bypasses these grants — so revoking from anon and authenticated
-- costs the app nothing.
--
-- Run after 0002_brain.sql.

revoke all on function public.append_audit_event(text, text) from public, anon, authenticated;
revoke all on function public.verify_audit_chain() from public, anon, authenticated;
revoke all on function public.increment_skill_usage(text) from public, anon, authenticated;

grant execute on function public.append_audit_event(text, text) to service_role;
grant execute on function public.verify_audit_chain() to service_role;
grant execute on function public.increment_skill_usage(text) to service_role;
