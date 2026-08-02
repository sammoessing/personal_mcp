"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { slugify } from "@/lib/slug";
import type { DocKind, DocReviewState, DocScope } from "@/lib/brain/types";

async function resolveFolderId(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("brain_folders")
    .select("id")
    .eq("path", path)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("brain_folders")
    .insert({ path })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent("brain_folder_created", { path });
  return data.id;
}

export async function createDocAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "knowledge") as DocKind;
  const scope = String(formData.get("scope") ?? "user") as DocScope;
  const folderPath = String(formData.get("folder") ?? "").trim() || null;
  const content = String(formData.get("content") ?? "");
  if (!title) throw new Error("Title is required.");

  const supabase = await createClient();
  const folderId = await resolveFolderId(folderPath);

  const { data, error } = await supabase
    .from("brain_docs")
    .insert({ title, slug: slugify(title), kind, scope, folder_id: folderId, content })
    .select("slug, title")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent("brain_doc_created", { title: data.title, slug: data.slug, kind, scope });
  revalidatePath("/brain");
  redirect(`/brain/${data.slug}`);
}

export async function updateDocAction(slug: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const kind = String(formData.get("kind") ?? "knowledge") as DocKind;
  const scope = String(formData.get("scope") ?? "user") as DocScope;
  const folderPath = String(formData.get("folder") ?? "").trim() || null;
  const content = String(formData.get("content") ?? "");
  if (!title) throw new Error("Title is required.");

  const supabase = await createClient();
  const folderId = await resolveFolderId(folderPath);

  const { error } = await supabase
    .from("brain_docs")
    .update({ title, kind, scope, folder_id: folderId, content, updated_at: new Date().toISOString() })
    .eq("slug", slug);
  if (error) throw new Error(error.message);

  await appendAuditEvent("brain_doc_updated", { title, slug });
  revalidatePath(`/brain/${slug}`);
  revalidatePath("/brain");
}

export async function setDocReviewStateAction(slug: string, reviewState: DocReviewState) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brain_docs")
    .update({ review_state: reviewState, updated_at: new Date().toISOString() })
    .eq("slug", slug)
    .select("title")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent("brain_doc_review_changed", {
    title: data.title,
    slug,
    reviewState,
  });
  revalidatePath(`/brain/${slug}`);
  revalidatePath("/brain");
}

export async function setDocMcpExposedAction(slug: string, exposed: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("brain_docs")
    .update({ mcp_exposed: exposed, updated_at: new Date().toISOString() })
    .eq("slug", slug);
  if (error) throw new Error(error.message);

  revalidatePath(`/brain/${slug}`);
  revalidatePath("/brain");
}

export async function deleteDocAction(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brain_docs")
    .delete()
    .eq("slug", slug)
    .select("title")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent("brain_doc_deleted", { title: data.title, slug });
  revalidatePath("/brain");
  redirect("/brain");
}
