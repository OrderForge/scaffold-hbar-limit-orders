/**
 * An order's life, as six steps a trader can watch.
 *
 * Placing a limit order here is not one action. The venue builds it, the wallet signs it,
 * the intent is written to HCS, the venue accepts it, a filler settles it on Hedera, and
 * the settlement is checked against what was signed. Each step has its own evidence — a
 * nonce, a digest, a topic sequence number, an order id, a transaction, a set of checks —
 * and each can fail on its own. Showing them separately is what lets someone see where an
 * order is, and prove where it went.
 *
 * Pure: it takes what the hooks already know and returns what to draw, so the rules are
 * tested without a browser.
 */
import { normalizeEventType } from "./types";

export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";

export type ProgressStepId = "built" | "signed" | "journalled" | "submitted" | "filled" | "verified";

export type ProgressStep = {
  id: ProgressStepId;
  label: string;
  status: StepStatus;
  /** One line of evidence or explanation, when there is something useful to say. */
  detail?: string;
  /** Where the evidence can be checked independently. */
  href?: string;
};

/** The placement hook's stages, in the order it moves through them. */
export type PlacementStage = "idle" | "building" | "signing" | "journalling" | "saving" | "done" | "failed";

const PLACEMENT_ORDER = ["building", "signing", "journalling", "saving"] as const;

export type ProgressInput = {
  stage: PlacementStage;
  /** The stage that was running when placement failed. */
  failedAt?: PlacementStage;
  error?: string | null;
  result?: {
    orderId: string;
    nonce?: string;
    journal?: { topicId: string; sequenceNumber: number; href?: string };
    journalPending?: boolean;
  } | null;
  /**
   * What the steps produced before any result exists. A venue that rejects the order still
   * leaves a nonce and, usually, a journal receipt — the intent was recorded first.
   */
  trail?: {
    nonce?: string;
    journal?: { topicId: string; sequenceNumber: number; href?: string };
    journalPending?: boolean;
  };
  /** The order's history from the venue, once it has one. */
  events?: { type: string; txHash?: string | null }[];
  /** Link builder for a settlement transaction. */
  transactionHref?: (hash: string) => string;
  /** Result of checking the fills on-chain, once there is a fill to check. */
  verification?: { loading: boolean; checked: number; failed: number } | null;
};

const FILL_EVENTS = new Set(["PARTIAL_FILL", "FILLED"]);
const ENDED_UNFILLED = new Set(["CANCELED", "CANCELLED", "EXPIRED", "REJECTED"]);

export const orderProgress = (input: ProgressInput): ProgressStep[] => {
  const { stage, failedAt, error, result, trail, events = [], transactionHref, verification } = input;
  const nonce = result?.nonce ?? trail?.nonce;
  const journal = result?.journal ?? trail?.journal;
  const journalPending = result?.journalPending ?? trail?.journalPending;

  // --- The four placement steps, driven by the hook's stage.
  const reached = stage === "done" ? PLACEMENT_ORDER.length : PLACEMENT_ORDER.indexOf(stage as never);
  const failedIndex = stage === "failed" && failedAt ? PLACEMENT_ORDER.indexOf(failedAt as never) : -1;

  const placement = (index: number): StepStatus => {
    if (failedIndex !== -1) return index < failedIndex ? "done" : index === failedIndex ? "failed" : "pending";
    if (stage === "idle") return "pending";
    if (index < reached) return "done";
    return index === reached ? "active" : "pending";
  };

  const steps: ProgressStep[] = [
    {
      id: "built",
      label: "Built by the venue",
      status: placement(0),
      detail: nonce ? `nonce ${nonce}` : undefined,
    },
    { id: "signed", label: "Signed in your wallet (EIP-712)", status: placement(1) },
    {
      id: "journalled",
      label: "Intent journalled to HCS",
      status: placement(2),
      detail: journal ? `topic ${journal.topicId} · #${journal.sequenceNumber}` : undefined,
      href: journal?.href,
    },
    {
      id: "submitted",
      label: "Accepted by the venue",
      status: placement(3),
      detail: result ? `order ${result.orderId}` : undefined,
    },
  ];

  // The journal never blocks a trade, so a failed write is shown, not treated as fatal.
  if (journalPending) {
    steps[2] = { ...steps[2], status: "failed", detail: "the write failed — the order itself is unaffected" };
  }

  if (failedIndex !== -1 && error) steps[failedIndex] = { ...steps[failedIndex], detail: error };

  // --- Settlement, from the venue's history.
  const types = events.map(event => normalizeEventType(event.type));
  const settlement = events.find(event => FILL_EVENTS.has(normalizeEventType(event.type)) && event.txHash);
  const endedUnfilled = types.find(type => ENDED_UNFILLED.has(type));

  let filled: ProgressStep;
  if (!result) filled = { id: "filled", label: "Filled on Hedera", status: "pending" };
  else if (settlement)
    filled = {
      id: "filled",
      label: "Filled on Hedera",
      status: "done",
      detail: types.includes("FILLED") ? "filled" : "partly filled",
      href: settlement.txHash && transactionHref ? transactionHref(settlement.txHash) : undefined,
    };
  else if (endedUnfilled)
    filled = {
      id: "filled",
      label: "Filled on Hedera",
      status: "skipped",
      detail: `${endedUnfilled.toLowerCase()} before any fill`,
    };
  else
    filled = {
      id: "filled",
      label: "Filled on Hedera",
      status: "active",
      detail: "resting on the book, waiting for a match",
    };

  // --- Verification, only once there is a settlement to read.
  let verified: ProgressStep;
  if (filled.status === "skipped")
    verified = { id: "verified", label: "Fill checked against what you signed", status: "skipped" };
  else if (filled.status !== "done" || !verification)
    verified = { id: "verified", label: "Fill checked against what you signed", status: "pending" };
  else if (verification.loading || verification.checked === 0)
    verified = {
      id: "verified",
      label: "Fill checked against what you signed",
      status: "active",
      detail: "reading the settlement from the mirror node",
    };
  else if (verification.failed > 0)
    verified = {
      id: "verified",
      label: "Fill checked against what you signed",
      status: "failed",
      detail: `${verification.failed} of ${verification.checked} fill(s) failed a check`,
    };
  else
    verified = {
      id: "verified",
      label: "Fill checked against what you signed",
      status: "done",
      detail: "price, fee cap, deadline and size all hold",
    };

  return [...steps, filled, verified];
};
