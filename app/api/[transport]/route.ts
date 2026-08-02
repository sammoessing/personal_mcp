import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerTools } from "@/lib/mcp/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveAccessToken, safeEqual, MCP_SCOPE } from "@/lib/oauth/server";

/** Best-effort: powers the "Live sessions" stat. Never allowed to break the MCP request itself. */
async function trackSession(sessionId: string | undefined, status: "live" | "closed", userAgent?: string) {
  if (!sessionId) return;
  try {
    const supabase = createServiceRoleClient();
    if (status === "live") {
      await supabase.from("sessions").upsert({
        id: sessionId,
        client_name: userAgent || "Unknown client",
        status: "live",
        last_seen_at: new Date().toISOString(),
      });
    } else {
      await supabase
        .from("sessions")
        .update({ status: "closed", last_seen_at: new Date().toISOString() })
        .eq("id", sessionId);
    }
  } catch {
    // Session tracking is best-effort telemetry, not a correctness requirement.
  }
}

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  { serverInfo: { name: "manifest-personal-mcp", version: "0.1.0" } },
  {
    basePath: "/api",
    disableSse: true,
    onEvent: (event) => {
      if (event.type === "SESSION_STARTED") {
        void trackSession(event.sessionId, "live", event.clientInfo?.userAgent);
      } else if (event.type === "SESSION_ENDED") {
        void trackSession(event.sessionId, "closed");
      }
    },
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
async function verifyToken(_req: Request, bearerToken?: string) {
  if (!bearerToken) return undefined;

  const staticToken = process.env.MCP_ACCESS_TOKEN;
  if (staticToken && safeEqual(bearerToken, staticToken)) {
    return { token: bearerToken, clientId: "manifest-static-token", scopes: [MCP_SCOPE] };
  }

  const grant = await resolveAccessToken(bearerToken);
  if (!grant) return undefined;

  return {
    token: bearerToken,
    clientId: grant.client_id ?? "unknown",
    scopes: grant.scope ? grant.scope.split(" ") : [],
  };
}

const authedHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  // Points 401s at our RFC 9728 metadata so clients can discover how to
  // authenticate instead of just failing.
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
