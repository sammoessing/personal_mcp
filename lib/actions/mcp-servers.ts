"use server";

import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { appendAuditEvent } from "@/lib/audit/hash-chain";
import { requireCurrentWorkspace, getSessionUser } from "@/lib/workspace/context";
import { discoverAuthMetadata, registerClient } from "@/lib/mcp-client/discovery";
import { getServer, deleteConnection } from "@/lib/mcp-client/store";

/** The callback every dynamic registration is bound to. */
export async function mcpRedirectUri(origin: string): Promise<string> {
  return `${origin}/api/mcp-connections/callback`;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("That doesn't look like a URL. Paste the full https:// address of the server.");
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("MCP servers must be https — tokens would otherwise travel in the clear.");
  }
  return url.toString().replace(/\/$/, "");
}

/**
 * Adds a remote MCP server and runs discovery plus dynamic client
 * registration immediately, so a failure surfaces here rather than halfway
 * through an OAuth redirect.
 */
export async function addMcpServerAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const rawUrl = String(formData.get("url") ?? "");
  const scope = String(formData.get("scope") ?? "member") === "workspace" ? "workspace" : "member";
  const origin = String(formData.get("origin") ?? "").trim();

  if (!name) throw new Error("Give the server a name.");
  const url = normalizeUrl(rawUrl);
  if (!origin) throw new Error("Missing origin.");

  const ws = await requireCurrentWorkspace();
  const user = await getSessionUser();
  const supabase = createServiceRoleClient();

  const metadata = await discoverAuthMetadata(url);

  let clientId: string | null = null;
  let clientSecret: string | null = null;
  if (metadata.registrationEndpoint) {
    const registered = await registerClient(
      metadata.registrationEndpoint,
      await mcpRedirectUri(origin)
    );
    clientId = registered.clientId;
    clientSecret = registered.clientSecret;
  } else {
    // No registration endpoint means the server expects a pre-registered
    // client, which is the very setup this feature exists to avoid.
    throw new Error(
      "That server doesn't support dynamic client registration, so it needs an OAuth app registered by hand. Ask whoever runs it for a client id."
    );
  }

  const { error } = await supabase.from("mcp_servers").upsert(
    {
      workspace_id: ws.id,
      name,
      url,
      scope,
      authorization_server: metadata.authorizationServer,
      registration_endpoint: metadata.registrationEndpoint,
      authorize_endpoint: metadata.authorizeEndpoint,
      token_endpoint: metadata.tokenEndpoint,
      client_id: clientId,
      client_secret_enc: clientSecret ? encrypt(clientSecret) : null,
      scopes_supported: metadata.scopesSupported,
      last_error: null,
      created_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,url" }
  );
  if (error) throw new Error(error.message);

  await appendAuditEvent(ws.id, "mcp_server_added", { name, url, scope });
  revalidatePath("/connections");
}

export async function removeMcpServerAction(serverId: string) {
  const ws = await requireCurrentWorkspace();
  const server = await getServer(ws.id, serverId);
  if (!server) throw new Error("Server not found in this workspace.");

  await createServiceRoleClient().from("mcp_servers").delete().eq("id", server.id);
  await appendAuditEvent(ws.id, "mcp_server_removed", { name: server.name, url: server.url });
  revalidatePath("/connections");
}

/** Disconnects only the caller's own connection when the server is per-member. */
export async function disconnectMcpServerAction(serverId: string) {
  const ws = await requireCurrentWorkspace();
  const user = await getSessionUser();
  const server = await getServer(ws.id, serverId);
  if (!server) throw new Error("Server not found in this workspace.");

  await deleteConnection(server, { workspaceId: ws.id, userId: user?.id ?? null });
  await appendAuditEvent(ws.id, "mcp_server_disconnected", { name: server.name });
  revalidatePath("/connections");
}
