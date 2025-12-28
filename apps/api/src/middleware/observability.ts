import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import { parseSampleRate, recordRouteMetric } from "../lib/metrics";

function getOrCreateRequestId(c: any) {
  const incoming = c.req.header("x-request-id") || c.req.header("x-requestid");
  const cfRay = c.req.header("cf-ray");
  return incoming || cfRay || crypto.randomUUID();
}

export const observabilityMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = getOrCreateRequestId(c);
  c.set("request_id", requestId);

  const start = Date.now();

  try {
    await next();
  } finally {
    const latencyMs = Date.now() - start;
    const status = c.res?.status ?? 500;

    c.header("x-request-id", requestId);

    const route = routePath(c) || c.req.path;

    console.log(
      JSON.stringify({
        level: "info",
        ts: new Date().toISOString(),
        request_id: requestId,
        method: c.req.method,
        route,
        status,
        latency_ms: latencyMs
      })
    );

    const enabled = c.env.METRICS_ENABLED === "1";
    const sampleRate = parseSampleRate(c.env.METRICS_SAMPLE_RATE, 1);

    c.executionCtx?.waitUntil(
      recordRouteMetric({
        db: c.env.DB,
        enabled,
        sampleRate,
        route,
        method: c.req.method,
        status,
        latencyMs
      }).catch(() => {})
    );
  }
};
