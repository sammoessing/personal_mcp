import { NextResponse } from "next/server";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "@/lib/connectors/registry";
import { disconnectConnector } from "@/lib/connectors/tokens";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { requireCurrentWorkspace, getSessionUser } from "@/lib/workspace/context";

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
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // Disconnecting a per-person connector only ever removes your own
  // connection, never a colleague's.
  await disconnectConnector({ workspaceId: ws.id, userId: user.id }, typedProvider);
  await appendAuditEvent(ws.id, "connector_disconnected", { provider: typedProvider });

  return NextResponse.json({ ok: true });
}
