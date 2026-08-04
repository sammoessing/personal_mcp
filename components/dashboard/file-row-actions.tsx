"use client";

import { useState, useTransition } from "react";
import { FolderInput, Download, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteFileAction, moveFileAction } from "@/lib/actions/files";

const UNFILED = "__unfiled__";

const ICON_CLASS =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40";

export function FileRowActions({
  id,
  name,
  folder,
  folders,
}: {
  id: string;
  name: string;
  folder: string | null;
  folders: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [moving, setMoving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [destination, setDestination] = useState(folder ?? UNFILED);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<void>, done?: () => void) =>
    startTransition(async () => {
      setError(null);
      try {
        await action();
        done?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        title="Move to folder"
        aria-label="Move to folder"
        className={ICON_CLASS}
        onClick={() => setMoving(true)}
      >
        <FolderInput className="size-3.5" />
      </button>

      {/* A plain link: the route mints a signed URL and redirects to it. */}
      <a
        href={`/api/brain/files/${id}/download`}
        title="Download"
        aria-label="Download"
        className={ICON_CLASS}
      >
        <Download className="size-3.5" />
      </a>

      <button
        type="button"
        title="Delete"
        aria-label="Delete"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-3.5" />
      </button>

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move file</DialogTitle>
            <DialogDescription>Choose a folder for “{name}”.</DialogDescription>
          </DialogHeader>
          <select
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            className="border-input h-9 rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <option value={UNFILED}>Unfiled</option>
            {folders.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () => moveFileAction(id, destination === UNFILED ? null : destination),
                  () => setMoving(false)
                )
              }
            >
              {isPending ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this file?</DialogTitle>
            <DialogDescription>
              “{name}” will be permanently removed from storage. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => run(() => deleteFileAction(id), () => setConfirming(false))}
            >
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
