import { recordProviderMetric } from "./metrics";

export async function noteProviderOutcome(args: {
  db: D1Database;
  enabled: boolean;
  provider: string;
  outcome: string;
}) {
  try {
    await recordProviderMetric({
      db: args.db,
      enabled: args.enabled,
      provider: args.provider,
      outcome: args.outcome
    });
  } catch {
    // Metrics failures should never block the request.
  }
}
