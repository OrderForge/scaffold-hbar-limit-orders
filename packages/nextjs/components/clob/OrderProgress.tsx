"use client";

import { CheckCircleIcon, MinusCircleIcon, XCircleIcon } from "@heroicons/react/24/outline";
import { useOrderHistory, useOrders } from "~~/hooks/clob/useAccountData";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { useFillVerification } from "~~/hooks/clob/useFillVerification";
import { PlaceResult, PlaceStage } from "~~/hooks/clob/usePlaceOrder";
import { getJournalNetwork, getNetworkConfig } from "~~/lib/clob/config";
import { StepStatus, orderProgress } from "~~/lib/clob/orderProgress";
import { Orderbook } from "~~/lib/clob/types";
import { hashscan } from "~~/lib/mirror/client";

const StepIcon = ({ status }: { status: StepStatus }) => {
  switch (status) {
    case "done":
      return <CheckCircleIcon className="h-4 w-4 shrink-0 text-success" />;
    case "failed":
      return <XCircleIcon className="h-4 w-4 shrink-0 text-error" />;
    case "skipped":
      return <MinusCircleIcon className="h-4 w-4 shrink-0 opacity-40" />;
    case "active":
      return <span className="loading loading-spinner h-4 w-4 shrink-0 text-primary" />;
    default:
      return <span className="mt-0.5 inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-base-content/30" />;
  }
};

/**
 * The order ticket's view of one order, from the click to the verified fill.
 *
 * The first four steps come from placing it; the last two keep going afterwards — the
 * order's history is followed until it settles, and the fill is checked on-chain with the
 * same code the order history uses. Every step links to its evidence where there is some.
 */
export const OrderProgress = ({
  market,
  stage,
  failedAt,
  error,
  result,
  trail,
}: {
  market: Orderbook;
  stage: PlaceStage;
  failedAt?: PlaceStage;
  error: string | null;
  result: PlaceResult | null;
  trail?: { nonce?: string; journal?: PlaceResult["journal"]; journalPending?: boolean };
}) => {
  const { config } = useClobNetwork();
  const links = hashscan(config);
  const journalLinks = hashscan(getNetworkConfig(getJournalNetwork()));

  const { data: orders } = useOrders();
  const order = result ? orders?.find(candidate => String(candidate.id) === String(result.orderId)) : undefined;
  const { data: history } = useOrderHistory(result?.orderId ?? null, { follow: true });
  const events = history?.events ?? [];
  const { verifications, isLoading } = useFillVerification(order, market, events);

  const steps = orderProgress({
    stage,
    failedAt,
    error,
    result: result
      ? {
          ...result,
          journal: result.journal ? { ...result.journal, href: journalLinks.topic(result.journal.topicId) } : undefined,
        }
      : null,
    trail: trail
      ? {
          ...trail,
          journal: trail.journal ? { ...trail.journal, href: journalLinks.topic(trail.journal.topicId) } : undefined,
        }
      : undefined,
    events,
    transactionHref: links.transaction,
    verification: {
      loading: isLoading,
      checked: verifications?.length ?? 0,
      failed: verifications?.filter(verification => !verification.ok).length ?? 0,
    },
  });

  return (
    <ol className="mt-3 space-y-2 rounded-box bg-base-200 p-3 text-xs" aria-label="Order progress">
      {steps.map(step => (
        <li key={step.id} className="flex items-start gap-2">
          <span className="mt-px">
            <StepIcon status={step.status} />
          </span>
          <span className="min-w-0">
            <span className={step.status === "pending" || step.status === "skipped" ? "opacity-50" : ""}>
              {step.label}
            </span>
            {step.detail &&
              (step.href ? (
                <a
                  className="link block truncate font-mono text-[11px] opacity-70"
                  href={step.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {step.detail} ↗
                </a>
              ) : (
                <span
                  className={`block truncate font-mono text-[11px] ${step.status === "failed" ? "text-error" : "opacity-60"}`}
                >
                  {step.detail}
                </span>
              ))}
          </span>
        </li>
      ))}
    </ol>
  );
};
