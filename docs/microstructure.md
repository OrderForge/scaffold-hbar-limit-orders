# Order book microstructure, the parts that bite

Everything here is a rule a real market enforces and a beginner's client gets wrong. Each
section says what the rule is, what SaucerSwap's V3 order book does specifically, and where
this template handles it. Most of these cost us a bug before they became a paragraph.

If you read one section, read [minimum notional](#minimum-notional-the-units-trap) — it is
the one that silently blocked every order we tried to place on mainnet.

## What an order book is, in one paragraph

A limit order book is a list of offers. Buyers post **bids**, sellers post **asks**, and
each offer says "this much of this token, at this price or better". A trade happens when a
new order crosses an existing one. The **best bid** is the highest price anyone will pay,
the **best ask** the lowest anyone will accept, and the gap between them is the **spread**.
Nothing about this is Hedera-specific; what is specific is that SaucerSwap matches orders
off-chain and settles the result on-chain, which is why this template checks the settlement
rather than trusting the match. See [hedera.md](./hedera.md).

## Tick size: prices live on a grid

A market does not accept any price — only multiples of its **tick**. SAUCE/USDC on testnet
ticks at `0.0000001`, so `0.0428608` is a valid price and `0.04286085` is not.

Two things follow that are easy to miss:

**The tick can be finer than the quote token.** That market quotes in USDC, which has 6
decimals, but ticks at 7 decimal places. Parse the price at the token's precision and the
last digit vanishes — the order is silently mispriced, and an off-tick price passes
validation because the check now compares two truncated numbers. This template keeps prices
at their own scale (`PRICE_SCALE` in
[`lib/clob/format.ts`](../packages/nextjs/lib/clob/format.ts)) for exactly this reason.

**Rounding direction is a decision.** Rounding a price up can spend more than the user
agreed to, so every rounding here truncates toward zero and the UI shows the nearest
allowed value rather than silently adjusting.

## Lot size and size step: quantities live on a grid too

Two separate rules, often confused:

- **`sizeStep`** is the smallest increment of quantity, like the tick but for size.
- **`lotSize`** is the smallest tradeable unit, expressed in the base token's **smallest
  units**. Testnet SAUCE/USDC reports `10000000` with a 6-decimal token, which is 10 SAUCE.

That is why every level of the real book is a multiple of 10 SAUCE. An order for 27 SAUCE
is not "close enough"; it is invalid.

## Minimum notional: the units trap

`minNotional` is the smallest total value an order may carry — price times size, in the
quote token. Every mainnet market reports:

```json
{ "minNotional": "15000000", "quoteTokenDecimals": 6 }
```

That is **15 USDC**, in smallest units, exactly like `lotSize`. It is not the decimal
number fifteen million.

We got this wrong. Reading it as a decimal demanded 15 million USDC on mainnet, which
blocks every order a human would ever place, and 1 USDC on testnet where the real minimum
is 0.000001 — quietly rejecting valid orders. The error message made it worse by quoting
raw units back at the user: *"Order value 0.01 is below the minimum of 15000000"*.

The general rule, which holds across this API: **anything that describes a quantity of
tokens is in smallest units; anything that describes a price is a decimal.** When a field
could be either, check it against a market whose decimals you know.

## Pips, not basis points

Fee rates come as **pips**: 1 pip = 1e-6 = 0.0001%.

```
takerFeePips: 2000   →   0.2%
```

Read as basis points — the common assumption — 2000 becomes 20%, a hundredfold error in
the user's favour, right up until they submit. `pipsToPercent` exists so this conversion
happens in one place.

`capFractionPips` uses the same scale but is not a fee: it caps a maker's rebate as a
fraction of taker fees.

## Crossed books

A **crossed** book has its best bid at or above its best ask, which should be impossible —
those two orders should have traded with each other. The spread goes negative.

It happens anyway, and we captured it live on testnet book 3: best bid 0.0430518 against
best ask 0.0425864, a spread of −1.09%. The likely cause is AMM routing (below), where two
different pricing mechanisms feed one book.

A client has three options: hide it, crash on it, or show it. This template shows it, with
an explicit **crossed** badge, because an order placed into a crossed book behaves
differently from one placed into a normal spread and the trader deserves to know.

**Locked** books, where bid equals ask exactly, are the same family of problem.

## AMM routing

Some SaucerSwap markets set `isAMMEnabled: 1`, which blends liquidity from the AMM pool
into the order book. Depth then mixes resting limit orders with pool quotes, and an order
can settle against either.

Two consequences: it is a likely source of crossed books, and it is **opt-in per order** —
`/orders/build` takes an `isAMMEnabled` flag, so an order can be restricted to order-book
liquidity. The template exposes that as a checkbox rather than hardcoding it.

## Maker, taker, and post-only

You are a **maker** when your order rests on the book and someone else trades against it,
and a **taker** when you cross the spread and consume someone else's order. Makers
usually pay less, and may earn a rebate.

**Post-only** (`makerOnly`) means: never take. If the order would cross on arrival, reject
it rather than fill it as a taker. It is how you guarantee the maker fee.

## Depth reconciliation: why a snapshot is not enough

Polling a snapshot gives you a book that is always slightly stale. Streaming diffs gives
you a book that is current but only if you never miss one. The standard fix is to combine
them, and SaucerSwap's `/ws/depth` follows the usual shape:

```json
{ "firstUpdateId": 3706528, "finalUpdateId": 3706528,
  "bids": [["0.0428617", "0"], ["0.0428588", "360"]], "asks": [] }
```

A size of `"0"` **removes** that price level; any other size **replaces** it outright.
Never add.

The procedure, implemented in [`lib/clob/depth.ts`](../packages/nextjs/lib/clob/depth.ts):

1. Subscribe first, and buffer every diff that arrives.
2. Fetch the REST snapshot, which carries a `lastUpdateId`.
3. Drop buffered diffs whose `finalUpdateId` is at or below the snapshot's.
4. The first diff you apply must straddle `lastUpdateId + 1`.
5. After that, each diff must start exactly where the previous one ended.
6. Any gap means you have missed an update. There is no repair: fetch a new snapshot.

Step 6 is the one people skip. A book with a missed update looks fine and is wrong, which
is worse than a book that is visibly stale.

[`lib/clob/depthStream.ts`](../packages/nextjs/lib/clob/depthStream.ts) implements this
against the live stream, and the UI says which source it is showing — "streaming" or
"polling" — because the difference matters to anyone reading prices. Two details worth
copying: the gapped diff is **discarded** rather than re-applied after the new snapshot
(re-applying it gaps again, which is an infinite loop), and the socket falls back to
polling after a few failed reconnects rather than leaving a frozen book on screen.

The stream needs a JWT, so a keyless page cannot use it. That is the API's constraint, not
a design choice, and it is why polling exists at all here.

## A quiet book is not a broken book

A thin market can hold the same best bid and ask for minutes. Mainnet HBAR/USDC advanced
its sequence number every 6–10 seconds across a 20-second sample without the touch moving
once.

That matters for UI honesty: without some visible sign of life, a working feed and a frozen
one look identical. This template flashes changed levels, shows how old the data is, and
displays the book's update sequence, which advances even when no price does.

## Market states

Three states, from two fields, which is one more field than you would expect:

| State | How to tell |
| --- | --- |
| OPEN | `status: "OPEN"` and `isMarketHalted: 0` |
| HALTED | `status: "OPEN"` and `isMarketHalted: 1` |
| CLOSED | `status: "CLOSED"` |

A halted market still reports `status: "OPEN"`. Worse, `/orders/build` succeeds while
halted and only `/orders/save` fails — so a client that checks `status` alone will ask the
user to sign an order that cannot possibly be submitted. Check the halt flag **before**
requesting a signature.

## Further reading

- [integration.md](./integration.md) — the endpoint map and the shapes as they really are
- [hedera.md](./hedera.md) — settlement, onboarding, and what is actually verifiable
- [DISCREPANCIES.md](./DISCREPANCIES.md) — where the live API differs from its own docs
