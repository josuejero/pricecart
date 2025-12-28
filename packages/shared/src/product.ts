import { z } from "zod";

export const QuantitySchema = z.object({
  raw: z.string().nullable().default(null),
  value: z.number().nullable().default(null),
  unit: z.string().nullable().default(null)
});

export const ProductSchema = z.object({
  upc: z.string(),
  name: z.string(),
  brand: z.string().nullable().default(null),
  normalized_name: z.string(),
  quantity: QuantitySchema,
  image_url: z.string().url().nullable().default(null),
  source: z.enum(["openfoodfacts", "seed"]),
  source_url: z.string().url().nullable().default(null),
  updated_at: z.number().int()
});

export type Product = z.infer<typeof ProductSchema>;

export const ProductSummarySchema = ProductSchema;
export type ProductSummary = z.infer<typeof ProductSummarySchema>;

export const AttributionSchema = z.object({
  text: z.string(),
  links: z.array(z.object({ label: z.string(), href: z.string().url() }))
});

export const ProductLookupResponseSchema = z.object({
  data_mode: z.enum(["live", "cache", "seed"]),
  cache_state: z.enum(["fresh", "stale"]).optional(),
  product: ProductSchema,
  attribution: AttributionSchema
});
export type ProductLookupResponse = z.infer<typeof ProductLookupResponseSchema>;

export const ProductSearchResponseSchema = z.object({
  data_mode: z.enum(["live", "cache"]),
  cache_state: z.enum(["fresh", "stale"]).optional(),
  query: z.string(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  products: z.array(ProductSummarySchema),
  attribution: AttributionSchema
});
export type ProductSearchResponse = z.infer<typeof ProductSearchResponseSchema>;

// -------------------------
// Normalization helpers
// -------------------------

export type Synonyms = Record<string, string[]>; // canonical -> synonyms

const DEFAULT_SYNONYMS: Synonyms = {
  oz: ["ounce", "ounces"],
  lb: ["lbs", "pound", "pounds"],
  pcs: ["pc", "piece", "pieces"],
  ea: ["each"]
};

function buildSynonymMap(s: Synonyms): Record<string, string> {
  const m: Record<string, string> = {};
  for (const [canon, alts] of Object.entries(s)) {
    m[canon] = canon;
    for (const a of alts) m[a] = canon;
  }
  return m;
}

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeProductName(args: {
  name: string;
  brand?: string | null;
  synonyms?: Synonyms;
}): string {
  const synMap = buildSynonymMap(args.synonyms ?? DEFAULT_SYNONYMS);

  const base = normalizeText(`${args.brand ?? ""} ${args.name}`);
  const tokens = base.split(" ").filter(Boolean);

  const normalized = tokens.map((t) => synMap[t] ?? t);
  return normalized.join(" ");
}

export function parseQuantity(raw: string | null | undefined): { raw: string | null; value: number | null; unit: string | null } {
  if (!raw) return { raw: null, value: null, unit: null };

  // Examples seen in the wild: "500 g", "1L", "16 oz", "0.5 kg"
  const s = raw.trim();

  const m = s.match(/^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*$/);
  if (!m) return { raw: s, value: null, unit: null };

  const value = Number(m[1]);
  if (!Number.isFinite(value)) return { raw: s, value: null, unit: null };

  const unitRaw = m[2].toLowerCase();
  const unit = normalizeUnit(unitRaw);

  return { raw: s, value, unit };
}

function normalizeUnit(u: string): string | null {
  const map: Record<string, string> = {
    g: "g",
    gram: "g",
    grams: "g",
    kg: "kg",
    ml: "ml",
    l: "l",
    liter: "l",
    liters: "l",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
    lb: "lb",
    lbs: "lb",
    ct: "ct",
    count: "ct",
    ea: "ea"
  };
  return map[u] ?? null;
}