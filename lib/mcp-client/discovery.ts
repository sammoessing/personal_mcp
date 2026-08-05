/**
 * Finding out how to authenticate to a remote MCP server.
 *
 * The MCP authorization spec layers three RFCs:
 *
 *   1. An unauthenticated request gets 401 with a `WWW-Authenticate` header
 *      naming the protected-resource metadata document (RFC 9728).
 *   2. That document names the authorization server(s).
 *   3. The authorization server's metadata (RFC 8414) gives the authorize,
 *      token, and — crucially — registration endpoints.
 *
 * Step 3's `registration_endpoint` is why connecting needs no client id: the
 * app registers itself and is issued one (RFC 7591).
 *
 * Servers vary in how much of this they implement, so each step falls back to
 * the conventional well-known path on the server's own origin.
 */

export type ServerAuthMetadata = {
  authorizationServer: string;
  authorizeEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  scopesSupported: string | null;
};

const JSON_HEADERS = { Accept: "application/json" };

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url, { headers: JSON_HEADERS, redirect: "follow" });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Pulls `resource_metadata="…"` out of a WWW-Authenticate challenge. */
export function resourceMetadataFromChallenge(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/resource_metadata\s*=\s*"([^"]+)"/i);
  return match ? match[1] : null;
}

/**
 * Probes the MCP endpoint. A 401 is the expected, useful answer — it carries
 * the pointer to the rest of discovery. A 200 means the server needs no auth.
 */
export async function probeMcpEndpoint(
  mcpUrl: string
): Promise<{ requiresAuth: boolean; resourceMetadataUrl: string | null }> {
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "Charted", version: "0.1.0" },
      },
    }),
  });

  if (response.status === 401 || response.status === 403) {
    return {
      requiresAuth: true,
      resourceMetadataUrl: resourceMetadataFromChallenge(
        response.headers.get("www-authenticate")
      ),
    };
  }

  return { requiresAuth: !response.ok, resourceMetadataUrl: null };
}

function wellKnown(base: string, path: string): string {
  const url = new URL(base);
  return `${url.origin}${path}`;
}

/**
 * Resolves everything needed to run the OAuth flow against a server, or throws
 * with a message worth showing to whoever clicked Connect.
 */
export async function discoverAuthMetadata(mcpUrl: string): Promise<ServerAuthMetadata> {
  const probe = await probeMcpEndpoint(mcpUrl);

  // Step 1–2: the protected-resource document names the authorization server.
  const resourceMetadata =
    (probe.resourceMetadataUrl ? await fetchJson(probe.resourceMetadataUrl) : null) ??
    (await fetchJson(wellKnown(mcpUrl, "/.well-known/oauth-protected-resource")));

  const advertised = Array.isArray(resourceMetadata?.authorization_servers)
    ? (resourceMetadata.authorization_servers as string[])[0]
    : null;

  // Falling back to the MCP server's own origin covers servers that host their
  // authorization server at the same place and skip the resource document.
  const authorizationServer = advertised ?? new URL(mcpUrl).origin;

  // Step 3: authorization server metadata. OAuth's path is tried first, then
  // OpenID's, which many providers serve instead.
  const asMetadata =
    (await fetchJson(wellKnown(authorizationServer, "/.well-known/oauth-authorization-server"))) ??
    (await fetchJson(wellKnown(authorizationServer, "/.well-known/openid-configuration"))) ??
    (await fetchJson(`${authorizationServer.replace(/\/$/, "")}/.well-known/oauth-authorization-server`));

  if (!asMetadata) {
    throw new Error(
      `Could not find OAuth metadata for ${authorizationServer}. This server may not support the MCP authorization spec — check the URL, or ask whoever runs it.`
    );
  }

  const authorizeEndpoint = asMetadata.authorization_endpoint as string | undefined;
  const tokenEndpoint = asMetadata.token_endpoint as string | undefined;
  if (!authorizeEndpoint || !tokenEndpoint) {
    throw new Error("That authorization server did not advertise the endpoints needed to sign in.");
  }

  const scopes = Array.isArray(resourceMetadata?.scopes_supported)
    ? (resourceMetadata.scopes_supported as string[]).join(" ")
    : Array.isArray(asMetadata.scopes_supported)
      ? (asMetadata.scopes_supported as string[]).join(" ")
      : null;

  return {
    authorizationServer,
    authorizeEndpoint,
    tokenEndpoint,
    registrationEndpoint: (asMetadata.registration_endpoint as string | undefined) ?? null,
    scopesSupported: scopes,
  };
}

export type RegisteredClient = { clientId: string; clientSecret: string | null };

/**
 * RFC 7591 dynamic client registration — the step that means you never paste a
 * client id. Registers as a public client using PKCE, which is what the MCP
 * spec expects and avoids holding a secret we do not need.
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string
): Promise<RegisteredClient> {
  const response = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...JSON_HEADERS },
    body: JSON.stringify({
      client_name: "Charted",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `That server refused to register this app (HTTP ${response.status}). ${detail.slice(0, 200)}`
    );
  }

  const json = (await response.json()) as { client_id?: string; client_secret?: string };
  if (!json.client_id) throw new Error("Registration succeeded but returned no client_id.");

  return { clientId: json.client_id, clientSecret: json.client_secret ?? null };
}
