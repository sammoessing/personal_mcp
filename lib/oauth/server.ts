import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const AUTH_CODE_TTL_SECONDS = 60 * 5; // 5 minutes
export const MCP_SCOPE = "mcp";

/** Tokens and codes live in the DB only as hashes, so a dump grants nothing. */
export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time compare so token checks don't leak via timing. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) must equal the stored challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return safeEqual(computed, challenge);
}

/**
 * The public origin of this deployment, used to build issuer/endpoint URLs in
 * discovery metadata. Derived from proxy headers so it's correct on Vercel.
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export async function issueTokens(
  clientId: string,
  userEmail: string,
  scope: string,
  workspaceId: string
): Promise<IssuedTokens> {
  const supabase = createServiceRoleClient();
  const accessToken = randomToken();
  const refreshToken = randomToken();

  const { error } = await supabase.from("mcp_oauth_tokens").insert({
    access_token_hash: hashSecret(accessToken),
    refresh_token_hash: hashSecret(refreshToken),
    client_id: clientId,
    user_email: userEmail,
    workspace_id: workspaceId,
    scope,
    expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

/**
 * Resolves a bearer token presented at the MCP endpoint. Returns null when the
 * token is unknown, expired, or revoked.
 */
export async function resolveAccessToken(token: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("mcp_oauth_tokens")
    .select("id, client_id, user_email, workspace_id, scope, expires_at, revoked")
    .eq("access_token_hash", hashSecret(token))
    .maybeSingle();

  if (!data || data.revoked) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  // Best-effort activity stamp; never block the request on it.
  void supabase
    .from("mcp_oauth_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => undefined);

  return data;
}

/** Rotates a refresh token: the presented one is revoked and a new pair issued. */
export async function rotateRefreshToken(refreshToken: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("mcp_oauth_tokens")
    .select("id, client_id, user_email, workspace_id, scope, revoked")
    .eq("refresh_token_hash", hashSecret(refreshToken))
    .maybeSingle();

  if (!data || data.revoked || !data.client_id || !data.workspace_id) return null;

  await supabase.from("mcp_oauth_tokens").update({ revoked: true }).eq("id", data.id);
  return issueTokens(data.client_id, data.user_email, data.scope, data.workspace_id);
}

export function oauthError(
  error: string,
  description: string,
  status = 400
): Response {
  return Response.json(
    { error, error_description: description },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export const CORS_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;
