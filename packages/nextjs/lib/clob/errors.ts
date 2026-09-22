/**
 * Typed errors for the Orderbook API.
 *
 * The API reports failures three different ways, all of which are handled here:
 *   - `{ "error": "message" }`   — documented, used by most routes
 *   - `{ "message": "..." }`     — used by the auth routes
 *   - an Express HTML page       — returned by routes that are not mounted (404)
 */

export class ClobError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body?: unknown;

  constructor(message: string, status: number, url: string, body?: unknown) {
    super(message);
    this.name = "ClobError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/**
 * A public endpoint asked for a JWT.
 *
 * Keyless market data shipped in July 2026 and is rolling out network by network, so a
 * network that has not had the rollout yet answers public reads with 401. The UI should
 * explain that rather than showing a generic failure.
 */
export class PublicReadUnavailableError extends ClobError {
  constructor(url: string, body?: unknown) {
    super("This network still requires a JWT for market data.", 401, url, body);
    this.name = "PublicReadUnavailableError";
  }
}

/** The market does not exist, or is closed — `/depth` answers 404 for both. */
export class MarketNotFoundError extends ClobError {
  constructor(url: string, body?: unknown) {
    super("Market not found", 404, url, body);
    this.name = "MarketNotFoundError";
  }
}

/** Rate limited. `retryAfterMs` is populated when the API sends Retry-After. */
export class RateLimitedError extends ClobError {
  readonly retryAfterMs?: number;

  constructor(url: string, retryAfterMs?: number, body?: unknown) {
    super("Rate limited by the Orderbook API", 429, url, body);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** The response could not be parsed, or did not match the expected shape. */
export class ClobParseError extends ClobError {
  constructor(message: string, url: string, body?: unknown) {
    super(message, 0, url, body);
    this.name = "ClobParseError";
  }
}

/** Pull a human-readable message out of any of the API's error shapes. */
export const extractErrorMessage = (body: unknown, fallback: string): string => {
  if (typeof body === "string") {
    // An Express HTML 404 page: "<pre>Cannot GET /books/999999</pre>"
    const match = body.match(/<pre>(.*?)<\/pre>/s);
    if (match) return match[1].trim();

    // Any other HTML means something upstream answered with a page instead of an API
    // response — a proxy, a captive portal, or a dev server with a stale build. Dumping
    // the markup at the user tells them nothing; say what actually happened.
    if (/^\s*<(!doctype|html)/i.test(body)) {
      return "The server returned a web page instead of data. If you are running the app locally, restart it; otherwise something between you and the API is intercepting requests.";
    }

    return body.slice(0, 200) || fallback;
  }
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.message === "string") return record.message;
  }
  return fallback;
};
