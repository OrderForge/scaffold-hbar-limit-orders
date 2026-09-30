import settlement from "./fixtures/settlement-3504309.json";

/**
 * A real maker fill: testnet order 3505943, a BUY of 10 SAUCE at 0.04288. The ask it was
 * priced against moved before it arrived, so it rested and was filled as a maker. A maker
 * pays its fee out of its proceeds, in the output token — which the first version of these
 * checks did not account for: it failed this fill on price, and reported the fee as 46,641
 * pips when it was exactly the 2,000-pip cap.
 */
import makerSettlement from "./fixtures/settlement-3505943.json";
import { describe, expect, it } from "vitest";
import { decodeFills, fillsForOrder, verifyFill, verifyFills } from "~~/lib/verify/fills";
import { effectiveFeePips, grossOutput } from "~~/lib/verify/fills";

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

describe("a real maker fill", () => {
  const makerFills = decodeFills(makerSettlement.logs, REACTOR);
  const [mine] = fillsForOrder(makerFills, { swapper: US, nonce: 4 });
  const signedMaker = { ...signed, inputAmount: 428_800n, outputAmount: 10_000_000n, deadline: 1_790_787_000n };
  const makerAt = new Date(Math.floor(Number(makerSettlement.timestamp.split(".")[0])) * 1000);

  it("is this order's, and only this order's", () => {
    expect(makerFills).toHaveLength(3);
    expect(mine).toMatchObject({ kind: "maker", filled: 428_800n, outputAmount: 9_980_000n, fee: 20_000n, rebate: 0n });
  });

  it("earned 10 SAUCE before its fee, exactly the limit", () => {
    expect(grossOutput(mine)).toBe(10_000_000n);
  });

  it("paid a fee of exactly 2,000 pips of its output — at the cap, not over it", () => {
    expect(effectiveFeePips(mine)).toBe(2000n);
  });

  it("passes every check", () => {
    const verification = verifyFill({ order: signedMaker, filledAt: makerAt }, mine);
    expect(verification.checks.filter(check => !check.ok)).toEqual([]);
  });
});

describe("maker fee and price boundaries", () => {
  const maker = (outputAmount: bigint, fee: bigint, rebate = 0n) => ({
    kind: "maker" as const,
    orderHash: "0x",
    swapper: US,
    filler: US,
    nonce: 1n,
    filled: 1_000_000n,
    outputAmount,
    fee,
    rebate,
  });
  const order = { ...signed, inputAmount: 1_000_000n, outputAmount: 10_000_000n };

  it("a fee one unit over the cap fails, even though it rounds to the cap", () => {
    // Gross 10,000,000; cap 2,000 pips allows a fee of 20,000.
    expect(verifyFill({ order }, maker(9_979_999n, 20_001n)).checks.find(c => c.id === "feeCap")?.ok).toBe(false);
    expect(verifyFill({ order }, maker(9_980_000n, 20_000n)).checks.find(c => c.id === "feeCap")?.ok).toBe(true);
  });

  it("a gross output one unit short of the limit fails on price", () => {
    expect(verifyFill({ order }, maker(9_979_999n, 20_000n)).checks.find(c => c.id === "price")?.ok).toBe(false);
  });

  it("counts a rebate as income, not as part of the price", () => {
    // Net = gross − fee + rebate, so a rebate must be taken off before comparing to the limit.
    const withRebate = maker(9_990_000n, 20_000n, 10_000n);
    expect(grossOutput(withRebate)).toBe(10_000_000n);
    expect(verifyFill({ order }, withRebate).ok).toBe(true);
  });
});
