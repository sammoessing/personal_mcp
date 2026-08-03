-- =====================================================================
--  0008 — per-member connectors
--
--  Until now a connector row was unique per (workspace_id, provider), so
--  one person's Gmail served the whole workspace. That is right for
--  org-level tools (Slack, Notion, Linear, a shared GitHub org) and wrong
--  for personal ones: connecting Gmail handed every other member of the
--  workspace an agent that reads your inbox.
--
--  Connectors now come in two scopes, decided in lib/connectors/registry.ts:
--
--    workspace  → user_id is null, shared by every member (unchanged)
--    member     → user_id set, private to that person
--
--  Cross-workspace isolation is untouched: every row still carries
--  workspace_id and every policy still gates on membership. This only
--  narrows visibility *within* a workspace.
--
--  Run after 0007_fix_digest_search_path.sql.
-- =====================================================================

alter table connectors
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- One shared row per provider, or one row per member per provider — never
-- both for the same provider, since the registry fixes each provider's scope.
drop index if exists connectors_workspace_provider_idx;

create unique index if not exists connectors_workspace_shared_idx
  on connectors (workspace_id, provider)
  where user_id is null;

create unique index if not exists connectors_workspace_member_idx
  on connectors (workspace_id, user_id, provider)
  where user_id is not null;

create index if not exists connectors_user_idx on connectors (user_id);

-- 0005 seeded a shared row for every provider in every workspace, including
-- the three that are now per-member. Those placeholders can never be claimed
-- by anyone under the new indexes, so they are removed along with any
-- credentials they hold — Gmail, Calendar and Discord must be reconnected
-- once per person. Keep this list in step with scope: "member" in
-- lib/connectors/registry.ts.
delete from oauth_tokens
 where connector_id in (
   select id from connectors
    where provider in ('gmail', 'google_calendar', 'discord') and user_id is null
 );

delete from connectors
 where provider in ('gmail', 'google_calendar', 'discord') and user_id is null;

-- --- RLS -------------------------------------------------------------------
-- Membership still gates the row, and a member-scoped row is additionally
-- visible only to its owner. Note this is defence in depth rather than the
-- primary control: connector reads go through the service-role client, which
-- bypasses RLS, so lib/connectors/tokens.ts applies the same filter itself.

drop policy if exists "workspace scoped" on connectors;
create policy "workspace scoped" on connectors
  for all using (
    is_workspace_member(workspace_id)
    and (user_id is null or user_id = auth.uid())
  )
  with check (
    is_workspace_member(workspace_id)
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists "workspace scoped" on oauth_tokens;
create policy "workspace scoped" on oauth_tokens
  for all using (
    exists (
      select 1 from connectors c
       where c.id = oauth_tokens.connector_id
         and is_workspace_member(c.workspace_id)
         and (c.user_id is null or c.user_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from connectors c
       where c.id = oauth_tokens.connector_id
         and is_workspace_member(c.workspace_id)
         and (c.user_id is null or c.user_id = auth.uid())
    )
  );

-- --- MCP tokens carry the acting member ------------------------------------
-- A member-scoped connector cannot be resolved from workspace_id alone, so the
-- OAuth grant has to remember which member authorized it.

alter table mcp_oauth_codes  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table mcp_oauth_tokens add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Backfill from the email already stored on each grant, so tokens issued
-- before this migration keep working.
update mcp_oauth_codes c
   set user_id = u.id
  from auth.users u
 where c.user_id is null and lower(u.email) = lower(c.user_email);

update mcp_oauth_tokens t
   set user_id = u.id
  from auth.users u
 where t.user_id is null and lower(u.email) = lower(t.user_email);
