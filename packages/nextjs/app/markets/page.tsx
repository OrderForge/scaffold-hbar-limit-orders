"use client";

import Link from "next/link";
import { AmmBadge, LiveIndicator, MarketStateBadge } from "~~/components/clob/MarketBadges";
import { NetworkToggle } from "~~/components/clob/NetworkToggle";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { useBooks, useIsTabVisible } from "~~/hooks/clob/useMarketData";
import { PublicReadUnavailableError } from "~~/lib/clob/errors";
import { formatPercent, formatSmallestUnits, formatWithGrouping, pipsToPercentLabel } from "~~/lib/clob/format";
import { Orderbook, marketLabel } from "~~/lib/clob/types";
import { hashscan } from "~~/lib/mirror/client";

const numberOrDash = (value: string | null | undefined, digits = 2) => {
  if (value === null || value === undefined || value === "") return "—";
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return "—";
  return formatWithGrouping(asNumber.toFixed(digits));
};

const MarketRow = ({ book }: { book: Orderbook }) => {
  const { config } = useClobNetwork();
  const links = hashscan(config);

  return (
    <tr className="hover">
      <td>
        <Link href={`/market/${book.id}`} className="link font-medium">
          {marketLabel(book)}
        </Link>
        {/* Symbols repeat across different markets, so the id is the real identity. */}
        <span className="ml-2 text-xs opacity-50">#{book.id}</span>
      </td>
      <td className="whitespace-nowrap">
        <div className="flex gap-1">
          <MarketStateBadge book={book} />
          <AmmBadge book={book} />
        </div>
      </td>
      <td className="text-right font-mono text-sm">{numberOrDash(book.quotePrice, 7)}</td>
      <td className="text-right font-mono text-sm">{formatPercent(book.quotePrice24hPct)}</td>
      <td className="text-right font-mono text-sm">{numberOrDash(book.quoteVol24h)}</td>
      <td className="text-right font-mono text-xs">
        {pipsToPercentLabel(book.makerFeePips)} / {pipsToPercentLabel(book.takerFeePips)}
      </td>
      <td className="text-right font-mono text-xs opacity-70">{book.tickStep}</td>
      <td className="text-right font-mono text-xs opacity-70">
        {formatSmallestUnits(book.minNotional, book.quoteTokenDecimals)} {book.quoteTokenSymbol}
      </td>
      <td className="text-right text-xs">
        <a className="link" href={links.token(book.baseTokenId)} target="_blank" rel="noreferrer">
          {book.baseTokenId}
        </a>
      </td>
    </tr>
  );
};

const Markets = () => {
  const { data: books, error, isLoading } = useBooks();
  const { network } = useClobNetwork();
  const visible = useIsTabVisible();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Markets</h1>
          <p className="text-sm opacity-70">
            Live order books from SaucerSwap&apos;s V3 API. No wallet, no API key, no deployed contract.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator live={visible} loading={isLoading} />
          <NetworkToggle />
        </div>
      </div>

      {error instanceof PublicReadUnavailableError && (
        <div className="alert alert-warning">
          <span>
            {network} still requires a JWT for market data. Keyless reads are rolling out network by network — connect a
            wallet, or switch networks above.
          </span>
        </div>
      )}

      {error && !(error instanceof PublicReadUnavailableError) && (
        <div className="alert alert-error">
          <span>Could not load markets: {(error as Error).message}</span>
        </div>
      )}

      {books && books.length === 0 && <p className="p-12 text-center opacity-70">This network lists no markets.</p>}

      {(isLoading || (books && books.length > 0)) && (
        <div className="overflow-x-auto rounded-box bg-base-100">
          <table className="table">
            <thead>
              <tr>
                <th>Market</th>
                <th>State</th>
                <th className="text-right">Price</th>
                <th className="text-right">24h</th>
                <th className="text-right">24h volume</th>
                <th className="text-right">Fee m/t</th>
                <th className="text-right">Tick</th>
                <th className="text-right">Min notional</th>
                <th className="text-right">Base token</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center">
                    <span className="loading loading-spinner loading-md" />
                  </td>
                </tr>
              ) : (
                books?.map(book => <MarketRow key={book.id} book={book} />)
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs opacity-60">
        Fees are quoted in pips (1 pip = 0.0001%), shown here as percentages. Several markets share a display symbol, so
        every link and request uses the market id.
      </p>
    </div>
  );
};

export default Markets;
