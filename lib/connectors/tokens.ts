import { createServiceRoleClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/crypto";
import { CONNECTOR_REGISTRY, type ConnectorProvider } from "./registry";

type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
};

/**
 * Who is asking for a connector. `userId` is required for member-scoped
 * providers and ignored for workspace-scoped ones, so callers can pass the
 * acting member unconditionally.
 */
export type ConnectorActor = {
  workspaceId: string;
  userId: string | null;
};

/**
 * Every lookup is keyed on (workspace_id, provider) plus, for member-scoped
 * providers, the owning user. There is no code path that resolves a connector
 * by provider alone, and none that resolves a member-scoped connector without
 * a user id — the filter below is the real boundary, because these queries run
 * through the service-role client and so bypass RLS.
 */
async function connectorRow(actor: ConnectorActor, provider: ConnectorProvider) {
  const supabase = createServiceRoleClient();
  let query = supabase
    .from("connectors")
    .select("id, status")
    .eq("workspace_id", actor.workspaceId)
    .eq("provider", provider);

  if (CONNECTOR_REGISTRY[provider].scope === "member") {
    if (!actor.userId) {
      throw new Error(
        `${provider} is connected per person, and this request has no member identity. ` +
          "Reconnect the client so its token is bound to your account."
      );
    }
    query = query.eq("user_id", actor.userId);
  } else {
    query = query.is("user_id", null);
  }

  const { data } = await query.maybeSingle();
  return data;
}

/**
 * Creates the connector row on demand. Rows are no longer pre-seeded for
 * member-scoped providers — there is nothing to seed until a specific person
 * connects one.
 */
async function ensureConnectorRow(actor: ConnectorActor, provider: ConnectorProvider) {
  const existing = await connectorRow(actor, provider);
  if (existing) return existing;

  const def = CONNECTOR_REGISTRY[provider];
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("connectors")
    .insert({
      workspace_id: actor.workspaceId,
      user_id: def.scope === "member" ? actor.userId : null,
      provider,
      display_name: def.displayName,
      scopes: def.scopes,
    })
    .select("id, status")
    .single();
  if (error) throw error;
  return data;
}

export async function saveConnectorTokens(
  actor: ConnectorActor,
  provider: ConnectorProvider,
  tokens: TokenSet
) {
  const supabase = createServiceRoleClient();
  const connector = await ensureConnectorRow(actor, provider);

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

/**
 * Both of these go through connectorRow() rather than filtering on
 * (workspace_id, provider) directly — for a member-scoped provider that filter
 * matches every member's row, so a stray update would rewrite colleagues'
 * connection state.
 */
export async function setConnectorAccountLabel(
  actor: ConnectorActor,
  provider: ConnectorProvider,
  accountLabel: string
) {
  const connector = await connectorRow(actor, provider);
  if (!connector) return;
  await createServiceRoleClient()
    .from("connectors")
    .update({ account_label: accountLabel })
    .eq("id", connector.id);
}

export async function markConnectorError(
  actor: ConnectorActor,
  provider: ConnectorProvider,
  message: string
) {
  const connector = await connectorRow(actor, provider);
  if (!connector) return;
  await createServiceRoleClient()
    .from("connectors")
    .update({ status: "error", last_error: message })
    .eq("id", connector.id);
}

export async function disconnectConnector(actor: ConnectorActor, provider: ConnectorProvider) {
  const supabase = createServiceRoleClient();
  const connector = await connectorRow(actor, provider);
  if (!connector) return;

  // Same here — connector.id is already resolved within this workspace.
  await supabase.from("oauth_tokens").delete().eq("connector_id", connector.id);
  await supabase
    .from("connectors")
    .update({ status: "disconnected", connected_at: null, last_error: null })
    .eq("id", connector.id);
}

/** Returns a valid access token for this actor's connector, refreshing it if expired. */
export async function getConnectorAccessToken(
  actor: ConnectorActor,
  provider: ConnectorProvider
): Promise<string> {
  const supabase = createServiceRoleClient();
  const connector = await connectorRow(actor, provider);
  const scope = CONNECTOR_REGISTRY[provider].scope;
  if (!connector || connector.status !== "connected") {
    throw new Error(
      scope === "member"
        ? `You haven't connected ${provider} yet. Connect it on the Connections page — it is per person, so a colleague's connection does not cover you.`
        : `${provider} is not connected in this workspace. Connect it on the Connections page first.`
    );
  }

  const { data: tokenRow } = await supabase
    .from("oauth_tokens")
    .select("access_token_enc, refresh_token_enc, expires_at")
    .eq("connector_id", connector.id)
    .maybeSingle();
  if (!tokenRow) throw new Error(`${provider} has no stored credentials for this connection.`);

  const isExpired = tokenRow.expires_at
    ? new Date(tokenRow.expires_at).getTime() < Date.now() + 60_000
    : false;

  if (isExpired && tokenRow.refresh_token_enc) {
    const refreshed = await refreshAccessToken(provider, decrypt(tokenRow.refresh_token_enc));
    await saveConnectorTokens(actor, provider, refreshed);
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
