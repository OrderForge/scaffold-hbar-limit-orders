# Increment 2 — HTS association, HCS order journal, and the eligibility gate

> **Amended 2026-09-19:** see `docs/kit/PLAN_TO_100.md` and RESEARCH_NOTES "PINNED — 2026-09-19". Those override this file where they differ.

This increment produces the **verifiable testnet transaction** the bounty gate requires.
Read RESEARCH_NOTES §6.

## Deliverables
1. **Association detection** — `lib/hedera/association.ts`: given an account id and a
   market, read mirror `GET /accounts/{id}/tokens?token.id=` for the base and quote token
   ids; return `{ base: boolean, quote: boolean }`. Cache 10s.
2. **Associate action** — a client action using the connected wallet to associate a token
   (HTS `associateToken` via the system contract at `0x167`, or the SDK association
   transaction if the wallet connector supports it — prefer the EVM path so the burner
   wallet works headlessly). Success panel with the tx hash and a HashScan link; re-check
   association from the mirror node rather than trusting the receipt.
   On `/market/[id]`, block order entry behind an "Associate SAUCE / USDC" step and explain
   *why* Hedera requires it — this is the single most common new-trader failure and the
   explanation is part of the docs score.
3. **HCS journal**:
   - `packages/hardhat/scripts/bootstrap.ts` (`yarn clob:bootstrap`): idempotent; creates
     the journal topic (memo `limit-orders order intent journal`), writes `.clob.json`
     state at repo root, prints HashScan links. Re-running prints and exits.
   - `lib/journal/index.ts`: `buildIntent(order, book, eip712Hash)` →
     `schemas/order-intent.schema.json`; `submitIntent(record)` via
     `POST /api/journal` (server route holding `OPERATOR_ID`/`OPERATOR_KEY`, never client
     side); `listIntents(accountId?)` reading the topic through the mirror node with
     pagination + cache.
   - `/journal` page: table of intents (time, market, side, price, size, EIP-712 hash,
     status) with HashScan links to each HCS message. Filter by connected account.
   - In this increment the journal can be exercised with a **dry-run sign** action on
     `/market/[id]` ("sign intent without submitting") so the flow is demonstrable before
     increment 4 exists.
4. `yarn clob:status` — reads `.clob.json`, verifies the topic on the mirror node, prints
   ✓/✗ and the next command.
5. Tests: intent schema validation; journal record built from a fixture order; mirror
   pagination handling.

## Acceptance
- `yarn clob:bootstrap` on testnet creates the topic and is re-runnable.
- Associating a token from the UI produces a testnet tx whose HashScan link resolves, and
  the mirror node then lists the token for that account.
- A signed intent appears on `/journal` with its consensus timestamp.
- **Record the association tx link and the topic id — this is the gate evidence for submission.**
