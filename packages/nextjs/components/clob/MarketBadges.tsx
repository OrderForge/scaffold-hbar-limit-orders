"use client";

import { Orderbook, marketState } from "~~/lib/clob/types";

/**
 * OPEN / HALTED / CLOSED as a visible state.
 *
 * A halted market still reports `status: "OPEN"` and only sets `isMarketHalted`, so
 * reading `status` alone would show a market as tradeable when it is not.
 */
export const MarketStateBadge = ({ book }: { book: Pick<Orderbook, "status" | "isMarketHalted"> }) => {
  const state = marketState(book);
  const className = state === "OPEN" ? "badge-success" : state === "HALTED" ? "badge-warning" : "badge-ghost";
  return <span className={`badge badge-sm ${className}`}>{state}</span>;
};

/** AMM liquidity is routed into this book, which is one cause of a crossed book. */
export const AmmBadge = ({ book }: { book: Pick<Orderbook, "isAMMEnabled"> }) =>
  book.isAMMEnabled === 1 ? (
    <span className="badge badge-sm badge-outline" title="AMM liquidity is routed into this book">
      AMM
    </span>
  ) : null;

/**
 * A crossed book — best bid at or above best ask — is real and was observed live on
 * testnet. It is shown as its own state so nobody reads a negative spread as a glitch.
 */
export const CrossedBadge = ({ className = "" }: { className?: string }) => (
  <span
    className={`badge badge-sm badge-error ${className}`}
    title="The best bid is at or above the best ask. Usually AMM liquidity blended into the book, or stale data."
  >
    CROSSED
  </span>
);

/**
 * Shows that data is arriving, and that polling pauses when the tab is hidden.
 *
 * Loading and paused are different states: saying "paused" while the first request is still
 * in flight tells the reader the feed is off when it is simply not back yet.
 */
export const LiveIndicator = ({
  live,
  label = "live",
  loading = false,
}: {
  live: boolean;
  label?: string;
  loading?: boolean;
}) => (
  <span className="inline-flex items-center gap-1.5 text-xs opacity-70">
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        loading ? "animate-pulse bg-warning" : live ? "bg-success animate-pulse-fast" : "bg-base-300"
      }`}
    />
    {loading ? "loading" : live ? label : "paused"}
  </span>
);
