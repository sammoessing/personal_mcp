import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { SkillExposureToggle } from "@/components/dashboard/skill-exposure-toggle";
import { timeAgo } from "@/lib/format";
import { MCP_SERVED_SKILL_STATUSES } from "@/lib/mcp/tools/skills";

export const dynamic = "force-dynamic";

/** Mirrors the gate in lib/mcp/tools/skills.ts so the badge can't drift from reality. */
function isLive(skill: { status: string; mcp_exposed: boolean }) {
  return skill.mcp_exposed && MCP_SERVED_SKILL_STATUSES.includes(skill.status);
}

const STATUS_VARIANT = {
  draft: "outline",
  review: "warning",
  approved: "secondary",
  published: "success",
} as const;

export default async function SkillsPage() {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data: skills } = await supabase
    .from("skills")
    .select("*")
    .eq("workspace_id", ws.id)
    .order("updated_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="Skills"
        description="Claude Skills you've built, versioned, and published to this MCP server."
        action={
          <Button asChild size="sm">
            <Link href="/skills/new">
              <Plus className="size-4" />
              New skill
            </Link>
          </Button>
        }
      />

      {!skills || skills.length === 0 ? (
        <Card>
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No skills yet. Create your first one.
          </div>
        </Card>
      ) : (
        <Card className="p-0">
          <div className="divide-y">
            {skills.map((skill) => (
              <div key={skill.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <Link href={`/skills/${skill.slug}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{skill.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {skill.description || "No description"}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="capitalize">{skill.visibility ?? "private"}</span>
                    {(skill.tags ?? []).length > 0 && (
                      <>
                        <span>·</span>
                        <span className="truncate">{(skill.tags as string[]).join(", ")}</span>
                      </>
                    )}
                    {skill.usage_count > 0 && (
                      <>
                        <span>·</span>
                        <span>
                          used {skill.usage_count}
                          {skill.last_used_at ? ` · last ${timeAgo(skill.last_used_at)} ago` : ""}
                        </span>
                      </>
                    )}
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-4">
                  <span className="text-xs text-muted-foreground">v{skill.version}</span>
                  <Badge
                    variant={STATUS_VARIANT[skill.status as keyof typeof STATUS_VARIANT]}
                    className="w-20 justify-center capitalize"
                  >
                    {skill.status}
                  </Badge>
                  <Badge
                    variant={isLive(skill) ? "success" : "outline"}
                    className="w-16 justify-center"
                    title={
                      isLive(skill)
                        ? "Served to MCP clients"
                        : "Not served: needs to be approved or published, and MCP-exposed"
                    }
                  >
                    {isLive(skill) ? "Live" : "Not live"}
                  </Badge>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">MCP</span>
                    <SkillExposureToggle slug={skill.slug} exposed={skill.mcp_exposed} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                    {timeAgo(skill.updated_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
