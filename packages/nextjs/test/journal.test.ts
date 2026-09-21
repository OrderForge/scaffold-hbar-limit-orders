import { describe, expect, it } from "vitest";
import { buildIntent, decodeIntent, encodeIntent, orderIntentSchema } from "~~/lib/journal/types";

const base = {
  action: "place" as const,
  account: "0.0.10619385",
  accountEvm: "0x610041680B053425c3b0fa76E856d6F534F27418",
  orderbookId: "3",
  baseTokenId: "0.0.1183558",
  quoteTokenId: "0.0.5449",
  pair: "SAUCE/USDC",
  side: "SELL" as const,
  price: "1",
  size: "10",
  notional: "10",
  at: new Date("2026-09-21T11:00:00.000Z"),
};

describe("buildIntent", () => {
  it("stamps the type and version so old records stay readable", () => {
    const intent = buildIntent(base);
    expect(intent.type).toBe("CLOB-Order-Intent");
    expect(intent.version).toBe("1.0.0");
    expect(intent.ts).toBe("2026-09-21T11:00:00.000Z");
  });

  it("keeps prices and sizes as the exact strings that were signed", () => {
    const intent = buildIntent({ ...base, price: "0.0428608", size: "10.00001" });
    expect(intent.price).toBe("0.0428608");
    expect(intent.size).toBe("10.00001");
    // A journal that rounds is worse than no journal: it would not match the fill.
    expect(JSON.stringify(intent)).not.toContain("0.042860800000");
  });

  it("normalises the EVM address so records from one account group together", () => {
    expect(buildIntent(base).accountEvm).toBe("0x610041680b053425c3b0fa76e856d6f534f27418");
  });

  it("marks a dry run, so it can never be mistaken for a live order", () => {
    const intent = buildIntent({ ...base, dryRun: true, submitted: false });
    expect(intent.dryRun).toBe(true);
    expect(intent.submitted).toBe(false);
  });

  it("records a cancel with the order ids it covers", () => {
    const intent = buildIntent({
      action: "cancel",
      account: base.account,
      orderbookId: "3",
      orderIds: ["3494124"],
      at: base.at,
    });
    expect(intent.action).toBe("cancel");
    expect(intent.orderIds).toEqual(["3494124"]);
  });

  it("accepts an EIP-712 digest and rejects anything that is not one", () => {
    const hash = `0x${"a".repeat(64)}`;
    expect(buildIntent({ ...base, eip712Hash: hash }).eip712Hash).toBe(hash);
    expect(() => buildIntent({ ...base, eip712Hash: "0xdeadbeef" })).toThrow();
  });

  it("refuses to build a record that would fail validation", () => {
    // Topic messages are permanent, so a malformed record must never be written.
    expect(() => buildIntent({ ...base, action: "nonsense" as any })).toThrow();
  });
});

describe("encode and decode", () => {
  it("round-trips through the topic message format", () => {
    const intent = buildIntent(base);
    const decoded = decodeIntent(encodeIntent(intent));
    expect(decoded).toEqual(intent);
  });

  it("ignores messages on the topic that are not our records", () => {
    // A topic is public: anyone can write to it, and foreign messages must not break the page.
    expect(decodeIntent("hello world")).toBeNull();
    expect(decodeIntent(JSON.stringify({ type: "something-else" }))).toBeNull();
    expect(decodeIntent("")).toBeNull();
  });

  it("matches the record that reached consensus on testnet", () => {
    // Message #1 of topic 0.0.10646020, read back from the mirror node.
    const onChain =
      '{"type":"CLOB-Order-Intent","version":"1.0.0","action":"place","account":"0.0.10619385",' +
      '"accountEvm":"0x610041680b053425c3b0fa76e856d6f534f27418","orderbookId":"3",' +
      '"market":{"baseTokenId":"0.0.1183558","quoteTokenId":"0.0.5449","pair":"SAUCE/USDC"},' +
      '"side":"SELL","price":"1","size":"10","notional":"10","submitted":false,"dryRun":true,' +
      '"ts":"2026-09-21T11:00:00.000Z"}';
    const decoded = decodeIntent(onChain);
    expect(decoded).not.toBeNull();
    expect(decoded?.market?.pair).toBe("SAUCE/USDC");
    expect(orderIntentSchema.safeParse(decoded).success).toBe(true);
  });
});
