import { createClient } from "@/lib/supabase/server";
import { requireCurrentWorkspace, getSessionUser } from "@/lib/workspace/context";
import {
  CONNECTOR_REGISTRY,
  CONNECTOR_LIST,
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
  const user = await getSessionUser();
  const supabase = await createClient();

  // Only rows this member is allowed to see: the workspace's shared
  // connections, plus their own personal ones. A colleague's Gmail row is
  // never fetched, so it cannot leak through the page either.
  const { data: connectors } = await supabase
    .from("connectors")
    .select("provider, status, account_label, last_error, user_id")
    .eq("workspace_id", ws.id)
    .or(`user_id.is.null,user_id.eq.${user?.id ?? ""}`);

  const rows = new Map(
    (connectors ?? []).map((row) => [row.provider as ConnectorProvider, row])
  );

  // Driven by the registry, not the table: a per-member connector has no row
  // until that person connects it, and the card still has to be there for them
  // to click.
  const cards = CONNECTOR_LIST.map((def) => {
    const row = rows.get(def.provider);
    return {
      provider: def.provider,
      displayName: def.displayName,
      description: def.description,
      scope: def.scope,
      permissions: def.permissions,
      status: (row?.status ?? "disconnected") as "connected" | "disconnected" | "error",
      accountLabel: row?.account_label ?? null,
      lastError: row?.last_error ?? null,
      configured: isConnectorConfigured(def.provider),
      ...connectorCredentialEnv(def.provider),
    };
  }).sort((a, b) => a.displayName.localeCompare(b.displayName));

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
          <ConnectorCard
            key={connector.provider}
            connector={connector}
            workspaceName={ws.name}
          />
        ))}
      </div>
    </>
  );
}
