import crossedFixture from "./fixtures/depth-3-crossed.json";
import haltedFixture from "./fixtures/depth-3-halted-empty.json";
import mainnetFixture from "./fixtures/mainnet-depth-1.json";
import wsFixture from "./fixtures/ws-depth-3.json";
import { describe, expect, it } from "vitest";
import { applyDiff, bookFromSnapshot, bookToSnapshot, normalizeDepth } from "~~/lib/clob/depth";
import { depthDiffSchema, depthSnapshotSchema } from "~~/lib/clob/types";

const crossed = depthSnapshotSchema.parse(crossedFixture);
const halted = depthSnapshotSchema.parse(haltedFixture);
const mainnet = depthSnapshotSchema.parse(mainnetFixture);

const noNaN = (value: unknown) => {
  const text = JSON.stringify(value);
  expect(text).not.toContain("null,null");
  expect(text).not.toMatch(/NaN|Infinity/);
};

describe("normalizeDepth — the real crossed book (testnet book 3, 2026-09-19)", () => {
  const book = normalizeDepth(crossed);

  it("flags the book as crossed rather than rendering a broken spread", () => {
    expect(book.bestBid).toBe("0.0430518");
    expect(book.bestAsk).toBe("0.0425864");
    expect(book.isCrossed).toBe(true);
  });

  it("computes the spread against the mid, matching the API's own figure", () => {
    // The API reported spreadPercent -1.0869 for this exact snapshot.
    expect(Number(book.spreadPercent)).toBeCloseTo(Number(crossed.spreadPercent), 3);
    expect(Number(book.spread)).toBeLessThan(0);
  });

  it("sorts bids descending and asks ascending", () => {
    const bidPrices = book.bids.map(level => Number(level.price));
    const askPrices = book.asks.map(level => Number(level.price));
    expect(bidPrices).toEqual([...bidPrices].sort((a, b) => b - a));
    expect(askPrices).toEqual([...askPrices].sort((a, b) => a - b));
  });

  it("accumulates size down each side and bounds the bar ratios to 0..1", () => {
    expect(book.bids[0].cumulativeSize).toBe(book.bids[0].size);
    const last = book.bids[book.bids.length - 1];
    expect(Number(last.cumulativeSize)).toBeCloseTo(
      book.bids.reduce((sum, level) => sum + Number(level.size), 0),
      6,
    );
    expect(last.depthRatio).toBe(1);
    for (const level of [...book.bids, ...book.asks]) {
      expect(level.depthRatio).toBeGreaterThan(0);
      expect(level.depthRatio).toBeLessThanOrEqual(1);
    }
  });

  it("produces no NaN or Infinity anywhere", () => noNaN(book));
});

describe("normalizeDepth — sorting is done by us, not trusted", () => {
  it("sorts a shuffled snapshot correctly", () => {
    // The live API happens to return sorted arrays; this proves the sort is real work and
    // not an accident of the fixture.
    const shuffled = depthSnapshotSchema.parse({
      ...crossedFixture,
      bids: [...crossedFixture.bids].reverse(),
      asks: [...crossedFixture.asks].sort(() => 0.5 - Math.random()),
    });
    const book = normalizeDepth(shuffled);
    expect(book.bestBid).toBe("0.0430518");
    expect(book.bestAsk).toBe("0.0425864");
    expect(book.bids.map(l => l.price)).toEqual(normalizeDepth(crossed).bids.map(l => l.price));
  });

  it("drops zero-size levels", () => {
    const withRemovals = depthSnapshotSchema.parse({
      ...crossedFixture,
      bids: [["0.05", "0"], ...crossedFixture.bids],
    });
    expect(normalizeDepth(withRemovals).bestBid).toBe("0.0430518");
  });
});

describe("normalizeDepth — halted and empty (testnet book 3, 2026-09-20)", () => {
  const book = normalizeDepth(halted);

  it("renders an empty book as a state, not a crash", () => {
    expect(book.isEmpty).toBe(true);
    expect(book.bestBid).toBeNull();
    expect(book.bestAsk).toBeNull();
    expect(book.spread).toBeNull();
    expect(book.spreadPercent).toBeNull();
    expect(book.isCrossed).toBe(false);
  });

  it("does not divide by zero when computing bar widths", () => noNaN(book));
});

describe("normalizeDepth — a healthy book (mainnet HBAR/USDC)", () => {
  const book = normalizeDepth(mainnet);

  it("reports a positive spread and no crossing", () => {
    expect(book.isCrossed).toBe(false);
    expect(Number(book.spread)).toBeGreaterThan(0);
    expect(Number(book.spreadPercent)).toBeCloseTo(Number(mainnet.spreadPercent), 2);
  });
});

describe("applyDiff — snapshot plus buffered diffs", () => {
  const diffs = wsFixture.messages.map(message => depthDiffSchema.parse(message));
  const base = () => bookFromSnapshot({ ...crossed, lastUpdateId: 3_706_527 });

  it("applies a contiguous run of real diffs", () => {
    let book = base();
    let first = false;
    for (const diff of diffs) {
      const outcome = applyDiff(book, diff, first);
      expect(outcome.status).toBe("applied");
      if (outcome.status === "applied") book = outcome.book;
      first = true;
    }
    expect(book.lastUpdateId).toBe(diffs[diffs.length - 1].finalUpdateId);
  });

  it("drops diffs at or below the snapshot id", () => {
    const book = bookFromSnapshot({ ...crossed, lastUpdateId: diffs[0].finalUpdateId });
    expect(applyDiff(book, diffs[0], false).status).toBe("stale");
  });

  it("reports a gap when an update is missed, so the caller re-snapshots", () => {
    const book = base();
    const outcome = applyDiff(book, diffs[2], false);
    expect(outcome).toMatchObject({ status: "gap", expected: 3_706_528 });
  });

  it("rejects a non-contiguous diff once the first has been applied", () => {
    let book = base();
    const firstOutcome = applyDiff(book, diffs[0], false);
    expect(firstOutcome.status).toBe("applied");
    if (firstOutcome.status === "applied") book = firstOutcome.book;
    expect(applyDiff(book, diffs[2], true).status).toBe("gap");
  });

  it("a size of zero deletes the level, any other size replaces it", () => {
    const book = bookFromSnapshot({ ...crossed, lastUpdateId: 100 });
    const price = crossed.asks[0][0];
    const removal = applyDiff(
      book,
      depthDiffSchema.parse({
        orderbookId: "3",
        firstUpdateId: 101,
        finalUpdateId: 101,
        timestamp: Date.now(),
        asks: [[price, "0"]],
        bids: [],
      }),
      true,
    );
    expect(removal.status).toBe("applied");
    if (removal.status !== "applied") return;
    expect(removal.book.asks.has(price)).toBe(false);
    expect(normalizeDepth(bookToSnapshot(removal.book)).bestAsk).not.toBe(price);
  });
});
