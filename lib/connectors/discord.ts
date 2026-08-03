import { getConnectorAccessToken } from "./tokens";
import { textResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

const API_BASE = "https://discord.com/api/v10";

async function discordFetch(workspaceId: string, path: string) {
  const token = await getConnectorAccessToken(workspaceId, "discord");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Discord API error: HTTP ${res.status}`);
  return res.json();
}

export const discordTools: ToolDefinition[] = [
  {
    name: "discord_list_guilds",
    title: "List servers",
    description: "List Discord servers (guilds) the connected account is a member of.",
    connector: "discord",
    inputSchema: {},
    handler: async (_args: unknown, ctx: ToolContext) => {
      const guilds = (await discordFetch(ctx.workspaceId, "/users/@me/guilds")) as Array<{ id: string; name: string }>;
      if (guilds.length === 0) return textResult("No servers found.");
      const summary = guilds.map((g) => `${g.name} (${g.id})`).join("\n");
      return textResult(summary);
    },
  },
  {
    name: "discord_get_profile",
    title: "Get profile",
    description: "Get the connected Discord account's profile.",
    connector: "discord",
    inputSchema: {},
    handler: async (_args: unknown, ctx: ToolContext) => {
      const me = (await discordFetch(ctx.workspaceId, "/users/@me")) as { username: string; id: string; email?: string };
      return textResult(`${me.username} (${me.id})${me.email ? ` — ${me.email}` : ""}`);
    },
  },
];
