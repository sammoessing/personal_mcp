import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { createSkillAction } from "@/lib/actions/skills";

export default function NewSkillPage() {
  return (
    <>
      <PageHeader
        title="New skill"
        description="Skills start as drafts — publish and expose to MCP when ready."
      />
      <Card className="max-w-2xl">
        <CardContent>
          <form action={createSkillAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required placeholder="quarterly-report-writer" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                placeholder="Drafts quarterly reports from raw metrics."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="content">Content (markdown)</Label>
              <Textarea
                id="content"
                name="content"
                rows={12}
                className="font-mono text-xs"
                placeholder="# Instructions..."
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit">Create skill</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
