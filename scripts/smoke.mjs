#!/usr/bin/env node
/**
 * `yarn smoke` — the browser smoke test, with its assertions actually enforced.
 *
 * `.harness/validators/playwright-smoke.yaml` lists what each route must show. The Hedera
 * Harness Tier 2 gate reads that file but not its `expect` blocks: it checks that a route
 * loads, renders real content and logs no console errors, which is necessary and not
 * sufficient — a page that renders the wrong thing without an error passes it. This runs
 * the same routes and also checks the text each one promises.
 *
 *   yarn next:build && yarn workspace @sh/nextjs serve    # in one terminal
 *   yarn smoke                                            # in another
 *
 * It needs a running server rather than starting one, so it can be pointed at a deploy:
 *   yarn smoke --url https://…
 */
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const config = parse(readFileSync(".harness/validators/playwright-smoke.yaml", "utf8"));
const urlFlag = process.argv.indexOf("--url");
const base = (urlFlag !== -1 ? process.argv[urlFlag + 1] : config.server.url).replace(/\/$/, "");

if (!(await fetch(base).catch(() => null))?.ok) {
  console.error(`Nothing is serving ${base}. Build and serve the app first:`);
  console.error("  yarn next:build && yarn workspace @sh/nextjs serve");
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run `yarn install` first.");
  process.exit(1);
}

// The bundled browser if Playwright has one, otherwise system Chrome — Playwright cannot
// install its own on every OS (macOS 13, for one).
const browser = await chromium
  .launch({ headless: true })
  .catch(() => chromium.launch({ headless: true, channel: "chrome" }));

const forbidden = config.forbidden?.visibleText ?? [];
let failures = 0;

for (const route of config.routes) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", message => message.type() === "error" && consoleErrors.push(message.text()));

  const problems = [];
  const response = await page.goto(base + route.path, { waitUntil: "load", timeout: 60_000 }).catch(error => {
    problems.push(`did not load: ${error.message.split("\n")[0]}`);
    return null;
  });
  if (response && response.status() >= 400) problems.push(`HTTP ${response.status()}`);

  const expected = route.expect?.visibleText ?? [];
  // Wait for the content rather than a fixed delay: markets and depth arrive after hydration.
  await page
    .waitForFunction(texts => texts.every(text => document.body.innerText.includes(text)), expected, {
      timeout: 30_000,
    })
    .catch(() => undefined);

  const body = await page.locator("body").innerText().catch(() => "");
  for (const text of expected) if (!body.includes(text)) problems.push(`missing "${text}"`);
  for (const text of forbidden) if (body.includes(text)) problems.push(`shows forbidden "${text}"`);
  if (config.defaults?.failOnConsoleError !== false && consoleErrors.length) {
    problems.push(`console errors: ${consoleErrors.slice(0, 2).join(" | ").slice(0, 160)}`);
  }

  console.log(`${problems.length ? "FAIL" : "ok  "}  ${route.path}${problems.length ? "\n      " + problems.join("\n      ") : ""}`);
  failures += problems.length ? 1 : 0;
  await page.close();
}

await browser.close();
console.log(`\n${config.routes.length - failures}/${config.routes.length} routes pass.`);
process.exit(failures ? 1 : 0);
