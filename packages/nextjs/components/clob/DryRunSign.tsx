"use client";

import { useState } from "react";
import Link from "next/link";
import { WalletGate } from "./WalletGate";
import { useAccount, useSignTypedData } from "wagmi";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { useHederaAccount } from "~~/hooks/clob/useOnboarding";
import { notional, parseDecimal, validateOrder } from "~~/lib/clob/format";
import { Orderbook, marketLabel, marketState } from "~~/lib/clob/types";
import { buildIntent, submitIntent } from "~~/lib/journal";
import { hashscan } from "~~/lib/mirror/client";

/**
 * The EIP-712 order type, read from the reactor's verified source. SaucerSwap's docs never
 * publish it; the server accepted an order signed from exactly this in testing.
 */
const ORDER_TYPES = {
  PartialFillLimitOrder: [
    { name: "info", type: "OrderInfo" },
    { name: "input", type: "PartialFillInputToken" },
    { name: "output", type: "OutputToken" },
    { name: "makerOnly", type: "bool" },
    { name: "takerOnce", type: "bool" },
    { name: "maxTakerFeePips", type: "uint32" },
    { name: "maxMakerFeePips", type: "uint32" },
  ],
  OrderInfo: [
    { name: "reactor", type: "address" },
    { name: "swapper", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "additionalValidationContract", type: "address" },
    { name: "additionalValidationData", type: "bytes" },
  ],
  PartialFillInputToken: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  OutputToken: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

/**
 * Sign an order intent without submitting it.
 *
 * Order placement arrives in a later increment; this exercises the part that matters most
 * — validate, sign, journal — end to end today, and produces a real HCS record. Nothing is
 * sent to SaucerSwap, and the order is marked as a dry run in the journal so the record
 * can never be mistaken for a live order.
 */
export const DryRunSign = ({ market }: { market: Orderbook }) => {
  const { address } = useAccount();
  const { config, client } = useClobNetwork();
  const { data: hederaAccount } = useHederaAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const links = hashscan(config);

  const [side, setSide] = useState<"BUY" | "SELL">("SELL");
  const [price, setPrice] = useState("1");
  const [size, setSize] = useState("10");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ topicId: string; sequenceNumber: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validation = validateOrder(
    { price, size },
    {
      tickStep: market.tickStep,
      sizeStep: market.sizeStep,
      lotSize: market.lotSize,
      minNotional: market.minNotional,
      baseTokenDecimals: market.baseTokenDecimals,
      quoteTokenDecimals: market.quoteTokenDecimals,
      status: market.status,
      isMarketHalted: market.isMarketHalted,
    },
  );

  const run = async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const domain = await client.getSignatureDomain();

      // A sell sends base and receives quote; a buy is the mirror image.
      const baseUnits = parseDecimal(size, market.baseTokenDecimals);
      const quoteUnits = parseDecimal(
        notional(price, size, market.baseTokenDecimals, market.quoteTokenDecimals),
        market.quoteTokenDecimals,
      );
      const input =
        side === "SELL"
          ? { token: market.baseTokenEvmAddress as `0x${string}`, amount: baseUnits }
          : { token: market.quoteTokenEvmAddress as `0x${string}`, amount: quoteUnits };
      const output =
        side === "SELL"
          ? { token: market.quoteTokenEvmAddress as `0x${string}`, amount: quoteUnits, recipient: address }
          : { token: market.baseTokenEvmAddress as `0x${string}`, amount: baseUnits, recipient: address };

      const message = {
        info: {
          reactor: domain.verifyingContract as `0x${string}`,
          swapper: address,
          // A real order takes its nonce from POST /orders/build. This is a dry run, so it
          // is marked as such and never submitted.
          nonce: 0n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
          additionalValidationContract: "0x0000000000000000000000000000000000000000" as `0x${string}`,
          additionalValidationData: "0x" as `0x${string}`,
        },
        input,
        output,
        makerOnly: true,
        takerOnce: false,
        maxTakerFeePips: market.takerFeePips,
        maxMakerFeePips: market.makerFeePips,
      };

      const signature = await signTypedDataAsync({
        domain: {
          name: domain.name,
          version: domain.version,
          chainId: domain.chainId,
          verifyingContract: domain.verifyingContract as `0x${string}`,
        },
        types: ORDER_TYPES,
        primaryType: "PartialFillLimitOrder",
        message,
      });

      const intent = buildIntent({
        action: "place",
        account: hederaAccount?.accountId ?? address,
        accountEvm: address,
        orderbookId: market.id,
        baseTokenId: market.baseTokenId,
        quoteTokenId: market.quoteTokenId,
        pair: marketLabel(market),
        side,
        price,
        size,
        notional: notional(price, size, market.baseTokenDecimals, market.quoteTokenDecimals),
        // The signature itself is not journalled: the digest is what links an intent to a
        // fill, and publishing a signature would let anyone replay a real order.
        eip712Hash: null,
        submitted: false,
        dryRun: true,
      });

      const submitted = await submitIntent(intent);
      setResult(submitted);
      // Keep the signature out of state and logs entirely.
      void signature;
    } catch (cause) {
      setError((cause as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  };

  const tradeable = marketState(market) === "OPEN";

  return (
    <div className="rounded-box bg-base-100 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Sign an intent (dry run)</h2>
      <p className="mt-1 text-xs opacity-70">
        Signs an order in your wallet and writes it to the HCS journal. Nothing is sent to SaucerSwap, and signing costs
        you nothing — the app&apos;s operator account pays the fraction of a cent each journal message costs.
      </p>

      <WalletGate action="sign an intent">
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <div className="join">
              {(["BUY", "SELL"] as const).map(option => (
                <button
                  key={option}
                  type="button"
                  className={`btn btn-xs join-item ${side === option ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setSide(option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <label className="text-xs">
              <span className="opacity-60">Price</span>
              <input
                className="input input-xs input-bordered ml-1 w-28 font-mono"
                value={price}
                onChange={event => setPrice(event.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
              />
            </label>
            <label className="text-xs">
              <span className="opacity-60">Size</span>
              <input
                className="input input-xs input-bordered ml-1 w-28 font-mono"
                value={size}
                onChange={event => setSize(event.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
              />
            </label>
            <button type="button" className="btn btn-primary btn-xs" disabled={busy || !validation.ok} onClick={run}>
              {busy ? "signing…" : "Sign intent"}
            </button>
          </div>

          {!validation.ok && (
            // Validation runs before any signature is requested, and names the rule that failed.
            <p className="mt-2 text-xs text-warning">{validation.message}</p>
          )}

          {validation.ok && (
            <p className="mt-2 font-mono text-xs opacity-60">
              notional {notional(price, size, market.baseTokenDecimals, market.quoteTokenDecimals)}{" "}
              {market.quoteTokenSymbol}
            </p>
          )}

          {!tradeable && (
            <p className="mt-2 text-xs opacity-60">
              This market is not accepting orders right now, so a real order could not be submitted even if signed.
            </p>
          )}

          {result && (
            <p className="mt-2 text-xs">
              Recorded as message #{result.sequenceNumber} on{" "}
              <a className="link" href={links.topic(result.topicId)} target="_blank" rel="noreferrer">
                topic {result.topicId}
              </a>{" "}
              ·{" "}
              <Link className="link" href="/journal">
                open the journal
              </Link>
            </p>
          )}

          {error && <p className="mt-2 text-xs text-error">{error}</p>}
        </>
      </WalletGate>
    </div>
  );
};
