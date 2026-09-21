/**
 * The HCS order-intent journal.
 *
 * Every order this template signs is written to a Hedera Consensus Service topic *before*
 * it is sent to SaucerSwap. That gives the trader their own consensus-timestamped record
 * of exactly what they signed, independent of the venue — and it is the reference every
 * fill is later verified against (`lib/verify`).
 *
 * What it proves: what was signed, and when, ordered by consensus rather than by the
 * venue's clock. What it does not prove: that the venue matched fairly. Those are
 * different claims and the README keeps them apart.
 */
import { z } from "zod";

export const INTENT_TYPE = "CLOB-Order-Intent" as const;
export const INTENT_VERSION = "1.0.0" as const;

export const intentActionSchema = z.enum(["place", "cancel", "cancel-all"]);
export type IntentAction = z.infer<typeof intentActionSchema>;

export const orderIntentSchema = z.object({
  type: z.literal(INTENT_TYPE),
  version: z.literal(INTENT_VERSION),
  action: intentActionSchema,
  /** The signing account, as `0.0.x` when known. */
  account: z.string(),
  accountEvm: z.string().optional(),
  orderbookId: z.string(),
  market: z
    .object({
      baseTokenId: z.string(),
      quoteTokenId: z.string(),
      pair: z.string().optional(),
    })
    .optional(),
  side: z.enum(["BUY", "SELL"]).nullable().optional(),
  /** Decimal strings exactly as signed — never floats. */
  price: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  notional: z.string().nullable().optional(),
  nonce: z.union([z.string(), z.number()]).nullable().optional(),
  clientOrderId: z.string().nullable().optional(),
  /** The EIP-712 digest of the order, which is what links an intent to a fill. */
  eip712Hash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .nullable()
    .optional(),
  orderIds: z.array(z.string()).optional(),
  /** Whether the intent was subsequently sent to the venue. */
  submitted: z.boolean().optional(),
  /** Set when this record is a dry run: signed to demonstrate the flow, never submitted. */
  dryRun: z.boolean().optional(),
  ts: z.string(),
});

export type OrderIntent = z.infer<typeof orderIntentSchema>;

/** An intent as read back from the topic, with its consensus metadata. */
export type JournalEntry = {
  intent: OrderIntent;
  consensusTimestamp: string;
  sequenceNumber: number;
  topicId: string;
  /** The submit transaction, for a HashScan link. */
  transactionId?: string;
};

export type BuildIntentInput = {
  action: IntentAction;
  account: string;
  accountEvm?: string;
  orderbookId: string;
  baseTokenId?: string;
  quoteTokenId?: string;
  pair?: string;
  side?: "BUY" | "SELL" | null;
  price?: string | null;
  size?: string | null;
  notional?: string | null;
  nonce?: string | number | null;
  clientOrderId?: string | null;
  eip712Hash?: string | null;
  orderIds?: string[];
  submitted?: boolean;
  dryRun?: boolean;
  at?: Date;
};

/**
 * Build a journal record. Pure, so the exact bytes that reach consensus can be asserted in
 * a test and recomputed later when a fill is verified.
 */
export const buildIntent = (input: BuildIntentInput): OrderIntent => {
  const intent: OrderIntent = {
    type: INTENT_TYPE,
    version: INTENT_VERSION,
    action: input.action,
    account: input.account,
    orderbookId: String(input.orderbookId),
    ts: (input.at ?? new Date()).toISOString(),
  };

  if (input.accountEvm) intent.accountEvm = input.accountEvm.toLowerCase();
  if (input.baseTokenId && input.quoteTokenId) {
    intent.market = { baseTokenId: input.baseTokenId, quoteTokenId: input.quoteTokenId, pair: input.pair };
  }
  if (input.side !== undefined) intent.side = input.side;
  if (input.price !== undefined) intent.price = input.price;
  if (input.size !== undefined) intent.size = input.size;
  if (input.notional !== undefined) intent.notional = input.notional;
  if (input.nonce !== undefined) intent.nonce = input.nonce;
  if (input.clientOrderId !== undefined) intent.clientOrderId = input.clientOrderId;
  if (input.eip712Hash !== undefined) intent.eip712Hash = input.eip712Hash;
  if (input.orderIds) intent.orderIds = input.orderIds;
  if (input.submitted !== undefined) intent.submitted = input.submitted;
  if (input.dryRun !== undefined) intent.dryRun = input.dryRun;

  // Validate before it can ever reach consensus: a malformed record is permanent.
  return orderIntentSchema.parse(intent);
};

/** Canonical bytes for a topic message. Key order is fixed so the record is reproducible. */
export const encodeIntent = (intent: OrderIntent): string => JSON.stringify(intent);

export const decodeIntent = (message: string): OrderIntent | null => {
  try {
    const parsed = orderIntentSchema.safeParse(JSON.parse(message));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
