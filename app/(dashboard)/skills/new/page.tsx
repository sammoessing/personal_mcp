import { PageHeader } from "@/components/dashboard/page-header";
import { SkillForm } from "@/components/dashboard/skill-form";
import { createSkillAction } from "@/lib/actions/skills";

export default function NewSkillPage() {
  return (
    <>
      <PageHeader
        title="Create a skill"
        description="Author a new skill bundle, then publish it into the review queue."
      />
      <SkillForm action={createSkillAction} submitLabel="Create skill" />
    </>
  );
}
