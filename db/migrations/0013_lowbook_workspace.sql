-- =====================================================================
--  0013 — Lowbook / PAC auto finance workspace
--
--  A fifth tenant, isolated from the others exactly as they are from each
--  other: its own brain, skills, connectors, MCP servers, and audit chain.
--
--  Only the four workspace-scoped connectors are seeded. Gmail, Calendar
--  and Discord are per-member since 0008, so their rows are created when
--  a specific person connects one — a shared placeholder can never be
--  claimed under the partial unique indexes.
--
--  Run after 0012_mcp_connections.sql. Safe to re-run.
-- =====================================================================

insert into workspaces (name, slug, description)
values (
  'Lowbook / PAC Auto Finance',
  'lowbook-pac',
  'Auto finance operations — lead sourcing, underwriting, and dealer comms.'
)
on conflict (slug) do nothing;

insert into connectors (workspace_id, provider, display_name, scopes)
select w.id, c.provider, c.display_name, c.scopes
  from workspaces w
 cross join (values
    ('github', 'GitHub', '{repo,read:org,read:user}'::text[]),
    ('linear', 'Linear', '{read,write}'::text[]),
    ('notion', 'Notion', '{}'::text[]),
    ('slack', 'Slack', '{channels:read,chat:write,users:read}'::text[])
  ) as c(provider, display_name, scopes)
 where w.slug = 'lowbook-pac'
   and not exists (
     select 1 from connectors existing
      where existing.workspace_id = w.id
        and existing.provider = c.provider
        and existing.user_id is null
   );

insert into workspace_members (workspace_id, user_id, role)
select w.id, u.id, 'owner'
  from workspaces w
 cross join auth.users u
 where w.slug = 'lowbook-pac'
   and u.email = 'sam.moessing@gmail.com'
on conflict (workspace_id, user_id) do nothing;
