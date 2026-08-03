import { LinearClient } from "@linear/sdk";
import { z } from "zod";
import { getConnectorAccessToken } from "./tokens";
import { textResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

async function client(workspaceId: string) {
  const token = await getConnectorAccessToken(workspaceId, "linear");
  return new LinearClient({ accessToken: token });
}

export const linearTools: ToolDefinition[] = [
  {
    name: "linear_list_my_issues",
    title: "List my issues",
    description: "List issues assigned to the connected Linear account.",
    connector: "linear",
    inputSchema: {
      maxResults: z.number().int().min(1).max(50).default(20),
    },
    handler: async ({ maxResults }: { maxResults: number }, ctx: ToolContext) => {
      const linear = await client(ctx.workspaceId);
      const me = await linear.viewer;
      const assigned = await me.assignedIssues({ first: maxResults });
      if (assigned.nodes.length === 0) return textResult("No issues assigned to you.");
      const summary = assigned.nodes
        .map((issue) => `${issue.identifier} ${issue.title} — ${issue.url}`)
        .join("\n");
      return textResult(summary);
    },
  },
  {
    name: "linear_search_issues",
    title: "Search issues",
    description: "Search Linear issues by title/description text.",
    connector: "linear",
    inputSchema: {
      query: z.string().describe("Text to search for"),
      maxResults: z.number().int().min(1).max(50).default(20),
    },
    handler: async ({ query, maxResults }: { query: string; maxResults: number }, ctx: ToolContext) => {
      const linear = await client(ctx.workspaceId);
      const result = await linear.searchIssues(query, { first: maxResults });
      if (result.nodes.length === 0) return textResult("No matching issues found.");
      const summary = result.nodes
        .map((issue) => `${issue.identifier} ${issue.title} — ${issue.url}`)
        .join("\n");
      return textResult(summary);
    },
  },
];
