/**
 * Reading and writing the HCS order-intent journal from the browser.
 *
 * Writes go through `POST /api/journal`, because submitting to a topic needs an operator
 * key and that key must never reach the browser. Reads go straight to the mirror node,
 * which is public: anyone can audit the journal without this app.
 */
import { ClobNetworkConfig } from "../clob/config";
import { request, withQuery } from "../clob/http";
import { JournalEntry, OrderIntent, decodeIntent } from "./types";

export * from "./types";

/** The topic id the app writes to, set after `yarn clob:bootstrap`. */
export const getJournalTopicId = (): string | null => process.env.NEXT_PUBLIC_JOURNAL_TOPIC_ID || null;

export type SubmitResult = {
  topicId: string;
  sequenceNumber: number;
  consensusTimestamp: string;
  transactionId: string;
};

/**
 * Write an intent to the topic.
 *
 * Journalling must never block a trade: callers submit the order even when this fails, and
 * surface a "journal pending" state with a retry instead.
 */
export const submitIntent = async (intent: OrderIntent): Promise<SubmitResult> =>
  request<SubmitResult>("/api/journal", { method: "POST", body: intent, maxAttempts: 2 });

const decodeBase64 = (value: string): string => {
  if (typeof atob === "function") return atob(value);
  return Buffer.from(value, "base64").toString("utf8");
};

/**
 * Read the journal back from the mirror node.
 *
 * Paged, newest first. `account` filters client-side: the topic is a shared, public log,
 * and filtering server-side would mean trusting someone else's filter.
 */
export const listIntents = async (
  config: ClobNetworkConfig,
  options: { topicId?: string | null; limit?: number; account?: string; signal?: AbortSignal } = {},
): Promise<JournalEntry[]> => {
  const topicId = options.topicId ?? getJournalTopicId();
  if (!topicId) return [];

  const url = withQuery(`${config.mirrorUrl}/api/v1/topics/${topicId}/messages`, {
    limit: options.limit ?? 50,
    order: "desc",
  });

  const payload = await request<any>(url, { cacheMs: 3_000, signal: options.signal });

  const entries: JournalEntry[] = [];
  for (const message of payload.messages ?? []) {
    const intent = decodeIntent(decodeBase64(message.message));
    // A topic is public: anyone can write to it, and messages that are not our records
    // are skipped rather than rendered as junk.
    if (!intent) continue;
    if (options.account && intent.account !== options.account && intent.accountEvm !== options.account.toLowerCase()) {
      continue;
    }
    entries.push({
      intent,
      consensusTimestamp: message.consensus_timestamp,
      sequenceNumber: message.sequence_number,
      topicId,
      transactionId: message.payer_account_id ? message.payer_account_id : undefined,
    });
  }

  return entries;
};

/** Consensus timestamps arrive as `seconds.nanos`. */
export const consensusToDate = (consensusTimestamp: string): Date =>
  new Date(Number(consensusTimestamp.split(".")[0]) * 1000);
