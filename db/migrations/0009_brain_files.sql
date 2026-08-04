-- =====================================================================
--  0009 — Brain files
--
--  Documents you write live in brain_docs. This is for documents you
--  already have: decks, PDFs, spreadsheets, transcripts. The bytes go to
--  Supabase Storage; this table is the catalogue, so files sit in the
--  same folder tree as docs and are governed by the same membership rules.
--
--  Run after 0008_member_connectors.sql.
-- =====================================================================

create table if not exists brain_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  folder_id uuid references brain_folders(id) on delete set null,
  name text not null,
  -- Object key inside the bucket. Always '<workspace_id>/<uuid><ext>', which
  -- is what the storage policies below key isolation on.
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null default 0,
  description text,
  uploaded_by uuid references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists brain_files_workspace_idx on brain_files (workspace_id, created_at desc);
create index if not exists brain_files_folder_idx on brain_files (folder_id);

alter table brain_files enable row level security;

drop policy if exists "workspace scoped" on brain_files;
create policy "workspace scoped" on brain_files
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- --- Storage ---------------------------------------------------------------
-- Private bucket: nothing is publicly readable, and every download goes
-- through a short-lived signed URL minted server-side after a membership
-- check.

insert into storage.buckets (id, name, public, file_size_limit)
values ('brain-files', 'brain-files', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- Casting the first path segment straight to uuid would raise on any object
-- whose key isn't in our format, and an erroring policy is a broken query
-- rather than a denied one. This returns null instead, which RLS treats as
-- false — so a malformed key is simply unreadable.
create or replace function public.brain_file_workspace(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public, storage
as $$
declare
  segment text;
begin
  segment := (storage.foldername(object_name))[1];
  if segment is null or segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return segment::uuid;
end;
$$;

-- Uploads are performed by the browser against a signed upload URL, so these
-- policies are what actually contain a member to their own workspaces. The
-- first path segment is the workspace id.
drop policy if exists "brain files readable by members" on storage.objects;
create policy "brain files readable by members" on storage.objects
  for select using (
    bucket_id = 'brain-files'
    and is_workspace_member(public.brain_file_workspace(name))
  );

drop policy if exists "brain files writable by members" on storage.objects;
create policy "brain files writable by members" on storage.objects
  for insert with check (
    bucket_id = 'brain-files'
    and is_workspace_member(public.brain_file_workspace(name))
  );

drop policy if exists "brain files deletable by members" on storage.objects;
create policy "brain files deletable by members" on storage.objects
  for delete using (
    bucket_id = 'brain-files'
    and is_workspace_member(public.brain_file_workspace(name))
  );
