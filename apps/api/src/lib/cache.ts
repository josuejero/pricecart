import { nowSec } from "./time";

export async function cacheGet<T>(db: D1Database, cacheKey: string): Promise<T | null> {
  const t = nowSec();
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM query_cache WHERE cache_key = ?")
    .bind(cacheKey)
    .first<{ payload_json: string; expires_at: number }>();

  if (!row) return null;
  if (row.expires_at <= t) return null;
  return JSON.parse(row.payload_json) as T;
}

export async function cachePut<T>(
  db: D1Database,
  cacheKey: string,
  payload: T,
  ttlSec: number
): Promise<void> {
  const t = nowSec();
  const expires = t + ttlSec;
  await db
    .prepare(
      "INSERT OR REPLACE INTO query_cache (cache_key, payload_json, created_at, expires_at) VALUES (?, ?, ?, ?)"
    )
    .bind(cacheKey, JSON.stringify(payload), t, expires)
    .run();
}

export async function cachePurgeExpired(db: D1Database): Promise<void> {
  const t = nowSec();
  await db.prepare("DELETE FROM query_cache WHERE expires_at <= ?").bind(t).run();
}


export async function cachePeek<T>(
  db: D1Database,
  cacheKey: string
): Promise<{ payload: T; expires_at: number; is_fresh: boolean } | null> {
  const t = nowSec();
  const row = await db
    .prepare("SELECT payload_json, expires_at FROM query_cache WHERE cache_key = ?")
    .bind(cacheKey)
    .first<{ payload_json: string; expires_at: number }>();

  if (!row) return null;

  const payload = JSON.parse(row.payload_json) as T;
  return { payload, expires_at: row.expires_at, is_fresh: row.expires_at > t };
}