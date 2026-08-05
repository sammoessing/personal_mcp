import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { BRAIN_BUCKET } from "@/lib/brain/files";

/**
 * Serves an image embedded in a brain document.
 *
 * Documents reference images by this stable URL rather than a signed one: a
 * signed URL baked into markdown would expire and leave the document full of
 * broken pictures. The signature is minted per request instead, behind the same
 * workspace membership check as everything else.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ws = await requireCurrentWorkspace();

  const supabase = await createClient();
  const { data: image } = await supabase
    .from("brain_files")
    .select("id, storage_path, mime_type")
    .eq("workspace_id", ws.id)
    .eq("id", id)
    .maybeSingle();

  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const service = createServiceRoleClient();
  const { data: blob, error } = await service.storage
    .from(BRAIN_BUCKET)
    .download(image.storage_path);

  if (error || !blob) {
    return NextResponse.json({ error: "Image could not be read" }, { status: 404 });
  }

  // Streamed rather than redirected to a signed URL, so the browser caches one
  // stable address instead of re-fetching a new signature on every render.
  return new NextResponse(blob.stream(), {
    headers: {
      "Content-Type": image.mime_type ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
