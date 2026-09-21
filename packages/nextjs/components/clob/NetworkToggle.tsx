"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { CLOB_NETWORKS, ClobNetwork } from "~~/lib/clob/config";

const LABELS: Record<ClobNetwork, string> = { testnet: "Testnet", mainnet: "Mainnet" };

/**
 * Which network the terminal is reading.
 *
 * With a wallet connected there is **one** network control in this app, and it lives in the
 * header: the chain the wallet is on decides what is read, because that is the chain any
 * approval or signature would land on. This just reports that state.
 *
 * With no wallet there is nothing to follow, so the reader picks. That matters because
 * testnet markets are often closed or halted and both networks serve public data.
 */
export const NetworkToggle = () => {
  const { isConnected } = useAccount();
  const { network, setNetwork, isReadOnlyNetwork, walletNetwork } = useClobNetwork();

  if (isConnected) {
    if (isReadOnlyNetwork) {
      return (
        <div className="flex items-center gap-2 text-xs">
          <span className="badge badge-warning badge-sm" title={`Your wallet is on ${walletNetwork}`}>
            reading {LABELS[network]} · read-only
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => walletNetwork && setNetwork(walletNetwork)}
          >
            follow my wallet
          </button>
        </div>
      );
    }

    return (
      <span className="text-xs opacity-60" title="Switch networks from the wallet menu in the header">
        reading {LABELS[network]} · follows your wallet
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="join">
        {(Object.keys(LABELS) as ClobNetwork[]).map(option => (
          <button
            key={option}
            type="button"
            className={`btn btn-xs join-item ${network === option ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setNetwork(option)}
            aria-pressed={network === option}
          >
            {LABELS[option]}
          </button>
        ))}
      </div>
      <span className="text-xs opacity-50">market data</span>
    </div>
  );
};

/**
 * Offered when the selected market has nothing to show. A dead testnet market is a normal
 * thing for a trading client to survive, so say so and offer the alternative.
 */
export const SwitchToMainnetHint = ({ reason }: { reason: string }) => {
  const { isConnected } = useAccount();
  const { network, setNetwork } = useClobNetwork();
  const { switchChain, isPending } = useSwitchChain();

  if (network === "mainnet") return null;

  return (
    <div className="alert alert-info mt-4">
      <div>
        <p className="font-medium">{reason}</p>
        <p className="text-sm opacity-80">
          Testnet markets are thin and are often halted. Mainnet market data is public too, and reading it moves no
          funds.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-sm"
        disabled={isPending}
        onClick={() => {
          // With a wallet connected, move the wallet too so the two never drift apart.
          if (isConnected) switchChain({ chainId: CLOB_NETWORKS.mainnet.chainId });
          else setNetwork("mainnet");
        }}
      >
        {isConnected ? "Switch my wallet to mainnet" : "Read mainnet instead"}
      </button>
    </div>
  );
};
