import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "@/lib/connectors/registry";
import { exchangeCodeForToken } from "@/lib/connectors/oauth";
import {
  saveConnectorTokens,
  setConnectorAccountLabel,
  markConnectorError,
} from "@/lib/connectors/tokens";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { requireCurrentWorkspace, getSessionUser } from "@/lib/workspace/context";

function redirectToConnections(
  origin: string,
  provider: string,
  status: "connected" | "error",
  message?: string
) {
  const dest = new URL("/connections", origin);
  dest.searchParams.set("status", status);
  dest.searchParams.set("provider", provider);
  if (message) dest.searchParams.set("message", message);
  return NextResponse.redirect(dest);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (!(provider in CONNECTOR_REGISTRY)) {
    return redirectToConnections(url.origin, provider, "error", "Unknown connector");
  }
  const typedProvider = provider as ConnectorProvider;

  if (oauthError) {
    return redirectToConnections(url.origin, provider, "error", oauthError);
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(`oauth_state_${provider}`)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToConnections(url.origin, provider, "error", "Invalid OAuth state");
  }

  // Credentials are stored against the workspace the browser is currently in,
  // and — for per-person connectors — against the member who authorized them.
  const ws = await requireCurrentWorkspace();
  const user = await getSessionUser();
  if (!user) {
    return redirectToConnections(url.origin, provider, "error", "You must be signed in to connect.");
  }
  const actor = { workspaceId: ws.id, userId: user.id };

  try {
    const tokens = await exchangeCodeForToken(typedProvider, code, url.origin);
    await saveConnectorTokens(actor, typedProvider, tokens);

    if (tokens.accountLabel) {
      await setConnectorAccountLabel(actor, typedProvider, tokens.accountLabel);
    }

    await appendAuditEvent(ws.id, "connector_connected", { provider: typedProvider });

    const response = redirectToConnections(url.origin, provider, "connected");
    response.cookies.delete(`oauth_state_${provider}`);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth exchange failed";
    await markConnectorError(actor, typedProvider, message);
    return redirectToConnections(url.origin, provider, "error", message);
  }
}
