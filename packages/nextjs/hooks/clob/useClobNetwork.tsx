"use client";

import { ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { ClobClient } from "~~/lib/clob/client";
import { ClobNetwork, getDefaultNetwork, getNetworkConfig } from "~~/lib/clob/config";
import { MirrorClient } from "~~/lib/mirror/client";

type ClobNetworkContextValue = {
  /** Network the market data is read from — independent of the connected wallet. */
  network: ClobNetwork;
  setNetwork: (network: ClobNetwork) => void;
  client: ClobClient;
  mirror: MirrorClient;
  config: ReturnType<typeof getNetworkConfig>;
  /** True when reading a different network than the app's default. */
  isReadOnlyNetwork: boolean;
};

const ClobNetworkContext = createContext<ClobNetworkContextValue | null>(null);

/**
 * Market data can be read from either network without a wallet, which matters when the
 * default network's markets are closed or halted: the terminal stays useful and says
 * plainly which network it is reading. Wallet actions always use the wallet's own network.
 */
export const ClobNetworkProvider = ({ children }: { children: ReactNode }) => {
  const defaultNetwork = getDefaultNetwork();
  const [network, setNetworkState] = useState<ClobNetwork>(defaultNetwork);

  const setNetwork = useCallback((next: ClobNetwork) => setNetworkState(next), []);

  const value = useMemo<ClobNetworkContextValue>(() => {
    const config = getNetworkConfig(network);
    return {
      network,
      setNetwork,
      config,
      client: new ClobClient({ config }),
      mirror: new MirrorClient({ config }),
      isReadOnlyNetwork: network !== defaultNetwork,
    };
  }, [network, setNetwork, defaultNetwork]);

  return <ClobNetworkContext.Provider value={value}>{children}</ClobNetworkContext.Provider>;
};

export const useClobNetwork = (): ClobNetworkContextValue => {
  const context = useContext(ClobNetworkContext);
  if (!context) throw new Error("useClobNetwork must be used inside <ClobNetworkProvider>");
  return context;
};
