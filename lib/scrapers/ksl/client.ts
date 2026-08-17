import { parseListings, detectBotChallenge } from "./parse";
import { cachedSearchBase, discoverSearchEndpoint } from "./discover";
import {
  scrapeViaScrapingBee,
  scrapingBeeConfigured,
  redactKey,
} from "@/lib/scrapers/scrapingbee";
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
  /** Whether the request went through ScrapingBee rather than straight out. */
  viaProxy: boolean;
  /** ScrapingBee credits spent, when it was used. */
  cost: number | null;
};

/**
 * One request, with a timeout and no retry-on-block.
 *
 * Deliberately no proxy rotation: the upstream repo shipped 300 proxies to get
 * around being blocked, and quietly evading a site's rate limiting is both
 * fragile and a terms-of-service problem. A block surfaces as a block.
 */
export async function fetchPage(url: string, timeoutMs = 20_000): Promise<FetchOutcome> {
  // With a key configured every fetch is rendered and proxied. A direct fetch
  // from a data centre is what classifieds sites block first, and a listing
  // page that hydrates client-side returns an empty shell without rendering —
  // which parses to zero listings and looks like "no results" rather than a
  // failure.
  if (scrapingBeeConfigured()) {
    const result = await scrapeViaScrapingBee(
      url,
      {
        renderJs: true,
        premium: process.env.SCRAPINGBEE_PREMIUM === "true",
        countryCode: process.env.SCRAPINGBEE_COUNTRY ?? "us",
        waitMs: 3000,
      },
      Math.max(timeoutMs, 60_000)
    );
    return {
      url,
      status: result.status,
      contentType: result.contentType,
      body: result.body,
      viaProxy: true,
      cost: result.cost,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, signal: controller.signal });
    return {
      url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: await response.text(),
      viaProxy: false,
      cost: null,
    };
  } catch (err) {
    throw new Error(redactKey(err instanceof Error ? err.message : "Request failed."));
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
 * KSL filters by path segment, not query string: /search/make/Ford returns 20
 * Fords, while ?make=Ford returns an unfiltered page that then has to be
 * filtered locally — which only ever narrows the first page of results.
 *
 * Only `make` is applied here because only `make` was confirmed against the
 * live site; the rest stay query parameters and are re-checked locally, so a
 * guess that KSL ignores costs accuracy of volume, never correctness.
 */
export function applyPathFilters(base: string, query: SearchQuery): string {
  let path = base.replace(/\/$/, "");

  // Don't double-append if the caller already pinned a filtered path.
  if (query.make && !/\/make\//i.test(path)) {
    path += `/make/${encodeURIComponent(query.make)}`;
  }
  if (query.forSaleByOwner && !/\/sellerType\//i.test(path)) {
    path += `/sellerType/${encodeURIComponent("For Sale By Owner")}`;
  }

  return path;
}

/**
 * Searches, discovering the endpoint on first use when one has not been pinned
 * via KSL_SEARCH_URL. Discovery result is cached per instance.
 */
export async function searchVehicles(
  query: SearchQuery
): Promise<{ listings: VehicleListing[]; outcome: FetchOutcome; base: string; dropped: number }> {
  const params = buildSearchParams(query);
  const known = cachedSearchBase();

  if (known) {
    const filtered = applyPathFilters(known, query);
    const url = `${filtered}${filtered.includes("?") ? "&" : "?"}${params}`;
    const outcome = await fetchPage(url);
    const blocked = detectBotChallenge(outcome.body);
    if (blocked) throw new Error(blocked);
    if (outcome.status === 200) {
      const listings = parseListings(outcome.body, outcome.contentType);
      if (listings.length > 0 || process.env.KSL_SEARCH_URL) {
        const { kept, dropped } = applyFilters(listings, query);
        return { listings: kept, outcome, base: known, dropped };
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

  const filtered = applyPathFilters(base, query);
  const url = `${filtered}${filtered.includes("?") ? "&" : "?"}${params}`;
  const outcome = await fetchPage(url);
  const blocked = detectBotChallenge(outcome.body);
  if (blocked) throw new Error(blocked);
  const { kept, dropped } = applyFilters(parseListings(outcome.body, outcome.contentType), query);
  return { listings: kept, outcome, base, dropped };
}

/**
 * Drops listings that do not match the requested filters.
 *
 * The query parameter names are a guess — the live site could not be inspected
 * — so if KSL ignores one, the server would return unfiltered results and the
 * caller would never know. Re-checking locally means the answer always honours
 * what was asked, and the count of dropped rows makes a wrong parameter name
 * visible rather than silent.
 */
export function applyFilters(
  listings: VehicleListing[],
  query: SearchQuery
): { kept: VehicleListing[]; dropped: number } {
  const matches = (listing: VehicleListing) => {
    const text = (value: string | null) => (value ?? "").toLowerCase();
    // Seller type is filtered by URL path segment, so if KSL renames it the
    // sweep would quietly fill with dealers. Re-checked locally for the same
    // reason the other filters are.
    if (query.forSaleByOwner) {
      const seller = `${text(listing.sellerType)} ${text(listing.sellerName)}`;
      if (/dealer|dealership|business|motors|auto sales/.test(seller)) return false;
    }
    if (query.make && !text(listing.make).includes(query.make.toLowerCase())) return false;
    if (query.model && !text(listing.model).includes(query.model.toLowerCase())) return false;
    // A listing missing the field is kept: absent is not the same as failing.
    if (query.yearMin !== undefined && listing.year !== null && listing.year < query.yearMin) return false;
    if (query.yearMax !== undefined && listing.year !== null && listing.year > query.yearMax) return false;
    if (query.priceMin !== undefined && listing.price !== null && listing.price < query.priceMin) return false;
    if (query.priceMax !== undefined && listing.price !== null && listing.price > query.priceMax) return false;
    if (
      query.mileageMax !== undefined &&
      listing.mileage !== null &&
      listing.mileage > query.mileageMax
    ) {
      return false;
    }
    return true;
  };

  const kept = listings.filter(matches);
  return { kept, dropped: listings.length - kept.length };
}

export async function fetchListing(
  listingId: string
): Promise<{ listing: VehicleListing | null; outcome: FetchOutcome }> {
  const url = `${LISTING_URL.replace(/\/$/, "")}/${encodeURIComponent(listingId)}`;
  const outcome = await fetchPage(url);
  const blocked = detectBotChallenge(outcome.body);
  if (blocked) throw new Error(blocked);
  if (outcome.status !== 200) {
    throw new Error(`KSL returned HTTP ${outcome.status} for ${url}.`);
  }
  const listings = parseListings(outcome.body, outcome.contentType);
  return { listing: listings[0] ?? null, outcome };
}
