import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { PageHeader } from "@/components/dashboard/page-header";
import { SkillForm } from "@/components/dashboard/skill-form";
import { SkillStatusSelect } from "@/components/dashboard/skill-status-select";
import { SkillExposureToggle } from "@/components/dashboard/skill-exposure-toggle";
import { DeleteSkillButton } from "@/components/dashboard/delete-skill-button";
import { updateSkillAction, type SkillStatus } from "@/lib/actions/skills";

export const dynamic = "force-dynamic";

export default async function SkillDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data: skill } = await supabase.from("skills").select("*").eq("workspace_id", ws.id).eq("slug", slug).maybeSingle();
  if (!skill) notFound();

  const updateWithSlug = updateSkillAction.bind(null, slug);

  return (
    <>
      <PageHeader
        title={skill.name}
        description={`/${skill.slug}`}
        action={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">MCP-exposed</span>
              <SkillExposureToggle slug={skill.slug} exposed={skill.mcp_exposed} />
            </div>
            <SkillStatusSelect slug={skill.slug} status={skill.status as SkillStatus} />
            <DeleteSkillButton slug={skill.slug} />
          </div>
        }
      />
      <SkillForm
        action={updateWithSlug}
        submitLabel="Save changes"
        version={skill.version}
        initial={{
          name: skill.name,
          description: skill.description,
          visibility: skill.visibility,
          tags: skill.tags,
          content: skill.content,
        }}
      />
    </>
  );
}
