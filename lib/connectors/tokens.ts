import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "./registry";

type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
};

export async function saveConnectorTokens(provider: ConnectorProvider, tokens: TokenSet) {
  const supabase = createServiceRoleClient();
  const { data: connector, error: connectorError } = await supabase
    .from("connectors")
    .select("id")
    .eq("provider", provider)
    .single();
  if (connectorError || !connector) throw new Error(`Unknown connector: ${provider}`);

  const { error } = await supabase.from("oauth_tokens").upsert({
    connector_id: connector.id,
    access_token_enc: encrypt(tokens.accessToken),
    refresh_token_enc: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    expires_at: tokens.expiresAt?.toISOString() ?? null,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  await supabase
    .from("connectors")
    .update({ status: "connected", connected_at: new Date().toISOString(), last_error: null })
    .eq("id", connector.id);
}

export async function disconnectConnector(provider: ConnectorProvider) {
  const supabase = createServiceRoleClient();
  const { data: connector } = await supabase
    .from("connectors")
    .select("id")
    .eq("provider", provider)
    .single();
  if (!connector) return;

  await supabase.from("oauth_tokens").delete().eq("connector_id", connector.id);
  await supabase
    .from("connectors")
    .update({ status: "disconnected", connected_at: null, last_error: null })
    .eq("id", connector.id);
}

/** Returns a valid access token for the connector, refreshing it first if it's expired and a refresh token is on file. */
export async function getConnectorAccessToken(provider: ConnectorProvider): Promise<string> {
  const supabase = createServiceRoleClient();
  const { data: connector } = await supabase
    .from("connectors")
    .select("id, status")
    .eq("provider", provider)
    .single();
  if (!connector) throw new Error(`Unknown connector: ${provider}`);
  if (connector.status !== "connected") {
    throw new Error(`${provider} is not connected. Connect it on the Connections page first.`);
  }

  const { data: tokenRow } = await supabase
    .from("oauth_tokens")
    .select("access_token_enc, refresh_token_enc, expires_at")
    .eq("connector_id", connector.id)
    .maybeSingle();
  if (!tokenRow) throw new Error(`${provider} has no stored credentials.`);

  const isExpired = tokenRow.expires_at
    ? new Date(tokenRow.expires_at).getTime() < Date.now() + 60_000
    : false;

  if (isExpired && tokenRow.refresh_token_enc) {
    const refreshed = await refreshAccessToken(provider, decrypt(tokenRow.refresh_token_enc));
    await saveConnectorTokens(provider, refreshed);
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
