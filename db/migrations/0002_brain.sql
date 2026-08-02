-- Brain: the document library that backs standing context and reference knowledge.
-- Modeled on Manifest's Brain: folder-organised docs, each either "context"
-- (standing instructions merged into every agent session) or "knowledge"
-- (reference material retrieved on demand), scoped user/team/company and
-- gated by a review state.
--
-- Run after 0001_init.sql.

create table if not exists brain_folders (
  id uuid primary key default gen_random_uuid(),
  -- Slash-delimited path, e.g. 'Finance/Quarterly close'. Nesting is encoded
  -- in the path rather than a parent_id so a subtree is one `like` query.
  path text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists brain_docs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  -- context = loaded as standing instructions by brain_context_get.
  -- knowledge = retrieved on demand via search/get.
  kind text not null default 'knowledge' check (kind in ('context', 'knowledge')),
  scope text not null default 'user' check (scope in ('user', 'team', 'company')),
  folder_id uuid references brain_folders(id) on delete set null,
  content text not null default '',
  status text not null default 'active' check (status in ('active', 'archived')),
  review_state text not null default 'draft' check (review_state in ('draft', 'pending', 'approved')),
  -- Only approved + mcp_exposed docs are ever handed to an MCP client.
  mcp_exposed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brain_docs_folder_idx on brain_docs (folder_id);
create index if not exists brain_docs_kind_idx on brain_docs (kind);
create index if not exists brain_docs_review_state_idx on brain_docs (review_state);
create index if not exists brain_docs_updated_at_idx on brain_docs (updated_at desc);

-- Full-text search over title + content, used by brain_docs_search.
create index if not exists brain_docs_search_idx on brain_docs
  using gin (to_tsvector('english', title || ' ' || content));

alter table brain_folders enable row level security;
alter table brain_docs enable row level security;

create policy "authenticated full access" on brain_folders for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated full access" on brain_docs for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- --- Skills: bring the model closer to Manifest's ---------------------------
-- Manifest skills carry a visibility level, tags, and usage telemetry beyond
-- the draft/published lifecycle 0001 shipped with.

alter table skills add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'team', 'company', 'marketplace'));
alter table skills add column if not exists tags text[] not null default '{}';
alter table skills add column if not exists usage_count integer not null default 0;
alter table skills add column if not exists last_used_at timestamptz;

create index if not exists skills_visibility_idx on skills (visibility);

-- Increments a skill's usage counter when it's fetched through MCP, so the
-- Skills page can show what actually gets used (mirrors Manifest's usageCount).
create or replace function increment_skill_usage(p_slug text)
returns void as $$
begin
  update skills
     set usage_count = usage_count + 1,
         last_used_at = now()
   where slug = p_slug;
end;
$$ language plpgsql security definer set search_path = public;
