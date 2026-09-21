"use client";

import { ReactNode } from "react";
import { SignInButton } from "./SignInButton";
import { useAccount, useSwitchChain } from "wagmi";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-hbar";
import { useClobAuth } from "~~/hooks/clob/useClobAuth";
import { useClobNetwork } from "~~/hooks/clob/useClobNetwork";
import { CLOB_NETWORKS } from "~~/lib/clob/config";

/**
 * One place that decides whether a wallet action is possible, so every panel tells the
 * same story in the same order: connect → right chain → signed in.
 *
 * The header's connect button is reused rather than reimplemented, so there is only ever
 * one way to connect a wallet in this app.
 */
export const WalletGate = ({
  children,
  needsSignIn = false,
  action = "trade",
}: {
  children: ReactNode;
  /** Also require an API session, for anything reading or writing account data. */
  needsSignIn?: boolean;
  action?: string;
}) => {
  const { isConnected } = useAccount();
  const { network, walletNetwork, walletOnUnsupportedChain, isReadOnlyNetwork, setNetwork } = useClobNetwork();
  const { isSignedIn } = useClobAuth();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs opacity-70">Connect a wallet to {action}.</p>
        <RainbowKitCustomConnectButton />
      </div>
    );
  }

  if (walletOnUnsupportedChain) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs opacity-70">
          Your wallet is on a chain this template does not trade on. Switch to Hedera testnet or mainnet.
        </p>
        <button
          type="button"
          className="btn btn-outline btn-xs"
          disabled={isPending}
          onClick={() => switchChain({ chainId: CLOB_NETWORKS[network].chainId })}
        >
          Switch to Hedera {network}
        </button>
      </div>
    );
  }

  if (isReadOnlyNetwork) {
    // Approvals and signatures land on the wallet's chain, so acting here would mean
    // signing for a network other than the one on screen.
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs opacity-70">
          You are reading <span className="font-medium">{network}</span> market data while your wallet is on{" "}
          <span className="font-medium">{walletNetwork}</span>. Trading is disabled until the two match.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-outline btn-xs"
            disabled={isPending}
            onClick={() => switchChain({ chainId: CLOB_NETWORKS[network].chainId })}
          >
            Switch wallet to {network}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => walletNetwork && setNetwork(walletNetwork)}
          >
            Or view {walletNetwork} instead
          </button>
        </div>
      </div>
    );
  }

  if (needsSignIn && !isSignedIn) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs opacity-70">
          Sign in to the Orderbook API to {action}. Signing the challenge proves you control this account; it moves
          nothing and costs nothing.
        </p>
        <SignInButton />
      </div>
    );
  }

  return <>{children}</>;
};
