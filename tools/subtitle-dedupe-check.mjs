#!/usr/bin/env node
/* ============================================================
   tools/subtitle-dedupe-check.mjs — the iPad "two layers of text" probe.

   THE BUG (owner, 2026-08-21, on iPad/iPhone): "dialogue will show 2 times at
   once slightly offset so you can tell there's 2 layers of text."

   Four DOM layers render speech into the same bottom band, and css/hud.css's
   --subtitle-rank ladder OFFSETS a collision rather than suppressing it. On
   touch #hint adopts the subtitle skin and every floor collapses to the same
   120px, so an echo of a line stops looking like a HUD panel and starts
   looking like the same sentence printed twice.

   systems/subtitlebus.js is the claim desk that fixes it. This asserts the
   desk's behaviour directly — no browser, no world build, sub-second — so the
   regression is catchable in CI on a box that cannot finish a 25 km world.

       node tools/subtitle-dedupe-check.mjs
============================================================ */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The bus is a plain IIFE hanging one object off window.CBZ, so a bare VM with
// a window and a clock is the whole environment it needs.
function loadBus() {
  let t = 1000;
  const sandbox = { window: {}, performance: { now: () => t }, setTimeout: () => {} };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(ROOT, "src/systems/subtitlebus.js"), "utf8"), sandbox);
  return {
    subs: sandbox.window.CBZ.subtitles,
    CBZ: sandbox.window.CBZ,
    advance(sec) { t += sec * 1000; },
  };
}

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  FAIL ${name}\n       got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`  ok   ${name}`);
}

console.log("subtitle-dedupe-check");

// ---- 1. the reported bug: the same line reaching two surfaces --------------
{
  const { subs } = loadBus();
  const line = "Rough up Officer #3 for me.";
  check("ped bark claims a free line", subs.claim("citySpeech", "speech", line, 3, "Marcus", () => {}), true);
  check("HUD hint is REFUSED the same line", subs.claim("hint", "hint", line, 3, "", () => {}), false);
}

// ---- 2. the touch-only shape: the hint carries the speaker in the sentence --
//        (#hint gets "Marcus: ..." while #citySpeech splits name and line, so
//        matching has to be on the WORDS or the dedupe never fires on the one
//        pairing that actually bit.)
{
  const { subs } = loadBus();
  subs.claim("citySpeech", "speech", "Rough up Officer #3 for me", 3, "Marcus", () => {});
  check("hint refused despite `Speaker:` prefix + quotes + period",
    subs.claim("hint", "hint", 'Marcus: "Rough up Officer #3 for me."', 3, "", () => {}), false);
}

// ---- 3. rank: a better surface EVICTS a worse one, rather than stacking -----
{
  const { subs } = loadBus();
  let cleared = false;
  subs.claim("hint", "hint", "Take the side gate.", 3, "", () => { cleared = true; });
  check("authored dialogue takes the line", subs.claim("campaignDialogue", "campaign", "Take the side gate.", 600, "Marcus", () => {}), true);
  check("...and the hint was told to clear itself", cleared, true);
}

// ---- 4. DIFFERENT lines still coexist — the ladder's real job is untouched --
{
  const { subs } = loadBus();
  check("surface A takes its line", subs.claim("citySpeech", "speech", "Yard's open.", 3, "Marcus", () => {}), true);
  check("surface B takes a DIFFERENT line", subs.claim("pinteractSay", "interact", "That's 14 cigs.", 3, "Vance", () => {}), true);
}

// ---- 5. a claim expires, so the next delivery of the same line is allowed ---
{
  const { subs, advance } = loadBus();
  subs.claim("citySpeech", "speech", "Yard's open.", 2, "Marcus", () => {});
  check("refused while the claim is live", subs.claim("hint", "hint", "Yard's open.", 2, "", () => {}), false);
  advance(3);
  check("allowed once it has aged out", subs.claim("hint", "hint", "Yard's open.", 2, "", () => {}), true);
}

// ---- 6. release() frees the line immediately (a subtitle cut short) ---------
{
  const { subs } = loadBus();
  subs.claim("citySpeech", "speech", "Yard's open.", 9, "Marcus", () => {});
  subs.release("citySpeech");
  check("released line is claimable again", subs.claim("hint", "hint", "Yard's open.", 3, "", () => {}), true);
}

// ---- 7. a surface re-claiming its OWN line is never refused ----------------
{
  const { subs } = loadBus();
  subs.claim("citySpeech", "speech", "Yard's open.", 3, "Marcus", () => {});
  check("same surface may re-say its own line", subs.claim("citySpeech", "speech", "Yard's open.", 3, "Marcus", () => {}), true);
}

// ---- 8. a sentence that merely CONTAINS a colon is not a speaker tag -------
{
  const { subs } = loadBus();
  check("colon inside a sentence is left alone",
    subs.normalize("Deal: you first, then me.", ""), "deal: you first, then me");
}

// ---- 9. the revert flag really reverts ------------------------------------
{
  const { subs, CBZ } = loadBus();
  CBZ.CONFIG.SUBTITLE_DEDUPE = false;
  subs.claim("citySpeech", "speech", "Yard's open.", 3, "Marcus", () => {});
  check("SUBTITLE_DEDUPE=false grants every claim", subs.claim("hint", "hint", "Yard's open.", 3, "", () => {}), true);
}

console.log(failed ? `\nSUBTITLE-DEDUPE: ${failed} FAILED` : "\nSUBTITLE-DEDUPE: ok");
process.exit(failed ? 1 : 0);
