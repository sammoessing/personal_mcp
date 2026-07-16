import { google } from "googleapis";
import { z } from "zod";
import { googleAuth } from "./google";
import { textResult, type ToolDefinition } from "@/lib/mcp/types";

export const googleCalendarTools: ToolDefinition[] = [
  {
    name: "calendar_list_events",
    title: "List upcoming events",
    description: "List upcoming events on a Google Calendar.",
    connector: "google_calendar",
    inputSchema: {
      calendarId: z.string().default("primary"),
      maxResults: z.number().int().min(1).max(50).default(10),
    },
    handler: async ({
      calendarId,
      maxResults,
    }: {
      calendarId: string;
      maxResults: number;
    }) => {
      const auth = await googleAuth("google_calendar");
      const calendar = google.calendar({ version: "v3", auth });
      const { data } = await calendar.events.list({
        calendarId,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
        timeMin: new Date().toISOString(),
      });
      const events = data.items ?? [];
      if (events.length === 0) return textResult("No upcoming events.");
      const summary = events
        .map((e) => `${e.summary ?? "(no title)"} — ${e.start?.dateTime ?? e.start?.date}`)
        .join("\n");
      return textResult(summary);
    },
  },
  {
    name: "calendar_create_event",
    title: "Create event",
    description: "Create a new event on a Google Calendar.",
    connector: "google_calendar",
    inputSchema: {
      calendarId: z.string().default("primary"),
      summary: z.string().describe("Event title"),
      startIso: z.string().describe("Start time, ISO 8601 (e.g. 2026-07-20T09:00:00-07:00)"),
      endIso: z.string().describe("End time, ISO 8601"),
      description: z.string().optional(),
    },
    handler: async ({
      calendarId,
      summary,
      startIso,
      endIso,
      description,
    }: {
      calendarId: string;
      summary: string;
      startIso: string;
      endIso: string;
      description?: string;
    }) => {
      const auth = await googleAuth("google_calendar");
      const calendar = google.calendar({ version: "v3", auth });
      const { data } = await calendar.events.insert({
        calendarId,
        requestBody: {
          summary,
          description,
          start: { dateTime: startIso },
          end: { dateTime: endIso },
        },
      });
      return textResult(`Created "${summary}" — ${data.htmlLink}`);
    },
  },
];
