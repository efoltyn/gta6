#!/usr/bin/env node
/* tools/shark-blood-check.mjs — DOES BLEEDING ACTUALLY BRING THEM?

   The owner's ask (2026-08-30): "when you bleed in the shark sim, sharks
   should start coming at you like real life."

   The claim under test is city/marine_predation.js §2b — blood suspends the
   pecking order — and the reason this file exists rather than a paragraph is
   that the FEATURE ALREADY LOOKED PRESENT before §2b and was not. The blood
   was real: §7 opened a chum trail on the ridden shark, gore.js painted the
   plume and the surface slick, and rival sharks drifted past within two
   metres of it. Not one of them had ever TARGETED it — measured at zero, every
   sample, because a strict scale/danger graph has no row for "it is bleeding".
   A tool that photographed the water would have called that a pass.

   So every number here is read off the live hunt state, not off a config:

     1  CONTROL — a healthy shark offshore is targeted by nobody.
     2  THE LOCK — wounded to 35%, sharks take it as a §2b frenzy target
        within thirty game seconds, and MORE than one (a frenzy is a crowd).
     3  THE CLOSE — the pack's mean range to the bleeder actually shrinks.
        A lock that never arrives is a lock that did not happen.
     4  THE BITE — the shark loses health it was not scripted to lose, i.e.
        the hunt reaches contact rather than circling forever. This is the
        invariant that caught §2b's second half: with target selection alone,
        eight sharks orbited a bleeding shark for a hundred and forty seconds
        and landed ONE bite, because predator.js's grammar is a stalk.
     5  THE RELEASE — healed to full, the pack lets go (the FRENZY_LEASH
        clause), so this is a state of the quarry and not a life sentence.
     6  THE REVERT — ?cfg_MARINE_FRENZY_BLOOD=0 puts the strict pecking order
        back and the lock count returns to zero.

     node tools/shark-blood-check.mjs
     node tools/shark-blood-check.mjs --json
     node tools/shark-blood-check.mjs --seed 90210 --shots
*/
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { launch, ROOT } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = arg("--seed", "90210");
const JSON_OUT = has("--json");
const SHOTS = has("--shots");
const SHOT_DIR = path.join(ROOT, "artifacts", "shark-blood");
const say = (m) => { if (!JSON_OUT) console.log(m); };

/* THE DRIVER, in the page. One object so every later eval is a method call
   rather than a closure that has to re-find the world — the same shape
   tools/shark-sight-check.mjs uses, for the same reason. */
const DRIVER = `window.__BL = (() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const S = {
    /* THE PIN IS PER FRAME, and it has to be. The ridden shark eats whatever
       is in front of it automatically, a meal HEALS it, and enough meals
       EVOLVE it — which swaps the body for a different actor and drops every
       lock in the sea. Re-pinning once every few seconds left both leaks open
       and the run measured the ladder instead of the pack (it read as "they
       lost interest"). Held here, the wound is genuinely the only variable. */
    pin: 0,
    step(n) {
      for (let i = 0; i < n; i++) {
        if (S.pin > 0) {
          const sh = CBZ.sharkSim && CBZ.sharkSim.shark;
          if (sh) { sh.hp = Math.max(1, sh.maxHp * S.pin); CBZ.sharkSim.mass = 0; }
        }
        CBZ.stepSim(1 / 30);
      }
    },
    sec(s) { S.step(Math.max(1, Math.round(s * 30))); },
    armed() {
      return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
        CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
    },
    async boot() {
      for (let t = 0; t < 500 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
        const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
        const pb = document.getElementById("playBtn"); if (pb) pb.click();
        await sleep(140);
      }
      if (CBZ.game.state !== "playing") return "never played";
      for (let t = 0; t < 90 && !S.armed(); t++) { S.step(15); await sleep(20); }
      if (!S.armed()) return "never armed";
      S._raf = window.requestAnimationFrame;
      window.requestAnimationFrame = function () { return 0; };
      await new Promise((res) => S._raf.call(window, () => res()));
      /* COUNT THE BITES AT THE FUNNEL, not off the health bar. The ridden
         shark heals on every meal and GROWS its own maxHp, so an hp delta over
         a minute measures the ladder as much as the pack. cityWildlifeHit is
         the one funnel every damage class in the game arrives through
         (city/wildlife.js says so itself), so wrapping it counts exactly the
         thing being asserted and nothing else. */
      S.hits = 0; S.dmg = 0; S.uid = 0;
      const hitFn = CBZ.cityWildlifeHit;
      CBZ.cityWildlifeHit = function (a, hit, w) {
        if (a === (CBZ.sharkSim && CBZ.sharkSim.shark)) {
          S.hits++; S.dmg += (w && w.damage) || 0;
        }
        return hitFn.apply(this, arguments);
      };
      return "";
    },
    /* Stand the ride in open water off the island, so this is a sea fight and
       not a shark aground on the foreshore. The BODY moves with the rider —
       moving one and not the other is how a staging bug photographs as a
       gameplay one. */
    offshore(out) {
      const A = CBZ.surv.arena, P = CBZ.player, S0 = CBZ.sharkSim.shark;
      const wl = (CBZ.sharkSim && CBZ.sharkSim.waterline) || A.radius, ang = 0.7;
      const x = A.center.x + Math.cos(ang) * (wl + (out || 120));
      const z = A.center.z + Math.sin(ang) * (wl + (out || 120));
      P.pos.x = x; P.pos.z = z;
      if (S0) {
        S0.pos.x = x; S0.pos.z = z;
        if (S0._waterMove) { S0._waterMove.x = x; S0._waterMove.z = z; }
      }
      S.step(10);
      return CBZ.survFloodDepthMeanAt ? +CBZ.survFloodDepthMeanAt(x, z).toFixed(1) : -1;
    },
    /* Hold the wound open: the point of the run is the pack's behaviour, not
       how fast a shark heals. The mass pin goes with it — the shark eats
       automatically whenever something is in front of it, and an EVOLUTION
       mid-run swaps the body for a different actor, which drops every lock in
       the sea and reads as the pack losing interest. (It read exactly that way
       on the first run of this tool.) */
    hold(frac) {
      S.pin = frac;
      const s = CBZ.sharkSim.shark;
      s.hp = Math.max(1, s.maxHp * frac);
      CBZ.sharkSim.mass = 0;
      return +(s.hp / s.maxHp).toFixed(3);
    },
    heal() { S.pin = 0; const s = CBZ.sharkSim.shark; s.hp = s.maxHp; return 1; },
    /* WHO IS ON ME, AND HOW CLOSE. Read off each hunter's own live target
       record — the same _mp the drive writes — so this cannot pass while the
       animals are merely nearby, which is exactly how the pre-§2b build read. */
    pack() {
      const me = CBZ.sharkSim.shark, list = CBZ.cityWildlife || [];
      const out = { locks: 0, kind3: 0, meanD: 0, minD: 1e9, species: {} };
      let acc = 0;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || a.dead || a === me || !a._mp || a._mp.target !== me) continue;
        const d = Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z);
        out.locks++; acc += d;
        if (a._mp.kind === 3) out.kind3++;
        if (d < out.minD) out.minD = d;
        const id = a.species && a.species.id || "?";
        out.species[id] = (out.species[id] || 0) + 1;
      }
      out.meanD = out.locks ? +(acc / out.locks).toFixed(1) : null;
      if (out.minD > 1e8) out.minD = null; else out.minD = +out.minD.toFixed(1);
      out.bleedSev = CBZ.marineBleedingSev ? +(CBZ.marineBleedingSev(me) || 0).toFixed(2) : null;
      out.hpf = +(me.hp / me.maxHp).toFixed(3);
      out.sp = me.species && me.species.id;
      if (!me.__uid) me.__uid = ++S.uid;
      out.uid = me.__uid;
      out.chum = CBZ.goreChumList ? CBZ.goreChumList().length : -1;
      out.sharksAlive = list.filter(function (a) {
        return a && !a.dead && a !== me && a.species && (a.species.bite || 0) >= 12 && a.species.aquatic;
      }).length;
      return out;
    },
    // Damage the pack actually lands, isolated from the hold above: run a
    // stretch with the wound pinned, then read how far below the pin we fell.
    biteRun(secs, pin) {
      S.pin = pin;
      const h0 = S.hits, d0 = S.dmg;
      S.sec(secs);
      const s = CBZ.sharkSim.shark;
      return { hits: S.hits - h0, dmg: +(S.dmg - d0).toFixed(0), maxHp: +s.maxHp.toFixed(0),
               presses: (CBZ.marineAudit && CBZ.marineAudit().presses) || 0 };
    },
  };
  return S;
})();`;

async function run(rig, extraParams) {
  await rig.open("index.html",
    `mode=sharksim&seed=${SEED}&bots=24&cfg_BOOT_METER=0${extraParams || ""}`);
  if (!await rig.wait("window.CBZ && CBZ.stepSim && document.getElementById('playBtn')", 120000)) {
    throw new Error("page never became ready");
  }
  await rig.evl(DRIVER);
  const why = await rig.evl("__BL.boot()", true);
  if (why) throw new Error(why);
  return rig.evl("__BL.offshore(120)", true);
}
const pack = (rig) => rig.evl("JSON.stringify(__BL.pack())", true).then(JSON.parse);

const out = { seed: SEED, control: null, timeline: [], release: null, revert: null, bite: null, fails: [], shots: [] };
let rig = null;
try {
  rig = await launch({ rafBudget: 0 });
  const column = await run(rig);
  say(`[stage] offshore in ${column} m of water`);

  // let the sea stock itself so there is a population to draw from
  await rig.evl("__BL.sec(25)", true);
  out.control = await pack(rig);
  say(`[control] healthy: ${out.control.locks} hunters locked on, ` +
      `${out.control.sharksAlive} toothed animals in the sea`);

  // ---- 2/3. the lock and the close -----------------------------------------
  await rig.evl("__BL.hold(0.35)", true);
  /* SIXTY SECONDS, NOT THIRTY. The pack is drawn from FRENZY_R (340 m) and a
     shark crosses that at its own cruise speed — measured, the first lock
     lands at ~250 m and the nearest is still 80 m out at thirty seconds. That
     IS the beat: something you cannot see yet has decided about you, and it is
     coming. Asserting on a thirty-second window would have measured swimming
     speed and called it target selection. */
  for (let t = 1; t <= 10; t++) {
    await rig.evl("__BL.sec(6)", true);
    const p = await pack(rig);
    p.t = t * 6;
    out.timeline.push(p);
    say(`[t+${String(p.t).padStart(2)}s] ${p.locks} locked (${p.kind3} on blood) · ` +
        `mean ${p.meanD == null ? "—" : p.meanD + " m"} · nearest ${p.minD == null ? "—" : p.minD + " m"} · ` +
        `${p.sp}#${p.uid} sev ${p.bleedSev} chum ${p.chum} · ${JSON.stringify(p.species)}`);
  }
  if (SHOTS) {
    mkdirSync(SHOT_DIR, { recursive: true });
    const png = await rig.send("Page.captureScreenshot", { format: "png" });
    const f = path.join(SHOT_DIR, "frenzy.png");
    writeFileSync(f, Buffer.from((png.result || png).data, "base64"));
    out.shots.push(f);
    say(`[shot] ${f}`);
  }

  // ---- 4. do they land anything --------------------------------------------
  out.bite = await rig.evl("JSON.stringify(__BL.biteRun(45, 0.35))", true).then(JSON.parse);
  say(`[bite] ${out.bite.hits} bites landed for ${out.bite.dmg} damage on a ${out.bite.maxHp} hp shark in 45 s ` +
      `(${out.bite.presses} committed passes so far)`);

  // ---- 5. and do they let go ------------------------------------------------
  await rig.evl("__BL.heal(); __BL.sec(14)", true);
  out.release = await pack(rig);
  say(`[release] healed: ${out.release.locks} still locked (${out.release.kind3} on blood)`);

  await rig.close(); rig = null;

  // ---- 6. the revert --------------------------------------------------------
  rig = await launch({ rafBudget: 0 });
  await run(rig, "&cfg_MARINE_FRENZY_BLOOD=0");
  await rig.evl("__BL.sec(25)", true);
  await rig.evl("__BL.hold(0.35)", true);
  for (let t = 0; t < 10; t++) await rig.evl("__BL.sec(6)", true);
  out.revert = await pack(rig);
  say(`[revert] MARINE_FRENZY_BLOOD=0: ${out.revert.locks} locked (${out.revert.kind3} on blood)`);

  // ---- the assertions -------------------------------------------------------
  const fail = (m) => out.fails.push(m);
  const peak = out.timeline.reduce((a, p) => (p.kind3 > a.kind3 ? p : a), { kind3: -1 });
  // the CLOSEST any of them ever got, over the whole run — "did they arrive"
  // is a question about the run, not about whichever sample had the most locks
  const closest = out.timeline.reduce(
    (a, p) => (p.minD != null && p.minD < a ? p.minD : a), Infinity);
  out.closestM = isFinite(closest) ? closest : null;
  const last = out.timeline[out.timeline.length - 1] || {};
  if (!(out.control.sharksAlive >= 2)) fail(`only ${out.control.sharksAlive} toothed animals in the sea — nothing to converge`);
  if (out.control.kind3 > 0) fail(`a HEALTHY shark drew ${out.control.kind3} blood locks — §2b is firing without blood`);
  if (!(last.bleedSev > 0)) fail("the ridden shark never opened a chum trail at 35% health");
  if (!(peak.kind3 >= 2)) fail(`bleeding drew only ${Math.max(0, peak.kind3)} blood lock(s) in 60 s — a frenzy is a crowd`);
  if (!(out.closestM != null && out.closestM <= 25)) fail(`the pack locked on but never closed (closest ${out.closestM} m)`);
  if (!(out.bite.hits >= 3)) fail(`the pack landed ${out.bite.hits} bite(s) in 45 s — it is circling, not feeding`);
  if (!(out.release.kind3 === 0)) fail(`${out.release.kind3} hunters still on blood after healing — the leash never lets go`);
  if (out.revert.kind3 > 0) fail(`?cfg_MARINE_FRENZY_BLOOD=0 still produced ${out.revert.kind3} blood locks — the revert is not a revert`);
} catch (err) {
  out.fails.push(String((err && err.message) || err));
} finally {
  if (rig) await rig.close();
}

if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
else {
  console.log("");
  console.log(out.fails.length ? "FAIL\n  " + out.fails.join("\n  ") : "PASS — every invariant held");
}
process.exit(out.fails.length ? 1 : 0);
