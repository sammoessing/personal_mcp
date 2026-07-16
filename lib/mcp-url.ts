import { headers } from "next/headers";

/** Public https URL for the MCP Streamable HTTP endpoint, derived from the incoming request. */
export async function getMcpEndpointUrl(): Promise<string> {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/mcp`;
}
