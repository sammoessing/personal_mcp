"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Building2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createWorkspaceAction } from "@/lib/actions/workspaces";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchWorkspaceAction } from "@/lib/actions/workspaces";
import type { Workspace } from "@/lib/workspace/context";

export function WorkspaceSwitcher({
  workspaces,
  current,
}: {
  workspaces: Workspace[];
  current: Workspace;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCreate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createWorkspaceAction(formData);
        setCreating(false);
        router.refresh();
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) throw err;
        setError(err instanceof Error ? err.message : "Could not create the workspace.");
      }
    });
  }

  function handleSelect(id: string) {
    if (id === current.id) return;
    startTransition(async () => {
      await switchWorkspaceAction(id);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary/60 disabled:opacity-60"
      >
        {current.logoUrl ? (
          // Arbitrary external host, so plain <img> rather than next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current.logoUrl} alt="" className="size-7 shrink-0 rounded-md object-cover" />
        ) : (
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="size-3.5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{current.name}</p>
          <p className="truncate text-[11px] capitalize text-muted-foreground">{current.role}</p>
        </div>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => handleSelect(workspace.id)}
            className="gap-2"
          >
            <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
            {workspace.id === current.id && <Check className="size-3.5 shrink-0" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setCreating(true)} className="gap-2">
          <Plus className="size-3.5 shrink-0" />
          New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <form action={handleCreate}>
            <DialogHeader>
              <DialogTitle>New workspace</DialogTitle>
              <DialogDescription>
                A separate tenant with its own brain, skills, connections, and audit trail. Nothing
                is shared with your other workspaces.
              </DialogDescription>
            </DialogHeader>

            <div className="my-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="workspace-name">Name</Label>
                <Input
                  id="workspace-name"
                  name="name"
                  required
                  autoComplete="off"
                  placeholder="Lowbook / PAC Auto Finance"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="workspace-description">Description</Label>
                <Textarea
                  id="workspace-description"
                  name="description"
                  rows={2}
                  placeholder="What this workspace is for — shown to agents connecting to it."
                />
              </div>
            </div>

            {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create workspace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </DropdownMenu>
  );
}
