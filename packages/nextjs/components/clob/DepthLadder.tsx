"use client";

import { CrossedBadge } from "./MarketBadges";
import { LevelChange } from "~~/hooks/clob/useFreshness";
import { BookLevel, NormalizedDepth } from "~~/lib/clob/depth";
import { formatUnits, parseDecimal, stepDecimals } from "~~/lib/clob/format";
import { Orderbook } from "~~/lib/clob/types";

const PRICE_DIGITS = 8;

/** Render a decimal string at the market's own precision, never through a JS number. */
const atStep = (value: string, step: string, fallbackDigits = 2) => {
  try {
    const digits = stepDecimals(step) || fallbackDigits;
    return formatUnits(parseDecimal(value, PRICE_DIGITS), PRICE_DIGITS, digits);
  } catch {
    return value;
  }
};

const LadderRow = ({
  level,
  side,
  market,
  change,
}: {
  level: BookLevel;
  side: "bid" | "ask";
  market: Orderbook;
  change?: LevelChange;
}) => (
  // A changed level flashes briefly. On a thin book this is the only visible sign that the
  // feed is alive: the best bid and ask can sit still for minutes while the book behind
  // them moves.
  <tr
    className={`relative transition-colors duration-700 ${
      change === "added" || change === "increased" ? "bg-success/20" : change === "decreased" ? "bg-warning/20" : ""
    }`}
  >
    <td className="relative px-2 py-0.5 font-mono text-xs">
      {/* Depth bar sits behind the numbers; width comes from cumulative size. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 ${side === "bid" ? "right-0 bg-success/15" : "left-0 bg-error/15"}`}
        style={{ width: `${Math.max(level.depthRatio * 100, 0.5)}%` }}
      />
      <span className={`relative ${side === "bid" ? "text-success" : "text-error"}`}>
        {atStep(level.price, market.tickStep)}
      </span>
    </td>
    <td className="relative px-2 py-0.5 text-right font-mono text-xs">{atStep(level.size, market.sizeStep)}</td>
    <td className="relative px-2 py-0.5 text-right font-mono text-xs opacity-60">
      {atStep(level.cumulativeSize, market.sizeStep)}
    </td>
  </tr>
);

const SideTable = ({
  levels,
  side,
  market,
  changes,
}: {
  levels: BookLevel[];
  side: "bid" | "ask";
  market: Orderbook;
  changes: Map<string, LevelChange>;
}) => (
  <div className="flex-1 overflow-x-auto">
    <table className="table table-xs w-full">
      <thead>
        <tr>
          <th className="px-2">{side === "bid" ? "Bid" : "Ask"}</th>
          <th className="px-2 text-right">Size</th>
          <th className="px-2 text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {levels.length === 0 ? (
          <tr>
            <td colSpan={3} className="px-2 py-4 text-center text-xs opacity-60">
              No {side}s resting
            </td>
          </tr>
        ) : (
          levels.map(level => (
            <LadderRow
              key={`${side}-${level.price}`}
              level={level}
              side={side}
              market={market}
              change={changes.get(`${side}-${level.price}`)}
            />
          ))
        )}
      </tbody>
    </table>
  </div>
);

export const SpreadReadout = ({ depth, market }: { depth: NormalizedDepth; market: Orderbook }) => {
  if (depth.bestBid === null || depth.bestAsk === null) {
    return <span className="text-sm opacity-60">No two-sided market</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>
        <span className="opacity-60">Spread </span>
        <span className="font-mono">{atStep(depth.spread ?? "0", market.tickStep)}</span>
      </span>
      <span>
        <span className="opacity-60">Mid </span>
        <span className="font-mono">{atStep(depth.mid ?? "0", market.tickStep)}</span>
      </span>
      {depth.spreadPercent !== null && (
        <span className={`font-mono ${depth.isCrossed ? "text-error" : "opacity-60"}`}>
          {Number(depth.spreadPercent).toFixed(4)}%
        </span>
      )}
      {depth.isCrossed && <CrossedBadge />}
    </div>
  );
};

export const DepthLadder = ({
  depth,
  market,
  changes = new Map(),
}: {
  depth: NormalizedDepth;
  market: Orderbook;
  changes?: Map<string, LevelChange>;
}) => {
  if (depth.isEmpty) {
    return (
      <div className="rounded-box bg-base-200 p-8 text-center">
        <p className="font-medium">This book is empty</p>
        <p className="mt-1 text-sm opacity-70">
          No orders are resting on either side right now. Depth appears here as soon as someone quotes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <SideTable levels={depth.bids} side="bid" market={market} changes={changes} />
      <SideTable levels={depth.asks} side="ask" market={market} changes={changes} />
    </div>
  );
};
