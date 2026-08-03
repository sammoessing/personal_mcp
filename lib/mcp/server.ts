import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ALL_TOOLS } from "./tools";
import { withUsageTracking } from "./usage-middleware";
import { textResult, type ToolContext } from "./types";

/**
 * Pulls the tenant out of the verified bearer token. The workspace is never
 * taken from tool arguments, so a client cannot reach a workspace its token
 * wasn't issued for — the worst it can do is call tools against its own.
 */
function contextFromAuth(authInfo: unknown): ToolContext {
  const extra = (authInfo as { extra?: Record<string, unknown> } | undefined)?.extra;
  const workspaceId = extra?.workspaceId;
  const userEmail = extra?.userEmail;
  const userId = extra?.userId;

  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    throw new Error("This token is not bound to a workspace. Reconnect the client to authorize it.");
  }

  return {
    workspaceId,
    userId: typeof userId === "string" && userId.length > 0 ? userId : null,
    userEmail: typeof userEmail === "string" ? userEmail : "unknown",
  };
}

/** Registers every tool in ALL_TOOLS, each wrapped for usage tracking. */
export function registerTools(server: McpServer) {
  server.registerTool(
    "ping",
    { title: "Ping", description: "Health check — confirms the MCP server is reachable.", inputSchema: {} },
    (async (_args: unknown, extra: { authInfo?: unknown }) => {
      const ctx = contextFromAuth(extra?.authInfo);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const pong = async (_a: never, _c: ToolContext) => textResult("pong");
      return withUsageTracking("ping", undefined, pong)(undefined as never, ctx);
    }) as never
  );

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      (async (args: unknown, extra: { authInfo?: unknown }) => {
        const ctx = contextFromAuth(extra?.authInfo);
        return withUsageTracking(tool.name, tool.connector, tool.handler)(args as never, ctx);
      }) as never
    );
  }
}
