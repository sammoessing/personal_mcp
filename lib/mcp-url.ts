import { headers } from "next/headers";

/**
 * Public https URL for the MCP endpoint.
 *
 * A workspace slug is appended as `?ws=<slug>` so each workspace has a
 * distinct URL. MCP clients (claude.ai included) key connectors by URL and
 * refuse to add the same one twice, so without this you could only ever
 * register one workspace per client.
 *
 * The slug is a routing label, not a credential: the workspace a call actually
 * runs against still comes from the bearer token. The endpoint cross-checks the
 * two and rejects a mismatch, so pointing a Snyder Green token at the Evans
 * Plumbing URL fails rather than quietly using either one.
 */
export async function getMcpEndpointUrl(workspaceSlug?: string): Promise<string> {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = `${proto}://${host}/api/mcp`;
  return workspaceSlug ? `${base}?ws=${workspaceSlug}` : base;
}
