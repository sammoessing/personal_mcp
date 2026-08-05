-- =====================================================================
--  0010 — descriptions on brain docs
--
--  A title says what a document is called; it rarely says when an agent
--  should reach for it. Without that, retrieval leans entirely on the
--  body text, and an imported PDF whose first page is a cover sheet
--  looks like nothing in particular.
--
--  The description is the trigger — "use this when quoting a plumbing
--  callout" — and it is what brain_docs_list and brain_docs_search show
--  the agent when it is deciding what to open.
--
--  brain_files already had a description column from 0009; this makes
--  docs match, and both are surfaced over MCP.
--
--  Run after 0009_brain_files.sql.
-- =====================================================================

alter table brain_docs add column if not exists description text;
