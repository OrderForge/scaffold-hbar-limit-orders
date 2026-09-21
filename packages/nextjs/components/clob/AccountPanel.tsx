"use client";

import { SignInButton } from "./SignInButton";
import { WalletGate } from "./WalletGate";
import { useFees, useVenueOnboarding } from "~~/hooks/clob/useAccountData";
import { useClobAuth } from "~~/hooks/clob/useClobAuth";
import { useOnboarding } from "~~/hooks/clob/useOnboarding";
import { pipsToPercentLabel } from "~~/lib/clob/format";
import { Orderbook } from "~~/lib/clob/types";

/**
 * This account's fees, and the venue's onboarding verdict next to ours.
 *
 * The comparison is the point. `GET /onboarding/:id/status` is SaucerSwap's opinion of
 * your on-chain state; `lib/hedera/onboarding` reads the mirror node and the contracts
 * directly. They should agree. When they do not, the chain is right, and a template that
 * silently followed the API would hide a real problem.
 */
export const AccountPanel = ({ market }: { market: Orderbook }) => {
  const { isSignedIn } = useClobAuth();
  const { data: fees } = useFees(market.id);
  const { data: venue } = useVenueOnboarding(market.id);
  const { data: chain } = useOnboarding(market);

  if (!isSignedIn) {
    return (
      <div className="rounded-box bg-base-100 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Your account</h2>
        <div className="mt-3">
          {/* Same connect → right chain → sign in sequence as every other panel. */}
          <WalletGate needsSignIn action="read your fee rates and the venue's view of your onboarding">
            <span />
          </WalletGate>
        </div>
      </div>
    );
  }

  const disagreements =
    venue && chain
      ? chain.steps.filter(step => {
          const venueSays = venue.steps[step.id];
          return venueSays !== undefined && venueSays !== step.done;
        })
      : [];

  return (
    <div className="rounded-box bg-base-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Your account</h2>
        <SignInButton compact />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="opacity-60">Your maker fee</dt>
        <dd className="text-right font-mono text-xs">
          {fees?.maker.makerFeePips !== undefined ? pipsToPercentLabel(fees.maker.makerFeePips) : "—"}
        </dd>
        <dt className="opacity-60">Your taker fee</dt>
        <dd className="text-right font-mono text-xs">
          {fees?.taker.takerFeePips !== undefined ? pipsToPercentLabel(fees.taker.takerFeePips) : "—"}
        </dd>
        {fees?.maker.capFractionPips !== undefined && (
          <>
            <dt className="opacity-60" title="Maker rebate cap as a fraction of taker fees — not a trading fee">
              Rebate cap
            </dt>
            <dd className="text-right font-mono text-xs">{pipsToPercentLabel(fees.maker.capFractionPips)}</dd>
          </>
        )}
        <dt className="opacity-60">Venue says ready</dt>
        <dd className="text-right text-xs">
          {venue ? (
            <span className={`badge badge-sm ${venue.isComplete ? "badge-success" : "badge-warning"}`}>
              {venue.isComplete ? "yes" : `${venue.pendingSteps.length} pending`}
            </span>
          ) : (
            "—"
          )}
        </dd>
        <dt className="opacity-60">Chain says ready</dt>
        <dd className="text-right text-xs">
          {chain ? (
            <span className={`badge badge-sm ${chain.complete ? "badge-success" : "badge-warning"}`}>
              {chain.complete ? "yes" : `${chain.steps.filter(step => !step.done).length} pending`}
            </span>
          ) : (
            "—"
          )}
        </dd>
      </dl>

      {disagreements.length > 0 && (
        <div className="mt-3 rounded-box bg-warning/15 p-3 text-xs">
          <p className="font-medium">The venue and the chain disagree</p>
          <ul className="mt-1 list-inside list-disc">
            {disagreements.map(step => (
              <li key={step.id}>
                {step.id}: venue says {String(venue?.steps[step.id])}, chain says {String(step.done)}
              </li>
            ))}
          </ul>
          <p className="mt-1 opacity-80">The chain is the record. Trust the checklist above, not this API response.</p>
        </div>
      )}

      {venue && chain && disagreements.length === 0 && (
        <p className="mt-3 text-xs opacity-60">
          The venue&apos;s view matches what the mirror node and the contracts report.
        </p>
      )}
    </div>
  );
};
