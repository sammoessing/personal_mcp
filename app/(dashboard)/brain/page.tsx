import Link from "next/link";
import { Folder, FileText, Compass, List, Network } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { PageHeader } from "@/components/dashboard/page-header";
import { NewDocDialog } from "@/components/dashboard/new-doc-dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { snippetOf, type DocKind, type DocReviewState } from "@/lib/brain/types";
import { buildGraph } from "@/lib/brain/graph";
import { BrainGraph } from "@/components/dashboard/brain-graph";

export const dynamic = "force-dynamic";

const REVIEW_VARIANT: Record<DocReviewState, "outline" | "warning" | "success"> = {
  draft: "outline",
  pending: "warning",
  approved: "success",
};

type DocRow = {
  id: string;
  slug: string;
  title: string;
  kind: DocKind;
  scope: string;
  content: string;
  review_state: DocReviewState;
  updated_at: string;
  folder_id: string | null;
};

export default async function BrainPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string; kind?: string; view?: string }>;
}) {
  const { folder: activeFolder, kind: activeKind, view } = await searchParams;
  const isGraph = view === "graph";
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: docs }, { data: folders }] = await Promise.all([
    supabase
      .from("brain_docs")
      .select("id, slug, title, kind, scope, content, review_state, updated_at, folder_id")
      .eq("workspace_id", ws.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false }),
    supabase.from("brain_folders").select("id, path").eq("workspace_id", ws.id).order("path"),
  ]);

  const allDocs = (docs ?? []) as DocRow[];
  const folderById = new Map((folders ?? []).map((f) => [f.id, f.path]));

  const visible = allDocs.filter((doc) => {
    if (activeKind && doc.kind !== activeKind) return false;
    if (!activeFolder) return true;
    if (activeFolder === "unfiled") return doc.folder_id === null;
    const path = doc.folder_id ? folderById.get(doc.folder_id) : null;
    return path === activeFolder || path?.startsWith(`${activeFolder}/`);
  });

  const countIn = (path: string) =>
    allDocs.filter((d) => {
      const p = d.folder_id ? folderById.get(d.folder_id) : null;
      return p === path || p?.startsWith(`${path}/`);
    }).length;
  const unfiledCount = allDocs.filter((d) => d.folder_id === null).length;
  const contextCount = allDocs.filter((d) => d.kind === "context").length;

  function filterHref(next: { folder?: string; kind?: string; view?: string }) {
    const params = new URLSearchParams();
    const folder = "folder" in next ? next.folder : activeFolder;
    const kind = "kind" in next ? next.kind : activeKind;
    const nextView = "view" in next ? next.view : view;
    if (folder) params.set("folder", folder);
    if (kind) params.set("kind", kind);
    if (nextView) params.set("view", nextView);
    const qs = params.toString();
    return qs ? `/brain?${qs}` : "/brain";
  }

  // The graph is built from whatever the filters leave visible, so narrowing to
  // a folder shows that folder's neighbourhood rather than the whole brain.
  const graph = isGraph ? buildGraph(visible) : null;

  return (
    <>
      <PageHeader
        title="Brain"
        description="Context and knowledge your agents read from. Approved context docs load as standing instructions."
        action={<NewDocDialog folders={(folders ?? []).map((f) => f.path)} />}
      />

      <div className="flex gap-6">
        <nav className="w-52 shrink-0">
          <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Kind
          </p>
          <div className="mb-5 flex flex-col gap-0.5">
            <FilterLink href={filterHref({ kind: undefined })} active={!activeKind} icon={FileText}>
              All docs
              <span className="ml-auto text-xs text-muted-foreground">{allDocs.length}</span>
            </FilterLink>
            <FilterLink
              href={filterHref({ kind: "context" })}
              active={activeKind === "context"}
              icon={Compass}
            >
              Context
              <span className="ml-auto text-xs text-muted-foreground">{contextCount}</span>
            </FilterLink>
          </div>

          <p className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Folders
          </p>
          <div className="flex flex-col gap-0.5">
            <FilterLink
              href={filterHref({ folder: undefined })}
              active={!activeFolder}
              icon={Folder}
            >
              All
            </FilterLink>
            {(folders ?? []).map((f) => (
              <FilterLink
                key={f.id}
                href={filterHref({ folder: f.path })}
                active={activeFolder === f.path}
                icon={Folder}
              >
                <span className="truncate">{f.path}</span>
                <span className="ml-auto text-xs text-muted-foreground">{countIn(f.path)}</span>
              </FilterLink>
            ))}
            {unfiledCount > 0 && (
              <FilterLink
                href={filterHref({ folder: "unfiled" })}
                active={activeFolder === "unfiled"}
                icon={Folder}
              >
                Unfiled
                <span className="ml-auto text-xs text-muted-foreground">{unfiledCount}</span>
              </FilterLink>
            )}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="inline-flex rounded-md border p-0.5">
              <ViewTab href={filterHref({ view: undefined })} active={!isGraph} icon={List}>
                List
              </ViewTab>
              <ViewTab href={filterHref({ view: "graph" })} active={isGraph} icon={Network}>
                Graph
              </ViewTab>
            </div>
            <p className="text-xs text-muted-foreground">
              {visible.length} {visible.length === 1 ? "doc" : "docs"}
            </p>
          </div>

          {isGraph && graph ? (
            <>
              <p className="mb-3 rounded-md border bg-secondary/40 px-4 py-3 text-xs text-muted-foreground">
                Every circle is a document. Solid lines are links you wrote; dashed lines are docs
                that talk about the same things. Write{" "}
                <code className="rounded bg-background px-1 py-0.5">[[doc-slug]]</code> (or{" "}
                <code className="rounded bg-background px-1 py-0.5">[[Doc Title]]</code>) inside a
                document to link it here. Hover to trace a neighbourhood, drag to rearrange, scroll
                to zoom, click a node to open the doc.
              </p>
              {graph.nodes.length === 0 ? (
                <Card>
                  <div className="px-5 py-14 text-center text-sm text-muted-foreground">
                    No docs match this filter, so there is nothing to plot.
                  </div>
                </Card>
              ) : (
                <BrainGraph graph={graph} />
              )}
            </>
          ) : visible.length === 0 ? (
            <Card>
              <div className="px-5 py-14 text-center">
                <p className="text-sm font-medium">
                  {allDocs.length === 0 ? "Your brain is empty" : "No docs match this filter"}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  {allDocs.length === 0
                    ? "Add a doc to give your agents durable context. Mark it as “context” and approve it to load it into every session."
                    : "Try a different folder or kind."}
                </p>
              </div>
            </Card>
          ) : (
            <Card className="p-0">
              <div className="divide-y">
                {visible.map((doc) => {
                  const path = doc.folder_id ? folderById.get(doc.folder_id) : null;
                  return (
                    <Link
                      key={doc.id}
                      href={`/brain/${doc.slug}`}
                      className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-secondary/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium">{doc.title}</p>
                          {doc.kind === "context" && (
                            <Badge variant="secondary" className="gap-1">
                              <Compass className="size-3" />
                              context
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {snippetOf(doc.content) || "Empty doc"}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="capitalize">{doc.scope}</span>
                          {path && (
                            <>
                              <span>·</span>
                              <span>{path}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge
                          variant={REVIEW_VARIANT[doc.review_state]}
                          className="w-20 justify-center capitalize"
                        >
                          {doc.review_state}
                        </Badge>
                        <span className="w-10 text-right text-xs text-muted-foreground">
                          {timeAgo(doc.updated_at)}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function FilterLink({
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
        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {children}
    </Link>
  );
}

function ViewTab({
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
        "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
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
