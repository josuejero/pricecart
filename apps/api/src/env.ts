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
};
