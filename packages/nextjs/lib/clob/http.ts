/**
 * The one HTTP path to the Orderbook API: retry with backoff, a small response cache, and
 * the API's three error shapes mapped to typed errors.
 *
 * Framework-free on purpose — the browser UI and the server-side scripts share this file.
 */
import {
  ClobError,
  ClobParseError,
  MarketNotFoundError,
  PublicReadUnavailableError,
  RateLimitedError,
  extractErrorMessage,
} from "./errors";

export type RequestOptions = {
  /** Cache the successful response for this many ms. 0 disables caching. */
  cacheMs?: number;
  /** Attempts in total, including the first. */
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Bearer token for authenticated routes. Never logged, never stored. */
  token?: string;
  method?: "GET" | "POST";
  body?: unknown;
};

type CacheEntry = { expiresAt: number; value: unknown };

const cache = new Map<string, CacheEntry>();
/** De-duplicates concurrent identical GETs so two components don't both hit the API. */
const inFlight = new Map<string, Promise<unknown>>();

export const clearClobCache = () => {
  cache.clear();
  inFlight.clear();
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const backoffMs = (attempt: number, retryAfterMs?: number) => {
  if (retryAfterMs !== undefined) return retryAfterMs;
  // 250ms, 500ms, 1s… with jitter so a page full of widgets doesn't retry in lockstep.
  return Math.round(250 * 2 ** attempt * (0.5 + Math.random()));
};

const parseRetryAfter = (header: string | null): number | undefined => {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
};

/** Parse a body that may be JSON or an Express HTML error page. */
const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const isRetriableStatus = (status: number) => status === 429 || status >= 500;

const toTypedError = (response: Response, url: string, body: unknown): ClobError => {
  const message = extractErrorMessage(body, response.statusText || `HTTP ${response.status}`);
  switch (response.status) {
    case 401:
      return new PublicReadUnavailableError(url, body);
    case 404:
      return new MarketNotFoundError(url, body);
    case 429:
      return new RateLimitedError(url, parseRetryAfter(response.headers.get("retry-after")), body);
    default:
      return new ClobError(message, response.status, url, body);
  }
};

/**
 * A 401 on a route that needs no token means the keyless rollout has not reached this
 * network. A 401 on a route we sent a token to just means the token expired.
 */
const classify401 = (error: ClobError, sentToken: boolean): ClobError =>
  sentToken && error instanceof PublicReadUnavailableError
    ? new ClobError(extractErrorMessage(error.body, "Unauthorized"), 401, error.url, error.body)
    : error;

export const request = async <T>(url: string, options: RequestOptions = {}): Promise<T> => {
  const { cacheMs = 0, maxAttempts = 3, signal, token, method = "GET", body } = options;
  const cacheable = method === "GET" && cacheMs > 0 && !token;
  const now = Date.now();

  if (cacheable) {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > now) return hit.value as T;

    const pending = inFlight.get(url);
    if (pending) return pending as Promise<T>;
  }

  const run = async (): Promise<T> => {
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          signal,
          headers: {
            accept: "application/json",
            ...(body ? { "content-type": "application/json" } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (networkError) {
        // Network failures are worth one more try; an aborted request is not.
        if (signal?.aborted) throw networkError;
        lastError = networkError;
        if (attempt < maxAttempts - 1) await sleep(backoffMs(attempt));
        continue;
      }

      const payload = await readBody(response);

      if (response.ok) {
        if (cacheable) cache.set(url, { expiresAt: Date.now() + cacheMs, value: payload });
        return payload as T;
      }

      const error = classify401(toTypedError(response, url, payload), Boolean(token));
      if (!isRetriableStatus(response.status) || attempt === maxAttempts - 1) throw error;

      lastError = error;
      await sleep(backoffMs(attempt, error instanceof RateLimitedError ? error.retryAfterMs : undefined));
    }

    throw lastError instanceof Error ? lastError : new ClobParseError("Request failed", url, lastError);
  };

  if (!cacheable) return run();

  const promise = run().finally(() => inFlight.delete(url));
  inFlight.set(url, promise);
  return promise;
};

/** Build a URL with query params, skipping undefined values. */
export const withQuery = (base: string, params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
};
