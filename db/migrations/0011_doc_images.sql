-- =====================================================================
--  0011 — keep images and originals when importing a document
--
--  Importing flattened a document to text, which threw away logos and
--  diagrams — fine for a policy memo, wrong for anything with branding
--  in it.
--
--  Two changes:
--
--  * brain_files.role separates the files you uploaded ('file') from
--    images pulled out of an imported document ('embedded'). Embedded
--    images are addressed by the markdown that references them, so they
--    are hidden from the Files tab rather than cluttering it.
--
--  * brain_docs.source_file_id keeps the original upload attached to the
--    document it produced. Text extraction always loses layout, and for
--    PDFs it loses images entirely, so the original stays downloadable.
--
--  Run after 0010_doc_descriptions.sql.
-- =====================================================================

alter table brain_files
  add column if not exists role text not null default 'file'
  check (role in ('file', 'embedded'));

create index if not exists brain_files_role_idx on brain_files (workspace_id, role);

alter table brain_docs
  add column if not exists source_file_id uuid references brain_files(id) on delete set null;
