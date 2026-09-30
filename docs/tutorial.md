# Build it yourself: limit orders on Hedera, in seven chapters

This walks you from an empty folder to a filled order you have verified on-chain yourself,
one step at a time. Each chapter says what to run, what you should see, and which file to
read to understand it. The early chapters need no wallet and no keys; the later ones use
testnet only, with test tokens.

About an hour, end to end. Chapters 0 and 1 take five minutes and need nothing at all.

> **Testnet is sometimes halted.** SaucerSwap's testnet market (book 3, SAUCE/USDC) stops
> accepting orders when its settlement service runs low on HBAR. The template says so on
> the market page. Chapters 0–4 work regardless; for 5 and 6, check that the market shows
> **OPEN**, and if it does not, ask in SaucerSwap's Discord — that is how it was reopened
> the last time.

| Chapter | You will | Needs |
| --- | --- | --- |
| [0](#chapter-0--scaffold-it) | Scaffold the template and run it | nothing |
| [1](#chapter-1--read-a-market-with-no-keys) | Read live markets and put a price in your own component | nothing |
| [2](#chapter-2--an-account-and-some-test-tokens) | Create a testnet account and buy test tokens | the faucet |
| [3](#chapter-3--connect-and-get-ready-to-trade) | Connect a wallet and complete the six onboarding steps | Chapter 2 |
| [4](#chapter-4--turn-on-the-journal) | Record signed intents on Hedera Consensus Service | Chapter 2 |
| [5](#chapter-5--place-watch-and-cancel-an-order) | Place an order, watch every step, cancel it | Chapters 3–4 |
| [6](#chapter-6--get-a-fill-and-verify-it) | Get a fill and check it against what you signed | Chapter 5 |
| [7](#chapter-7--make-it-yours) | Switch features off, build a ladder, extend it | anything |

---

## Chapter 0 — Scaffold it

```bash
npm create scaffold-hbar@latest -- --template OrderForge/scaffold-hbar-limit-orders
cd <your-project>
yarn next:dev
```

The `--` matters: without it npm keeps `--template` for itself and you get the default
template. If `yarn` is missing, run `corepack enable` once, or use the copy the project
carries: `node .yarn/releases/yarn-3.2.3.cjs next:dev`.

**You should see** the landing page at <http://localhost:3000>.

**Checkpoint:** the page loads and **Open the markets** takes you to a table.

---

## Chapter 1 — Read a market with no keys

Open **Markets**. Every row is a live SaucerSwap order book, read from public endpoints —
no wallet, no API key, no deployed contract. Use the **Testnet / Mainnet** toggle to read
mainnet, where the books are deeper; reading mainnet moves no funds.

Open **HBAR/USDC** on mainnet. You are looking at:

- the **depth chart** and **ladder**: cumulative bids and asks, and every price level;
- the **spread** and **mid**;
- the **trade tape**, each trade linked to its settlement transaction on HashScan;
- the **market rules**: tick size, lot size, minimum order value and fees, which every
  order must satisfy.

**Put a live price in your own component.** The hooks handle fetching, polling and
streaming; this is all it takes:

```tsx
import { useLiveDepth } from "~~/hooks/clob/useLiveDepth";
import { useBook } from "~~/hooks/clob/useMarketData";

export const BestPrices = ({ id }: { id: string }) => {
  const { data: book } = useBook(id);
  const { depth, source } = useLiveDepth(id);
  if (!book || !depth) return null;
  return (
    <p>
      {book.baseTokenSymbol}/{book.quoteTokenSymbol}: bid {depth.bestBid} · ask {depth.bestAsk} ({source})
    </p>
  );
};
```

`source` reads `polling` until you sign in (Chapter 5), then `stream`: the WebSocket needs
a token.

**Read next:**
[`lib/clob/client.ts`](../packages/nextjs/lib/clob/client.ts) (the typed API client),
[`lib/clob/format.ts`](../packages/nextjs/lib/clob/format.ts) (money, ticks and lots, all
in `bigint`), and [microstructure.md](./microstructure.md) — especially *minimum notional*,
which is in the token's smallest units, not a decimal.

**Checkpoint:** `yarn clob:doctor` reports that every API assumption still holds.

---

## Chapter 2 — An account and some test tokens

The on-chain steps need an **ECDSA** testnet account holding HBAR, SAUCE and USDC.

```bash
yarn hardhat:account:generate      # or: yarn hardhat:account:import
yarn hardhat:account               # shows the address and its balance
```

Fund the address at the [Hedera Portal faucet](https://portal.hedera.com/faucet). On Hedera
an address becomes an account when it first receives HBAR, and not before — see
[hedera.md](./hedera.md#an-address-is-not-yet-an-account).

The faucet only gives HBAR. Buy both sides of the testnet market with some of it:

```bash
yarn clob:fund --hbar 20          # swaps HBAR into SAUCE and USDC through SaucerSwap
```

**Checkpoint:** the account's page on [HashScan](https://hashscan.io/testnet) lists SAUCE
and USDC alongside its HBAR.

---

## Chapter 3 — Connect and get ready to trade

Use the same account in your browser. Add Hedera Testnet to MetaMask (the settings are in
the README under *Wallet setup*), then import the key:

```bash
yarn hardhat:account:reveal-pk    # prints the key; import it into MetaMask
```

Keep this key for testnet. Open **SAUCE/USDC** on testnet, connect with MetaMask, and find
**Ready to trade**. Before SaucerSwap can settle an order, an account needs six things on
Hedera — three per token:

1. **associate** the token, so the account can hold it;
2. **approve** it to Permit2, which moves funds at settlement;
3. let **Permit2 grant the settlement contract** a capped, expiring allowance.

None of this is in SaucerSwap's docs; it was read from the settlement contract's source.
Click **Do it** on each step and approve in MetaMask. Every tick is read back from the
mirror node and the contracts, not from the venue's word.

Markets that trade **native HBAR** (mainnet HBAR/USDC) work differently: nothing to
associate, and an HBAR allowance instead of an approve — see
[`lib/hedera/hbar.ts`](../packages/nextjs/lib/hedera/hbar.ts).

**Read next:** [`lib/hedera/onboarding.ts`](../packages/nextjs/lib/hedera/onboarding.ts).

**Checkpoint:** the panel shows a green **ready** badge.

---

## Chapter 4 — Turn on the journal

Every order the template signs is written to a Hedera Consensus Service topic *before* it
reaches the venue, so you keep your own consensus-timestamped record of what you signed.
The topic needs an operator account to pay for messages — the account from Chapter 2 is
fine. Put its `0.0.x` id and key in `packages/hardhat/.env`, then:

```bash
yarn clob:bootstrap               # creates the topic and prints its id
```

Copy the lines it prints into `packages/nextjs/.env`, along with the same
`HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY`. The key stays on the server: it is read by
`app/api/journal` and never sent to the browser. Restart `yarn next:dev`.

On a market page, **Sign an intent (dry run)** signs an order in your wallet and journals
it without sending it anywhere. Then open **Journal**.

**Read next:** [`lib/journal/`](../packages/nextjs/lib/journal) and
[`app/api/journal`](../packages/nextjs/app/api/journal).

**Checkpoint:** `yarn clob:status` finds the topic and the operator's balance, and your
intent appears in the journal with its consensus time and an EIP-712 hash.

---

## Chapter 5 — Place, watch and cancel an order

On the testnet market, click **Sign in to the API** and approve the message in MetaMask.
The token that comes back is short-lived and held in memory only. The depth badge switches
from **polling** to **streaming**.

In **Place an order**, place a buy that **cannot fill**: a price well below the best bid —
say half of it — and a size of `10`. The ticket checks tick, lot and minimum value before
it asks your wallet for anything; try an off-tick price to see it refuse.

Click **Buy SAUCE** and watch the steps fill in:

1. **Built by the venue** — with the order's nonce;
2. **Signed in your wallet** — an EIP-712 signature;
3. **Intent journalled to HCS** — with the topic and sequence number, linked;
4. **Accepted by the venue** — with the order id;
5. **Filled on Hedera** — waits here: nobody will sell at your price.

Open **Orders**, find the order, and click **cancel**. The button says **cancel requested**
first: a `202` is an acknowledgement, not a cancellation, and an order that is still live
can still fill. A few seconds later the row reads **CANCELED**; **history** shows why.

**Read next:** [`hooks/clob/usePlaceOrder.ts`](../packages/nextjs/hooks/clob/usePlaceOrder.ts)
and [`lib/clob/orderProgress.ts`](../packages/nextjs/lib/clob/orderProgress.ts).

**Checkpoint:** the order is **CANCELED**, and its intent is still in the journal.

---

## Chapter 6 — Get a fill and verify it

Now place a buy that **will** fill: untick **post-only** (so it may take liquidity) and set
the price a little above the best ask on the ladder, with a size of `10`.

Watch the last two steps complete:

5. **Filled on Hedera** — linked to the settlement transaction;
6. **Checked against what you signed** — the fill is read from the mirror node and checked
   for price, fee cap, deadline and size.

Open the order's **history** for the full checks. Two things make this harder than it
looks, and both were found by real fills:

- **A settlement transaction is not your receipt.** The filler batches matches, so one
  transaction can carry several traders' fills. Yours are picked out by swapper and nonce.
- **Makers pay their fee out of the output token.** A maker's reported output is after the
  fee; the price check adds it back.

**Read next:** [`lib/verify/fills.ts`](../packages/nextjs/lib/verify/fills.ts) and
[hedera.md](./hedera.md#fill-verification-concretely).

**Checkpoint:** the history shows your fill **verified**, and the settlement opens on
HashScan.

---

## Chapter 7 — Make it yours

**Switch a feature off, or remove it:**

```bash
yarn clob:feature list
yarn clob:feature off depth-chart       # gone from the page in seconds, no reload
yarn clob:feature on depth-chart
yarn clob:feature remove depth-chart    # previews; --yes deletes it and every reference
```

**Build on the library.** Everything the UI uses works on its own. A buy ladder — five
orders stepping down from a price, every rung checked against the market's rules before
anything is signed:

```ts
import { roundToTick, validateOrder } from "~~/lib/clob/format";
import { Orderbook } from "~~/lib/clob/types";

export const buyLadder = (market: Orderbook, start: number, stepPercent: number, size: string) =>
  Array.from({ length: 5 }, (_, rung) => {
    const raw = (start * (1 - (stepPercent / 100) * rung)).toFixed(12);
    const price = roundToTick(raw, market.tickStep);
    return { price, size, check: validateOrder({ price, size }, market) };
  });
```

Feed each valid rung to `place("BUY", price, size)` from `usePlaceOrder`, one at a time, and
every rung gets its own nonce, journal entry and verification.

**Where to go from here:** the README's
[What you could build with it](../README.md#what-you-could-build-with-it) lists six starting
points, each with the file to open first. If you work with a coding agent, point it at
[AGENTS.md](../AGENTS.md): the money rules and the mistakes that are easy to make here.
