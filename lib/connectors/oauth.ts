import { CONNECTOR_REGISTRY, type ConnectorProvider } from "./registry";

export function getRedirectUri(provider: ConnectorProvider, origin: string) {
  return `${origin}/api/connectors/${provider}/callback`;
}

function credentials(provider: ConnectorProvider) {
  const def = CONNECTOR_REGISTRY[provider];
  const credsProvider = def.sharesCredentialsWith ?? provider;
  const clientId = process.env[CONNECTOR_REGISTRY[credsProvider].clientIdEnv];
  const clientSecret = process.env[CONNECTOR_REGISTRY[credsProvider].clientSecretEnv];
  if (!clientId || !clientSecret) {
    throw new Error(`${credsProvider} OAuth app is not configured.`);
  }
  return { clientId, clientSecret };
}

export function buildAuthorizeUrl(
  provider: ConnectorProvider,
  origin: string,
  state: string
): string {
  const def = CONNECTOR_REGISTRY[provider];
  const { clientId } = credentials(provider);
  const redirectUri = getRedirectUri(provider, origin);

  const url = new URL(def.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    def.scopes.join(provider === "slack" ? "," : " ")
  );

  if (provider === "google_calendar" || provider === "gmail") {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  if (provider === "notion") {
    url.searchParams.set("owner", "user");
  }

  return url.toString();
}

export type ExchangedTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  accountLabel?: string;
};

export async function exchangeCodeForToken(
  provider: ConnectorProvider,
  code: string,
  origin: string
): Promise<ExchangedTokens> {
  const def = CONNECTOR_REGISTRY[provider];
  const { clientId, clientSecret } = credentials(provider);
  const redirectUri = getRedirectUri(provider, origin);

  // Notion: Basic-auth'd JSON body, not form-encoded like the rest.
  if (provider === "notion") {
    const res = await fetch(def.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    });
    if (!res.ok) throw new Error(`Notion token exchange failed: HTTP ${res.status}`);
    const json = (await res.json()) as { access_token: string; workspace_name?: string };
    return { accessToken: json.access_token, accountLabel: json.workspace_name };
  }

  // Slack: form-encoded, but responses are wrapped with an "ok" flag instead of HTTP status.
  if (provider === "slack") {
    const res = await fetch(def.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      team?: { name?: string };
    };
    if (!json.ok) throw new Error(`Slack token exchange failed: ${json.error}`);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
      accountLabel: json.team?.name,
    };
  }

  // GitHub, Linear, Google, Discord: standard OAuth2 authorization_code grant.
  const res = await fetch(def.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`${provider} token exchange failed: HTTP ${res.status}`);
  const json = (await res.json()) as {
    error?: string;
    error_description?: string;
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (json.error) throw new Error(`${provider} token exchange failed: ${json.error_description ?? json.error}`);

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : undefined,
  };
}
