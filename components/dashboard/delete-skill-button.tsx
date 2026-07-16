"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteSkillAction } from "@/lib/actions/skills";

export function DeleteSkillButton({ slug }: { slug: string }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Delete this skill? This can't be undone.")) return;
    startTransition(() => deleteSkillAction(slug));
  }

  return (
    <Button variant="outline" size="sm" onClick={handleDelete} disabled={isPending}>
      <Trash2 className="size-3.5" />
      Delete
    </Button>
  );
}
