import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseKrogerLocationsResponse, parseKrogerProductDetailsResponse } from "./kroger";

function fixture(name: string) {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf-8"));
}

describe("Kroger provider (contract)", () => {
  it("parses locations", () => {
    const json = fixture("kroger_locations_found.json");
    const locs = parseKrogerLocationsResponse(json);
    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].locationId).toBe("12345");
    expect(typeof locs[0].lat).toBe("number");
    expect(typeof locs[0].lon).toBe("number");
  });

  it("parses product price (prefers promo)", () => {
    const json = fixture("kroger_product_details_found.json");
    const p = parseKrogerProductDetailsResponse(json, "0001111041707");
    expect(p.upc).toBe("0001111041707");
    expect(p.price_cents).toBe(199);
  });
});
