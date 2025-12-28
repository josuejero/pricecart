export type Env = {
  DB: D1Database;

  // Existing outbound headers (used by external providers)
  OUTBOUND_USER_AGENT?: string;
  OUTBOUND_REFERER?: string;

  // Open Food Facts
  OFF_BASE_URL?: string; // optional, defaults to https://world.openfoodfacts.org

  // Phase 5 – Kroger live prices (optional, default OFF)
  KROGER_LIVE_PRICES_ENABLED?: string; // "1" enables live price overlay
  KROGER_CLIENT_ID?: string; // secret
  KROGER_CLIENT_SECRET?: string; // secret
  KROGER_BASE_URL?: string; // optional, default "https://api.kroger.com/v1"
  KROGER_TOKEN_URL?: string; // optional, default "https://api.kroger.com/v1/connect/oauth2/token"

  // Phase 6 – internal + observability
  INTERNAL_TOKEN?: string; // required for /internal/*
  METRICS_ENABLED?: string; // "1" enables metrics writes
  METRICS_SAMPLE_RATE?: string; // "1" = 100%, "0.1" = 10%

  // Phase 6 – resilience defaults
  PROVIDER_TIMEOUT_MS?: string; // e.g. "6000"
};
