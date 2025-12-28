import type { Cart, CartLine } from "@pricecart/shared";
import { takeToken } from "../lib/rateLimit";
import { nowSec } from "../lib/time";

const CART_MAX_ITEMS = 100;
const CART_MAX_QTY = 99;

// Write budgets (per session) - demo-friendly and abuse-resistant
const RL_CART_WRITE = { capacity: 30, refillPerSec: 1 / 2, cost: 1 }; // ~30/min

type EnvLike = { DB: D1Database };

type ProductJoinRow = {
  upc: string;
  quantity: number;
  name: string | null;
  brand: string | null;
  quantity_value: number | null;
  quantity_unit: string | null;
  image_url: string | null;
  updated_at: number;
};

function toCartLine(r: ProductJoinRow): CartLine {
  return {
    upc: r.upc,
    name: r.name ?? "Unknown product",
    brand: r.brand ?? null,
    quantity: { raw: null, value: r.quantity_value ?? null, unit: r.quantity_unit ?? null },
    image_url: r.image_url ?? null,
    count: r.quantity
  };
}

async function ensureCart(env: EnvLike, session_id: string): Promise<void> {
  const t = nowSec();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO carts (session_id, created_at, updated_at) VALUES (?, ?, ?)"
  )
    .bind(session_id, t, t)
    .run();
}

async function touchCart(env: EnvLike, session_id: string): Promise<void> {
  const t = nowSec();
  await env.DB.prepare("UPDATE carts SET updated_at = ? WHERE session_id = ?")
    .bind(t, session_id)
    .run();
}

export async function getCart(env: EnvLike, session_id: string): Promise<Cart> {
  await ensureCart(env, session_id);

  const rows = await env.DB.prepare(
    `SELECT
      ci.upc as upc,
      ci.quantity as quantity,
      p.name as name,
      p.brand as brand,
      p.quantity_value as quantity_value,
      p.quantity_unit as quantity_unit,
      p.image_url as image_url,
      ci.updated_at as updated_at
     FROM cart_items ci
     LEFT JOIN products p ON p.upc = ci.upc
     WHERE ci.session_id = ?
     ORDER BY ci.updated_at DESC`
  )
    .bind(session_id)
    .all<ProductJoinRow>();

  const items = rows.results.map(toCartLine);
  const item_count = items.length;
  const total_units = items.reduce((sum, it) => sum + it.count, 0);

  const meta = await env.DB.prepare("SELECT updated_at FROM carts WHERE session_id = ?")
    .bind(session_id)
    .first<{ updated_at: number }>();

  return {
    session_id,
    updated_at: meta?.updated_at ?? nowSec(),
    item_count,
    total_units,
    items
  };
}

export async function addCartItem(
  env: EnvLike,
  input: { session_id: string; upc: string; quantity: number }
): Promise<Cart> {
  await ensureCart(env, input.session_id);

  const ok = await takeToken(env.DB, `cart_write:${input.session_id}`, RL_CART_WRITE);
  if (!ok) throw new Error("RATE_LIMITED");

  if (input.quantity > CART_MAX_QTY) throw new Error("QUANTITY_TOO_LARGE");

  // Ensure product exists (cart is built from resolved products)
  const prod = await env.DB.prepare("SELECT upc FROM products WHERE upc = ?")
    .bind(input.upc)
    .first<{ upc: string }>();
  if (!prod) throw new Error("PRODUCT_NOT_FOUND");

  const t = nowSec();
  const existing = await env.DB.prepare(
    "SELECT quantity FROM cart_items WHERE session_id = ? AND upc = ?"
  )
    .bind(input.session_id, input.upc)
    .first<{ quantity: number }>();

  const isNew = !existing;

  if (isNew) {
    const cnt = await env.DB.prepare(
      "SELECT COUNT(1) as n FROM cart_items WHERE session_id = ?"
    )
      .bind(input.session_id)
      .first<{ n: number }>();

    if ((cnt?.n ?? 0) >= CART_MAX_ITEMS) throw new Error("CART_TOO_LARGE");
  }

  const nextQty = Math.min(CART_MAX_QTY, (existing?.quantity ?? 0) + input.quantity);

  await env.DB.prepare(
    "INSERT OR REPLACE INTO cart_items (session_id, upc, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(input.session_id, input.upc, nextQty, existing ? t : t, t)
    .run();

  await touchCart(env, input.session_id);
  return getCart(env, input.session_id);
}

export async function setCartItemQuantity(
  env: EnvLike,
  input: { session_id: string; upc: string; quantity: number }
): Promise<Cart> {
  await ensureCart(env, input.session_id);

  const ok = await takeToken(env.DB, `cart_write:${input.session_id}`, RL_CART_WRITE);
  if (!ok) throw new Error("RATE_LIMITED");

  if (input.quantity > CART_MAX_QTY) throw new Error("QUANTITY_TOO_LARGE");

  const t = nowSec();
  await env.DB.prepare(
    "UPDATE cart_items SET quantity = ?, updated_at = ? WHERE session_id = ? AND upc = ?"
  )
    .bind(input.quantity, t, input.session_id, input.upc)
    .run();

  await touchCart(env, input.session_id);
  return getCart(env, input.session_id);
}

export async function removeCartItem(
  env: EnvLike,
  input: { session_id: string; upc: string }
): Promise<Cart> {
  await ensureCart(env, input.session_id);

  const ok = await takeToken(env.DB, `cart_write:${input.session_id}`, RL_CART_WRITE);
  if (!ok) throw new Error("RATE_LIMITED");

  await env.DB.prepare("DELETE FROM cart_items WHERE session_id = ? AND upc = ?")
    .bind(input.session_id, input.upc)
    .run();

  await touchCart(env, input.session_id);
  return getCart(env, input.session_id);
}

export async function clearCart(env: EnvLike, session_id: string): Promise<Cart> {
  await ensureCart(env, session_id);

  const ok = await takeToken(env.DB, `cart_write:${session_id}`, RL_CART_WRITE);
  if (!ok) throw new Error("RATE_LIMITED");

  await env.DB.prepare("DELETE FROM cart_items WHERE session_id = ?")
    .bind(session_id)
    .run();

  await touchCart(env, session_id);
  return getCart(env, session_id);
}