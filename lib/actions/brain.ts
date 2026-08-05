"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { slugify } from "@/lib/slug";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import type { DocKind, DocReviewState, DocScope } from "@/lib/brain/types";

async function resolveFolderId(
  workspaceId: string,
  path: string | null
): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("brain_folders")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("path", path)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("brain_folders")
    .insert({ workspace_id: workspaceId, path })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(workspaceId, "brain_folder_created", { path });
  return data.id;
}

export async function createDocAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const kind = String(formData.get("kind") ?? "knowledge") as DocKind;
  const scope = String(formData.get("scope") ?? "user") as DocScope;
  const folderPath = String(formData.get("folder") ?? "").trim() || null;
  const content = String(formData.get("content") ?? "");
  if (!title) throw new Error("Title is required.");

  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const folderId = await resolveFolderId(ws.id, folderPath);

  const { data, error } = await supabase
    .from("brain_docs")
    .insert({
      workspace_id: ws.id,
      title,
      description,
      slug: slugify(title),
      kind,
      scope,
      folder_id: folderId,
      content,
    })
    .select("slug, title")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_doc_created", { title: data.title, slug: data.slug, kind, scope });
  revalidatePath("/brain");
  redirect(`/brain/${data.slug}`);
}

export async function updateDocAction(slug: string, formData: FormData) {
  const ws = await requireCurrentWorkspace();
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const kind = String(formData.get("kind") ?? "knowledge") as DocKind;
  const scope = String(formData.get("scope") ?? "user") as DocScope;
  const folderPath = String(formData.get("folder") ?? "").trim() || null;
  const content = String(formData.get("content") ?? "");
  if (!title) throw new Error("Title is required.");

  const supabase = await createClient();
  const folderId = await resolveFolderId(ws.id, folderPath);

  const { error } = await supabase
    .from("brain_docs")
    .update({
      title,
      description,
      kind,
      scope,
      folder_id: folderId,
      content,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", ws.id)
    .eq("slug", slug);
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_doc_updated", { title, slug });
  revalidatePath(`/brain/${slug}`);
  revalidatePath("/brain");
}

export async function setDocReviewStateAction(slug: string, reviewState: DocReviewState) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brain_docs")
    .update({ review_state: reviewState, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("slug", slug)
    .select("title")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_doc_review_changed", {
    title: data.title,
    slug,
    reviewState,
  });
  revalidatePath(`/brain/${slug}`);
  revalidatePath("/brain");
}

export async function setDocMcpExposedAction(slug: string, exposed: boolean) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { error } = await supabase
    .from("brain_docs")
    .update({ mcp_exposed: exposed, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("slug", slug);
  if (error) throw new Error(error.message);

  revalidatePath(`/brain/${slug}`);
  revalidatePath("/brain");
}

export async function deleteDocAction(slug: string) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brain_docs")
    .delete()
    .eq("workspace_id", ws.id)
    .eq("slug", slug)
    .select("title")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_doc_deleted", { title: data.title, slug });
  revalidatePath("/brain");
  redirect("/brain");
}

/**
 * Archiving is the safe default for "I don't want to see this any more":
 * archived docs stop being served over MCP and drop out of the library, but
 * nothing is lost. Deleting stays available for when you mean it.
 */
export async function archiveDocAction(slug: string) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brain_docs")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("slug", slug)
    .select("title")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_doc_archived", { title: data.title, slug });
  revalidatePath("/brain");
}

export async function moveDocAction(slug: string, folderPath: string | null) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const folderId = await resolveFolderId(ws.id, folderPath);

  const { data, error } = await supabase
    .from("brain_docs")
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("slug", slug)
    .select("title")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_doc_moved", {
    title: data.title,
    slug,
    folder: folderPath ?? "unfiled",
  });
  revalidatePath("/brain");
}

export async function createFolderAction(formData: FormData) {
  const path = String(formData.get("path") ?? "").trim();
  if (!path) throw new Error("Folder name is required.");

  const ws = await requireCurrentWorkspace();
  await resolveFolderId(ws.id, path);
  revalidatePath("/brain");
}
