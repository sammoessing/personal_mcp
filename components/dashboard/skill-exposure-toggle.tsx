"use client";

import { useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { setSkillMcpExposedAction } from "@/lib/actions/skills";

export function SkillExposureToggle({ slug, exposed }: { slug: string; exposed: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Switch
      checked={exposed}
      disabled={isPending}
      onCheckedChange={(checked) => startTransition(() => setSkillMcpExposedAction(slug, checked))}
    />
  );
}
