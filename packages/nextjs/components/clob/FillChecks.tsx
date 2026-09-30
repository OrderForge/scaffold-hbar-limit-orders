"use client";

import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { useFillVerification } from "~~/hooks/clob/useFillVerification";
import { AccountOrder, OrderEvent, Orderbook } from "~~/lib/clob/types";
import { hashscan } from "~~/lib/mirror/client";

const CheckLine = ({ ok, label, detail }: { ok: boolean; label: string; detail: string }) => (
  <li className="flex items-start gap-2">
    {ok ? (
      <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" />
    ) : (
      <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-error" />
    )}
    <span>
      <span className={ok ? "" : "font-medium text-error"}>{label}</span>
      <span className="block font-mono text-[11px] opacity-60">{detail}</span>
    </span>
  </li>
);

/**
 * Check each fill of an order against the terms that were signed.
 *
 * Reads the settlement logs from the mirror node, so the checks rely on consensus data
 * rather than on the venue's report of its own behaviour.
 */
export const FillChecks = ({
  order,
  market,
  events,
}: {
  order: AccountOrder;
  market: Orderbook;
  events: OrderEvent[];
}) => {
  const { config } = useClobNetwork();
  const links = hashscan(config);
  const { verifications, isLoading, source, settlements } = useFillVerification(order, market, events);

  if (settlements.length === 0) {
    return (
      <p className="mt-6 text-xs opacity-60">
        No fills yet. Once this order fills, each fill is checked here against the terms you signed.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Fill verification</h3>
      <p className="mt-1 text-xs opacity-70">
        Each fill is read from Hedera and checked against{" "}
        {source === "journal" ? "the intent you journalled before submitting" : "the order as the venue recorded it"}.
        {source === "venue" && " No journal record matched this order, so this checks the venue against itself."}
      </p>

      {isLoading && <p className="mt-3 text-xs opacity-60">Reading settlements from the mirror node…</p>}

      {!isLoading && verifications && verifications.length === 0 && (
        // Not a pass and not a failure: the settlement was found but holds nothing that
        // identifies as this order, so there is nothing to check yet.
        <p className="mt-3 text-xs opacity-70">
          The settlement transaction was read, but none of its fills carry this account and this order&apos;s nonce. If
          the mirror node has only just seen it, try again in a few seconds.
        </p>
      )}

      {verifications?.map((verification, index) => (
        <div key={index} className="mt-3 rounded-box bg-base-200 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              {verification.fill.kind === "maker" ? "Maker fill" : "Taker fill"}
            </span>
            <span className={`badge badge-sm ${verification.ok ? "badge-success" : "badge-error"}`}>
              {verification.ok ? "verified" : "check failed"}
            </span>
          </div>

          <ul className="mt-2 space-y-1 text-xs">
            {verification.checks.map(check => (
              <CheckLine key={check.id} ok={check.ok} label={check.label} detail={check.detail} />
            ))}
          </ul>

          {verification.fill.transactionHash && (
            <a
              className="link mt-2 inline-block text-xs"
              href={links.transaction(verification.fill.transactionHash)}
              target="_blank"
              rel="noreferrer"
            >
              settlement transaction on HashScan
            </a>
          )}
        </div>
      ))}

      <p className="mt-3 text-xs opacity-60">
        These checks prove no fill broke the terms you signed. They do not prove the venue matched you fairly or
        promptly: matching happens off-chain and cannot be observed from here.
      </p>
    </div>
  );
};
