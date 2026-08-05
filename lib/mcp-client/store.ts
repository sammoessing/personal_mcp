import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { refreshAccessToken } from "./oauth";

export type McpServerRow = {
  id: string;
  workspace_id: string;
  name: string;
  url: string;
  scope: "member" | "workspace";
  authorization_server: string | null;
  registration_endpoint: string | null;
  authorize_endpoint: string | null;
  token_endpoint: string | null;
  client_id: string | null;
  client_secret_enc: string | null;
  scopes_supported: string | null;
  last_error: string | null;
};

/** Who is asking. `userId` is required for member-scoped servers. */
export type McpActor = { workspaceId: string; userId: string | null };

export async function listServers(workspaceId: string): Promise<McpServerRow[]> {
  const { data } = await createServiceRoleClient()
    .from("mcp_servers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at");
  return (data ?? []) as McpServerRow[];
}

export async function getServer(
  workspaceId: string,
  serverId: string
): Promise<McpServerRow | null> {
  // Always filtered by workspace, so an id from another tenant is simply not
  // found rather than reachable.
  const { data } = await createServiceRoleClient()
    .from("mcp_servers")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", serverId)
    .maybeSingle();
  return (data as McpServerRow | null) ?? null;
}

/**
 * The connection row for this actor. A member-scoped server resolves only to
 * the caller's own row — a colleague's token is never a fallback. This filter
 * is the real boundary, since these queries use the service-role client and so
 * bypass RLS.
 */
export async function getConnection(server: McpServerRow, actor: McpActor) {
  const supabase = createServiceRoleClient();
  let query = supabase.from("mcp_connections").select("*").eq("server_id", server.id);

  if (server.scope === "member") {
    if (!actor.userId) return null;
    query = query.eq("user_id", actor.userId);
  } else {
    query = query.is("user_id", null);
  }

  const { data } = await query.maybeSingle();
  return data as
    | {
        id: string;
        access_token_enc: string;
        refresh_token_enc: string | null;
        expires_at: string | null;
      }
    | null;
}

export async function saveConnection(
  server: McpServerRow,
  actor: McpActor,
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date | null; scope: string | null }
) {
  const supabase = createServiceRoleClient();
  const userId = server.scope === "member" ? actor.userId : null;

  const existing = await getConnection(server, actor);
  const payload = {
    server_id: server.id,
    user_id: userId,
    access_token_enc: encrypt(tokens.accessToken),
    refresh_token_enc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    expires_at: tokens.expiresAt?.toISOString() ?? null,
    granted_scope: tokens.scope,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from("mcp_connections").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("mcp_connections").insert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteConnection(server: McpServerRow, actor: McpActor) {
  const existing = await getConnection(server, actor);
  if (!existing) return;
  await createServiceRoleClient().from("mcp_connections").delete().eq("id", existing.id);
}

/**
 * A usable access token for this actor, refreshing it first when it is close
 * to expiry. Throws a message meant to be shown, because the fix is always the
 * same: reconnect on the Connections page.
 */
export async function resolveAccessToken(
  server: McpServerRow,
  actor: McpActor
): Promise<string> {
  const connection = await getConnection(server, actor);
  if (!connection) {
    throw new Error(
      server.scope === "member"
        ? `You haven't connected ${server.name} yet — it is per person, so a colleague's connection does not cover you.`
        : `${server.name} is not connected in this workspace.`
    );
  }

  const expiresSoon = connection.expires_at
    ? new Date(connection.expires_at).getTime() < Date.now() + 60_000
    : false;

  if (expiresSoon && connection.refresh_token_enc && server.token_endpoint && server.client_id) {
    const refreshed = await refreshAccessToken({
      tokenEndpoint: server.token_endpoint,
      clientId: server.client_id,
      clientSecret: server.client_secret_enc ? decrypt(server.client_secret_enc) : null,
      refreshToken: decrypt(connection.refresh_token_enc),
      resource: server.url,
    });
    await saveConnection(server, actor, refreshed);
    return refreshed.accessToken;
  }

  return decrypt(connection.access_token_enc);
}

/** Which servers this actor can actually call right now. */
export async function listConnectedServers(actor: McpActor): Promise<McpServerRow[]> {
  const servers = await listServers(actor.workspaceId);
  const connected: McpServerRow[] = [];
  for (const server of servers) {
    if (await getConnection(server, actor)) connected.push(server);
  }
  return connected;
}
