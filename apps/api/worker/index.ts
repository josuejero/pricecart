import type { Env } from "../src/env";
import app from "../src/index";

export default {
  async fetch(
    request: Request,
    env: Env & { ASSETS?: Fetcher },
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Keep the Vite template demo endpoint working (App.tsx fetches /api/)
    // BUT do not swallow real API routes like /api/health, /api/stores/search, etc.
    if (url.pathname === "/api" || url.pathname === "/api/") {
      return Response.json({ name: "Cloudflare" });
    }

    const isApiPrefixed = url.pathname.startsWith("/api/");

    // Support both:
    // - /health, /stores/search, /products/search
    // - /api/health, /api/stores/search, /api/products/search
    if (isApiPrefixed) {
      url.pathname = url.pathname.slice("/api".length) || "/";
      request = new Request(url.toString(), request);
    }

    const res = await app.fetch(request, env, ctx);

    // Never fall back to static assets for /api/* calls.
    if (isApiPrefixed) return res;

    // If the Hono app didn't match, let the SPA/static assets system try (if present).
    if (res.status === 404 && env.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return res;
  }
};
