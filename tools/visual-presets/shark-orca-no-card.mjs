/* tools/visual-presets/shark-orca-no-card.mjs — THE KILL THAT USED TO END THE GAME.

   OWNER, 2026-09-01: "That's fucking stupid. Game should not end. Remove that
   screen god damn it."

   Shark Sim spent four rungs teaching you that eating is how you get bigger,
   handed you the MEGALODON, and then — the first time you used it on the one
   animal the whole climb is aimed at — took the water away and put up a
   VICTORY card. The reward for reaching the top of the food chain was being
   ejected from the game.

   This preset photographs exactly that moment, on both builds, with the same
   script: boot Shark Sim, climb to megalodon, put an orca in the jaws, kill
   it, and then keep playing. BEFORE (the old code) the screen is a scoreboard.
   AFTER it is the sea.

   BOTH SIDES ARE THE SAME MODE AND THE SAME SEED — the only difference is the
   CODE each server is serving. A self A/B cannot photograph this: what changed
   is a screen that no longer exists, and no flag brings it back (which is the
   point of deleting it rather than gating it). So the before column is a
   COMMIT, stood up by launchSides() at the bottom of this file:

     ba shark-orca-no-card

   is the whole command. */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/* THE BASELINE IS PINNED BY SHA, NOT BY HEAD~1. This repo has several agents
   pushing to main; "the commit before mine" stops being HEAD~1 the moment
   somebody else lands anything, and a before column quietly serving the wrong
   build looks exactly like a clean pair. BA_ORCA_BASE overrides it. */
const BASE_SHA = process.env.BA_ORCA_BASE || "f645dc9";

async function stageOrcaKill(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NEED = [0, 14, 34, 75];                 // the ladder's mass thresholds

  let D = window.__orcaBA;
  if (!D) {
    D = window.__orcaBA = {
      chapter: -1, waterline: 0, kills: 0, killStep: 0, steps: 0,

      step(n) { for (let i = 0; i < n; i++) { CBZ.stepSim(1 / 30); D.steps++; } },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },
      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 60 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline;
        // the page's own frame loop dies here: a detached tripod has to
        // survive to the capture, and the comparator renders explicitly
        D._rafOrig = window.requestAnimationFrame;
        const orig = D._rafOrig;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
        return true;
      },

      // ---- staging helpers (the same engine-only grammar shark-sim uses) ----
      depth(x, z) { return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0; },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      shallow(extra) {
        const P = CBZ.player, p = D.ringPoint(D.playerAngle(), D.waterline + 6 + (extra || 0));
        P.pos.x = p.x; P.pos.z = p.z;
      },
      /* Push every big predator far away and top the shark up. The ladder
         climb is not what this preset is about, and a pod that mauls the
         great white on the way up is a failed run, not a finding. */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.pos.x += 500; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        const S = CBZ.sharkSim.shark;
        if (S) S.hp = S.maxHp;
        CBZ.sharkSim.podT = 45;
      },
      jawAhead() {
        const S = CBZ.sharkSim.shark;
        const jp = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(S)) || { x: 2.1 };
        return jp.x * (S.species.scale || 1);
      },
      bait(n) {
        const S = CBZ.sharkSim.shark, h = S.heading || 0, jaw = D.jawAhead();
        let placed = 0;
        for (const b of CBZ.bots) {
          if (!b || b.dead || placed >= n) continue;
          const d = jaw + 1.2 + placed;
          b.pos.x = S.pos.x + Math.cos(h) * d; b.pos.z = S.pos.z + Math.sin(h) * d;
          b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
          b.target.set(b.pos.x, 0, b.pos.z); b.pause = 40;
          placed++;
        }
        return placed;
      },
      feedToTier(tier) {
        const sim = CBZ.sharkSim;
        for (let round = 0; round < 6 && sim.tier < tier; round++) {
          D.peace(); D.shallow(4); D.step(12);
          sim.mass = Math.max(sim.mass, NEED[tier]);
          D.bait(2);
          for (let s = 0; s < 120 && sim.tier < tier; s++) D.step(1);
        }
        return sim.tier >= tier && D.armed();
      },
      /* ONE ORCA, IN THE TEETH, ALREADY MAULED. The subject is what the game
         does AFTER the kill, not how long a healthy orca survives a chase —
         so the meal is staged the way tools/shark-sim-check.mjs stages it. */
      killOneOrca() {
        const sim = CBZ.sharkSim, S = sim.shark;
        const before = D.liveOrcas();
        for (let round = 0; round < 4; round++) {
          let o = D.findWild("orca");
          if (!o && CBZ.cityWildlifeSpawnAt) o = CBZ.cityWildlifeSpawnAt("orca", S.pos.x + 40, S.pos.z);
          if (!o) break;
          const h = S.heading || 0, jaw = D.jawAhead();
          o.hp = 40;
          o.pos.x = S.pos.x + Math.cos(h) * (jaw + 1.5);
          o.pos.z = S.pos.z + Math.sin(h) * (jaw + 1.5);
          o.pos.y = S.pos.y;
          if (o._waterMove) { o._waterMove.x = o.pos.x; o._waterMove.z = o.pos.z; }
          for (let s = 0; s < 120; s++) { D.step(1); if (o.dead || o.hp <= 0) break; }
          if (o.dead || o.hp <= 0) { D.kills++; D.killStep = D.steps; return true; }
        }
        return D.liveOrcas() < before;
      },
      liveOrcas() {
        let n = 0;
        for (const a of CBZ.cityWildlife || []) if (!a.dead && a.species && a.species.id === "orca") n++;
        return n;
      },
      findWild(id) {
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && !a.external && !a.ridden && a.species && a.species.id === id && a.grow == null) return a;
        }
        return null;
      },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },
      /* The ¾ portrait shark-sim.mjs proved: this sea photographs opaque, so
         a submerged hull is an empty frame. Ride the body with its back out. */
      bodyShot(S) {
        const s = Math.max(1, (S.species && S.species.scale) || 1);
        const h = S.heading || 0, ang = h + 2.35;
        const D0 = 6.5 + 5.5 * s;
        const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
        if (S.group && sy - S.pos.y > 0.25 * s) {
          S.group.position.y = sy - 0.08 * s;
          S.group.updateMatrixWorld(true);
        }
        D.tripod(
          S.pos.x + Math.cos(ang) * D0 * 0.8, sy + 1.1 + 1.1 * s, S.pos.z + Math.sin(ang) * D0 * 0.8,
          S.pos.x, S.pos.y + 0.2 * s, S.pos.z);
      },
      clearBanner() {
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      cardUp() {
        const w = document.getElementById("survwin"), l = document.getElementById("survlose");
        return (w && !w.classList.contains("hidden")) || (l && !l.classList.contains("hidden")) ? 1 : 0;
      },
    };
    /* THE PRESENT IS THE PRODUCT (learned the hard way by shark-sim.mjs, and
       kept identical here). With the page's frame loop dead, a canvas rendered
       outside an animation frame is never PRESENTED: the compositor keeps
       serving the last pre-kill frame, so every screenshot photographs a frozen
       surface while the backbuffer holds the correct staged image. Render
       inside ONE real animation frame — the game loop's own chain is already
       broken, so lending RAF back for a single callback cannot restart it —
       then wait out SwiftShader's compositor before the capture. */
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
      advance(sec) { D.sec(sec); },
    };
  }

  const out = {};
  const CH = [
    /* 0 — THE MEGALODON, FED AND ALONE. Both columns arrive here identically;
       this is only the run-up, and it is photographed so the pair proves the
       two sides started from the same animal in the same water. */
    async function megalodon() {
      if (!await D.boot()) throw new Error("no shark sim match");
      if (!D.feedToTier(3)) throw new Error("never evolved to megalodon");
      D.peace(); D.shallow(2); D.sec(1.2);
      D.clearBanner();
      D.bodyShot(CBZ.sharkSim.shark);
      out.stillPlaying = CBZ.game.state === "playing" ? 1 : 0;
      out.cardOnScreen = D.cardUp();
      out.orcaKills = D.kills;
    },
    /* 1 — TWO AND A HALF SECONDS AFTER THE ORCA DIES. The whole change is in
       this frame: BEFORE, the sea is gone and a card is counting your run;
       AFTER, you are still swimming and the pod is still out there. */
    async function justAfterTheKill() {
      D.clearBanner();
      if (!D.killOneOrca()) throw new Error("the megalodon never killed an orca");
      D.sec(2.5);
      D.clearBanner();                       // the banner is not the subject; the SCREEN is
      const S = CBZ.sharkSim.shark;
      if (S) D.bodyShot(S);
      out.stillPlaying = CBZ.game.state === "playing" ? 1 : 0;
      out.cardOnScreen = D.cardUp();
      out.orcaKills = D.kills;
    },
    /* 2 — TWELVE SECONDS AND A SECOND ORCA LATER. A card does not go away on
       its own, so this beat separates "the run continued" from "the card was
       simply late": one side is still a scoreboard, the other has eaten
       again. On the old build the second kill cannot be credited at all —
       sharkSimBite returns early once the match has resolved — which is
       itself the finding. */
    async function twelveSecondsLater() {
      D.clearBanner();
      const alive = CBZ.game.state === "playing";
      if (alive) D.killOneOrca();
      D.sec(12);
      D.clearBanner();
      const S = CBZ.sharkSim.shark;
      if (S) D.bodyShot(S);
      out.stillPlaying = CBZ.game.state === "playing" ? 1 : 0;
      out.cardOnScreen = D.cardUp();
      out.orcaKills = D.kills;
      out.podAlive = D.liveOrcas();
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  window.__cbzVisualCompare.render();
  const sim = CBZ.sharkSim || {};
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      state: CBZ.game.state,
      tier: sim.tier == null ? null : sim.tier,
      mass: sim.mass == null ? null : sim.mass,
      ended: !!sim.ended,
      simOrcas: sim.orcas == null ? "(no such field)" : sim.orcas,
      secsSinceKill: D.killStep ? Number(((D.steps - D.killStep) / 30).toFixed(1)) : null,
    },
    metrics: out,
  };
}

export default {
  id: "shark-orca-no-card",
  title: "Shark Sim — The Orca Kill Stops Ending The Game",
  description: "The one kill the whole ladder is aimed at, photographed on both builds with the same script: boot Shark Sim, climb to MEGALODON, put an orca in the jaws, kill it, keep playing. BEFORE: the sea is replaced by a VICTORY card — the reward for reaching the top of the food chain was being ejected from the water. AFTER: no card, no scoreboard. The meal lands, the body grows, the pod restocks and you are still swimming; the only screen this mode has left is EATEN, when something finally kills your shark.",
  beforeLabel: "BEFORE · eating an orca ends the run",
  afterLabel: "AFTER · eating an orca is a meal",
  pairNote: "Same mode · same island · same seed · same staging script — only the code differs",
  method: "Both columns boot index.html?mode=sharksim at seed 90210 by clicking the Shark Sim tile and PLAY like a player, then freeze the page's frame loop and advance the real match with CBZ.stepSim so a capture cannot race the renderer. The ladder is climbed with engine APIs only (mass credited, live survivors baited into the jaws); the orca is staged the way tools/shark-sim-check.mjs stages it — one already-mauled body inside the megalodon's own jaw reach. Every capture is the full live page, HUD, killfeed and end cards included. The two servers differ only in the checkout they serve.",
  stageTimeoutMs: 300000,
  metrics: {
    stillPlaying: { label: "Match still playing", better: "higher" },
    cardOnScreen: { label: "End card covering the sea", better: "lower" },
    orcaKills: { label: "Orcas killed by the megalodon", better: "higher" },
    /* NO DIRECTION ON THIS ONE, DELIBERATELY. It is context, not a score: the
       AFTER column eats a SECOND orca, so it legitimately has one fewer in the
       water at capture time, and declaring it better:"higher" made the run
       report a regression for doing exactly the thing the change enables. A
       metric whose good direction depends on another metric is not a metric. */
    podAlive: { label: "Orcas left in the water (context, not a score)" },
  },
  metricsNote: "stillPlaying and cardOnScreen are 1/0 flags read off the live page at capture time (#survwin / #survlose visibility). BEFORE flips them on the first orca and never recovers; AFTER never flips them at all.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeStock && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  /* cfg_BOOT_METER=0: the presented start eases its boot card on a RAF chain
     and this preset kills the frame loop right after boot — one dead frame in
     that chain latches state.js's bootBusy forever. With the meter off,
     startRunPresented falls through to the synchronous startRun. */
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  /* ---- THE BEFORE COLUMN IS A COMMIT --------------------------------------
     The worktree is REMOVED AND RE-ADDED every run: a reused one is a previous
     run's leftovers plus whatever wrote into it since, and that is the worst
     failure this tool has — it looks like a clean pair and is comparing
     nothing. (Learned by megalodon-sight.mjs, which this follows.) */
  async launchSides(ctx) {
    const root = (ctx && ctx.repoRoot) || ROOT;
    const wt = path.join(os.tmpdir(), "ba-shark-orca-no-card-base");
    const git = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
    try { git(["worktree", "prune"]); } catch (e) {}
    git(["worktree", "add", "--detach", "--force", wt, BASE_SHA]);

    const serverPath = path.join(wt, "tools", "devserver.py");
    if (!existsSync(serverPath)) throw new Error("baseline worktree has no tools/devserver.py at " + serverPath);
    // a port nothing else in this repo's tooling claims (probe.mjs takes 9200+,
    // ba's own static server 8700+, megalodon-sight 8931)
    const port = 8933;
    const srv = spawn("python3", [serverPath], {
      cwd: wt, env: Object.assign({}, process.env, { PORT: String(port) }),
      stdio: "ignore", detached: true,
    });
    const origin = `http://127.0.0.1:${port}/`;
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { up = (await fetch(origin, { method: "HEAD" })).ok; } catch (e) { /* not yet */ }
      if (!up) await sleepMs(150);
    }
    if (!up) throw new Error("baseline server never answered at " + origin);
    if (ctx && ctx.log) ctx.log(`[shark-orca-no-card] BEFORE = ${BASE_SHA} at ${wt} on ${origin}`);

    return {
      before: origin,
      label: `${BASE_SHA} (the orca kill still ends the game) vs working tree`,
      async close() {
        try { process.kill(-srv.pid, "SIGTERM"); } catch (e) { try { srv.kill(); } catch (e2) {} }
        try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
      },
    };
  },
  subjects: [
    {
      id: "megalodon", ch: 0,
      label: "The Run-Up — Both Sides Are The Same Megalodon",
      focus: "The control frame. Both columns climbed the identical ladder to the same body in the same water, so anything that differs after this point is the change and nothing else.",
    },
    {
      id: "just-after-the-kill", ch: 1,
      label: "Two Seconds After The Orca Dies",
      focus: "The whole change, in one frame. BEFORE: the sea is gone — VICTORY ROYALE's markup filled with APEX PREDATOR, a placement, a Play Again button. AFTER: no card. You ate the biggest thing in the water and the water is still there.",
    },
    {
      id: "twelve-seconds-later", ch: 2,
      label: "Twelve Seconds And Another Orca Later",
      focus: "Proof it was an ending, not a slow card. BEFORE: still the scoreboard — and the second kill cannot even be credited, because the bite handler returns early once the match has resolved. AFTER: the megalodon has eaten again and the pod has restocked behind it.",
    },
  ],
  stage: stageOrcaKill,
};
