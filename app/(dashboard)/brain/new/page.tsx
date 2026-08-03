import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DocFormFields } from "@/components/dashboard/doc-form-fields";
import { createDocAction } from "@/lib/actions/brain";

export const dynamic = "force-dynamic";

export default async function NewDocPage() {
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data: folders } = await supabase.from("brain_folders").select("path").eq("workspace_id", ws.id).order("path");

  return (
    <>
      <PageHeader
        title="New doc"
        description="Docs start as drafts. Approve one to expose it to your MCP clients."
      />
      <Card className="max-w-3xl">
        <CardContent>
          <form action={createDocAction} className="flex flex-col gap-4">
            <DocFormFields folderOptions={(folders ?? []).map((f) => f.path)} />
            <div className="flex justify-end">
              <Button type="submit">Create doc</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
