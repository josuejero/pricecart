import { isOpen, recordFailure, recordSuccess } from "../lib/circuitBreaker";

export type GeocodeResult = { lat: number; lon: number; display_name?: string };

export async function geocode(
  env: { DB: D1Database; OUTBOUND_USER_AGENT?: string; OUTBOUND_REFERER?: string },
  location: string
): Promise<GeocodeResult> {
  const provider = "nominatim";
  if (await isOpen(env.DB, provider)) throw new Error("PROVIDER_OPEN");

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", location);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": env.OUTBOUND_USER_AGENT || "PriceCart/0.1 (contact: you@example.com)",
    Referer: env.OUTBOUND_REFERER || "https://example.com"
  };

  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      await recordFailure(env.DB, provider);
      throw new Error(`Nominatim HTTP ${res.status}`);
    }

    const json = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
    if (!json[0]) {
      await recordSuccess(env.DB, provider);
      throw new Error("NOT_FOUND");
    }

    await recordSuccess(env.DB, provider);
    return { lat: Number(json[0].lat), lon: Number(json[0].lon), display_name: json[0].display_name };
  } catch (e) {
    await recordFailure(env.DB, provider);
    throw e;
  }
}