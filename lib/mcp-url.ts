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
  const base = `${await canonicalOrigin()}/api/mcp`;
  return workspaceSlug ? `${base}?ws=${workspaceSlug}` : base;
}

/**
 * The stable public origin, which is NOT necessarily the host being browsed.
 *
 * Vercel gives every deployment its own hostname
 * (personal-j18yomvf8-digi-easy.vercel.app), and that hostname dies with the
 * next push. Deriving the endpoint URL from the request host meant that
 * whoever opened the dashboard on a deployment URL copied a connector URL that
 * worked exactly until the next deploy, then failed — and because deployment
 * URLs also sit behind Vercel's protection wall, the OAuth registration call
 * got an HTML login page instead of JSON and reported the sign-in service as
 * broken.
 *
 * So: prefer an explicitly configured origin, then Vercel's production alias,
 * and only fall back to the request host for local development.
 */
export async function canonicalOrigin(): Promise<string> {
  const configured = process.env.MCP_PUBLIC_ORIGIN;
  if (configured) return configured.replace(/\/$/, "");

  // Set automatically by Vercel to the project's production domain (a custom
  // domain when one is assigned), and stable across deployments.
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (production) return `https://${production}`;

  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
  const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
