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
  /**
   * Settlement contracts, read from the chain rather than guessed:
   * `reactor` is the `verifyingContract` of `GET /signature/domain`, and `permit2` is
   * `reactor.permit2()`. `clob:doctor` re-checks both against the live API.
   */
  reactor: `0x${string}`;
  permit2: `0x${string}`;
};

export const CLOB_NETWORKS: Record<ClobNetwork, ClobNetworkConfig> = {
  testnet: {
    network: "testnet",
    apiUrl: "https://testnet-orderbook-api.saucerswap.finance",
    mirrorUrl: "https://testnet.mirrornode.hedera.com",
    hashscanUrl: "https://hashscan.io/testnet",
    chainId: 296,
    reactor: "0x5707B946EE64bD750A587261Ce36ec7024F3088B",
    permit2: "0x2e2C4f4277183F2BC5eb982CD4cD27C1fb01c6Ed",
  },
  mainnet: {
    network: "mainnet",
    apiUrl: "https://orderbook-api.saucerswap.finance",
    mirrorUrl: "https://mainnet.mirrornode.hedera.com",
    hashscanUrl: "https://hashscan.io/mainnet",
    chainId: 295,
    reactor: "0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C",
    permit2: "0x8D53a86b10b503f284A0EA9e8316bc6081432A96",
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

/**
 * The network the HCS journal topic lives on.
 *
 * A topic id exists on exactly one network, so the journal does not follow the market-data
 * toggle: reading mainnet prices does not move the journal to mainnet. `yarn clob:bootstrap`
 * prints the topic and the network it created it on.
 */
export const getJournalNetwork = (): ClobNetwork =>
  process.env.NEXT_PUBLIC_JOURNAL_NETWORK === "mainnet" ? "mainnet" : "testnet";

/** Market shown when no id is given. */
export const getDefaultOrderbookId = (): string => process.env.NEXT_PUBLIC_DEFAULT_ORDERBOOK_ID || "3";

/**
 * Same-origin path the browser calls instead of the API directly.
 *
 * The Orderbook API sends no CORS headers, so a browser cannot read it cross-origin even
 * though the endpoints are public. `app/api/clob/[network]/[...path]` forwards the request
 * from the server. Node callers (scripts, tests, the bot) skip the proxy entirely.
 */
export const CLOB_PROXY_PATH = "/api/clob";

export const isBrowser = () => typeof window !== "undefined";

/** Base URL to build requests from: the proxy in a browser, the API itself in Node. */
export const getApiBase = (config: ClobNetworkConfig): string =>
  isBrowser() ? `${CLOB_PROXY_PATH}/${config.network}` : config.apiUrl;

/** The WebSocket origin for a network — both streams require a JWT. */
export const getWsUrl = (config: ClobNetworkConfig, path: string): string =>
  `${config.apiUrl.replace(/^http/, "ws")}${path}`;
