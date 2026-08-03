import { NextResponse } from "next/server";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "@/lib/connectors/registry";
import { disconnectConnector } from "@/lib/connectors/tokens";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { requireCurrentWorkspace } from "@/lib/workspace/context";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  if (!(provider in CONNECTOR_REGISTRY)) {
    return NextResponse.json({ error: "Unknown connector" }, { status: 404 });
  }
  const typedProvider = provider as ConnectorProvider;

  const ws = await requireCurrentWorkspace();
  await disconnectConnector(ws.id, typedProvider);
  await appendAuditEvent(ws.id, "connector_disconnected", { provider: typedProvider });

  return NextResponse.json({ ok: true });
}
