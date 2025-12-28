export type CartItem = { upc: string; count: number };
export type CartModel = { items: CartItem[] };

export const CART_MAX_QTY = 99;

export function normalizeCart(model: CartModel): CartModel {
  const m = new Map<string, number>();
  for (const it of model.items) {
    const next = (m.get(it.upc) ?? 0) + it.count;
    m.set(it.upc, Math.min(CART_MAX_QTY, Math.max(1, next)));
  }
  return { items: Array.from(m.entries()).map(([upc, count]) => ({ upc, count })) };
}