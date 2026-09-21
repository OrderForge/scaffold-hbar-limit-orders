/**
 * Order book shaping and reconciliation.
 *
 * Two things here are not optional:
 *
 * 1. **Sort client-side.** The API's arrays happen to arrive sorted today. Rendering a
 *    ladder is a correctness problem, not a display problem, so we sort anyway.
 * 2. **A crossed book is a state, not a bug.** Testnet book 3 was observed with the best
 *    bid above the best ask and a negative spread. Render it as "crossed", never as a
 *    broken number.
 */
import { compareDecimalStrings, parseDecimal } from "./format";
import { DepthDiff, DepthLevel, DepthSnapshot } from "./types";

export type BookLevel = {
  price: string;
  size: string;
  /** Running total of size from the top of the book down to this level. */
  cumulativeSize: string;
  /** 0–1 share of the largest cumulative size on this side, for depth bars. */
  depthRatio: number;
};

export type NormalizedDepth = {
  orderbookId: string;
  timestamp: number;
  lastUpdateId: number;
  bids: BookLevel[];
  asks: BookLevel[];
  bestBid: string | null;
  bestAsk: string | null;
  /** Best ask − best bid, or null when either side is empty. */
  spread: string | null;
  /** Spread as a percentage of the mid price, matching the API's own definition. */
  spreadPercent: string | null;
  mid: string | null;
  /** True when the best bid is at or above the best ask. */
  isCrossed: boolean;
  isEmpty: boolean;
};

const SCALE = 18;

const toUnits = (value: string) => parseDecimal(value, SCALE);

const fromUnits = (units: bigint): string => {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const divisor = 10n ** BigInt(SCALE);
  const whole = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(SCALE, "0").replace(/0+$/, "");
  const rendered = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${rendered}` : rendered;
};

/** Levels with a size of zero are removals, never rendered. */
const isLive = (level: DepthLevel) => {
  try {
    return toUnits(level[1]) > 0n;
  } catch {
    return false;
  }
};

const buildSide = (levels: DepthLevel[], descending: boolean): BookLevel[] => {
  const sorted = levels
    .filter(isLive)
    .slice()
    .sort((a, b) => {
      const order = compareDecimalStrings(a[0], b[0], SCALE);
      return descending ? -order : order;
    });

  let running = 0n;
  const withCumulative = sorted.map(([price, size]) => {
    running += toUnits(size);
    return { price, size, cumulative: running };
  });

  // Guard against a zero maximum: an empty or all-zero side must not divide by zero.
  const max = withCumulative.length ? withCumulative[withCumulative.length - 1].cumulative : 0n;

  return withCumulative.map(level => ({
    price: level.price,
    size: level.size,
    cumulativeSize: fromUnits(level.cumulative),
    depthRatio: max > 0n ? Number((level.cumulative * 10_000n) / max) / 10_000 : 0,
  }));
};

/**
 * Shape a raw snapshot for rendering: sorted sides, cumulative sizes, bar ratios, and the
 * spread computed from the ladder itself rather than trusted from the payload.
 */
export const normalizeDepth = (snapshot: DepthSnapshot): NormalizedDepth => {
  const bids = buildSide(snapshot.bids, true);
  const asks = buildSide(snapshot.asks, false);

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;

  let spread: string | null = null;
  let spreadPercent: string | null = null;
  let mid: string | null = null;
  let isCrossed = false;

  if (bestBid !== null && bestAsk !== null) {
    const bidUnits = toUnits(bestBid);
    const askUnits = toUnits(bestAsk);
    const spreadUnits = askUnits - bidUnits;
    const midUnits = (askUnits + bidUnits) / 2n;

    spread = fromUnits(spreadUnits);
    mid = fromUnits(midUnits);
    isCrossed = bidUnits >= askUnits;

    if (midUnits > 0n) {
      // (ask - bid) / mid * 100, kept exact: matches the API's spreadPercent.
      const percentUnits = (spreadUnits * 100n * 10n ** BigInt(SCALE)) / midUnits;
      spreadPercent = fromUnits(percentUnits);
    }
  }

  return {
    orderbookId: snapshot.orderbookId,
    timestamp: snapshot.timestamp,
    lastUpdateId: snapshot.lastUpdateId,
    bids,
    asks,
    bestBid,
    bestAsk,
    spread,
    spreadPercent,
    mid,
    isCrossed,
    isEmpty: bids.length === 0 && asks.length === 0,
  };
};

/** A local book kept current by applying diffs to a snapshot. */
export type LiveBook = {
  orderbookId: string;
  bids: Map<string, string>;
  asks: Map<string, string>;
  lastUpdateId: number;
  timestamp: number;
};

export const bookFromSnapshot = (snapshot: DepthSnapshot): LiveBook => ({
  orderbookId: snapshot.orderbookId,
  bids: new Map(snapshot.bids.filter(isLive)),
  asks: new Map(snapshot.asks.filter(isLive)),
  lastUpdateId: snapshot.lastUpdateId,
  timestamp: snapshot.timestamp,
});

export const bookToSnapshot = (book: LiveBook): DepthSnapshot => ({
  orderbookId: book.orderbookId,
  timestamp: book.timestamp,
  lastUpdateId: book.lastUpdateId,
  bids: [...book.bids.entries()] as DepthLevel[],
  asks: [...book.asks.entries()] as DepthLevel[],
});

export type DiffOutcome =
  /** Applied to the book. */
  | { status: "applied"; book: LiveBook }
  /** Older than the snapshot — expected while draining the buffer, safe to drop. */
  | { status: "stale" }
  /** A gap: some updates were missed, so the snapshot must be fetched again. */
  | { status: "gap"; expected: number; received: number };

const applyLevels = (side: Map<string, string>, levels: DepthLevel[]) => {
  for (const [price, size] of levels) {
    // A size of "0" deletes the level; anything else replaces it outright.
    if (isLive([price, size])) side.set(price, size);
    else side.delete(price);
  }
};

/**
 * Apply one `/ws/depth` diff, following the snapshot-plus-diffs procedure:
 *
 *   - drop any diff whose `finalUpdateId` is at or below the snapshot's `lastUpdateId`
 *   - the first diff applied must straddle `lastUpdateId + 1`
 *   - after that every diff must start exactly where the previous one ended
 *   - anything else is a gap, and the only safe response is a fresh snapshot
 */
export const applyDiff = (book: LiveBook, diff: DepthDiff, hasAppliedFirst = true): DiffOutcome => {
  if (diff.finalUpdateId <= book.lastUpdateId) return { status: "stale" };

  const expected = book.lastUpdateId + 1;
  const contiguous = hasAppliedFirst
    ? diff.firstUpdateId === expected
    : diff.firstUpdateId <= expected && diff.finalUpdateId >= expected;

  if (!contiguous) return { status: "gap", expected, received: diff.firstUpdateId };

  const next: LiveBook = {
    orderbookId: book.orderbookId,
    bids: new Map(book.bids),
    asks: new Map(book.asks),
    lastUpdateId: diff.finalUpdateId,
    timestamp: diff.timestamp,
  };

  applyLevels(next.bids, diff.bids);
  applyLevels(next.asks, diff.asks);

  return { status: "applied", book: next };
};
