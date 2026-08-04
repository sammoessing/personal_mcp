"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { FolderInput, Pencil, Archive, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { archiveDocAction, moveDocAction, deleteDocAction } from "@/lib/actions/brain";

const UNFILED = "__unfiled__";

/**
 * The per-row controls. Move and archive act in place; delete asks first,
 * because it is the only one of the three that cannot be undone.
 */
export function DocRowActions({
  slug,
  title,
  folder,
  folders,
}: {
  slug: string;
  title: string;
  folder: string | null;
  folders: string[];
}) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [destination, setDestination] = useState(folder ?? UNFILED);

  const run = (action: () => Promise<void>, done?: () => void) =>
    startTransition(async () => {
      try {
        await action();
        done?.();
      } catch (err) {
        // redirect() throws a control-flow signal that must not be swallowed.
        if (err && typeof err === "object" && "digest" in err) throw err;
      }
    });

  return (
    <div className="flex items-center gap-0.5">
      <IconButton label="Move to folder" onClick={() => setMoving(true)}>
        <FolderInput className="size-3.5" />
      </IconButton>

      <Link
        href={`/brain/${slug}`}
        title="Edit"
        aria-label="Edit"
        className={ICON_CLASS}
      >
        <Pencil className="size-3.5" />
      </Link>

      <IconButton
        label="Archive"
        disabled={isPending}
        onClick={() => run(() => archiveDocAction(slug))}
      >
        <Archive className="size-3.5" />
      </IconButton>

      <IconButton label="Delete" destructive onClick={() => setConfirming(true)}>
        <Trash2 className="size-3.5" />
      </IconButton>

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Move document</DialogTitle>
            <DialogDescription>Choose a folder for “{title}”.</DialogDescription>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () => moveDocAction(slug, destination === UNFILED ? null : destination),
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
            <DialogTitle>Delete this document?</DialogTitle>
            <DialogDescription>
              “{title}” will be permanently removed, along with any context it contributes to your
              agents. Archive it instead if you only want it out of the way.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => run(() => deleteDocAction(slug))}
            >
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const ICON_CLASS =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40";

function IconButton({
  label,
  children,
  destructive,
  ...props
}: React.ComponentProps<"button"> & { label: string; destructive?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={
        destructive
          ? "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          : ICON_CLASS
      }
      {...props}
    >
      {children}
    </button>
  );
}
