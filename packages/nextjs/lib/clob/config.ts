/**
 * Network configuration for the SaucerSwap V3 Orderbook API.
 *
 * Market data is public on both networks, so the terminal can read either one without a
 * wallet or a key. Wallet actions (onboarding, signing, cancelling) always run on the
 * network the wallet is connected to — reading mainnet prices never moves funds.
 */

export type ClobNetwork = "testnet" | "mainnet";

export type ClobNetworkConfig = {
  network: ClobNetwork;
  /** Orderbook API base URL, no trailing slash. */
  apiUrl: string;
  /** Hedera mirror node REST base URL, no trailing slash. */
  mirrorUrl: string;
  /** HashScan base URL, no trailing slash. */
  hashscanUrl: string;
  /** EVM chain id: 296 testnet, 295 mainnet. */
  chainId: number;
};

export const CLOB_NETWORKS: Record<ClobNetwork, ClobNetworkConfig> = {
  testnet: {
    network: "testnet",
    apiUrl: "https://testnet-orderbook-api.saucerswap.finance",
    mirrorUrl: "https://testnet.mirrornode.hedera.com",
    hashscanUrl: "https://hashscan.io/testnet",
    chainId: 296,
  },
  mainnet: {
    network: "mainnet",
    apiUrl: "https://orderbook-api.saucerswap.finance",
    mirrorUrl: "https://mainnet.mirrornode.hedera.com",
    hashscanUrl: "https://hashscan.io/mainnet",
    chainId: 295,
  },
};

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * The network the app defaults to. `NEXT_PUBLIC_CLOB_NETWORK` picks testnet or mainnet;
 * `NEXT_PUBLIC_CLOB_API_URL` overrides just the API base (for a proxy or a fork) without
 * changing anything else.
 */
export const getDefaultNetwork = (): ClobNetwork =>
  process.env.NEXT_PUBLIC_CLOB_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const getNetworkConfig = (network: ClobNetwork = getDefaultNetwork()): ClobNetworkConfig => {
  const base = CLOB_NETWORKS[network];
  const apiOverride = process.env.NEXT_PUBLIC_CLOB_API_URL;
  const mirrorOverride = process.env.NEXT_PUBLIC_MIRROR_URL;
  const hashscanOverride = process.env.NEXT_PUBLIC_HASHSCAN_URL;

  // An override only applies to the default network; switching networks in the UI must
  // still reach the real hosts for the other one.
  const isDefault = network === getDefaultNetwork();

  return {
    ...base,
    apiUrl: isDefault && apiOverride ? stripTrailingSlash(apiOverride) : base.apiUrl,
    mirrorUrl: isDefault && mirrorOverride ? stripTrailingSlash(mirrorOverride) : base.mirrorUrl,
    hashscanUrl: isDefault && hashscanOverride ? stripTrailingSlash(hashscanOverride) : base.hashscanUrl,
  };
};

/** Market shown when no id is given. */
export const getDefaultOrderbookId = (): string => process.env.NEXT_PUBLIC_DEFAULT_ORDERBOOK_ID || "3";

/** The WebSocket origin for a network — both streams require a JWT. */
export const getWsUrl = (config: ClobNetworkConfig, path: string): string =>
  `${config.apiUrl.replace(/^http/, "ws")}${path}`;
