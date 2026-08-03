"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConnectorIcon } from "./connector-icon";
import type { ConnectorProvider } from "@/lib/connectors/registry";

export type ConnectorCardData = {
  provider: ConnectorProvider;
  displayName: string;
  description: string;
  status: "connected" | "disconnected" | "error";
  accountLabel: string | null;
  lastError: string | null;
  configured: boolean;
  /** Named explicitly rather than derived from the provider, which is wrong for the shared Google app. */
  clientIdEnv: string;
  clientSecretEnv: string;
};

export function ConnectorCard({ connector }: { connector: ConnectorCardData }) {
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
            {connector.status === "connected" && connector.accountLabel && (
              <p className="mt-1 text-xs text-muted-foreground">{connector.accountLabel}</p>
            )}
            {connector.status === "error" && connector.lastError && (
              <p className="mt-1 text-xs text-destructive">{connector.lastError}</p>
            )}
            {!connector.configured && connector.status !== "connected" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Set {connector.clientIdEnv} / {connector.clientSecretEnv} to enable.
              </p>
            )}
            {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant={connector.status === "connected" ? "success" : connector.status === "error" ? "destructive" : "outline"}>
            {connector.status === "connected" ? "Connected" : connector.status === "error" ? "Error" : "Not connected"}
          </Badge>
          {connector.status === "connected" ? (
            <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={isPending}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" disabled={!connector.configured} asChild={connector.configured}>
              {connector.configured ? (
                <a href={`/api/connectors/${connector.provider}/authorize`}>Connect</a>
              ) : (
                <span>Connect</span>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
