/**
 * `yarn clob:doctor` — check that the live API still behaves the way this template expects.
 *
 * Templates live in documentation for years; the APIs they wrap do not hold still. Every
 * row below is an assumption this code depends on, most of them written down in
 * docs/DISCREPANCIES.md. When one changes, this says which, rather than leaving the next
 * person to discover it through a broken page.
 *
 *   yarn clob:doctor                    # public checks, no key needed
 *   yarn clob:doctor --network mainnet
 *   yarn clob:doctor --place            # also builds, signs and cancels a real order
 *
 * Exit code 1 if any assumption has changed, so it can run on a schedule.
 */
import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const NETWORK = arg("network", process.env.HEDERA_NETWORK === "mainnet" ? "mainnet" : "testnet");

const CONFIG = {
  testnet: {
    api: "https://testnet-orderbook-api.saucerswap.finance",
    rpc: process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api",
    reactor: "0x5707B946EE64bD750A587261Ce36ec7024F3088B",
    permit2: "0x2e2C4f4277183F2BC5eb982CD4cD27C1fb01c6Ed",
    chainId: 296,
  },
  mainnet: {
    api: "https://orderbook-api.saucerswap.finance",
    rpc: "https://mainnet.hashio.io/api",
    reactor: "0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C",
    permit2: "0x8D53a86b10b503f284A0EA9e8316bc6081432A96",
    chainId: 295,
  },
}[NETWORK as "testnet" | "mainnet"];

type Result = { ok: boolean; name: string; detail: string; kind: "contract" | "condition" };
const results: Result[] = [];

/**
 * A failed **contract** check means the API no longer behaves the way this template was
 * built against: something needs fixing, so the run exits non-zero.
 *
 * A failed **condition** check means the network is quiet right now — every market halted,
 * say. That is worth reporting but it is not a defect, and a scheduled run that cried wolf
 * about it would quickly be ignored.
 */
const check = (name: string, ok: boolean, detail: string, kind: "contract" | "condition" = "contract") => {
  results.push({ ok, name, detail, kind });
  const mark = ok ? "✓" : kind === "condition" ? "!" : "✗";
  console.log(`  ${mark} ${name}`);
  if (!ok || process.env.VERBOSE) console.log(`      ${detail}`);
};

const json = async (path: string, init?: RequestInit) => {
  const response = await fetch(`${CONFIG.api}${path}`, init);
  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body };
};

/* ------------------------------------------------------------------ */

const publicChecks = async () => {
  console.log(`\nPublic API (${NETWORK})`);

  const books = await json("/books");
  check(
    "GET /books is keyless",
    books.status === 200,
    books.status === 401
      ? "this network now requires a JWT for market data — the keyless rollout may have been reverted"
      : `status ${books.status}`,
  );
  if (books.status !== 200) return null;

  const markets = books.body.orderbooks ?? [];
  check("markets present", markets.length > 0, `${markets.length} markets`);

  const first = markets[0];
  check(
    "market id is a string (docs say number)",
    typeof first?.id === "string",
    `id is ${typeof first?.id} — if this became a number, the schema's union can be simplified`,
  );

  check(
    "minNotional is in smallest units",
    // 15000000 against a 6dp quote token is 15 USDC. If this ever looks like a plain
    // decimal (e.g. "15"), the validation in lib/clob/format.ts must change with it.
    markets.every((m: any) => /^\d+$/.test(String(m.minNotional))),
    `sample: minNotional ${first?.minNotional}, quote decimals ${first?.quoteTokenDecimals}`,
  );

  check(
    "fees are integers in pips",
    Number.isInteger(first?.takerFeePips),
    `takerFeePips ${first?.takerFeePips} = ${(first?.takerFeePips ?? 0) / 10000}%`,
  );

  const open = markets.find((m: any) => m.status === "OPEN" && m.isMarketHalted !== 1);
  const halted = markets.filter((m: any) => m.isMarketHalted === 1);
  check(
    "at least one tradeable market",
    Boolean(open),
    open
      ? `book ${open.id} ${open.baseTokenSymbol}/${open.quoteTokenSymbol}`
      : `all closed or halted (${halted.length} halted)`,
    "condition",
  );

  const target = open ?? markets.find((m: any) => m.status === "OPEN") ?? first;

  const depth = await json(`/depth/${target.id}`);
  check("GET /depth returns a snapshot", depth.status === 200, `status ${depth.status}`);
  if (depth.status === 200) {
    check(
      "depth carries lastUpdateId",
      typeof depth.body.lastUpdateId === "number",
      `lastUpdateId ${depth.body.lastUpdateId}`,
    );
    check(
      "depth levels are [price, size] strings",
      [...depth.body.bids, ...depth.body.asks].every((l: any) => Array.isArray(l) && typeof l[0] === "string"),
      "levels keep full precision as strings",
    );
  }

  const closed = markets.find((m: any) => m.status !== "OPEN");
  if (closed) {
    const closedDepth = await json(`/depth/${closed.id}`);
    check(
      "closed market answers 404 on /depth",
      closedDepth.status === 404,
      `book ${closed.id} → ${closedDepth.status}; market state must come from /books, not /depth`,
    );
  }

  const unknown = await json("/depth/999999");
  check("unknown market answers 404", unknown.status === 404, `status ${unknown.status}`);

  const unmounted = await json("/books/999999");
  check(
    "unmounted route returns HTML, not JSON",
    typeof unmounted.body === "string",
    "a client that assumes JSON on every error breaks here",
  );

  const trades = await json(`/trades/${target.id}?limit=2`);
  check("GET /trades works", trades.status === 200, `status ${trades.status}`);
  if (trades.status === 200 && trades.body.trades?.[0]) {
    check(
      "trade amounts are human-readable",
      Number(trades.body.trades[0].amountBase) < 1e12,
      `amountBase ${trades.body.trades[0].amountBase} — decimals-adjusted, unlike the order path`,
    );
  }

  return target;
};

const contractChecks = async () => {
  console.log("\nSettlement contracts");

  const domain = await json("/signature/domain");
  check("GET /signature/domain works", domain.status === 200, `status ${domain.status}`);
  if (domain.status !== 200) return;

  check(
    "reactor address matches the one pinned in config",
    domain.body.verifyingContract?.toLowerCase() === CONFIG.reactor.toLowerCase(),
    `API says ${domain.body.verifyingContract}, config says ${CONFIG.reactor}`,
  );
  check(
    "chain id matches",
    domain.body.chainId === CONFIG.chainId,
    `API says ${domain.body.chainId}, expected ${CONFIG.chainId}`,
  );
  check(
    "EIP-712 domain name unchanged",
    domain.body.name === "PartialFillLimitOrderReactor",
    `name "${domain.body.name}" — the order struct was read from this contract's source`,
  );

  try {
    const provider = new ethers.JsonRpcProvider(CONFIG.rpc);
    const reactor = new ethers.Contract(
      domain.body.verifyingContract,
      ["function permit2() view returns (address)"],
      provider,
    );
    const permit2 = await reactor.permit2();
    check(
      "reactor still settles through the pinned Permit2",
      permit2.toLowerCase() === CONFIG.permit2.toLowerCase(),
      `reactor.permit2() = ${permit2}, config says ${CONFIG.permit2}`,
    );
  } catch (error) {
    check("reactor.permit2() readable", false, (error as Error).message.split("\n")[0]);
  }
};

const authChecks = async (marketId: string) => {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.HEDERA_OPERATOR_KEY;
  if (!privateKey?.startsWith("0x")) {
    console.log("\nAuthenticated checks skipped (no ECDSA key in DEPLOYER_PRIVATE_KEY)");
    return;
  }

  console.log("\nAuthenticated API");
  const wallet = new ethers.Wallet(privateKey);

  const challenge = await json("/auth/challenge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: wallet.address }),
  });
  check("challenge issued", challenge.status === 200, `status ${challenge.status}`);
  if (challenge.status !== 200) return;

  check(
    "challenge message shape unchanged",
    typeof challenge.body.message === "string" && challenge.body.message.includes("Nonce:"),
    `"${String(challenge.body.message).slice(0, 60)}…"`,
  );

  const signature = await wallet.signMessage(challenge.body.message);
  const verify = await json("/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: wallet.address, signature }),
  });
  check(
    "EVM address + personal_sign is accepted",
    verify.status === 200 && Boolean(verify.body.token),
    `status ${verify.status} — if this fails the login scheme has changed`,
  );
  if (!verify.body?.token) return;

  const token = verify.body.token;
  const auth = { authorization: `Bearer ${token}` };

  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const hours = Math.round((payload.exp - payload.iat) / 3600);
    check("token lifetime is 6 hours", hours === 6, `${hours}h`);
  } catch {
    check("token payload readable", false, "could not decode exp/iat");
  }

  const onboarding = await json(`/onboarding/${marketId}/status`, { headers: auth });
  check("onboarding status works", onboarding.status === 200, `status ${onboarding.status}`);
  if (onboarding.status === 200) {
    const steps = Object.keys(onboarding.body.steps ?? {});
    check(
      "onboarding still reports the same six steps",
      steps.length === 6 && steps.includes("approveBaseTokenReactor"),
      steps.join(", "),
    );
  }

  const bareArray = await json("/orders/build", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify([]),
  });
  check(
    "/orders/build still needs the orderRequests wrapper",
    bareArray.status === 400,
    `a bare array returned ${bareArray.status} — the docs' shape may now work`,
  );

  if (!flag("place")) {
    console.log("      (skipping the live order round trip; pass --place to include it)");
    return;
  }

  await placeCheck(marketId, auth);
};

/** Builds, signs, submits and cancels one far-from-touch order. */
const placeCheck = async (marketId: string, auth: Record<string, string>) => {
  console.log("\nLive order round trip");

  const books = await json("/books");
  const market = books.body.orderbooks.find((m: any) => String(m.id) === String(marketId));
  if (!market) return check("market resolvable", false, `no market ${marketId}`);

  if (market.isMarketHalted === 1) {
    return check(
      "market accepts orders",
      false,
      "market is halted; the venue rejects new orders at save, so the round trip cannot run",
      "condition",
    );
  }

  const privateKey = (process.env.DEPLOYER_PRIVATE_KEY || process.env.HEDERA_OPERATOR_KEY) as string;
  const wallet = new ethers.Wallet(privateKey);

  // Priced far away from the touch so it rests and cannot fill.
  const price = (Number(market.quotePrice) * 20).toFixed(7);
  const size = String(BigInt(market.lotSize) / 10n ** BigInt(market.baseTokenDecimals));

  const build = await json("/orders/build", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      orderRequests: [
        {
          orderbookId: String(marketId),
          type: "LIMIT",
          deadline: String(Math.floor(Date.now() / 1000) + 600),
          inputToken: market.baseTokenEvmAddress,
          inputAmount: market.lotSize,
          outputToken: market.quoteTokenEvmAddress,
          outputAmount: String(BigInt(Math.round(Number(price) * Number(size) * 10 ** market.quoteTokenDecimals))),
          makerOnly: true,
          takerOnce: false,
          isAMMEnabled: false,
        },
      ],
    }),
  });
  check("order builds", build.status === 200, `status ${build.status}: ${JSON.stringify(build.body).slice(0, 120)}`);
  if (build.status !== 200) return;

  const { meta, ...order } = build.body.orders[0];
  void meta;

  const domain = (await json("/signature/domain")).body;
  const types = {
    PartialFillLimitOrder: [
      { name: "info", type: "OrderInfo" },
      { name: "input", type: "PartialFillInputToken" },
      { name: "output", type: "OutputToken" },
      { name: "makerOnly", type: "bool" },
      { name: "takerOnce", type: "bool" },
      { name: "maxTakerFeePips", type: "uint32" },
      { name: "maxMakerFeePips", type: "uint32" },
    ],
    OrderInfo: [
      { name: "reactor", type: "address" },
      { name: "swapper", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "additionalValidationContract", type: "address" },
      { name: "additionalValidationData", type: "bytes" },
    ],
    PartialFillInputToken: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    OutputToken: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
  };

  const signature = await wallet.signTypedData(
    {
      name: domain.name,
      version: domain.version,
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    types,
    order,
  );

  const save = await json("/orders/save", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({
      items: [
        {
          order: build.body.orders[0],
          signature: `0x00${signature.slice(2)}`,
          orderbookId: String(marketId),
          type: "LIMIT",
        },
      ],
    }),
  });
  check(
    "signed order accepted (EIP-712 type + 0x00 mode byte still correct)",
    save.status === 200,
    `status ${save.status}: ${JSON.stringify(save.body).slice(0, 160)}`,
  );
  if (save.status !== 200) return;

  const orderId = String(save.body.orders[0].meta.id);
  const cancel = await json("/cancel", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ orderIds: [orderId] }),
  });
  check("cancel acknowledged with 202", cancel.status === 202, `status ${cancel.status}`);

  let confirmed = false;
  for (let attempt = 0; attempt < 8 && !confirmed; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const history = await json(`/orders/${orderId}/history`, { headers: auth });
    confirmed = (history.body.events ?? []).some((e: any) => e.type.replace(/^ORDER_/, "") === "CANCELED");
  }
  check(
    "cancel confirmed in order history",
    confirmed,
    `order ${orderId}; history spells it CANCELED, the stream spells it ORDER_CANCELED`,
  );
};

/* ------------------------------------------------------------------ */

const main = async () => {
  console.log(`limit-orders doctor — ${NETWORK}`);
  console.log("Checking that the live API still matches what this template was built against.");

  const market = await publicChecks();
  await contractChecks();
  if (market) await authChecks(String(market.id));

  const contract = results.filter(result => result.kind === "contract");
  const broken = contract.filter(result => !result.ok);
  const conditions = results.filter(result => result.kind === "condition" && !result.ok);

  console.log(`\n${contract.length - broken.length}/${contract.length} API assumptions still hold.`);

  if (conditions.length > 0) {
    console.log("\nNetwork conditions (not defects):");
    for (const result of conditions) console.log(`  ! ${result.name} — ${result.detail}`);
  }

  if (broken.length > 0) {
    console.log("\nChanged, and this template depends on it:");
    for (const result of broken) console.log(`  ✗ ${result.name}\n      ${result.detail}`);
    console.log("\nUpdate docs/DISCREPANCIES.md and the code that reads these fields.");
    process.exit(1);
  }

  console.log("Nothing to fix.");
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
