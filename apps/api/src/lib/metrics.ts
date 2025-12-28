type BucketCounts = {
  b_50: number;
  b_100: number;
  b_250: number;
  b_500: number;
  b_1000: number;
  b_inf: number;
};

export function getMinuteBucket(now = Date.now()) {
  return Math.floor(now / 60000);
}

export function getDayString(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function bucketLatency(ms: number): BucketCounts {
  return {
    b_50: ms <= 50 ? 1 : 0,
    b_100: ms > 50 && ms <= 100 ? 1 : 0,
    b_250: ms > 100 && ms <= 250 ? 1 : 0,
    b_500: ms > 250 && ms <= 500 ? 1 : 0,
    b_1000: ms > 500 && ms <= 1000 ? 1 : 0,
    b_inf: ms > 1000 ? 1 : 0
  };
}

export function parseSampleRate(v: string | undefined, fallback = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export async function recordRouteMetric(args: {
  db: D1Database;
  enabled: boolean;
  sampleRate: number;
  route: string;
  method: string;
  status: number;
  latencyMs: number;
}) {
  if (!args.enabled) return;
  if (args.sampleRate < 1 && Math.random() > args.sampleRate) return;

  const day = getDayString();
  const minute_bucket = getMinuteBucket();
  const status_class = args.status >= 500 ? 5 : args.status >= 400 ? 4 : 2;
  const buckets = bucketLatency(args.latencyMs);

  const stmt = args.db
    .prepare(
      `INSERT INTO route_metrics (
        day, minute_bucket, route, method, status_class,
        count, sum_ms, max_ms,
        b_50, b_100, b_250, b_500, b_1000, b_inf
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, minute_bucket, route, method, status_class)
      DO UPDATE SET
        count = count + excluded.count,
        sum_ms = sum_ms + excluded.sum_ms,
        max_ms = MAX(max_ms, excluded.max_ms),
        b_50 = b_50 + excluded.b_50,
        b_100 = b_100 + excluded.b_100,
        b_250 = b_250 + excluded.b_250,
        b_500 = b_500 + excluded.b_500,
        b_1000 = b_1000 + excluded.b_1000,
        b_inf = b_inf + excluded.b_inf`
    )
    .bind(
      day,
      minute_bucket,
      args.route,
      args.method,
      status_class,
      args.latencyMs,
      args.latencyMs,
      buckets.b_50,
      buckets.b_100,
      buckets.b_250,
      buckets.b_500,
      buckets.b_1000,
      buckets.b_inf
    );

  await stmt.run();
}

export async function recordProviderMetric(args: {
  db: D1Database;
  enabled: boolean;
  provider: string;
  outcome: string;
}) {
  if (!args.enabled) return;

  const day = getDayString();
  const minute_bucket = getMinuteBucket();

  const stmt = args.db
    .prepare(
      `INSERT INTO provider_metrics (day, minute_bucket, provider, outcome, count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(day, minute_bucket, provider, outcome)
       DO UPDATE SET count = count + 1`
    )
    .bind(day, minute_bucket, args.provider, args.outcome);

  await stmt.run();
}

export function estimateP95FromBuckets(total: number, buckets: BucketCounts) {
  if (total <= 0) return null;
  const target = Math.ceil(total * 0.95);
  const ordered: Array<[number, number]> = [
    [50, buckets.b_50],
    [100, buckets.b_100],
    [250, buckets.b_250],
    [500, buckets.b_500],
    [1000, buckets.b_1000],
    [Infinity, buckets.b_inf]
  ];
  let cumulative = 0;
  for (const [upper, count] of ordered) {
    cumulative += count;
    if (cumulative >= target) return upper;
  }
  return Infinity;
}
