/**
 * Check every fill against the order that was signed.
 *
 * The reactor emits `TakerFill` / `MakerFill` for each settlement, carrying the order hash,
 * the amounts and the fee. Those events are on Hedera, so anyone can read them from the
 * mirror node. This module recomputes the checks the contract claims to enforce, from the
 * user's own signed order rather than from anything the venue says:
 *
 *   - **price** — the fill is at or better than the signed limit
 *   - **fee cap** — the fee charged is within the signed maximum
 *   - **deadline** — the fill happened before the order expired
 *   - **size** — the fills together never exceed the signed amount
 *   - **recipient** — the proceeds went where the order said
 *
 * What this proves: no fill broke the terms you signed. What it does not prove: that the
 * venue matched you fairly, or promptly, or at the best price available. Matching happens
 * off-chain and cannot be observed. The README keeps those claims apart, and so does this.
 */
import { decodeEventLog, parseAbi } from "viem";

export const FILL_ABI = parseAbi([
  "event TakerFill(bytes32 indexed orderHash, address indexed filler, address indexed swapper, uint256 nonce, uint256 principalFilled, uint256 outputAmount, uint256 takerFee)",
  "event MakerFill(bytes32 indexed orderHash, address indexed filler, address indexed swapper, uint256 nonce, uint256 fillAmount, uint256 outputAmount, uint256 makerFee, uint256 rebate)",
  "event OrderCancelled(bytes32 indexed orderHash, address indexed swapper)",
]);

/** Event selectors, so logs can be filtered before decoding. */
export const FILL_TOPICS = {
  TakerFill: "0x23bba268b673b5743e86e68e78da4b5921d2ed78a0fc060ee03b7b37978e1b08",
  MakerFill: "0x95f691cfd97e4dfb155eafc3c9c45a9c3d3e1c7f54c092973ddb87e731f4f388",
  OrderCancelled: "0xa6eb7cdc219e1518ced964e9a34e61d68a94e4f1569db3e84256ba981ba52753",
} as const;

export type RawLog = { address: string; topics: string[]; data: string };

export type Fill = {
  kind: "taker" | "maker";
  orderHash: string;
  swapper: string;
  filler: string;
  nonce: bigint;
  /** Input consumed by this fill, in the input token's smallest units. */
  filled: bigint;
  /** Output received, in the output token's smallest units. */
  outputAmount: bigint;
  /** Protocol fee charged for this fill, in input-token units for a taker. */
  fee: bigint;
  /** Maker rebate, if any. */
  rebate: bigint;
  transactionHash?: string;
  consensusAt?: Date;
};

/** The order as signed — the reference everything is checked against. */
export type SignedOrderReference = {
  orderHash?: string;
  swapper: string;
  /** Total input amount the order authorised. */
  inputAmount: bigint;
  /** Minimum total output the order accepted. */
  outputAmount: bigint;
  recipient: string;
  deadline: bigint;
  maxTakerFeePips: number;
  maxMakerFeePips: number;
};

export type CheckId = "orderHash" | "price" | "feeCap" | "deadline" | "size" | "recipient";

export type Check = {
  id: CheckId;
  ok: boolean;
  label: string;
  detail: string;
};

export type FillVerification = {
  fill: Fill;
  checks: Check[];
  ok: boolean;
};

const PIP_DENOMINATOR = 1_000_000n;

/** Decode the reactor's fill events out of a transaction's logs. */
export const decodeFills = (logs: RawLog[], reactorAddress: string): Fill[] => {
  const reactor = reactorAddress.toLowerCase();
  const fills: Fill[] = [];

  for (const log of logs) {
    if (log.address?.toLowerCase() !== reactor) continue;
    if (log.topics[0] !== FILL_TOPICS.TakerFill && log.topics[0] !== FILL_TOPICS.MakerFill) continue;

    try {
      const decoded = decodeEventLog({
        abi: FILL_ABI,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        data: log.data as `0x${string}`,
      });

      if (decoded.eventName === "TakerFill") {
        const args = decoded.args as any;
        fills.push({
          kind: "taker",
          orderHash: args.orderHash,
          swapper: args.swapper,
          filler: args.filler,
          nonce: args.nonce,
          filled: args.principalFilled,
          outputAmount: args.outputAmount,
          fee: args.takerFee,
          rebate: 0n,
        });
      } else if (decoded.eventName === "MakerFill") {
        const args = decoded.args as any;
        fills.push({
          kind: "maker",
          orderHash: args.orderHash,
          swapper: args.swapper,
          filler: args.filler,
          nonce: args.nonce,
          filled: args.fillAmount,
          outputAmount: args.outputAmount,
          fee: args.makerFee,
          rebate: args.rebate,
        });
      }
    } catch {
      // A log we cannot decode is not a fill we can verify; skip rather than guess.
      continue;
    }
  }

  return fills;
};

/**
 * Was this fill at least as good as the signed limit?
 *
 * The order says "for all of `inputAmount` I accept no less than `outputAmount`", so a
 * partial fill must respect the same ratio:
 *
 *     outputAmount_fill / filled  >=  outputAmount_signed / inputAmount_signed
 *
 * Cross-multiplied to stay in integers. A maker's `outputAmount` is already net of fee and
 * rebate, which is why the fee is not subtracted again here.
 */
export const priceAtLeastAsGood = (fill: Fill, order: SignedOrderReference): boolean =>
  fill.outputAmount * order.inputAmount >= order.outputAmount * fill.filled;

/**
 * Effective fee in pips, for display. Integer division truncates, so this is a rounded
 * figure — never compare it against the cap directly (see `feeWithinCap`).
 */
export const effectiveFeePips = (fill: Fill): bigint =>
  fill.filled === 0n ? 0n : (fill.fee * PIP_DENOMINATOR) / fill.filled;

/**
 * Is the fee within the signed cap?
 *
 * Compared without dividing: `fee / filled <= cap / 1e6` becomes `fee * 1e6 <= cap * filled`.
 * Rounding the rate to whole pips first would let a fee fractionally above the cap pass.
 */
export const feeWithinCap = (fill: Fill, capPips: number | bigint): boolean =>
  fill.fee * PIP_DENOMINATOR <= BigInt(capPips) * fill.filled;

export type VerifyContext = {
  order: SignedOrderReference;
  /** Sum of every earlier fill's input, so cumulative overfill is caught. */
  previouslyFilled?: bigint;
  /** Consensus time of the settlement, for the deadline check. */
  filledAt?: Date;
  /** Where the proceeds were sent, when the log for it is available. */
  observedRecipient?: string;
};

export const verifyFill = (
  { order, previouslyFilled = 0n, filledAt, observedRecipient }: VerifyContext,
  fill: Fill,
): FillVerification => {
  const checks: Check[] = [];

  if (order.orderHash) {
    const matches = fill.orderHash.toLowerCase() === order.orderHash.toLowerCase();
    checks.push({
      id: "orderHash",
      ok: matches,
      label: "Settles the order you signed",
      detail: matches
        ? `order hash ${fill.orderHash.slice(0, 10)}… matches the journalled intent`
        : `fill settles ${fill.orderHash.slice(0, 10)}…, not the order in the journal`,
    });
  }

  const pricedWell = priceAtLeastAsGood(fill, order);
  checks.push({
    id: "price",
    ok: pricedWell,
    label: "Price at or better than your limit",
    detail: pricedWell
      ? "the output received meets the ratio the signed order required"
      : "the output received is below the signed limit for the amount filled",
  });

  const cap = BigInt(fill.kind === "taker" ? order.maxTakerFeePips : order.maxMakerFeePips);
  const charged = effectiveFeePips(fill);
  const feeOk = feeWithinCap(fill, cap);
  checks.push({
    id: "feeCap",
    ok: feeOk,
    label: "Fee within the cap you signed",
    detail: `${charged} pips charged against a cap of ${cap}`,
  });

  if (filledAt) {
    const withinDeadline = BigInt(Math.floor(filledAt.getTime() / 1000)) <= order.deadline;
    checks.push({
      id: "deadline",
      ok: withinDeadline,
      label: "Filled before the order expired",
      detail: withinDeadline
        ? `filled at ${filledAt.toISOString()}, deadline ${new Date(Number(order.deadline) * 1000).toISOString()}`
        : "filled after the signed deadline",
    });
  }

  const cumulative = previouslyFilled + fill.filled;
  const withinSize = cumulative <= order.inputAmount;
  checks.push({
    id: "size",
    ok: withinSize,
    label: "Never filled for more than you signed",
    detail: `${cumulative} of ${order.inputAmount} input units filled in total`,
  });

  if (observedRecipient) {
    const right = observedRecipient.toLowerCase() === order.recipient.toLowerCase();
    checks.push({
      id: "recipient",
      ok: right,
      label: "Proceeds went to you",
      detail: right ? "recipient matches the signed order" : "proceeds went somewhere other than the signed recipient",
    });
  }

  return { fill, checks, ok: checks.every(check => check.ok) };
};

/** Verify a run of fills for one order, carrying the cumulative total forward. */
export const verifyFills = (
  order: SignedOrderReference,
  fills: { fill: Fill; filledAt?: Date }[],
): FillVerification[] => {
  let cumulative = 0n;
  return fills.map(({ fill, filledAt }) => {
    const verification = verifyFill({ order, previouslyFilled: cumulative, filledAt }, fill);
    cumulative += fill.filled;
    return verification;
  });
};
