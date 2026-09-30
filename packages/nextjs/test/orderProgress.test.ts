import { describe, expect, it } from "vitest";
import { ProgressStep, orderProgress } from "~~/lib/clob/orderProgress";

const status = (steps: ProgressStep[]) => Object.fromEntries(steps.map(step => [step.id, step.status]));

const placed = {
  orderId: "3506715",
  nonce: "5",
  journal: { topicId: "0.0.10662192", sequenceNumber: 7 },
};

describe("placing an order", () => {
  it("shows nothing started before the button is pressed", () => {
    expect(Object.values(status(orderProgress({ stage: "idle" })))).toEqual(Array(6).fill("pending"));
  });

  it("walks through build, sign, journal and submit in the hook's order", () => {
    expect(status(orderProgress({ stage: "signing" }))).toMatchObject({
      built: "done",
      signed: "active",
      journalled: "pending",
    });
    expect(status(orderProgress({ stage: "journalling" }))).toMatchObject({ signed: "done", journalled: "active" });
    expect(status(orderProgress({ stage: "saving" }))).toMatchObject({ journalled: "done", submitted: "active" });
  });

  it("marks the step that failed, and says why", () => {
    const steps = orderProgress({ stage: "failed", failedAt: "signing", error: "User rejected the request." });
    expect(status(steps)).toMatchObject({
      built: "done",
      signed: "failed",
      journalled: "pending",
      submitted: "pending",
    });
    expect(steps.find(step => step.id === "signed")?.detail).toBe("User rejected the request.");
  });

  it("shows a failed journal write without failing the order", () => {
    const steps = orderProgress({ stage: "done", result: { ...placed, journal: undefined, journalPending: true } });
    expect(status(steps)).toMatchObject({ journalled: "failed", submitted: "done" });
  });

  it("carries the evidence for each step", () => {
    const steps = orderProgress({ stage: "done", result: placed });
    expect(steps.find(step => step.id === "built")?.detail).toBe("nonce 5");
    expect(steps.find(step => step.id === "journalled")?.detail).toBe("topic 0.0.10662192 · #7");
    expect(steps.find(step => step.id === "submitted")?.detail).toBe("order 3506715");
  });
});

describe("after submission", () => {
  it("waits on the book until a fill settles", () => {
    const steps = orderProgress({ stage: "done", result: placed, events: [{ type: "CREATED" }] });
    expect(status(steps)).toMatchObject({ filled: "active", verified: "pending" });
  });

  it("links the settlement once a fill arrives, then checks it", () => {
    const steps = orderProgress({
      stage: "done",
      result: placed,
      events: [{ type: "CREATED" }, { type: "PARTIAL_FILL", txHash: "0xabc" }, { type: "FILLED" }],
      transactionHref: hash => `https://hashscan.io/testnet/transaction/${hash}`,
      verification: { loading: true, checked: 0, failed: 0 },
    });
    expect(status(steps)).toMatchObject({ filled: "done", verified: "active" });
    expect(steps.find(step => step.id === "filled")?.href).toBe("https://hashscan.io/testnet/transaction/0xabc");
  });

  it("reports verified only when every fill passes", () => {
    const base = { stage: "done" as const, result: placed, events: [{ type: "FILLED", txHash: "0xabc" }] };
    expect(status(orderProgress({ ...base, verification: { loading: false, checked: 1, failed: 0 } })).verified).toBe(
      "done",
    );
    expect(status(orderProgress({ ...base, verification: { loading: false, checked: 2, failed: 1 } })).verified).toBe(
      "failed",
    );
  });

  it("understands the stream's event names as well as the history's", () => {
    const steps = orderProgress({ stage: "done", result: placed, events: [{ type: "ORDER_CANCELED" }] });
    expect(status(steps)).toMatchObject({ filled: "skipped", verified: "skipped" });
    expect(steps.find(step => step.id === "filled")?.detail).toBe("canceled before any fill");
  });
});

describe("a rejected order", () => {
  it("still shows the nonce and the journal receipt — the intent was recorded first", () => {
    const steps = orderProgress({
      stage: "failed",
      failedAt: "saving",
      error: "This market is halted and is not accepting new orders.",
      trail: { nonce: "9", journal: { topicId: "0.0.10662192", sequenceNumber: 12 } },
    });
    expect(status(steps)).toMatchObject({ built: "done", signed: "done", journalled: "done", submitted: "failed" });
    expect(steps.find(step => step.id === "built")?.detail).toBe("nonce 9");
    expect(steps.find(step => step.id === "journalled")?.detail).toBe("topic 0.0.10662192 · #12");
    expect(steps.find(step => step.id === "submitted")?.detail).toMatch(/halted/);
  });
});
