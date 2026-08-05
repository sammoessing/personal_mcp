import { z } from "zod";
import { textResult, errorResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";
import { listServers, listConnectedServers, resolveAccessToken } from "@/lib/mcp-client/store";
import { openSession, McpUnauthorizedError } from "@/lib/mcp-client/client";

/**
 * Bridges connected remote MCP servers into this one.
 *
 * Remote tools are reached through these three rather than being registered
 * individually, because which tools exist depends on who is calling: a
 * per-member server resolves to a different account for each person, and the
 * tool list is only knowable after authenticating as them. Registering a fixed
 * set at startup would either leak one member's tools to another or go stale.
 */
export const remoteTools: ToolDefinition[] = [
  {
    name: "remote_servers_list",
    title: "List connected services",
    description:
      "List the external MCP servers this workspace can reach — Linear, Slack, internal tools, and so on. Use remote_tools_list to see what one offers.",
    inputSchema: {},
    handler: async (_args: unknown, ctx: ToolContext) => {
      const actor = { workspaceId: ctx.workspaceId, userId: ctx.userId };
      const [all, connected] = await Promise.all([
        listServers(ctx.workspaceId),
        listConnectedServers(actor),
      ]);
      if (all.length === 0) return textResult("No external MCP servers have been added.");

      const connectedIds = new Set(connected.map((server) => server.id));
      return textResult(
        all
          .map((server) => {
            const status = connectedIds.has(server.id)
              ? "connected"
              : server.scope === "member"
                ? "not connected for you"
                : "not connected";
            return `${server.name}\n  ${server.url}\n  ${server.scope === "member" ? "per person" : "shared"} · ${status}`;
          })
          .join("\n\n")
      );
    },
  },
  {
    name: "remote_tools_list",
    title: "List a service's tools",
    description:
      "List the tools a connected external MCP server exposes, with their input schemas. Call this before remote_tool_call.",
    inputSchema: {
      server: z.string().describe("Server name from remote_servers_list"),
    },
    handler: async (args: { server: string }, ctx: ToolContext) => {
      const actor = { workspaceId: ctx.workspaceId, userId: ctx.userId };
      const servers = await listServers(ctx.workspaceId);
      const server = servers.find(
        (candidate) => candidate.name.toLowerCase() === args.server.toLowerCase()
      );
      if (!server) return errorResult(`No server named "${args.server}" in this workspace.`);

      try {
        const token = await resolveAccessToken(server, actor);
        const session = await openSession(server.url, token);
        const tools = await session.listTools();
        if (tools.length === 0) return textResult(`${server.name} exposes no tools.`);

        return textResult(
          tools
            .map((tool) =>
              [
                `${tool.name}${tool.title ? ` — ${tool.title}` : ""}`,
                tool.description ? `  ${tool.description}` : null,
                tool.inputSchema ? `  input: ${JSON.stringify(tool.inputSchema)}` : null,
              ]
                .filter(Boolean)
                .join("\n")
            )
            .join("\n\n")
        );
      } catch (err) {
        if (err instanceof McpUnauthorizedError) {
          return errorResult(
            `${server.name} rejected the stored token. Reconnect it on the Connections page.`
          );
        }
        return errorResult(err instanceof Error ? err.message : "Could not reach that server.");
      }
    },
  },
  {
    name: "remote_tool_call",
    title: "Call a tool on a connected service",
    description:
      "Invoke a tool on an external MCP server. Get the tool name and its arguments from remote_tools_list first.",
    inputSchema: {
      server: z.string().describe("Server name from remote_servers_list"),
      tool: z.string().describe("Tool name from remote_tools_list"),
      args: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Arguments object matching that tool's input schema"),
    },
    handler: async (
      args: { server: string; tool: string; args?: Record<string, unknown> },
      ctx: ToolContext
    ) => {
      const actor = { workspaceId: ctx.workspaceId, userId: ctx.userId };
      const servers = await listServers(ctx.workspaceId);
      const server = servers.find(
        (candidate) => candidate.name.toLowerCase() === args.server.toLowerCase()
      );
      if (!server) return errorResult(`No server named "${args.server}" in this workspace.`);

      try {
        const token = await resolveAccessToken(server, actor);
        const session = await openSession(server.url, token);
        return textResult(await session.callTool(args.tool, args.args ?? {}));
      } catch (err) {
        if (err instanceof McpUnauthorizedError) {
          return errorResult(
            `${server.name} rejected the stored token. Reconnect it on the Connections page.`
          );
        }
        return errorResult(err instanceof Error ? err.message : "That tool call failed.");
      }
    },
  },
];
