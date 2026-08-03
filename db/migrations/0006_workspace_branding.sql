-- Per-workspace branding.
--
-- Each workspace can carry its own logo and description so a client connector
-- presents as that company rather than as a generic shared server. The MCP
-- protocol carries these in the server's `serverInfo` (name, title, icons), and
-- the consent screen renders them directly.
--
-- Run after 0005_workspaces.sql.

alter table workspaces add column if not exists logo_url text;
alter table workspaces add column if not exists description text;
