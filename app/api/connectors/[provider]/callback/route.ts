import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "@/lib/connectors/registry";
import { exchangeCodeForToken } from "@/lib/connectors/oauth";
import { saveConnectorTokens } from "@/lib/connectors/tokens";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { createServiceRoleClient } from "@/lib/supabase/server";

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

  try {
    const tokens = await exchangeCodeForToken(typedProvider, code, url.origin);
    await saveConnectorTokens(typedProvider, tokens);

    if (tokens.accountLabel) {
      const supabase = createServiceRoleClient();
      await supabase
        .from("connectors")
        .update({ account_label: tokens.accountLabel })
        .eq("provider", typedProvider);
    }

    await appendAuditEvent("connector_connected", { provider: typedProvider });

    const response = redirectToConnections(url.origin, provider, "connected");
    response.cookies.delete(`oauth_state_${provider}`);
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth exchange failed";
    const supabase = createServiceRoleClient();
    await supabase
      .from("connectors")
      .update({ status: "error", last_error: message })
      .eq("provider", typedProvider);
    return redirectToConnections(url.origin, provider, "error", message);
  }
}
