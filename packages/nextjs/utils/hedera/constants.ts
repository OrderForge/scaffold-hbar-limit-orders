/**
 * Shared constants for the limit-orders template.
 */

// Polling. The public market-data endpoints are served from a short-lived cache,
// so polling faster than this only burns rate limit.
export const DEPTH_POLL_INTERVAL_MS = 1500;
export const BOOKS_POLL_INTERVAL_MS = 8000;

// Gas limits for the on-chain onboarding steps (Hedera needs an explicit limit).
export const GAS_LIMITS = {
  ASSOCIATE: 800_000n,
  APPROVE_PERMIT2: 1_000_000n,
  PERMIT2_APPROVE_REACTOR: 1_000_000n,
  CANCEL_ORDER_ONCHAIN: 1_000_000n,
} as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
