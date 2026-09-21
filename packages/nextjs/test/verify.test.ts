import mainnetFills from "./fixtures/mainnet-fills.json";
import { describe, expect, it } from "vitest";
import {
  Fill,
  SignedOrderReference,
  decodeFills,
  effectiveFeePips,
  feeWithinCap,
  priceAtLeastAsGood,
  verifyFill,
  verifyFills,
} from "~~/lib/verify/fills";

/** A signed order: 10 SAUCE in, at least 10 USDC out, 0.2% fee caps. */
const order: SignedOrderReference = {
  swapper: "0x610041680b053425c3b0fa76e856d6f534f27418",
  inputAmount: 10_000_000n,
  outputAmount: 10_000_000n,
  recipient: "0x610041680b053425c3b0fa76e856d6f534f27418",
  deadline: BigInt(Math.floor(Date.UTC(2026, 8, 30) / 1000)),
  maxTakerFeePips: 2000,
  maxMakerFeePips: 2000,
};

const fill = (over: Partial<Fill> = {}): Fill => ({
  kind: "taker",
  orderHash: "0x89ab28abae335b7e86eec1680af846cb84377345e4b5030dd0acbcd6cff5d6e1",
  swapper: order.swapper,
  filler: "0x170214df32b74e1885781769c452c7f9948a9628",
  nonce: 1n,
  filled: 10_000_000n,
  outputAmount: 10_000_000n,
  fee: 0n,
  rebate: 0n,
  ...over,
});

const filledAt = new Date(Date.UTC(2026, 8, 22));

describe("decoding real settlements from Hedera mainnet", () => {
  it("decodes every captured fill with the reactor ABI", () => {
    // Real logs from the live reactor, pulled from the trade tape and the mirror node.
    expect(mainnetFills.fills.length).toBeGreaterThan(0);

    for (const settlement of mainnetFills.fills) {
      const fills = decodeFills(settlement.logs, mainnetFills.reactor);
      expect(fills.length).toBeGreaterThan(0);
      for (const decoded of fills) {
        expect(decoded.orderHash).toMatch(/^0x[0-9a-f]{64}$/i);
        expect(decoded.filled).toBeGreaterThan(0n);
        expect(decoded.outputAmount).toBeGreaterThan(0n);
        expect(["taker", "maker"]).toContain(decoded.kind);
      }
    }
  });

  it("ignores logs from other contracts in the same transaction", () => {
    const settlement = mainnetFills.fills[0];
    const foreign = [
      {
        address: "0x000000000000000000000000000000000000dead",
        topics: settlement.logs[0].topics,
        data: settlement.logs[0].data,
      },
    ];
    expect(decodeFills(foreign, mainnetFills.reactor)).toHaveLength(0);
  });

  it("skips a log it cannot decode rather than guessing", () => {
    const junk = [{ address: mainnetFills.reactor, topics: ["0x" + "11".repeat(32)], data: "0x" }];
    expect(decodeFills(junk, mainnetFills.reactor)).toHaveLength(0);
  });
});

describe("price check", () => {
  it("accepts a fill exactly at the signed limit", () => {
    expect(priceAtLeastAsGood(fill(), order)).toBe(true);
  });

  it("accepts a better-than-limit fill", () => {
    expect(priceAtLeastAsGood(fill({ outputAmount: 11_000_000n }), order)).toBe(true);
  });

  it("rejects a fill one unit below the limit", () => {
    expect(priceAtLeastAsGood(fill({ outputAmount: 9_999_999n }), order)).toBe(false);
  });

  it("holds the same ratio on a partial fill", () => {
    // Half the input must return at least half the output.
    expect(priceAtLeastAsGood(fill({ filled: 5_000_000n, outputAmount: 5_000_000n }), order)).toBe(true);
    expect(priceAtLeastAsGood(fill({ filled: 5_000_000n, outputAmount: 4_999_999n }), order)).toBe(false);
  });
});

describe("fee cap", () => {
  it("computes the effective rate in pips", () => {
    // 0.2% of 10 SAUCE = 20000 units = 2000 pips.
    expect(effectiveFeePips(fill({ fee: 20_000n }))).toBe(2000n);
  });

  it("catches a fee a fraction above the cap, which rounding would hide", () => {
    // 20001 units is 2000.1 pips: rounded to whole pips it looks compliant.
    expect(effectiveFeePips(fill({ fee: 20_001n }))).toBe(2000n);
    expect(feeWithinCap(fill({ fee: 20_000n }), 2000)).toBe(true);
    expect(feeWithinCap(fill({ fee: 20_001n }), 2000)).toBe(false);
  });

  it("passes a fee at the cap and fails one above it", () => {
    expect(verifyFill({ order, filledAt }, fill({ fee: 20_000n })).checks.find(c => c.id === "feeCap")?.ok).toBe(true);
    expect(verifyFill({ order, filledAt }, fill({ fee: 20_001n })).checks.find(c => c.id === "feeCap")?.ok).toBe(false);
  });

  it("uses the maker cap for a maker fill", () => {
    const makerOrder = { ...order, maxMakerFeePips: 500, maxTakerFeePips: 5000 };
    const result = verifyFill({ order: makerOrder, filledAt }, fill({ kind: "maker", fee: 20_000n }));
    expect(result.checks.find(c => c.id === "feeCap")?.ok).toBe(false);
  });
});

describe("verifyFill", () => {
  it("passes a clean fill on every check", () => {
    const result = verifyFill(
      { order: { ...order, orderHash: fill().orderHash }, filledAt, observedRecipient: order.recipient },
      fill(),
    );
    expect(result.ok).toBe(true);
    expect(result.checks.map(check => check.id)).toEqual([
      "orderHash",
      "price",
      "feeCap",
      "deadline",
      "size",
      "recipient",
    ]);
  });

  it("catches a fill that settles a different order", () => {
    const result = verifyFill({ order: { ...order, orderHash: `0x${"11".repeat(32)}` }, filledAt }, fill());
    expect(result.ok).toBe(false);
    expect(result.checks.find(check => check.id === "orderHash")?.ok).toBe(false);
  });

  it("catches a fill after the deadline", () => {
    const late = new Date(Date.UTC(2026, 9, 15));
    const result = verifyFill({ order, filledAt: late }, fill());
    expect(result.checks.find(check => check.id === "deadline")?.ok).toBe(false);
  });

  it("catches proceeds sent somewhere else", () => {
    const result = verifyFill(
      { order, filledAt, observedRecipient: "0x000000000000000000000000000000000000dead" },
      fill(),
    );
    expect(result.checks.find(check => check.id === "recipient")?.ok).toBe(false);
  });

  it("catches being filled for more than was signed", () => {
    const result = verifyFill({ order, previouslyFilled: 6_000_000n, filledAt }, fill({ filled: 5_000_000n }));
    expect(result.checks.find(check => check.id === "size")?.ok).toBe(false);
  });
});

describe("verifyFills across partial fills", () => {
  it("accepts partials that add up to the signed size", () => {
    const results = verifyFills(order, [
      { fill: fill({ filled: 4_000_000n, outputAmount: 4_000_000n }), filledAt },
      { fill: fill({ filled: 6_000_000n, outputAmount: 6_000_000n }), filledAt },
    ]);
    expect(results.every(result => result.ok)).toBe(true);
  });

  it("flags the fill that pushes the total over the signed amount", () => {
    const results = verifyFills(order, [
      { fill: fill({ filled: 7_000_000n, outputAmount: 7_000_000n }), filledAt },
      { fill: fill({ filled: 7_000_000n, outputAmount: 7_000_000n }), filledAt },
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[1].checks.find(check => check.id === "size")?.ok).toBe(false);
  });
});
