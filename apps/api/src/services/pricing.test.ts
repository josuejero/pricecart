import { describe, expect, it } from "vitest";

function adjustedTotal(total: number, completeness: number): number {
  const denom = Math.max(0.25, completeness);
  return Math.round(total / denom);
}

describe("pricing helpers", () => {
  it("penalizes missing items by inflating adjusted total", () => {
    expect(adjustedTotal(1000, 1.0)).toBe(1000);
    expect(adjustedTotal(1000, 0.5)).toBe(2000);
    expect(adjustedTotal(1000, 0.25)).toBe(4000);
  });
});