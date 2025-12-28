import { z } from "zod";

export const StoreTagSetSchema = z.record(z.string(), z.string()).default({});

export const StoreSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  distance_m: z.number().nonnegative(),
  tags: StoreTagSetSchema
});

export type Store = z.infer<typeof StoreSchema>;

export const StoreSearchResponseSchema = z.object({
  center: z.object({ lat: z.number(), lon: z.number() }),
  radius_m: z.number().int().positive(),
  data_mode: z.enum(["live", "cache", "seed"]),
  stores: z.array(StoreSchema),
  attribution: z.object({
    text: z.string(),
    links: z.array(z.object({ label: z.string(), href: z.string() }))
  })
});

export type StoreSearchResponse = z.infer<typeof StoreSearchResponseSchema>;