/**
 * Live depth over `/ws/depth`.
 *
 * The stream sends diffs, not snapshots, so a client that simply applies whatever arrives
 * builds a book that is quietly wrong. The procedure — buffer first, snapshot second, drop
 * what the snapshot already includes, then require every diff to start where the last one
 * ended — is the only part of this that matters, and it is implemented in `depth.ts` and
 * tested there against captured messages.
 *
 * Two things shape the design:
 *
 * - **The stream needs a JWT**, so it is only available to a signed-in wallet. The keyless
 *   terminal polls instead. That is a real limitation of the API, not a shortcut.
 * - **A gap is unrecoverable.** There is no "replay from" call, so the only correct
 *   response to a missed update is a fresh snapshot. A book with a hole in it looks fine
 *   and is wrong, which is worse than a book that is visibly stale.
 *
 * The token travels in the query string, so the URL is as sensitive as the token itself.
 * It is never logged, and never put in an error message.
 */
import { ClobNetworkConfig } from "./config";
import { LiveBook, applyDiff, bookFromSnapshot, bookToSnapshot } from "./depth";
import { DepthDiff, DepthSnapshot, depthDiffSchema } from "./types";

export type StreamStatus =
  | "idle"
  | "connecting"
  | "syncing"
  | "live"
  /** Connected, but a gap forced a re-sync. Recoverable, and counted. */
  | "resyncing"
  | "reconnecting"
  /** Gave up; the caller should fall back to polling. */
  | "failed";

export type StreamState = {
  status: StreamStatus;
  snapshot: DepthSnapshot | null;
  /** Diffs applied since the last snapshot — visible proof the stream is doing something. */
  applied: number;
  /** Times a gap forced a fresh snapshot. Occasional is normal; constant is a bug. */
  resyncs: number;
  error: string | null;
};

export type DepthStreamOptions = {
  config: ClobNetworkConfig;
  orderbookId: string;
  token: string;
  /** Fetch a REST snapshot. Injected so the stream can be tested without a network. */
  fetchSnapshot: () => Promise<DepthSnapshot>;
  onState: (state: StreamState) => void;
  /** Injected for tests; defaults to the platform WebSocket. */
  createSocket?: (url: string) => WebSocketLike;
  maxAttempts?: number;
};

/** The slice of WebSocket this module uses, so a fake can stand in for it. */
export type WebSocketLike = {
  close: () => void;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
};

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000];

export class DepthStream {
  private socket: WebSocketLike | null = null;
  /** Guards against a re-entrant snapshot: a gap during a sync must not start another. */
  private syncing = false;
  private book: LiveBook | null = null;
  private buffer: DepthDiff[] = [];
  private hasAppliedFirst = false;
  private attempt = 0;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private state: StreamState = { status: "idle", snapshot: null, applied: 0, resyncs: 0, error: null };

  constructor(private readonly options: DepthStreamOptions) {}

  private emit(patch: Partial<StreamState>) {
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.emit({ status: "idle" });
  }

  private url(): string {
    const base = this.options.config.apiUrl.replace(/^http/, "ws");
    return `${base}/ws/depth?token=${encodeURIComponent(this.options.token)}&books=${encodeURIComponent(
      this.options.orderbookId,
    )}`;
  }

  private connect() {
    if (this.closed) return;

    this.emit({ status: this.attempt === 0 ? "connecting" : "reconnecting", error: null });

    const create = this.options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike);

    let socket: WebSocketLike;
    try {
      socket = create(this.url());
    } catch {
      // Never include the URL: it carries the token.
      this.retry("Could not open the depth stream.");
      return;
    }

    this.socket = socket;
    this.buffer = [];
    this.book = null;
    this.hasAppliedFirst = false;

    socket.onopen = () => {
      this.attempt = 0;
      this.emit({ status: "syncing" });
      // Buffer while the snapshot is in flight — the snapshot is the older of the two.
      void this.sync();
    };

    socket.onmessage = event => {
      const parsed = depthDiffSchema.safeParse(typeof event.data === "string" ? safeJson(event.data) : event.data);
      if (!parsed.success) return;

      if (!this.book) {
        this.buffer.push(parsed.data);
        return;
      }
      this.apply(parsed.data);
    };

    socket.onerror = () => this.emit({ error: "The depth stream reported an error." });
    socket.onclose = () => {
      if (!this.closed) this.retry("The depth stream closed.");
    };
  }

  private async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const snapshot = await this.options.fetchSnapshot();
      this.book = bookFromSnapshot(snapshot);
      this.hasAppliedFirst = false;
      this.emit({ snapshot, applied: 0, status: "live" });

      // Drain whatever arrived while the snapshot was in flight.
      const queued = this.buffer;
      this.buffer = [];
      for (const diff of queued) this.apply(diff);
    } catch {
      this.retry("Could not fetch the depth snapshot.");
    } finally {
      this.syncing = false;
    }
  }

  private apply(diff: DepthDiff) {
    if (!this.book) return;

    const outcome = applyDiff(this.book, diff, this.hasAppliedFirst);

    if (outcome.status === "stale") return;

    if (outcome.status === "gap") {
      // No replay exists, so the only correct move is to start again from a snapshot.
      // The gapped diff is discarded rather than re-buffered: the fresh snapshot
      // supersedes it, and re-applying it would gap again — which is an infinite loop,
      // as an early version of this file demonstrated.
      this.book = null;
      this.buffer = [];
      this.emit({ status: "resyncing", resyncs: this.state.resyncs + 1 });
      void this.sync();
      return;
    }

    this.book = outcome.book;
    this.hasAppliedFirst = true;
    this.emit({
      status: "live",
      snapshot: bookToSnapshot(outcome.book),
      applied: this.state.applied + 1,
    });
  }

  private retry(message: string) {
    this.socket = null;

    const maxAttempts = this.options.maxAttempts ?? BACKOFF_MS.length;
    if (this.attempt >= maxAttempts) {
      // The caller falls back to polling rather than showing a dead page.
      this.emit({ status: "failed", error: `${message} Falling back to polling.` });
      return;
    }

    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt += 1;
    this.emit({ status: "reconnecting", error: message });
    this.timer = setTimeout(() => this.connect(), delay);
  }
}

const safeJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
