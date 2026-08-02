import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { textResult, errorResult, type ToolDefinition } from "@/lib/mcp/types";
import { snippetOf } from "@/lib/brain/types";

/**
 * Only approved, MCP-exposed, active docs ever leave the dashboard — drafts and
 * docs pending review stay internal.
 */
function publishedDocs() {
  return createServiceRoleClient()
    .from("brain_docs")
    .select("slug, title, kind, scope, content, updated_at, brain_folders(path)")
    .eq("review_state", "approved")
    .eq("mcp_exposed", true)
    .eq("status", "active");
}

function folderPathOf(row: { brain_folders?: unknown }): string | null {
  const rel = row.brain_folders as { path?: string } | { path?: string }[] | null | undefined;
  if (!rel) return null;
  return (Array.isArray(rel) ? rel[0]?.path : rel.path) ?? null;
}

export const brainTools: ToolDefinition[] = [
  {
    name: "brain_context_get",
    title: "Get standing context",
    description:
      "Load the standing context for this workspace: every approved 'context' doc, merged with provenance headers. Call this once at the start of a session and treat the result as standing instructions.",
    inputSchema: {},
    handler: async () => {
      const { data, error } = await publishedDocs().eq("kind", "context").order("scope");
      if (error) return errorResult(error.message);
      if (!data || data.length === 0) {
        return textResult("No standing context docs have been approved yet.");
      }

      const merged = data
        .map((doc) => {
          const folder = folderPathOf(doc);
          const header = `--- source: ${doc.slug} | scope: ${doc.scope}${
            folder ? ` | folder: ${folder}` : ""
          } | updated: ${doc.updated_at.slice(0, 10)} ---`;
          return `${header}\n# ${doc.title}\n\n${doc.content}`;
        })
        .join("\n\n");

      return textResult(merged);
    },
  },
  {
    name: "brain_docs_list",
    title: "List brain docs",
    description:
      "Catalog of approved brain documents: slug, title, kind, scope, folder, and a short snippet. Use brain_docs_get for full content.",
    inputSchema: {
      folder: z.string().optional().describe("Limit to a folder path, e.g. 'Finance/Quarterly close'"),
      kind: z.enum(["context", "knowledge"]).optional(),
      scope: z.enum(["user", "team", "company"]).optional(),
    },
    handler: async ({
      folder,
      kind,
      scope,
    }: {
      folder?: string;
      kind?: "context" | "knowledge";
      scope?: "user" | "team" | "company";
    }) => {
      let query = publishedDocs().order("updated_at", { ascending: false }).limit(100);
      if (kind) query = query.eq("kind", kind);
      if (scope) query = query.eq("scope", scope);

      const { data, error } = await query;
      if (error) return errorResult(error.message);

      const docs = (data ?? []).filter((doc) => {
        if (!folder) return true;
        const path = folderPathOf(doc);
        return path === folder || path?.startsWith(`${folder}/`);
      });
      if (docs.length === 0) return textResult("No matching brain docs.");

      return textResult(
        docs
          .map((doc) => {
            const path = folderPathOf(doc);
            return `[${doc.kind}/${doc.scope}] ${doc.title} (${doc.slug})${
              path ? ` — ${path}` : ""
            }\n  ${snippetOf(doc.content)}`;
          })
          .join("\n")
      );
    },
  },
  {
    name: "brain_docs_search",
    title: "Search brain docs",
    description:
      "Full-text search across approved brain documents. Use this before answering questions about this workspace rather than guessing.",
    inputSchema: {
      query: z.string().describe("Search text"),
      maxResults: z.number().int().min(1).max(25).default(10),
    },
    handler: async ({ query, maxResults }: { query: string; maxResults: number }) => {
      const { data, error } = await publishedDocs()
        .textSearch("title", query, { type: "websearch", config: "english" })
        .limit(maxResults);

      // Postgres FTS on title only misses body matches; fall back to ILIKE on content.
      let rows = data ?? [];
      if (!error && rows.length === 0) {
        const { data: fallback } = await publishedDocs()
          .ilike("content", `%${query}%`)
          .limit(maxResults);
        rows = fallback ?? [];
      }
      if (error && rows.length === 0) return errorResult(error.message);
      if (rows.length === 0) return textResult(`No brain docs matched "${query}".`);

      return textResult(
        rows
          .map((doc) => `${doc.title} (${doc.slug})\n  ${snippetOf(doc.content)}`)
          .join("\n")
      );
    },
  },
  {
    name: "brain_docs_get",
    title: "Get brain doc",
    description: "Fetch an approved brain document's full content by slug.",
    inputSchema: {
      slug: z.string().describe("Doc slug, from brain_docs_list or brain_docs_search"),
    },
    handler: async ({ slug }: { slug: string }) => {
      const { data, error } = await publishedDocs().eq("slug", slug).maybeSingle();
      if (error) return errorResult(error.message);
      if (!data) return errorResult(`No approved brain doc found for slug "${slug}".`);

      const folder = folderPathOf(data);
      return textResult(
        `# ${data.title}\n_${data.kind} · ${data.scope}${folder ? ` · ${folder}` : ""}_\n\n${data.content}`
      );
    },
  },
  {
    name: "brain_docs_add",
    title: "Propose brain doc",
    description:
      "Propose a new brain document. It is created pending review — it will not be served to MCP clients until approved in the dashboard.",
    inputSchema: {
      title: z.string().describe("Doc title"),
      content: z.string().describe("Markdown body"),
      kind: z.enum(["context", "knowledge"]).default("knowledge"),
      scope: z.enum(["user", "team", "company"]).default("user"),
      folder: z.string().optional().describe("Folder path, e.g. 'Clients/Acme'"),
    },
    handler: async ({
      title,
      content,
      kind,
      scope,
      folder,
    }: {
      title: string;
      content: string;
      kind: "context" | "knowledge";
      scope: "user" | "team" | "company";
      folder?: string;
    }) => {
      const supabase = createServiceRoleClient();

      let folderId: string | null = null;
      if (folder) {
        const { data: existing } = await supabase
          .from("brain_folders")
          .select("id")
          .eq("path", folder)
          .maybeSingle();
        folderId =
          existing?.id ??
          (await supabase.from("brain_folders").insert({ path: folder }).select("id").single())
            .data?.id ??
          null;
      }

      const slug = title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      const { error } = await supabase.from("brain_docs").insert({
        title,
        slug,
        content,
        kind,
        scope,
        folder_id: folderId,
        review_state: "pending",
      });
      if (error) return errorResult(error.message);

      return textResult(
        `Proposed "${title}" (${slug}) — pending review. Approve it in the dashboard to expose it to MCP clients.`
      );
    },
  },
  {
    name: "brain_folders_list",
    title: "List brain folders",
    description: "The brain's folder tree, as paths, with the number of approved docs filed in each.",
    inputSchema: {},
    handler: async () => {
      const supabase = createServiceRoleClient();
      const { data: folders, error } = await supabase
        .from("brain_folders")
        .select("id, path")
        .order("path");
      if (error) return errorResult(error.message);
      if (!folders || folders.length === 0) return textResult("No folders yet — all docs are unfiled.");

      const { data: docs } = await publishedDocs();
      const counts = new Map<string, number>();
      for (const doc of docs ?? []) {
        const path = folderPathOf(doc);
        if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
      }

      return textResult(
        folders.map((f) => `${f.path} (${counts.get(f.path) ?? 0} docs)`).join("\n")
      );
    },
  },
];
