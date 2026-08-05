import Link from "next/link";
import { Folder, Files, Compass, Library, Network, Inbox, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewDocDialog } from "@/components/dashboard/new-doc-dialog";
import { StatCard } from "@/components/dashboard/stat-card";
import { DocRowActions } from "@/components/dashboard/doc-row-actions";
import {
  ContextPreview,
  RefreshButton,
  NewFolderButton,
} from "@/components/dashboard/context-preview";
import { BrainGraph } from "@/components/dashboard/brain-graph";
import { FileUpload } from "@/components/dashboard/file-upload";
import { FileRowActions } from "@/components/dashboard/file-row-actions";
import { formatBytes, fileKind } from "@/lib/brain/files";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { snippetOf, type DocKind, type DocReviewState } from "@/lib/brain/types";
import { buildGraph } from "@/lib/brain/graph";

export const dynamic = "force-dynamic";

type Tab = "context" | "knowledge" | "files" | "graph";

/**
 * What a document's review state means operationally, which is what you
 * actually want to know at a glance: is this reaching my agents or not?
 */
const STATUS: Record<DocReviewState, { label: string; variant: "success" | "warning" | "outline" }> =
  {
    approved: { label: "Live", variant: "success" },
    pending: { label: "In review", variant: "warning" },
    draft: { label: "Draft", variant: "outline" },
  };

const SCOPE_LABEL: Record<string, string> = {
  company: "Company",
  team: "Team",
  user: "Personal",
};

type DocRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  kind: DocKind;
  scope: string;
  content: string;
  review_state: DocReviewState;
  updated_at: string;
  folder_id: string | null;
};

type FileRow = {
  id: string;
  name: string;
  description: string | null;
  mime_type: string | null;
  size_bytes: number;
  folder_id: string | null;
  created_at: string;
};

/** Rough token count — a quarter of the character count is close enough to size a prompt. */
const estimateTokens = (text: string) => Math.round(text.length / 4);

export default async function BrainPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; tab?: string }>;
}) {
  const params = await searchParams;
  const activeFolder = params.folder;
  const tab: Tab =
    params.tab === "knowledge" || params.tab === "graph" || params.tab === "files"
      ? params.tab
      : "context";

  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: docs }, { data: folders }, { data: fileRows }] = await Promise.all([
    supabase
      .from("brain_docs")
      .select("id, slug, title, description, kind, scope, content, review_state, updated_at, folder_id")
      .eq("workspace_id", ws.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false }),
    supabase.from("brain_folders").select("id, path").eq("workspace_id", ws.id).order("path"),
    supabase
      .from("brain_files")
      .select("id, name, description, mime_type, size_bytes, folder_id, created_at")
      .eq("workspace_id", ws.id)
      .eq("status", "active")
      .eq("role", "file")
      .order("created_at", { ascending: false }),
  ]);

  const allDocs = (docs ?? []) as DocRow[];
  const allFiles = (fileRows ?? []) as FileRow[];
  const folderById = new Map((folders ?? []).map((f) => [f.id, f.path]));
  const folderPaths = (folders ?? []).map((f) => f.path);
  const pathOf = (row: { folder_id: string | null }) =>
    row.folder_id ? (folderById.get(row.folder_id) ?? null) : null;
  const inActiveFolder = (row: { folder_id: string | null }) => {
    if (!activeFolder) return true;
    if (activeFolder === "unfiled") return row.folder_id === null;
    const path = pathOf(row);
    return path === activeFolder || path?.startsWith(`${activeFolder}/`);
  };

  const contextDocs = allDocs.filter((d) => d.kind === "context");
  const knowledgeDocs = allDocs.filter((d) => d.kind === "knowledge");
  const pendingCount = allDocs.filter((d) => d.review_state !== "approved").length;

  // Mirrors brain_context_get: only approved context docs reach an agent, and
  // they arrive with the same provenance headers. Previewing anything else
  // would be reassuring and wrong.
  const standingContext = contextDocs
    .filter((doc) => doc.review_state === "approved")
    .map((doc) => {
      const folder = pathOf(doc);
      const header = `--- source: ${doc.slug} | scope: ${doc.scope}${
        folder ? ` | folder: ${folder}` : ""
      } | updated: ${doc.updated_at.slice(0, 10)} ---`;
      return `${header}\n# ${doc.title}\n\n${doc.content}`;
    })
    .join("\n\n");
  const contextTokens = estimateTokens(standingContext);

  // The graph spans the whole brain; the list tabs are filtered by kind.
  const scoped =
    tab === "graph" ? allDocs : tab === "context" ? contextDocs : tab === "files" ? [] : knowledgeDocs;
  const visible = scoped.filter(inActiveFolder);
  const visibleFiles = allFiles.filter(inActiveFolder);

  // Sidebar counts follow whichever collection the active tab is showing.
  const sidebarItems: Array<{ folder_id: string | null }> = tab === "files" ? allFiles : scoped;
  const countIn = (path: string) =>
    sidebarItems.filter((row) => {
      const p = pathOf(row);
      return p === path || p?.startsWith(`${path}/`);
    }).length;

  function href(next: { folder?: string | null; tab?: Tab }) {
    const search = new URLSearchParams();
    const folder = "folder" in next ? next.folder : activeFolder;
    const nextTab = next.tab ?? tab;
    if (folder) search.set("folder", folder);
    if (nextTab !== "context") search.set("tab", nextTab);
    const qs = search.toString();
    return qs ? `/brain?${qs}` : "/brain";
  }

  return (
    <>
      <PageHeader
        title="Brain"
        description="Standing context and company knowledge, review-gated and served to your agents over MCP."
        action={
          <div className="flex items-center gap-2">
            <RefreshButton />
            <NewDocDialog folders={folderPaths} />
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Documents" value={allDocs.length} />
        <StatCard
          label="Context docs"
          value={contextDocs.length}
          subtitle={`~${contextTokens.toLocaleString()} tokens`}
        />
        <StatCard
          label="Knowledge docs"
          value={knowledgeDocs.length}
          subtitle="searched on demand"
        />
        <StatCard label="Pending review" value={pendingCount} />
      </div>

      <p className="mb-5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Context</span>{" "}
        <span className="text-[#7c5cf0]">(personal + company)</span> is loaded into your agents at
        the start of every session (~{contextTokens.toLocaleString()} tokens right now).{" "}
        <span className="font-medium text-foreground">Knowledge</span> is your searchable
        documentation library, pulled on demand —{" "}
        <span className="text-[#c2410c]">put everything there</span>.
      </p>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          <TabLink href={href({ tab: "context" })} active={tab === "context"} icon={Compass}>
            Context
          </TabLink>
          <TabLink href={href({ tab: "knowledge" })} active={tab === "knowledge"} icon={Library}>
            Knowledge
          </TabLink>
          <TabLink href={href({ tab: "files" })} active={tab === "files"} icon={Paperclip}>
            Files
          </TabLink>
          <TabLink href={href({ tab: "graph" })} active={tab === "graph"} icon={Network}>
            Graph
          </TabLink>
        </div>
        <ContextPreview context={standingContext} tokens={contextTokens} />
      </div>

      <div className="flex gap-6">
        <nav className="w-52 shrink-0">
          <SidebarLink href={href({ folder: null })} active={!activeFolder} icon={Files}>
            {tab === "files" ? "All files" : "All documents"}
            <span className="ml-auto text-xs text-muted-foreground">{sidebarItems.length}</span>
          </SidebarLink>

          <div className="mb-2 mt-5 flex items-center justify-between px-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Folders
            </span>
            <NewFolderButton />
          </div>

          <div className="flex flex-col gap-0.5">
            {folderPaths.map((path) => (
              <SidebarLink
                key={path}
                href={href({ folder: path })}
                active={activeFolder === path}
                icon={Folder}
                indent
              >
                <span className="truncate">{path}</span>
                <span className="ml-auto text-xs text-muted-foreground">{countIn(path)}</span>
              </SidebarLink>
            ))}
            {folderPaths.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">No folders yet.</p>
            )}
          </div>

          <div className="mt-2">
            <SidebarLink
              href={href({ folder: "unfiled" })}
              active={activeFolder === "unfiled"}
              icon={Inbox}
            >
              Unfiled
              <span className="ml-auto text-xs text-muted-foreground">
                {sidebarItems.filter((row) => row.folder_id === null).length}
              </span>
            </SidebarLink>
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {tab === "files" ? (
            <div className="flex flex-col gap-4">
              <FileUpload folder={activeFolder === "unfiled" ? null : (activeFolder ?? null)} />

              {visibleFiles.length === 0 ? (
                <EmptyState
                  title="No files here yet"
                  body="Upload the documents you already have — decks, PDFs, spreadsheets, transcripts. They stay private to this workspace and your agents can fetch them over MCP."
                />
              ) : (
                <Card className="overflow-hidden p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-secondary/40 text-left">
                        <Th className="pl-5">File</Th>
                        <Th className="w-20">Type</Th>
                        <Th className="w-24">Size</Th>
                        <Th className="w-24">Added</Th>
                        <Th className="w-28 pr-5" />
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {visibleFiles.map((file) => (
                        <tr key={file.id} className="group transition-colors hover:bg-secondary/30">
                          <td className="min-w-0 py-3 pl-5 pr-4">
                            <a
                              href={`/api/brain/files/${file.id}/download`}
                              className="block truncate font-medium hover:underline"
                            >
                              {file.name}
                            </a>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {file.description || pathOf(file) || "Unfiled"}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <Badge variant="secondary">{fileKind(file.name, file.mime_type)}</Badge>
                          </td>
                          <td className="py-3 pr-4 text-xs text-muted-foreground">
                            {formatBytes(file.size_bytes)}
                          </td>
                          <td className="py-3 pr-4 text-xs text-muted-foreground">
                            {timeAgo(file.created_at)}
                          </td>
                          <td className="py-3 pr-5">
                            <div className="flex justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                              <FileRowActions
                                id={file.id}
                                name={file.name}
                                description={file.description}
                                folder={pathOf(file)}
                                folders={folderPaths}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          ) : tab === "graph" ? (
            <>
              <p className="mb-3 rounded-md border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
                Every circle is a document; solid lines are explicit links, faint lines are docs that
                talk about the same things. Write{" "}
                <code className="rounded bg-background px-1 py-0.5">[[doc-slug]]</code> (or{" "}
                <code className="rounded bg-background px-1 py-0.5">[[Doc Title]]</code>) inside a
                document to link it here, Obsidian-style. Hover to trace a neighborhood, drag to
                rearrange, scroll to zoom, click a node to open the doc.
              </p>
              {visible.length === 0 ? (
                <EmptyState title="Nothing to plot" body="No documents match this filter." />
              ) : (
                <BrainGraph graph={buildGraph(visible)} />
              )}
            </>
          ) : visible.length === 0 ? (
            <EmptyState
              title={tab === "context" ? "No context docs yet" : "No knowledge docs yet"}
              body={
                tab === "context"
                  ? "Context docs load into every agent session as standing instructions. Keep them short — anything long belongs in Knowledge."
                  : "Knowledge is your searchable library. Agents pull from it on demand, so this is where most documents should live."
              }
            />
          ) : (
            <Card className="overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-secondary/40 text-left">
                    <Th className="pl-5">Document</Th>
                    <Th className="w-28">Scope</Th>
                    <Th className="w-28">Status</Th>
                    <Th className="w-24">Updated</Th>
                    <Th className="w-32 pr-5" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map((doc) => (
                    <tr key={doc.id} className="group transition-colors hover:bg-secondary/30">
                      <td className="min-w-0 py-3 pl-5 pr-4">
                        <Link href={`/brain/${doc.slug}`} className="block">
                          <span className="block truncate font-medium">{doc.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {doc.description || snippetOf(doc.content, 90) || "Empty doc"}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant="secondary">{SCOPE_LABEL[doc.scope] ?? doc.scope}</Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={STATUS[doc.review_state].variant}>
                          {STATUS[doc.review_state].label}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {timeAgo(doc.updated_at)}
                      </td>
                      <td className="py-3 pr-5">
                        {/* Revealed on hover so a long list stays calm, but kept
                            focusable so the row is still keyboard-reachable. */}
                        <div className="flex justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                          <DocRowActions
                            slug={doc.slug}
                            title={doc.title}
                            folder={pathOf(doc)}
                            folders={folderPaths}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "py-2.5 pr-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        className
      )}
    >
      {children}
    </th>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <div className="px-5 py-16 text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      </div>
    </Card>
  );
}

function TabLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition-colors",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </Link>
  );
}

function SidebarLink({
  href,
  active,
  icon: Icon,
  indent,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  indent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md py-1.5 text-sm transition-colors",
        indent ? "pl-5 pr-2.5" : "px-2.5",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {children}
    </Link>
  );
}
