import { describe, expect, it } from "vitest";
import { parseOffLookupResponse, parseOffSearchResponse } from "./openFoodFacts";

import { readFileSync } from "node:fs";

function loadFixture(path: string) {
  const p = new URL(path, import.meta.url);
  return JSON.parse(readFileSync(p, "utf-8"));
}

describe("OpenFoodFacts provider parsing", () => {
  it("parses lookup happy path", async () => {
    const json = await loadFixture("./__fixtures__/off_lookup_found.json");
    const p = parseOffLookupResponse(json, "0123456789012");
    expect(p.code).toBe("0123456789012");
    expect(p.product_name).toMatch(/Fixture/);
  });

  it("lookup not found maps to NOT_FOUND", async () => {
    const json = await loadFixture("./__fixtures__/off_lookup_not_found.json");
    expect(() => parseOffLookupResponse(json, "0123456789012")).toThrow(/NOT_FOUND/);
  });

  it("parses search response", async () => {
    const json = await loadFixture("./__fixtures__/off_search_found.json");
    const r = parseOffSearchResponse(json);
    expect(r.products.length).toBeGreaterThan(0);
  });

  it("tolerates schema drift", async () => {
    const json = await loadFixture("./__fixtures__/off_schema_drift.json");
    const p = parseOffLookupResponse(json, "0123456789012");
    expect(p.code).toBe("0123456789012");
  });
});