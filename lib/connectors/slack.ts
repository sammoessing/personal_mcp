import { WebClient } from "@slack/web-api";
import { z } from "zod";
import { getConnectorAccessToken } from "./tokens";
import { textResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

async function client(workspaceId: string) {
  const token = await getConnectorAccessToken(workspaceId, "slack");
  return new WebClient(token);
}

export const slackTools: ToolDefinition[] = [
  {
    name: "slack_list_channels",
    title: "List channels",
    description: "List public channels in the connected Slack workspace.",
    connector: "slack",
    inputSchema: {
      maxResults: z.number().int().min(1).max(100).default(30),
    },
    handler: async ({ maxResults }: { maxResults: number }, ctx: ToolContext) => {
      const slack = await client(ctx.workspaceId);
      const { channels } = await slack.conversations.list({ limit: maxResults, exclude_archived: true });
      if (!channels || channels.length === 0) return textResult("No channels found.");
      const summary = channels.map((c) => `#${c.name} (${c.id})`).join("\n");
      return textResult(summary);
    },
  },
  {
    name: "slack_post_message",
    title: "Post message",
    description: "Post a message to a Slack channel.",
    connector: "slack",
    inputSchema: {
      channel: z.string().describe("Channel id or name, e.g. '#general' or 'C0123456789'"),
      text: z.string().describe("Message text"),
    },
    handler: async ({ channel, text }: { channel: string; text: string }, ctx: ToolContext) => {
      const slack = await client(ctx.workspaceId);
      const result = await slack.chat.postMessage({ channel, text });
      return textResult(`Posted to ${channel} (ts ${result.ts}).`);
    },
  },
];
