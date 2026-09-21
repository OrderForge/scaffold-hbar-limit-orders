"use client";

import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { ClobNetwork } from "~~/lib/clob/config";

const LABELS: Record<ClobNetwork, string> = { testnet: "Testnet", mainnet: "Mainnet" };

/**
 * Switches which network the **market data** is read from.
 *
 * Both networks serve public market data without a key, and testnet markets are often
 * closed or halted. Rather than showing an empty terminal, the reader can look at mainnet.
 * This never touches funds: wallet actions still run on the wallet's own network.
 */
export const NetworkToggle = () => {
  const { network, setNetwork, isReadOnlyNetwork } = useClobNetwork();

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
      {isReadOnlyNetwork && (
        <span
          className="badge badge-sm badge-warning"
          title="Market data only. Trading stays on your wallet's network."
        >
          read-only
        </span>
      )}
    </div>
  );
};

/**
 * Offered when the selected market has nothing to show. A dead testnet market is a normal
 * thing for a trading client to survive, so we say so and offer the alternative.
 */
export const SwitchToMainnetHint = ({ reason }: { reason: string }) => {
  const { network, setNetwork } = useClobNetwork();
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
      <button type="button" className="btn btn-sm" onClick={() => setNetwork("mainnet")}>
        Read mainnet instead
      </button>
    </div>
  );
};
