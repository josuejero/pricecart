import { z } from "zod";

export const PriceSourceSchema = z.enum(["open_prices", "community", "kroger"]);
export type PriceSource = z.infer<typeof PriceSourceSchema>;

export const EvidenceTypeSchema = z.enum(["dataset", "manual", "receipt_text"]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const FreshnessBucketSchema = z.enum(["fresh", "recent", "stale", "old"]);
export type FreshnessBucket = z.infer<typeof FreshnessBucketSchema>;

export const MoneySchema = z.object({
  currency: z.string().min(3).max(8).default("USD"),
  cents: z.number().int().nonnegative()
});

export const QuoteLineSchema = z.object({
  upc: z.string(),
  quantity: z.number().int().positive(),

  unit_price_cents: z.number().int().nonnegative().nullable().default(null),
  extended_price_cents: z.number().int().nonnegative().nullable().default(null),

  missing: z.boolean(),
  observed_at: z.number().int().nonnegative().nullable().default(null),
  source: PriceSourceSchema.nullable().default(null),
  evidence_type: EvidenceTypeSchema.nullable().default(null),
  confidence: z.number().min(0).max(1).nullable().default(null),
  freshness: FreshnessBucketSchema.nullable().default(null)
});
export type QuoteLine = z.infer<typeof QuoteLineSchema>;

export const QuoteStoreSchema = z.object({
  store_id: z.string(),
  store_name: z.string(),
  currency: z.string().default("USD"),

  item_count: z.number().int().nonnegative(),
  matched_count: z.number().int().nonnegative(),
  missing_count: z.number().int().nonnegative(),
  completeness: z.number().min(0).max(1),

  total_cents: z.number().int().nonnegative(),
  adjusted_total_cents: z.number().int().nonnegative(),

  lines: z.array(QuoteLineSchema)
});
export type QuoteStore = z.infer<typeof QuoteStoreSchema>;

export const CartQuoteRequestSchema = z.object({
  store_ids: z.array(z.string()).min(1).max(20)
});
export type CartQuoteRequest = z.infer<typeof CartQuoteRequestSchema>;

export const CartQuoteResponseSchema = z.object({
  session_id: z.string(),
  generated_at: z.number().int().nonnegative(),
  currency: z.string().default("USD"),
  cheapest_store_id: z.string().nullable().default(null),
  stores: z.array(QuoteStoreSchema),
  warnings: z.array(z.string()).default([])
});
export type CartQuoteResponse = z.infer<typeof CartQuoteResponseSchema>;

export const PriceSubmitRequestSchema = z.object({
  store_id: z.string().min(1).max(128),
  upc: z.string().min(1).max(64),
  price_cents: z.number().int().min(1).max(1_000_000),
  currency: z.string().min(3).max(8).optional().default("USD"),
  observed_at: z.number().int().nonnegative().optional(),
  evidence_type: EvidenceTypeSchema.optional().default("manual")
});
export type PriceSubmitRequest = z.infer<typeof PriceSubmitRequestSchema>;

export const PriceSubmitResponseSchema = z.object({
  ok: z.literal(true),
  snapshot_id: z.string()
});
export type PriceSubmitResponse = z.infer<typeof PriceSubmitResponseSchema>;