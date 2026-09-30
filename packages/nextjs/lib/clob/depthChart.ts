/**
 * The depth chart's geometry: cumulative bid and ask curves, in plain numbers.
 *
 * Everything here is for drawing. It converts exact decimal strings to floating point,
 * which is fine for a picture and wrong for money — nothing in this file may feed a
 * price, a size or a notional back into an order. The ladder and the order ticket keep
 * working in exact units.
 */
import { NormalizedDepth } from "./depth";

export type CurvePoint = {
  price: number;
  /** Cumulative size from the best price to this level, in base-token units. */
  cumulative: number;
};

export type DepthCurve = {
  /** Best bid first, walking down in price. */
  bids: CurvePoint[];
  /** Best ask first, walking up in price. */
  asks: CurvePoint[];
  /** Horizontal range, centred on the mid so neither side looks deeper by accident. */
  minPrice: number;
  maxPrice: number;
  /** The larger side's total, so both curves share one vertical scale. */
  maxCumulative: number;
  mid: number | null;
  isCrossed: boolean;
  isEmpty: boolean;
};

export type DepthCurveOptions = {
  /**
   * Levels per side. A handful of orders far from the touch would otherwise stretch the
   * price axis until the interesting part of the book is a sliver in the middle.
   */
  levels?: number;
};

export const DEFAULT_CHART_LEVELS = 40;

const toPoints = (levels: NormalizedDepth["bids"], limit: number): CurvePoint[] =>
  levels
    .slice(0, limit)
    .map(level => ({ price: Number(level.price), cumulative: Number(level.cumulativeSize) }))
    .filter(point => Number.isFinite(point.price) && Number.isFinite(point.cumulative));

export const buildDepthCurve = (depth: NormalizedDepth, options: DepthCurveOptions = {}): DepthCurve => {
  const limit = Math.max(1, Math.floor(options.levels ?? DEFAULT_CHART_LEVELS));
  const bids = toPoints(depth.bids, limit);
  const asks = toPoints(depth.asks, limit);

  const empty: DepthCurve = {
    bids,
    asks,
    minPrice: 0,
    maxPrice: 0,
    maxCumulative: 0,
    mid: null,
    isCrossed: depth.isCrossed,
    isEmpty: true,
  };
  if (bids.length === 0 && asks.length === 0) return empty;

  const prices = [...bids, ...asks].map(point => point.price);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);

  // One-sided books have no mid; centre on the only side there is.
  const mid = depth.mid !== null ? Number(depth.mid) : null;
  const centre = mid ?? (lowest + highest) / 2;

  // Symmetric around the centre, with a little room so the outermost step is visible.
  let half = Math.max(centre - lowest, highest - centre);
  if (half === 0) half = Math.abs(centre) * 0.01 || 1;
  half *= 1.04;

  const maxCumulative = Math.max(bids.at(-1)?.cumulative ?? 0, asks.at(-1)?.cumulative ?? 0);

  return {
    bids,
    asks,
    minPrice: centre - half,
    maxPrice: centre + half,
    maxCumulative,
    mid,
    isCrossed: depth.isCrossed,
    isEmpty: false,
  };
};

/**
 * What the book offers at a given price, for the hover readout.
 *
 * Below the mid that is the bids at or above it — what you could sell into, walking down
 * to that price. Above the mid, the asks at or below it. Outside the book it is null.
 */
export const depthAtPrice = (
  curve: DepthCurve,
  price: number,
): { side: "bid" | "ask"; price: number; cumulative: number } | null => {
  if (curve.isEmpty) return null;
  const centre = curve.mid ?? (curve.minPrice + curve.maxPrice) / 2;

  if (price <= centre) {
    let reached: CurvePoint | null = null;
    for (const point of curve.bids) {
      if (point.price >= price) reached = point;
      else break;
    }
    return reached ? { side: "bid", price: reached.price, cumulative: reached.cumulative } : null;
  }

  let reached: CurvePoint | null = null;
  for (const point of curve.asks) {
    if (point.price <= price) reached = point;
    else break;
  }
  return reached ? { side: "ask", price: reached.price, cumulative: reached.cumulative } : null;
};

/**
 * An SVG path for one side, as a step curve: depth changes only at a level, so a sloped
 * line between levels would draw liquidity that does not exist.
 */
export const stepPath = (
  points: CurvePoint[],
  side: "bid" | "ask",
  x: (price: number) => number,
  y: (cumulative: number) => number,
  closeTo: "area" | "line",
): string => {
  if (points.length === 0) return "";

  // Each side starts at the touch with zero depth and steps up level by level, walking
  // away from the mid; the last level runs flat to the edge of the chart.
  const edge = side === "bid" ? x(-Infinity) : x(Infinity);
  const commands: string[] = [`M ${x(points[0].price)} ${y(0)}`];
  let previous = 0;
  for (const point of points) {
    commands.push(`L ${x(point.price)} ${y(previous)}`);
    commands.push(`L ${x(point.price)} ${y(point.cumulative)}`);
    previous = point.cumulative;
  }
  commands.push(`L ${edge} ${y(previous)}`);
  if (closeTo === "area") commands.push(`L ${edge} ${y(0)} Z`);
  return commands.join(" ");
};
