import { describe, expect, it } from "vitest";
import { takeToken } from "./rateLimit";

function fakeDb(): D1Database {
  const m = new Map<string, { tokens: number; updated_at: number }>();
  return {
    prepare(sql: string) {
      return {
        bind(key: string, ...rest: unknown[]) {
          return {
            async first() {
              return m.get(key) ?? null;
            },
            async run() {
              if (sql.includes("INSERT OR REPLACE INTO rate_limits")) {
                const [tokensValue, updatedValue] = rest;
                const tokens = Number(tokensValue);
                const updated = Number(updatedValue);
                m.set(key, { tokens, updated_at: updated });
              }
              return { success: true };
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}

describe("takeToken", () => {
  it("allows up to capacity then blocks", async () => {
    const db = fakeDb();
    const cfg = { capacity: 2, refillPerSec: 0, cost: 1 };

    expect(await takeToken(db, "k", cfg)).toBe(true);
    expect(await takeToken(db, "k", cfg)).toBe(true);
    expect(await takeToken(db, "k", cfg)).toBe(false);
  });
});
