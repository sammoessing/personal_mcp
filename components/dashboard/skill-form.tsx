"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export const VISIBILITY_OPTIONS = [
  { value: "private", label: "Private — only you and maintainers" },
  { value: "team", label: "Team — everyone on your team" },
  { value: "company", label: "Company — everyone in this workspace" },
  { value: "marketplace", label: "Marketplace — shareable beyond this workspace" },
] as const;

const SKILL_MD_PLACEHOLDER = `Write the instructions an agent should follow when it loads this skill.

A useful shape:
- When to use this skill
- The steps to follow, in order
- Facts or policies to verify before acting
- What to do when required context is missing`;

export type SkillFormValues = {
  name?: string;
  description?: string;
  visibility?: string;
  tags?: string[];
  content?: string;
};

/**
 * Client component so the SKILL.md character count updates as you type and a
 * failed save reports itself in place rather than replacing the page.
 */
export function SkillForm({
  action,
  initial,
  submitLabel = "Create skill",
  version,
}: {
  action: (formData: FormData) => Promise<void>;
  initial?: SkillFormValues;
  submitLabel?: string;
  /** Only supplied when editing; new skills start at the database default. */
  version?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState(initial?.content ?? "");

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await action(formData);
      } catch (err) {
        // redirect() throws a control-flow signal that must not be swallowed.
        if (err && typeof err === "object" && "digest" in err) throw err;
        setError(err instanceof Error ? err.message : "Could not save the skill.");
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Title</Label>
              <Input
                id="name"
                name="name"
                required
                defaultValue={initial?.name}
                placeholder="e.g. Customer Refund Playbook"
              />
            </div>
            {version !== undefined && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="version">Version</Label>
                <Input id="version" name="version" defaultValue={version} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              name="description"
              rows={3}
              defaultValue={initial?.description}
              placeholder="One or two sentences on when an agent should reach for this skill."
            />
            <p className="text-xs text-muted-foreground">
              This is what an agent reads to decide whether the skill applies, so describe the
              trigger, not the contents.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="visibility">Visibility</Label>
              <select
                id="visibility"
                name="visibility"
                defaultValue={initial?.visibility ?? "private"}
                className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                {VISIBILITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tags">Tags (comma separated)</Label>
              <Input
                id="tags"
                name="tags"
                defaultValue={initial?.tags?.join(", ")}
                placeholder="support, policy"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="content">SKILL.md — agent instructions</Label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {content.length.toLocaleString()} chars
            </span>
          </div>
          <Textarea
            id="content"
            name="content"
            rows={18}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="font-mono text-xs leading-relaxed"
            placeholder={SKILL_MD_PLACEHOLDER}
          />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
