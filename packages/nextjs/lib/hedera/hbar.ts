/**
 * Native HBAR, as the Orderbook API and the settlement contracts name it.
 *
 * Some markets — mainnet HBAR/USDC is the busiest — trade native HBAR rather than a token.
 * The API reports it as token `0.0.0` at the zero address, and the reactor's currency
 * library treats that address as native. Three things follow, none of them documented:
 *
 * - There is nothing to associate: every Hedera account can hold HBAR.
 * - HBAR is not an ERC-20, so it has no `approve` or `allowance`. Calling either at the
 *   zero address fails. Permit2 instead spends a native Hedera **HBAR allowance** granted
 *   to it (`CryptoApproveAllowance`), through the HTS precompile's `cryptoTransfer`.
 * - Balances come from the account itself, not from its token list.
 *
 * Everything that touches a market's tokens asks `isNativeHbar` first.
 */

export const NATIVE_HBAR_TOKEN_ID = "0.0.0";
export const NATIVE_HBAR_ADDRESS = "0x0000000000000000000000000000000000000000";

/** True for either of the API's names for native HBAR: `0.0.0` or the zero address. */
export const isNativeHbar = (tokenIdOrAddress: string | null | undefined): boolean =>
  tokenIdOrAddress === NATIVE_HBAR_TOKEN_ID || tokenIdOrAddress?.toLowerCase() === NATIVE_HBAR_ADDRESS;

/**
 * HIP-906's `hbarApprove`, which grants an HBAR allowance from inside the EVM.
 *
 * A wallet cannot send `CryptoApproveAllowance` itself, but HIP-906 gives every account a
 * proxy: a call to the account's **own EVM address** is redirected to the Hedera Account
 * Service system contract (0x16a) — the same trick as HIP-719's `associate()` on a token's
 * address. Two details matter:
 *
 * - The target is the account's EVM alias. Its long-zero form (`0x000…<num>`) is not
 *   redirected; a call there returns nothing.
 * - The call must come from that account, which is what a wallet sending to its own
 *   address does anyway.
 *
 * `amount` is in tinybars. The call returns a Hedera response code; 22 is SUCCESS.
 */
export const IHRC632_ABI = [
  {
    type: "function",
    name: "hbarApprove",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "int256" },
    ],
    outputs: [{ name: "responseCode", type: "int64" }],
  },
  {
    type: "function",
    name: "hbarAllowance",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }],
    outputs: [
      { name: "responseCode", type: "int64" },
      { name: "amount", type: "int256" },
    ],
  },
] as const;

/** The contract call that grants `spender` an HBAR allowance of `tinybars` from `owner`. */
export const hbarApproveCall = (owner: `0x${string}`, spender: `0x${string}`, tinybars: bigint) => ({
  address: owner,
  abi: IHRC632_ABI,
  functionName: "hbarApprove" as const,
  args: [spender, tinybars] as const,
});
