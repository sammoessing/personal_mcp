import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace } from "@/lib/workspace/context";
import {
  CONNECTOR_REGISTRY,
  isConnectorConfigured,
  connectorCredentialEnv,
  type ConnectorProvider,
} from "@/lib/connectors/registry";
import { PageHeader } from "@/components/dashboard/page-header";
import { ConnectorCard } from "@/components/dashboard/connector-card";
import { CheckCircle2, XCircle } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; provider?: string; message?: string }>;
}) {
  const params = await searchParams;
  const ws = await requireCurrentWorkspace();
  const supabase = await createClient();
  const { data: connectors } = await supabase
    .from("connectors")
    .select("provider, status, account_label, last_error")
    .eq("workspace_id", ws.id)
    .order("provider");

  const cards = (connectors ?? []).map((row) => {
    const provider = row.provider as ConnectorProvider;
    const def = CONNECTOR_REGISTRY[provider];
    return {
      provider,
      displayName: def.displayName,
      description: def.description,
      status: row.status as "connected" | "disconnected" | "error",
      accountLabel: row.account_label,
      lastError: row.last_error,
      configured: isConnectorConfigured(provider),
      ...connectorCredentialEnv(provider),
    };
  });

  return (
    <>
      <PageHeader
        title="Connections"
        description="OAuth connectors for the tools and data sources you use day to day."
      />

      {params.status && (
        <div
          className={`mb-6 flex items-center gap-2 rounded-md border px-4 py-3 text-sm ${
            params.status === "connected"
              ? "border-success/30 bg-success/5 text-success"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          {params.status === "connected" ? (
            <CheckCircle2 className="size-4 shrink-0" />
          ) : (
            <XCircle className="size-4 shrink-0" />
          )}
          <span>
            {params.status === "connected"
              ? `${CONNECTOR_REGISTRY[params.provider as ConnectorProvider]?.displayName ?? params.provider} connected.`
              : `Couldn't connect ${params.provider}${params.message ? `: ${params.message}` : "."}`}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.map((connector) => (
          <ConnectorCard key={connector.provider} connector={connector} />
        ))}
      </div>
    </>
  );
}
