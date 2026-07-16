import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ALL_TOOLS } from "./tools";
import { withUsageTracking } from "./usage-middleware";
import { textResult } from "./types";

/** Registers every tool in ALL_TOOLS on the given server, each wrapped for usage tracking. */
export function registerTools(server: McpServer) {
  server.registerTool(
    "ping",
    { title: "Ping", description: "Health check — confirms the MCP server is reachable.", inputSchema: {} },
    withUsageTracking("ping", undefined, async () => textResult("pong"))
  );

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
      withUsageTracking(tool.name, tool.connector, tool.handler) as never
    );
  }
}
