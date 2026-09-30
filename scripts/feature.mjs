#!/usr/bin/env node
/**
 * `yarn clob:feature` — switch optional parts of the terminal on, off, or out entirely.
 *
 *   yarn clob:feature list
 *   yarn clob:feature off depth-chart       # hide it; the code stays
 *   yarn clob:feature on depth-chart
 *   yarn clob:feature remove depth-chart    # delete it, and every reference to it
 *
 * `on` and `off` flip a switch in `packages/nextjs/features.config.ts`, which a running
 * dev server picks up without a restart.
 *
 * `remove` is for a project that will never want the feature. It deletes the feature's
 * files and every block of code marked for it:
 *
 *   {/* feature:depth-chart *\/} … {/* /feature:depth-chart *\/}     in JSX
 *   // feature:depth-chart … // /feature:depth-chart                  in TypeScript
 *   import { … } from "…"; // feature:depth-chart                    a single line
 *
 * so the app is left with no dead code and still type-checks. A new optional feature
 * joins by adding an entry to FEATURES below and marking its code the same way.
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "packages/nextjs");
const CONFIG = join(APP, "features.config.ts");

export const FEATURES = {
  "depth-chart": {
    key: "depthChart",
    description: "Cumulative bid/ask curve above the order book ladder",
    files: ["components/clob/DepthChart.tsx", "lib/clob/depthChart.ts", "test/depthChart.test.ts"],
  },
};

/**
 * Where marked code can live. `node_modules` and build output are never touched, and nor
 * is `test/`: a feature's own tests are deleted through its file list, and the marker
 * tests quote markers as examples, which a scan would otherwise "remove".
 */
const SCAN_DIRS = ["app", "components", "hooks", "lib", "services", "utils"];
const SCAN_FILES = ["features.config.ts"];
const SOURCE = /\.(tsx?|mjs|js)$/;

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Remove every block and line marked for `name` from one source file.
 *
 * Exported so the marker rules are tested on their own, without touching the tree.
 */
export const stripFeature = (source, name) => {
  const tag = escape(name);
  let out = source
    // JSX blocks: {/* feature:x */} … {/* /feature:x */}, with the lines they sit on.
    .replace(new RegExp(`^[ \\t]*\\{/\\*\\s*feature:${tag}\\s*\\*/\\}[\\s\\S]*?\\{/\\*\\s*/feature:${tag}\\s*\\*/\\}[ \\t]*\\n?`, "gm"), "")
    // Line-comment blocks: // feature:x … // /feature:x
    .replace(new RegExp(`^[ \\t]*//\\s*feature:${tag}\\s*\\n[\\s\\S]*?^[ \\t]*//\\s*/feature:${tag}[ \\t]*\\n?`, "gm"), "")
    // Single lines ending in // feature:x
    .replace(new RegExp(`^.*//\\s*feature:${tag}[ \\t]*\\n?`, "gm"), "");

  // Collapse the blank line a removed block can leave behind.
  out = out.replace(/\n{3,}/g, "\n\n");

  // The shared features import goes too once nothing in the file reads it any more.
  const importLine = /^import features from "~~\/features\.config";\n/m;
  if (importLine.test(out) && !/\bfeatures\./.test(out.replace(importLine, ""))) {
    out = out.replace(importLine, "");
  }
  return out;
};

const walk = dir => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    return statSync(path).isDirectory() ? walk(path) : SOURCE.test(entry) ? [path] : [];
  });
};

const markedFiles = name =>
  [...SCAN_DIRS.flatMap(dir => walk(join(APP, dir))), ...SCAN_FILES.map(file => join(APP, file))].filter(
    path => existsSync(path) && readFileSync(path, "utf8").includes(`feature:${name}`),
  );

const readSwitch = key => {
  if (!existsSync(CONFIG)) return undefined;
  const match = readFileSync(CONFIG, "utf8").match(new RegExp(`\\b${key}:\\s*(true|false)`));
  return match ? match[1] === "true" : undefined;
};

const setSwitch = (key, value) => {
  const source = readFileSync(CONFIG, "utf8");
  const pattern = new RegExp(`(\\b${key}:\\s*)(true|false)`);
  if (!pattern.test(source)) return false;
  writeFileSync(CONFIG, source.replace(pattern, `$1${value}`));
  return true;
};

const fail = message => {
  console.error(message);
  process.exit(1);
};

const lookup = name => {
  const feature = FEATURES[name];
  if (!feature) fail(`Unknown feature "${name ?? ""}". Run \`yarn clob:feature list\` to see what exists.`);
  return feature;
};

const isInstalled = feature => feature.files.some(file => existsSync(join(APP, file)));

const main = ([command, name, ...flags]) => {
  switch (command) {
    case "list": {
      for (const [id, feature] of Object.entries(FEATURES)) {
        const state = !isInstalled(feature) ? "removed" : readSwitch(feature.key) ? "on" : "off";
        console.log(`${id.padEnd(16)} ${state.padEnd(8)} ${feature.description}`);
      }
      return;
    }

    case "on":
    case "off": {
      const feature = lookup(name);
      if (!isInstalled(feature)) fail(`${name} has been removed from this project; there is nothing to switch ${command}.`);
      if (!setSwitch(feature.key, command === "on")) fail(`No \`${feature.key}\` switch found in features.config.ts.`);
      console.log(`${name} is ${command}. A running dev server picks this up without a restart.`);
      return;
    }

    case "remove": {
      const feature = lookup(name);
      if (!isInstalled(feature)) fail(`${name} is already removed.`);
      const touched = markedFiles(name);
      if (!flags.includes("--yes")) {
        console.log(`This deletes ${name} for good:\n`);
        for (const file of feature.files) console.log(`  delete  packages/nextjs/${file}`);
        for (const path of touched) console.log(`  edit    ${relative(ROOT, path)}`);
        console.log(`\nIf the project is under git, \`git checkout -- .\` undoes it. Run again with --yes to proceed.`);
        return;
      }
      for (const file of feature.files) rmSync(join(APP, file), { force: true });
      for (const path of touched) writeFileSync(path, stripFeature(readFileSync(path, "utf8"), name));
      console.log(`Removed ${name}: ${feature.files.length} file(s) deleted, ${touched.length} edited.`);
      console.log("Check it with `yarn next:check-types`.");
      return;
    }

    default:
      console.log("Usage: yarn clob:feature <list | on <name> | off <name> | remove <name> [--yes]>");
      if (command) process.exit(1);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
