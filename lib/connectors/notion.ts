import { Client } from "@notionhq/client";
import { z } from "zod";
import { getConnectorAccessToken } from "./tokens";
import { textResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

async function client(workspaceId: string) {
  const token = await getConnectorAccessToken(workspaceId, "notion");
  return new Client({ auth: token });
}

function titleOf(page: Record<string, unknown>): string {
  if (!("properties" in page)) return "(untitled)";
  const properties = (page as { properties: Record<string, { type: string; title?: Array<{ plain_text: string }> }> }).properties;
  for (const prop of Object.values(properties)) {
    if (prop.type === "title" && prop.title) {
      return prop.title.map((t) => t.plain_text).join("") || "(untitled)";
    }
  }
  return "(untitled)";
}

export const notionTools: ToolDefinition[] = [
  {
    name: "notion_search",
    title: "Search Notion",
    description: "Search pages and databases shared with the connected Notion integration.",
    connector: "notion",
    inputSchema: {
      query: z.string().describe("Search text"),
      maxResults: z.number().int().min(1).max(25).default(10),
    },
    handler: async ({ query, maxResults }: { query: string; maxResults: number }, ctx: ToolContext) => {
      const notion = await client(ctx.workspaceId);
      const { results } = await notion.search({ query, page_size: maxResults });
      if (results.length === 0) return textResult("No results found.");
      const summary = results
        .map((r) => {
          const url = "url" in r ? (r.url as string) : "";
          const title = r.object === "page" ? titleOf(r as Record<string, unknown>) : "(database)";
          return `[${r.object}] ${title} — ${url}`;
        })
        .join("\n");
      return textResult(summary);
    },
  },
  {
    name: "notion_get_page",
    title: "Get page",
    description: "Fetch a Notion page's title and top-level block text by page id.",
    connector: "notion",
    inputSchema: {
      pageId: z.string().describe("Notion page id, from notion_search"),
    },
    handler: async ({ pageId }: { pageId: string }, ctx: ToolContext) => {
      const notion = await client(ctx.workspaceId);
      const page = await notion.pages.retrieve({ page_id: pageId });
      const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 });
      const title = titleOf(page as unknown as Record<string, unknown>);
      const text = blocks.results
        .map((block) => {
          const b = block as { type: string } & Record<string, { rich_text?: Array<{ plain_text: string }> }>;
          const rich = b[b.type]?.rich_text;
          return rich?.map((t) => t.plain_text).join("") ?? "";
        })
        .filter(Boolean)
        .join("\n");
      return textResult(`${title}\n\n${text}`);
    },
  },
];
