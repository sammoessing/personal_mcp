"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Building2 } from "lucide-react";
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
