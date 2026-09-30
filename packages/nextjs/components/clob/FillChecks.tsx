"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { CheckCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { getJournalNetwork, getNetworkConfig } from "~~/lib/clob/config";
import { orderAmounts } from "~~/lib/clob/orders";
import { AccountOrder, OrderEvent, Orderbook } from "~~/lib/clob/types";
import { JournalEntry, listIntents } from "~~/lib/journal";
import { hashscan } from "~~/lib/mirror/client";
import { FillVerification, SignedOrderReference, decodeFills, fillsForOrder, verifyFills } from "~~/lib/verify/fills";

/**
 * Rebuild what the user signed.
 *
 * Preferred source is the HCS journal: it was written before the order was submitted, so
 * it is the user's own record rather than the venue's. Falling back to the venue's copy is
 * still useful, but it checks the venue against itself, so the UI says which was used.
 */
const referenceFrom = (
  order: AccountOrder,
  market: Orderbook,
  journal: JournalEntry[] | undefined,
  swapper: string,
): { reference: SignedOrderReference; source: "journal" | "venue" } | null => {
  const fromJournal = journal?.find(
    entry => entry.intent.nonce !== undefined && String(entry.intent.nonce) === String(order.nonce),
  );

  const side = (fromJournal?.intent.side ?? order.direction?.toUpperCase()) === "BUY" ? "BUY" : "SELL";
  const price = fromJournal?.intent.price ?? order.price;
  const size = fromJournal?.intent.size ?? order.amount;
  if (!price || !size) return null;

  try {
    const amounts = orderAmounts(side, price, size, market);
    return {
      reference: {
        swapper,
        inputAmount: BigInt(amounts.inputAmount),
        outputAmount: BigInt(amounts.outputAmount),
        recipient: "",
        deadline: BigInt(order.deadline ?? 0),
        maxTakerFeePips: market.takerFeePips,
        maxMakerFeePips: market.makerFeePips,
      },
      source: fromJournal ? "journal" : "venue",
    };
  } catch {
    return null;
  }
};

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
  const { config, mirror, network } = useClobNetwork();
  const { address } = useAccount();
  const links = hashscan(config);

  // One settlement can appear under more than one event; read each transaction once.
  const settlements = events
    .filter(event => Boolean(event.txHash))
    .filter((event, index, all) => all.findIndex(other => other.txHash === event.txHash) === index);

  const { data: journal } = useQuery({
    queryKey: ["journal", network, "for-order", order.nonce],
    queryFn: ({ signal }) => listIntents(getNetworkConfig(getJournalNetwork()), { signal }),
    staleTime: 30_000,
    // A journal message reaches the mirror node a few seconds after it is written, so an
    // order opened straight after placing can be checked before its record is readable.
    // Keep looking for a minute rather than settle for checking the venue against itself.
    refetchInterval: query => {
      const found = query.state.data?.some(entry => String(entry.intent.nonce) === String(order.nonce));
      const young = Date.now() - new Date(order.createdAt ?? 0).getTime() < 60_000 * 5;
      return found || !young ? false : 5_000;
    },
  });

  const { data: verifications, isLoading } = useQuery<FillVerification[]>({
    queryKey: [
      "verify",
      network,
      address,
      order.id,
      settlements.map(event => event.txHash).join(","),
      journal?.length ?? 0,
    ],
    enabled: settlements.length > 0,
    queryFn: async ({ signal }) => {
      // Whose fills to look for: the signed-in account, which is the account these orders
      // belong to, or the journal's record of who signed.
      const swapper = address ?? "";
      const built = referenceFrom(order, market, journal, swapper);
      if (!built || !swapper) return [];

      const fills: { fill: any; filledAt?: Date }[] = [];
      for (const event of settlements) {
        const result = await mirror.getContractResult(event.txHash as string, signal);
        if (!result) continue;
        // Only this order's fills: the transaction also settles the other side, and often
        // other matches entirely.
        const mine = fillsForOrder(decodeFills(result.logs ?? [], config.reactor), {
          swapper,
          nonce: order.nonce ?? undefined,
        });
        for (const fill of mine) {
          fills.push({ fill: { ...fill, transactionHash: event.txHash }, filledAt: new Date(event.timestamp) });
        }
      }

      return verifyFills(built.reference, fills);
    },
  });

  if (settlements.length === 0) {
    return (
      <p className="mt-6 text-xs opacity-60">
        No fills yet. Once this order fills, each fill is checked here against the terms you signed.
      </p>
    );
  }

  const source = referenceFrom(order, market, journal, address ?? "")?.source;

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
