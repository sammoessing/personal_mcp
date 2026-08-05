"use client";

import { useState, useTransition } from "react";
import { Plus, Server, Lock, Users, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  addMcpServerAction,
  removeMcpServerAction,
  disconnectMcpServerAction,
} from "@/lib/actions/mcp-servers";

export type McpServerCardData = {
  id: string;
  name: string;
  url: string;
  scope: "member" | "workspace";
  connected: boolean;
};

const selectClass =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

export function McpServerCard({
  server,
  workspaceName,
}: {
  server: McpServerCardData;
  workspaceName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isMember = server.scope === "member";

  const run = (action: () => Promise<void>) =>
    startTransition(async () => {
      setError(null);
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
            <Server className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium">{server.name}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{server.url}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {isMember ? <Lock className="size-3" /> : <Users className="size-3" />}
              {isMember
                ? "Your own account — private to you."
                : `Shared by everyone in ${workspaceName}.`}
            </p>
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant={server.connected ? "success" : "outline"}>
            {server.connected ? "Connected" : "Not connected"}
          </Badge>

          {server.connected ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => run(() => disconnectMcpServerAction(server.id))}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => run(() => removeMcpServerAction(server.id))}
              >
                Remove
              </Button>
              {/* A plain link: the route redirects out to the provider. */}
              <Button variant="connect" size="sm" asChild>
                <a href={`/api/mcp-connections/${server.id}/authorize`}>Connect my account</a>
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Adding a server runs discovery and dynamic client registration up front, so
 * an unsupported server fails here with a reason rather than halfway through a
 * redirect to somewhere the person cannot debug.
 */
export function AddMcpServerDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    formData.set("origin", window.location.origin);
    startTransition(async () => {
      try {
        await addMcpServerAction(formData);
        setOpen(false);
      } catch (err) {
        if (err && typeof err === "object" && "digest" in err) throw err;
        setError(err instanceof Error ? err.message : "Could not add that server.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" />
          Add MCP server
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add an MCP server</DialogTitle>
            <DialogDescription>
              Paste the server&apos;s URL. This app registers itself with it automatically, so
              there is no client id or secret to create.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-name">Name</Label>
              <Input id="mcp-name" name="name" required placeholder="Linear" autoComplete="off" />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-url">Server URL</Label>
              <Input
                id="mcp-url"
                name="url"
                required
                placeholder="https://mcp.linear.app/mcp"
                autoComplete="off"
                className="font-mono text-xs"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-scope">Who connects</Label>
              <select id="mcp-scope" name="scope" defaultValue="member" className={selectClass}>
                <option value="member">Each person connects their own account</option>
                <option value="workspace">One shared connection for the whole workspace</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Per person for anything tied to an individual login. Shared for a service account
                everyone should act through.
              </p>
            </div>
          </div>

          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Registering…
                </>
              ) : (
                "Add server"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
