import { nowSec } from "./time";

export type TokenBucketConfig = {
  capacity: number;        // max tokens stored
  refillPerSec: number;    // tokens added per second
  cost: number;            // tokens consumed per operation
};

/**
 * Leaky token bucket stored in D1.
 * Returns true if allowed, false if rate-limited.
 */
export async function takeToken(
  db: D1Database,
  key: string,
  cfg: TokenBucketConfig
): Promise<boolean> {
  const t = nowSec();
  const row = await db
    .prepare("SELECT tokens, updated_at FROM rate_limits WHERE rl_key = ?")
    .bind(key)
    .first<{ tokens: number; updated_at: number }>();

  let tokens = row?.tokens ?? cfg.capacity;
  const updatedAt = row?.updated_at ?? t;
  const elapsed = Math.max(0, t - updatedAt);

  tokens = Math.min(cfg.capacity, tokens + elapsed * cfg.refillPerSec);

  const allowed = tokens >= cfg.cost;
  if (allowed) tokens -= cfg.cost;

  await db
    .prepare("INSERT OR REPLACE INTO rate_limits (rl_key, tokens, updated_at) VALUES (?, ?, ?)")
    .bind(key, tokens, t)
    .run();

  return allowed;
}