"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createUploadTargetAction, recordUploadAction } from "@/lib/actions/files";
import { BRAIN_BUCKET, MAX_FILE_BYTES } from "@/lib/brain/files";
import { cn } from "@/lib/utils";

type Progress = { name: string; state: "uploading" | "done" | "failed"; error?: string };

/**
 * Uploads go browser → Supabase Storage directly, against a signed URL minted
 * by the server. Sending bytes through the app would cap uploads at the
 * platform request-body limit, which most real decks and PDFs exceed.
 */
export function FileUpload({ folder }: { folder: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<Progress[]>([]);
  const busy = items.some((item) => item.state === "uploading");

  // Without this, a drop landing just outside the zone hits the document and
  // the browser navigates away to the file.
  useEffect(() => {
    const swallow = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  function update(name: string, patch: Partial<Progress>) {
    setItems((prev) => prev.map((item) => (item.name === name ? { ...item, ...patch } : item)));
  }

  async function uploadOne(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      update(file.name, { state: "failed", error: "Larger than the 50 MB limit." });
      return;
    }
    try {
      const target = await createUploadTargetAction(file.name, file.size);
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(BRAIN_BUCKET)
        .uploadToSignedUrl(target.path, target.token, file);
      if (error) throw new Error(error.message);

      await recordUploadAction({
        path: target.path,
        name: file.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
        folder,
      });
      update(file.name, { state: "done" });
    } catch (err) {
      update(file.name, {
        state: "failed",
        error: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setItems(files.map((file) => ({ name: file.name, state: "uploading" as const })));
    // Sequential: a browser throttles parallel uploads to the same host
    // anyway, and this keeps per-file progress honest.
    for (const file of files) await uploadOne(file);
    router.refresh();
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          void upload(files);
          event.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void upload(Array.from(event.dataTransfer.files ?? []));
        }}
        className={cn(
          "flex w-full flex-col items-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors disabled:opacity-60",
          dragging ? "border-ring bg-secondary/60" : "border-input hover:border-ring/60 hover:bg-secondary/30"
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="size-5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          {busy ? "Uploading…" : dragging ? "Drop to upload" : "Drag files here"}
        </span>
        <span className="text-xs text-muted-foreground">
          {folder ? `Uploads into ${folder}` : "Uploads unfiled"} — or click to browse. Up to 50 MB
          each.
        </span>
      </button>

      {items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.name} className="flex items-center gap-2 text-xs">
              <span className="truncate text-muted-foreground">{item.name}</span>
              <span
                className={cn(
                  "ml-auto shrink-0",
                  item.state === "failed" ? "text-destructive" : "text-muted-foreground"
                )}
              >
                {item.state === "uploading"
                  ? "uploading…"
                  : item.state === "done"
                    ? "uploaded"
                    : (item.error ?? "failed")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
