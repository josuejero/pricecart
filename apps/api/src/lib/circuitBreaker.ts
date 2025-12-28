import { nowSec } from "./time";

type Row = { consecutive_failures: number; open_until: number };

export async function isOpen(db: D1Database, provider: string): Promise<boolean> {
  const t = nowSec();
  const row = await db
    .prepare("SELECT consecutive_failures, open_until FROM provider_health WHERE provider = ?")
    .bind(provider)
    .first<Row>();
  if (!row) return false;
  return row.open_until > t;
}

export async function recordSuccess(db: D1Database, provider: string): Promise<void> {
  await db
    .prepare(
      "INSERT OR REPLACE INTO provider_health (provider, consecutive_failures, open_until) VALUES (?, 0, 0)"
    )
    .bind(provider)
    .run();
}

export async function recordFailure(
  db: D1Database,
  provider: string,
  opts?: { tripAfter?: number; openForSec?: number }
): Promise<void> {
  const tripAfter = opts?.tripAfter ?? 3;
  const openForSec = opts?.openForSec ?? 300;

  const t = nowSec();
  const row = await db
    .prepare("SELECT consecutive_failures, open_until FROM provider_health WHERE provider = ?")
    .bind(provider)
    .first<Row>();

  const failures = (row?.consecutive_failures ?? 0) + 1;
  const openUntil = failures >= tripAfter ? t + openForSec : (row?.open_until ?? 0);

  await db
    .prepare(
      "INSERT OR REPLACE INTO provider_health (provider, consecutive_failures, open_until) VALUES (?, ?, ?)"
    )
    .bind(provider, failures, openUntil)
    .run();
}