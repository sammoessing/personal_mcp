import { publicOrigin, CORS_JSON_HEADERS, MCP_SCOPE } from "@/lib/oauth/server";

/**
 * RFC 8414 authorization server metadata, served at
 * /.well-known/oauth-authorization-server via a rewrite in next.config.ts.
 * This is what tells claude.ai where to register and where to send the user.
 */
export async function GET(request: Request) {
  const origin = publicOrigin(request);

  return Response.json(
    {
      issuer: origin,
      // A page, not an API route: it renders the sign-in/consent screen.
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      scopes_supported: [MCP_SCOPE],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      // Public clients + PKCE only: we never hand out client secrets, and
      // S256 is the sole challenge method we accept.
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    },
    { headers: CORS_JSON_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_JSON_HEADERS });
}
