import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { BRAIN_BUCKET } from "@/lib/brain/files";

/**
 * Files are never public. Downloading mints a signed URL valid for a minute
 * and redirects to it, so the object is reachable only for as long as it takes
 * the browser to follow the redirect, and only after a membership check.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ws = await requireCurrentWorkspace();

  // Scoped by workspace_id, so an id from another tenant simply isn't found.
  const supabase = await createClient();
  const { data: file } = await supabase
    .from("brain_files")
    .select("id, name, storage_path")
    .eq("workspace_id", ws.id)
    .eq("id", id)
    .maybeSingle();

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const service = createServiceRoleClient();
  const { data, error } = await service.storage
    .from(BRAIN_BUCKET)
    .createSignedUrl(file.storage_path, 60, { download: file.name });

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create a download link" },
      { status: 500 }
    );
  }

  // Downloads are part of the trail — who pulled a client document matters as
  // much as who uploaded it. Never block the download on writing it.
  try {
    await appendAuditEvent(ws.id, "brain_file_downloaded", { name: file.name });
  } catch {
    // Audit failures are surfaced by chain verification, not by breaking this.
  }

  return NextResponse.redirect(data.signedUrl);
}
