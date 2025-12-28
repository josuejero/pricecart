export type RetryOptions = {
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOnStatuses: number[];
};

export class HttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly url: string) {
    super(message);
  }
}

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number) {
  const delta = ms * 0.2;
  return Math.max(0, ms + (Math.random() * 2 - 1) * delta);
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new TimeoutError(`Request timed out after ${timeoutMs}ms`, timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function toUrlString(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return String(input);
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  opts: {
    timeoutMs: number;
    retry: RetryOptions;
    isIdempotent?: boolean;
    onAttemptError?: (error: unknown, attempt: number) => void;
  }
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const isIdempotent =
    opts.isIdempotent ?? (method === "GET" || method === "HEAD");

  const { attempts, baseDelayMs, maxDelayMs, retryOnStatuses } = opts.retry;
  const totalAttempts = Math.max(1, attempts);

  let lastError: unknown;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const response = await fetchWithTimeout(input, init, opts.timeoutMs);

      if (!isIdempotent || !retryOnStatuses.includes(response.status)) {
        return response;
      }

      if (attempt >= totalAttempts) {
        throw new HttpError(`Upstream returned ${response.status}`, response.status, toUrlString(input));
      }

      const retryAfter = parseRetryAfterSeconds(response.headers.get("Retry-After"));
      const delay = retryAfter != null
        ? Math.min(maxDelayMs, retryAfter * 1000)
        : Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(jitter(delay));
    } catch (error) {
      lastError = error;
      opts.onAttemptError?.(error, attempt);

      if (!isIdempotent) break;
      if (attempt >= totalAttempts) break;

      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(jitter(delay));
    }
  }

  throw lastError ?? new Error("Request failed");
}
