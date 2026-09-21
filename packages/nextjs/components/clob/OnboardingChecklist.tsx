"use client";

import { useState } from "react";
import { WalletGate } from "./WalletGate";
import { useWriteContract } from "wagmi";
import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { useOnboarding } from "~~/hooks/clob/useOnboarding";
import { parseDecimal } from "~~/lib/clob/format";
import { Orderbook } from "~~/lib/clob/types";
import { OnboardingStep, stepExplanation, stepLabel } from "~~/lib/hedera/onboarding";
import { hashscan } from "~~/lib/mirror/client";
import { GAS_LIMITS } from "~~/utils/hedera/constants";

/** HIP-719: every HTS token exposes `associate()` at its own EVM address. */
const IHRC_ABI = [
  { type: "function", name: "associate", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "int64" }] },
] as const;

const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const PERMIT2_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

/** Default approval window. Bounded and expiring, never unlimited. */
const APPROVAL_DAYS = 30;

const StepRow = ({
  step,
  market,
  approvalAmount,
  onDone,
}: {
  step: OnboardingStep;
  market: Orderbook;
  approvalAmount: string;
  onDone: () => void;
}) => {
  const { config } = useClobNetwork();
  const links = hashscan(config);
  const { writeContractAsync, isPending } = useWriteContract();
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decimals = step.side === "base" ? market.baseTokenDecimals : market.quoteTokenDecimals;

  const run = async () => {
    setError(null);
    try {
      let txHash: `0x${string}`;

      if (step.kind === "associate") {
        txHash = await writeContractAsync({
          address: step.tokenEvmAddress,
          abi: IHRC_ABI,
          functionName: "associate",
          chainId: config.chainId,
          gas: GAS_LIMITS.ASSOCIATE,
        });
      } else if (step.kind === "approvePermit2") {
        txHash = await writeContractAsync({
          address: step.tokenEvmAddress,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [config.permit2, parseDecimal(approvalAmount, decimals)],
          chainId: config.chainId,
          gas: GAS_LIMITS.APPROVE_PERMIT2,
        });
      } else {
        const expiration = Math.floor(Date.now() / 1000) + APPROVAL_DAYS * 86_400;
        txHash = await writeContractAsync({
          address: config.permit2,
          abi: PERMIT2_APPROVE_ABI,
          functionName: "approve",
          args: [step.tokenEvmAddress, config.reactor, parseDecimal(approvalAmount, decimals), expiration],
          chainId: config.chainId,
          gas: GAS_LIMITS.PERMIT2_APPROVE_REACTOR,
        });
      }

      setHash(txHash);
      // Re-read the chain rather than trusting the receipt: the checklist only turns green
      // once the mirror node and the contracts agree.
      setTimeout(onDone, 3_000);
    } catch (cause) {
      setError((cause as Error).message.split("\n")[0]);
    }
  };

  return (
    <li className="flex flex-col gap-1 border-b border-base-300 py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {step.done ? (
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          ) : (
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full border border-base-content/30" />
          )}
          <div>
            <p className="text-sm font-medium">{stepLabel(step)}</p>
            <p className="text-xs opacity-70">{stepExplanation(step)}</p>
            {step.detail && <p className="mt-0.5 font-mono text-xs opacity-50">{step.detail}</p>}
          </div>
        </div>

        {!step.done && (
          <button type="button" className="btn btn-primary btn-xs" onClick={run} disabled={isPending}>
            {isPending ? "confirm in wallet…" : "Do it"}
          </button>
        )}
      </div>

      {step.satisfiedByAutoAssociation && (
        <p className="ml-7 text-xs opacity-60">
          Handled by this account&apos;s automatic association — no transaction needed.
        </p>
      )}

      {hash && (
        <p className="ml-7 text-xs">
          <a className="link" href={links.transaction(hash)} target="_blank" rel="noreferrer">
            View transaction on HashScan
          </a>
        </p>
      )}

      {error && <p className="ml-7 text-xs text-error">{error}</p>}
    </li>
  );
};

/**
 * The six on-chain steps between a funded wallet and a first order.
 *
 * None of this is in SaucerSwap's documentation; it was found by reading the reactor's
 * verified source, which settles through Permit2.
 */
export const OnboardingChecklist = ({ market }: { market: Orderbook }) => {
  const { data: onboarding, refetch, isLoading } = useOnboarding(market);
  const [approvalAmount, setApprovalAmount] = useState("1000");

  return (
    <div className="rounded-box bg-base-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide opacity-70">Ready to trade</h2>
        {onboarding?.complete && <span className="badge badge-success badge-sm">ready</span>}
      </div>

      <div className="mt-3">
        <WalletGate action="see what this account still needs">
          <>
            {isLoading && <p className="text-sm opacity-60">Checking the chain…</p>}

            {onboarding && !onboarding.complete && (
              <div className="mt-3 flex items-start gap-2 rounded-box bg-base-200 p-3 text-xs">
                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
                <p>
                  Settlement pulls your funds through <span className="font-medium">Permit2</span>, so each token needs
                  an allowance to Permit2 and then a capped, expiring allowance from Permit2 to the settlement contract.
                  SaucerSwap&apos;s documentation does not mention this — the steps were read from the reactor contract.
                </p>
              </div>
            )}

            {onboarding && (
              <ul className="mt-2">
                {onboarding.steps.map(step => (
                  <StepRow
                    key={step.id}
                    step={step}
                    market={market}
                    approvalAmount={approvalAmount}
                    onDone={() => refetch()}
                  />
                ))}
              </ul>
            )}

            {onboarding && !onboarding.complete && (
              <label className="mt-3 flex items-center gap-2 text-xs">
                <span className="opacity-70">Approve up to</span>
                <input
                  className="input input-xs input-bordered w-28 font-mono"
                  value={approvalAmount}
                  onChange={event => setApprovalAmount(event.target.value.replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                />
                <span className="opacity-70">tokens, expiring in {APPROVAL_DAYS} days</span>
              </label>
            )}

            <p className="mt-3 text-xs opacity-60">
              Every box is checked against the mirror node and the contracts themselves, not against the venue&apos;s
              view of your account.
            </p>
          </>
        </WalletGate>
      </div>
    </div>
  );
};
