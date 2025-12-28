import { z } from "zod";
import { QuantitySchema } from "./product.js";

export const CartLineSchema = z.object({
  upc: z.string(),
  name: z.string(),
  brand: z.string().nullable().default(null),
  quantity: QuantitySchema,
  image_url: z.string().url().nullable().default(null),
  count: z.number().int().positive()
});
export type CartLine = z.infer<typeof CartLineSchema>;

export const CartSchema = z.object({
  session_id: z.string(),
  updated_at: z.number().int().nonnegative(),
  item_count: z.number().int().nonnegative(),
  total_units: z.number().int().nonnegative(),
  items: z.array(CartLineSchema)
});
export type Cart = z.infer<typeof CartSchema>;

export const CartAddItemRequestSchema = z.object({
  upc: z.string(),
  quantity: z.number().int().positive()
});
export type CartAddItemRequest = z.infer<typeof CartAddItemRequestSchema>;

export const CartSetItemRequestSchema = z.object({
  quantity: z.number().int().positive()
});
export type CartSetItemRequest = z.infer<typeof CartSetItemRequestSchema>;
