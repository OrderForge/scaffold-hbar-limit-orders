import books from "./fixtures/books.json";
import mainnetBooks from "./fixtures/mainnet-books.json";
import { describe, expect, it } from "vitest";
import {
  compareDecimalStrings,
  formatPercent,
  formatUnits,
  notional,
  notionalUnits,
  parseDecimal,
  pipsToPercent,
  pipsToPercentLabel,
  roundToLot,
  roundToSizeStep,
  roundToTick,
  stepDecimals,
  validateOrder,
} from "~~/lib/clob/format";
import { orderbookSchema } from "~~/lib/clob/types";

/** The real SAUCE/USDC market — the rules every test below is checked against. */
const market = books.orderbooks.find(book => book.id === "3")!;

describe("parseDecimal / formatUnits", () => {
  it("parses decimal strings exactly at token precision", () => {
    expect(parseDecimal("0.0428608", 6)).toBe(42860n);
    expect(parseDecimal("1", 8)).toBe(100_000_000n);
    expect(parseDecimal("2749.920288", 6)).toBe(2_749_920_288n);
  });

  it("truncates excess precision instead of rounding up", () => {
    // Rounding up would create an amount larger than the user agreed to.
    expect(parseDecimal("0.9999999", 6)).toBe(999_999n);
    expect(parseDecimal("0.0000009", 6)).toBe(0n);
  });

  it("survives a value larger than Number.MAX_SAFE_INTEGER", () => {
    const huge = "99999999999.99999999";
    expect(formatUnits(parseDecimal(huge, 8), 8)).toBe(huge);
  });

  it("round-trips every price level of the captured book", () => {
    const depth = require("./fixtures/depth-3-crossed.json");
    for (const [price, size] of [...depth.bids, ...depth.asks]) {
      expect(formatUnits(parseDecimal(price, 8), 8)).toBe(price.replace(/0+$/, "").replace(/\.$/, ""));
      expect(parseDecimal(size, 6)).toBeGreaterThan(0n);
    }
  });

  it("rejects values that are not numbers", () => {
    expect(() => parseDecimal("1e5", 6)).toThrow();
    expect(() => parseDecimal("abc", 6)).toThrow();
    expect(() => parseDecimal("", 6)).toThrow();
  });

  it("never produces exponent notation for very small amounts", () => {
    expect(formatUnits(1n, 8)).toBe("0.00000001");
  });
});

describe("pipsToPercent", () => {
  it("reads fees as pips, not basis points", () => {
    // 2000 pips = 0.2%. Read as basis points it would be 20% — a 100x error.
    expect(pipsToPercent(2000)).toBe("0.2");
    expect(pipsToPercentLabel(market.takerFeePips)).toBe("0.2%");
    expect(pipsToPercent(1)).toBe("0.0001");
    expect(pipsToPercent(0)).toBe("0");
    expect(pipsToPercent(250_000)).toBe("25");
  });
});

describe("notional", () => {
  it("multiplies price by size without floating point", () => {
    // 0.1 * 3 in IEEE754 is 0.30000000000000004.
    expect(notional("0.1", "3", 6, 6)).toBe("0.3");
  });

  it("handles a 6-decimal base against a 6-decimal quote", () => {
    expect(notional("0.0428608", "10", 6, 6)).toBe("0.428608");
  });

  it("handles an 8-decimal base (HBAR) against a 6-decimal quote", () => {
    expect(notionalUnits("2.26005", "100.5", 8, 6)).toBe(227_135_025n);
    expect(notional("2.26005", "100.5", 8, 6)).toBe("227.135025");
  });
});

describe("step helpers", () => {
  it("counts the decimals a step uses", () => {
    expect(stepDecimals(market.tickStep)).toBe(7);
    expect(stepDecimals(market.sizeStep)).toBe(5);
    expect(stepDecimals("1")).toBe(0);
  });

  it("rounds a price down to the tick grid", () => {
    expect(roundToTick("0.04286089", market.tickStep)).toBe("0.0428608");
  });

  it("keeps price precision finer than the quote token's decimals", () => {
    // USDC has 6 decimals but this market ticks at 1e-7: parsing the price at token
    // precision would drop the last digit and hide off-tick prices from validation.
    expect(notional("0.0428608", "10", 6, 6)).toBe("0.428608");
    expect(roundToTick("0.0428608", market.tickStep)).toBe("0.0428608");
  });

  it("rounds a size down to the size step", () => {
    expect(roundToSizeStep("10.000019", market.sizeStep, 6)).toBe("10.00001");
  });

  it("rounds a size down to whole lots", () => {
    // lotSize 10000000 on a 6dp token = 10 SAUCE, which is why depth sizes are multiples of 10.
    expect(roundToLot("27", market.lotSize, 6)).toBe("20");
    expect(roundToLot("30", market.lotSize, 6)).toBe("30");
  });
});

describe("validateOrder", () => {
  const rules = {
    tickStep: market.tickStep,
    sizeStep: market.sizeStep,
    lotSize: market.lotSize,
    minNotional: market.minNotional,
    baseTokenDecimals: market.baseTokenDecimals,
    quoteTokenDecimals: market.quoteTokenDecimals,
    status: market.status,
    isMarketHalted: 0,
  };

  it("accepts an order that satisfies every rule", () => {
    // 10 SAUCE (one lot) at 1 USDC = 10 USDC notional, well above minNotional 1.
    expect(validateOrder({ price: "1", size: "10" }, rules)).toEqual({ ok: true });
  });

  it("names the tick rule when the price is off-grid", () => {
    const result = validateOrder({ price: "0.04286085", size: "10" }, rules);
    expect(result).toMatchObject({ ok: false, rule: "tick" });
    expect(!result.ok && result.message).toContain(market.tickStep);
  });

  it("names the lot rule when the size is not a whole lot", () => {
    expect(validateOrder({ price: "1", size: "13" }, rules)).toMatchObject({ ok: false, rule: "lot" });
  });

  it("names the size-step rule before the lot rule for sub-step sizes", () => {
    expect(validateOrder({ price: "1", size: "10.000001" }, rules)).toMatchObject({ ok: false, rule: "sizeStep" });
  });

  it("reads minNotional as smallest units, not as a decimal", () => {
    // Every mainnet market reports minNotional 15000000 against 6-decimal USDC, i.e. 15
    // USDC. Read as a decimal that demands 15 million USDC and blocks every real order.
    const mainnetMarket = orderbookSchema.parse(mainnetBooks.orderbooks.find(book => book.id === "1"));
    const mainnetRules = {
      tickStep: mainnetMarket.tickStep,
      sizeStep: mainnetMarket.sizeStep,
      lotSize: mainnetMarket.lotSize,
      minNotional: mainnetMarket.minNotional,
      baseTokenDecimals: mainnetMarket.baseTokenDecimals,
      quoteTokenDecimals: mainnetMarket.quoteTokenDecimals,
      status: "OPEN",
      isMarketHalted: 0,
    };
    expect(mainnetMarket.minNotional).toBe("15000000");

    // 1000 HBAR at 0.09 = 90 USDC: comfortably above a 15 USDC minimum.
    expect(validateOrder({ price: "0.09", size: "1000" }, mainnetRules)).toEqual({ ok: true });

    // 100 HBAR at 0.09 = 9 USDC: below it.
    const tooSmall = validateOrder({ price: "0.09", size: "100" }, mainnetRules);
    expect(tooSmall).toMatchObject({ ok: false, rule: "minNotional" });
    // The message must speak in tokens, not raw units.
    expect(!tooSmall.ok && tooSmall.message).toContain("minimum of 15");
    expect(!tooSmall.ok && tooSmall.message).not.toContain("15000000");
  });

  it("accepts a small order where the market's minimum is tiny", () => {
    // Testnet reports minNotional 1, i.e. 0.000001 USDC — effectively no minimum.
    expect(validateOrder({ price: "0.0428608", size: "10" }, rules)).toEqual({ ok: true });
  });

  it("rejects zero and negative values", () => {
    expect(validateOrder({ price: "0", size: "10" }, rules)).toMatchObject({ ok: false, rule: "positive" });
    expect(validateOrder({ price: "1", size: "-10" }, rules)).toMatchObject({ ok: false, rule: "positive" });
  });

  it("blocks a halted market before any signature is requested", () => {
    const result = validateOrder({ price: "1", size: "10" }, { ...rules, isMarketHalted: 1 });
    expect(result).toMatchObject({ ok: false, rule: "market" });
    expect(!result.ok && result.message).toContain("halted");
  });

  it("blocks a closed market", () => {
    expect(validateOrder({ price: "1", size: "10" }, { ...rules, status: "CLOSED" })).toMatchObject({
      ok: false,
      rule: "market",
    });
  });
});

describe("display helpers", () => {
  it("signs percentages and handles nulls", () => {
    expect(formatPercent("0.9540594087066534")).toBe("+0.95%");
    expect(formatPercent("-1.0869")).toBe("-1.08%");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent("")).toBe("—");
  });

  it("compares decimal strings without precision loss", () => {
    expect(compareDecimalStrings("0.04286080", "0.0428608")).toBe(0);
    expect(compareDecimalStrings("0.0428609", "0.0428608")).toBe(1);
    expect(compareDecimalStrings("0.0428607", "0.0428608")).toBe(-1);
  });
});
