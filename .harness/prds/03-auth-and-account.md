# Increment 03 — Wallet-challenge auth, fees, onboarding, account orders

> **Amended 2026-09-19:** see `docs/kit/PLAN_TO_100.md` and RESEARCH_NOTES "PINNED — 2026-09-19". Those override this file where they differ.

**PIN THE DOCS FIRST.** Fetch `https://docs.saucerswap.finance/api-reference/orderbook/authentication.md`
and `.../developers/orderbook/typescript-client.md`. Record the exact request/response
shapes, the JWT lifetime, and the renewal rule into RESEARCH_NOTES under a `## PINNED —
auth (date)` heading. Do not implement from assumption.

## Deliverables
1. `lib/clob/auth.ts` — `POST /auth/challenge` → sign the challenge with the connected
   ECDSA account → `POST /auth/verify` → JWT. Held in **memory only** (React context or a
   module-scope store); never localStorage, never a cookie, never logged. Silent renewal
   before expiry; a single in-flight refresh; on 401 from a JWT endpoint, refresh once then
   surface a re-auth prompt.
2. Authenticated client wrapper: `withAuth(fn)` attaching `Authorization: Bearer`, with the
   401 → refresh → retry-once path.
3. `GET /fees/:orderbookId?side=maker|taker` — render as percentages via `pipsToPercent`;
   show both sides on the market page.
4. `GET /onboarding/:orderbookId/status` — surface whether the account can trade this
   market, and pair it with the association state from increment 2 into one "ready to
   trade" checklist component. This checklist is a strong README screenshot.
5. `GET /orders` and `GET /orders/:orderId/history` — `/orders` page listing open and past
   orders with status, filled amount, and per-order event history in a drawer. Poll on an
   interval; WebSocket comes in increment 4.
6. Errors: a typed error envelope mapped to user-facing messages; never surface a raw JSON
   blob. Rate-limit (429) handled with backoff and a visible "slow down" state.
7. Tests: auth state machine (challenge → verify → renew → expire → re-auth) against a
   mocked transport; 401-refresh-retry-once; fee rendering.

## Acceptance
Connecting a burner wallet authenticates end to end against testnet, the ready-to-trade
checklist reflects real association and onboarding state, and `/orders` lists the account's
orders (empty state included). No JWT is ever written to storage — grep the build output to
confirm.
