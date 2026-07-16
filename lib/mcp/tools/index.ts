import { githubTools } from "@/lib/connectors/github";
import { googleCalendarTools } from "@/lib/connectors/google-calendar";
import { gmailTools } from "@/lib/connectors/gmail";
import { linearTools } from "@/lib/connectors/linear";
import { notionTools } from "@/lib/connectors/notion";
import { slackTools } from "@/lib/connectors/slack";
import { discordTools } from "@/lib/connectors/discord";
import { skillTools } from "./skills";
import type { ToolDefinition } from "@/lib/mcp/types";

/** Every tool this MCP server can expose: built-ins plus one group per connector. */
export const ALL_TOOLS: ToolDefinition[] = [
  ...skillTools,
  ...githubTools,
  ...linearTools,
  ...googleCalendarTools,
  ...gmailTools,
  ...notionTools,
  ...slackTools,
  ...discordTools,
];
