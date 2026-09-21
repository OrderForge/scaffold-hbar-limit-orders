/**
 * What an account must do before it can trade a market, and how to check each step
 * against the chain rather than against the venue's word for it.
 *
 * Settlement pulls funds through Permit2, so three things must be true per token:
 *
 *   1. the account is **associated** with the token (Hedera requires this to hold it);
 *   2. the token grants an **allowance to Permit2**;
 *   3. **Permit2 grants the reactor** an allowance, with an expiry in the future.
 *
 * None of this appears in SaucerSwap's documentation. `GET /onboarding/:id/status` reports
 * the same six flags, but this template derives them independently from the mirror node
 * and contract reads, and shows both — a venue that is wrong about your on-chain state is
 * exactly the case worth catching.
 */
import { ClobNetworkConfig } from "../clob/config";
import { Orderbook } from "../clob/types";
import { MirrorClient } from "../mirror/client";

export type OnboardingStepId =
  | "associateBaseToken"
  | "associateQuoteToken"
  | "approveBaseTokenPermit2"
  | "approveQuoteTokenPermit2"
  | "approveBaseTokenReactor"
  | "approveQuoteTokenReactor";

export type StepKind = "associate" | "approvePermit2" | "approveReactor";
export type TokenSide = "base" | "quote";

export type OnboardingStep = {
  id: OnboardingStepId;
  kind: StepKind;
  side: TokenSide;
  tokenId: string;
  tokenEvmAddress: `0x${string}`;
  tokenSymbol: string;
  /** Satisfied according to our own on-chain reads. */
  done: boolean;
  /**
   * True when Hedera's automatic association already covers this token, so no association
   * transaction is needed. Accounts created from an EVM address default to unlimited
   * automatic associations, which makes the association step a no-op for most wallets.
   */
  satisfiedByAutoAssociation?: boolean;
  /** Current on-chain value behind the check, for display. */
  detail?: string;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  complete: boolean;
  /** The next step to act on, or null when nothing is left. */
  next: OnboardingStep | null;
};

const ERC20_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const PERMIT2_ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "user", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

/** Minimal shape of the reads this module needs, so it can be tested without a chain. */
export type ChainReader = {
  readErc20Allowance: (token: `0x${string}`, owner: `0x${string}`, spender: `0x${string}`) => Promise<bigint>;
  readPermit2Allowance: (
    permit2: `0x${string}`,
    owner: `0x${string}`,
    token: `0x${string}`,
    spender: `0x${string}`,
  ) => Promise<{ amount: bigint; expiration: number }>;
};

export const viemChainReader = (client: { readContract: (args: any) => Promise<any> }): ChainReader => ({
  readErc20Allowance: (token, owner, spender) =>
    client.readContract({
      address: token,
      abi: ERC20_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [owner, spender],
    }),
  readPermit2Allowance: async (permit2, owner, token, spender) => {
    const [amount, expiration] = (await client.readContract({
      address: permit2,
      abi: PERMIT2_ALLOWANCE_ABI,
      functionName: "allowance",
      args: [owner, token, spender],
    })) as [bigint, number, number];
    return { amount, expiration: Number(expiration) };
  },
});

export type AssociationInfo = {
  /** Token ids the account currently holds or has associated. */
  associatedTokenIds: Set<string>;
  /** -1 means unlimited automatic associations. */
  maxAutomaticTokenAssociations: number;
};

export const readAssociation = async (
  mirror: MirrorClient,
  accountId: string,
  signal?: AbortSignal,
): Promise<AssociationInfo> => {
  const [account, tokens] = await Promise.all([
    mirror.getAccount(accountId, signal),
    mirror.getTokenBalances(accountId, undefined, signal),
  ]);

  return {
    associatedTokenIds: new Set(tokens.map(token => token.tokenId)),
    maxAutomaticTokenAssociations: account?.maxAutomaticTokenAssociations ?? 0,
  };
};

const formatAllowance = (amount: bigint, decimals: number): string => {
  if (amount === 0n) return "none";
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  // Anything past a sensible display size is a max-approval; say so instead of printing it.
  return whole > 1_000_000_000n ? "unlimited" : `${whole}`;
};

/**
 * Work out every step's state from chain data.
 *
 * `association` comes from the mirror node, the allowances from contract reads. Nothing
 * here trusts the Orderbook API.
 */
export const deriveOnboarding = async (
  market: Orderbook,
  owner: `0x${string}`,
  config: ClobNetworkConfig,
  association: AssociationInfo,
  chain: ChainReader,
  now: number = Date.now(),
): Promise<OnboardingState> => {
  const sides: { side: TokenSide; tokenId: string; evm: `0x${string}`; symbol: string; decimals: number }[] = [
    {
      side: "base",
      tokenId: market.baseTokenId,
      evm: market.baseTokenEvmAddress as `0x${string}`,
      symbol: market.baseTokenSymbol ?? market.baseTokenId,
      decimals: market.baseTokenDecimals,
    },
    {
      side: "quote",
      tokenId: market.quoteTokenId,
      evm: market.quoteTokenEvmAddress as `0x${string}`,
      symbol: market.quoteTokenSymbol ?? market.quoteTokenId,
      decimals: market.quoteTokenDecimals,
    },
  ];

  const autoAssociates = association.maxAutomaticTokenAssociations === -1;
  const steps: OnboardingStep[] = [];

  for (const token of sides) {
    const associated = association.associatedTokenIds.has(token.tokenId);
    steps.push({
      id: token.side === "base" ? "associateBaseToken" : "associateQuoteToken",
      kind: "associate",
      side: token.side,
      tokenId: token.tokenId,
      tokenEvmAddress: token.evm,
      tokenSymbol: token.symbol,
      done: associated || autoAssociates,
      satisfiedByAutoAssociation: !associated && autoAssociates,
      detail: associated ? "associated" : autoAssociates ? "automatic association" : "not associated",
    });
  }

  const [baseToPermit2, quoteToPermit2] = await Promise.all(
    sides.map(token => chain.readErc20Allowance(token.evm, owner, config.permit2)),
  );

  const [baseToReactor, quoteToReactor] = await Promise.all(
    sides.map(token => chain.readPermit2Allowance(config.permit2, owner, token.evm, config.reactor)),
  );

  sides.forEach((token, index) => {
    const allowance = index === 0 ? baseToPermit2 : quoteToPermit2;
    steps.push({
      id: token.side === "base" ? "approveBaseTokenPermit2" : "approveQuoteTokenPermit2",
      kind: "approvePermit2",
      side: token.side,
      tokenId: token.tokenId,
      tokenEvmAddress: token.evm,
      tokenSymbol: token.symbol,
      done: allowance > 0n,
      detail: formatAllowance(allowance, token.decimals),
    });
  });

  sides.forEach((token, index) => {
    const { amount, expiration } = index === 0 ? baseToReactor : quoteToReactor;
    // An approval that has expired is no approval at all, so check the expiry too.
    const live = amount > 0n && expiration * 1000 > now;
    steps.push({
      id: token.side === "base" ? "approveBaseTokenReactor" : "approveQuoteTokenReactor",
      kind: "approveReactor",
      side: token.side,
      tokenId: token.tokenId,
      tokenEvmAddress: token.evm,
      tokenSymbol: token.symbol,
      done: live,
      detail:
        amount === 0n
          ? "none"
          : expiration * 1000 <= now
            ? `expired ${new Date(expiration * 1000).toLocaleDateString()}`
            : `${formatAllowance(amount, token.decimals)} until ${new Date(expiration * 1000).toLocaleDateString()}`,
    });
  });

  // Ordered so the UI walks the user through associate → Permit2 → reactor per token.
  const ordered: OnboardingStepId[] = [
    "associateBaseToken",
    "approveBaseTokenPermit2",
    "approveBaseTokenReactor",
    "associateQuoteToken",
    "approveQuoteTokenPermit2",
    "approveQuoteTokenReactor",
  ];
  steps.sort((a, b) => ordered.indexOf(a.id) - ordered.indexOf(b.id));

  return {
    steps,
    complete: steps.every(step => step.done),
    next: steps.find(step => !step.done) ?? null,
  };
};

/** Human-readable label for a step, used by the checklist and the docs. */
export const stepLabel = (step: OnboardingStep): string => {
  switch (step.kind) {
    case "associate":
      return `Associate ${step.tokenSymbol}`;
    case "approvePermit2":
      return `Approve ${step.tokenSymbol} to Permit2`;
    case "approveReactor":
      return `Allow the reactor to spend ${step.tokenSymbol}`;
  }
};

export const stepExplanation = (step: OnboardingStep): string => {
  switch (step.kind) {
    case "associate":
      return "Hedera accounts must associate a token before they can hold it. Without this, a fill could not pay you.";
    case "approvePermit2":
      return "Settlement pulls your funds through Permit2, so the token itself must allow Permit2 to move it.";
    case "approveReactor":
      return "Permit2 then grants the settlement contract a capped, expiring allowance. Nothing can move more than this, and only until it expires.";
  }
};
