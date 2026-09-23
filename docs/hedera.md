# The Hedera half: what is actually verifiable

SaucerSwap's order book matches off-chain and settles on-chain. That split decides what a
client can prove and what it can only take on trust, and this template is built around
drawing that line honestly rather than blurring it.

## The trust boundary

```
  you                    SaucerSwap                      Hedera
  ───                    ──────────                      ──────
  sign an order   ──────▶ matching engine
  (EIP-712)               (off-chain, private)
                                │
                                ▼
                          reactor contract  ──────────▶  settlement
                          (on-chain)                     fills, fees, transfers
                                                              │
  verify  ◀───────────────────────────────────────────────────┘
  (mirror node)
```

**What the chain guarantees.** The reactor will not settle a fill that breaks the order you
signed. It reverts on a fee above your signed cap, on a fill after your deadline, on an
order you cancelled on-chain, and on any attempt to fill more than you authorised. Your
funds stay in your wallet until a fill settles, pulled through a capped, expiring Permit2
allowance.

**What it does not guarantee.** Matching happens off-chain, and only SaucerSwap's own
filler can settle your order — the server inserts a validation contract into every order
that gates who may fill it. So the venue decides the order in which orders match, whether
your order is accepted at all, and how quickly. None of that is observable from here.

So the honest claim is: **no fill can break the terms you signed, and you can always
cancel on-chain without asking anyone.** Not "trustless", not "fully on-chain". This
template verifies the first part and states the second plainly, in the UI and in the
README.

## Four Hedera services, each doing a job

### HTS — token association and allowances

A Hedera account cannot hold a token until it is **associated** with it. Accounts created
from an EVM address default to unlimited automatic associations, so for most wallets this
step is already satisfied and forcing a transaction would waste the user's HBAR — the
checklist detects that and says so rather than offering a pointless button.

Allowances matter more. Settlement pulls funds through Permit2, so each token needs an
allowance to Permit2 before anything can trade.

### Smart contracts — the reactor and Permit2

Six on-chain steps sit between a funded wallet and a first order, and **SaucerSwap's
documentation mentions none of them**. We found them by reading the reactor's verified
source and seeing `permit2.transferFrom` in the settlement path:

| Step | What it does |
| --- | --- |
| Associate base token | lets the account hold it |
| Associate quote token | same |
| Approve base → Permit2 | lets Permit2 move that token |
| Approve quote → Permit2 | same |
| Permit2 approves reactor for base | a capped, expiring allowance to the settlement contract |
| Permit2 approves reactor for quote | same |

`GET /onboarding/:id/status` reports exactly these six flags, which is how we confirmed the
reading. But this template **derives them independently** from the mirror node and direct
contract reads, and shows both. If the venue's view and the chain ever disagree, the chain
wins and the UI says so. A client that silently followed the API would hide precisely the
failure worth catching.

Approvals default to **bounded and expiring** — an amount you choose, valid 30 days — never
unlimited. The live API accepts bounded approvals; there is no reason to sign away more.

### HCS — the order intent journal

Every order this template signs is written to a Hedera Consensus Service topic **before**
it is sent to SaucerSwap:

```json
{ "type": "CLOB-Order-Intent", "version": "1.0.0", "action": "place",
  "account": "0.0.10619385", "orderbookId": "3", "side": "SELL",
  "price": "1", "size": "10", "nonce": "1", "ts": "2026-09-21T11:00:00.000Z" }
```

**What it proves:** what you signed, and when, ordered by consensus rather than by the
venue's clock. The topic is public, so anyone can audit it from the mirror node without
this app, and no one — including the venue — can alter or reorder an entry after the fact.

**What it does not prove:** that the venue matched you fairly. It is your record of your
own side.

Its real job is to be the **reference the fill verifier checks against**. Without it,
verification compares the venue's record of your order to the venue's settlement of it,
which is the venue marking its own homework. With it, the comparison starts from something
you wrote down first.

Two design notes:

- **The signature is never journalled**, only the order's terms. Publishing a signature
  would let anyone replay a real order.
- **The journal must never block a trade.** If the topic write fails, the order still goes
  and the UI shows a "journal pending" state. A record-keeping failure is not a reason to
  stop someone trading.
- **The operator pays**, not the trader, so nobody needs HBAR to keep a record of what they
  signed. That makes the write endpoint something that spends money on request, so it is
  rate limited — and a production deployment should put its own quota in front of it.

SaucerSwap's own order records carry an `hcsInitialTransactionId` field, empty in
everything we saw. If they start populating it, the interesting move is to show both
records side by side: two independent anchors of the same order is a stronger story than
either alone.

### Mirror node — checking rather than trusting

The mirror node is how every claim in this template gets checked against consensus data:
association state, balances, allowances, and the settlement logs behind fill verification.
It is public, needs no key, and unlike the Orderbook API it sends CORS headers, so the
browser reads it directly.

## Fill verification, concretely

Each settlement emits `TakerFill` or `MakerFill` from the reactor, carrying the order hash,
the amounts and the fee. Those logs are on Hedera, so the checks do not depend on the venue
reporting its own behaviour:

| Check | Question |
| --- | --- |
| order hash | does this fill settle the order in your journal? |
| price | is the output at least the ratio your order required? |
| fee cap | is the fee within the maximum you signed? |
| deadline | did it happen before your order expired? |
| size | do the fills together stay within what you authorised? |
| recipient | did the proceeds go where the order said? |

The price check holds on partial fills too: half the input must return at least half the
output. All of it is integer arithmetic — the fee check compares `fee × 1e6 ≤ cap × filled`
rather than dividing, because rounding a rate to whole pips lets a fee fractionally above
the cap read as compliant. That was a real bug here, caught by a test.

## ECDSA, not ED25519

EIP-712 order signing needs an EVM address, so the account must be **ECDSA**. ED25519
Hedera accounts have no EVM alias and cannot sign orders this way.

For API login both work, but they need different signing schemes — see
[integration.md](./integration.md#authentication).

## An address is not yet an account

On Hedera an address comes into existence when it first receives HBAR. Before that, the
mirror node has no record of it and the network will not let it do anything — and both
facts are reported in ways that read like bugs:

- `GET /accounts/{address}` answers **404**, and so does `/accounts/{address}/tokens`.
- An HTS token's ERC-20 `allowance(owner, spender)` **reverts** for such an owner, with
  the raw bytes `0x494e5641…` — ASCII `INVA`, the start of `INVALID_ACCOUNT_ID`. viem
  cannot decode it, so it surfaces as "reverted with signature 0x494e5641".

This is the first thing a new user of this template hits, because the burner wallet
creates exactly such an address. The onboarding check therefore resolves the account
first, and when there is no record it says so rather than running six reads that all
fail. Any other mirror-node error is still shown as an error: an outage must not be
mistaken for an empty account.

## Why this belongs on Hedera

Not because an order book needs a ledger — it does not, and SaucerSwap's runs off-chain.
The argument is narrower and, I think, more honest:

1. **Settlement is cheap and final enough to verify every fill individually.** On a chain
   with expensive finality you would batch, and per-fill verification would be impractical.
2. **HCS gives a user-side audit trail for fractions of a cent**, so keeping your own
   ordered record of what you signed costs nothing worth mentioning.
3. **The mirror node makes verification free and public.** Anyone can re-run every check in
   this template without an API key, an account, or this app.

Those three together are what make "every fill verified against what you signed" a feature
you can ship rather than a claim you make.
