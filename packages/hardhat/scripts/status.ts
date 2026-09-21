/**
 * `yarn clob:status` — check everything this template needs, and say what to run next.
 *
 * Read-only. Verifies the journal topic on the mirror node, the operator account's
 * balance, the settlement contracts the Orderbook API points at, and whether the market
 * data endpoint is answering.
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const NETWORK = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
const STATE_FILE = path.resolve(__dirname, "../../../.clob.json");

const MIRROR = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
}[NETWORK];

const API = {
  testnet: "https://testnet-orderbook-api.saucerswap.finance",
  mainnet: "https://orderbook-api.saucerswap.finance",
}[NETWORK];

const HASHSCAN = `https://hashscan.io/${NETWORK}`;

const ok = (message: string) => console.log(`  ✓ ${message}`);
const bad = (message: string) => console.log(`  ✗ ${message}`);
const info = (message: string) => console.log(`    ${message}`);

const nextSteps: string[] = [];

const checkMarketData = async () => {
  console.log(`\nSaucerSwap Orderbook API (${NETWORK})`);
  try {
    const response = await fetch(`${API}/books`);
    if (response.status === 401) {
      bad("public market data needs a JWT on this network (the keyless rollout has not reached it)");
      return;
    }
    if (!response.ok) {
      bad(`GET /books returned ${response.status}`);
      return;
    }
    const body = await response.json();
    const open = body.orderbooks.filter((book: any) => book.status === "OPEN" && book.isMarketHalted !== 1);
    const halted = body.orderbooks.filter((book: any) => book.isMarketHalted === 1);
    ok(`${body.orderbooks.length} markets, ${open.length} open, ${halted.length} halted`);
    if (open.length === 0) {
      info("no tradeable market here right now — the terminal can read the other network instead");
    }
  } catch (error) {
    bad(`could not reach the API: ${(error as Error).message}`);
  }
};

const checkSettlementContracts = async () => {
  console.log("\nSettlement contracts");
  try {
    const domain = await (await fetch(`${API}/signature/domain`)).json();
    ok(`reactor ${domain.verifyingContract} (chainId ${domain.chainId})`);
    info(`${HASHSCAN}/contract/${domain.verifyingContract}`);
  } catch (error) {
    bad(`could not read the signing domain: ${(error as Error).message}`);
  }
};

const checkOperator = async () => {
  console.log("\nHedera operator");
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  if (!operatorId) {
    bad("HEDERA_OPERATOR_ID is not set");
    nextSteps.push("set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in packages/hardhat/.env");
    return;
  }
  if (!process.env.HEDERA_OPERATOR_KEY) {
    bad("HEDERA_OPERATOR_KEY is not set");
    nextSteps.push("set HEDERA_OPERATOR_KEY in packages/hardhat/.env");
  }

  const response = await fetch(`${MIRROR}/api/v1/accounts/${operatorId}`);
  if (!response.ok) {
    bad(`account ${operatorId} not found on ${NETWORK}`);
    return;
  }
  const account = await response.json();
  const hbar = Number(account.balance?.balance ?? 0) / 1e8;
  if (hbar > 1) ok(`${operatorId} holds ${hbar.toFixed(2)} HBAR`);
  else {
    bad(`${operatorId} holds only ${hbar.toFixed(4)} HBAR`);
    nextSteps.push("fund the operator at https://portal.hedera.com/faucet");
  }
};

const checkJournal = async () => {
  console.log("\nHCS journal");
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : null;
  const topicId = state?.journalTopicId ?? process.env.JOURNAL_TOPIC_ID;

  if (!topicId) {
    bad("no journal topic yet");
    nextSteps.push("run `yarn clob:bootstrap` to create the journal topic");
    return;
  }

  const response = await fetch(`${MIRROR}/api/v1/topics/${topicId}`);
  if (!response.ok) {
    bad(`topic ${topicId} does not exist on ${NETWORK}`);
    nextSteps.push("delete .clob.json and run `yarn clob:bootstrap` again");
    return;
  }

  const messages = await (await fetch(`${MIRROR}/api/v1/topics/${topicId}/messages?limit=1&order=desc`)).json();
  const count = messages.messages?.[0]?.sequence_number ?? 0;
  ok(`topic ${topicId} exists, ${count} message${count === 1 ? "" : "s"}`);
  info(`${HASHSCAN}/topic/${topicId}`);

  // The app reads the topic from its own env file, not this one.
  const appEnvPath = path.resolve(__dirname, "../../nextjs/.env");
  const appEnv = fs.existsSync(appEnvPath) ? fs.readFileSync(appEnvPath, "utf8") : "";
  if (appEnv.includes(`NEXT_PUBLIC_JOURNAL_TOPIC_ID=${topicId}`)) {
    ok("the app is configured to read and write this topic");
  } else {
    bad("packages/nextjs/.env does not point at this topic");
    nextSteps.push(
      `add JOURNAL_TOPIC_ID=${topicId} and NEXT_PUBLIC_JOURNAL_TOPIC_ID=${topicId} to packages/nextjs/.env`,
    );
  }
};

const main = async () => {
  console.log(`limit-orders status — ${NETWORK}`);
  await checkMarketData();
  await checkSettlementContracts();
  await checkOperator();
  await checkJournal();

  console.log("");
  if (nextSteps.length === 0) {
    console.log("Everything is in place. Run `yarn next:dev` and open /markets.");
  } else {
    console.log("Next:");
    for (const step of nextSteps) console.log(`  - ${step}`);
  }
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
