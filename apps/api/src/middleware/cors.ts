import type { MiddlewareHandler } from "hono";

export function cors(allowedOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("Origin") || "";
    if (origin && origin === allowedOrigin) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Headers", "content-type, x-pricecart-session");
      c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  };
}