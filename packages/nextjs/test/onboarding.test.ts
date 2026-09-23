import books from "./fixtures/books.json";
import onboardingComplete from "./fixtures/onboarding-status-3-complete.json";
import onboardingPending from "./fixtures/onboarding-status-3.json";
import { describe, expect, it } from "vitest";
import { getNetworkConfig } from "~~/lib/clob/config";
import { orderbookSchema } from "~~/lib/clob/types";
import { AssociationInfo, ChainReader, deriveOnboarding, stepExplanation, stepLabel } from "~~/lib/hedera/onboarding";

const market = orderbookSchema.parse(books.orderbooks.find(book => book.id === "3"));
const config = getNetworkConfig("testnet");
const OWNER = "0x610041680B053425c3b0fa76E856d6F534F27418" as const;
const NOW = Date.UTC(2026, 8, 21);

/** A chain where nothing has been approved. */
const emptyChain: ChainReader = {
  readErc20Allowance: async () => 0n,
  readPermit2Allowance: async () => ({ amount: 0n, expiration: 0 }),
};

const fullChain = (expiration: number): ChainReader => ({
  readErc20Allowance: async () => 1_000_000_000n,
  readPermit2Allowance: async () => ({ amount: 1_000_000_000n, expiration }),
});

const association = (over: Partial<AssociationInfo> = {}): AssociationInfo => ({
  associatedTokenIds: new Set<string>(),
  maxAutomaticTokenAssociations: 0,
  accountExists: true,
  ...over,
});

describe("an account that is not on the network yet", () => {
  // An address that has never received HBAR has no record on the mirror node. Asking for
  // its token balances answers 404, which used to fail the whole read: the checklist then
  // showed nothing at all and retried forever. It is a state, and it is reported as one.
  it("is never complete, and is never asked about on chain", async () => {
    // An HTS `allowance` call for an owner that does not exist reverts with
    // INVALID_ACCOUNT_ID, so these reads must not happen at all.
    const reverting: ChainReader = {
      readErc20Allowance: async () => {
        throw new Error("reverted: INVALID_ACCOUNT_ID");
      },
      readPermit2Allowance: async () => {
        throw new Error("reverted: INVALID_ACCOUNT_ID");
      },
    };

    const state = await deriveOnboarding(market, OWNER, config, association({ accountExists: false }), reverting, NOW);

    expect(state.accountExists).toBe(false);
    expect(state.complete).toBe(false);
    expect(state.steps.every(step => !step.done)).toBe(true);
  });

  it("is distinguishable from an account that exists and has done nothing", async () => {
    const missing = await deriveOnboarding(
      market,
      OWNER,
      config,
      association({ accountExists: false }),
      emptyChain,
      NOW,
    );
    const fresh = await deriveOnboarding(market, OWNER, config, association(), emptyChain, NOW);

    expect(missing.accountExists).toBe(false);
    expect(fresh.accountExists).toBe(true);
    expect(fresh.complete).toBe(false);
  });
});

describe("deriveOnboarding", () => {
  it("reports the same six steps the API reports", async () => {
    const state = await deriveOnboarding(market, OWNER, config, association(), emptyChain, NOW);
    expect(state.steps.map(step => step.id).sort()).toEqual(Object.keys(onboardingPending.steps).sort());
  });

  it("matches the API's pending state for an account that has done nothing", async () => {
    const state = await deriveOnboarding(market, OWNER, config, association(), emptyChain, NOW);
    expect(state.complete).toBe(false);
    expect(state.steps.every(step => !step.done)).toBe(true);
    expect(onboardingPending.pendingSteps).toHaveLength(6);
    expect(state.next?.id).toBe("associateBaseToken");
  });

  it("matches the API's complete state once tokens and allowances are in place", async () => {
    const state = await deriveOnboarding(
      market,
      OWNER,
      config,
      association({ associatedTokenIds: new Set([market.baseTokenId, market.quoteTokenId]) }),
      fullChain(Math.floor(NOW / 1000) + 30 * 86400),
      NOW,
    );
    expect(state.complete).toBe(true);
    expect(state.next).toBeNull();
    expect(onboardingComplete.isComplete).toBe(true);
  });

  it("treats unlimited automatic association as satisfying the association steps", async () => {
    // Accounts created from an EVM address default to -1, so most wallets never need an
    // association transaction — forcing one would waste the user's HBAR.
    const state = await deriveOnboarding(
      market,
      OWNER,
      config,
      association({ maxAutomaticTokenAssociations: -1 }),
      emptyChain,
      NOW,
    );
    const associate = state.steps.filter(step => step.kind === "associate");
    expect(associate.every(step => step.done)).toBe(true);
    expect(associate.every(step => step.satisfiedByAutoAssociation)).toBe(true);
    expect(state.next?.kind).toBe("approvePermit2");
  });

  it("treats an expired Permit2 approval as not done", async () => {
    const expired = Math.floor(NOW / 1000) - 3600;
    const state = await deriveOnboarding(
      market,
      OWNER,
      config,
      association({ associatedTokenIds: new Set([market.baseTokenId, market.quoteTokenId]) }),
      fullChain(expired),
      NOW,
    );
    const reactorSteps = state.steps.filter(step => step.kind === "approveReactor");
    expect(reactorSteps.every(step => step.done)).toBe(false);
    expect(reactorSteps[0].detail).toMatch(/expired/);
    expect(state.complete).toBe(false);
  });

  it("reads allowances for the right token, owner and spender", async () => {
    const erc20Calls: string[][] = [];
    const permit2Calls: string[][] = [];
    const recording: ChainReader = {
      readErc20Allowance: async (token, owner, spender) => {
        erc20Calls.push([token, owner, spender]);
        return 1n;
      },
      readPermit2Allowance: async (permit2, owner, token, spender) => {
        permit2Calls.push([permit2, owner, token, spender]);
        return { amount: 1n, expiration: Math.floor(NOW / 1000) + 86400 };
      },
    };

    await deriveOnboarding(market, OWNER, config, association(), recording, NOW);

    expect(erc20Calls).toEqual([
      [market.baseTokenEvmAddress, OWNER, config.permit2],
      [market.quoteTokenEvmAddress, OWNER, config.permit2],
    ]);
    expect(permit2Calls).toEqual([
      [config.permit2, OWNER, market.baseTokenEvmAddress, config.reactor],
      [config.permit2, OWNER, market.quoteTokenEvmAddress, config.reactor],
    ]);
  });

  it("walks a token through associate, then Permit2, then the reactor", async () => {
    const state = await deriveOnboarding(market, OWNER, config, association(), emptyChain, NOW);
    expect(state.steps.map(step => step.id)).toEqual([
      "associateBaseToken",
      "approveBaseTokenPermit2",
      "approveBaseTokenReactor",
      "associateQuoteToken",
      "approveQuoteTokenPermit2",
      "approveQuoteTokenReactor",
    ]);
  });

  it("explains every step in plain language", async () => {
    const state = await deriveOnboarding(market, OWNER, config, association(), emptyChain, NOW);
    for (const step of state.steps) {
      expect(stepLabel(step)).toContain(step.tokenSymbol);
      expect(stepExplanation(step).length).toBeGreaterThan(40);
    }
  });
});

describe("settlement addresses", () => {
  it("pins the reactor and Permit2 per network", () => {
    // Both were read from the chain: reactor from GET /signature/domain, Permit2 from
    // reactor.permit2(). clob:doctor re-checks them against the live API.
    expect(getNetworkConfig("testnet").reactor).toBe("0x5707B946EE64bD750A587261Ce36ec7024F3088B");
    expect(getNetworkConfig("testnet").permit2).toBe("0x2e2C4f4277183F2BC5eb982CD4cD27C1fb01c6Ed");
    expect(getNetworkConfig("mainnet").reactor).toBe("0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C");
    expect(getNetworkConfig("mainnet").permit2).toBe("0x8D53a86b10b503f284A0EA9e8316bc6081432A96");
  });
});
