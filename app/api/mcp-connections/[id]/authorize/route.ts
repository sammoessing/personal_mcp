import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { requireCurrentWorkspace, getSessionUser } from "@/lib/workspace/context";
import { getServer } from "@/lib/mcp-client/store";
import { buildAuthorizeUrl, createPkcePair, randomState } from "@/lib/mcp-client/oauth";

const STATE_TTL_SECONDS = 600;

/**
 * Starts the OAuth flow against a remote MCP server.
 *
 * The PKCE verifier is parked in the database rather than a cookie: the
 * callback may arrive on a different serverless instance, and it must be
 * bound to the member who started the flow.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const origin = new URL(request.url).origin;

  const ws = await requireCurrentWorkspace();
  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const server = await getServer(ws.id, id);
  if (!server) {
    return NextResponse.redirect(`${origin}/connections?mcp_error=Server+not+found`);
  }
  if (!server.authorize_endpoint || !server.client_id) {
    return NextResponse.redirect(
      `${origin}/connections?mcp_error=${encodeURIComponent(
        "That server has not finished registration. Remove it and add it again."
      )}`
    );
  }

  const { verifier, challenge } = createPkcePair();
  const state = randomState();
  const redirectUri = `${origin}/api/mcp-connections/callback`;

  const { error } = await createServiceRoleClient().from("mcp_auth_states").insert({
    state,
    server_id: server.id,
    user_id: user.id,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    expires_at: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) {
    return NextResponse.redirect(
      `${origin}/connections?mcp_error=${encodeURIComponent(error.message)}`
    );
  }

  // decrypt() only to confirm a stored secret is readable; the value itself is
  // used at the token step, not here.
  if (server.client_secret_enc) decrypt(server.client_secret_enc);

  return NextResponse.redirect(
    buildAuthorizeUrl({
      authorizeEndpoint: server.authorize_endpoint,
      clientId: server.client_id,
      redirectUri,
      state,
      challenge,
      scope: server.scopes_supported,
      resource: server.url,
    })
  );
}
