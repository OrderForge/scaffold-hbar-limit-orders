"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AccountPanel } from "~~/components/clob/AccountPanel";
import { DepthLadder, SpreadReadout } from "~~/components/clob/DepthLadder";
import { DryRunSign } from "~~/components/clob/DryRunSign";
import { AmmBadge, LiveIndicator, MarketStateBadge } from "~~/components/clob/MarketBadges";
import { NetworkToggle, SwitchToMainnetHint } from "~~/components/clob/NetworkToggle";
import { OnboardingChecklist } from "~~/components/clob/OnboardingChecklist";
import { OrderEntry } from "~~/components/clob/OrderEntry";
import { TradeTape } from "~~/components/clob/TradeTape";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { useChangedLevels, useSecondsSince } from "~~/hooks/clob/useFreshness";
import { useLiveDepth } from "~~/hooks/clob/useLiveDepth";
import { LiveDepth } from "~~/hooks/clob/useLiveDepth";
import { useBook, useIsTabVisible, useTrades } from "~~/hooks/clob/useMarketData";
import { PublicReadUnavailableError } from "~~/lib/clob/errors";
import { formatPercent, formatSmallestUnits, pipsToPercentLabel } from "~~/lib/clob/format";
import { Orderbook, marketLabel, marketState } from "~~/lib/clob/types";
import { hashscan } from "~~/lib/mirror/client";

const MetadataPanel = ({ book }: { book: Orderbook }) => {
  const { config } = useClobNetwork();
  const links = hashscan(config);

  const rows: [string, React.ReactNode][] = [
    ["Market id", book.id],
    ["Tick size", book.tickStep],
    ["Size step", book.sizeStep],
    ["Lot size", `${formatSmallestUnits(book.lotSize, book.baseTokenDecimals)} ${book.baseTokenSymbol ?? ""}`],
    [
      "Min notional",
      `${formatSmallestUnits(book.minNotional, book.quoteTokenDecimals)} ${book.quoteTokenSymbol ?? ""}`,
    ],
    ["Maker fee", pipsToPercentLabel(book.makerFeePips)],
    ["Taker fee", pipsToPercentLabel(book.takerFeePips)],
    [
      "Base token",
      <a key="base" className="link" href={links.token(book.baseTokenId)} target="_blank" rel="noreferrer">
        {book.baseTokenId} ({book.baseTokenDecimals} dp)
      </a>,
    ],
    [
      "Quote token",
      <a key="quote" className="link" href={links.token(book.quoteTokenId)} target="_blank" rel="noreferrer">
        {book.quoteTokenId} ({book.quoteTokenDecimals} dp)
      </a>,
    ],
    ["AMM routing", book.isAMMEnabled === 1 ? "On" : "Off"],
    ["24h high / low", `${book.quotePrice24hHigh ?? "—"} / ${book.quotePrice24hLow ?? "—"}`],
    ["24h volume (quote)", book.quoteVol24h ?? "—"],
    ["Last updated", book.updatedAt ? new Date(book.updatedAt).toLocaleString() : "—"],
  ];

  return (
    <div className="rounded-box bg-base-100 p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">Market rules</h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="opacity-60">{label}</dt>
            <dd className="text-right font-mono text-xs">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs opacity-60">
        Orders must sit on the tick grid, be a whole number of lots, and clear the minimum notional. The template checks
        all three before asking for a signature.
      </p>
      {book.isAMMEnabled === 1 && (
        <p className="mt-2 text-xs opacity-60">
          <span className="font-medium">AMM routing is on.</span> SaucerSwap blends liquidity from its AMM pool into
          this book, so the depth above mixes resting limit orders with pool quotes, and an order can settle against
          either. It is also the likely reason a book can appear crossed. Orders may opt out of AMM settlement
          individually.
        </p>
      )}
    </div>
  );
};

/**
 * How fresh the data is, and the book's own sequence number.
 *
 * A thin market can hold the same best bid and ask for minutes. Without these, a working
 * feed looks frozen — the sequence number advances even when no price moves.
 */
const Freshness = ({
  updatedAt,
  live,
  sequence,
  source,
}: {
  updatedAt?: number;
  live: boolean;
  sequence?: number;
  /** Whether depth is streaming or polling, and why. */
  source?: LiveDepth;
}) => {
  const age = useSecondsSince(updatedAt);
  return (
    <div className="flex items-center gap-2 text-xs">
      <LiveIndicator
        live={live}
        loading={updatedAt === undefined}
        label={age === null ? "live" : `updated ${age.toFixed(1)}s ago`}
      />
      {source && (
        <span
          className={`badge badge-sm ${source.source === "stream" ? "badge-success" : "badge-ghost"}`}
          title={
            source.source === "stream"
              ? `Live WebSocket. ${source.stream?.applied ?? 0} diffs applied${
                  source.stream?.resyncs ? `, ${source.stream.resyncs} re-sync(s)` : ""
                }.`
              : source.stream?.status === "failed"
                ? "The stream dropped, so the page fell back to polling."
                : "Both SaucerSwap streams need a signed-in wallet, so this polls instead."
          }
        >
          {source.source === "stream" ? "streaming" : "polling"}
        </span>
      )}
      {sequence !== undefined && (
        <span
          className="font-mono opacity-50"
          title="The book's update sequence. It advances whenever the book changes, even if no price moves."
        >
          seq {sequence}
        </span>
      )}
    </div>
  );
};

const MarketPage = () => {
  const params = useParams<{ id: string }>();
  const orderbookId = String(params?.id ?? "");
  const { network } = useClobNetwork();
  const visible = useIsTabVisible();

  const { data: book, isLoading: bookLoading, error: bookError } = useBook(orderbookId);
  const tradeable = book ? marketState(book) !== "CLOSED" : false;
  const live = useLiveDepth(orderbookId, Boolean(book) && tradeable);
  const { data: trades } = useTrades(orderbookId, 25, Boolean(book) && tradeable);
  const changes = useChangedLevels(live.depth);

  if (bookLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold">Market {orderbookId}</h1>
        <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-4">
            <div className="rounded-box bg-base-100 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Order book</h2>
              <div className="flex justify-center p-12">
                <span className="loading loading-spinner loading-lg" />
              </div>
            </div>
            <div className="rounded-box bg-base-100 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Recent trades</h2>
            </div>
          </div>
          <div className="rounded-box bg-base-100 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Market rules</h2>
            <p className="mt-2 text-xs opacity-60">
              Tick size, lot size and the minimum notional load with the market.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (bookError instanceof PublicReadUnavailableError) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="alert alert-warning">
          <span>{network} requires a JWT for market data right now. Switch networks or connect a wallet.</span>
        </div>
        <div className="mt-4">
          <NetworkToggle />
        </div>
      </div>
    );
  }

  if (book === null) {
    return (
      <div className="mx-auto max-w-2xl p-16 text-center">
        <h1 className="text-2xl font-bold">Market not found</h1>
        <p className="mt-2 opacity-70">
          No market with id <span className="font-mono">{orderbookId}</span> exists on {network}.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/markets" className="btn btn-primary btn-sm">
            Back to markets
          </Link>
          <NetworkToggle />
        </div>
      </div>
    );
  }

  if (!book) return null;

  const state = marketState(book);
  const depth = live.depth;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{marketLabel(book)}</h1>
            <span className="text-sm opacity-50">#{book.id}</span>
            <MarketStateBadge book={book} />
            <AmmBadge book={book} />
          </div>
          <p className="mt-1 text-sm opacity-70">
            Last price <span className="font-mono">{book.quotePrice ?? "—"}</span> · 24h{" "}
            {formatPercent(book.quotePrice24hPct)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Freshness updatedAt={live.updatedAt} live={visible} sequence={depth?.lastUpdateId} source={live} />
          <NetworkToggle />
        </div>
      </div>

      {state === "HALTED" && (
        <div className="alert alert-warning mb-4">
          <span>
            Trading is halted on this market. Orders can still be built, but the API rejects them at submission — so the
            template blocks signing until the halt clears.
          </span>
        </div>
      )}

      {state === "CLOSED" && (
        <div className="alert mb-4">
          <span>This market is closed. It serves no depth, and order entry is disabled.</span>
        </div>
      )}

      {live.stream?.status === "failed" && (
        <div className="alert mb-4">
          <span>
            The live depth stream dropped, so this page is polling instead. Nothing is lost — the book is still current,
            just refreshed rather than streamed.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="rounded-box bg-base-100 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Order book</h2>
              {depth && <SpreadReadout depth={depth} market={book} />}
            </div>

            {depth ? (
              <DepthLadder depth={depth} market={book} changes={changes} />
            ) : (
              <p className="p-8 text-center text-sm opacity-60">
                {state === "CLOSED" ? "Closed markets serve no depth." : "Loading depth…"}
              </p>
            )}

            {depth?.isCrossed && (
              <p className="mt-3 text-xs opacity-70">
                The best bid is at or above the best ask. This happens when AMM liquidity is blended into the book, or
                when data is stale. It is shown rather than hidden, because an order placed into a crossed book behaves
                differently from one placed into a normal spread.
              </p>
            )}
          </div>

          <div className="rounded-box bg-base-100 p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide opacity-70">Recent trades</h2>
            <TradeTape trades={trades ?? []} market={book} />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <OnboardingChecklist market={book} />
          <OrderEntry market={book} />
          <AccountPanel market={book} />
          <DryRunSign market={book} />
          <MetadataPanel book={book} />
        </div>
      </div>

      {(depth?.isEmpty || state !== "OPEN") && (
        <SwitchToMainnetHint
          reason={
            state === "OPEN"
              ? "This market has no resting orders."
              : `This market is ${state.toLowerCase()} on ${network}.`
          }
        />
      )}
    </div>
  );
};

export default MarketPage;
