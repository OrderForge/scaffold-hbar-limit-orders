import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNetworkConfig } from "~~/lib/clob/config";
import { clearClobCache } from "~~/lib/clob/http";
import { MirrorClient } from "~~/lib/mirror/client";

const config = getNetworkConfig("testnet");
const ADDRESS = "0x610041680B053425c3b0fa76E856d6F534F27418";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
let mirror: MirrorClient;

beforeEach(() => {
  clearClobCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mirror = new MirrorClient({ config });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * These two cases look alike in a `catch {}` and mean opposite things. The onboarding
 * panel tells the user "this address has no account yet" on the first, so reporting the
 * second the same way would state something false about their wallet.
 */
describe("a missing account and a failing mirror node", () => {
  it("reports a 404 as no account", async () => {
    fetchMock.mockResolvedValue(json({ _status: { messages: [{ message: "Not found" }] } }, 404));
    await expect(mirror.getAccount(ADDRESS)).resolves.toBeNull();
  });

  it("throws when the mirror node is rate limiting, rather than claiming no account", async () => {
    fetchMock.mockResolvedValue(json({ _status: { messages: [{ message: "Too many requests" }] } }, 429));
    await expect(mirror.getAccount(ADDRESS)).rejects.toThrow();
  });

  it("throws when the mirror node is down", async () => {
    fetchMock.mockResolvedValue(json({}, 503));
    await expect(mirror.getAccount(ADDRESS)).rejects.toThrow();
  });

  it("treats a 404 on token balances as holding nothing", async () => {
    fetchMock.mockResolvedValue(json({ _status: { messages: [{ message: "Not found" }] } }, 404));
    await expect(mirror.getTokenBalances("0.0.1")).resolves.toEqual([]);
  });

  it("still throws when token balances fail for any other reason", async () => {
    fetchMock.mockResolvedValue(json({}, 500));
    await expect(mirror.getTokenBalances("0.0.1")).rejects.toThrow();
  });
});

describe("reading an account", () => {
  it("resolves an EVM address to its Hedera id", async () => {
    fetchMock.mockResolvedValue(
      json({
        account: "0.0.10619385",
        evm_address: ADDRESS.toLowerCase(),
        balance: { balance: "89616210000" },
        max_automatic_token_associations: -1,
        key: { _type: "ECDSA_SECP256K1" },
      }),
    );

    const account = await mirror.getAccount(ADDRESS);

    expect(account?.accountId).toBe("0.0.10619385");
    // -1 is unlimited automatic association, the default for EVM-created accounts.
    expect(account?.maxAutomaticTokenAssociations).toBe(-1);
  });
});
