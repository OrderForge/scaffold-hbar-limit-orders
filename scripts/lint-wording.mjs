#!/usr/bin/env node
/**
 * Fails if the documentation claims more than this template can prove.
 *
 * SaucerSwap matches orders off-chain and only its own filler can settle them, so "no fill
 * can break the terms you signed" is true and "trustless" is not. The distinction is the
 * most valuable thing here, and it is exactly the kind of wording that drifts back in
 * during an edit. A check is cheaper than remembering.
 *
 * The phrases are allowed inside a "What you still trust SaucerSwap for" section, where
 * they appear in order to be rejected.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BANNED = [
  { phrase: "trustless", why: "the venue controls matching, acceptance and liveness" },
  { phrase: "fully on-chain", why: "matching happens off-chain at SaucerSwap" },
  { phrase: "verifiable fair execution", why: "fair matching cannot be observed from here" },
  { phrase: "guaranteed best price", why: "nothing here can see the prices you were not offered" },
];

/** Sections where naming a claim in order to reject it is the point. */
const EXEMPT_HEADINGS = [/what you still trust/i, /does not prove/i, /wording rules/i];

const files = [
  "README.md",
  ...(existsSync("docs") ? readdirSync("docs").filter(name => name.endsWith(".md")).map(name => join("docs", name)) : []),
];

let failures = 0;

for (const file of files) {
  if (!existsSync(file)) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  let exempt = false;

  lines.forEach((line, index) => {
    if (line.startsWith("#")) exempt = EXEMPT_HEADINGS.some(pattern => pattern.test(line));

    // A line that quotes the phrase while rejecting it is fine.
    const rejecting = /\bnever\b|\bnot\b|\bcannot\b|\bavoid\b/i.test(line);
    if (exempt || rejecting) return;

    for (const { phrase, why } of BANNED) {
      if (line.toLowerCase().includes(phrase)) {
        console.error(`${file}:${index + 1}  "${phrase}" — ${why}`);
        console.error(`    ${line.trim()}`);
        failures += 1;
      }
    }
  });
}

if (failures > 0) {
  console.error(`\n${failures} claim(s) the template cannot back. Say what is actually true instead.`);
  process.exit(1);
}

console.log(`Wording check passed across ${files.length} file(s).`);
