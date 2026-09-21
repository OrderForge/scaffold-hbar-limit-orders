/**
 * Wallet-challenge authentication for the Orderbook API.
 *
 * Flow: `POST /auth/challenge` returns a nonce message, the wallet signs it, and
 * `POST /auth/verify` returns a JWT. Verified against the live API: an **EVM address** with
 * a plain EIP-191 `personal_sign` is accepted; a `0.0.x` id needs Hedera's own signing
 * scheme instead. Tokens last six hours.
 *
 * The token is held **in memory only** — never localStorage, never a cookie, never logged.
 * A refresh survives a page load by asking the wallet to sign again, which costs one click
 * and keeps a bearer token off disk where a stray extension could read it.
 */
import { ClobNetwork } from "./config";
import { ClobError } from "./errors";
import { request } from "./http";

export type AuthSession = {
  token: string;
  /** Unix seconds, decoded from the JWT payload for display and renewal only. */
  expiresAt: number;
  accountEvm: string;
  network: ClobNetwork;
};

export type SignMessage = (message: string) => Promise<string>;

/** Renew this long before expiry rather than waiting to be rejected. */
const RENEW_BEFORE_MS = 5 * 60 * 1000;

/**
 * Read `exp` out of a JWT for scheduling only.
 *
 * This is not verification: the API is the only party that can validate its own token. If
 * the payload cannot be read, the session is treated as short-lived rather than trusted.
 */
export const decodeExpiry = (token: string): number => {
  try {
    const payload = token.split(".")[1];
    const json = typeof atob === "function" ? atob(payload) : Buffer.from(payload, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed.exp === "number" ? parsed.exp : 0;
  } catch {
    return 0;
  }
};

export const isExpired = (session: AuthSession | null, now = Date.now()): boolean =>
  !session || session.expiresAt * 1000 <= now;

export const needsRenewal = (session: AuthSession | null, now = Date.now()): boolean =>
  !session || session.expiresAt * 1000 - now <= RENEW_BEFORE_MS;

export type AuthTransport = {
  challenge: (accountId: string) => Promise<{ message: string }>;
  verify: (accountId: string, signature: string) => Promise<{ token: string }>;
};

/** Transport over the app's proxy: the Orderbook API sends no CORS headers. */
export const httpAuthTransport = (baseUrl: string): AuthTransport => ({
  challenge: accountId =>
    request<{ message: string }>(`${baseUrl}/auth/challenge`, {
      method: "POST",
      body: { accountId },
      maxAttempts: 2,
    }),
  verify: (accountId, signature) =>
    request<{ token: string }>(`${baseUrl}/auth/verify`, {
      method: "POST",
      body: { accountId, signature },
      maxAttempts: 1,
    }),
});

/**
 * Holds one session in memory and guarantees a single sign-in at a time.
 *
 * Without the single-flight guard, three components noticing an expired token at once
 * would each pop a wallet prompt.
 */
export class AuthStore {
  private session: AuthSession | null = null;
  private inFlight: Promise<AuthSession> | null = null;
  private listeners = new Set<(session: AuthSession | null) => void>();

  constructor(
    private readonly transport: AuthTransport,
    private readonly network: ClobNetwork,
  ) {}

  get current(): AuthSession | null {
    return isExpired(this.session) ? null : this.session;
  }

  subscribe(listener: (session: AuthSession | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener(this.current);
  }

  /** Forget the token. Called on disconnect, network switch, or account change. */
  clear() {
    this.session = null;
    this.inFlight = null;
    this.emit();
  }

  /** Sign in, or return the session already in progress. */
  async signIn(accountEvm: string, sign: SignMessage): Promise<AuthSession> {
    if (this.inFlight) return this.inFlight;

    const existing = this.current;
    if (existing && existing.accountEvm === accountEvm && !needsRenewal(existing)) return existing;

    this.inFlight = (async () => {
      const { message } = await this.transport.challenge(accountEvm);
      const signature = await sign(message);
      const { token } = await this.transport.verify(accountEvm, signature);

      const session: AuthSession = {
        token,
        expiresAt: decodeExpiry(token),
        accountEvm,
        network: this.network,
      };
      this.session = session;
      this.emit();
      return session;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  /**
   * Run an authenticated call, refreshing once on a 401.
   *
   * The API's tokens are short-lived and a refresh is cheap, but a second 401 means
   * something else is wrong — so it surfaces rather than looping.
   */
  async withAuth<T>(accountEvm: string, sign: SignMessage, call: (token: string) => Promise<T>): Promise<T> {
    const session = await this.signIn(accountEvm, sign);

    try {
      return await call(session.token);
    } catch (error) {
      if (error instanceof ClobError && error.status === 401) {
        this.clear();
        const renewed = await this.signIn(accountEvm, sign);
        return call(renewed.token);
      }
      throw error;
    }
  }
}
