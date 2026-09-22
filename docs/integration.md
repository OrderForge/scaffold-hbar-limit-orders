# Integrating with SaucerSwap's V3 order book

What the API looks like in practice, how this template wraps it, and what to copy if you
are building your own client. Everything here was checked against the live service; where
it contradicts SaucerSwap's documentation, [DISCREPANCIES.md](./DISCREPANCIES.md) says so
and why.

## Two APIs, one name

SaucerSwap runs two unrelated HTTP APIs. Mixing them up wastes an afternoon.

| | Legacy REST API | **V3 Orderbook API** |
| --- | --- | --- |
| Host | `api.saucerswap.finance` | `*orderbook-api.saucerswap.finance` |
| Auth | `x-api-key`, obtained by email | wallet challenge → JWT |
| Covers | tokens, pools, farms, prices | markets, depth, orders, fills |
| Used here | no | **yes, exclusively** |

## Environments

| | Testnet | Mainnet |
| --- | --- | --- |
| API | `https://testnet-orderbook-api.saucerswap.finance` | `https://orderbook-api.saucerswap.finance` |
| Mirror node | `https://testnet.mirrornode.hedera.com` | `https://mainnet.mirrornode.hedera.com` |
| Chain id | 296 | 295 |
| Reactor | `0x5707B946EE64bD750A587261Ce36ec7024F3088B` | `0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C` |
| Permit2 | `0x2e2C4f4277183F2BC5eb982CD4cD27C1fb01c6Ed` | `0x8D53a86b10b503f284A0EA9e8316bc6081432A96` |

The reactor address is not a constant to trust: it is the `verifyingContract` from
`GET /signature/domain`, and Permit2 is whatever `reactor.permit2()` returns on-chain.
`yarn clob:doctor` re-checks both so a redeployment cannot go unnoticed.

Market ids differ between networks. Testnet SAUCE/USDC is book 3; mainnet SAUCE/USDC is
book 2.

## The browser problem, first

**No endpoint sends `Access-Control-Allow-Origin`.** The public market-data routes need no
key, which reads as "usable from a web app", but a browser blocks every direct call with
`TypeError: Failed to fetch`. The API is built for server-side bots and the docs never
mention it.

This template forwards browser requests through its own origin
([`app/api/clob/[network]/[...path]`](../packages/nextjs/app/api/clob)). Node callers —
scripts, tests, a bot — skip the proxy and call the API directly. The proxy holds no
credentials, allows only known path prefixes, and passes the upstream status and body
through unchanged so typed errors keep meaning what they mean.

If you are building a browser client against this API, you need the same hop. There is no
configuration that avoids it.

## Endpoint map

Public. No key, no wallet:

| Endpoint | Returns | Notes |
| --- | --- | --- |
| `GET /books` | every market | ids are strings, despite the docs |
| `GET /depth/:id` | full depth snapshot | 404 for closed **and** unknown ids |
| `GET /trades/:id` | recent fills | `amountBase` is human-readable, not raw |
| `GET /books/:id/quote/exact-input` | simulated buy | check `fillable` before using it |
| `GET /books/:id/quote/exact-output` | simulated sell | same |
| `GET /signature/domain` | EIP-712 domain | the source of the reactor address |

Authenticated, JWT required:

| Endpoint | Returns | Notes |
| --- | --- | --- |
| `POST /auth/challenge` | a nonce to sign | |
| `POST /auth/verify` | the JWT | six-hour lifetime |
| `GET /fees/:id?side=` | this account's rates | in pips |
| `GET /onboarding/:id/status` | six readiness flags | see [hedera.md](./hedera.md) |
| `GET /orders` | this account's orders | flattened shape, numeric ids |
| `GET /orders/:id/history` | per-order events | the final word on a cancel |
| `POST /orders/build` | nonce-assigned orders to sign | body must be `{ orderRequests: [...] }` |
| `POST /orders/save` | submits signed orders | balance checked here, not at build |
| `POST /cancel` | 202 acknowledgement | not a confirmation |
| `/ws/depth`, `/ws/user-events` | live streams | JWT in the query string |

## Authentication

```
POST /auth/challenge  { "accountId": "0x610041…" }
  → { "message": "Sign this message from SaucerSwap. Nonce: 3dc78b18-…" }

sign the message with the wallet

POST /auth/verify     { "accountId": "0x610041…", "signature": "0x…" }
  → { "token": "eyJ…" }
```

Two identifier formats, and they need **different signing schemes**:

- an **EVM address** with a plain EIP-191 `personal_sign` — what a browser wallet does
  naturally, and what this template uses;
- a **`0.0.x` account id** with Hedera's own signing scheme (`\x19Hedera Signed Message:\n`),
  which a browser wallet will not produce.

Sending a `0.0.x` id with a `personal_sign` signature fails with `401 Invalid signature`.

The token lasts six hours. This template keeps it **in memory only** — no localStorage, no
cookie, never logged — so a reload costs one wallet click rather than leaving a bearer
token on disk. WebSocket URLs carry the token in the query string, which is why full
WebSocket URLs must never be logged either.

## Placing an order

```
GET  /signature/domain          → the EIP-712 domain, cached per environment
POST /orders/build              → the server assigns the nonce, may clamp the deadline
     sign the returned struct   → EIP-712, prefixed with the 0x00 mode byte
POST /orders/save               → submitted
```

Three details that each cost an order if missed:

1. **Sign what came back, not what you sent.** The server assigns the nonce and inserts an
   `additionalValidationContract` of its own.
2. **Keep the mode byte.** A signature is `0x00` followed by the 65-byte ECDSA signature.
   The reactor reads that prefix to choose a verifier; strip it and the order cannot fill.
3. **A buy and a sell are mirror images, not a flag.** A sell spends base and receives
   quote; a buy does the reverse. The EIP-712 struct has no "side" field — the side *is*
   which token goes in which slot.

The order type is not published anywhere. It was read from the reactor's verified source:

```
PartialFillLimitOrder(OrderInfo info,PartialFillInputToken input,OutputToken output,
                      bool makerOnly,bool takerOnce,uint32 maxTakerFeePips,uint32 maxMakerFeePips)
OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,
          address additionalValidationContract,bytes additionalValidationData)
OutputToken(address token,uint256 amount,address recipient)
PartialFillInputToken(address token,uint256 amount)
```

Because the type is not published, this template writes it out twice — in TypeScript for
the client and in Solidity in
[`OrderDigest.sol`](../packages/hardhat/contracts/OrderDigest.sol) — and `yarn hardhat:test`
asserts the two produce the same digest for a real built order. A transcription error in a
type nobody publishes would otherwise surface as a signature the reactor rejects for
reasons that look like anything else.

The `output.amount` is a **minimum**. That is what gives a signed order its price
protection, and it is why the fill verifier can check a fill against the order rather than
against the venue's word ([`lib/verify/fills.ts`](../packages/nextjs/lib/verify/fills.ts)).

## Cancelling

`POST /cancel` returns **202**, which means "accepted", not "cancelled":

```json
{ "status": "PENDING", "accepted": [3494124], "skipped": [] }
```

The order is gone when its history says `CANCELED`, or the user-event stream says
`ORDER_CANCELED` — the same event, spelled differently on each surface. Until then the UI
should say "cancel requested", because an order that is still live can still fill.

The reactor also exposes `cancelOrder` on-chain, callable by the swapper. That is the exit
that does not depend on the venue being reachable.

## Errors

Three shapes, and a client that assumes JSON breaks on the third:

```
{"error":   "Orderbook 3 is currently halted and not accepting new orders"}   most routes
{"message": "Invalid signature"}                                             auth routes
<html><body><pre>Cannot GET /books/999999</pre></body></html>                unmounted routes
```

Status codes behave normally, with one exception worth handling deliberately: a **401 on a
public endpoint** does not mean "log in". Keyless market data is being rolled out network
by network, so it means "this network has not had the rollout yet". This template raises a
distinct `PublicReadUnavailableError` and explains that, rather than showing a login prompt
nobody can satisfy.

Policy limits: 5,000 open orders per wallet, deadlines from 30 seconds to 90 days, 250
orders per build or save, 500 per cancel.

## What to copy

`packages/nextjs/lib/clob/` has no React in it and no dependency on this app. If you are
building something else against this API, the files worth taking wholesale:

| File | Why |
| --- | --- |
| `format.ts` | the money layer: bigint everywhere, price scale independent of token decimals, validation that names the rule it broke |
| `depth.ts` | sorting, cumulative depth, crossed detection, snapshot-plus-diff reconciliation |
| `http.ts` | retry with backoff, response cache, the three error shapes mapped to typed errors |
| `orders.ts` | side-to-amounts mapping, the EIP-712 type, the mode byte |
| `types.ts` | zod schemas written against real payloads, permissive about unknown fields |

The same modules run in the browser and in Node, which is how the scripts in
`packages/hardhat/scripts/` reuse them.

## The other Hedera order books

The bounty brief names two more DEXes, and they are genuinely different animals rather than
drop-in alternatives:

- **Lambdaplex** matches off-chain and settles on-chain, with its own protocol — including
  oracle-proof hooks for stop and take-profit orders that SaucerSwap has no equivalent of.
- **SilkSuite** (the 2025 merger of HSuite and SilkSwap) executes through "Smart Nodes",
  deliberately outside Hedera smart contracts.

This template is deliberately not an aggregator. Its spine — Permit2 onboarding, an EIP-712
struct read from a verified reactor, and fill verification against that reactor's events —
is specific to how SaucerSwap settles. On SilkSuite there would be no on-chain fill to
verify at all, so the central claim would not survive the port.

What *would* carry over is the general half: the money layer, depth reconciliation,
pre-signature validation, the HCS journal, and the habit of checking the venue's claims
against consensus data. Those are the parts worth lifting into a client for any of the
three.
