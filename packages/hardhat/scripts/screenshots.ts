/**
 * `yarn clob:shots` — capture the README screenshots from the running app.
 *
 * Screenshots go stale faster than prose, so they are scripted rather than cropped by
 * hand: after a UI change, re-run this and the images in `docs/images/` match what a
 * reviewer will actually see.
 *
 *   yarn clob:shots                        # keyless frames only
 *   yarn clob:shots --pk 0x…               # also the wallet frames
 *   yarn clob:shots --url http://… --out docs/images
 *   yarn clob:shots --pk 0x… --sign-intent    # also writes one intent to the journal
 *
 * The wallet frames need a funded ECDSA testnet key, because a connected wallet is only
 * interesting when its account actually exists and has been onboarded. The key is loaded
 * into the burner wallet through localStorage, is never written to disk and never
 * printed, and the frames that could expose it — the reveal-private-key modal — are never
 * opened. Without a key the script still writes every keyless frame and says which it
 * skipped.
 */
import * as fs from "fs";
import * as path from "path";

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};

const BASE = arg("url") ?? "http://localhost:3000";
const OUT = path.resolve(process.cwd(), arg("out") ?? "../../docs/images");

/** From a flag or the environment — never from a file this repo tracks. */
const privateKey = (): string | undefined => {
  const key = arg("pk") ?? process.env.SCREENSHOT_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) return undefined;
  return key.startsWith("0x") ? key : `0x${key}`;
};

const VIEWPORT = { width: 1400, height: 950 };

const main = async () => {
  let chromium: any;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Playwright is not installed. Run `yarn add -D playwright` first.");
    process.exit(1);
  }

  if (!(await fetch(BASE).catch(() => null))?.ok) {
    console.error(`Nothing is serving ${BASE}. Start the app with \`yarn next:dev\` first.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium
    .launch({ headless: true })
    .catch(() => chromium.launch({ headless: true, channel: "chrome" }));

  const key = privateKey();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  // A dev server compiles a route on first request, which can take a while.
  page.setDefaultNavigationTimeout(120_000);
  page.setDefaultTimeout(30_000);

  const written: string[] = [];
  const shot = async (name: string) => {
    // Clicking can leave the page scrolled, and a frame without the header reads as a
    // crop of something rather than a screenshot of the app.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    written.push(`${name}.png`);
    console.log(`  wrote ${name}.png`);
  };

  /** One element rather than the viewport, for a panel worth showing on its own. */
  const shotOf = async (locator: any, name: string) => {
    await locator.screenshot({ path: path.join(OUT, `${name}.png`) });
    written.push(`${name}.png`);
    console.log(`  wrote ${name}.png`);
  };

  /** Wait for content rather than a fixed delay, so a slow feed never lands a blank frame. */
  const settle = async (predicate: string, timeout = 30_000) => {
    await page.waitForFunction(predicate, null, { timeout }).catch(() => {});
    await page.waitForTimeout(1200);
  };

  if (!key) {
    console.log("No key given, so the wallet frames will be skipped. Pass --pk or set SCREENSHOT_PRIVATE_KEY.");
  } else {
    // The burner wallet reads its key from localStorage and connects by itself, so
    // setting it before the app loads is enough to arrive with a funded wallet attached.
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate((pk: string) => localStorage.setItem("burnerWallet.pk", pk), key);

    // --- Wallet frames, on the network the wallet is on.
    await page.goto(`${BASE}/markets`, { waitUntil: "domcontentloaded" });
    await settle("document.querySelectorAll('tbody tr').length > 2");
    await page.locator("tbody tr a").first().click();
    // Wait for the checklist to have actually resolved, not just rendered its heading.
    await settle(
      "document.body.innerText.includes('Ready to trade') && !document.body.innerText.includes('Checking the chain')",
    );

    const signIn = page.getByRole("button", { name: /sign in to the api/i }).first();
    if (await signIn.count()) {
      await signIn.click();
      await settle("document.body.innerText.includes('signed in')", 20_000);
      // Signing in also switches depth from polling to the WebSocket, which takes a few
      // seconds. Catching the frame before that would show "polling" on a signed-in page.
      await settle("document.body.innerText.includes('streaming')", 25_000);
    }
    await shot("wallet");

    // The order ticket on its own, filled in with a valid order: the price is on the
    // tick grid and the size is a whole lot, so the totals and the fee appear. The
    // numbers are the market's real ones rather than round invented figures.
    const ticket = page.locator("div.rounded-box").filter({ hasText: "Place an order" }).first();
    if (await ticket.count()) {
      await ticket.getByRole("button", { name: "BUY", exact: true }).click();
      await ticket.locator("input.input-sm").nth(0).fill("0.0425");
      await ticket.locator("input.input-sm").nth(1).fill("10");
      await page.waitForTimeout(800);
      await shotOf(ticket, "order");
    }

    // Opt-in, because it writes a real message to the HCS topic and costs the operator
    // account a fraction of a cent. Without it the journal frame shows the empty state,
    // which is honest but says little.
    if (process.argv.includes("--sign-intent")) {
      const sign = page.getByRole("button", { name: "Sign intent", exact: true }).first();
      if ((await sign.count()) && (await sign.isEnabled())) {
        await sign.click();
        await settle("!document.body.innerText.includes('signing…')", 45_000);
      }
    }

    // Navigate by clicking from here on. The API token is held in memory only, by
    // design, so a reload would land on a signed-out page — and the wallet itself takes
    // a moment to reattach after one.
    await page.getByRole("link", { name: "Orders" }).first().click();
    await settle("/Open \\(|Past \\(|No orders yet/.test(document.body.innerText)");
    await shot("orders");

    await page.getByRole("link", { name: "Journal" }).first().click();
    // Wait for the journal itself: the page being navigated away from also satisfies
    // "not loading", which is how an earlier run captured the orders page twice.
    await settle(
      "document.body.innerText.includes('Order intent journal') && !document.body.innerText.includes('Reading the topic')",
    );
    await shot("journal");
  }

  if (!key) {
    await page.goto(`${BASE}/journal`, { waitUntil: "domcontentloaded" });
    await settle("!document.body.innerText.includes('Reading the topic')");
    await shot("journal");
  }

  // --- Keyless frames. The burner wallet connects by itself when it is enabled, so the
  // keyless view has to be reached by disconnecting, then navigating by clicking: a
  // reload would just connect it again. Set NEXT_PUBLIC_ENABLE_BURNER_WALLET=false to
  // skip this dance entirely.
  await page.goto(`${BASE}/markets`, { waitUntil: "domcontentloaded" });
  await settle("document.querySelectorAll('tbody tr').length > 2");
  // The address control is a <summary>, not a button, so match it by its text.
  const dropdown = page.getByText(/^0x[0-9a-fA-F]{4}\.\.\./).first();
  if (await dropdown.count()) {
    await dropdown.click();
    await page.waitForTimeout(600);
    await page.getByText("Disconnect", { exact: true }).first().click({ timeout: 8000 });
    await settle("!document.body.innerText.includes('follows your wallet')");
  }

  // Mainnet: testnet has one market that has ever been open, and it is halted.
  await page.getByRole("button", { name: "Mainnet", exact: true }).first().click({ timeout: 10_000 });
  await settle("document.querySelectorAll('tbody tr').length > 4");
  await shot("markets");

  // Click through rather than navigate, so the chosen network survives.
  await page.locator("tbody tr a").first().click();
  await settle("document.querySelectorAll('tbody tr').length > 8");
  await shot("market");

  await context.close();
  await browser.close();
  console.log(`\n${written.length} frame(s) in ${OUT}`);
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
