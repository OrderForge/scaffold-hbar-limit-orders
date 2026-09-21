# Increment 04 — Order placement, cancellation, live depth and fills

> **Amended 2026-09-19:** see `docs/kit/PLAN_TO_100.md` and RESEARCH_NOTES "PINNED — 2026-09-19". Those override this file where they differ.

**PIN THE DOCS FIRST.** Fetch `.../api-reference/orderbook/orders.md`,
`.../api-reference/orderbook/websockets.md`, `.../api-reference/orderbook/limits-and-errors.md`.
Record the `/orders/build` and `/orders/save` bodies, the **EIP-712 order struct and
domain**, nonce handling, cancellation finality (including "reactor cancellation"), the
WebSocket subscribe protocol and message envelopes, and the policy limits into
RESEARCH_NOTES under `## PINNED — orders/ws (date)`.

## Deliverables
1. **Order entry** on `/market/[id]`: side, price, size, order type as the API supports.
   Validation runs **before** any signature request, using increment 1's `validateOrder`
   plus live balance from the mirror node; the error names the rule that failed. Show the
   computed notional, the fee at the account's rate, and the total.
2. **Placement flow**: `GET /signature/domain` (cached per environment) → `POST /orders/build`
   (server-assigned nonces) → EIP-712 sign in the wallet → **journal the intent to HCS**
   (increment 2) → `POST /orders/save`. If the journal write fails, still allow submission
   but show a "journal pending" banner and expose a retry; never block a trade on the
   journal.
3. **Cancellation**: `POST /cancel` for selected ids; `/cancel/all` behind a confirm dialog
   (cut-list item). Reflect cancellation finality honestly — show "cancel requested" until
   the API/stream confirms, never an optimistic "cancelled".
4. **`/ws/depth`**: subscribe, reconcile against the REST snapshot via `lastUpdateId`
   (buffer diffs, drop those at or below the snapshot id, apply the rest, re-snapshot on a
   gap), exponential-backoff reconnect, and a visible connection state. Fall back to
   polling automatically when the socket cannot connect — and say so in the UI.
5. **`/ws/user-events`**: fills and order state changes update `/orders` live; toast on
   fill. (Cut-list item — polling is an acceptable fallback.)
6. Tests: depth reconciliation (snapshot + in-order diffs; out-of-order diff; gap forcing a
   re-snapshot) against synthetic fixtures derived from `samples/depth-3.json`; order build
   → sign → save happy path and each failure path against a mocked transport; validation
   blocking before signature.

## Acceptance
On testnet, place a limit order far from the touch, see it in `/orders`, see its intent in
`/journal`, then cancel it and see both the cancel and the final state. Depth updates live
and survives a forced socket drop by falling back to polling.
