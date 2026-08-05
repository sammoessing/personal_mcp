"use client";

import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createUploadTargetAction, extractStagedUploadAction } from "@/lib/actions/files";
import { BRAIN_BUCKET, MAX_FILE_BYTES } from "@/lib/brain/files";
import { cn } from "@/lib/utils";

export type ImportResult = {
  text: string;
  suggestedTitle: string;
  note: string | null;
};

/**
 * Turns a PDF, .docx, or text file into document content.
 *
 * The bytes go to storage first and are parsed server-side, then the staged
 * object is deleted. That keeps large files off the request-body path and puts
 * the node-only parsers where they can run — the browser cannot read a PDF's
 * text layer without shipping a second copy of the parser to every visitor.
 */
export function DocImport({ onImported }: { onImported: (result: ImportResult) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "note" | "error"; message: string } | null>(null);

  // A drop landing just outside the zone otherwise navigates the browser to
  // the file, losing whatever is already typed into the form.
  useEffect(() => {
    const swallow = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  async function importFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      setStatus({ kind: "error", message: "That file is larger than the 50 MB limit." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const target = await createUploadTargetAction(file.name, file.size, "import");
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(BRAIN_BUCKET)
        .uploadToSignedUrl(target.path, target.token, file);
      if (error) throw new Error(error.message);

      const result = await extractStagedUploadAction({
        path: target.path,
        name: file.name,
        mimeType: file.type || null,
      });

      onImported(result);
      setStatus({
        kind: result.text ? "note" : "error",
        message:
          result.note ??
          `Imported ${file.name}. Check it reads correctly before saving.`,
      });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Could not import that file.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.md,.markdown,.txt,.csv,.tsv,.json,.yaml,.yml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importFile(file);
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
          const file = event.dataTransfer.files?.[0];
          if (file) void importFile(file);
        }}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-md border border-dashed px-4 py-3 text-center text-xs transition-colors disabled:opacity-60",
          dragging
            ? "border-ring bg-secondary/60"
            : "border-input text-muted-foreground hover:border-ring/60 hover:bg-secondary/30"
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
        <span>
          {busy
            ? "Reading the document…"
            : dragging
              ? "Drop to import"
              : "Import from a PDF, Word doc, or text file — or click to browse"}
        </span>
      </button>

      {status && (
        <p className={cn("text-xs", status.kind === "error" ? "text-destructive" : "text-muted-foreground")}>
          {status.message}
        </p>
      )}
    </div>
  );
}
