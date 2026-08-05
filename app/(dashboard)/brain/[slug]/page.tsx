import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { formatBytes } from "@/lib/brain/files";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DocFormFields } from "@/components/dashboard/doc-form-fields";
import {
  DocReviewSelect,
  DocExposureToggle,
  DeleteDocButton,
} from "@/components/dashboard/doc-review-controls";
import { updateDocAction } from "@/lib/actions/brain";
import { extractWikiLinks, type BrainDoc } from "@/lib/brain/types";

export const dynamic = "force-dynamic";

export default async function DocDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("brain_docs")
    .select("*")
    .eq("workspace_id", ws.id)
    .eq("slug", slug)
    .maybeSingle<BrainDoc>();
  if (!doc) notFound();

  const [{ data: folders }, { data: folderRow }] = await Promise.all([
    supabase.from("brain_folders").select("path").eq("workspace_id", ws.id).order("path"),
    doc.folder_id
      ? supabase.from("brain_folders").select("path").eq("id", doc.folder_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Resolve [[wiki-links]] so cross-referenced docs are clickable, and broken
  // references are visible rather than silently dead.
  const linkedSlugs = extractWikiLinks(doc.content);
  const { data: linkedDocs } = linkedSlugs.length
    ? await supabase.from("brain_docs").select("slug, title").eq("workspace_id", ws.id).in("slug", linkedSlugs)
    : { data: [] };
  const linkedBySlug = new Map((linkedDocs ?? []).map((d) => [d.slug, d.title]));

  // Images embedded by an import are referenced from the body by URL. Pulling
  // the ids back out is what lets the page show that the pictures survived —
  // the editor is plain markdown, so they are otherwise invisible here.
  const embeddedImageIds = [
    ...new Set(
      [...doc.content.matchAll(/\/api\/brain\/images\/([0-9a-f-]{36})/gi)].map((m) => m[1])
    ),
  ];

  const { data: sourceFile } = doc.source_file_id
    ? await supabase
        .from("brain_files")
        .select("id, name, size_bytes")
        .eq("workspace_id", ws.id)
        .eq("id", doc.source_file_id)
        .maybeSingle()
    : { data: null };

  const updateWithSlug = updateDocAction.bind(null, slug);

  return (
    <>
      <PageHeader
        title={doc.title}
        description={`${doc.kind} · ${doc.scope}${folderRow?.path ? ` · ${folderRow.path}` : ""}`}
        action={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">MCP-exposed</span>
              <DocExposureToggle slug={doc.slug} exposed={doc.mcp_exposed} />
            </div>
            <DocReviewSelect slug={doc.slug} reviewState={doc.review_state} />
            <DeleteDocButton slug={doc.slug} />
          </div>
        }
      />

      {doc.kind === "context" && doc.review_state !== "approved" && (
        <div className="mb-6 rounded-md border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
          This is a context doc, but it isn&apos;t approved yet — it won&apos;t load into agent
          sessions until you set it to approved.
        </div>
      )}

      <Card className="max-w-3xl">
        <CardContent>
          <form action={updateWithSlug} className="flex flex-col gap-4">
            <DocFormFields doc={doc} folderPath={folderRow?.path ?? null} folderOptions={(folders ?? []).map((f) => f.path)} />
            <div className="flex justify-end">
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {(sourceFile || embeddedImageIds.length > 0) && (
        <Card className="mt-6 max-w-3xl">
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm font-medium">Original and images</p>

            {sourceFile && (
              <a
                href={`/api/brain/files/${sourceFile.id}/download`}
                className="flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <Paperclip className="size-3.5 shrink-0" />
                {sourceFile.name}
                <span className="text-xs">({formatBytes(sourceFile.size_bytes)})</span>
              </a>
            )}

            {embeddedImageIds.length > 0 && (
              <div className="flex flex-wrap gap-3">
                {embeddedImageIds.map((imageId) => (
                  // Arbitrary uploaded dimensions behind an auth-gated route,
                  // so a plain <img> rather than next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={imageId}
                    src={`/api/brain/images/${imageId}`}
                    alt=""
                    className="h-20 w-auto rounded-md border bg-secondary/30 object-contain p-1"
                  />
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Images kept from the import are referenced in the body as markdown. The original file
              is stored as-is, so nothing lost to text extraction is gone for good.
            </p>
          </CardContent>
        </Card>
      )}

      {linkedSlugs.length > 0 && (
        <Card className="mt-6 max-w-3xl">
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm font-medium">Linked docs</p>
            <div className="flex flex-wrap gap-2">
              {linkedSlugs.map((linked) =>
                linkedBySlug.has(linked) ? (
                  <Link
                    key={linked}
                    href={`/brain/${linked}`}
                    className="rounded-md border px-2 py-1 text-xs underline-offset-4 hover:bg-secondary/60"
                  >
                    {linkedBySlug.get(linked)}
                  </Link>
                ) : (
                  <span
                    key={linked}
                    className="rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground"
                    title="No doc with this slug"
                  >
                    {linked} (missing)
                  </span>
                )
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
