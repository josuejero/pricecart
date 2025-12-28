import { describe, expect, it } from "vitest";
import { normalizeCart } from "./cartReducer";

describe("normalizeCart", () => {
  it("merges duplicate UPCs", () => {
    const out = normalizeCart({ items: [{ upc: "1", count: 1 }, { upc: "1", count: 2 }] });
    expect(out.items).toEqual([{ upc: "1", count: 3 }]);
  });

  it("clamps minimum quantity to 1", () => {
    const out = normalizeCart({ items: [{ upc: "1", count: 0 }] });
    expect(out.items[0].count).toBe(1);
  });
});