/**
 * `yarn clob:fund` — swap a little HBAR into a market's base and quote tokens.
 *
 * Getting test SAUCE and USDC is the first wall anyone hits on testnet: the faucet gives
 * HBAR only, and the app's own swap UI is awkward. This buys both sides of a market
 * through SaucerSwap's V1 router so the onboarding checklist has something to work with.
 *
 *   yarn clob:fund                 # 50 HBAR into each side of the default market
 *   yarn clob:fund --hbar 20       # spend less
 *   yarn clob:fund --book 3        # a different market
 *
 * Every swap has a minimum-output guard, so a thin pool cannot quietly take the HBAR.
 */
import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const NETWORK = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";

const CONFIG = {
  testnet: {
    rpc: process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api",
    api: "https://testnet-orderbook-api.saucerswap.finance",
    router: "0x0000000000000000000000000000000000004b40", // SaucerSwapV1RouterV3, 0.0.19264
    whbar: "0x0000000000000000000000000000000000003ad2", // WHBAR token 0.0.15058
    hashscan: "https://hashscan.io/testnet",
  },
  mainnet: {
    rpc: process.env.HEDERA_RPC_URL || "https://mainnet.hashio.io/api",
    api: "https://orderbook-api.saucerswap.finance",
    router: "0x00000000000000000000000000000000002e7a5d", // SaucerSwapV1RouterV3, 0.0.3045981
    whbar: "0x0000000000000000000000000000000000163b5a", // WHBAR token 0.0.1456986
    hashscan: "https://hashscan.io/mainnet",
  },
}[NETWORK];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable returns (uint[] amounts)",
];

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

/** Slippage guard: accept at most this much less than quoted. */
const MIN_OUT_PERCENT = 95n;

const main = async () => {
  const privateKey = process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error(
      "No deployer key. Run `yarn hardhat:account:generate` (or set DEPLOYER_PRIVATE_KEY), fund it at\n" +
        "https://portal.hedera.com/faucet, then run this again.",
    );
    process.exit(1);
  }

  const bookId = arg("book", process.env.NEXT_PUBLIC_DEFAULT_ORDERBOOK_ID || "3");
  const hbarPerSide = BigInt(arg("hbar", "50"));

  const books = await (await fetch(`${CONFIG.api}/books`)).json();
  const market = books.orderbooks.find((book: any) => String(book.id) === bookId);
  if (!market) {
    console.error(`No market ${bookId} on ${NETWORK}.`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(CONFIG.rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const router = new ethers.Contract(CONFIG.router, ROUTER_ABI, wallet);

  console.log(`Funding ${wallet.address} on ${NETWORK} with ${market.baseTokenSymbol} and ${market.quoteTokenSymbol}`);
  console.log(`Spending ${hbarPerSide} HBAR per side through the SaucerSwap V1 router.\n`);

  for (const side of ["base", "quote"] as const) {
    const token = side === "base" ? market.baseTokenEvmAddress : market.quoteTokenEvmAddress;
    const symbol = side === "base" ? market.baseTokenSymbol : market.quoteTokenSymbol;
    const decimals = side === "base" ? market.baseTokenDecimals : market.quoteTokenDecimals;

    if (token.toLowerCase() === "0x0000000000000000000000000000000000000000") {
      console.log(`- ${symbol} is HBAR itself, nothing to swap.`);
      continue;
    }

    const path = [CONFIG.whbar, token];
    // getAmountsOut takes tinybars (8dp); the transaction value is wei (18dp).
    const amountInTinybars = hbarPerSide * 10n ** 8n;

    try {
      const quoted: bigint[] = await router.getAmountsOut(amountInTinybars, path);
      const expected = quoted[quoted.length - 1];
      const minOut = (expected * MIN_OUT_PERCENT) / 100n;

      console.log(
        `- ${hbarPerSide} HBAR -> ~${ethers.formatUnits(expected, decimals)} ${symbol} ` +
          `(minimum ${ethers.formatUnits(minOut, decimals)})`,
      );

      const transaction = await router.swapExactETHForTokens(
        minOut,
        path,
        wallet.address,
        Math.floor(Date.now() / 1000) + 300,
        { value: hbarPerSide * 10n ** 18n, gasLimit: 1_500_000 },
      );
      const receipt = await transaction.wait();
      console.log(`  ${receipt?.status === 1 ? "✓" : "✗"} ${CONFIG.hashscan}/transaction/${transaction.hash}`);
    } catch (error) {
      console.log(`  ✗ could not swap for ${symbol}: ${(error as Error).message.split("\n")[0]}`);
      console.log("    (a pool may not exist for this pair on this network)");
    }
  }

  console.log("\nTokens arrive with automatic association on most accounts. Open /market/" + bookId);
  console.log("and the ready-to-trade checklist will show what is left.");
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
