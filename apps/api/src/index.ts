import { CartAddItemRequestSchema, CartSetItemRequestSchema } from "@pricecart/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { cors } from "./middleware/cors";
import { securityHeaders } from "./middleware/security";
import { addCartItem, clearCart, getCart, removeCartItem, setCartItemQuantity } from "./services/cart";
import { productSearch } from "./services/productSearch";
import { storeSearch } from "./services/storeDiscovery";

const app = new Hono<{ Bindings: Env }>();

// Adjust to your Pages domain once known
const ALLOWED_ORIGIN = "http://localhost:5173";

app.use("*", securityHeaders());
app.use("*", cors(ALLOWED_ORIGIN));

app.get("/health", (c) => c.json({ ok: true }));
const SessionIdSchema = z.string().min(1).max(128);

function requireSession(c: any): string {
  const raw = c.req.header("x-pricecart-session");
  const parsed = SessionIdSchema.safeParse(raw);
  if (!parsed.success) throw new Error("MISSING_SESSION");
  return parsed.data;
}



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

app.get("/cart", async (c) => {
  try {
    const session_id = requireSession(c);
    const cart = await getCart(c.env, session_id);
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(
      { error: msg === "MISSING_SESSION" ? "MISSING_SESSION" : "INTERNAL_ERROR" },
      msg === "MISSING_SESSION" ? 401 : 500
    );
  }
});

app.post("/cart/items", async (c) => {
  try {
    const session_id = requireSession(c);
    const body = await c.req.json();
    const parsed = CartAddItemRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "INVALID_INPUT" }, 400);

    const cart = await addCartItem(c.env, { session_id, ...parsed.data });
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") return c.json({ error: "MISSING_SESSION" }, 401);
    if (msg === "PRODUCT_NOT_FOUND") return c.json({ error: "PRODUCT_NOT_FOUND" }, 404);
    if (msg === "CART_TOO_LARGE") return c.json({ error: "CART_TOO_LARGE" }, 413);
    if (msg === "QUANTITY_TOO_LARGE") return c.json({ error: "QUANTITY_TOO_LARGE" }, 400);
    if (msg === "RATE_LIMITED") return c.json({ error: "RATE_LIMITED" }, 429);
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  }
});

app.patch("/cart/items/:upc", async (c) => {
  try {
    const session_id = requireSession(c);
    const upc = c.req.param("upc");
    const body = await c.req.json();
    const parsed = CartSetItemRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "INVALID_INPUT" }, 400);

    const cart = await setCartItemQuantity(c.env, { session_id, upc, quantity: parsed.data.quantity });
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") return c.json({ error: "MISSING_SESSION" }, 401);
    if (msg === "QUANTITY_TOO_LARGE") return c.json({ error: "QUANTITY_TOO_LARGE" }, 400);
    if (msg === "RATE_LIMITED") return c.json({ error: "RATE_LIMITED" }, 429);
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  }
});

app.delete("/cart/items/:upc", async (c) => {
  try {
    const session_id = requireSession(c);
    const upc = c.req.param("upc");
    const cart = await removeCartItem(c.env, { session_id, upc });
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") return c.json({ error: "MISSING_SESSION" }, 401);
    if (msg === "RATE_LIMITED") return c.json({ error: "RATE_LIMITED" }, 429);
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  }
});

app.post("/cart/clear", async (c) => {
  try {
    const session_id = requireSession(c);
    const cart = await clearCart(c.env, session_id);
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") return c.json({ error: "MISSING_SESSION" }, 401);
    if (msg === "RATE_LIMITED") return c.json({ error: "RATE_LIMITED" }, 429);
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  }
});

export default app;
