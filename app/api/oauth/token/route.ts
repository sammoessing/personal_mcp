import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  hashSecret,
  verifyPkce,
  issueTokens,
  rotateRefreshToken,
  oauthError,
  CORS_JSON_HEADERS,
} from "@/lib/oauth/server";

async function readParams(request: Request): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, string>;
  }
  const form = await request.formData();
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}

export async function POST(request: Request) {
  let params: Record<string, string>;
  try {
    params = await readParams(request);
  } catch {
    return oauthError("invalid_request", "Could not parse request body.");
  }

  const grantType = params.grant_type;

  if (grantType === "refresh_token") {
    if (!params.refresh_token) {
      return oauthError("invalid_request", "refresh_token is required.");
    }
    const rotated = await rotateRefreshToken(params.refresh_token);
    if (!rotated) {
      return oauthError("invalid_grant", "Refresh token is invalid or revoked.");
    }
    return Response.json(
      {
        access_token: rotated.accessToken,
        refresh_token: rotated.refreshToken,
        token_type: "Bearer",
        expires_in: rotated.expiresIn,
      },
      { headers: CORS_JSON_HEADERS }
    );
  }

  if (grantType !== "authorization_code") {
    return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
  }

  const { code, code_verifier: codeVerifier, client_id: clientId, redirect_uri: redirectUri } = params;
  if (!code || !codeVerifier || !clientId) {
    return oauthError(
      "invalid_request",
      "code, code_verifier and client_id are required."
    );
  }

  const supabase = createServiceRoleClient();
  const { data: authCode } = await supabase
    .from("mcp_oauth_codes")
    .select("*")
    .eq("code_hash", hashSecret(code))
    .maybeSingle();

  if (!authCode) return oauthError("invalid_grant", "Authorization code not found.");

  // Consume first, so a replayed code can never mint a second token even if
  // the checks below would have passed.
  if (authCode.consumed) {
    // Replay of an already-used code: revoke anything it produced, per RFC 6749 §4.1.2.
    await supabase
      .from("mcp_oauth_tokens")
      .update({ revoked: true })
      .eq("client_id", authCode.client_id)
      .eq("user_email", authCode.user_email);
    return oauthError("invalid_grant", "Authorization code has already been used.");
  }
  await supabase
    .from("mcp_oauth_codes")
    .update({ consumed: true })
    .eq("code_hash", authCode.code_hash);

  if (new Date(authCode.expires_at).getTime() < Date.now()) {
    return oauthError("invalid_grant", "Authorization code has expired.");
  }
  if (authCode.client_id !== clientId) {
    return oauthError("invalid_grant", "Code was issued to a different client.");
  }
  if (redirectUri && redirectUri !== authCode.redirect_uri) {
    return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
  }
  if (!verifyPkce(codeVerifier, authCode.code_challenge)) {
    return oauthError("invalid_grant", "PKCE verification failed.");
  }

  const tokens = await issueTokens(clientId, authCode.user_email, authCode.scope);

  return Response.json(
    {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: "Bearer",
      expires_in: tokens.expiresIn,
      scope: authCode.scope,
    },
    { headers: CORS_JSON_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_JSON_HEADERS });
}
