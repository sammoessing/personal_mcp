"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { requireCurrentWorkspace, getSessionUser } from "@/lib/workspace/context";
import { BRAIN_BUCKET, MAX_FILE_BYTES } from "@/lib/brain/files";
import { extractDocumentText, titleFromFilename } from "@/lib/brain/extract";

/**
 * Object keys are always '<workspace_id>/[imports/]<uuid><ext>'. The first path
 * segment stays the workspace id either way, which is what the storage policies
 * key isolation on.
 */
function objectKey(workspaceId: string, filename: string, prefix = ""): string {
  const dot = filename.lastIndexOf(".");
  // Only a short, conventional extension is carried over; anything else is
  // dropped rather than trusted into a storage key.
  const ext = dot > 0 && filename.length - dot <= 11 ? filename.slice(dot).toLowerCase() : "";
  const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : "";
  return `${workspaceId}/${prefix}${randomUUID()}${safeExt}`;
}

/**
 * Mints a signed upload URL so the browser can send the bytes straight to
 * Supabase Storage.
 *
 * Routing file bytes through the app would cap uploads at the platform's
 * request body limit (4.5 MB on Vercel), which most real decks and PDFs
 * exceed. The membership check still happens here, and the returned key is
 * server-generated, so a client cannot choose where its bytes land.
 */
export async function createUploadTargetAction(
  filename: string,
  sizeBytes: number,
  purpose: "file" | "import" = "file"
) {
  if (sizeBytes > MAX_FILE_BYTES) {
    throw new Error("That file is larger than the 50 MB limit.");
  }

  const ws = await requireCurrentWorkspace();
  const path = objectKey(ws.id, filename, purpose === "import" ? "imports/" : "");

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BRAIN_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(error.message);

  return { path: data.path, token: data.token };
}

/**
 * Records an upload once the bytes have landed. The row is only written after
 * the object is confirmed present, so the catalogue can't list files that
 * don't exist.
 */
export async function recordUploadAction(input: {
  path: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  folder: string | null;
}) {
  const ws = await requireCurrentWorkspace();
  const user = await getSessionUser();

  // A client could call this with any path; only keys inside this workspace's
  // own prefix are acceptable.
  if (!input.path.startsWith(`${ws.id}/`)) {
    throw new Error("That upload does not belong to this workspace.");
  }

  const service = createServiceRoleClient();
  const { data: objects, error: listError } = await service.storage
    .from(BRAIN_BUCKET)
    .list(ws.id, { search: input.path.slice(ws.id.length + 1) });
  if (listError) throw new Error(listError.message);
  if (!objects || objects.length === 0) {
    throw new Error("The upload did not complete, so it was not saved.");
  }

  const supabase = await createClient();
  let folderId: string | null = null;
  if (input.folder) {
    const { data: folder } = await supabase
      .from("brain_folders")
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("path", input.folder)
      .maybeSingle();
    folderId = folder?.id ?? null;
  }

  const { error } = await supabase.from("brain_files").insert({
    workspace_id: ws.id,
    folder_id: folderId,
    name: input.name,
    storage_path: input.path,
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    uploaded_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_file_uploaded", {
    name: input.name,
    sizeBytes: input.sizeBytes,
  });
  revalidatePath("/brain");
}

export async function deleteFileAction(id: string) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();

  const { data: file, error: findError } = await supabase
    .from("brain_files")
    .select("id, name, storage_path")
    .eq("workspace_id", ws.id)
    .eq("id", id)
    .maybeSingle();
  if (findError) throw new Error(findError.message);
  if (!file) throw new Error("File not found in this workspace.");

  // Remove the object first: a stale row with no object is a broken download,
  // while an orphaned object is merely wasted space.
  const service = createServiceRoleClient();
  const { error: removeError } = await service.storage
    .from(BRAIN_BUCKET)
    .remove([file.storage_path]);
  if (removeError) throw new Error(removeError.message);

  const { error } = await supabase.from("brain_files").delete().eq("id", file.id);
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_file_deleted", { name: file.name });
  revalidatePath("/brain");
}

/**
 * Labels a file so agents can tell when to open it. A filename says what
 * something is called; the description says when it is the right thing to
 * fetch, and it is what brain_files_list shows.
 */
export async function updateFileDetailsAction(
  id: string,
  input: { name: string; description: string | null }
) {
  const name = input.name.trim();
  if (!name) throw new Error("A file name is required.");

  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brain_files")
    .update({
      name,
      description: input.description?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", ws.id)
    .eq("id", id)
    .select("name")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_file_updated", { name: data.name });
  revalidatePath("/brain");
}

export async function moveFileAction(id: string, folderPath: string | null) {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();

  let folderId: string | null = null;
  if (folderPath) {
    const { data: folder } = await supabase
      .from("brain_folders")
      .select("id")
      .eq("workspace_id", ws.id)
      .eq("path", folderPath)
      .maybeSingle();
    folderId = folder?.id ?? null;
  }

  const { data, error } = await supabase
    .from("brain_files")
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq("workspace_id", ws.id)
    .eq("id", id)
    .select("name")
    .single();
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "brain_file_moved", {
    name: data.name,
    folder: folderPath ?? "unfiled",
  });
  revalidatePath("/brain");
}

/**
 * Reads a staged upload, converts it to text, and deletes the object.
 *
 * Extraction happens here rather than in the browser for two reasons: the
 * parsers are node-only, and working from storage means a 30 MB PDF is never
 * bounded by the platform's request body limit. The staged object is temporary
 * — the text becomes the document, so keeping the original would be a silent
 * duplicate. Upload it on the Files tab if you want it kept.
 */
export async function extractStagedUploadAction(input: {
  path: string;
  name: string;
  mimeType: string | null;
}) {
  const ws = await requireCurrentWorkspace();
  if (!input.path.startsWith(`${ws.id}/imports/`)) {
    throw new Error("That upload does not belong to this workspace.");
  }

  const service = createServiceRoleClient();
  const { data: blob, error } = await service.storage.from(BRAIN_BUCKET).download(input.path);
  if (error || !blob) throw new Error(error?.message ?? "The upload could not be read.");

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const extracted = await extractDocumentText(bytes, input.name, input.mimeType);
    return {
      text: extracted.text,
      note: extracted.note ?? null,
      suggestedTitle: titleFromFilename(input.name),
    };
  } finally {
    // Always clean up, including when extraction throws — a failed import
    // should not leave an orphaned object behind.
    await service.storage.from(BRAIN_BUCKET).remove([input.path]);
  }
}
