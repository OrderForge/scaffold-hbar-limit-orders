/**
 * Zod schemas for the SaucerSwap V3 Orderbook API.
 *
 * These are written against real responses captured from the live API, not against the
 * published docs — the two disagree in several places (see docs/DISCREPANCIES.md). Rules:
 *
 * 1. Every monetary or size value stays a **string**. Parsing one into a JS number loses
 *    precision on 8-decimal tokens. Convert to bigint in `format.ts` instead.
 * 2. `id` is documented as a number and served as a string. Accept both, keep a string.
 * 3. Unknown fields are allowed through: the API adds fields without warning, and a strict
 *    schema would turn an additive change into an outage.
 */
import { z } from "zod";

/** Documented as number, served as string. Normalise to string. */
const idLike = z.union([z.string(), z.number()]).transform(String);

/** A numeric the API serves as a string; kept as a string on purpose. */
const numericString = z.string();

/** Nullable numeric string — `bestBidQuote` is null on an empty book. */
const nullableNumericString = z.string().nullable();

export const orderbookSchema = z
  .object({
    id: idLike,
    baseTokenId: z.string(),
    quoteTokenId: z.string(),
    baseTokenEvmAddress: z.string(),
    quoteTokenEvmAddress: z.string(),
    status: z.string(),
    isAMMEnabled: z.number().int(),
    isMarketHalted: z.number().int(),
    // Symbols are display-only: testnet serves three different books all labelled "HBAR".
    baseTokenSymbol: z.string().nullable(),
    quoteTokenSymbol: z.string().nullable(),
    baseTokenDecimals: z.number().int(),
    quoteTokenDecimals: z.number().int(),
    quotePrice: nullableNumericString.optional(),
    quotePrice24hPct: nullableNumericString.optional(),
    quotePrice24hHigh: nullableNumericString.optional(),
    quotePrice24hLow: nullableNumericString.optional(),
    baseVol24h: nullableNumericString.optional(),
    quoteVol24h: nullableNumericString.optional(),
    tickStep: numericString,
    sizeStep: numericString,
    lotSize: numericString,
    minNotional: numericString,
    takerFeePips: z.number().int(),
    makerFeePips: z.number().int(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type Orderbook = z.infer<typeof orderbookSchema>;

export const booksResponseSchema = z
  .object({
    orderbooks: z.array(orderbookSchema),
    total: z.number().optional(),
    page: z.number().optional(),
    limit: z.number().optional(),
  })
  .passthrough();

export type BooksResponse = z.infer<typeof booksResponseSchema>;

/** One depth level: [price, size], both strings. */
export const depthLevelSchema = z.tuple([z.string(), z.string()]);
export type DepthLevel = z.infer<typeof depthLevelSchema>;

export const depthSnapshotSchema = z
  .object({
    orderbookId: idLike,
    timestamp: z.number(),
    baseTokenId: z.string().optional(),
    quoteTokenId: z.string().optional(),
    // null on an empty book; negative spreadPercent means the book is crossed.
    bestBidQuote: nullableNumericString.optional(),
    bestAskQuote: nullableNumericString.optional(),
    spreadPercent: nullableNumericString.optional(),
    asks: z.array(depthLevelSchema),
    bids: z.array(depthLevelSchema),
    lastUpdateId: z.number(),
  })
  .passthrough();

export type DepthSnapshot = z.infer<typeof depthSnapshotSchema>;

/** A /ws/depth diff. Binance-style: a size of "0" removes that price level. */
export const depthDiffSchema = z
  .object({
    orderbookId: idLike,
    firstUpdateId: z.number(),
    finalUpdateId: z.number(),
    timestamp: z.number(),
    asks: z.array(depthLevelSchema),
    bids: z.array(depthLevelSchema),
  })
  .passthrough();

export type DepthDiff = z.infer<typeof depthDiffSchema>;

export const tradeSchema = z
  .object({
    timestamp: z.number(),
    price: numericString,
    // Already decimals-adjusted by the API — this is NOT in smallest units.
    amountBase: numericString,
    direction: z.string(),
    transactionHash: z.string(),
  })
  .passthrough();

export type Trade = z.infer<typeof tradeSchema>;

export const tradesResponseSchema = z
  .object({
    orderbookId: idLike,
    timestamp: z.number().optional(),
    trades: z.array(tradeSchema),
    total: z.number().optional(),
    page: z.number().optional(),
    limit: z.number().optional(),
  })
  .passthrough();

export type TradesResponse = z.infer<typeof tradesResponseSchema>;

export const exactInputQuoteSchema = z
  .object({
    outputToken: z.string(),
    snappedInputAmount: numericString,
    consumedInputAmount: numericString,
    expectedOutputAmount: numericString,
    suggestedOutputAmount: numericString,
    slippageBps: z.number(),
    fillable: z.boolean(),
  })
  .passthrough();

export type ExactInputQuote = z.infer<typeof exactInputQuoteSchema>;

export const exactOutputQuoteSchema = z
  .object({
    inputToken: z.string(),
    requestedOutputAmount: numericString,
    snappedOutputAmount: numericString,
    expectedInputAmount: numericString,
    suggestedInputAmount: numericString,
    slippageBps: z.number(),
    fillable: z.boolean(),
  })
  .passthrough();

export type ExactOutputQuote = z.infer<typeof exactOutputQuoteSchema>;

export const signatureDomainSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    chainId: z.number(),
    verifyingContract: z.string(),
  })
  .passthrough();

export type SignatureDomain = z.infer<typeof signatureDomainSchema>;

/**
 * Market status as the UI needs it. The API splits this across `status` and
 * `isMarketHalted`, and a halted market still reports status "OPEN".
 */
export type MarketState = "OPEN" | "HALTED" | "CLOSED";

export const marketState = (book: Pick<Orderbook, "status" | "isMarketHalted">): MarketState => {
  if (book.status !== "OPEN") return "CLOSED";
  return book.isMarketHalted === 1 ? "HALTED" : "OPEN";
};

export const isTradeable = (book: Pick<Orderbook, "status" | "isMarketHalted">): boolean =>
  marketState(book) === "OPEN";

/** Display label for a market. Never use this as an identity — key on `id`. */
export const marketLabel = (book: Pick<Orderbook, "baseTokenSymbol" | "quoteTokenSymbol">): string =>
  `${book.baseTokenSymbol ?? "?"}/${book.quoteTokenSymbol ?? "?"}`;
