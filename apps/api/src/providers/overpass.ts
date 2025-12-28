import { isOpen, recordFailure, recordSuccess } from "../lib/circuitBreaker";

export type OverpassStore = {
  external_id: string; // osm:node/123
  name: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

export async function queryNearbyStores(
  env: { DB: D1Database; OUTBOUND_USER_AGENT?: string; OUTBOUND_REFERER?: string },
  center: { lat: number; lon: number },
  radiusM: number
): Promise<OverpassStore[]> {
  const provider = "overpass";
  if (await isOpen(env.DB, provider)) throw new Error("PROVIDER_OPEN");

  const query = `
[out:json][timeout:25];
(
  node[shop=supermarket](around:${radiusM},${center.lat},${center.lon});
  node[shop=convenience](around:${radiusM},${center.lat},${center.lon});
  node[shop=greengrocer](around:${radiusM},${center.lat},${center.lon});
);
out body;
`;

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": env.OUTBOUND_USER_AGENT || "PriceCart/0.1 (contact: you@example.com)",
    Referer: env.OUTBOUND_REFERER || "https://example.com"
  };

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers,
      body: new URLSearchParams({ data: query }).toString()
    });

    if (!res.ok) {
      await recordFailure(env.DB, provider);
      throw new Error(`Overpass HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      elements: Array<{ type: string; id: number; lat: number; lon: number; tags?: Record<string, string> }>;
    };

    const stores: OverpassStore[] = (json.elements || [])
      .filter((e) => e.type === "node")
      .map((e) => {
        const tags = e.tags || {};
        const name = tags.name || tags.brand || "Unnamed store";
        return {
          external_id: `osm:${e.type}/${e.id}`,
          name,
          lat: e.lat,
          lon: e.lon,
          tags
        };
      });

    await recordSuccess(env.DB, provider);
    return stores;
  } catch (e) {
    await recordFailure(env.DB, provider);
    throw e;
  }
}