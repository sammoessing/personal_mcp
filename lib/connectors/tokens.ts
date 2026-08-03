import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "./registry";

type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
};

/**
 * Connector rows exist once per workspace, so every lookup here is keyed on
 * (workspace_id, provider). A workspace can only ever reach its own
 * credentials — there is no code path that resolves a connector by provider
 * alone.
 */
async function connectorRow(workspaceId: string, provider: ConnectorProvider) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("connectors")
    .select("id, status")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .maybeSingle();
  return data;
}

export async function saveConnectorTokens(
  workspaceId: string,
  provider: ConnectorProvider,
  tokens: TokenSet
) {
  const supabase = createServiceRoleClient();
  const connector = await connectorRow(workspaceId, provider);
  if (!connector) throw new Error(`Unknown connector for this workspace: ${provider}`);

  const { error } = await supabase.from("oauth_tokens").upsert({
    connector_id: connector.id,
    access_token_enc: encrypt(tokens.accessToken),
    refresh_token_enc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    expires_at: tokens.expiresAt?.toISOString() ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  // Safe without a workspace filter: connector.id came from the scoped
  // connectorRow() lookup above.
  await supabase
    .from("connectors")
    .update({ status: "connected", connected_at: new Date().toISOString(), last_error: null })
    .eq("id", connector.id);
}

export async function disconnectConnector(workspaceId: string, provider: ConnectorProvider) {
  const supabase = createServiceRoleClient();
  const connector = await connectorRow(workspaceId, provider);
  if (!connector) return;

  // Same here — connector.id is already resolved within this workspace.
  await supabase.from("oauth_tokens").delete().eq("connector_id", connector.id);
  await supabase
    .from("connectors")
    .update({ status: "disconnected", connected_at: null, last_error: null })
    .eq("id", connector.id);
}

/** Returns a valid access token for this workspace's connector, refreshing it if expired. */
export async function getConnectorAccessToken(
  workspaceId: string,
  provider: ConnectorProvider
): Promise<string> {
  const supabase = createServiceRoleClient();
  const connector = await connectorRow(workspaceId, provider);
  if (!connector) throw new Error(`Unknown connector for this workspace: ${provider}`);
  if (connector.status !== "connected") {
    throw new Error(`${provider} is not connected in this workspace. Connect it on the Connections page first.`);
  }

  const { data: tokenRow } = await supabase
    .from("oauth_tokens")
    .select("access_token_enc, refresh_token_enc, expires_at")
    .eq("connector_id", connector.id)
    .maybeSingle();
  if (!tokenRow) throw new Error(`${provider} has no stored credentials in this workspace.`);

  const isExpired = tokenRow.expires_at
    ? new Date(tokenRow.expires_at).getTime() < Date.now() + 60_000
    : false;

  if (isExpired && tokenRow.refresh_token_enc) {
    const refreshed = await refreshAccessToken(provider, decrypt(tokenRow.refresh_token_enc));
    await saveConnectorTokens(workspaceId, provider, refreshed);
    return refreshed.accessToken;
  }

  return decrypt(tokenRow.access_token_enc);
}

async function refreshAccessToken(provider: ConnectorProvider, refreshToken: string): Promise<TokenSet> {
  const def = CONNECTOR_REGISTRY[provider];
  const credsProvider = def.sharesCredentialsWith ?? provider;
  const clientId = process.env[CONNECTOR_REGISTRY[credsProvider].clientIdEnv];
  const clientSecret = process.env[CONNECTOR_REGISTRY[credsProvider].clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(`${credsProvider} OAuth credentials are not configured.`);
  }

  const res = await fetch(def.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to refresh ${provider} token: HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? refreshToken,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
  };
}
