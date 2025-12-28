import { CartAddItemRequestSchema, CartQuoteRequestSchema, CartSetItemRequestSchema, PriceSubmitRequestSchema } from "@pricecart/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { cors } from "./middleware/cors";
import { securityHeaders } from "./middleware/security";
import { internalRoutes } from "./routes/internal";
import { observabilityMiddleware } from "./middleware/observability";
import { addCartItem, clearCart, getCart, removeCartItem, setCartItemQuantity } from "./services/cart";
import { quoteCart, submitPrice } from "./services/pricing";
import { productSearch } from "./services/productSearch";
import { storeSearch } from "./services/storeDiscovery";

const app = new Hono<{ Bindings: Env }>();

// Adjust to your Pages domain once known
const ALLOWED_ORIGIN = "http://localhost:5173";

app.use("*", observabilityMiddleware);
app.use("*", securityHeaders());
app.use("*", cors(ALLOWED_ORIGIN));

function buildErrorPayload(c: any, code: string, message?: string, details?: unknown) {
  const error: Record<string, unknown> = {
    code,
    message: message ?? code,
    request_id: c.get?.("request_id") ?? undefined
  };

  if (details !== undefined) {
    error.details = details;
  }

  return { error };
}

function respondError(c: any, code: string, status: number, message?: string, details?: unknown) {
  return c.json(buildErrorPayload(c, code, message, details), status);
}

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
    return respondError(
      c,
      "INVALID_INPUT",
      400,
      "Invalid store search parameters",
      parsed.error.flatten()
    );
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

    if (msg.includes("RATE_LIMIT")) {
      return respondError(c, "RATE_LIMITED", 429, "Rate limited while searching stores");
    }
    if (msg.includes("NOT_FOUND")) {
      return respondError(c, "NOT_FOUND", 404, "No stores found for that location");
    }

    console.log(
      JSON.stringify({
        level: "error",
        route: "/stores/search",
        session: sessionId,
        message: "store search failed",
        err: msg
      })
    );

    return respondError(c, "INTERNAL_ERROR", 500, "Store search failed");
  }
});

app.get("/products/search", async (c) => {
  const parsed = ProductSearchQuery.safeParse({
    q: c.req.query("q"),
    page: c.req.query("page"),
    page_size: c.req.query("page_size")
  });

  if (!parsed.success) {
    return respondError(
      c,
      "INVALID_INPUT",
      400,
      "Invalid product search parameters",
      parsed.error.flatten()
    );
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

    if (msg.includes("RATE_LIMIT")) {
      return respondError(c, "RATE_LIMITED", 429, "Product search is being rate limited");
    }

    console.log(
      JSON.stringify({
        level: "error",
        route: "/products/search",
        session: sessionId,
        message: "product search failed",
        err: msg
      })
    );

    return respondError(c, "INTERNAL_ERROR", 500, "Product search failed");
  }
});

app.get("/cart", async (c) => {
  try {
    const session_id = requireSession(c);
    const cart = await getCart(c.env, session_id);
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") {
      return respondError(c, "MISSING_SESSION", 401, "Session header missing");
    }
    return respondError(c, "INTERNAL_ERROR", 500, "Unable to load cart");
  }
});

app.post("/cart/items", async (c) => {
  try {
    const session_id = requireSession(c);
    const body = await c.req.json();
    const parsed = CartAddItemRequestSchema.safeParse(body);
    if (!parsed.success) {
      return respondError(c, "INVALID_INPUT", 400, "Invalid cart item payload");
    }

    const cart = await addCartItem(c.env, { session_id, ...parsed.data });
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") return respondError(c, "MISSING_SESSION", 401, "Session header missing");
    if (msg === "PRODUCT_NOT_FOUND") return respondError(c, "PRODUCT_NOT_FOUND", 404, "Product not found");
    if (msg === "CART_TOO_LARGE") return respondError(c, "CART_TOO_LARGE", 413, "Cart has too many items");
    if (msg === "QUANTITY_TOO_LARGE") return respondError(c, "QUANTITY_TOO_LARGE", 400, "Requested quantity too large");
    if (msg === "RATE_LIMITED") return respondError(c, "RATE_LIMITED", 429, "Rate limited while modifying cart");
    return respondError(c, "INTERNAL_ERROR", 500, "Unable to add item to cart");
  }
});

app.patch("/cart/items/:upc", async (c) => {
  try {
    const session_id = requireSession(c);
    const upc = c.req.param("upc");
    const body = await c.req.json();
    const parsed = CartSetItemRequestSchema.safeParse(body);
    if (!parsed.success) {
      return respondError(c, "INVALID_INPUT", 400, "Invalid quantity payload");
    }

    const cart = await setCartItemQuantity(c.env, { session_id, upc, quantity: parsed.data.quantity });
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") {
      return respondError(c, "MISSING_SESSION", 401, "Session header missing");
    }
    if (msg === "QUANTITY_TOO_LARGE") {
      return respondError(c, "QUANTITY_TOO_LARGE", 400, "Requested quantity too large");
    }
    if (msg === "RATE_LIMITED") {
      return respondError(c, "RATE_LIMITED", 429, "Rate limited while updating cart");
    }
    return respondError(c, "INTERNAL_ERROR", 500, "Unable to update cart item");
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
    if (msg === "MISSING_SESSION") {
      return respondError(c, "MISSING_SESSION", 401, "Session header missing");
    }
    if (msg === "RATE_LIMITED") {
      return respondError(c, "RATE_LIMITED", 429, "Rate limited while deleting cart item");
    }
    return respondError(c, "INTERNAL_ERROR", 500, "Unable to remove cart item");
  }
});

app.post("/cart/clear", async (c) => {
  try {
    const session_id = requireSession(c);
    const cart = await clearCart(c.env, session_id);
    return c.json(cart);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") {
      return respondError(c, "MISSING_SESSION", 401, "Session header missing");
    }
    if (msg === "RATE_LIMITED") {
      return respondError(c, "RATE_LIMITED", 429, "Rate limited while clearing cart");
    }
    return respondError(c, "INTERNAL_ERROR", 500, "Unable to clear cart");
  }
});

app.post("/cart/quote", async (c) => {
  try {
    const session_id = requireSession(c);
    const body = await c.req.json();
    const parsed = CartQuoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return respondError(c, "INVALID_INPUT", 400, "Invalid cart quote payload");
    }

    const res = await quoteCart(c.env, { session_id, store_ids: parsed.data.store_ids });

    console.log(
      JSON.stringify({
        level: "info",
        route: "/cart/quote",
        session: session_id,
        store_count: parsed.data.store_ids.length,
        cheapest_store_id: res.cheapest_store_id,
        warnings: res.warnings
      })
    );

    return c.json(res);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") {
      return respondError(c, "MISSING_SESSION", 401, "Session header missing");
    }
    if (msg === "RATE_LIMITED") {
      return respondError(c, "RATE_LIMITED", 429, "Rate limited while quoting cart");
    }
    return respondError(c, "INTERNAL_ERROR", 500, "Unable to generate cart quote");
  }
});

app.post("/prices/submit", async (c) => {
  try {
    const session_id = requireSession(c);
    const body = await c.req.json();
    const parsed = PriceSubmitRequestSchema.safeParse(body);
    if (!parsed.success) {
      return respondError(c, "INVALID_INPUT", 400, "Invalid price submission payload");
    }

    const out = await submitPrice(c.env, {
      session_id,
      store_id: parsed.data.store_id,
      upc: parsed.data.upc,
      price_cents: parsed.data.price_cents,
      currency: parsed.data.currency,
      observed_at: parsed.data.observed_at,
      evidence_type: parsed.data.evidence_type
    });

    console.log(
      JSON.stringify({
        level: "info",
        route: "/prices/submit",
        session: session_id,
        store_id: parsed.data.store_id,
        upc: parsed.data.upc,
        price_cents: parsed.data.price_cents,
        snapshot_id: out.snapshot_id
      })
    );

    return c.json({ ok: true, snapshot_id: out.snapshot_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "MISSING_SESSION") {
      return respondError(c, "MISSING_SESSION", 401, "Session header missing");
    }
    if (msg === "RATE_LIMITED") {
      return respondError(c, "RATE_LIMITED", 429, "Rate limited while submitting price");
    }
    if (msg === "STORE_NOT_FOUND") {
      return respondError(c, "STORE_NOT_FOUND", 404, "Store not found");
    }
    if (msg === "PRODUCT_NOT_FOUND") {
      return respondError(c, "PRODUCT_NOT_FOUND", 404, "Product not found");
    }
    if (msg === "OUTLIER_PRICE") {
      return respondError(c, "OUTLIER_PRICE", 422, "Price appears to be an outlier");
    }
    if (msg === "OBSERVED_AT_IN_FUTURE") {
      return respondError(c, "OBSERVED_AT_IN_FUTURE", 400, "Observed timestamp is in the future");
    }
    return respondError(c, "INTERNAL_ERROR", 500, "Unable to submit price");
  }
});
app.route("/internal", internalRoutes);

export default app;
