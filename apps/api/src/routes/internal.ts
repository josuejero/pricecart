import { Hono } from "hono";
import type { Context } from "hono";
import { estimateP95FromBuckets } from "../lib/metrics";
import type { Env } from "../env";

type InternalContext = Context<{ Bindings: Env }>;

function requireInternal(c: InternalContext) {
  const token = c.env.INTERNAL_TOKEN;
  const got = c.req.header("x-pricecart-internal");
  return token && got && got === token;
}

function errorResponse(c: InternalContext, code: string, message: string, status: number) {
  const requestId = c.get?.("request_id");
  return c.json(
    {
      error: {
        code,
        message,
        request_id: requestId ?? undefined
      }
    },
    status
  );
}

export const internalRoutes = new Hono<{ Bindings: Env }>();

internalRoutes.use("*", async (c, next) => {
  if (!requireInternal(c)) {
    return errorResponse(c, "UNAUTHORIZED", "internal", 401);
  }
  await next();
});

internalRoutes.get("/attributions", (c) => {
  return c.json({
    attributions: [
      {
        id: "osm",
        name: "OpenStreetMap",
        license: "ODbL",
        required_text: "© OpenStreetMap contributors",
        link: "https://www.openstreetmap.org/copyright",
        where: ["Map view", "Store discovery/search"]
      },
      {
        id: "nominatim",
        name: "Nominatim",
        required_text: "Geocoding by Nominatim (OpenStreetMap)",
        link: "https://operations.osmfoundation.org/policies/nominatim/",
        where: ["Store discovery/search"]
      },
      {
        id: "overpass",
        name: "Overpass API",
        required_text: "POI search via Overpass API (OpenStreetMap)",
        link: "https://dev.overpass-api.de/overpass-doc/en/preface/commons.html",
        where: ["Store discovery/search"]
      },
      {
        id: "openfoodfacts",
        name: "Open Food Facts",
        license: "ODbL",
        required_text: "Data © Open Food Facts contributors",
        link: "https://world.openfoodfacts.org/terms-of-use",
        where: ["Product lookup", "Product search"]
      },
      {
        id: "openprices",
        name: "Open Prices",
        license: "ODbL (data)",
        required_text: "Price data © Open Prices contributors",
        link: "https://prices.openfoodfacts.org",
        where: ["Price history", "Price evidence"]
      },
      {
        id: "kroger",
        name: "Kroger API",
        required_text: "Live prices via Kroger API (where available)",
        link: "https://developer.kroger.com/",
        where: ["Live price overlay"]
      }
    ]
  });
});

internalRoutes.get("/metrics", async (c) => {
  const sinceMinutes = 60;
  const nowBucket = Math.floor(Date.now() / 60000);
  const minBucket = nowBucket - sinceMinutes;

  const routeRows = await c.env.DB
    .prepare(
      `SELECT route, method, status_class,
              SUM(count) AS count,
              SUM(sum_ms) AS sum_ms,
              MAX(max_ms) AS max_ms,
              SUM(b_50) AS b_50,
              SUM(b_100) AS b_100,
              SUM(b_250) AS b_250,
              SUM(b_500) AS b_500,
              SUM(b_1000) AS b_1000,
              SUM(b_inf) AS b_inf
         FROM route_metrics
        WHERE minute_bucket >= ?
        GROUP BY route, method, status_class
        ORDER BY count DESC`
    )
    .bind(minBucket)
    .all();

  type RouteMetricsRow = {
    route: string;
    method: string;
    status_class: number | string | null;
    count: number | string | null;
    sum_ms: number | string | null;
    max_ms: number | string | null;
    b_50: number | string | null;
    b_100: number | string | null;
    b_250: number | string | null;
    b_500: number | string | null;
    b_1000: number | string | null;
    b_inf: number | string | null;
  };

  const routes = (routeRows.results as RouteMetricsRow[]).map((row) => {
    const total = Number(row.count || 0);
    const p95 = estimateP95FromBuckets(total, {
      b_50: Number(row.b_50 || 0),
      b_100: Number(row.b_100 || 0),
      b_250: Number(row.b_250 || 0),
      b_500: Number(row.b_500 || 0),
      b_1000: Number(row.b_1000 || 0),
      b_inf: Number(row.b_inf || 0)
    });

    return {
      route: row.route,
      method: row.method,
      status_class: Number(row.status_class),
      count: total,
      avg_ms: total ? Math.round(Number(row.sum_ms) / total) : null,
      max_ms: Number(row.max_ms || 0),
      p95_upper_bound_ms: p95
    };
  });

  const providerRows = await c.env.DB
    .prepare(
      `SELECT provider, outcome, SUM(count) AS count
         FROM provider_metrics
        WHERE minute_bucket >= ?
        GROUP BY provider, outcome
        ORDER BY count DESC`
    )
    .bind(minBucket)
    .all();

  return c.json({
    window_minutes: sinceMinutes,
    routes,
    providers: providerRows.results
  });
});
