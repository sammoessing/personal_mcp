import { fetchPage, type FetchOutcome } from "./client";
import { parseListings, describePayload } from "./parse";

/**
 * Finding KSL's search endpoint by trying it.
 *
 * This code was written in an environment whose egress policy blocks every
 * ksl.com host, so the correct path could not be looked up. Rather than pin one
 * guess and hope, the candidates below are probed at runtime — from the
 * deployment, which can reach KSL — and the first that actually yields parsed
 * listings wins. A wrong guess costs one request; a pinned wrong guess costs a
 * silent zero-results tool.
 *
 * Set KSL_SEARCH_URL to skip discovery entirely once the working path is known.
 */

export type Candidate = {
  url: string;
  status: number | null;
  contentType: string;
  bytes: number;
  listings: number;
  error?: string;
  /** Why nothing parsed, filled in only when listings is 0. */
  diagnosis?: string;
};

/** Templates tried in order; `{q}` is replaced by the encoded query string. */
const SEARCH_CANDIDATES = [
  "https://cars.ksl.com/search?{q}",
  "https://cars.ksl.com/search/index?{q}",
  "https://classifieds.ksl.com/search/index?category=Cars+and+Trucks&{q}",
  "https://classifieds.ksl.com/search?category=Cars+and+Trucks&{q}",
  "https://www.ksl.com/auto/search?{q}",
];

/**
 * Cached for the life of the serverless instance. Discovery is a handful of
 * requests, and repeating it on every search would be both slow and rude to
 * the origin.
 */
let cachedBase: string | null = null;

export function cachedSearchBase(): string | null {
  return process.env.KSL_SEARCH_URL ?? cachedBase;
}

export function rememberSearchBase(url: string) {
  // Store the template shape, not the specific query.
  const parsed = new URL(url);
  cachedBase = `${parsed.origin}${parsed.pathname}`;
}

async function probeOne(url: string): Promise<Candidate> {
  try {
    const outcome: FetchOutcome = await fetchPage(url, 15_000);
    const listings = parseListings(outcome.body, outcome.contentType);
    return {
      url,
      status: outcome.status,
      contentType: outcome.contentType,
      bytes: outcome.body.length,
      listings: listings.length,
      // Only worth computing when the answer is disappointing.
      diagnosis: listings.length === 0 ? describePayload(outcome.body) : undefined,
    };
  } catch (err) {
    return {
      url,
      status: null,
      contentType: "",
      bytes: 0,
      listings: 0,
      error: err instanceof Error ? err.message : "request failed",
    };
  }
}

/**
 * Tries each candidate until one parses listings. Returns every attempt so a
 * total failure still shows what each endpoint did, which is the difference
 * between "KSL changed" and "we are blocked".
 */
export async function discoverSearchEndpoint(
  queryString: string
): Promise<{ base: string | null; attempts: Candidate[] }> {
  const attempts: Candidate[] = [];

  for (const template of SEARCH_CANDIDATES) {
    const url = template.replace("{q}", queryString);
    const attempt = await probeOne(url);
    attempts.push(attempt);

    if (attempt.listings > 0) {
      rememberSearchBase(url);
      return { base: cachedSearchBase(), attempts };
    }
  }

  return { base: null, attempts };
}

/**
 * robots.txt for the host we ended up using. Reported rather than enforced —
 * whether to honour a Disallow is the operator's call, but it should be a
 * decision made knowingly rather than by not looking.
 */
export async function fetchRobots(origin: string): Promise<string | null> {
  try {
    const outcome = await fetchPage(`${origin}/robots.txt`, 10_000);
    return outcome.status === 200 ? outcome.body.slice(0, 4000) : null;
  } catch {
    return null;
  }
}

/** Crude but useful: does any Disallow line cover this path for `*`? */
export function robotsDisallows(robots: string, path: string): boolean {
  let inStar = false;
  for (const line of robots.split("\n")) {
    const trimmed = line.trim();
    if (/^user-agent:/i.test(trimmed)) {
      inStar = trimmed.split(":")[1]?.trim() === "*";
      continue;
    }
    if (!inStar) continue;
    const match = trimmed.match(/^disallow:\s*(\S*)/i);
    if (match && match[1] && path.startsWith(match[1])) return true;
  }
  return false;
}
