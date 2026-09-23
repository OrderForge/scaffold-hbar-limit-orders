/**
 * Hedera mirror node reads.
 *
 * The mirror node is how this template checks the venue's claims: association state,
 * balances, allowances and settlement logs all come from consensus data rather than from
 * the Orderbook API's own view of the world.
 */
import { ClobNetwork, ClobNetworkConfig, getNetworkConfig } from "../clob/config";
import { ClobError } from "../clob/errors";
import { request, withQuery } from "../clob/http";

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
      const payload = await request<any>(this.url(`/accounts/${accountIdOrEvm}`), {
        cacheMs: CACHE_MS.account,
        signal,
      });
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
    const payload = await request<any>(url, { cacheMs: CACHE_MS.tokens, signal }).catch((cause: unknown) => {
      if (cause instanceof ClobError && cause.status === 404) return { tokens: [] };
      throw cause;
    });
    const tokens: TokenBalance[] = (payload.tokens ?? []).map((token: any) => ({
      tokenId: token.token_id,
      balance: String(token.balance ?? "0"),
      automaticAssociation: Boolean(token.automatic_association),
      decimals: token.decimals !== undefined ? Number(token.decimals) : undefined,
    }));
    return tokenIds?.length ? tokens.filter(token => tokenIds.includes(token.tokenId)) : tokens;
  }

  /** HTS allowances granted by this account (the token → Permit2 step). */
  async getTokenAllowances(
    accountId: string,
    signal?: AbortSignal,
  ): Promise<{ tokenId: string; spender: string; amount: string }[]> {
    const payload = await request<any>(
      withQuery(this.url(`/accounts/${accountId}/allowances/tokens`), { limit: 100 }),
      {
        cacheMs: CACHE_MS.allowances,
        signal,
      },
    );
    return (payload.allowances ?? []).map((allowance: any) => ({
      tokenId: allowance.token_id,
      spender: String(allowance.spender),
      amount: String(allowance.amount ?? "0"),
    }));
  }

  /**
   * Contract execution result with its logs — the basis for verifying a fill.
   *
   * Null means the mirror node has no result for that hash yet, which is normal for a few
   * seconds after settlement. Other failures throw, so "not verified yet" is never
   * confused with "could not reach the mirror node".
   */
  async getContractResult(transactionHash: string, signal?: AbortSignal): Promise<any | null> {
    try {
      return await request<any>(this.url(`/contracts/results/${transactionHash}`), { cacheMs: CACHE_MS.token, signal });
    } catch (cause) {
      if (cause instanceof ClobError && cause.status === 404) return null;
      throw cause;
    }
  }
}

export const mirrorClient = (network?: ClobNetwork) => new MirrorClient({ network });

/** Links to HashScan. Every on-chain action in this template shows one. */
export const hashscan = (config: ClobNetworkConfig) => ({
  transaction: (hashOrId: string) => `${config.hashscanUrl}/transaction/${hashOrId}`,
  account: (accountId: string) => `${config.hashscanUrl}/account/${accountId}`,
  token: (tokenId: string) => `${config.hashscanUrl}/token/${tokenId}`,
  contract: (contractId: string) => `${config.hashscanUrl}/contract/${contractId}`,
  topic: (topicId: string) => `${config.hashscanUrl}/topic/${topicId}`,
});
