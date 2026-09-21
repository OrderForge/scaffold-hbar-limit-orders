"use client";

import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { Orderbook, Trade } from "~~/lib/clob/types";
import { hashscan } from "~~/lib/mirror/client";

const timeOf = (timestampMs: number) => new Date(timestampMs).toLocaleTimeString(undefined, { hour12: false });

/**
 * Recent fills.
 *
 * `amountBase` arrives already decimals-adjusted — it is a human-readable amount, not
 * smallest units, unlike everything on the order-building path.
 */
export const TradeTape = ({ trades, market }: { trades: Trade[]; market: Orderbook }) => {
  const { config } = useClobNetwork();
  const links = hashscan(config);

  if (trades.length === 0) {
    return <p className="p-4 text-center text-sm opacity-60">No trades yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="table table-xs w-full">
        <thead>
          <tr>
            <th className="px-2">Time</th>
            <th className="px-2">Price</th>
            <th className="px-2 text-right">Size ({market.baseTokenSymbol ?? "base"})</th>
            <th className="px-2 text-right">Tx</th>
          </tr>
        </thead>
        <tbody>
          {trades.map(trade => (
            <tr key={`${trade.transactionHash}-${trade.timestamp}`}>
              <td className="px-2 font-mono text-xs opacity-70">{timeOf(trade.timestamp)}</td>
              <td className={`px-2 font-mono text-xs ${trade.direction === "buy" ? "text-success" : "text-error"}`}>
                {trade.price}
              </td>
              <td className="px-2 text-right font-mono text-xs">{trade.amountBase}</td>
              <td className="px-2 text-right">
                <a
                  className="link text-xs"
                  href={links.transaction(trade.transactionHash)}
                  target="_blank"
                  rel="noreferrer"
                  title="Settlement transaction on HashScan"
                >
                  {trade.transactionHash.slice(0, 8)}…
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
