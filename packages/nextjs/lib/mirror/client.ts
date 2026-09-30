/**
 * Hedera mirror node reads.
 *
 * The mirror node is how this template checks the venue's claims: association state,
 * balances, allowances and settlement logs all come from consensus data rather than from
 * the Orderbook API's own view of the world.
 */
import { ClobNetwork, ClobNetworkConfig, getNetworkConfig } from "../clob/config";
import { ClobError } from "../clob/errors";
import { parseResponse, request, withQuery } from "../clob/http";
import { z } from "zod";

export type TokenBalance = {
  tokenId: string;
  balance: string;
  /** True when the token arrived through automatic association rather than an explicit tx. */
  automaticAssociation: boolean;
  decimals?: number;
};

export type MirrorAccount = {
  accountId: string;
  evmAddress: string | null;
  balanceTinybars: string;
  /** -1 means unlimited automatic associations, the default for EVM-created accounts. */
  maxAutomaticTokenAssociations: number;
  keyType: string | null;
};

// The mirror node's shapes, reduced to the fields this template reads. Amounts arrive as
// JSON numbers; they are kept as strings or bigints from here on.
const amount = z.union([z.number(), z.string()]);

const accountSchema = z.object({
  account: z.string(),
  evm_address: z.string().nullish(),
  balance: z.object({ balance: amount }).nullish(),
  max_automatic_token_associations: z.number().nullish(),
  key: z.object({ _type: z.string() }).nullish(),
});

const tokenBalancesSchema = z.object({
  tokens: z
    .array(
      z.object({
        token_id: z.string(),
        balance: amount.nullish(),
        automatic_association: z.boolean().nullish(),
        decimals: amount.nullish(),
      }),
    )
    .default([]),
});

const cryptoAllowancesSchema = z.object({
  allowances: z.array(z.object({ spender: z.string(), amount: amount.nullish() })).default([]),
});

const contractResultSchema = z.object({
  timestamp: z.string().nullish(),
  logs: z.array(z.object({ address: z.string(), topics: z.array(z.string()), data: z.string() })).default([]),
});

/** A contract execution result: the logs a fill is verified from. */
export type ContractResult = z.infer<typeof contractResultSchema>;

const CACHE_MS = {
  account: 5_000,
  tokens: 10_000,
  allowances: 10_000,
  token: 300_000,
} as const;

export class MirrorClient {
  readonly config: ClobNetworkConfig;

  constructor(options: { network?: ClobNetwork; config?: ClobNetworkConfig } = {}) {
    this.config = options.config ?? getNetworkConfig(options.network);
  }

  private url(path: string) {
    return `${this.config.mirrorUrl}/api/v1${path}`;
  }

  /**
   * Accepts a `0.0.x` id or an EVM address — the mirror node resolves both.
   *
   * Null means **404**, and only that: the account has no record, which on Hedera means
   * it has never received HBAR. Every other failure throws. Swallowing them all would be
   * worse than useless here, because callers show "this address has no account yet" —
   * and a rate limit, an outage or a cancelled request would then be reported to the user
   * as a fact about their wallet.
   */
  async getAccount(accountIdOrEvm: string, signal?: AbortSignal): Promise<MirrorAccount | null> {
    try {
      const url = this.url(`/accounts/${accountIdOrEvm}`);
      const payload = parseResponse(
        accountSchema,
        await request<unknown>(url, { cacheMs: CACHE_MS.account, signal }),
        url,
      );
      return {
        accountId: payload.account,
        evmAddress: payload.evm_address ?? null,
        balanceTinybars: String(payload.balance?.balance ?? "0"),
        maxAutomaticTokenAssociations: payload.max_automatic_token_associations ?? 0,
        keyType: payload.key?._type ?? null,
      };
    } catch (cause) {
      if (cause instanceof ClobError && cause.status === 404) return null;
      throw cause;
    }
  }

  /**
   * Token balances for an account, optionally filtered to specific token ids.
   *
   * An account the mirror node has never seen answers 404 here. That is a state, not a
   * failure — it holds no tokens because it does not exist yet — so it returns an empty
   * list, matching how `getAccount` treats the same 404. Every other error still throws:
   * a rate limit or an outage must not be mistaken for "this account holds nothing".
   */
  async getTokenBalances(accountId: string, tokenIds?: string[], signal?: AbortSignal): Promise<TokenBalance[]> {
    const url = withQuery(this.url(`/accounts/${accountId}/tokens`), {
      limit: 100,
      "token.id": tokenIds?.length === 1 ? tokenIds[0] : undefined,
    });
    const raw = await request<unknown>(url, { cacheMs: CACHE_MS.tokens, signal }).catch((cause: unknown) => {
      if (cause instanceof ClobError && cause.status === 404) return { tokens: [] };
      throw cause;
    });
    const payload = parseResponse(tokenBalancesSchema, raw, url);
    const tokens: TokenBalance[] = payload.tokens.map(token => ({
      tokenId: token.token_id,
      balance: String(token.balance ?? "0"),
      automaticAssociation: Boolean(token.automatic_association),
      decimals: token.decimals !== undefined ? Number(token.decimals) : undefined,
    }));
    return tokenIds?.length ? tokens.filter(token => tokenIds.includes(token.tokenId)) : tokens;
  }

  /**
   * The HBAR allowance an account has granted a spender, in tinybars — what is left of it,
   * not what was first granted.
   *
   * This is native HBAR's equivalent of an ERC-20 `allowance`, which HBAR does not have.
   * The spender is named by its `0.0.x` id. An account with no record answers 404, which
   * means no allowance; any other failure throws.
   */
  async getHbarAllowance(owner: string, spenderId: string, signal?: AbortSignal): Promise<bigint> {
    const url = withQuery(this.url(`/accounts/${owner}/allowances/crypto`), { "spender.id": spenderId, limit: 1 });
    const raw = await request<unknown>(url, { cacheMs: CACHE_MS.allowances, signal }).catch((cause: unknown) => {
      if (cause instanceof ClobError && cause.status === 404) return { allowances: [] };
      throw cause;
    });
    const payload = parseResponse(cryptoAllowancesSchema, raw, url);
    const match = payload.allowances.find(allowance => allowance.spender === spenderId);
    return match ? BigInt(match.amount ?? 0) : 0n;
  }

  /**
   * Contract execution result with its logs — the basis for verifying a fill.
   *
   * Null means the mirror node has no result for that hash yet, which is normal for a few
   * seconds after settlement. Other failures throw, so "not verified yet" is never
   * confused with "could not reach the mirror node".
   */
  async getContractResult(transactionHash: string, signal?: AbortSignal): Promise<ContractResult | null> {
    const url = this.url(`/contracts/results/${transactionHash}`);
    try {
      return parseResponse(contractResultSchema, await request<unknown>(url, { cacheMs: CACHE_MS.token, signal }), url);
    } catch (cause) {
      if (cause instanceof ClobError && cause.status === 404) return null;
      throw cause;
    }
  }
}

/** Links to HashScan. Every on-chain action in this template shows one. */
export const hashscan = (config: ClobNetworkConfig) => ({
  transaction: (hashOrId: string) => `${config.hashscanUrl}/transaction/${hashOrId}`,
  account: (accountId: string) => `${config.hashscanUrl}/account/${accountId}`,
  token: (tokenId: string) => `${config.hashscanUrl}/token/${tokenId}`,
  contract: (contractId: string) => `${config.hashscanUrl}/contract/${contractId}`,
  topic: (topicId: string) => `${config.hashscanUrl}/topic/${topicId}`,
});
