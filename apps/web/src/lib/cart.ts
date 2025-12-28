import type { Cart } from "@pricecart/shared";
import { CartSchema } from "@pricecart/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { addCartItem, clearCart, getCart, removeCartItem, setCartItem } from "./api";

const STORAGE_KEY = "pricecart_cart_v1";

function loadLocalCart(): Cart | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = CartSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function saveLocalCart(cart: Cart) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

export type CartState = {
  cart: Cart | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
};

export function useCart() {
  const [state, setState] = useState<CartState>(() => {
    const local = loadLocalCart();
    return { cart: local, status: local ? "ready" : "idle", error: null };
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      const c = await getCart();
      saveLocalCart(c);
      setState({ cart: c, status: "ready", error: null });
    } catch (e) {
      setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  useEffect(() => {
    // Always reconcile with the backend on mount
    void refresh();
  }, [refresh]);

  const actions = useMemo(() => {
    return {
      async add(upc: string, quantity: number = 1) {
        setState((s) => ({ ...s, status: "loading", error: null }));
        try {
          const c = await addCartItem({ upc, quantity });
          saveLocalCart(c);
          setState({ cart: c, status: "ready", error: null });
        } catch (e) {
          setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : String(e) }));
        }
      },
      async setQuantity(upc: string, quantity: number) {
        setState((s) => ({ ...s, status: "loading", error: null }));
        try {
          const c = await setCartItem(upc, { quantity });
          saveLocalCart(c);
          setState({ cart: c, status: "ready", error: null });
        } catch (e) {
          setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : String(e) }));
        }
      },
      async remove(upc: string) {
        setState((s) => ({ ...s, status: "loading", error: null }));
        try {
          const c = await removeCartItem(upc);
          saveLocalCart(c);
          setState({ cart: c, status: "ready", error: null });
        } catch (e) {
          setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : String(e) }));
        }
      },
      async clear() {
        setState((s) => ({ ...s, status: "loading", error: null }));
        try {
          const c = await clearCart();
          saveLocalCart(c);
          setState({ cart: c, status: "ready", error: null });
        } catch (e) {
          setState((s) => ({ ...s, status: "error", error: e instanceof Error ? e.message : String(e) }));
        }
      },
      refresh
    };
  }, [refresh]);

  return { ...state, ...actions };
}