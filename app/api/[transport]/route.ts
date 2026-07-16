import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerTools } from "@/lib/mcp/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
 * Bearer-token auth, not a full OAuth resource-server flow — this is a
 * personal single-user server, so a static MCP_ACCESS_TOKEN configured
 * once in the client (Claude Desktop, Claude Code, etc.) is sufficient.
 */
async function verifyToken(_req: Request, bearerToken?: string) {
  const expected = process.env.MCP_ACCESS_TOKEN;
  if (!expected || bearerToken !== expected) return undefined;
  return { token: bearerToken, clientId: "manifest-dashboard", scopes: [] };
}

const authedHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
