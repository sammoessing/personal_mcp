import { createServiceRoleClient } from "@/lib/supabase/server";
import { randomToken, oauthError, CORS_JSON_HEADERS } from "@/lib/oauth/server";

type RegistrationRequest = {
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  token_endpoint_auth_method?: string;
};

/**
 * RFC 7591 Dynamic Client Registration. claude.ai calls this unauthenticated to
 * register itself before starting the authorization flow.
 *
 * Open registration is safe here because registering a client grants nothing on
 * its own: every client still has to drive a user through /api/oauth/authorize,
 * and that screen only ever authenticates the single ALLOWED_EMAIL account. A
 * stranger who registers a client just gets a client_id they cannot use.
 */
export async function POST(request: Request) {
  let body: RegistrationRequest;
  try {
    body = await request.json();
  } catch {
    return oauthError("invalid_request", "Body must be JSON.");
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
    return oauthError("invalid_redirect_uri", "redirect_uris is required.");
  }

  for (const uri of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return oauthError("invalid_redirect_uri", `Not a valid URL: ${uri}`);
    }
    // Redirect targets must be https, or localhost for native/dev clients.
    const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !isLocalhost) {
      return oauthError("invalid_redirect_uri", `redirect_uri must use https: ${uri}`);
    }
  }

  const clientId = `mcp_${randomToken(16)}`;
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("mcp_oauth_clients").insert({
    client_id: clientId,
    client_name: body.client_name?.slice(0, 200) || "Unknown client",
    redirect_uris: redirectUris,
    grant_types: body.grant_types?.length
      ? body.grant_types
      : ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
  });
  if (error) {
    return oauthError("server_error", error.message, 500);
  }

  return Response.json(
    {
      client_id: clientId,
      client_name: body.client_name || "Unknown client",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // Public client: no secret is issued, PKCE is mandatory instead.
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201, headers: CORS_JSON_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_JSON_HEADERS });
}
