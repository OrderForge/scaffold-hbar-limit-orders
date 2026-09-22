import haltedBooks from "./fixtures/books-halted.json";
import books from "./fixtures/books.json";
import unfillableQuote from "./fixtures/quote-unfillable-halted.json";
import trades from "./fixtures/trades-3.json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClobClient } from "~~/lib/clob/client";
import { getNetworkConfig } from "~~/lib/clob/config";
import { MarketNotFoundError, PublicReadUnavailableError, RateLimitedError } from "~~/lib/clob/errors";
import { clearClobCache } from "~~/lib/clob/http";
import { marketLabel, marketState } from "~~/lib/clob/types";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** The Express page an unmounted route returns — HTML, not JSON. */
const html404 = () =>
  new Response("<!DOCTYPE html>\n<html><body><pre>Cannot GET /books/999999</pre></body></html>", {
    status: 404,
    headers: { "content-type": "text/html" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearClobCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const client = new ClobClient({ network: "testnet" });

describe("getBooks", () => {
  it("parses the live payload and keeps ids as strings", async () => {
    fetchMock.mockImplementation(async () => json(books));
    const result = await client.getBooks();
    expect(result).toHaveLength(7);
    expect(result.map(book => book.id)).toEqual(["11", "10", "5", "4", "3", "2", "1"]);
    expect(typeof result[0].id).toBe("string");
  });

  it("accepts a numeric id, which is what the docs promise", async () => {
    fetchMock.mockImplementation(async () => json({ orderbooks: [{ ...books.orderbooks[0], id: 11 }] }));
    const [book] = await client.getBooks();
    expect(book.id).toBe("11");
  });

  it("keeps unknown fields instead of failing on an additive API change", async () => {
    fetchMock.mockImplementation(async () => json({ orderbooks: [{ ...books.orderbooks[0], somethingNew: "x" }] }));
    const [book] = await client.getBooks();
    expect(book).toHaveProperty("somethingNew", "x");
  });

  it("caches repeat reads and de-duplicates concurrent ones", async () => {
    fetchMock.mockImplementation(async () => json(books));
    await Promise.all([client.getBooks(), client.getBooks()]);
    await client.getBooks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("error handling", () => {
  it("turns a 401 on a public endpoint into PublicReadUnavailableError", async () => {
    // The keyless rollout is per-network, so this is expected behaviour, not a crash.
    fetchMock.mockImplementation(async () => json({ error: "Missing Authorization header" }, 401));
    await expect(client.getDepth("3")).rejects.toBeInstanceOf(PublicReadUnavailableError);
    await expect(client.getDepth("3")).rejects.toThrow(/requires a JWT/i);
  });

  it("does not retry a 401", async () => {
    fetchMock.mockImplementation(async () => json({ error: "Missing Authorization header" }, 401));
    await expect(client.getDepth("3")).rejects.toBeInstanceOf(PublicReadUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps a JSON 404 to MarketNotFoundError", async () => {
    fetchMock.mockImplementation(async () => json({ error: "Orderbook 999999 not found or not open" }, 404));
    await expect(client.getDepth("999999")).rejects.toBeInstanceOf(MarketNotFoundError);
  });

  it("survives an HTML error page without trying to parse it as JSON", async () => {
    fetchMock.mockImplementation(async () => html404());
    const error = await client.getDepth("999999").catch(e => e);
    expect(error).toBeInstanceOf(MarketNotFoundError);
    expect(error.body).toContain("Cannot GET");
  });

  it("explains an HTML page instead of pasting markup at the user", async () => {
    // A dev server with a stale build, a proxy, or a captive portal all do this.
    fetchMock.mockImplementation(
      async () =>
        new Response("<!DOCTYPE html><html><head><style>body{display:none}</style></head></html>", {
          status: 500,
          headers: { "content-type": "text/html" },
        }),
    );
    const error = await client.getBooks().catch(e => e);
    expect(error.message).toContain("returned a web page instead of data");
    expect(error.message).not.toContain("<!DOCTYPE");
  });

  it("retries a 429 with backoff and then succeeds", async () => {
    fetchMock
      .mockImplementationOnce(async () => json({ error: "Too many requests" }, 429, { "retry-after": "0" }))
      .mockImplementationOnce(async () => json(books));
    const result = await client.getBooks();
    expect(result).toHaveLength(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on a 429 that never clears, reporting it as rate limiting", async () => {
    fetchMock.mockImplementation(async () => json({ error: "Too many requests" }, 429, { "retry-after": "0" }));
    await expect(client.getBooks()).rejects.toBeInstanceOf(RateLimitedError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a 500", async () => {
    fetchMock
      .mockImplementationOnce(async () => json({ error: "boom" }, 500))
      .mockImplementationOnce(async () => json(books));
    await expect(client.getBooks()).resolves.toHaveLength(7);
  });

  it("reports a response whose shape is wrong rather than returning junk", async () => {
    fetchMock.mockImplementation(async () => json({ orderbooks: [{ id: "3" }] }));
    await expect(client.getBooks()).rejects.toThrow(/Unexpected response shape/);
  });
});

describe("market state", () => {
  it("treats a halted market as HALTED even though the API still says OPEN", async () => {
    const book = haltedBooks.orderbooks.find(b => b.id === "3")!;
    expect(book.status).toBe("OPEN");
    expect(book.isMarketHalted).toBe(1);
    expect(marketState(book)).toBe("HALTED");
  });

  it("labels the three different books all called HBAR by id, not symbol", async () => {
    fetchMock.mockImplementation(async () => json(books));
    const all = await client.getBooks();
    const hbarBooks = all.filter(book => book.baseTokenSymbol === "HBAR");
    expect(hbarBooks.length).toBeGreaterThan(1);
    expect(new Set(hbarBooks.map(marketLabel)).size).toBe(1);
    expect(new Set(hbarBooks.map(book => book.id)).size).toBe(hbarBooks.length);
  });

  it("finds a market by id and returns null for an unknown one", async () => {
    fetchMock.mockImplementation(async () => json(books));
    expect((await client.getBook("3"))?.baseTokenSymbol).toBe("SAUCE");
    expect(await client.getBook("999999")).toBeNull();
  });
});

describe("trades and quotes", () => {
  it("parses the trade tape", async () => {
    fetchMock.mockImplementation(async () => json(trades));
    const result = await client.getTrades("3", { limit: 20 });
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades[0].transactionHash).toMatch(/^0x/);
    // amountBase is human-readable, already decimals-adjusted — not smallest units.
    expect(Number(result.trades[0].amountBase)).toBeLessThan(1_000_000);
    expect(["buy", "sell"]).toContain(result.trades[0].direction);
  });

  it("surfaces fillable:false so callers never sign a quote with no price protection", async () => {
    // On an empty book the API answers suggestedOutputAmount "1" — signing that would
    // accept any price at all.
    fetchMock.mockImplementation(async () => json(unfillableQuote.body));
    const quote = await client.quoteExactInput("3", { inputToken: "0x1", inputAmount: "100000000" });
    expect(quote.fillable).toBe(false);
    expect(quote.suggestedOutputAmount).toBe("1");
  });
});

describe("network configuration", () => {
  it("points at the right hosts per network", () => {
    expect(getNetworkConfig("testnet").apiUrl).toContain("testnet-orderbook-api");
    expect(getNetworkConfig("testnet").chainId).toBe(296);
    expect(getNetworkConfig("mainnet").apiUrl).toBe("https://orderbook-api.saucerswap.finance");
    expect(getNetworkConfig("mainnet").chainId).toBe(295);
  });

  it("requests the mainnet host when the client is switched to mainnet", async () => {
    fetchMock.mockImplementation(async () => json(books));
    await new ClobClient({ network: "mainnet" }).getBooks();
    expect(fetchMock.mock.calls[0][0]).toBe("https://orderbook-api.saucerswap.finance/books");
  });
});

describe("browser vs server base URL", () => {
  it("calls the API directly in Node", async () => {
    fetchMock.mockImplementation(async () => json(books));
    await new ClobClient({ network: "testnet" }).getBooks();
    expect(fetchMock.mock.calls[0][0]).toBe("https://testnet-orderbook-api.saucerswap.finance/books");
  });

  it("calls the same-origin proxy in a browser", async () => {
    // The Orderbook API sends no CORS headers, so a browser cannot read it cross-origin
    // even though the endpoints are public. Requests go through the app's own route.
    vi.stubGlobal("window", {} as Window & typeof globalThis);
    fetchMock.mockImplementation(async () => json(books));
    await new ClobClient({ network: "mainnet" }).getBooks();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/clob/mainnet/books");
  });
});
