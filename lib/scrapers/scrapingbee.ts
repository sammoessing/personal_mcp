/**
 * ScrapingBee — a rendering proxy that fetches a page for you.
 *
 * This matters for KSL specifically. A bare server-side fetch from a data
 * centre is the request classifieds sites block first, and modern listing
 * pages hydrate their results in the browser, so even a successful fetch can
 * return a shell with no listings in it. ScrapingBee runs a real browser and
 * rotates residential IPs, which addresses both.
 *
 * It is optional: with no key configured the scrapers fetch directly, and the
 * only cost is a higher chance of being blocked.
 */

export type ScrapeOptions = {
  /** Execute JavaScript before returning. Needed for hydrated listing pages. */
  renderJs?: boolean;
  /** Route through a residential IP. Costs more credits; needed when blocked. */
  premium?: boolean;
  /** Two-letter country code for the exit IP, e.g. "us". */
  countryCode?: string;
  /** Wait this many ms after load before capturing. */
  waitMs?: number;
  /** Wait until this CSS selector appears, which beats a fixed delay. */
  waitForSelector?: string;
};

export const scrapingBeeConfigured = () => Boolean(process.env.SCRAPINGBEE_API_KEY);

/**
 * Builds the proxied request URL. The target is passed as a query parameter,
 * so it must be encoded — an unencoded `&` in the target would otherwise be
 * read as a ScrapingBee option.
 */
export function buildScrapingBeeUrl(target: string, options: ScrapeOptions = {}): string {
  const key = process.env.SCRAPINGBEE_API_KEY;
  if (!key) throw new Error("SCRAPINGBEE_API_KEY is not set.");

  const url = new URL("https://app.scrapingbee.com/api/v1/");
  url.searchParams.set("api_key", key);
  url.searchParams.set("url", target);

  // Default to rendering: the failure it prevents (an empty shell that parses
  // to zero listings) is silent, whereas the cost of rendering is just credits.
  url.searchParams.set("render_js", String(options.renderJs ?? true));

  if (options.premium) url.searchParams.set("premium_proxy", "true");
  if (options.countryCode) url.searchParams.set("country_code", options.countryCode);
  if (options.waitMs) url.searchParams.set("wait", String(options.waitMs));
  if (options.waitForSelector) url.searchParams.set("wait_for", options.waitForSelector);

  return url.toString();
}

export type ScrapeResult = {
  status: number;
  body: string;
  contentType: string;
  /** Credits this request cost, as reported by the API. */
  cost: number | null;
  /** True when the response came back through ScrapingBee rather than directly. */
  viaProxy: boolean;
};

/** Never let the key reach a log line or an error shown to a user. */
export const redactKey = (text: string): string =>
  process.env.SCRAPINGBEE_API_KEY
    ? text.replaceAll(process.env.SCRAPINGBEE_API_KEY, "<SCRAPINGBEE_API_KEY>")
    : text;

export async function scrapeViaScrapingBee(
  target: string,
  options: ScrapeOptions = {},
  timeoutMs = 60_000
): Promise<ScrapeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildScrapingBeeUrl(target, options), {
      signal: controller.signal,
    });
    const body = await response.text();

    if (response.status === 401) {
      throw new Error("ScrapingBee rejected the API key (401). Check SCRAPINGBEE_API_KEY.");
    }
    if (response.status === 402) {
      throw new Error("ScrapingBee credits are exhausted (402).");
    }

    const cost = Number(response.headers.get("spb-cost-1"));
    return {
      status: response.status,
      body,
      contentType: response.headers.get("content-type") ?? "",
      cost: Number.isFinite(cost) && cost > 0 ? cost : null,
      viaProxy: true,
    };
  } catch (err) {
    // The request URL carries the key, so any message derived from it is
    // scrubbed before it can reach a tool result or a log.
    throw new Error(redactKey(err instanceof Error ? err.message : "ScrapingBee request failed."));
  } finally {
    clearTimeout(timer);
  }
}
