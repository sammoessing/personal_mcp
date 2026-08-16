import { z } from "zod";
import { textResult, errorResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";
import {
  scrapeViaScrapingBee,
  scrapingBeeConfigured,
  redactKey,
} from "@/lib/scrapers/scrapingbee";

/** Strips markup so an agent gets readable text rather than a page of tags. */
function toText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A general-purpose fetch through ScrapingBee, for pages the dedicated
 * scrapers do not cover. Kept separate from the KSL tools so a one-off lookup
 * does not need a bespoke integration.
 */
export const scrapeTools: ToolDefinition[] = [
  {
    name: "scrape_url",
    title: "Fetch a web page",
    description:
      "Fetch any URL through ScrapingBee, with a real browser and a rotating IP. Returns readable text by default, or raw HTML. Use this for pages without a dedicated tool, or when a direct fetch is being blocked.",
    inputSchema: {
      url: z.string().describe("Full https:// URL to fetch"),
      format: z
        .enum(["text", "html"])
        .default("text")
        .describe("text strips markup; html returns the source"),
      renderJs: z
        .boolean()
        .default(true)
        .describe("Run JavaScript first — needed for pages that load content client-side"),
      premium: z
        .boolean()
        .default(false)
        .describe("Use a residential IP. Costs more credits; try this when a page returns 403"),
      waitForSelector: z
        .string()
        .optional()
        .describe("Wait until this CSS selector appears before capturing"),
      maxChars: z.number().int().min(500).max(100_000).default(20_000),
    },
    handler: async (
      args: {
        url: string;
        format: "text" | "html";
        renderJs: boolean;
        premium: boolean;
        waitForSelector?: string;
        maxChars: number;
      },
      _ctx: ToolContext
    ) => {
      if (!scrapingBeeConfigured()) {
        return errorResult(
          "Scraping isn't configured. Set SCRAPINGBEE_API_KEY in the deployment's environment variables."
        );
      }

      try {
        const result = await scrapeViaScrapingBee(args.url, {
          renderJs: args.renderJs,
          premium: args.premium,
          countryCode: process.env.SCRAPINGBEE_COUNTRY ?? "us",
          waitForSelector: args.waitForSelector,
          waitMs: args.waitForSelector ? undefined : 3000,
        });

        if (result.status >= 400) {
          return errorResult(
            `${args.url} returned HTTP ${result.status}.` +
              (result.status === 403 && !args.premium
                ? " Try again with premium: true to use a residential IP."
                : "")
          );
        }

        const content = args.format === "html" ? result.body : toText(result.body);
        const truncated = content.length > args.maxChars;

        return textResult(
          [
            `${args.url} — HTTP ${result.status}, ${result.body.length.toLocaleString()} bytes` +
              (result.cost ? `, ${result.cost} credits` : ""),
            truncated ? `(showing the first ${args.maxChars.toLocaleString()} characters)` : "",
            "",
            content.slice(0, args.maxChars),
          ]
            .filter(Boolean)
            .join("\n")
        );
      } catch (err) {
        return errorResult(
          redactKey(err instanceof Error ? err.message : "The fetch failed.")
        );
      }
    },
  },
];
