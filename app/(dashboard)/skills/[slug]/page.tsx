import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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
  const supabase = await createClient();
  const { data: skill } = await supabase.from("skills").select("*").eq("slug", slug).maybeSingle();
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
      <Card className="max-w-3xl">
        <CardContent>
          <form action={updateWithSlug} className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" defaultValue={skill.name} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="version">Version</Label>
                <Input id="version" name="version" defaultValue={skill.version} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" defaultValue={skill.description} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="content">Content (markdown)</Label>
              <Textarea
                id="content"
                name="content"
                rows={16}
                className="font-mono text-xs"
                defaultValue={skill.content}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
