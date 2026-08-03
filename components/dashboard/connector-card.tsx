"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, Users, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConnectorIcon } from "./connector-icon";
import type { ConnectorProvider, ConnectorScope } from "@/lib/connectors/registry";

export type ConnectorCardData = {
  provider: ConnectorProvider;
  displayName: string;
  description: string;
  scope: ConnectorScope;
  permissions: string[];
  status: "connected" | "disconnected" | "error";
  accountLabel: string | null;
  lastError: string | null;
  configured: boolean;
  /** Named explicitly rather than derived from the provider, which is wrong for the shared Google app. */
  clientIdEnv: string;
  clientSecretEnv: string;
};

/**
 * The consent step. Authorizing hands a third party ongoing access to an
 * account, so the click that starts it shows what is being granted and who
 * ends up able to use it — rather than bouncing straight out to the provider.
 */
function AuthorizeDialog({
  connector,
  workspaceName,
}: {
  connector: ConnectorCardData;
  workspaceName: string;
}) {
  const isMember = connector.scope === "member";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="connect" size="sm">
          Connect
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-secondary">
            <ConnectorIcon provider={connector.provider} className="size-5" />
          </div>
          <DialogTitle>Connect {connector.displayName}</DialogTitle>
          <DialogDescription>
            You&apos;ll be sent to {connector.displayName} to sign in and approve access. You can
            disconnect at any time from this page.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-secondary/40 p-3">
          <p className="mb-2 text-xs font-medium">This will be able to:</p>
          <ul className="flex flex-col gap-1.5">
            {connector.permissions.map((permission) => (
              <li key={permission} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Check className="mt-0.5 size-3 shrink-0 text-foreground" />
                {permission}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-start gap-2 rounded-md border p-3 text-xs text-muted-foreground">
          {isMember ? (
            <Lock className="mt-0.5 size-3.5 shrink-0 text-foreground" />
          ) : (
            <Users className="mt-0.5 size-3.5 shrink-0 text-foreground" />
          )}
          <div>
            <p className="font-medium text-foreground">
              {isMember ? "Private to you" : `Shared across ${workspaceName}`}
            </p>
            <p className="mt-0.5">
              {isMember
                ? `This connects your own ${connector.displayName} account. Nobody else in ${workspaceName} can use it or see its data.`
                : `Everyone in ${workspaceName} will be able to use this connection. No other workspace can.`}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Every call made through this connection is recorded in {workspaceName}&apos;s audit trail.
        </p>

        {!connector.configured && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            This connector isn&apos;t set up yet. Add {connector.clientIdEnv} and{" "}
            {connector.clientSecretEnv} to the deployment&apos;s environment variables, then
            redeploy.
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="connect" disabled={!connector.configured} asChild={connector.configured}>
            {connector.configured ? (
              <a href={`/api/connectors/${connector.provider}/authorize`}>
                Continue to {connector.displayName}
                <ExternalLink className="size-3.5" />
              </a>
            ) : (
              <span>Continue to {connector.displayName}</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectorCard({
  connector,
  workspaceName,
}: {
  connector: ConnectorCardData;
  workspaceName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDisconnect() {
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/connectors/${connector.provider}/disconnect`, { method: "POST" });
      if (!res.ok) {
        setError("Failed to disconnect.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
            <ConnectorIcon provider={connector.provider} className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">{connector.displayName}</p>
            <p className="text-xs text-muted-foreground">{connector.description}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {connector.scope === "member" ? (
                <>
                  <Lock className="size-3" />
                  Your own account — private to you.
                </>
              ) : (
                <>
                  <Users className="size-3" />
                  Shared by everyone in this workspace.
                </>
              )}
            </p>
            {connector.status === "connected" && connector.accountLabel && (
              <p className="mt-1 text-xs text-muted-foreground">{connector.accountLabel}</p>
            )}
            {connector.status === "error" && connector.lastError && (
              <p className="mt-1 text-xs text-destructive">{connector.lastError}</p>
            )}
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge
            variant={
              connector.status === "connected"
                ? "success"
                : connector.status === "error"
                  ? "destructive"
                  : "outline"
            }
          >
            {connector.status === "connected"
              ? "Connected"
              : connector.status === "error"
                ? "Error"
                : "Not connected"}
          </Badge>
          {connector.status === "connected" ? (
            <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={isPending}>
              Disconnect
            </Button>
          ) : (
            // Always clickable, even when unconfigured — the dialog is where
            // the setup gap gets explained, rather than a dead grey button.
            <AuthorizeDialog connector={connector} workspaceName={workspaceName} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
