#!/usr/bin/env node
/* ============================================================
   tools/warlord-boot.mjs — DOES THE GAME START.

   The cheapest possible question, and on 2026-08-30 nothing in this repo
   asked it. e8f2040 deleted desert.js's world scatter and left one line of
   the deleted system behind — `scCX = scCZ = NaN;`, a reset for two cursors
   that no longer existed. The file is "use strict", so that is a
   ReferenceError thrown three lines before `built = true`. The island was
   never added to the scene. games/warlord.html was a boot screen on main,
   deployed, for the better part of an hour.

   It survived a push because every check that existed was a check of
   SOMETHING ELSE. warlord-check.mjs loads core.js in plain node and never
   opens a page. warlord-fits.mjs and the ba presets do boot the page, but
   they are slow, they are run when a UI or a picture is in question, and
   nobody runs them after a change to terrain. And the author (me) confirmed
   the deletion by grepping for the names he had removed and by re-measuring
   the scatter census — from a page loaded BEFORE the edit. Every one of those
   is a reasonable thing to have done and not one of them would have noticed.

   So this asks the only question that has to be true before any other check
   means anything, and it asks it in about fifteen seconds:

     1. THE PAGE REACHES THE CAMPAIGN. Not "the script parsed" — the phase is
        `campaign`, which means the shell booted, every module registered, the
        island was raised and the player was put on it.
     2. THE ISLAND IS REAL. desert.built() is true, the root is in the scene,
        and heightAt answers a finite number at the player's own feet. A
        module can swallow an exception and leave a game that "boots" onto
        nothing; the terrain has to be there.
     3. NOTHING THREW ON THE WAY. Any console error during boot fails the run,
        with the message printed. This is the one that catches the class of
        bug above, because a ReferenceError in a module that another module
        try/catches is otherwise completely silent.
     4. EVERY MODULE THE CONTRACT PROMISES ARRIVED. CONTRACT.md lists them;
        a missing one fails silently by design (the phase changes and nothing
        happens), so it is named here.

   Run it after ANY change to this game, before the slow checks:

     node tools/warlord-boot.mjs
     node tools/warlord-boot.mjs --seed 90210
     node tools/warlord-boot.mjs --url "games/warlord.html?go=1&palms=off"

   Exit 0 clean, 1 on anything above. No screenshots, no metrics, no opinions.
============================================================ */
import { launch } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = opt("--seed", "1337");
const URL = opt("--url", null);

/* The modules CONTRACT.md says this game is made of. A missing one does not
   crash — core's bootModules logs and carries on — so the game comes up and
   then quietly cannot do a thing. Named, so the failure has a name.
   core.js is NOT in this list and that is not an oversight: it is the file
   that DEFINES W.module, so it never calls it and never appears as W.core.
   Its arrival is asserted separately, through the flag it sets on itself. */
const MODULES = [
  "camo", "outfits", "wardrobe", "sand", "props", "desert", "mounts",
  "territory", "campaign", "army", "gunplay", "battle", "outpost", "loadout",
  "events", "feel", "warnet", "warlords",
];

const run = async () => {
  const rig = await launch({ rafBudget: 0 });
  const fails = [];
  try {
    const rel = URL || `games/warlord.html`;
    const q = URL ? "" : `go=1&seed=${SEED}&weather=off&sound=off`;
    const url = await rig.open(rel, q);
    console.log(`booting ${url}`);

    const up = await rig.wait(
      `window.__warlordReady === true && window.CBZ && CBZ.warlord && CBZ.warlord.phase && CBZ.warlord.phase() === "campaign"`,
      120000);

    /* THE ERRORS ARE READ FIRST AND PRINTED WHATEVER HAPPENS. When the boot
       hangs, the console error IS the answer, and a tool that reports only
       "never reached the campaign" sends the reader back to the browser to
       find out why. */
    const errs = (rig.errors || []).slice();
    for (const e of errs) fails.push(`console error during boot: ${typeof e === "string" ? e : JSON.stringify(e)}`);

    if (!up) {
      const where = await rig.evl(`(() => {
        try {
          return { ready: !!window.__warlordReady, hasCBZ: !!window.CBZ,
                   hasWarlord: !!(window.CBZ && CBZ.warlord),
                   phase: (window.CBZ && CBZ.warlord && CBZ.warlord.phase) ? CBZ.warlord.phase() : null };
        } catch (e) { return { threw: String(e) }; }
      })()`);
      fails.push(`never reached the campaign phase — ${JSON.stringify(where)}`);
    } else {
      const world = await rig.evl(`(() => {
        try {
          const W = CBZ.warlord, D = W.desert, S = W.state;
          const y = D.heightAt(S.you.x, S.you.z);
          const missing = ${JSON.stringify(MODULES)}.filter(function (n) { return !W[n]; });
          return {
            core: !!W._core,
            built: !!(D.built && D.built()),
            inScene: !!(D.root && D.root() && D.root().parent),
            groundY: y, groundFinite: isFinite(y),
            outposts: (S.outposts || []).length,
            bands: (S.bands || []).length,
            missingModules: missing,
          };
        } catch (e) { return { threw: String(e) }; }
      })()`);
      console.log("  " + JSON.stringify(world));
      if (world.threw) fails.push(`querying the world threw: ${world.threw}`);
      if (!world.core) fails.push("core.js never ran — nothing else can have");
      if (!world.built) fails.push("the island reports built() === false");
      if (!world.inScene) fails.push("the island root is not in the scene");
      if (!world.groundFinite) fails.push(`heightAt under the player is ${world.groundY}`);
      if (!world.outposts) fails.push("the campaign placed no outposts");
      if (!world.bands) fails.push("the campaign placed no bands — the island is empty");
      if (world.missingModules && world.missingModules.length) {
        fails.push(`modules never registered: ${world.missingModules.join(", ")}`);
      }
    }
  } finally {
    await rig.close();
  }

  if (fails.length) {
    console.log(`\nWARLORD BOOT: FAIL\n`);
    for (const f of fails) console.log("  " + f);
    process.exit(1);
  }
  console.log("\nWARLORD BOOT OK — the page starts, the island is raised, nothing threw.");
};

run().catch((e) => { console.error(e); process.exit(1); });
