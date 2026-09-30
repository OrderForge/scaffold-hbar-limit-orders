"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { getJournalNetwork, getNetworkConfig } from "~~/lib/clob/config";
import { orderAmounts } from "~~/lib/clob/orders";
import { AccountOrder, OrderEvent, Orderbook } from "~~/lib/clob/types";
import { JournalEntry, listIntents } from "~~/lib/journal";
import {
  Fill,
  FillVerification,
  SignedOrderReference,
  decodeFills,
  fillsForOrder,
  verifyFills,
} from "~~/lib/verify/fills";

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

/**
 * Every fill of an order, checked on-chain against what was signed.
 *
 * Shared by the order history and the order ticket's progress, so the two can never
 * disagree about whether a fill passed.
 */
export const useFillVerification = (order: AccountOrder | undefined, market: Orderbook, events: OrderEvent[]) => {
  const { config, mirror, network } = useClobNetwork();
  const { address } = useAccount();

  // One settlement can appear under more than one event; read each transaction once.
  const settlements = events
    .filter(event => Boolean(event.txHash))
    .filter((event, index, all) => all.findIndex(other => other.txHash === event.txHash) === index);

  const { data: journal } = useQuery({
    queryKey: ["journal", network, "for-order", order?.nonce],
    queryFn: ({ signal }) => listIntents(getNetworkConfig(getJournalNetwork()), { signal }),
    staleTime: 30_000,
    // A journal message reaches the mirror node a few seconds after it is written, so an
    // order opened straight after placing can be checked before its record is readable.
    // Keep looking for a minute rather than settle for checking the venue against itself.
    refetchInterval: query => {
      const found = query.state.data?.some(entry => String(entry.intent.nonce) === String(order?.nonce));
      const young = Date.now() - new Date(order?.createdAt ?? 0).getTime() < 60_000 * 5;
      return found || !young ? false : 5_000;
    },
  });

  const { data: verifications, isLoading } = useQuery<FillVerification[]>({
    queryKey: [
      "verify",
      network,
      address,
      order?.id,
      settlements.map(event => event.txHash).join(","),
      journal?.length ?? 0,
    ],
    enabled: Boolean(order) && settlements.length > 0,
    queryFn: async ({ signal }) => {
      // Whose fills to look for: the signed-in account, which is the account these orders
      // belong to, or the journal's record of who signed.
      const swapper = address ?? "";
      if (!order) return [];
      const built = referenceFrom(order, market, journal, swapper);
      if (!built || !swapper) return [];

      const fills: { fill: Fill; filledAt?: Date }[] = [];
      for (const event of settlements) {
        const result = await mirror.getContractResult(event.txHash as string, signal);
        if (!result) continue;
        // Only this order's fills: the transaction also settles the other side, and often
        // other matches entirely.
        const mine = fillsForOrder(decodeFills(result.logs ?? [], config.reactor), {
          swapper,
          nonce: order?.nonce ?? undefined,
        });
        for (const fill of mine) {
          fills.push({
            fill: { ...fill, transactionHash: event.txHash ?? undefined },
            filledAt: new Date(event.timestamp),
          });
        }
      }

      return verifyFills(built.reference, fills);
    },
  });

  const source = order ? referenceFrom(order, market, journal, address ?? "")?.source : undefined;

  return { verifications, isLoading, source, settlements };
};
