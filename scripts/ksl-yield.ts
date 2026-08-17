/**
 * Measures how many private-seller listings publish a reachable phone number.
 *
 * KSL has no phone field, so the only numbers available without a login are the
 * ones sellers write into their own descriptions. Whether that is 5% of
 * listings or 40% decides whether this pipeline is useful on its own, and it is
 * a question to answer by counting rather than guessing.
 *
 * Run:
 *   npx tsx scripts/ksl-yield.ts            # private sellers, 5 pages
 *   npx tsx scripts/ksl-yield.ts 10 Ford    # 10 pages, Fords only
 *
 * Needs SCRAPINGBEE_API_KEY in .env.local (KSL blocks unrendered requests).
 */

import { readFileSync } from "node:fs";
import { searchVehicles } from "../lib/scrapers/ksl/client";
import type { VehicleListing } from "../lib/scrapers/ksl/types";

// Load .env.local by hand so the script needs no framework and no extra deps.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No .env.local is fine if the variables are already exported.
}

if (!process.env.SCRAPINGBEE_API_KEY) {
  console.error("SCRAPINGBEE_API_KEY is not set. Put it in .env.local first.");
  process.exit(1);
}

async function main() {
  const pageCount = Number(process.argv[2] ?? 5);
  const make = process.argv[3];

  const seen = new Map<string, VehicleListing>();

  for (let page = 1; page <= pageCount; page++) {
    process.stdout.write(`page ${page}/${pageCount} … `);
    try {
      const { listings } = await searchVehicles({
        forSaleByOwner: true,
        make,
        page,
        perPage: 24,
      });

      let added = 0;
      for (const listing of listings) {
        // Paging can repeat listings as the site reorders; count each once.
        const key = listing.listingId ?? `${listing.vin}-${listing.price}`;
        if (key && !seen.has(key)) {
          seen.set(key, listing);
          added++;
        }
      }
      console.log(`${listings.length} listings, ${added} new (${seen.size} total)`);

      // An empty page means the end of the results, not a failure.
      if (listings.length === 0) break;
    } catch (err) {
      console.log(`failed — ${err instanceof Error ? err.message : err}`);
      break;
    }
  }

  const all = [...seen.values()];
  const withPhone = all.filter((listing) => listing.phone);
  const percent = all.length > 0 ? ((withPhone.length / all.length) * 100).toFixed(1) : "0";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Listings swept:        ${all.length}`);
  console.log(`With a phone number:   ${withPhone.length}  (${percent}%)`);
  console.log(`With a VIN:            ${all.filter((l) => l.vin).length}`);
  console.log(`${"=".repeat(60)}\n`);

  for (const listing of withPhone) {
    const name = [listing.year, listing.make, listing.model, listing.trim].filter(Boolean).join(" ");
    console.log(`${listing.phone}  ${name} — $${listing.price?.toLocaleString() ?? "?"} — ${listing.url}`);
  }

  // CSV on stdout is the easiest thing to paste into a spreadsheet.
  const columns: (keyof VehicleListing)[] = [
    "listingId", "phone", "year", "make", "model", "trim", "vin",
    "price", "mileage", "titleStatus", "city", "state", "zip",
    "sellerName", "sellerType", "postedAt", "url",
  ];

  console.log(`\n--- CSV ---\n${columns.join(",")}`);
  for (const listing of all) {
    console.log(
      columns
        .map((column) => {
          const value = listing[column];
          if (value === null || value === undefined) return "";
          const text = String(value);
          return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(",")
    );
  }

}

main();
