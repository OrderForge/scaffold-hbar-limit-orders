import settlement from "./fixtures/settlement-3504309.json";
import { describe, expect, it } from "vitest";
import { decodeFills, fillsForOrder, verifyFill, verifyFills } from "~~/lib/verify/fills";

/**
 * A real settlement: testnet order 3504309, a BUY of 10 SAUCE at 0.0435 USDC on book 3,
 * filled on 2026-09-30. The filler batched two matches into one transaction, so it holds
 * four fills from three accounts, and exactly one of them is this order's.
 *
 * The first version of fill verification checked every fill in the transaction against
 * the order, and this is the transaction that showed it: other traders' fees and sizes
 * were reported as failures of this order.
 */
const REACTOR = "0x5707B946EE64bD750A587261Ce36ec7024F3088B";
const US = "0x610041680B053425c3b0fa76E856d6F534F27418";
const fills = decodeFills(settlement.logs, REACTOR);

// What was signed: spend up to 0.435 USDC (6 dp) for at least 10 SAUCE (6 dp).
const signed = {
  swapper: US,
  inputAmount: 435_000n,
  outputAmount: 10_000_000n,
  recipient: US,
  deadline: 1_790_784_157n,
  maxTakerFeePips: 2000,
  maxMakerFeePips: 2000,
};
const filledAt = new Date(Math.floor(Number(settlement.timestamp.split(".")[0])) * 1000);

describe("a batched settlement", () => {
  it("carries the fills of every party it settled, not just yours", () => {
    expect(fills).toHaveLength(4);
    expect(new Set(fills.map(fill => fill.swapper.toLowerCase())).size).toBe(3);
  });

  it("yields exactly one fill for this order, by swapper and nonce", () => {
    const mine = fillsForOrder(fills, { swapper: US, nonce: "3" });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "taker", filled: 434_055n, outputAmount: 10_000_000n, fee: 868n });
  });

  it("does not match a different order from the same account", () => {
    expect(fillsForOrder(fills, { swapper: US, nonce: "4" })).toHaveLength(0);
  });

  it("verifies this order's fill against what was signed", () => {
    const [verification] = verifyFills(signed, [
      { fill: fillsForOrder(fills, { swapper: US, nonce: 3 })[0], filledAt },
    ]);
    expect(verification.checks.filter(check => !check.ok)).toEqual([]);
    expect(verification.ok).toBe(true);
  });

  it("filled at the resting ask, better than the limit", () => {
    // 10 SAUCE for 0.434055 USDC is 0.0434055 per SAUCE, under the 0.0435 limit.
    const [mine] = fillsForOrder(fills, { swapper: US, nonce: 3 });
    expect(mine.outputAmount * signed.inputAmount >= signed.outputAmount * mine.filled).toBe(true);
  });

  it("charges a fee just inside the cap, and the exact comparison matters", () => {
    // 868 on 434,055 is 1,999.7 pips against a cap of 2,000: rounding to whole pips first
    // would hide how close it is, but it is inside.
    const [mine] = fillsForOrder(fills, { swapper: US, nonce: 3 });
    const verification = verifyFill({ order: signed, filledAt }, mine);
    expect(verification.checks.find(check => check.id === "feeCap")?.ok).toBe(true);
  });

  it("would have failed against the other side's fill — which is why filtering matters", () => {
    const theirs = fills.find(fill => fill.swapper.toLowerCase() !== US.toLowerCase())!;
    expect(verifyFill({ order: signed, filledAt }, theirs).ok).toBe(false);
  });
});
