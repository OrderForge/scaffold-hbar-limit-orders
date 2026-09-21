import books from "./fixtures/books.json";
import cancel202 from "./fixtures/cancel-202.json";
import history from "./fixtures/order-history-canceled.json";
import built from "./fixtures/orders-build-3.json";
import { describe, expect, it } from "vitest";
import {
  MAX_DEADLINE_SECONDS,
  MIN_DEADLINE_SECONDS,
  buildOrderRequest,
  builtOrderSchema,
  clampDeadline,
  isCancelConfirmed,
  orderAmounts,
  readCancelResponse,
  spendingToken,
  toSignableOrder,
  withSignatureMode,
} from "~~/lib/clob/orders";
import { orderbookSchema } from "~~/lib/clob/types";

const market = orderbookSchema.parse(books.orderbooks.find(book => book.id === "3"));

describe("orderAmounts", () => {
  it("sells base for quote", () => {
    // 10 SAUCE at 1 USDC: spend 10 SAUCE (6dp), receive at least 10 USDC (6dp).
    const amounts = orderAmounts("SELL", "1", "10", market);
    expect(amounts.inputToken).toBe(market.baseTokenEvmAddress);
    expect(amounts.inputAmount).toBe("10000000");
    expect(amounts.outputToken).toBe(market.quoteTokenEvmAddress);
    expect(amounts.outputAmount).toBe("10000000");
  });

  it("buys base with quote — the mirror image, not a flag", () => {
    const amounts = orderAmounts("BUY", "1", "10", market);
    expect(amounts.inputToken).toBe(market.quoteTokenEvmAddress);
    expect(amounts.outputToken).toBe(market.baseTokenEvmAddress);
    expect(amounts.inputAmount).toBe("10000000");
    expect(amounts.outputAmount).toBe("10000000");
  });

  it("keeps the price exact at the market's tick precision", () => {
    // 0.0428608 x 500 = 21.4304 USDC. Through a float this drifts.
    const amounts = orderAmounts("SELL", "0.0428608", "500", market);
    expect(amounts.inputAmount).toBe("500000000");
    expect(amounts.outputAmount).toBe("21430400");
  });

  it("refuses an order that would round to nothing", () => {
    expect(() => orderAmounts("SELL", "0.0000001", "0.000001", market)).toThrow();
  });

  it("names the token each side actually spends", () => {
    // A balance check that looks at the wrong token passes when it should fail.
    expect(spendingToken("SELL", market).tokenId).toBe(market.baseTokenId);
    expect(spendingToken("BUY", market).tokenId).toBe(market.quoteTokenId);
  });
});

describe("deadlines", () => {
  it("clamps to the API's policy limits", () => {
    expect(clampDeadline(5)).toBe(MIN_DEADLINE_SECONDS);
    expect(clampDeadline(3600)).toBe(3600);
    expect(clampDeadline(365 * 24 * 3600)).toBe(MAX_DEADLINE_SECONDS);
  });

  it("builds a request the API will accept", () => {
    const request = buildOrderRequest("SELL", "1", "10", market, { makerOnly: true });
    expect(request.orderbookId).toBe("3");
    expect(request.type).toBe("LIMIT");
    expect(request.makerOnly).toBe(true);
    expect(Number(request.deadline)).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe("signing the built order", () => {
  const order = builtOrderSchema.parse(built.orders[0]);

  it("parses the real build response", () => {
    expect(order.info.swapper).toMatch(/^0x/);
    expect(order.info.nonce).toBe("1");
    // The server sets this; signing a zero address instead would be rejected.
    expect(order.info.additionalValidationContract).toBe("0xd1a45eba17b05cc62b11e2b62b8a00651a79014c");
  });

  it("signs only the EIP-712 fields, dropping API metadata", () => {
    const signable = toSignableOrder(order);
    expect(signable).not.toHaveProperty("meta");
    expect(signable.info.nonce).toBe(1n);
    expect(signable.input.amount).toBe(10_000_000n);
    expect(typeof signable.info.deadline).toBe("bigint");
  });

  it("keeps the mode byte on the signature", () => {
    // The reactor reads the prefix to choose a verifier; without it the order cannot fill.
    const signature = `0x${"ab".repeat(65)}`;
    const prefixed = withSignatureMode(signature);
    expect(prefixed.startsWith("0x00")).toBe(true);
    expect(prefixed).toHaveLength(2 + 2 + 130);
  });
});

describe("cancellation", () => {
  it("treats a 202 as requested, never as cancelled", () => {
    // The live API answers 202 {status: PENDING, accepted: [id]} — acknowledgement only.
    expect(cancel202.s).toBe(202);
    expect(readCancelResponse(cancel202.d, "3494124")).toBe("requested");
  });

  it("reports an order the venue refused to cancel", () => {
    expect(readCancelResponse({ accepted: [], skipped: [3494124] }, "3494124")).toBe("rejected");
  });

  it("confirms only once the history says CANCELED", () => {
    expect(isCancelConfirmed([{ type: "CREATED" }])).toBe(false);
    expect(isCancelConfirmed(history.events)).toBe(true);
    // The user-event stream spells the same event differently.
    expect(isCancelConfirmed([{ type: "ORDER_CANCELED" }])).toBe(true);
  });
});
