"use client";

import { useState } from "react";
import Link from "next/link";
import { SignInButton } from "./SignInButton";
import { WalletGate } from "./WalletGate";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { useOnboarding } from "~~/hooks/clob/useOnboarding";
import { usePlaceOrder } from "~~/hooks/clob/usePlaceOrder";
import { formatUnits, notional, parseDecimal, pipsToPercentLabel, validateOrder } from "~~/lib/clob/format";
import { OrderSide, spendingToken } from "~~/lib/clob/orders";
import { Orderbook, marketState } from "~~/lib/clob/types";
import { hashscan } from "~~/lib/mirror/client";

/** Balance of the token this side spends, read from the mirror node. */
const useSpendableBalance = (market: Orderbook, side: OrderSide) => {
  const { address } = useAccount();
  const { mirror, network } = useClobNetwork();
  const token = spendingToken(side, market);

  return useQuery({
    queryKey: ["mirror", network, "balance", address, token.tokenId],
    enabled: Boolean(address),
    queryFn: async ({ signal }) => {
      if (!address) return null;
      const balances = await mirror.getTokenBalances(address, [token.tokenId], signal);
      return balances[0]?.balance ?? "0";
    },
    refetchInterval: 20_000,
  });
};

export const OrderEntry = ({ market }: { market: Orderbook }) => {
  const { config } = useClobNetwork();
  const { data: onboarding } = useOnboarding(market);
  const { place, stage, error, result, reset } = usePlaceOrder(market);
  const links = hashscan(config);

  const [side, setSide] = useState<OrderSide>("SELL");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [makerOnly, setMakerOnly] = useState(true);
  const [useAmm, setUseAmm] = useState(false);

  const { data: balance } = useSpendableBalance(market, side);
  const token = spendingToken(side, market);

  const tradeable = marketState(market) === "OPEN";
  const ready = onboarding?.complete ?? false;
  const filled = price !== "" && size !== "";

  const rules = {
    tickStep: market.tickStep,
    sizeStep: market.sizeStep,
    lotSize: market.lotSize,
    minNotional: market.minNotional,
    baseTokenDecimals: market.baseTokenDecimals,
    quoteTokenDecimals: market.quoteTokenDecimals,
  };

  // Two checks, because they answer different questions. The shape check asks whether
  // this is a well-formed order, which is what the totals below are arithmetic on; the
  // full check adds whether the venue would accept it right now. A halted market should
  // still tell you what the order would cost.
  const shapeValidation = filled ? validateOrder({ price, size }, rules) : null;
  const validation = filled
    ? validateOrder({ price, size }, { ...rules, status: market.status, isMarketHalted: market.isMarketHalted })
    : null;

  // The balance check uses the token this side actually spends, not the base token.
  let balanceError: string | null = null;
  if (filled && validation?.ok && balance !== null && balance !== undefined) {
    try {
      const needed =
        side === "SELL"
          ? parseDecimal(size, market.baseTokenDecimals)
          : parseDecimal(
              notional(price, size, market.baseTokenDecimals, market.quoteTokenDecimals),
              market.quoteTokenDecimals,
            );
      if (BigInt(balance) < needed) {
        balanceError = `You hold ${formatUnits(BigInt(balance), token.decimals)} ${token.symbol}, this order spends ${formatUnits(needed, token.decimals)}.`;
      }
    } catch {
      balanceError = null;
    }
  }

  const blocked = !tradeable || !ready || !filled || !validation?.ok || Boolean(balanceError);
  const busy = ["building", "signing", "journalling", "saving"].includes(stage);

  const stageLabel: Record<string, string> = {
    building: "building the order…",
    signing: "sign in your wallet…",
    journalling: "writing to the journal…",
    saving: "submitting…",
  };

  return (
    <div className="rounded-box bg-base-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Place an order</h2>
        <SignInButton compact />
      </div>

      <WalletGate needsSignIn showConnectButton action="place an order">
        <>
          <div className="mt-3 join w-full">
            {(["BUY", "SELL"] as const).map(option => (
              <button
                key={option}
                type="button"
                className={`btn btn-sm join-item flex-1 ${side === option ? (option === "BUY" ? "btn-success" : "btn-error") : "btn-ghost"}`}
                onClick={() => {
                  setSide(option);
                  reset();
                }}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="mt-3 space-y-2">
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="opacity-60">Price ({market.quoteTokenSymbol})</span>
              <input
                className="input input-sm input-bordered w-40 font-mono"
                value={price}
                placeholder={market.quotePrice ?? "0.00"}
                onChange={event => setPrice(event.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span className="opacity-60">Size ({market.baseTokenSymbol})</span>
              <input
                className="input input-sm input-bordered w-40 font-mono"
                value={size}
                placeholder={formatUnits(BigInt(market.lotSize.split(".")[0] || "0"), market.baseTokenDecimals)}
                onChange={event => setSize(event.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
              />
            </label>

            <div className="flex flex-wrap gap-3 pt-1 text-xs">
              <label
                className="flex cursor-pointer items-center gap-1"
                title="Post-only: never take liquidity, so the order always earns the maker fee"
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={makerOnly}
                  onChange={e => setMakerOnly(e.target.checked)}
                />
                <span className="opacity-70">post-only</span>
              </label>
              {market.isAMMEnabled === 1 && (
                <label
                  className="flex cursor-pointer items-center gap-1"
                  title="Allow this order to settle against SaucerSwap's AMM pool as well as resting orders"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-xs"
                    checked={useAmm}
                    onChange={e => setUseAmm(e.target.checked)}
                  />
                  <span className="opacity-70">allow AMM settlement</span>
                </label>
              )}
            </div>
          </div>

          {filled && shapeValidation?.ok && (
            <dl className="mt-3 space-y-1 border-t border-base-300 pt-3 text-xs">
              <div className="flex justify-between">
                <dt className="opacity-60">Total</dt>
                <dd className="font-mono">
                  {notional(price, size, market.baseTokenDecimals, market.quoteTokenDecimals)} {market.quoteTokenSymbol}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="opacity-60">{makerOnly ? "Maker fee" : "Taker fee"}</dt>
                <dd className="font-mono">
                  {pipsToPercentLabel(makerOnly ? market.makerFeePips : market.takerFeePips)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="opacity-60">You spend</dt>
                <dd className="font-mono">
                  {side === "SELL" ? size : notional(price, size, market.baseTokenDecimals, market.quoteTokenDecimals)}{" "}
                  {token.symbol}
                </dd>
              </div>
            </dl>
          )}

          {/* Validation runs before any signature is requested, and names the rule that failed. */}
          {validation && !validation.ok && <p className="mt-2 text-xs text-warning">{validation.message}</p>}
          {balanceError && <p className="mt-2 text-xs text-warning">{balanceError}</p>}

          {!ready && <p className="mt-3 text-xs opacity-60">Finish the ready-to-trade checklist above first.</p>}
          {/* Only when the warning above has not already said it, which it does as soon
              as a price and size are entered. */}
          {!tradeable && !(validation && !validation.ok && validation.rule === "market") && (
            <p className="mt-3 text-xs opacity-60">
              This market is {marketState(market).toLowerCase()}, so the venue will reject new orders.
            </p>
          )}

          <button
            type="button"
            className="btn btn-primary btn-sm mt-3 w-full"
            disabled={blocked || busy}
            onClick={() => place(side, price, size, { makerOnly, isAMMEnabled: useAmm })}
          >
            {busy ? stageLabel[stage] : `${side === "BUY" ? "Buy" : "Sell"} ${market.baseTokenSymbol}`}
          </button>

          {result && (
            <div className="mt-3 rounded-box bg-success/15 p-3 text-xs">
              <p className="font-medium">Order {result.orderId} is live.</p>
              {result.orderHash && <p className="mt-1 font-mono opacity-70">{result.orderHash.slice(0, 18)}…</p>}
              <p className="mt-1">
                <Link href="/orders" className="link">
                  see it in your orders
                </Link>
                {" · "}
                <Link href="/journal" className="link">
                  its intent in the journal
                </Link>
              </p>
              {result.journalPending && (
                <p className="mt-1 text-warning">
                  The journal write failed, so this order has no on-ledger intent record yet. The order itself is fine.
                </p>
              )}
            </div>
          )}

          {error && <p className="mt-3 text-xs text-error">{error}</p>}
        </>
      </WalletGate>

      <p className="mt-3 text-xs opacity-60">
        Orders settle through the reactor contract on Hedera:{" "}
        <a className="link" href={links.contract(config.reactor)} target="_blank" rel="noreferrer">
          {config.reactor.slice(0, 10)}…
        </a>
        . Your funds stay in your wallet until a fill settles.
      </p>
    </div>
  );
};
