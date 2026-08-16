import type { VehicleListing } from "./types";

/**
 * Parsing KSL without being able to see KSL.
 *
 * A scraper that hardcodes one page's DOM breaks the first time the site is
 * redeployed, and this one was written without any access to the live site, so
 * hardcoding would be guessing. Instead it does two shape-agnostic things:
 *
 *   1. Pulls every JSON blob out of an HTML page — Next.js payloads, redux
 *      preloads, or the older inline `listings:` array — and searches all of
 *      them for objects that look like vehicles.
 *   2. Maps fields by alias rather than exact name, so `sellerPhone`,
 *      `cellPhone`, and `contactPhone` all land in the same place.
 *
 * The cost is that an unrecognised field name is kept in `extra` rather than
 * promoted, which is visible and fixable, instead of silently lost.
 */

const ALIASES: Record<keyof Omit<VehicleListing, "extra">, string[]> = {
  listingId: ["listingid", "id", "adid", "itemid"],
  url: ["url", "href", "permalink", "detailurl", "link"],

  vin: ["vin", "vehiclevin", "vinnumber"],
  year: ["year", "modelyear", "vehicleyear"],
  make: ["make", "makename", "manufacturer", "brand"],
  model: ["model", "modelname"],
  trim: ["trim", "trimname", "series", "submodel", "trimlevel"],

  price: ["price", "sellingprice", "askingprice", "listprice", "saleprice"],
  mileage: ["mileage", "miles", "odometer", "odometerreading"],

  bodyStyle: ["bodystyle", "body", "style", "bodytype"],
  transmission: ["transmission", "transmissiontype"],
  drivetrain: ["drivetrain", "drivetype", "drive", "driveline"],
  fuelType: ["fueltype", "fuel"],
  exteriorColor: ["exteriorcolor", "extcolor", "color", "exterior"],
  interiorColor: ["interiorcolor", "intcolor", "interior"],
  titleStatus: ["titlestatus", "titletype", "title"],
  condition: ["condition", "vehiclecondition"],

  sellerName: ["sellername", "contactname", "dealername", "name", "seller"],
  sellerType: ["sellertype", "listingtype", "dealertype", "source"],
  phone: [
    "phone",
    "sellerphone",
    "contactphone",
    "cellphone",
    "homephone",
    "phonenumber",
    "primaryphone",
  ],

  city: ["city", "sellercity"],
  state: ["state", "sellerstate", "stateabbr"],
  zip: ["zip", "zipcode", "postalcode", "sellerzip"],

  postedAt: ["postedat", "createdat", "publishedat", "dateposted", "displaytime", "modified"],
};

/** Field names are compared case- and separator-insensitively. */
const canonical = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  // "$18,995" and "112,000 miles" both reduce to their digits.
  const digits = value.replace(/[^0-9.]/g, "");
  if (!digits) return null;
  const parsed = Number.parseFloat(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/** Digits only, so 8015551234 and (801) 555-1234 compare equal downstream. */
function toPhone(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 10) return null;
  // Placeholder numbers are common in classifieds dumps and are not contacts.
  if (/^(\d)\1{9,}$/.test(digits) || digits.startsWith("9999999999")) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

/** Flattens one level of nesting so `{seller:{phone}}` is reachable by alias. */
function flatten(source: Record<string, unknown>, depth = 2): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value) && depth > 0) {
      for (const [innerKey, innerValue] of Object.entries(
        flatten(value as Record<string, unknown>, depth - 1)
      )) {
        // An outer field wins over a nested one of the same name.
        if (!(innerKey in flat)) flat[innerKey] = innerValue;
      }
      continue;
    }
    flat[key] = value;
  }
  return flat;
}

const NUMERIC_FIELDS = new Set(["year", "price", "mileage"]);

export function normalizeListing(raw: Record<string, unknown>): VehicleListing {
  const flat = flatten(raw);
  const byCanonical = new Map<string, unknown>();
  for (const [key, value] of Object.entries(flat)) {
    if (!byCanonical.has(canonical(key))) byCanonical.set(canonical(key), value);
  }

  const claimed = new Set<string>();
  const listing = {} as Record<string, unknown>;

  for (const [field, aliases] of Object.entries(ALIASES)) {
    let value: unknown;
    for (const alias of aliases) {
      if (byCanonical.has(alias)) {
        value = byCanonical.get(alias);
        claimed.add(alias);
        break;
      }
    }

    if (field === "phone") listing[field] = toPhone(value);
    else if (NUMERIC_FIELDS.has(field)) listing[field] = toNumber(value);
    else listing[field] = toText(value);
  }

  // Anything unrecognised is surfaced rather than dropped, so a field we did
  // not anticipate is visible in the output and can be aliased later.
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (claimed.has(canonical(key))) continue;
    if (value === null || value === "" || typeof value === "object") continue;
    extra[key] = value;
  }

  return { ...(listing as unknown as VehicleListing), extra };
}

/** A plausible vehicle: enough identifying fields that it is not a nav item. */
export function looksLikeVehicle(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = new Set(Object.keys(value as object).map(canonical));
  if (keys.has("vin")) return true;
  const hasMake = keys.has("make") || keys.has("makename");
  const hasModel = keys.has("model") || keys.has("modelname");
  const hasYear = keys.has("year") || keys.has("modelyear");
  const hasPrice = keys.has("price") || keys.has("sellingprice");
  return (hasMake && hasModel) || (hasYear && hasModel) || (hasModel && hasPrice);
}

/** Walks any JSON structure collecting objects that look like vehicles. */
export function collectListings(node: unknown, found: Record<string, unknown>[] = [], depth = 0) {
  if (depth > 12 || found.length >= 500) return found;

  if (Array.isArray(node)) {
    for (const item of node) collectListings(item, found, depth + 1);
    return found;
  }
  if (!node || typeof node !== "object") return found;

  if (looksLikeVehicle(node)) {
    found.push(node as Record<string, unknown>);
    // Still descend: a listing can nest its own related-vehicle blocks.
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    collectListings(value, found, depth + 1);
  }
  return found;
}

/**
 * Extracts JSON payloads embedded in an HTML page. Covers the three shapes a
 * site like this realistically uses: a Next.js data island, a redux-style
 * preload assigned to `window`, and a bare `listings:` array in inline script.
 */
/**
 * Next.js App Router streams its data as flight chunks rather than a single
 * JSON island:
 *
 *   <script>self.__next_f.push([1,"3:[\"$\",\"div\",null,{...}]\n"])</script>
 *
 * Each chunk is a JS string literal holding part of one continuous stream, so
 * they have to be decoded and concatenated before anything can be found in
 * them — a listing's JSON can straddle two chunks.
 */
export function extractFlightPayload(html: string): string {
  const chunks: string[] = [];
  // The quoted literal is valid JSON string syntax, so JSON.parse handles the
  // escaping (\", \\, \n, \uXXXX) correctly rather than a hand-rolled unescape.
  for (const match of html.matchAll(/self\.__next_f\.push\(\[\d+\s*,\s*("(?:[^"\\]|\\.)*")/g)) {
    try {
      chunks.push(JSON.parse(match[1]) as string);
    } catch {
      // A chunk that will not decode is not usable; skip it.
    }
  }
  return chunks.join("");
}

/**
 * Pulls balanced JSON objects out of arbitrary text, anchored on marker keys.
 *
 * Scanning every `{` in a 1.6 MB payload would be wasteful, so this only tries
 * positions shortly before a marker like `"vin"`, then walks back to the
 * enclosing brace and parses forward from there.
 */
export function extractObjectsNear(text: string, markers: string[], lookBehind = 6000): unknown[] {
  const found: unknown[] = [];
  const tried = new Set<number>();

  for (const marker of markers) {
    let at = text.indexOf(marker);
    while (at !== -1 && found.length < 500) {
      for (let start = at; start >= Math.max(0, at - lookBehind); start--) {
        if (text[start] !== "{" || tried.has(start)) continue;
        tried.add(start);

        // Walk forward tracking depth, respecting strings and escapes.
        let depth = 0;
        let inString = false;
        let escaped = false;
        let end = -1;
        for (let i = start; i < Math.min(text.length, start + 200_000); i++) {
          const ch = text[i];
          if (escaped) { escaped = false; continue; }
          if (ch === "\\") { escaped = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) { end = i + 1; break; }
          }
        }
        if (end === -1 || end <= at) continue;

        try {
          found.push(JSON.parse(text.slice(start, end)));
          break;
        } catch {
          // Not a self-contained object from here; try an earlier brace.
        }
      }
      at = text.indexOf(marker, at + marker.length);
    }
  }
  return found;
}

export function extractJsonBlobs(html: string): unknown[] {
  const blobs: unknown[] = [];

  const scriptJson = html.matchAll(
    /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const match of scriptJson) {
    try {
      blobs.push(JSON.parse(match[1]));
    } catch {
      // Not every JSON-typed script is parseable; skip rather than fail.
    }
  }

  const assigned = html.matchAll(
    /(?:window\.[A-Za-z_$][\w$]*|var\s+[A-Za-z_$][\w$]*)\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/gi
  );
  for (const match of assigned) {
    try {
      blobs.push(JSON.parse(match[1]));
    } catch {
      // Assignments often contain JS, not JSON.
    }
  }

  // The older inline form: `listings: [ … ],`
  for (const match of html.matchAll(/listings\s*:\s*(\[[\s\S]*?\])\s*[,}]/gi)) {
    try {
      blobs.push(JSON.parse(match[1]));
    } catch {
      // Ignore truncated matches.
    }
  }

  // Next.js App Router: decode the flight stream and dig objects out of it.
  const flight = extractFlightPayload(html);
  if (flight) {
    blobs.push(...extractObjectsNear(flight, ['"vin"', '"VIN"', '"make"', '"mileage"', '"listingId"']));
  }

  return blobs;
}

/** Parses a response body — JSON or HTML — into normalised listings. */
export function parseListings(body: string, contentType = ""): VehicleListing[] {
  const blobs: unknown[] = [];

  if (contentType.includes("json") || /^\s*[[{]/.test(body)) {
    try {
      blobs.push(JSON.parse(body));
    } catch {
      // Fall through to HTML extraction.
    }
  }
  if (blobs.length === 0) blobs.push(...extractJsonBlobs(body));

  const raw: Record<string, unknown>[] = [];
  for (const blob of blobs) collectListings(blob, raw);

  const seen = new Set<string>();
  const listings: VehicleListing[] = [];
  for (const item of raw) {
    const normalised = normalizeListing(item);
    // De-duplicate on the strongest identifier available.
    const key =
      normalised.vin ??
      normalised.listingId ??
      `${normalised.year}|${normalised.make}|${normalised.model}|${normalised.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    listings.push(normalised);
  }
  return listings;
}
