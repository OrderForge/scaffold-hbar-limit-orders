# Security

This template is **experimental** and **not audited**. It signs orders that move real tokens on
mainnet, so read this before you build on it or host it.

## Reporting a vulnerability

Report it privately through GitHub: **Security → Report a vulnerability** on this repository. Please do
not open a public issue for it. Say what is affected, how to reproduce it, and what an attacker would
gain.

Problems in SaucerSwap's API, settlement contract or Permit2 deployment are outside this repository.
Report those to SaucerSwap. If one affects how this template behaves, tell us as well, and we will
handle it here and add it to [docs/DISCREPANCIES.md](docs/DISCREPANCIES.md).

## What the template does to keep you safe

**Keys**

- The wallet holds the trading key. The template never sees it: orders are EIP-712 typed data,
  signed in the wallet, which shows every field before you approve.
- The deployer key that the scripts use is stored password-encrypted in `packages/hardhat/.env`
  (`DEPLOYER_PRIVATE_KEY_ENCRYPTED`) by `yarn hardhat:account:generate` or `:import`.
- The journal's operator key (`HEDERA_OPERATOR_KEY`) is read only by the server route
  `app/api/journal`. It is never prefixed `NEXT_PUBLIC_`, so it never reaches the browser.
- `.env` files and `.clob.json` are gitignored. CI fails if one is ever tracked, and the Hedera
  Harness secret scan refuses to pass while one exists.

**Allowances**

- Token approvals to Permit2 default to 1,000 tokens, and you can change the amount before signing.
- Permit2's allowance for the settlement contract is capped at the same amount and expires after
  30 days.
- Native HBAR uses an HBAR allowance (HIP-906) of the amount you choose, not an unlimited one.

**Sessions and orders**

- The Orderbook API's sign-in token is short-lived and held in memory only. It is never written to
  disk or browser storage, and a reload means signing in again.
- Every order is checked against the market's tick, lot and minimum value before the wallet is asked
  to sign, and a halted market is refused before signing.
- Every fill is checked against what you signed: price, fee cap, deadline and size, read from the
  settlement on Hedera's mirror node.
- Every response from the API is validated against a schema before the app uses it.

## Hosting it publicly

A public URL needs more care than a local copy. See
[Hosting a public demo](README.md#hosting-a-public-demo):

- set `NEXT_PUBLIC_READ_ONLY_NETWORKS=mainnet`, so visitors cannot sign real-money orders through your
  site;
- turn the burner wallet off;
- either leave out `HEDERA_OPERATOR_KEY`, or put your own authentication in front of `/api/journal`.
  Its built-in limit, 10 requests a minute per caller, held in memory, stops a runaway loop. It is
  not access control.

## What it cannot protect you from

Matching happens off-chain, at SaucerSwap. The template proves that no fill broke the terms you
signed. It cannot prove that the venue matched you fairly, or that it will match you at all. See
[What this does not do](README.md#what-this-does-not-do).
