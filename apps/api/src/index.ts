import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { cors } from "./middleware/cors";
import { securityHeaders } from "./middleware/security";
import { productSearch } from "./services/productSearch";
import { storeSearch } from "./services/storeDiscovery";

const app = new Hono<{ Bindings: Env }>();

// Adjust to your Pages domain once known
const ALLOWED_ORIGIN = "http://localhost:5173";

app.use("*", securityHeaders());
app.use("*", cors(ALLOWED_ORIGIN));

app.get("/health", (c) => c.json({ ok: true }));

const StoreSearchQuery = z.object({
  location: z.string().min(2).max(200),
  radius_m: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(50).optional()
});

const ProductSearchQuery = z.object({
  q: z.string().min(2).max(200),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(50).optional()
});

function slicePage<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

app.get("/stores/search", async (c) => {
  const parsed = StoreSearchQuery.safeParse({
    location: c.req.query("location"),
    radius_m: c.req.query("radius_m"),
    page: c.req.query("page"),
    page_size: c.req.query("page_size")
  });

  if (!parsed.success) {
    return c.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, 400);
  }

  const sessionId = c.req.header("x-pricecart-session") || "anon";
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 20;

  try {
    const res = await storeSearch(c.env, {
      location: parsed.data.location,
      radius_m: parsed.data.radius_m ?? 5000,
      session_id: sessionId
    });

    const totalCount = res.stores.length;
    const stores = slicePage(res.stores, page, pageSize);

    console.log(
      JSON.stringify({
        level: "info",
        route: "/stores/search",
        session: sessionId,
        data_mode: res.data_mode,
        radius_m: res.radius_m,
        page,
        page_size: pageSize,
        store_count: stores.length,
        total_count: totalCount
      })
    );

    return c.json({
      ...res,
      stores,
      page,
      page_size: pageSize,
      total_count: totalCount
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    if (msg.includes("RATE_LIMIT")) return c.json({ error: "RATE_LIMITED" }, 429);
    if (msg.includes("NOT_FOUND")) return c.json({ error: "NOT_FOUND" }, 404);

    console.log(
      JSON.stringify({
        level: "error",
        route: "/stores/search",
        session: sessionId,
        message: "store search failed",
        err: msg
      })
    );

    return c.json({ error: "INTERNAL_ERROR" }, 500);
  }
});

app.get("/products/search", async (c) => {
  const parsed = ProductSearchQuery.safeParse({
    q: c.req.query("q"),
    page: c.req.query("page"),
    page_size: c.req.query("page_size")
  });

  if (!parsed.success) {
    return c.json({ error: "INVALID_INPUT", details: parsed.error.flatten() }, 400);
  }

  const sessionId = c.req.header("x-pricecart-session") || "anon";
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.page_size ?? 10;

  try {
    const res = await productSearch(c.env, {
      q: parsed.data.q,
      page,
      page_size: pageSize,
      session_id: sessionId
    });

    console.log(
      JSON.stringify({
        level: "info",
        route: "/products/search",
        session: sessionId,
        q: parsed.data.q,
        page,
        page_size: pageSize,
        product_count: res.products.length,
        total_count: res.total_count
      })
    );

    return c.json(res);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    if (msg.includes("RATE_LIMIT")) return c.json({ error: "RATE_LIMITED" }, 429);

    console.log(
      JSON.stringify({
        level: "error",
        route: "/products/search",
        session: sessionId,
        message: "product search failed",
        err: msg
      })
    );

    return c.json({ error: "INTERNAL_ERROR" }, 500);
  }
});

export default app;
