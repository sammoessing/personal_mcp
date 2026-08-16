import { z } from "zod";
import { textResult, errorResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";

/**
 * Twilio.
 *
 * Not part of the OAuth connector registry: Twilio's REST API authenticates
 * with an Account SID and Auth Token over HTTP Basic, with no OAuth flow to
 * run. Credentials come from the environment, so there is nothing to connect
 * on the Connections page — the tools are live once the variables are set.
 */

const API_BASE = "https://api.twilio.com/2010-04-01";
const LOOKUP_BASE = "https://lookups.twilio.com/v2";

function credentials(): { sid: string; token: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token ? { sid, token } : null;
}

const NOT_CONFIGURED =
  "Twilio isn't configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (and TWILIO_FROM_NUMBER to send) in the deployment's environment variables.";

async function twilioRequest(
  url: string,
  init: { method?: string; body?: URLSearchParams } = {}
): Promise<Record<string, unknown>> {
  const creds = credentials();
  if (!creds) throw new Error(NOT_CONFIGURED);

  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.sid}:${creds.token}`).toString("base64")}`,
      ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init.body,
  });

  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    // Twilio's own message is more useful than the status code alone.
    throw new Error(
      `Twilio error ${response.status}: ${(json.message as string) ?? "unknown"}${
        json.code ? ` (code ${json.code})` : ""
      }`
    );
  }
  return json;
}

/** E.164 where possible: Twilio rejects most other forms. */
function toE164(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export const twilioTools: ToolDefinition[] = [
  {
    name: "twilio_lookup_number",
    title: "Look up a phone number",
    description:
      "Check a phone number with Twilio Lookup: whether it is valid, its carrier, and whether it is a mobile or landline. Worth running before texting a scraped number — a landline cannot receive SMS, and the line type tells you which numbers are worth contacting at all.",
    inputSchema: {
      phone: z.string().describe("Phone number, any common format"),
      carrier: z
        .boolean()
        .default(true)
        .describe("Include carrier and line type. This is a billed lookup"),
    },
    handler: async (args: { phone: string; carrier: boolean }, _ctx: ToolContext) => {
      if (!credentials()) return errorResult(NOT_CONFIGURED);

      try {
        const number = toE164(args.phone);
        const url = new URL(`${LOOKUP_BASE}/PhoneNumbers/${encodeURIComponent(number)}`);
        if (args.carrier) url.searchParams.set("Fields", "line_type_intelligence");

        const json = await twilioRequest(url.toString());
        const lineType = json.line_type_intelligence as Record<string, unknown> | undefined;

        return textResult(
          [
            `${json.phone_number ?? number}`,
            `  valid: ${json.valid === true ? "yes" : "no"}`,
            json.country_code ? `  country: ${json.country_code}` : null,
            lineType?.type ? `  line type: ${lineType.type}` : null,
            lineType?.carrier_name ? `  carrier: ${lineType.carrier_name}` : null,
            lineType?.type && lineType.type !== "mobile"
              ? "  note: not a mobile line — SMS will not be delivered."
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "The lookup failed.");
      }
    },
  },
  {
    name: "twilio_send_sms",
    title: "Send an SMS",
    description:
      "Send a text message from the configured Twilio number. Only send to numbers you are permitted to contact — a scraped number is not consent, and this tool does no consent or do-not-call checking of its own.",
    inputSchema: {
      to: z.string().describe("Recipient number"),
      body: z.string().max(1600).describe("Message text"),
      from: z.string().optional().describe("Sending number; defaults to TWILIO_FROM_NUMBER"),
    },
    handler: async (
      args: { to: string; body: string; from?: string },
      _ctx: ToolContext
    ) => {
      const creds = credentials();
      if (!creds) return errorResult(NOT_CONFIGURED);

      const from = args.from ?? process.env.TWILIO_FROM_NUMBER;
      if (!from) {
        return errorResult("No sending number. Set TWILIO_FROM_NUMBER or pass `from`.");
      }

      try {
        const json = await twilioRequest(`${API_BASE}/Accounts/${creds.sid}/Messages.json`, {
          method: "POST",
          body: new URLSearchParams({
            To: toE164(args.to),
            From: toE164(from),
            Body: args.body,
          }),
        });

        return textResult(
          [
            `Sent to ${json.to} from ${json.from}.`,
            `  sid: ${json.sid}`,
            `  status: ${json.status}`,
            json.price ? `  price: ${json.price} ${json.price_unit ?? ""}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "The message failed to send.");
      }
    },
  },
  {
    name: "twilio_list_messages",
    title: "List recent messages",
    description:
      "List recent SMS from the Twilio account, optionally filtered to one conversation. Use this to see whether someone replied.",
    inputSchema: {
      to: z.string().optional().describe("Only messages sent to this number"),
      from: z.string().optional().describe("Only messages sent from this number"),
      limit: z.number().int().min(1).max(50).default(20),
    },
    handler: async (
      args: { to?: string; from?: string; limit: number },
      _ctx: ToolContext
    ) => {
      const creds = credentials();
      if (!creds) return errorResult(NOT_CONFIGURED);

      try {
        const url = new URL(`${API_BASE}/Accounts/${creds.sid}/Messages.json`);
        if (args.to) url.searchParams.set("To", toE164(args.to));
        if (args.from) url.searchParams.set("From", toE164(args.from));
        url.searchParams.set("PageSize", String(args.limit));

        const json = await twilioRequest(url.toString());
        const messages = (json.messages ?? []) as Array<Record<string, unknown>>;
        if (messages.length === 0) return textResult("No messages match.");

        return textResult(
          messages
            .map((message) =>
              [
                `${message.date_sent ?? message.date_created} · ${message.direction}`,
                `  ${message.from} → ${message.to} · ${message.status}`,
                `  ${String(message.body ?? "").slice(0, 300)}`,
              ].join("\n")
            )
            .join("\n\n")
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "The listing failed.");
      }
    },
  },
];
