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
