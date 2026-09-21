"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { ClobClient } from "~~/lib/clob/client";
import { CLOB_NETWORKS, ClobNetwork, getDefaultNetwork, getNetworkConfig } from "~~/lib/clob/config";
import { MirrorClient } from "~~/lib/mirror/client";

type ClobNetworkContextValue = {
  /** Network the market data is read from. */
  network: ClobNetwork;
  setNetwork: (network: ClobNetwork) => void;
  client: ClobClient;
  mirror: MirrorClient;
  config: ReturnType<typeof getNetworkConfig>;
  /** The network the connected wallet is on, when it maps to one we support. */
  walletNetwork: ClobNetwork | null;
  /** Wallet connected to a chain this template does not trade on (a local fork, say). */
  walletOnUnsupportedChain: boolean;
  /**
   * True when the data being read is not the network the wallet is on. Everything that
   * touches the wallet — onboarding, signing, placing, cancelling — is disabled in that
   * state, because an approval signed on one chain says nothing about the other.
   */
  isReadOnlyNetwork: boolean;
};

const ClobNetworkContext = createContext<ClobNetworkContextValue | null>(null);

const networkForChainId = (chainId: number | undefined): ClobNetwork | null => {
  if (chainId === CLOB_NETWORKS.testnet.chainId) return "testnet";
  if (chainId === CLOB_NETWORKS.mainnet.chainId) return "mainnet";
  return null;
};

/**
 * One source of truth for "which network are we looking at".
 *
 * Market data can be read from either network without a wallet, which matters when the
 * default network's markets are closed or halted. But as soon as a wallet is connected,
 * **the wallet's chain leads**: it is the chain any approval or signature would land on,
 * and letting the two drift apart is how someone approves a token on testnet and wonders
 * why mainnet still says they are not ready.
 *
 * Reading the other network stays possible, and is clearly marked read-only.
 */
export const ClobNetworkProvider = ({ children }: { children: ReactNode }) => {
  const { chain, isConnected } = useAccount();
  const walletNetwork = networkForChainId(chain?.id);

  const [network, setNetworkState] = useState<ClobNetwork>(getDefaultNetwork());
  // Set once the reader deliberately looks at a different network than the wallet.
  const [pinned, setPinned] = useState(false);

  const setNetwork = useCallback((next: ClobNetwork) => {
    setNetworkState(next);
    setPinned(true);
  }, []);

  // Follow the wallet unless the reader has deliberately chosen otherwise.
  useEffect(() => {
    if (walletNetwork && !pinned) setNetworkState(walletNetwork);
  }, [walletNetwork, pinned]);

  // Reconnecting to the chain being viewed clears the read-only state.
  useEffect(() => {
    if (walletNetwork && walletNetwork === network) setPinned(false);
  }, [walletNetwork, network]);

  const value = useMemo<ClobNetworkContextValue>(() => {
    const config = getNetworkConfig(network);
    return {
      network,
      setNetwork,
      config,
      client: new ClobClient({ config }),
      mirror: new MirrorClient({ config }),
      walletNetwork,
      walletOnUnsupportedChain: isConnected && walletNetwork === null,
      isReadOnlyNetwork: isConnected && walletNetwork !== null && walletNetwork !== network,
    };
  }, [network, setNetwork, walletNetwork, isConnected]);

  return <ClobNetworkContext.Provider value={value}>{children}</ClobNetworkContext.Provider>;
};

export const useClobNetwork = (): ClobNetworkContextValue => {
  const context = useContext(ClobNetworkContext);
  if (!context) throw new Error("useClobNetwork must be used inside <ClobNetworkProvider>");
  return context;
};
