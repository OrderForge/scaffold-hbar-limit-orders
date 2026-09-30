import crossed from "./fixtures/depth-3-crossed.json";
import { describe, expect, it } from "vitest";
import { normalizeDepth } from "~~/lib/clob/depth";
import { buildDepthCurve, depthAtPrice, stepPath } from "~~/lib/clob/depthChart";
import { DepthSnapshot, depthSnapshotSchema } from "~~/lib/clob/types";

const snapshot = (bids: [string, string][], asks: [string, string][]): DepthSnapshot =>
  depthSnapshotSchema.parse({ ...crossed, orderbookId: "1", lastUpdateId: 1, bids, asks });

const book = normalizeDepth(
  snapshot(
    [
      ["0.0940", "100"],
      ["0.0930", "200"],
      ["0.0920", "300"],
    ],
    [
      ["0.0950", "50"],
      ["0.0960", "150"],
    ],
  ),
);

describe("the depth curve", () => {
  it("accumulates each side from the touch outwards", () => {
    const curve = buildDepthCurve(book);
    expect(curve.bids.map(point => point.cumulative)).toEqual([100, 300, 600]);
    expect(curve.asks.map(point => point.cumulative)).toEqual([50, 200]);
  });

  it("puts both sides on one vertical scale", () => {
    // Scaling each side to its own maximum would draw a thin side as deep as a thick one.
    expect(buildDepthCurve(book).maxCumulative).toBe(600);
  });

  it("centres the price axis on the mid", () => {
    const curve = buildDepthCurve(book);
    expect(curve.mid).toBeCloseTo(0.0945, 10);
    expect(curve.mid! - curve.minPrice).toBeCloseTo(curve.maxPrice - curve.mid!, 10);
    expect(curve.minPrice).toBeLessThan(0.092);
    expect(curve.maxPrice).toBeGreaterThan(0.096);
  });

  it("limits the levels drawn, so a stray far-off order cannot flatten the chart", () => {
    const withOutlier = normalizeDepth(
      snapshot(
        [
          ["0.0940", "100"],
          ["0.0010", "5"],
        ],
        [["0.0950", "50"]],
      ),
    );
    const curve = buildDepthCurve(withOutlier, { levels: 1 });
    expect(curve.bids).toHaveLength(1);
    expect(curve.minPrice).toBeGreaterThan(0.09);
  });

  it("reports an empty book rather than drawing nothing", () => {
    const curve = buildDepthCurve(normalizeDepth(snapshot([], [])));
    expect(curve.isEmpty).toBe(true);
  });

  it("draws a one-sided book, which has no mid", () => {
    const curve = buildDepthCurve(normalizeDepth(snapshot([["0.0940", "100"]], [])));
    expect(curve.isEmpty).toBe(false);
    expect(curve.mid).toBeNull();
    expect(curve.bids).toHaveLength(1);
  });

  it("carries a crossed book through, so the page can say so", () => {
    const curve = buildDepthCurve(normalizeDepth(snapshot([["0.0960", "100"]], [["0.0950", "50"]])));
    expect(curve.isCrossed).toBe(true);
    expect(curve.isEmpty).toBe(false);
  });
});

describe("reading the chart at a price", () => {
  const curve = buildDepthCurve(book);

  it("below the mid, reports the bids you could sell into down to that price", () => {
    expect(depthAtPrice(curve, 0.0931)).toMatchObject({ side: "bid", cumulative: 100 });
    expect(depthAtPrice(curve, 0.093)).toMatchObject({ side: "bid", cumulative: 300 });
  });

  it("above the mid, reports the asks you could buy up to that price", () => {
    expect(depthAtPrice(curve, 0.0955)).toMatchObject({ side: "ask", cumulative: 50 });
    expect(depthAtPrice(curve, 0.097)).toMatchObject({ side: "ask", cumulative: 200 });
  });

  it("inside the spread, reports nothing", () => {
    expect(depthAtPrice(curve, 0.0944)).toBeNull();
    expect(depthAtPrice(curve, 0.0946)).toBeNull();
  });
});

describe("the step path", () => {
  it("steps at levels instead of sloping between them", () => {
    // A slope between two levels would draw liquidity at prices where nobody is quoting.
    const path = stepPath(
      [
        { price: 2, cumulative: 10 },
        { price: 3, cumulative: 30 },
      ],
      "ask",
      price => (Number.isFinite(price) ? price : 9),
      cumulative => -cumulative,
      "line",
    );
    expect(path).toBe("M 2 0 L 2 0 L 2 -10 L 3 -10 L 3 -30 L 9 -30");
  });
});
