"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createDocAction } from "@/lib/actions/brain";
import { KIND_DESCRIPTION, type DocKind } from "@/lib/brain/types";

const KIND_OPTIONS: Array<{ value: DocKind; label: string }> = [
  { value: "context", label: "Context — loaded at the start of every session" },
  { value: "knowledge", label: "Knowledge — searchable reference, pulled on demand" },
];

const SCOPE_OPTIONS = [
  { value: "user", label: "Personal — just my agents" },
  { value: "team", label: "Team — everyone on my team" },
  { value: "company", label: "Company — everyone in this workspace" },
];

/** Guidance under the editor, which differs sharply between the two kinds. */
const CONTENT_HINT: Record<DocKind, string> = {
  context:
    "Loaded into your agents at the start of every session. For anything longer than a few standing rules, use Knowledge instead — agents search it on demand.",
  knowledge:
    "Not loaded automatically. Agents find this by searching, so lead with the terms someone would actually search for.",
};

const NEW_FOLDER = "__new__";

const selectClass =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function NewDocDialog({ folders }: { folders: string[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DocKind>("context");
  const [folderChoice, setFolderChoice] = useState("");

  function handleSubmit(formData: FormData) {
    setError(null);
    // A brand-new folder comes from the adjacent text input rather than the
    // select, so resolve which one the action should receive.
    if (formData.get("folder") === NEW_FOLDER) {
      formData.set("folder", String(formData.get("new_folder") ?? "").trim());
    }
    startTransition(async () => {
      try {
        await createDocAction(formData);
      } catch (err) {
        // redirect() throws a control-flow signal that must not be swallowed.
        if (err && typeof err === "object" && "digest" in err) throw err;
        setError(err instanceof Error ? err.message : "Could not create the document.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          New document
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New brain document</DialogTitle>
          <DialogDescription>
            Context is loaded into your agents at the start of every session — keep it short.
            Knowledge is a searchable reference agents pull from on demand.
          </DialogDescription>
        </DialogHeader>

        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              name="title"
              required
              placeholder="Support tone and escalation rules"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="kind">Kind</Label>
              <select
                id="kind"
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as DocKind)}
                className={selectClass}
              >
                {KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="scope">Scope</Label>
              <select id="scope" name="scope" defaultValue="user" className={selectClass}>
                {SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="folder">Folder</Label>
            <select
              id="folder"
              name="folder"
              value={folderChoice}
              onChange={(e) => setFolderChoice(e.target.value)}
              className={selectClass}
            >
              <option value="">No folder (top level)</option>
              {folders.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
              <option value={NEW_FOLDER}>New folder…</option>
            </select>
            {folderChoice === NEW_FOLDER && (
              <Input
                name="new_folder"
                autoFocus
                placeholder="Clients/Acme — slashes create nesting"
              />
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="content">Content (markdown)</Label>
            <Textarea
              id="content"
              name="content"
              rows={10}
              className="font-mono text-xs leading-relaxed"
              placeholder={
                kind === "context"
                  ? "Always respond in our brand voice…"
                  : "# Overview\n\nLink other docs with [[doc-slug]]."
              }
            />
            <p className="text-xs text-muted-foreground">{CONTENT_HINT[kind]}</p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creating…" : "Create document"}
            </Button>
          </DialogFooter>
        </form>

        <p className="sr-only">{KIND_DESCRIPTION[kind]}</p>
      </DialogContent>
    </Dialog>
  );
}
