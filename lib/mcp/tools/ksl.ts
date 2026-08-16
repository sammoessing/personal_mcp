import { z } from "zod";
import { textResult, errorResult, type ToolDefinition, type ToolContext } from "@/lib/mcp/types";
import {
  searchVehicles,
  fetchListing,
  fetchPage,
  buildSearchParams,
} from "@/lib/scrapers/ksl/client";
import {
  discoverSearchEndpoint,
  fetchRobots,
  robotsDisallows,
} from "@/lib/scrapers/ksl/discover";
import { parseListings, describePayload } from "@/lib/scrapers/ksl/parse";
import type { VehicleListing } from "@/lib/scrapers/ksl/types";

function render(listing: VehicleListing): string {
  const name = [listing.year, listing.make, listing.model, listing.trim]
    .filter(Boolean)
    .join(" ");
  const lines = [
    name || "(unidentified vehicle)",
    listing.vin ? `  VIN: ${listing.vin}` : null,
    listing.price !== null ? `  Price: $${listing.price.toLocaleString()}` : null,
    listing.mileage !== null ? `  Mileage: ${listing.mileage.toLocaleString()}` : null,
    [
      listing.bodyStyle && `body ${listing.bodyStyle}`,
      listing.transmission && `trans ${listing.transmission}`,
      listing.drivetrain && `drive ${listing.drivetrain}`,
      listing.fuelType && `fuel ${listing.fuelType}`,
    ]
      .filter(Boolean)
      .join(" · ") || null,
    [listing.exteriorColor && `ext ${listing.exteriorColor}`, listing.interiorColor && `int ${listing.interiorColor}`]
      .filter(Boolean)
      .join(" · ") || null,
    listing.titleStatus ? `  Title: ${listing.titleStatus}` : null,
    [listing.city, listing.state, listing.zip].filter(Boolean).join(", ") || null,
    listing.sellerName || listing.sellerType
      ? `  Seller: ${[listing.sellerName, listing.sellerType].filter(Boolean).join(" · ")}`
      : null,
    listing.phone ? `  Phone: ${listing.phone}` : null,
    listing.postedAt ? `  Posted: ${listing.postedAt}` : null,
    listing.url ? `  ${listing.url}` : null,
    listing.listingId ? `  id: ${listing.listingId}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * KSL vehicle listings.
 *
 * Phone numbers are returned when the listing exposes them, at the owner's
 * request. Whether a given number may then be called or texted is a decision
 * for the caller — scraped numbers are not consent under the TCPA, and DNC
 * screening happens outside this tool.
 */
export const kslTools: ToolDefinition[] = [
  {
    name: "ksl_search_vehicles",
    title: "Search KSL vehicle listings",
    description:
      "Search KSL Cars for vehicle listings and return structured details — VIN, year, make, model, trim, price, mileage, title status, location, seller, and phone where the listing publishes one.",
    inputSchema: {
      make: z.string().optional(),
      model: z.string().optional(),
      yearMin: z.number().int().optional(),
      yearMax: z.number().int().optional(),
      priceMin: z.number().int().optional(),
      priceMax: z.number().int().optional(),
      mileageMax: z.number().int().optional(),
      zip: z.string().optional().describe("Centre of the search radius"),
      radius: z.number().int().optional().describe("Miles from zip"),
      keyword: z.string().optional(),
      page: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    handler: async (
      args: {
        make?: string;
        model?: string;
        yearMin?: number;
        yearMax?: number;
        priceMin?: number;
        priceMax?: number;
        mileageMax?: number;
        zip?: string;
        radius?: number;
        keyword?: string;
        page?: number;
        limit: number;
      },
      _ctx: ToolContext
    ) => {
      try {
        const { listings, outcome, base, dropped } = await searchVehicles(args);
        if (listings.length === 0) {
          return textResult(
            [
              `No listings parsed from ${outcome.url}.`,
              "",
              "Either the search genuinely matched nothing, or the page shape has changed.",
              "Run ksl_probe with the same filters to see what the response actually contains.",
            ].join("\n")
          );
        }

        const shown = listings.slice(0, args.limit);
        const withPhone = shown.filter((listing) => listing.phone).length;
        return textResult(
          [
            `${listings.length} matching listing${listings.length === 1 ? "" : "s"} from ${base}, showing ${shown.length}. ${withPhone} include a phone number.`,
            dropped > 0
              ? `(${dropped} returned by the site did not match the filters and were dropped locally — if this is most of them, the query parameter names need correcting.)`
              : "",
            "",
            shown.map(render).join("\n\n"),
          ].join("\n")
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "The search failed.");
      }
    },
  },
  {
    name: "ksl_get_listing",
    title: "Get one KSL listing",
    description:
      "Fetch full details for a single KSL vehicle listing by its id, including any fields the search results omit.",
    inputSchema: { listingId: z.string() },
    handler: async (args: { listingId: string }, _ctx: ToolContext) => {
      try {
        const { listing, outcome } = await fetchListing(args.listingId);
        if (!listing) return errorResult(`No vehicle could be parsed from ${outcome.url}.`);

        const extra = Object.entries(listing.extra).slice(0, 25);
        return textResult(
          [
            render(listing),
            extra.length > 0 ? "\nOther fields on the listing:" : "",
            ...extra.map(([key, value]) => `  ${key}: ${String(value).slice(0, 120)}`),
          ]
            .filter(Boolean)
            .join("\n")
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "The fetch failed.");
      }
    },
  },
  {
    name: "ksl_probe",
    title: "Diagnose the KSL response shape",
    description:
      "Fetch a KSL search page and report what came back — status, content type, which JSON payloads were found, and the field names on the first candidate listing. Use this when a search returns nothing, to see whether the site's shape has changed.",
    inputSchema: {
      url: z.string().optional().describe("Full URL to probe; defaults to a bare search"),
    },
    handler: async (args: { url?: string }, _ctx: ToolContext) => {
      try {
        // A single explicit URL when given; otherwise every candidate, so one
        // run identifies which endpoint works rather than confirming one guess.
        if (args.url) {
          const outcome = await fetchPage(args.url);
          const listings = parseListings(outcome.body, outcome.contentType);

          // Testing a filter URL needs the distribution, not one example: 24
          // listings that are all Fords proves ?make=Ford works, one Ford
          // proves nothing.
          const makes = new Map<string, number>();
          for (const listing of listings) {
            const make = listing.make ?? "(none)";
            makes.set(make, (makes.get(make) ?? 0) + 1);
          }
          const withPhone = listings.filter((listing) => listing.phone).length;

          return textResult(
            [
              `${outcome.url}`,
              `HTTP ${outcome.status} · ${outcome.contentType || "no content-type"} · ${outcome.body.length.toLocaleString()} bytes · ${listings.length} listings`,
              listings.length > 0
                ? `makes: ${[...makes.entries()].map(([make, count]) => `${make}×${count}`).join(", ")} · ${withPhone} with phone`
                : "",
              "",
              listings[0]
                ? render(listings[0])
                : ["Nothing parsed. Diagnosis:", "", describePayload(outcome.body)].join("\n"),
            ]
              .filter(Boolean)
              .join("\n")
          );
        }

        const params = buildSearchParams({ perPage: 24 });
        const { base, attempts } = await discoverSearchEndpoint(params);

        const table = attempts
          .map(
            (attempt) =>
              `  ${attempt.error ? "ERR " : `${attempt.status} `}` +
              `${attempt.listings} listings · ${attempt.bytes.toLocaleString()} bytes · ${attempt.url}` +
              (attempt.error ? `\n       ${attempt.error}` : "")
          )
          .join("\n");

        if (!base) {
          const worst = attempts.find((attempt) => attempt.status === 403);
          // The largest 200 is the page most likely to be the real results
          // page, so diagnose that one rather than all five.
          const best = attempts
            .filter((attempt) => attempt.status === 200 && attempt.diagnosis)
            .sort((a, b) => b.bytes - a.bytes)[0];

          return textResult(
            [
              "No candidate endpoint returned parseable listings.",
              "",
              table,
              "",
              worst
                ? "At least one returned 403 — the requests are being blocked rather than mis-addressed."
                : "Endpoints responded but nothing parsed as a vehicle.",
              best ? `\nDiagnosis for ${best.url}:\n\n${best.diagnosis}` : "",
            ]
              .filter(Boolean)
              .join("\n")
          );
        }

        const origin = new URL(base).origin;
        const robots = await fetchRobots(origin);
        const path = new URL(base).pathname;

        return textResult(
          [
            `Working endpoint: ${base}`,
            "",
            "All candidates:",
            table,
            "",
            robots
              ? `robots.txt ${robotsDisallows(robots, path) ? `DISALLOWS ${path} for *` : `permits ${path} for *`}`
              : "robots.txt could not be read.",
            "",
            "Set KSL_SEARCH_URL to this endpoint to skip discovery on every cold start.",
          ].join("\n")
        );
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "The probe failed.");
      }
    },
  },
];
