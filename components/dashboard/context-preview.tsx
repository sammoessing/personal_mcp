"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, RefreshCw, FolderPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFolderAction } from "@/lib/actions/brain";

/**
 * Shows the exact text agents receive as standing context, assembled the same
 * way brain_context_get assembles it. Guessing what your agents are being told
 * is the failure mode this exists to prevent.
 */
export function ContextPreview({ context, tokens }: { context: string; tokens: number }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="size-3.5" />
          Preview context
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Standing context</DialogTitle>
          <DialogDescription>
            Exactly what every agent session receives up front — approved context docs only, merged
            with provenance headers. Roughly {tokens.toLocaleString()} tokens.
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-md border bg-secondary/40 p-4 font-mono text-xs leading-relaxed">
          {context || "No context docs have been approved yet, so agents start with nothing."}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

export function RefreshButton() {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        setSpinning(true);
        router.refresh();
        // Purely cosmetic: router.refresh() gives no completion signal, so the
        // spin is timed rather than tied to the request.
        setTimeout(() => setSpinning(false), 600);
      }}
    >
      <RefreshCw className={spinning ? "size-3.5 animate-spin" : "size-3.5"} />
      Refresh
    </Button>
  );
}

export function NewFolderButton() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title="New folder"
          aria-label="New folder"
          className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <FolderPlus className="size-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form
          action={async (formData) => {
            await createFolderAction(formData);
            setOpen(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Use a slash for nesting, e.g. <code>Sales/Proposals</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 flex flex-col gap-1.5">
            <Label htmlFor="path">Folder name</Label>
            <Input id="path" name="path" required placeholder="Meetings" autoComplete="off" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create folder</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
