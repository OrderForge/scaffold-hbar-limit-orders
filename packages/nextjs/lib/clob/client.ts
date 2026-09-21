/**
 * Typed client for the public SaucerSwap V3 Orderbook API.
 *
 * Everything here is keyless: books, depth, trades, quotes and the signing domain. The
 * authenticated surface (fees, orders, onboarding, WebSockets) arrives in later increments
 * and reuses `request()` from `http.ts`.
 */
import { ClobNetwork, ClobNetworkConfig, getApiBase, getNetworkConfig } from "./config";
import { ClobParseError, MarketNotFoundError } from "./errors";
import { request, withQuery } from "./http";
import {
  DepthSnapshot,
  ExactInputQuote,
  ExactOutputQuote,
  Orderbook,
  SignatureDomain,
  TradesResponse,
  booksResponseSchema,
  depthSnapshotSchema,
  exactInputQuoteSchema,
  exactOutputQuoteSchema,
  signatureDomainSchema,
  tradesResponseSchema,
} from "./types";
import { z } from "zod";

/** Books change slowly; depth is polled hard. Both are served from a short server cache. */
const CACHE_MS = {
  books: 5_000,
  depth: 1_000,
  trades: 2_000,
  quote: 1_000,
  domain: 300_000,
} as const;

const parse = <S extends z.ZodTypeAny>(schema: S, payload: unknown, url: string): z.infer<S> => {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new ClobParseError(
      `Unexpected response shape: ${result.error.issues[0]?.message ?? "invalid"}`,
      url,
      payload,
    );
  }
  return result.data;
};

export type ClobClientOptions = {
  network?: ClobNetwork;
  config?: ClobNetworkConfig;
};

export class ClobClient {
  readonly config: ClobNetworkConfig;

  constructor(options: ClobClientOptions = {}) {
    this.config = options.config ?? getNetworkConfig(options.network);
  }

  get network(): ClobNetwork {
    return this.config.network;
  }

  /**
   * In a browser this points at the app's own proxy route, because the Orderbook API
   * serves no CORS headers; in Node it points straight at the API.
   */
  private url(path: string) {
    return `${getApiBase(this.config)}${path}`;
  }

  /** All markets. Never key anything on the symbols in here — use `id`. */
  async getBooks(signal?: AbortSignal): Promise<Orderbook[]> {
    const url = this.url("/books");
    const payload = await request<unknown>(url, { cacheMs: CACHE_MS.books, signal });
    return parse(booksResponseSchema, payload, url).orderbooks;
  }

  /** One market by id, or null when it does not exist. */
  async getBook(orderbookId: string, signal?: AbortSignal): Promise<Orderbook | null> {
    const books = await this.getBooks(signal);
    return books.find(book => book.id === String(orderbookId)) ?? null;
  }

  /**
   * Depth snapshot.
   *
   * A closed market and an unknown id both answer 404, so callers must decide which it is
   * from `/books` — that is what `MarketNotFoundError` means here, nothing more. A halted
   * market with no resting orders answers 200 with empty arrays and null best bid/ask.
   */
  async getDepth(orderbookId: string, signal?: AbortSignal): Promise<DepthSnapshot> {
    const url = this.url(`/depth/${encodeURIComponent(orderbookId)}`);
    const payload = await request<unknown>(url, { cacheMs: CACHE_MS.depth, signal });
    return parse(depthSnapshotSchema, payload, url);
  }

  /** Recent fills, most recent first. `amountBase` is human-readable, not smallest units. */
  async getTrades(
    orderbookId: string,
    options: { limit?: number; page?: number; sort?: "asc" | "desc"; signal?: AbortSignal } = {},
  ): Promise<TradesResponse> {
    const { limit = 25, page, sort, signal } = options;
    const url = withQuery(this.url(`/trades/${encodeURIComponent(orderbookId)}`), { limit, page, sort });
    const payload = await request<unknown>(url, { cacheMs: CACHE_MS.trades, signal });
    return parse(tradesResponseSchema, payload, url);
  }

  /**
   * Simulate spending `inputAmount` (raw smallest units).
   *
   * Refuse to build an order from a quote whose `fillable` is false: on an empty book the
   * API returns `suggestedOutputAmount: "1"`, which would sign away all price protection.
   */
  async quoteExactInput(
    orderbookId: string,
    params: { inputToken: string; inputAmount: string; signal?: AbortSignal },
  ): Promise<ExactInputQuote> {
    const url = withQuery(this.url(`/books/${encodeURIComponent(orderbookId)}/quote/exact-input`), {
      inputToken: params.inputToken,
      inputAmount: params.inputAmount,
    });
    const payload = await request<unknown>(url, { cacheMs: CACHE_MS.quote, signal: params.signal });
    return parse(exactInputQuoteSchema, payload, url);
  }

  /** Simulate receiving `outputAmount` (raw smallest units). Same `fillable` rule applies. */
  async quoteExactOutput(
    orderbookId: string,
    params: { outputToken: string; outputAmount: string; signal?: AbortSignal },
  ): Promise<ExactOutputQuote> {
    const url = withQuery(this.url(`/books/${encodeURIComponent(orderbookId)}/quote/exact-output`), {
      outputToken: params.outputToken,
      outputAmount: params.outputAmount,
    });
    const payload = await request<unknown>(url, { cacheMs: CACHE_MS.quote, signal: params.signal });
    return parse(exactOutputQuoteSchema, payload, url);
  }

  /** EIP-712 domain for this environment. Cached — it only changes on redeployment. */
  async getSignatureDomain(signal?: AbortSignal): Promise<SignatureDomain> {
    const url = this.url("/signature/domain");
    const payload = await request<unknown>(url, { cacheMs: CACHE_MS.domain, signal });
    return parse(signatureDomainSchema, payload, url);
  }
}

/** Convenience client for the app's default network. */
export const clobClient = (network?: ClobNetwork) => new ClobClient({ network });

export { MarketNotFoundError };
