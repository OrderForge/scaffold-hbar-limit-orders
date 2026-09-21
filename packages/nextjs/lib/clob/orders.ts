/**
 * Building, signing and cancelling orders.
 *
 * The flow is: `POST /orders/build` assigns a nonce and returns the exact struct to sign →
 * the wallet signs it as EIP-712 → `POST /orders/save` submits it. Three things here are
 * easy to get wrong and expensive when they are:
 *
 *   1. **Sign what the server returned**, not the request. The server assigns the nonce
 *      and may clamp the deadline.
 *   2. **The signature carries a one-byte mode prefix.** `0x00` is EIP-712; the reactor
 *      uses the prefix to pick a verifier, and stripping it makes the order unfillable.
 *   3. **A buy and a sell are mirror images**, not a flag. The side decides which token is
 *      spent and which is received, and getting it backwards sells what you meant to buy.
 */
import { ClobError } from "./errors";
import { notionalUnits, parseDecimal } from "./format";
import { Orderbook } from "./types";
import { z } from "zod";

/**
 * The EIP-712 order type, read from the reactor's verified source. SaucerSwap does not
 * publish it; the live API accepted an order signed from exactly this.
 */
export const ORDER_TYPES = {
  PartialFillLimitOrder: [
    { name: "info", type: "OrderInfo" },
    { name: "input", type: "PartialFillInputToken" },
    { name: "output", type: "OutputToken" },
    { name: "makerOnly", type: "bool" },
    { name: "takerOnce", type: "bool" },
    { name: "maxTakerFeePips", type: "uint32" },
    { name: "maxMakerFeePips", type: "uint32" },
  ],
  OrderInfo: [
    { name: "reactor", type: "address" },
    { name: "swapper", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "additionalValidationContract", type: "address" },
    { name: "additionalValidationData", type: "bytes" },
  ],
  PartialFillInputToken: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  OutputToken: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

/** Signature mode byte. The reactor reads it to choose a verifier. */
export const SIG_MODE_EIP712 = "0x00";

export type OrderSide = "BUY" | "SELL";

/** Policy limits the API enforces. Checked client-side so a bad deadline never gets signed. */
export const MIN_DEADLINE_SECONDS = 30;
export const MAX_DEADLINE_SECONDS = 90 * 24 * 3600;

export const builtOrderSchema = z
  .object({
    info: z.object({
      reactor: z.string(),
      swapper: z.string(),
      nonce: z.union([z.string(), z.number()]),
      deadline: z.union([z.string(), z.number()]),
      additionalValidationContract: z.string(),
      additionalValidationData: z.string(),
    }),
    input: z.object({ token: z.string(), amount: z.union([z.string(), z.number()]) }),
    output: z.object({
      token: z.string(),
      amount: z.union([z.string(), z.number()]),
      recipient: z.string(),
    }),
    makerOnly: z.boolean(),
    takerOnce: z.boolean(),
    maxTakerFeePips: z.number(),
    maxMakerFeePips: z.number(),
    meta: z.unknown().optional(),
  })
  .passthrough();

export type BuiltOrder = z.infer<typeof builtOrderSchema>;

export const buildResponseSchema = z.object({ orders: z.array(builtOrderSchema) }).passthrough();

export const savedOrderSchema = builtOrderSchema.extend({
  meta: z
    .object({
      id: z.union([z.string(), z.number()]).transform(String),
      status: z.string().optional(),
      orderHash: z.string().optional(),
      filledAmount: z.string().optional(),
      createdAt: z.string().optional(),
    })
    .passthrough(),
});

export const saveResponseSchema = z.object({ orders: z.array(savedOrderSchema) }).passthrough();

export const cancelResponseSchema = z
  .object({
    status: z.string().optional(),
    message: z.string().optional(),
    accepted: z.array(z.union([z.string(), z.number()])).optional(),
    skipped: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .passthrough();

export type CancelResponse = z.infer<typeof cancelResponseSchema>;

export type OrderRequest = {
  orderbookId: string;
  type: "LIMIT" | "MARKET";
  deadline?: string;
  inputToken: string;
  inputAmount: string;
  outputToken: string;
  outputAmount: string;
  recipient?: string;
  makerOnly?: boolean;
  takerOnce?: boolean;
  isAMMEnabled?: boolean;
};

/**
 * Turn a human price and size into the raw amounts the reactor settles on.
 *
 * SELL: spend `size` base, receive at least `price × size` quote.
 * BUY:  spend `price × size` quote, receive at least `size` base.
 *
 * Both amounts are smallest units, computed in bigint. The output amount is a *minimum*,
 * which is what gives the signed order its price protection.
 */
export const orderAmounts = (
  side: OrderSide,
  price: string,
  size: string,
  market: Pick<Orderbook, "baseTokenDecimals" | "quoteTokenDecimals" | "baseTokenEvmAddress" | "quoteTokenEvmAddress">,
): { inputToken: string; inputAmount: string; outputToken: string; outputAmount: string } => {
  const baseUnits = parseDecimal(size, market.baseTokenDecimals);
  const quoteUnits = notionalUnits(price, size, market.baseTokenDecimals, market.quoteTokenDecimals);

  if (baseUnits <= 0n || quoteUnits <= 0n) {
    throw new Error("Order amounts must be greater than zero.");
  }

  return side === "SELL"
    ? {
        inputToken: market.baseTokenEvmAddress,
        inputAmount: baseUnits.toString(),
        outputToken: market.quoteTokenEvmAddress,
        outputAmount: quoteUnits.toString(),
      }
    : {
        inputToken: market.quoteTokenEvmAddress,
        inputAmount: quoteUnits.toString(),
        outputToken: market.baseTokenEvmAddress,
        outputAmount: baseUnits.toString(),
      };
};

/** Which token a side spends — what a balance check must look at. */
export const spendingToken = (side: OrderSide, market: Orderbook) =>
  side === "SELL"
    ? { tokenId: market.baseTokenId, symbol: market.baseTokenSymbol, decimals: market.baseTokenDecimals }
    : { tokenId: market.quoteTokenId, symbol: market.quoteTokenSymbol, decimals: market.quoteTokenDecimals };

export const clampDeadline = (seconds: number): number =>
  Math.min(Math.max(seconds, MIN_DEADLINE_SECONDS), MAX_DEADLINE_SECONDS);

export const buildOrderRequest = (
  side: OrderSide,
  price: string,
  size: string,
  market: Orderbook,
  options: { deadlineSeconds?: number; makerOnly?: boolean; isAMMEnabled?: boolean } = {},
): OrderRequest => {
  const amounts = orderAmounts(side, price, size, market);
  const lifetime = clampDeadline(options.deadlineSeconds ?? 3600);

  return {
    orderbookId: market.id,
    type: "LIMIT",
    deadline: String(Math.floor(Date.now() / 1000) + lifetime),
    ...amounts,
    makerOnly: options.makerOnly ?? true,
    takerOnce: false,
    isAMMEnabled: options.isAMMEnabled ?? false,
  };
};

/** Strip API metadata: only the EIP-712 fields are signed. */
export const toSignableOrder = (built: BuiltOrder) => ({
  info: {
    reactor: built.info.reactor as `0x${string}`,
    swapper: built.info.swapper as `0x${string}`,
    nonce: BigInt(built.info.nonce),
    deadline: BigInt(built.info.deadline),
    additionalValidationContract: built.info.additionalValidationContract as `0x${string}`,
    additionalValidationData: built.info.additionalValidationData as `0x${string}`,
  },
  input: { token: built.input.token as `0x${string}`, amount: BigInt(built.input.amount) },
  output: {
    token: built.output.token as `0x${string}`,
    amount: BigInt(built.output.amount),
    recipient: built.output.recipient as `0x${string}`,
  },
  makerOnly: built.makerOnly,
  takerOnce: built.takerOnce,
  maxTakerFeePips: built.maxTakerFeePips,
  maxMakerFeePips: built.maxMakerFeePips,
});

/** Prefix a raw signature with its mode byte. Dropping the prefix makes the order unfillable. */
export const withSignatureMode = (signature: string): string =>
  `${SIG_MODE_EIP712}${signature.startsWith("0x") ? signature.slice(2) : signature}`;

/**
 * Cancellation is asynchronous: a 202 means "accepted", never "cancelled". The order is
 * only really gone once the stream or its history says so.
 */
export type CancelState = "requested" | "confirmed" | "rejected";

export const readCancelResponse = (response: CancelResponse, orderId: string): CancelState => {
  const accepted = (response.accepted ?? []).map(String);
  const skipped = (response.skipped ?? []).map(String);
  if (skipped.includes(orderId)) return "rejected";
  if (accepted.includes(orderId)) return "requested";
  return "requested";
};

/** True once an order's event history shows it actually cancelled. */
export const isCancelConfirmed = (events: { type: string }[]): boolean =>
  events.some(event => event.type.replace(/^ORDER_/, "").toUpperCase() === "CANCELED");

export const describeSaveError = (error: unknown): string => {
  if (error instanceof ClobError) {
    const message = error.message;
    if (/insufficient token balance/i.test(message)) return message;
    if (/halted/i.test(message)) return "This market is halted and is not accepting new orders.";
    return message;
  }
  return (error as Error).message;
};
