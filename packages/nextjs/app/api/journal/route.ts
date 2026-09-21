import { NextRequest, NextResponse } from "next/server";
import { Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hiero-ledger/sdk";
import { encodeIntent, orderIntentSchema } from "~~/lib/journal/types";

/**
 * Writes an order intent to the HCS journal topic.
 *
 * The operator key lives here, on the server, and never reaches the browser. This route is
 * the only thing in the template that holds a Hedera key, and it does exactly one thing
 * with it: submit a message to one topic.
 *
 * Configure with `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` and `JOURNAL_TOPIC_ID`
 * (`yarn clob:bootstrap` creates the topic and prints all three).
 *
 * **The operator pays for every message, not the user.** That is deliberate — a trader
 * should not need HBAR to keep a record of what they signed — but it also means this route
 * spends the deployer's money on request, so it is rate limited per caller. Anyone running
 * this in production should put their own quota or authentication in front of it: the
 * comment is not a substitute for that decision.
 */

/** Simple in-memory quota. Resets on restart; enough to stop a loop draining the operator. */
const RATE_LIMIT = { windowMs: 60_000, max: 10 };
const seen = new Map<string, { count: number; resetAt: number }>();

const overQuota = (key: string): boolean => {
  const now = Date.now();
  const entry = seen.get(key);

  if (!entry || entry.resetAt <= now) {
    seen.set(key, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > RATE_LIMIT.max;
};

export const dynamic = "force-dynamic";

const getClient = () => {
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  const network = process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet";

  if (!operatorId || !operatorKey) return null;

  const client = network === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  // Accept both DER-encoded and raw hex keys, and both key types.
  const key = operatorKey.startsWith("0x")
    ? PrivateKey.fromStringECDSA(operatorKey)
    : PrivateKey.fromString(operatorKey);
  client.setOperator(operatorId, key);
  return client;
};

export async function POST(request: NextRequest) {
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (overQuota(caller)) {
    return NextResponse.json(
      { error: "Too many journal writes from this address. Each message costs the operator HBAR." },
      { status: 429 },
    );
  }

  const topicIdRaw = process.env.JOURNAL_TOPIC_ID || process.env.NEXT_PUBLIC_JOURNAL_TOPIC_ID;
  if (!topicIdRaw) {
    return NextResponse.json(
      { error: "No journal topic configured. Run `yarn clob:bootstrap` and set JOURNAL_TOPIC_ID." },
      { status: 503 },
    );
  }

  const client = getClient();
  if (!client) {
    return NextResponse.json(
      { error: "No Hedera operator configured. Set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY." },
      { status: 503 },
    );
  }

  const parsed = orderIntentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // A topic message is permanent, so a malformed record is rejected before it is written.
    return NextResponse.json({ error: `Invalid intent: ${parsed.error.issues[0]?.message}` }, { status: 400 });
  }

  try {
    const submit = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(topicIdRaw))
      .setMessage(encodeIntent(parsed.data))
      .execute(client);

    const receipt = await submit.getReceipt(client);

    return NextResponse.json({
      topicId: topicIdRaw,
      sequenceNumber: Number(receipt.topicSequenceNumber ?? 0),
      consensusTimestamp: String(submit.transactionId?.validStart?.seconds ?? ""),
      transactionId: submit.transactionId?.toString() ?? "",
    });
  } catch (error) {
    return NextResponse.json({ error: `Could not write to the journal: ${(error as Error).message}` }, { status: 502 });
  } finally {
    client.close();
  }
}

/** Reports whether journalling is configured, so the UI can explain itself. */
export async function GET() {
  const topicId = process.env.JOURNAL_TOPIC_ID || process.env.NEXT_PUBLIC_JOURNAL_TOPIC_ID || null;
  return NextResponse.json({
    configured: Boolean(topicId && process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY),
    topicId,
    network: process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet",
  });
}
