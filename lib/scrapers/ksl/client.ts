import { parseListings } from "./parse";
import { cachedSearchBase, discoverSearchEndpoint } from "./discover";
import type { SearchQuery, VehicleListing } from "./types";

/**
 * Where to fetch from. Overridable by env because this was written without
 * access to the live site — if KSL's search path differs from the default,
 * it can be corrected by setting KSL_SEARCH_URL rather than shipping a patch.
 */
const SEARCH_URL = process.env.KSL_SEARCH_URL ?? "https://cars.ksl.com/search";
const LISTING_URL = process.env.KSL_LISTING_URL ?? "https://cars.ksl.com/listing";

/** A browser-shaped request; a bare fetch is refused by most classifieds sites. */
const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export type FetchOutcome = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

/**
 * One request, with a timeout and no retry-on-block.
 *
 * Deliberately no proxy rotation: the upstream repo shipped 300 proxies to get
 * around being blocked, and quietly evading a site's rate limiting is both
 * fragile and a terms-of-service problem. A block surfaces as a block.
 */
export async function fetchPage(url: string, timeoutMs = 20_000): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    return {
      url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Query parameters only, so a discovered base can be combined with them. */
export function buildSearchParams(query: SearchQuery): string {
  const url = new URL("https://example.invalid/");
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== null && `${value}` !== "") {
      url.searchParams.set(key, String(value));
    }
  };

  set("make", query.make);
  set("model", query.model);
  set("yearFrom", query.yearMin);
  set("yearTo", query.yearMax);
  set("priceFrom", query.priceMin);
  set("priceTo", query.priceMax);
  set("mileageTo", query.mileageMax);
  set("zip", query.zip);
  set("miles", query.radius);
  set("keyword", query.keyword);
  set("page", query.page);
  set("perPage", query.perPage ?? 24);

  return url.searchParams.toString();
}

export function buildSearchUrl(query: SearchQuery, base = SEARCH_URL): string {
  const params = buildSearchParams(query);
  return params ? `${base}${base.includes("?") ? "&" : "?"}${params}` : base;
}

/**
 * Searches, discovering the endpoint on first use when one has not been pinned
 * via KSL_SEARCH_URL. Discovery result is cached per instance.
 */
export async function searchVehicles(
  query: SearchQuery
): Promise<{ listings: VehicleListing[]; outcome: FetchOutcome; base: string }> {
  const params = buildSearchParams(query);
  const known = cachedSearchBase();

  if (known) {
    const url = `${known}${known.includes("?") ? "&" : "?"}${params}`;
    const outcome = await fetchPage(url);
    if (outcome.status === 200) {
      const listings = parseListings(outcome.body, outcome.contentType);
      if (listings.length > 0 || process.env.KSL_SEARCH_URL) {
        return { listings, outcome, base: known };
      }
    }
    // A pinned URL is trusted; a cached guess that stopped working is not, so
    // fall through and re-discover.
  }

  const { base, attempts } = await discoverSearchEndpoint(params);
  if (!base) {
    const summary = attempts
      .map((a) => `  ${a.url} → ${a.error ?? `HTTP ${a.status}, ${a.bytes} bytes, ${a.listings} listings`}`)
      .join("\n");
    throw new Error(
      `No KSL search endpoint returned parseable listings.\n${summary}\n\n` +
        "If these are 403s the requests are being blocked; if they are 200s with no listings, the page shape has changed. Run ksl_probe for the raw response."
    );
  }

  const url = `${base}${base.includes("?") ? "&" : "?"}${params}`;
  const outcome = await fetchPage(url);
  return { listings: parseListings(outcome.body, outcome.contentType), outcome, base };
}

export async function fetchListing(
  listingId: string
): Promise<{ listing: VehicleListing | null; outcome: FetchOutcome }> {
  const url = `${LISTING_URL.replace(/\/$/, "")}/${encodeURIComponent(listingId)}`;
  const outcome = await fetchPage(url);
  if (outcome.status !== 200) {
    throw new Error(`KSL returned HTTP ${outcome.status} for ${url}.`);
  }
  const listings = parseListings(outcome.body, outcome.contentType);
  return { listing: listings[0] ?? null, outcome };
}
