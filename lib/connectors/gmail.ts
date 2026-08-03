import { google } from "googleapis";
import { z } from "zod";
import { googleAuth } from "./google";
import { textResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

export const gmailTools: ToolDefinition[] = [
  {
    name: "gmail_search_messages",
    title: "Search email",
    description: "Search Gmail messages using Gmail's query syntax.",
    connector: "gmail",
    inputSchema: {
      query: z.string().describe("Gmail search query, e.g. 'from:someone is:unread'"),
      maxResults: z.number().int().min(1).max(25).default(10),
    },
    handler: async ({ query, maxResults }: { query: string; maxResults: number }, ctx: ToolContext) => {
      const auth = await googleAuth(ctx.workspaceId, "gmail");
      const gmail = google.gmail({ version: "v1", auth });
      const { data } = await gmail.users.messages.list({ userId: "me", q: query, maxResults });
      const messages = data.messages ?? [];
      if (messages.length === 0) return textResult("No messages found.");

      const details = await Promise.all(
        messages.map(async (m) => {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["Subject", "From"],
          });
          const headers = msg.data.payload?.headers ?? [];
          const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
          const from = headers.find((h) => h.name === "From")?.value ?? "unknown sender";
          return `[${m.id}] ${subject} — from ${from}`;
        })
      );
      return textResult(details.join("\n"));
    },
  },
  {
    name: "gmail_get_message",
    title: "Get email",
    description: "Fetch a single Gmail message's subject, sender, and snippet by id.",
    connector: "gmail",
    inputSchema: {
      messageId: z.string().describe("Gmail message id, from gmail_search_messages"),
    },
    handler: async ({ messageId }: { messageId: string }, ctx: ToolContext) => {
      const auth = await googleAuth(ctx.workspaceId, "gmail");
      const gmail = google.gmail({ version: "v1", auth });
      const { data } = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
      const headers = data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value ?? "unknown sender";
      return textResult(`Subject: ${subject}\nFrom: ${from}\n\n${data.snippet ?? ""}`);
    },
  },
];
