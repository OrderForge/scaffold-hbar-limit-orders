import crossed from "./fixtures/depth-3-crossed.json";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNetworkConfig } from "~~/lib/clob/config";
import { DepthStream, StreamState, WebSocketLike } from "~~/lib/clob/depthStream";
import { DepthSnapshot, depthSnapshotSchema } from "~~/lib/clob/types";

const config = getNetworkConfig("mainnet");

/** A socket we drive by hand, so the stream's sequencing can be tested exactly. */
class FakeSocket implements WebSocketLike {
  static last: FakeSocket | null = null;
  onopen: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }

  close() {
    this.closed = true;
  }

  open() {
    this.onopen?.();
  }

  send(diff: unknown) {
    this.onmessage?.({ data: JSON.stringify(diff) });
  }

  drop() {
    this.onclose?.();
  }
}

const snapshotAt = (lastUpdateId: number): DepthSnapshot =>
  depthSnapshotSchema.parse({ ...crossed, orderbookId: "1", lastUpdateId });

const diff = (first: number, final: number, bids: [string, string][] = [], asks: [string, string][] = []) => ({
  orderbookId: "1",
  firstUpdateId: first,
  finalUpdateId: final,
  timestamp: Date.now(),
  bids,
  asks,
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

let states: StreamState[];
let stream: DepthStream;

const build = (options: Partial<{ snapshot: () => Promise<DepthSnapshot>; maxAttempts: number }> = {}) => {
  states = [];
  stream = new DepthStream({
    config,
    orderbookId: "1",
    token: "test-token",
    fetchSnapshot: options.snapshot ?? (async () => snapshotAt(100)),
    onState: state => states.push({ ...state }),
    createSocket: url => new FakeSocket(url),
    maxAttempts: options.maxAttempts ?? 1,
  });
  return stream;
};

const latest = () => states[states.length - 1];

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  stream?.stop();
  vi.useRealTimers();
});

describe("connecting", () => {
  it("puts the token in the URL, and nowhere else", async () => {
    build().start();
    // The URL is as sensitive as the token: it must never reach a log or an error message.
    expect(FakeSocket.last?.url).toContain("token=test-token");
    expect(FakeSocket.last?.url.startsWith("wss://")).toBe(true);
    expect(JSON.stringify(states)).not.toContain("test-token");
  });

  it("reports connecting, then syncing, then live", async () => {
    build().start();
    FakeSocket.last?.open();
    await settle();
    expect(states.map(state => state.status)).toEqual(["connecting", "syncing", "live"]);
  });
});

describe("the snapshot race", () => {
  it("buffers diffs that arrive before the snapshot, then applies them", async () => {
    // The snapshot is always older than the stream by the time it arrives.
    let release: (snapshot: DepthSnapshot) => void = () => {};
    build({ snapshot: () => new Promise<DepthSnapshot>(resolve => (release = resolve)) }).start();

    FakeSocket.last?.open();
    FakeSocket.last?.send(diff(101, 101, [["0.5", "10"]]));
    FakeSocket.last?.send(diff(102, 102, [["0.6", "20"]]));

    release(snapshotAt(100));
    await settle();

    expect(latest().status).toBe("live");
    expect(latest().applied).toBe(2);
    expect(latest().snapshot?.lastUpdateId).toBe(102);
  });

  it("drops diffs the snapshot already contains", async () => {
    build({ snapshot: async () => snapshotAt(105) }).start();
    FakeSocket.last?.open();
    FakeSocket.last?.send(diff(101, 103));
    await settle();
    FakeSocket.last?.send(diff(104, 105));
    await settle();

    expect(latest().applied).toBe(0);
    expect(latest().status).toBe("live");
  });
});

describe("gaps", () => {
  it("takes a fresh snapshot when an update is missed", async () => {
    // There is no replay call, so a hole in the sequence can only be repaired by
    // starting again — and a book with a hole looks fine while being wrong.
    let snapshots = 0;
    build({
      snapshot: async () => {
        snapshots += 1;
        return snapshotAt(snapshots === 1 ? 100 : 200);
      },
    }).start();

    FakeSocket.last?.open();
    await settle();
    FakeSocket.last?.send(diff(101, 101));
    await settle();
    // 103 skips 102.
    FakeSocket.last?.send(diff(103, 103));
    await settle();

    expect(snapshots).toBe(2);
    expect(latest().resyncs).toBe(1);
    expect(latest().snapshot?.lastUpdateId).toBe(200);
    expect(states.some(state => state.status === "resyncing")).toBe(true);
  });

  it("counts re-syncs, so a stream that is constantly gapping is visible", async () => {
    build({ snapshot: async () => snapshotAt(100) }).start();
    FakeSocket.last?.open();
    await settle();

    for (const start of [105, 110, 115]) {
      FakeSocket.last?.send(diff(start, start));
      await settle();
    }

    expect(latest().resyncs).toBeGreaterThanOrEqual(2);
  });
});

describe("failure", () => {
  it("falls back rather than leaving a dead page", async () => {
    build({ maxAttempts: 0 }).start();
    FakeSocket.last?.open();
    await settle();
    FakeSocket.last?.drop();
    await settle();

    expect(latest().status).toBe("failed");
    expect(latest().error).toMatch(/falling back to polling/i);
  });

  it("retries with backoff before giving up", async () => {
    build({ maxAttempts: 2 }).start();
    FakeSocket.last?.open();
    await settle();
    FakeSocket.last?.drop();
    await settle();

    expect(latest().status).toBe("reconnecting");
    expect(latest().status).not.toBe("failed");
  });

  it("keeps the token out of the error it reports", async () => {
    build({ maxAttempts: 0 }).start();
    FakeSocket.last?.open();
    await settle();
    FakeSocket.last?.drop();
    await settle();

    expect(latest().error).not.toContain("test-token");
  });

  it("stops cleanly", async () => {
    build().start();
    FakeSocket.last?.open();
    await settle();
    stream.stop();

    expect(FakeSocket.last?.closed).toBe(true);
    expect(latest().status).toBe("idle");
  });
});
