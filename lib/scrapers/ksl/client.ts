import { parseListings } from "./parse";
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

export function buildSearchUrl(query: SearchQuery): string {
  const url = new URL(SEARCH_URL);
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

  return url.toString();
}

export async function searchVehicles(
  query: SearchQuery
): Promise<{ listings: VehicleListing[]; outcome: FetchOutcome }> {
  const outcome = await fetchPage(buildSearchUrl(query));
  if (outcome.status !== 200) {
    throw new Error(
      `KSL returned HTTP ${outcome.status} for ${outcome.url}. If this is a 403, the request was blocked; if a 404, the search path has changed and KSL_SEARCH_URL needs updating.`
    );
  }
  return { listings: parseListings(outcome.body, outcome.contentType), outcome };
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
