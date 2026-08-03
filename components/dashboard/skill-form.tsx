"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { parseSkillMarkdown, humanizeSkillName } from "@/lib/skills/parse";
import { snapshotDrop, readSkillFromDrop, type DropSnapshot } from "@/lib/skills/drop";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [imported, setImported] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // dragenter/dragleave fire for every child element the cursor crosses, so a
  // boolean flickers off as soon as you move over the textarea inside the drop
  // zone. Counting enters against leaves keeps the overlay stable.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  /**
   * Without this, a drop that lands a few pixels outside the drop zone hits the
   * document instead, and the browser's default is to *navigate away* to the
   * dropped file — losing everything typed into the form.
   */
  useEffect(() => {
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  /**
   * Frontmatter fills Title and Description, so a downloaded skill lands ready
   * to save instead of needing its fields retyped.
   */
  function applySkillMarkdown(markdown: string, label: string) {
    const parsed = parseSkillMarkdown(markdown);
    if (!parsed.body && !parsed.name) {
      setError(`${label} looks empty — nothing to import from it.`);
      return;
    }
    setContent(parsed.body);
    // Only fill empty fields, so an import can't silently overwrite something
    // already typed.
    if (parsed.name && !name) setName(humanizeSkillName(parsed.name));
    if (parsed.description && !description) setDescription(parsed.description);
    setImported(label);
  }

  async function importSnapshot(snapshot: DropSnapshot) {
    setError(null);
    setImported(null);
    try {
      const { markdown, label } = await readSkillFromDrop(snapshot);
      applySkillMarkdown(markdown, label);
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Could not read that. Drop a SKILL.md, a .zip bundle, or the skill folder."
      );
    }
  }

  /** The picker only ever yields plain files, so it reuses the same path. */
  function importPickedFiles(files: File[]) {
    void importSnapshot({ entries: [], files });
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function handleDragOver(e: React.DragEvent) {
    // A drop event only fires at all if dragover's default was prevented.
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setDragging(false);
    // Must read the DataTransfer synchronously — it is emptied once the handler
    // returns.
    void importSnapshot(snapshotDrop(e.dataTransfer));
  }

  const dropHandlers = {
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

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
                value={name}
                onChange={(e) => setName(e.target.value)}
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
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="content">SKILL.md — agent instructions</Label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <Upload className="size-3" />
                Import file
              </button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {content.length.toLocaleString()} chars
              </span>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.zip"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) importPickedFiles(files);
              // Reset so re-picking the same file fires change again.
              e.target.value = "";
            }}
          />

          {/*
            The drop target wraps the editor rather than replacing it, so a file
            can be dropped at any point without clearing what is already typed
            or hiding the text you are working on.
          */}
          <div
            {...dropHandlers}
            className={cn(
              "relative rounded-md transition-colors",
              dragging && "ring-2 ring-ring ring-offset-2"
            )}
          >
            <Textarea
              id="content"
              name="content"
              rows={18}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              // A textarea has its own native file-drop behaviour, so it needs
              // the handlers directly rather than relying on the wrapper.
              {...dropHandlers}
              className="font-mono text-xs leading-relaxed"
              placeholder={SKILL_MD_PLACEHOLDER}
            />
            {dragging && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border-2 border-dashed border-ring bg-background/90">
                <p className="text-sm font-medium">Drop SKILL.md, a .zip bundle, or a skill folder</p>
              </div>
            )}
          </div>

          {imported ? (
            <p className="text-xs text-success">
              Loaded from {imported}. Title and description were filled from its frontmatter where
              they were empty.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Drag in a downloaded SKILL.md or .zip skill bundle to fill this in.
            </p>
          )}
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
