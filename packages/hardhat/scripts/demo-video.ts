/**
 * `yarn clob:demo` — record a walkthrough of the running app.
 *
 * Captures the keyless half: the markets list, a live ladder, the market's rules, the
 * journal. Scripted rather than hand-recorded so it can be re-run after any change and
 * never goes stale — a demo that has drifted from the app is worse than none.
 *
 *   yarn clob:demo                       # against localhost:3000
 *   yarn clob:demo --url http://…        # somewhere else
 *   yarn clob:demo --out docs/video      # where to write frames and video
 *
 * Frames are always written, because a PNG needs nothing but a browser. Video is recorded
 * only when Playwright has ffmpeg, which it cannot install on every OS — on macOS 13, for
 * one. The script says which it produced rather than failing.
 *
 * The wallet half — onboarding, signing, cancelling — is deliberately not scripted: it
 * needs a funded account and a real wallet prompt, and faking those would misrepresent
 * what a reviewer would actually see.
 */
import * as fs from "fs";
import * as path from "path";

const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const BASE = arg("url", "http://localhost:3000");
const OUT = path.resolve(process.cwd(), arg("out", "../../docs/video"));

type Beat = {
  path: string;
  caption: string;
  /** Wait for the content that makes the frame worth showing. */
  ready?: string;
  hold: number;
};

const BEATS: Beat[] = [
  { path: "/", caption: "the template, nothing configured", hold: 2000 },
  {
    path: "/markets",
    caption: "live markets — no wallet, no API key, no deployed contract",
    ready: "document.querySelectorAll('tbody tr').length > 2",
    hold: 3500,
  },
  {
    path: "/market/1",
    caption: "a live ladder, the spread, and the market's own trading rules",
    ready: "document.querySelectorAll('tbody tr').length > 10",
    hold: 5000,
  },
  {
    path: "/journal",
    caption: "the HCS journal: what was signed, ordered by consensus",
    ready: "document.body.innerText.includes('Topic') || document.body.innerText.includes('No intents')",
    hold: 3500,
  },
];

const main = async () => {
  let chromium: any;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Playwright is not installed. Run `yarn add -D playwright` first.");
    process.exit(1);
  }

  const reachable = await fetch(BASE).catch(() => null);
  if (!reachable?.ok) {
    console.error(`Nothing is serving ${BASE}. Start the app with \`yarn next:dev\` first.`);
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });

  // The project's own browser if it has one, otherwise system Chrome — the same fallback
  // the harness uses, so this runs wherever that runs.
  const browser = await chromium
    .launch({ headless: true })
    .catch(() => chromium.launch({ headless: true, channel: "chrome" }));

  const viewport = { width: 1440, height: 900 };

  /** Video needs ffmpeg, which Playwright cannot install everywhere. Try, then fall back. */
  let context: any;
  let recording = true;
  try {
    context = await browser.newContext({ viewport, recordVideo: { dir: OUT, size: viewport } });
    await (await context.newPage()).close();
  } catch {
    recording = false;
    context = await browser.newContext({ viewport });
  }

  const page = await context.newPage();
  const frames: string[] = [];

  for (const [index, beat] of BEATS.entries()) {
    console.log(`  ${beat.path} — ${beat.caption}`);
    await page.goto(`${BASE}${beat.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });

    if (beat.ready) {
      await page
        .waitForFunction(beat.ready, null, { timeout: 45000 })
        .catch(() => console.log("      (content did not settle; capturing anyway)"));
    }
    await page.waitForTimeout(beat.hold);

    const frame = path.join(
      OUT,
      `${String(index + 1).padStart(2, "0")}-${beat.path.replace(/\W+/g, "") || "home"}.png`,
    );
    await page.screenshot({ path: frame });
    frames.push(frame);

    // A slow scroll shows what is below the fold without a jump cut.
    await page.evaluate(() => window.scrollBy({ top: 400, behavior: "smooth" }));
    await page.waitForTimeout(1200);
  }

  await context.close();
  await browser.close();

  console.log(`\n✓ ${frames.length} frames in ${OUT}`);

  if (recording) {
    const video = fs
      .readdirSync(OUT)
      .filter(name => name.endsWith(".webm"))
      .map(name => path.join(OUT, name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

    if (video) {
      const target = path.join(OUT, "walkthrough.webm");
      if (video !== target) fs.renameSync(video, target);
      console.log(`✓ ${target}`);
    }
  } else {
    console.log("\nNo video: Playwright could not provide ffmpeg on this OS (macOS 13, for one).");
    console.log("The frames above are the same content. With ffmpeg installed:");
    console.log(
      `  ffmpeg -framerate 1/3 -pattern_type glob -i '${OUT}/*.png' -c:v libx264 -pix_fmt yuv420p walkthrough.mp4`,
    );
  }

  console.log("\nFor a submission video, narrate over this and record the wallet half by hand:");
  console.log("onboarding and signing need a real wallet prompt, which a script should not fake.");
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
