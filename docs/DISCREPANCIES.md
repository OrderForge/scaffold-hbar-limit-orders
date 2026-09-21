# Where the live API differs from its documentation

Every item below was found by calling the SaucerSwap V3 Orderbook API and reading the
reactor's verified source, then comparing against
[the published docs](https://docs.saucerswap.finance/api-reference/orderbook/overview).
Each one is handled in code and covered by a test or a fixture in
`packages/nextjs/test/`.

Verified on testnet and mainnet, 2026-09-19 → 2026-09-21.

## 1. The API sends no CORS headers, so no browser can call it directly

The market-data endpoints are public and need no key, which reads as "usable from a web
app". They are not: no response carries `Access-Control-Allow-Origin`, on either network,
so a browser blocks every cross-origin call with `TypeError: Failed to fetch`. The
documentation is written for server-side bots, where this never comes up.

**What this template does:** requests from the browser go through a same-origin route,
`app/api/clob/[network]/[...path]`, which forwards them from the server. Node callers —
scripts, tests, the bot — skip the proxy and call the API directly. The proxy holds no
credentials, forwards an `Authorization` header untouched if the caller sends one, and
passes the upstream status and body through unchanged so typed errors keep their meaning.

## 2. `POST /orders/build` needs a wrapper object

Documented as taking a bare array of order requests. The live API answers
`400 {"error":"orderRequests array is required and must not be empty"}` unless the body is
`{ "orderRequests": [ ... ] }`.

## 3. The EIP-712 order struct is not documented anywhere

The docs say to sign the order returned by `/orders/build`, but never give the type. It was
read from the reactor's verified source (`PartialFillLimitOrderReactor`, Sourcify):

```
PartialFillLimitOrder(OrderInfo info,PartialFillInputToken input,OutputToken output,
                      bool makerOnly,bool takerOnce,uint32 maxTakerFeePips,uint32 maxMakerFeePips)
OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,
          address additionalValidationContract,bytes additionalValidationData)
OutputToken(address token,uint256 amount,address recipient)
PartialFillInputToken(address token,uint256 amount)
```

Signatures carry a one-byte mode prefix (`0x00` for EIP-712). Confirmed end to end: the
server accepted an order signed from this type on 2026-09-19.

## 4. Trading requires six on-chain steps the docs never mention

Settlement pulls funds through **Permit2**, so an account cannot trade until it has
associated both tokens, approved each to Permit2, and approved the reactor inside Permit2.
`GET /onboarding/:id/status` reports exactly these six, but no documentation page explains
them. Accounts created from an EVM address associate automatically, so the association
steps may already be satisfied.

## 5. Market ids are strings, not numbers

`OrderbookItem.id` is documented as `number`; every response serves a string. The schema
accepts both and normalises to a string.

## 6. Error bodies come in three shapes

`{"error": "..."}` on most routes, `{"message": "..."}` on the auth routes, and an Express
HTML page for routes that are not mounted. Anything parsing blindly as JSON breaks on the
third.

## 7. A closed market and an unknown id are indistinguishable from `/depth`

Both answer `404 {"error":"Orderbook N not found or not open"}`. Only `/books` can tell
them apart, so the market pages decide state there and treat a depth 404 as "no depth".

## 8. A halted market still reports `status: "OPEN"`

The halt lives in `isMarketHalted`, so reading `status` alone shows a market as tradeable
when it is not. `/orders/build` still succeeds while halted; `/orders/save` then fails with
`400 "Orderbook 3 is currently halted and not accepting new orders"`. The UI therefore
blocks signing on a halted market rather than letting someone sign an order that cannot be
submitted.

## 9. An empty book returns a quote with no price protection

On a book with no liquidity, `quote/exact-input` answers `fillable: false` **and**
`suggestedOutputAmount: "1"` — the exact value the docs warn never to sign, since it
accepts any price at all. The client refuses to build an order from a quote unless
`fillable` is true.

## 10. Cancellation event names differ between surfaces

The user-event stream emits `ORDER_CANCELED`; `GET /orders/:id/history` records the same
event as `CANCELED`. The docs use the former for both. Order ids are also strings in the
save response and the stream, but numbers in `/orders` and history.

## 11. `spreadPercent` is measured against the mid price

Not against the bid or the ask. Confirmed against captured snapshots on both networks. It
is negative when the book is crossed, which is a real state, not an error: testnet book 3
was observed with the best bid above the best ask.

## 12. Fees are pips, and the docs are right — but it is worth repeating

1 pip = 1e-6 = 0.0001%, so `takerFeePips: 2000` is 0.2%. Read as basis points, which is the
common assumption, that becomes 20% — a hundredfold error in the user's favour right up
until they submit.
