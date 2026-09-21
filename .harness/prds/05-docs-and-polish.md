# Increment 05 — Docs (30 points), polish, harness tiers, video

Docs are the second-largest block in the rubric. Give this increment the same time as a
feature increment. The test: hand the README to someone who has never seen the repo; they
must reach a running app **and** be able to explain the pattern back to you.

## `README.md`
1. Title, one-liner, three screenshots (ladder, ready-to-trade checklist, journal).
2. **60-second demo, no keys:** scaffold → `yarn install` → `yarn next:dev` → `/markets`.
3. **Full setup:** account generate → faucet → `yarn clob:bootstrap` → associate → place → cancel.
4. **Architecture** (mermaid): browser → `lib/clob` → SaucerSwap Orderbook API; browser →
   wallet → EIP-712; server route → HCS journal; mirror node → association/balances.
5. **Modes** — testnet-live (default), mainnet-read, seeded; switch by
   `NEXT_PUBLIC_CLOB_API_URL` alone; honest tradeoffs.
6. **Why this integration is load-bearing** — the 35-point argument, stated plainly: the V3
   CLOB has no published client library; this template is the reference client; remove
   SaucerSwap and nothing remains.
7. Scripts table, environment table (client vs server vars), project layout.
8. **What this does not do** — no AMM swaps, no LP, no strategies, no P&L; cancellation
   finality caveat; the keyless-read rollout caveat.
9. Harness section: which tiers are enabled and how to run `npx hedera-harness validate`.
10. Licence: MIT.

## `docs/`
- `microstructure.md` — tick, lot, size step, min notional, **pips vs basis points**,
  maker/taker, crossed and locked books, why depth must be reconciled by `lastUpdateId`.
  This is the file that proves the template teaches a pattern rather than wrapping an API.
- `integration.md` — endpoint-by-endpoint map with auth requirements and the shapes as
  pinned, plus the 401/keyless-rollout behaviour.
- `hedera.md` — association explained, the HCS journal design and why an off-chain book
  benefits from an on-ledger intent record, ECDSA-vs-ED25519 for EIP-712.
- `DISCREPANCIES.md` — anything the live API did differently from the docs.

## `AGENTS.md`
Purpose, key-paths table, commands, the money rules (strings/bigint, never float), the
"key on id not symbol" rule, how to add a market or an order type, JWT handling rules.

## Hygiene
`LICENSE` MIT. `.gitignore` covers `.env*` and `.clob.json` (commit `.clob.json.example`).
`.github/workflows/ci.yml`: install, lint, compile, both test suites, build — no deploy, no
network-dependent tests (the fixtures make the unit tests offline-safe). Vercel deploy
button with env hints.

## Harness
Enable `chainValidation`, run Tiers 2/3/3.5 with ECDSA operator env vars, fix findings. Run
the official gate self-check script and keep its output for the submission notes.

## Video (≤3 min)
0:00 problem — SaucerSwap runs a CLOB on Hedera and there is no client for it → 0:20
`npm create` → 0:40 `/markets` and a live ladder with zero keys → 1:10 associate, with the
HashScan link → 1:40 place an order, show the EIP-712 prompt and the HCS intent → 2:20
cancel → 2:40 `docs/microstructure.md` and harness validate green.

## Acceptance
Fresh machine, README only, everything works. All validators green. Submission includes
repo URL, the testnet tx link from increment 2, harness spec + validators, dev-ex survey,
video.
