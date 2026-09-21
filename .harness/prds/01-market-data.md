# Increment 1 — Market data terminal (no wallet, no deployment)

> **Amended 2026-09-19:** see `docs/kit/PLAN_TO_100.md` and RESEARCH_NOTES "PINNED — 2026-09-19". Those override this file where they differ.

Read RESEARCH_NOTES §2–§4 and study `docs/kit/samples/books.json` and `depth-3.json`: those
are real testnet captures and are the fixtures for this increment's tests.

## Deliverables
1. `packages/nextjs/lib/clob/client.ts` — typed client. Base URL from
   `NEXT_PUBLIC_CLOB_API_URL` (default `https://testnet-orderbook-api.saucerswap.finance`).
   `getBooks()`, `getDepth(id)`, `getTrades(id)`. Retry with backoff on 429/5xx; 5s cache
   on books, 1s on depth. **If a public endpoint returns 401**, throw a typed
   `PublicReadUnavailableError` so the UI can explain that this network still requires a
   JWT for market data (the keyless rollout is per-network).
2. `packages/nextjs/lib/clob/types.ts` — zod schemas matching `schemas/*.json`. Every
   numeric stays a **string** at the boundary.
3. `packages/nextjs/lib/clob/format.ts` — the money layer, and the most-tested file here:
   - `parseAmount(str, decimals) -> bigint` and `formatAmount(bigint, decimals)`.
   - `roundToTick(price, tickStep)`, `roundToLot(size, sizeStep, lotSize)`.
   - `validateOrder({price,size}, book) -> { ok } | { ok:false, rule:'tick'|'size'|'lot'|'minNotional', message }`.
   - `pipsToPercent(pips)` — 1 pip = 1e-6, so 2000 → "0.2%".
   - `notional(price, size)` using bigint, never float.
4. `packages/nextjs/lib/clob/depth.ts`:
   - `normalizeDepth(snapshot)` — sort bids descending and asks ascending **client-side**
     (the API's arrays are not reliably monotonic), compute cumulative sizes, max cumulative
     for bar widths (guard divide-by-zero), and `isCrossed = bestBid >= bestAsk`.
   - `applyDiff(book, diff)` stub keyed on `lastUpdateId` — wired up in increment 4, but
     write it now so the type is settled.
5. Pages:
   - `/markets` — table of books: pair (from symbols, **display only**), id, status badge
     (OPEN / CLOSED / HALTED / AMM), quotePrice, 24h change/high/low, 24h volumes,
     maker/taker fee as %, tick and min notional. Sort OPEN first. Empty and error states.
   - `/market/[id]` — depth ladder (bids left / asks right or stacked on mobile) with
     cumulative bars, best bid/ask, spread with **crossed badge** when negative, market
     metadata panel (tick/size/lot/minNotional/fees/decimals/token ids with HashScan
     links), and the trade tape. Poll depth every 2s with a visible "live" indicator;
     pause polling when the tab is hidden. `Market not found` state for unknown ids.
   - Home page: what the template is, link to `/markets`, note that everything here is
     read-only and keyless.
6. `packages/nextjs/lib/mirror/client.ts` — mirror client (retry, cache, `hashscanUrl()`),
   used from increment 2 onward; add it now.
7. Tests (`yarn workspace @sh/nextjs test:clob`, vitest) against `samples/`:
   tick/lot/minNotional validation matrix; `pipsToPercent`; bigint notional with 6- and
   8-decimal tokens; `normalizeDepth` on the captured **crossed** book asserting
   `isCrossed === true` and correctly sorted ladders; unknown-market handling;
   401-on-public-read producing `PublicReadUnavailableError`.
8. `.env.example`: `NEXT_PUBLIC_CLOB_API_URL`, `NEXT_PUBLIC_MIRROR_URL`,
   `NEXT_PUBLIC_HASHSCAN_URL`, `NEXT_PUBLIC_DEFAULT_ORDERBOOK_ID=3`.

## Acceptance
`yarn next:build` and `test:clob` green. `/markets` and `/market/3` render live testnet data
with no wallet, no contracts, no keys. No NaN, no Infinity, no unhandled rejection. The
crossed book renders as a badge, not a bug.
