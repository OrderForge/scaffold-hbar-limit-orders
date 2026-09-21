import { describe, expect, it, vi } from "vitest";
import { AuthStore, AuthTransport, decodeExpiry, isExpired, needsRenewal } from "~~/lib/clob/auth";
import { ClobError } from "~~/lib/clob/errors";

const ACCOUNT = "0x610041680B053425c3b0fa76E856d6F534F27418";

/** Build a JWT-shaped token. Only the payload matters: nothing here verifies it. */
const makeToken = (expSecondsFromNow: number, label = "t") => {
  const payload = Buffer.from(
    JSON.stringify({
      sub: ACCOUNT.toLowerCase(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
      label,
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
};

const transport = (overrides: Partial<AuthTransport> = {}) => {
  const calls = { challenge: 0, verify: 0 };
  const base: AuthTransport = {
    challenge: async () => {
      calls.challenge++;
      return { message: "Sign this message from SaucerSwap. Nonce: abc" };
    },
    verify: async () => {
      calls.verify++;
      return { token: makeToken(6 * 3600) };
    },
    ...overrides,
  };
  return { transport: base, calls };
};

describe("token lifetime", () => {
  it("reads exp out of the payload for scheduling", () => {
    // The API issues six-hour tokens; this is display and renewal only, not verification.
    const token = makeToken(6 * 3600);
    expect(decodeExpiry(token)).toBeGreaterThan(Math.floor(Date.now() / 1000) + 6 * 3600 - 5);
  });

  it("treats an unreadable token as expired rather than trusting it", () => {
    expect(decodeExpiry("not-a-jwt")).toBe(0);
    expect(isExpired({ token: "x", expiresAt: 0, accountEvm: ACCOUNT, network: "testnet" })).toBe(true);
  });

  it("renews before expiry instead of waiting to be rejected", () => {
    const now = Date.now();
    const soon = {
      token: "x",
      expiresAt: Math.floor(now / 1000) + 60,
      accountEvm: ACCOUNT,
      network: "testnet" as const,
    };
    const later = {
      token: "x",
      expiresAt: Math.floor(now / 1000) + 3600,
      accountEvm: ACCOUNT,
      network: "testnet" as const,
    };
    expect(needsRenewal(soon, now)).toBe(true);
    expect(needsRenewal(later, now)).toBe(false);
  });
});

describe("AuthStore", () => {
  it("runs challenge, sign, verify in order", async () => {
    const { transport: t, calls } = transport();
    const signed: string[] = [];
    const store = new AuthStore(t, "testnet");

    const session = await store.signIn(ACCOUNT, async message => {
      signed.push(message);
      return "0xsignature";
    });

    expect(calls.challenge).toBe(1);
    expect(calls.verify).toBe(1);
    expect(signed[0]).toContain("Nonce:");
    expect(session.accountEvm).toBe(ACCOUNT);
    expect(store.current?.token).toBe(session.token);
  });

  it("reuses a valid session instead of prompting the wallet again", async () => {
    const { transport: t, calls } = transport();
    const store = new AuthStore(t, "testnet");
    const sign = vi.fn(async () => "0xsignature");

    await store.signIn(ACCOUNT, sign);
    await store.signIn(ACCOUNT, sign);

    expect(sign).toHaveBeenCalledTimes(1);
    expect(calls.verify).toBe(1);
  });

  it("collapses concurrent sign-ins into one wallet prompt", async () => {
    // Three components noticing a missing token at once must not open three prompts.
    const { transport: t } = transport();
    const store = new AuthStore(t, "testnet");
    const sign = vi.fn(async () => "0xsignature");

    await Promise.all([store.signIn(ACCOUNT, sign), store.signIn(ACCOUNT, sign), store.signIn(ACCOUNT, sign)]);

    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("signs again for a different account", async () => {
    const { transport: t } = transport();
    const store = new AuthStore(t, "testnet");
    const sign = vi.fn(async () => "0xsignature");

    await store.signIn(ACCOUNT, sign);
    await store.signIn("0x0000000000000000000000000000000000000001", sign);

    expect(sign).toHaveBeenCalledTimes(2);
  });

  it("forgets the token on clear", async () => {
    const { transport: t } = transport();
    const store = new AuthStore(t, "testnet");
    await store.signIn(ACCOUNT, async () => "0xsignature");
    store.clear();
    expect(store.current).toBeNull();
  });

  it("notifies subscribers when the session changes", async () => {
    const { transport: t } = transport();
    const store = new AuthStore(t, "testnet");
    const seen: (string | null)[] = [];
    store.subscribe(session => seen.push(session?.token ?? null));

    await store.signIn(ACCOUNT, async () => "0xsignature");
    store.clear();

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBeTruthy();
    expect(seen[1]).toBeNull();
  });
});

describe("withAuth", () => {
  it("passes the token to the call", async () => {
    const { transport: t } = transport();
    const store = new AuthStore(t, "testnet");
    const token = await store.signIn(ACCOUNT, async () => "0xsignature").then(session => session.token);

    const used = await store.withAuth(
      ACCOUNT,
      async () => "0xsignature",
      async passed => passed,
    );
    expect(used).toBe(token);
  });

  it("refreshes once on a 401 and retries", async () => {
    let issued = 0;
    const { transport: t } = transport({
      verify: async () => ({ token: makeToken(6 * 3600, `token-${++issued}`) }),
    });
    const store = new AuthStore(t, "testnet");

    let attempts = 0;
    const result = await store.withAuth(
      ACCOUNT,
      async () => "0xsignature",
      async token => {
        attempts++;
        if (attempts === 1) throw new ClobError("Unauthorized", 401, "/orders");
        return token;
      },
    );

    expect(attempts).toBe(2);
    expect(issued).toBe(2);
    expect(result).toContain("header.");
  });

  it("gives up after a second 401 rather than looping", async () => {
    const { transport: t } = transport();
    const store = new AuthStore(t, "testnet");

    await expect(
      store.withAuth(
        ACCOUNT,
        async () => "0xsignature",
        async () => {
          throw new ClobError("Unauthorized", 401, "/orders");
        },
      ),
    ).rejects.toThrow(/Unauthorized/);
  });

  it("does not refresh on errors that are not 401", async () => {
    const { transport: t, calls } = transport();
    const store = new AuthStore(t, "testnet");

    await expect(
      store.withAuth(
        ACCOUNT,
        async () => "0xsignature",
        async () => {
          throw new ClobError("Rate limited", 429, "/orders");
        },
      ),
    ).rejects.toThrow(/Rate limited/);

    expect(calls.verify).toBe(1);
  });
});

describe("token storage", () => {
  it("never touches browser storage", async () => {
    // A bearer token on disk is readable by any extension with storage access.
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { setItem, getItem: () => null, removeItem: vi.fn() });
    vi.stubGlobal("sessionStorage", { setItem, getItem: () => null, removeItem: vi.fn() });

    const { transport: t } = transport();
    const store = new AuthStore(t, "testnet");
    await store.signIn(ACCOUNT, async () => "0xsignature");

    expect(setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
