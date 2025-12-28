export type Env = {
  DB: D1Database;
  OUTBOUND_USER_AGENT?: string;
  OUTBOUND_REFERER?: string;
  OFF_BASE_URL?: string; // optional, defaults to https://world.openfoodfacts.org
};