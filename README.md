# PriceCart

PriceCart is a Proof-of-Concept for comparing grocery pricing across stores. The workspace includes:

- `apps/web`: React + Vite single-page app that drives the UI/UX
- `apps/api`: Hono-based Cloudflare Worker that talks to D1 and public providers
- `packages/shared`: Type-safe schemas used by both the UI and worker

## How to run locally

1. `npm ci` (installs all workspaces)
2. Start the API (runs against your local D1 and Cloudflare bindings):
   ```bash
   npm run dev:api
   ```
   This helper builds the worker via `vite` before invoking `wrangler dev --local`, ensuring the `/api/internal/*` routes are available in every session. If you prefer to launch manually, run `cd apps/api && npx vite build` before `npx wrangler dev --local`.
3. Start the web UI:
   ```bash
   cd apps/web
   npm run dev
   ```
4. Run the automated suites from the repo root:
   ```bash
   npm test
   ```

## Data sources & licenses

| Provider | Attribution | Notes |
|----------|-------------|-------|
| OpenStreetMap tiles | © OpenStreetMap contributors | Visible on the map and in the attribution footer |
| Nominatim | Geocoding by Nominatim (OpenStreetMap) | Used for location search |
| Overpass API | POI search via Overpass API (OpenStreetMap) | Powers store discovery |
| Open Food Facts | Data © Open Food Facts contributors | Drives product lookup and search |
| Open Prices | Price data © Open Prices contributors | Provides historical price evidence |
| Kroger API | Live prices via Kroger API (where available) | Optional overlay when credentials are configured |

Browser requests surface the `x-request-id` header in every response so you can tie UI errors back to the worker logs.

## Demo script

1. Search for a location such as “Manhattan” to show stores on the map.
2. Paste a UPC or search term to load product metadata; mention the attribution footer highlights Open Food Facts.
3. Add 2–3 items to the cart, go to the Cart tab, and click “Compare prices.”
4. Call attention to the attribution footer again—OpenStreetMap, Overpass, and Open Food Facts are always available.
5. Trigger a failure (rate limit, offline provider, etc.) to show the friendly message and the `Request ID` inside it.
6. Optionally hit the internal endpoints:
   ```bash
   curl -H "x-pricecart-internal: dev-internal-token" http://localhost:8787/api/internal/attributions
   curl -H "x-pricecart-internal: dev-internal-token" http://localhost:8787/api/internal/metrics
   ```
   and point out the metrics/attribution data you can demo.

## Release checklist

- [x] Provider attributions are visible in the UI
- [x] Internal `/api/internal/*` endpoints require `x-pricecart-internal`
- [x] Provider calls respect timeouts, retries, and 429 handling
- [x] Logs and responses include `request_id` for every request
- [x] Metrics endpoint surface useful route/provider stats
- [x] Request IDs appear on UI errors
- [x] Keyboard navigation + status announcements behave across the primary flows
- [x] CI passes (`npm test`)

## Troubleshooting

- No metrics yet? Make sure `METRICS_ENABLED=1`, hit a few API routes, and rerun `GET /api/internal/metrics`.
- `/api/internal/*` still 401? Confirm `INTERNAL_TOKEN` is set and include `x-pricecart-internal`.
- Provider errors in the UI? Look for the `Request ID` in the banner and search the API logs; the UI surfaces the same ID.
- Rate limits? Wait a few seconds, the UI will show a polite “Provider is busy” message and you can retry.

## Known limitations

- Public OSM/Nominatim/Overpass services are capacity constrained; a self-hosted stack is recommended for heavy traffic.
- Open Food Facts coverage varies by region and SKU; some lookups will fall back to manual entry.
- Open Prices is best-effort and only covers the datasets it indexes.
- Kroger live prices are gated behind credentials and regionally limited.
