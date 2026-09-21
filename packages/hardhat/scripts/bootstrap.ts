/**
 * `yarn clob:bootstrap` — create the HCS topic this template journals order intents to.
 *
 * Idempotent: if `.clob.json` already names a topic that exists on the mirror node, it
 * prints it and exits without creating another. Deployment is always an explicit command,
 * never a side effect of install or build.
 *
 * Needs `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY` in `packages/hardhat/.env`.
 */
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { Client, PrivateKey, TopicCreateTransaction, TopicId } from "@hiero-ledger/sdk";

dotenv.config();

const NETWORK = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";
const TOPIC_MEMO = "limit-orders order intent journal";
const STATE_FILE = path.resolve(__dirname, "../../../.clob.json");

const MIRROR = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
}[NETWORK];

const HASHSCAN = `https://hashscan.io/${NETWORK}`;

type ClobState = {
  network: string;
  journalTopicId: string;
  createdAt: string;
  memo: string;
};

const readState = (): ClobState | null => {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
};

const topicExists = async (topicId: string): Promise<boolean> => {
  const response = await fetch(`${MIRROR}/api/v1/topics/${topicId}`);
  return response.ok;
};

const buildClient = () => {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;

  if (!operatorId || !operatorKey) {
    console.error(
      "Missing HEDERA_OPERATOR_ID or HEDERA_OPERATOR_KEY.\n" +
        "Add them to packages/hardhat/.env — the account pays for the topic and for each journal message.",
    );
    process.exit(1);
  }

  const client = NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  const key = operatorKey.startsWith("0x")
    ? PrivateKey.fromStringECDSA(operatorKey)
    : PrivateKey.fromString(operatorKey);
  client.setOperator(operatorId, key);
  return { client, operatorId };
};

const main = async () => {
  const existing = readState();

  if (existing?.journalTopicId && existing.network === NETWORK && (await topicExists(existing.journalTopicId))) {
    console.log(`Journal topic already exists on ${NETWORK}: ${existing.journalTopicId}`);
    console.log(`  ${HASHSCAN}/topic/${existing.journalTopicId}`);
    console.log("\nNothing to do. Delete .clob.json to create a new topic.");
    return;
  }

  const { client, operatorId } = buildClient();

  console.log(`Creating the journal topic on ${NETWORK} as ${operatorId}…`);

  try {
    const transaction = await new TopicCreateTransaction().setTopicMemo(TOPIC_MEMO).execute(client);
    const receipt = await transaction.getReceipt(client);
    const topicId = (receipt.topicId as TopicId).toString();

    const state: ClobState = {
      network: NETWORK,
      journalTopicId: topicId,
      createdAt: new Date().toISOString(),
      memo: TOPIC_MEMO,
    };
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);

    console.log(`\n✓ Journal topic created: ${topicId}`);
    console.log(`  transaction: ${HASHSCAN}/transaction/${transaction.transactionId?.toString()}`);
    console.log(`  topic:       ${HASHSCAN}/topic/${topicId}`);
    console.log(`  state:       ${STATE_FILE} (gitignored)`);
    console.log("\nAdd these to packages/nextjs/.env so the app can write and read the journal:");
    console.log(`  JOURNAL_TOPIC_ID=${topicId}`);
    console.log(`  NEXT_PUBLIC_JOURNAL_TOPIC_ID=${topicId}`);
    console.log(`  NEXT_PUBLIC_JOURNAL_NETWORK=${NETWORK}`);
    console.log("  HEDERA_OPERATOR_ID=…      # same account as here");
    console.log("  HEDERA_OPERATOR_KEY=…     # server-side only, never NEXT_PUBLIC_");
    console.log("\nThen run `yarn clob:status` to verify.");
  } finally {
    client.close();
  }
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
