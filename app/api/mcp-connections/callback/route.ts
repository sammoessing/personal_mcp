import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { exchangeCode } from "@/lib/mcp-client/oauth";
import { saveConnection, type McpServerRow } from "@/lib/mcp-client/store";

function back(origin: string, message?: string) {
  const url = new URL("/connections", origin);
  if (message) url.searchParams.set("mcp_error", message);
  else url.searchParams.set("mcp_connected", "1");
  return NextResponse.redirect(url);
}

/**
 * Completes the OAuth flow. The state row carries the member who started it,
 * so the resulting token is filed against the right person even though the
 * provider redirect carries no session of its own.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return back(origin, oauthError);
  if (!code || !state) return back(origin, "The server did not return an authorization code.");

  const supabase = createServiceRoleClient();
  const { data: pending } = await supabase
    .from("mcp_auth_states")
    .select("*")
    .eq("state", state)
    .maybeSingle();

  // Single-use: consumed before anything else, so a replayed callback cannot
  // mint a second token.
  if (!pending) return back(origin, "That sign-in link has already been used or expired.");
  await supabase.from("mcp_auth_states").delete().eq("state", state);

  if (new Date(pending.expires_at).getTime() < Date.now()) {
    return back(origin, "That sign-in took too long. Try connecting again.");
  }

  const { data: serverRow } = await supabase
    .from("mcp_servers")
    .select("*")
    .eq("id", pending.server_id)
    .maybeSingle();
  const server = serverRow as McpServerRow | null;

  if (!server?.token_endpoint || !server.client_id) {
    return back(origin, "That server is no longer configured correctly.");
  }

  try {
    const tokens = await exchangeCode({
      tokenEndpoint: server.token_endpoint,
      clientId: server.client_id,
      clientSecret: server.client_secret_enc ? decrypt(server.client_secret_enc) : null,
      code,
      redirectUri: pending.redirect_uri,
      verifier: pending.code_verifier,
      resource: server.url,
    });

    await saveConnection(
      server,
      { workspaceId: server.workspace_id, userId: pending.user_id },
      tokens
    );

    await appendAuditEvent(server.workspace_id, "mcp_server_connected", {
      name: server.name,
      scope: server.scope,
    });

    return back(origin);
  } catch (err) {
    return back(origin, err instanceof Error ? err.message : "Could not complete the connection.");
  }
}
