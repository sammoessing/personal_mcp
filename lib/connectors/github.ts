import { Octokit } from "@octokit/rest";
import { z } from "zod";
import { getConnectorAccessToken } from "./tokens";
import { textResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

async function client(workspaceId: string) {
  const token = await getConnectorAccessToken(workspaceId, "github");
  return new Octokit({ auth: token });
}

export const githubTools: ToolDefinition[] = [
  {
    name: "github_list_pull_requests",
    title: "List pull requests",
    description: "List pull requests for a GitHub repository.",
    connector: "github",
    inputSchema: {
      owner: z.string().describe("Repository owner, e.g. 'vercel'"),
      repo: z.string().describe("Repository name, e.g. 'next.js'"),
      state: z.enum(["open", "closed", "all"]).default("open"),
    },
    handler: async ({ owner, repo, state }: { owner: string; repo: string; state: "open" | "closed" | "all" }, ctx: ToolContext) => {
      const octokit = await client(ctx.workspaceId);
      const { data } = await octokit.pulls.list({ owner, repo, state, per_page: 20 });
      if (data.length === 0) return textResult("No pull requests found.");
      const summary = data
        .map((pr) => `#${pr.number} ${pr.title} (${pr.user?.login ?? "unknown"}) — ${pr.html_url}`)
        .join("\n");
      return textResult(summary);
    },
  },
  {
    name: "github_list_issues",
    title: "List issues",
    description: "List issues for a GitHub repository (excludes pull requests).",
    connector: "github",
    inputSchema: {
      owner: z.string().describe("Repository owner"),
      repo: z.string().describe("Repository name"),
      state: z.enum(["open", "closed", "all"]).default("open"),
    },
    handler: async ({ owner, repo, state }: { owner: string; repo: string; state: "open" | "closed" | "all" }, ctx: ToolContext) => {
      const octokit = await client(ctx.workspaceId);
      const { data } = await octokit.issues.listForRepo({ owner, repo, state, per_page: 20 });
      const issues = data.filter((issue) => !issue.pull_request);
      if (issues.length === 0) return textResult("No issues found.");
      const summary = issues.map((issue) => `#${issue.number} ${issue.title} — ${issue.html_url}`).join("\n");
      return textResult(summary);
    },
  },
];
