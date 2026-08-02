import { publicOrigin, CORS_JSON_HEADERS, MCP_SCOPE } from "@/lib/oauth/server";

/**
 * RFC 9728 protected resource metadata, served at
 * /.well-known/oauth-protected-resource (and the /api/mcp path-suffix form)
 * via rewrites in next.config.ts. It points MCP clients at the authorization
 * server that guards this resource — which is this same deployment.
 */
export async function GET(request: Request) {
  const origin = publicOrigin(request);

  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: [MCP_SCOPE],
      bearer_methods_supported: ["header"],
      resource_name: "Manifest personal MCP",
    },
    { headers: CORS_JSON_HEADERS }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_JSON_HEADERS });
}
