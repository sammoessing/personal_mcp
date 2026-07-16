"use client";

import { useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setSkillStatusAction, type SkillStatus } from "@/lib/actions/skills";

const STATUSES: SkillStatus[] = ["draft", "review", "approved", "published"];

export function SkillStatusSelect({ slug, status }: { slug: string; status: SkillStatus }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Select
      value={status}
      disabled={isPending}
      onValueChange={(value) => startTransition(() => setSkillStatusAction(slug, value as SkillStatus))}
    >
      <SelectTrigger size="sm" className="w-36 capitalize">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="capitalize">
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
