import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerTools } from "@/lib/mcp/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveAccessToken, safeEqual, MCP_SCOPE } from "@/lib/oauth/server";

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  { serverInfo: { name: "manifest-personal-mcp", version: "0.1.0" } },
  {
    basePath: "/api",
    disableSse: true,
  }
);

/**
 * Two accepted credentials:
 *
 * 1. An OAuth access token issued by our own authorization server. Browser
 *    clients (claude.ai) can't hold a static secret, so they run Dynamic
 *    Client Registration + authorization-code/PKCE and end up here.
 * 2. The static MCP_ACCESS_TOKEN, for clients where you paste a header into a
 *    config file yourself (Claude Desktop, Claude Code).
 */
async function verifyToken(req: Request, bearerToken?: string) {
  if (!bearerToken) return undefined;

  // Each workspace has its own endpoint URL (?ws=<slug>) because MCP clients
  // key connectors by URL. The slug is only a routing label — it never grants
  // anything — but if present it must agree with the token, so a token issued
  // for one workspace can't be used against another's URL.
  const requestedSlug = new URL(req.url).searchParams.get("ws");

  const staticToken = process.env.MCP_ACCESS_TOKEN;
  if (staticToken && safeEqual(bearerToken, staticToken)) {
    // The static token predates workspaces, so it is pinned to one workspace by
    // slug rather than being allowed to reach all of them.
    const pinned = await resolveWorkspaceBySlug(
      process.env.MCP_STATIC_TOKEN_WORKSPACE ?? "personal"
    );
    if (!pinned) return undefined;
    if (requestedSlug && requestedSlug !== pinned.slug) return undefined;
    return {
      token: bearerToken,
      clientId: "manifest-static-token",
      scopes: [MCP_SCOPE],
      extra: { workspaceId: pinned.id, userEmail: "static-token" },
    };
  }

  const grant = await resolveAccessToken(bearerToken);
  if (!grant?.workspace_id) return undefined;

  if (requestedSlug) {
    const requested = await resolveWorkspaceBySlug(requestedSlug);
    if (!requested || requested.id !== grant.workspace_id) return undefined;
  }

  return {
    token: bearerToken,
    clientId: grant.client_id ?? "unknown",
    scopes: grant.scope ? grant.scope.split(" ") : [],
    // The tenant travels with the token; tools read it from here and never
    // from client-supplied arguments.
    extra: { workspaceId: grant.workspace_id, userEmail: grant.user_email },
  };
}

async function resolveWorkspaceBySlug(slug: string) {
  const { data } = await createServiceRoleClient()
    .from("workspaces")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}


const authedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  // Points 401s at our RFC 9728 metadata so clients can discover how to
  // authenticate instead of just failing.
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
