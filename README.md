# limit-orders — the reference client for SaucerSwap's V3 order book on Hedera

Add non-custodial limit orders from SaucerSwap's order book to any Hedera app, with every fill verified
on-chain against what you signed.

Scaffold it:

```bash
npm create scaffold-hbar@latest --template OrderForge/scaffold-hbar-limit-orders
```

> **Status:** the market terminal, onboarding, the HCS journal, wallet login, order placement and
> cancellation, and fill verification are all implemented. Remaining: the live depth WebSocket, the
> `clob:doctor` conformance check, and the docs pass — see `.harness/prds/`.

## Disclaimer

This template — contracts, frontend and tooling — is **experimental** and **not audited**. It places
orders against a third-party venue, and defaults to Hedera **testnet**. Do not use it in production
without your own security review, and read SaucerSwap's
[V3 Orderbook Risk Notice](https://docs.saucerswap.finance/legal/orderbook-risk-notice) and
[Terms of Service](https://docs.saucerswap.finance/legal/terms-of-service) before trading real funds.

## 60-second demo, no keys

```bash
yarn install
yarn next:dev
```

Open <http://localhost:3000/markets>. Market discovery, depth, the trade tape and quotes are **public**
endpoints: no wallet, no API key, no deployed contract.

Testnet markets are thin and often halted, so the terminal has a **Testnet / Mainnet** toggle for market
data. Reading mainnet prices moves no funds; wallet actions stay on your wallet's own network.

> **Why requests go through this app's own `/api/clob` route:** the Orderbook API sends no CORS headers,
> so a browser cannot call it directly however public the endpoint is — it is built for server-side
> clients. The app forwards the request from its server instead. The proxy holds no credentials. See
> [docs/DISCREPANCIES.md](docs/DISCREPANCIES.md).

## What this is

SaucerSwap runs a central limit order book (V3) on Hedera, separate from its AMM pools. It has a public
HTTP API and **no published client library**. This template is that client, plus a working UI on top of it.

- **Market data** — books, depth, the trade tape and quotes, with each market's trading rules (tick, size
  step, lot, minimum notional) applied correctly.
- **Onboarding** — before it can trade, a Hedera account must associate the tokens, approve them to
  Permit2, and approve the reactor inside Permit2. The template detects each step and does it in one click.
- **Account** — wallet-challenge login, your own fee rates, your orders and their history. The token is
  short-lived and held in memory only: never localStorage, never a cookie, never logged.
- **Orders** — build, sign (EIP-712) and submit; cancel through the API or directly on-chain.
- **Journal** — every signed intent goes to an HCS topic before submission, giving you your own
  consensus-timestamped record of what you signed.
- **Verification** — every fill is checked on-chain against the order you signed: price, fee cap,
  deadline, size and recipient.

### What you still trust SaucerSwap for

Matching happens off-chain, and only SaucerSwap's filler can settle your order, so the venue decides the
order in which orders match and whether your order is accepted at all. What the contract does guarantee is
that no fill can break the terms you signed, and that you can cancel on-chain without asking anyone. This
template verifies the second part and is explicit about the first.

## Architecture

| Piece | Where |
| --- | --- |
| Typed API client | `packages/nextjs/lib/clob/` |
| Same-origin API proxy | `packages/nextjs/app/api/clob/[network]/[...path]` |
| Mirror node reads | `packages/nextjs/lib/mirror/` |
| Wallet login | `packages/nextjs/lib/clob/auth.ts` — token in memory only |
| Onboarding checks | `packages/nextjs/lib/hedera/onboarding.ts` |
| HCS journal | `packages/nextjs/lib/journal/` + `app/api/journal` (the only place holding a Hedera key) |
| Order build/sign/cancel | `packages/nextjs/lib/clob/orders.ts` |
| Fill verification | `packages/nextjs/lib/verify/fills.ts` |
| Scripts | `packages/hardhat/scripts/` — `clob:bootstrap`, `clob:fund`, `clob:status`; `clob:doctor` _(coming)_ |

## Full setup (for the on-chain half)

```bash
yarn hardhat:account:generate        # or bring your own ECDSA key
# fund it at https://portal.hedera.com/faucet, then:
cp packages/hardhat/.env.example packages/hardhat/.env    # add HEDERA_OPERATOR_ID / _KEY
yarn clob:bootstrap                  # creates the HCS journal topic, prints its id
# copy the printed JOURNAL_TOPIC_ID lines into packages/nextjs/.env
yarn clob:fund                       # swaps a little HBAR into the market's two tokens
yarn clob:status                     # verifies all of the above, says what is left
```

Then open a market page: the **ready-to-trade** checklist shows the six on-chain steps, each with a
HashScan link, and **sign an intent (dry run)** signs an order in your wallet and writes it to the
journal without sending it anywhere.

### Verified live on testnet

| What | Evidence |
| --- | --- |
| HCS journal topic | [`0.0.10646020`](https://hashscan.io/testnet/topic/0.0.10646020) |
| Permit2 onboarding (4 transactions) | [SAUCE→Permit2](https://hashscan.io/testnet/transaction/0x490de469a1d0f08a825a80a79c8c6b12a9ca840939ea6f7239831fdffda37083), [Permit2→reactor](https://hashscan.io/testnet/transaction/0x0e9462293d2374b80222f2dba26b6868a538899cb34d5682e5ca49135de2379d), [USDC→Permit2](https://hashscan.io/testnet/transaction/0xdfa33dfdba54534f33d37987224a4ad6d89b9db4f1e1a729c99e2148f031a512), [Permit2→reactor](https://hashscan.io/testnet/transaction/0x488f4b370b19eaf740be8f7293cf35cd06f38bd0ccb4ca3a52f0d815f6d8c994) |
| Order placed and cancelled | order 3494124 on book 3, 2026-09-19 |

## Prerequisites

- Node.js ≥ 20.18.3, Git
- Yarn 3 — the repo pins it. If `yarn` is missing, enable Node's bundled Corepack once:
  `corepack enable`. No global install and no sudo needed. If you would rather not touch
  your global setup, the repo carries its own copy: `node .yarn/releases/yarn-3.2.3.cjs <command>`
- A Hedera-compatible wallet for the on-chain steps — [MetaMask](https://metamask.io/) or
  [HashPack](https://www.hashpack.app/). Market data needs none.
- [WalletConnect project ID](https://cloud.reown.com) in `packages/nextjs/.env` (a shared fallback works
  for local demos)

## Environment

Copy `packages/hardhat/.env.example` → `packages/hardhat/.env` and `packages/nextjs/.env.example` →
`packages/nextjs/.env`. No secret is needed for market data.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLOB_NETWORK` | frontend | `testnet` (default) or `mainnet` |
| `NEXT_PUBLIC_CLOB_API_URL` | frontend | Override the Orderbook API base, e.g. for a proxy |
| `NEXT_PUBLIC_MIRROR_URL` | frontend | Hedera mirror node |
| `NEXT_PUBLIC_DEFAULT_ORDERBOOK_ID` | frontend | Market shown by default |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | frontend | WalletConnect project id |
| `NEXT_PUBLIC_JOURNAL_TOPIC_ID` | frontend | HCS topic the journal reads |
| `JOURNAL_TOPIC_ID` | server | HCS topic the journal writes to |
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` | server | Pays for journal messages. **Never** prefix the key with `NEXT_PUBLIC_` |
| `DEPLOYER_PRIVATE_KEY` | hardhat | Only for the on-chain scripts; never committed |

## Wallet setup (only needed for on-chain steps)

**MetaMask — Hedera Testnet**

| Field | Value |
| --- | --- |
| Network Name | Hedera Testnet |
| RPC URL | `https://testnet.hashio.io/api` |
| Chain ID | `296` |
| Currency Symbol | HBAR |
| Explorer | `https://hashscan.io/testnet` |

Fund it from the [Hedera Portal faucet](https://portal.hedera.com/faucet). EIP-712 order signing needs an
**ECDSA** account, since ED25519 accounts have no EVM address.

## Hedera value handling

| Context | Unit | 1 HBAR equals |
| --- | --- | --- |
| JSON-RPC (sending a tx) | wei | 10^18 |
| Contract `msg.value` | tinybars | 10^8 |
| Conversion | 1 tinybar = 10^10 wei | |

`packages/nextjs/utils/hedera/valueConversion.ts` is the only place that converts.

## Commands

```bash
yarn next:dev                   # frontend, hot reload
yarn next:build
yarn next:check-types
yarn hardhat:compile
yarn hardhat:test
yarn test:clob                  # unit tests, offline against captured fixtures
yarn lint
yarn format

yarn clob:bootstrap             # create the HCS journal topic (idempotent)
yarn clob:status                # check API, contracts, operator and journal
yarn clob:fund --hbar 20        # swap HBAR into a market's tokens
```

## Project structure

```
packages/hardhat/
  scripts/       account tooling, generateTsAbis.ts, and the clob:* scripts (coming)
  deploy/        hardhat-deploy scripts
packages/nextjs/
  app/           markets terminal (coming), debug, api routes
  components/    scaffold-hbar wallet + address components
  hooks/         scaffold-hbar contract hooks
  lib/           clob / mirror / journal / verify (coming)
  utils/hedera/  tinybar-wei conversion, shared constants
  contracts/     deployedContracts.ts (generated), externalContracts.ts (manual)
.harness/        harness spec, increment PRDs, validators
```

## Troubleshooting

### CORS errors with hashio.io RPC

Set `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` in `packages/nextjs/.env` to a CORS-enabled endpoint (for example
[Arkhia](https://arkhia.io/)), or rely on wallet-connected operations, since wallets handle RPC internally.

### Deployer shows an EVM address, not a Hedera account id

`yarn hardhat:account:generate` prints the `0x…` form. Both that and `0.0.xxxxx` work with the
[faucet](https://portal.hedera.com/faucet).

## Links

- [SaucerSwap V3 Orderbook API](https://docs.saucerswap.finance/api-reference/orderbook/overview)
- [Hedera documentation](https://docs.hedera.com/)
- [HashScan explorer](https://hashscan.io/testnet)
- [Hedera Portal faucet](https://portal.hedera.com/faucet)

## Licence

MIT. See [LICENSE](LICENSE).
