import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { textResult, errorResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";
import { BRAIN_BUCKET, formatBytes } from "@/lib/brain/files";

/** How long a link handed to an agent stays usable. Long enough to fetch, short enough not to leak. */
const SIGNED_URL_TTL_SECONDS = 300;

function folderPathOf(row: { brain_folders?: unknown }): string | null {
  const rel = row.brain_folders as { path?: string } | { path?: string }[] | null | undefined;
  if (!rel) return null;
  return (Array.isArray(rel) ? rel[0]?.path : rel.path) ?? null;
}

/**
 * File tools. Every query is filtered by the workspace the calling token is
 * bound to, so an agent can only ever see its own tenant's uploads.
 */
export const fileTools: ToolDefinition[] = [
  {
    name: "brain_files_list",
    title: "List brain files",
    description:
      "List uploaded files in this workspace's brain — name, type, size, and folder. Use brain_files_get to obtain a download link for one.",
    inputSchema: {
      folder: z.string().optional().describe("Limit to a folder path, e.g. 'Sales'"),
      query: z.string().optional().describe("Case-insensitive filename filter"),
    },
    handler: async (
      args: { folder?: string; query?: string },
      ctx: ToolContext
    ) => {
      let query = createServiceRoleClient()
        .from("brain_files")
        .select("id, name, mime_type, size_bytes, created_at, brain_folders(path)")
        .eq("workspace_id", ctx.workspaceId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(200);

      if (args.query) query = query.ilike("name", `%${args.query}%`);

      const { data, error } = await query;
      if (error) return errorResult(error.message);

      const rows = (data ?? []).filter((row) =>
        args.folder ? folderPathOf(row) === args.folder : true
      );
      if (rows.length === 0) return textResult("No files match.");

      return textResult(
        rows
          .map((row) => {
            const folder = folderPathOf(row);
            return `${row.id}\n  ${row.name} — ${formatBytes(row.size_bytes)}${
              row.mime_type ? ` (${row.mime_type})` : ""
            }\n  folder: ${folder ?? "unfiled"} | added: ${row.created_at.slice(0, 10)}`;
          })
          .join("\n\n")
      );
    },
  },
  {
    name: "brain_files_get",
    title: "Get a brain file",
    description:
      "Return a short-lived download URL for one uploaded file, by id from brain_files_list. Text-like files are returned inline instead, so they can be read directly.",
    inputSchema: {
      id: z.string().describe("File id from brain_files_list"),
    },
    handler: async (args: { id: string }, ctx: ToolContext) => {
      const service = createServiceRoleClient();
      const { data: file, error } = await service
        .from("brain_files")
        .select("id, name, mime_type, size_bytes, storage_path, brain_folders(path)")
        .eq("workspace_id", ctx.workspaceId)
        .eq("id", args.id)
        .eq("status", "active")
        .maybeSingle();

      if (error) return errorResult(error.message);
      if (!file) return errorResult("No such file in this workspace.");

      const isTextLike =
        /^text\//.test(file.mime_type ?? "") ||
        /\.(md|markdown|txt|csv|json|ya?ml)$/i.test(file.name);

      // Inlining a huge file would blow the context window, so size still gates
      // it even when the type is readable.
      if (isTextLike && file.size_bytes <= 200_000) {
        const { data: blob, error: downloadError } = await service.storage
          .from(BRAIN_BUCKET)
          .download(file.storage_path);
        if (downloadError) return errorResult(downloadError.message);
        const text = await blob.text();
        return textResult(`# ${file.name}\n\n${text}`);
      }

      const { data: signed, error: signError } = await service.storage
        .from(BRAIN_BUCKET)
        .createSignedUrl(file.storage_path, SIGNED_URL_TTL_SECONDS, { download: file.name });
      if (signError || !signed) {
        return errorResult(signError?.message ?? "Could not create a download link.");
      }

      return textResult(
        [
          `# ${file.name}`,
          `type: ${file.mime_type ?? "unknown"}`,
          `size: ${formatBytes(file.size_bytes)}`,
          `folder: ${folderPathOf(file) ?? "unfiled"}`,
          "",
          `Download (expires in ${SIGNED_URL_TTL_SECONDS / 60} minutes):`,
          signed.signedUrl,
        ].join("\n")
      );
    },
  },
];
