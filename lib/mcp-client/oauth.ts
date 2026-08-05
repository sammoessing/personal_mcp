import { createHash, randomBytes } from "node:crypto";

/** PKCE, as required by the MCP authorization spec — no client secret involved. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export const randomState = () => randomBytes(24).toString("base64url");

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
};

function parseTokenResponse(json: Record<string, unknown>): TokenSet {
  const accessToken = json.access_token as string | undefined;
  if (!accessToken) throw new Error("The authorization server returned no access token.");
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;

  return {
    accessToken,
    refreshToken: (json.refresh_token as string | undefined) ?? null,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    scope: (json.scope as string | undefined) ?? null,
  };
}

async function postToken(
  tokenEndpoint: string,
  body: Record<string, string>,
  clientSecret: string | null
): Promise<TokenSet> {
  const params = new URLSearchParams(body);
  // Public clients send no secret at all; a server that issued one during
  // registration expects it back on the token call.
  if (clientSecret) params.set("client_secret", clientSecret);

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Token exchange failed (HTTP ${response.status}). ${text.slice(0, 200)}`);
  }
  return parseTokenResponse(JSON.parse(text) as Record<string, unknown>);
}

export function buildAuthorizeUrl(input: {
  authorizeEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scope: string | null;
  /** RFC 8707 — binds the issued token to this specific MCP server. */
  resource: string;
}): string {
  const url = new URL(input.authorizeEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", input.resource);
  if (input.scope) url.searchParams.set("scope", input.scope);
  return url.toString();
}

export function exchangeCode(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
  verifier: string;
  resource: string;
}): Promise<TokenSet> {
  return postToken(
    input.tokenEndpoint,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.verifier,
      resource: input.resource,
    },
    input.clientSecret
  );
}

export function refreshAccessToken(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
  resource: string;
}): Promise<TokenSet> {
  return postToken(
    input.tokenEndpoint,
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      resource: input.resource,
    },
    input.clientSecret
  );
}
