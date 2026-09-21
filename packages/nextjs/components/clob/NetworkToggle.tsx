"use client";

import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { ClobNetwork } from "~~/lib/clob/config";

const LABELS: Record<ClobNetwork, string> = { testnet: "Testnet", mainnet: "Mainnet" };

/**
 * Switches which network the **market data** is read from.
 *
 * With no wallet connected this is free: both networks serve public data, and testnet
 * markets are often closed or halted, so being able to look at mainnet keeps the terminal
 * useful. Once a wallet is connected the two are kept in step — the toggle follows the
 * wallet, and deliberately reading the other network marks everything wallet-related
 * read-only rather than letting someone approve a token on the chain they are not viewing.
 */
export const NetworkToggle = () => {
  const { network, setNetwork, isReadOnlyNetwork, walletNetwork } = useClobNetwork();

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
          title={`Your wallet is on ${walletNetwork}. Trading is disabled while you read a different network.`}
        >
          read-only
        </span>
      )}
      {!isReadOnlyNetwork && walletNetwork === network && (
        <span className="badge badge-sm badge-ghost" title="Your wallet is on the network you are reading">
          wallet
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
