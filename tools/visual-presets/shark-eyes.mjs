/* WHAT A SHARK CAN SEE, AND WHAT IT SHOULD NOT BE LOOKING THROUGH.

   THREE REPORTS, ONE ANIMAL (owner, 2026-09-01):

     "underwater my shark can't see a shark 20 feet ahead that's dumb I want to
      see farther"

     "first person shark game should not have a crosshair"

     "shark cam should follow movement?"

   THE SEA WAS SOLVED FOR A DIVER DECIDING WHETHER A THING IS THERE, and the
   player needs to decide what it is DOING. world/water_underwater.js solves
   its sighting range from Duntley's contrast law every frame, and the physics
   is right — clear tropical water really does close at ~38 m. Three of those
   correct numbers multiply, though, and MEASURED on the live page before this
   change, at night (which is over half the day cycle):

     level                    12.2 m
     ahead and slightly down   6.8 m   <- twenty-two feet. the report, exactly.
     straight down             2.5 m

   The pose a shark hunts in is looking slightly down and ahead, and that is
   the number the sea had erased. It is three terms: C0_DOWN = 0.20 (an IDEALLY
   countershaded body against unlit gloom — these animals are lit, moving and
   edged with fins), EPS_MAX = 0.45 (the scotopic branch allowed to raise the
   threshold contrast 55x, which is what turns night into four metres), and no
   allowance anywhere for the difference between detecting a thing and playing
   against it. The physical constants and their papers are untouched; the three
   that erase the game are overridden in one labelled block, with a floor so no
   lighting can put the range inside the animal.

   A SHARK HAS NO GUNSIGHT. systems/fpsmode.js drops the first-person hands on
   an aquatic mount — you are the animal, and animals have no hands — and the
   ammo readout hides itself for free because it asks armed(). The reticle
   asked nothing at all: it was gated on fpsmode being ACTIVE, full stop. So
   the eye view put a firearm crosshair in the middle of a shark's face. It now
   shares the hands' predicate, so the two cannot disagree about whether you
   are currently a person.

   AND THE CAMERA TRAILS THE BODY. A shark is steered, not walked; its body
   turns continuously and a world-fixed bearing means dragging the view back
   all match. Three files write cam.yaw from player input, so rather than
   teach all three to report in, the follow remembers what it last wrote and
   treats any difference as a hand — the foreign-write probe water_underwater
   already uses on its own fog. Look anywhere and it stands down instantly.
   MEASURED: while W is held the BODY still turns to your view in 1.0 s and the
   camera does not move at all, so steering is untouched; it only acts when you
   stop steering.

   FLAGLESS, SO THE BEFORE COLUMN IS A BUILD. Nothing here ships behind a cfg_
   toggle. launchSides() checks HEAD out into a throwaway worktree and serves
   it, so BEFORE is the shipped commit and AFTER is this working tree.

     ba shark-eyes
*/

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const subjects = [
  {
    id: "night-hunt", ch: 0,
    label: "NIGHT — The Shark Twenty Feet Away",
    focus: "The report, staged as the report. Full dark, open water, another shark parked 14 m ahead and slightly below — the pose this game is hunted in. BEFORE: the sighting range in that direction is 6.8 m, so a body at 14 m is at twice the distance the sea erases it and the screen is water. AFTER: 23.3 m of range and the animal is there. The metric under it is not the model's own number but PIXELS — peak contrast against the ring of water immediately around the body, and the share of its disc that differs from that water at all. 'I can see it' counted, not asserted.",
  },
  {
    id: "day-hunt", ch: 1,
    label: "DAY — The Same Shark, Further Out",
    focus: "The same beat in full sun at 26 m, to show the change is not a night patch bolted onto a working day. BEFORE: 27.8 m of range against a body at 26 m — technically inside it, which is exactly the trouble, because Duntley's range is where contrast reaches the threshold of DETECTION and a thing at 94% of it is a smudge. AFTER: 40.6 m, and the same body at the same distance is solid. Watch the far water too: the whole column reads deeper.",
  },
  {
    id: "eye-view", ch: 2,
    label: "THE EYE VIEW — No Crosshair On A Fish",
    focus: "First person, riding the shark, exactly as the view chooser leaves it. BEFORE: a firearm reticle in the centre of the screen, on an animal with no hands, no ammo readout and no gun — the one piece of the gun HUD that never learned about the ride. AFTER: nothing. The metric is binary and the pair is the proof; look at the middle of the frame.",
  },
  {
    id: "cam-trail", ch: 3,
    label: "THE CAMERA COMES BACK BEHIND THE ANIMAL",
    focus: "The camera is knocked 90 degrees off the shark's heading — the state you are left in every time you look around — and then nothing touches it for three and a half seconds. BEFORE: it stays where it was put, because the chase yaw is world-fixed, so a swimming animal turns out from under its own camera and you spend the match dragging the view back. AFTER: it holds still through a 0.65 s dead time so a glance is never fought, then eases back in behind the body. The metric is the angle between the lens and the animal's own heading.",
  },
];

async function stageSharkEyes(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkEyes;
  if (!D) {
    D = window.__sharkEyes = {
      chapter: -1, waterline: 0, target: null,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },

      async boot() {
        try { localStorage.setItem("CBZ_SHARK_VIEW_V1", "chase"); } catch (e) {}
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 80 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline;
        const card = document.getElementById("sharkviewpick");
        if (card) { const b = card.querySelector("button"); if (b) b.click(); }
        /* PIN THE SEAT AND FAIL IF IT DID NOT TAKE. Two of these four beats are
           about which seat you are in; a run that drifts still returns numbers,
           they are just about the other camera. */
        if (CBZ.setFPS) { try { CBZ.setFPS(false); } catch (e) {} }
        D.step(20);
        if (CBZ.fps && CBZ.fps.active) return false;
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        return true;
      },
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },

      // ---- the island, and the water to stand the beat in --------------------
      arena() { return CBZ.surv.arena; },
      depth(x, z) { return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0; },
      /* THE DEEPEST COLUMN ON THIS BEARING. A sighting beat staged over a shelf
         photographs the seabed, which has its own colour and would decide the
         contrast measurement instead of the water. */
      offshore() {
        const P = CBZ.player, A = D.arena();
        const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
        let best = null, bestD = -1;
        for (let r = D.waterline + 20; r < D.waterline + 700; r += 6) {
          const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
          const d = D.depth(x, z);
          if (d > bestD) { bestD = d; best = { x, z }; }
        }
        if (best) { P.pos.x = best.x; P.pos.z = best.z; D.step(6); }
        return bestD;
      },
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a === D.target) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.pos.x += 800; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 60;
        }
      },
      dive(sec) {
        const k = CBZ.keys;
        k.w = true; k.control = true;
        D.step(Math.max(1, Math.round((sec || 4) * 30)));
        k.control = false; k.w = false; D.step(20);
      },
      night(on) {
        // dayPhase is the sky clock; daynight.js re-derives dayness from it
        // every frame, so writing CBZ.dayness directly is overwritten and
        // measures nothing (it did, on the first pass of this preset).
        if (CBZ.dayPhase) CBZ.dayPhase(on ? 0.75 : 0.28);
        D.step(10);
      },

      /* THE OTHER SHARK, PARKED. Placed along the LENS's own forward vector at
         a fixed range and a fixed downward offset, so both columns photograph
         the same body at the same distance in the same water and the only
         thing that can differ is whether the sea carries it. */
      placeTarget(rangeM, down) {
        const cam = CBZ.camera, P = CBZ.player;
        const fwd = new T.Vector3();
        cam.getWorldDirection(fwd);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(1, 0, 0);
        fwd.normalize();
        const ex = cam.position.x + fwd.x * rangeM;
        const ez = cam.position.z + fwd.z * rangeM;
        const ey = cam.position.y - (down || 0) * rangeM;
        let a = D.target;
        if (!a && CBZ.cityWildlifeSpawnAt) {
          a = D.target = CBZ.cityWildlifeSpawnAt("great_white_shark", ex, ez);
          if (a) D.step(6);
        }
        if (!a) return null;
        a.dead = false; a.hunger = 0; a.state = "wander"; a.alarm = 0;
        a.pos.x = ex; a.pos.z = ez; a.pos.y = ey;
        if (a._waterMove) { a._waterMove.x = ex; a._waterMove.z = ez; a._waterMove.y = ey; }
        D.step(4);
        if (a.group) {
          a.group.position.set(ex, ey, ez);
          a.group.visible = true;
          // face across the lens so the body reads as a body, not a point
          const h = Math.atan2(fwd.x, fwd.z) + Math.PI / 2;
          a.heading = h; a.faceH = h;
          if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(a.group, h); } catch (e) {} }
          a.group.updateMatrixWorld(true);
        }
        // and point the lens at it, so the beat is not about where the camera drifted
        cam.lookAt(new T.Vector3(ex, ey, ez));
        cam.updateMatrixWorld(true);
        return a;
      },

      // ---- what the pair claims, as numbers ---------------------------------
      /* CAN YOU SEE IT — MEASURED IN PIXELS, not read back out of the model
         that is the thing under test. Peak and mean |delta| of the body's disc
         against the RING of water immediately around it, which is exactly what
         its contrast is judged against by Duntley and by an eye. Lifted from
         tools/shark-sight-check.mjs so a tool and a preset cannot disagree. */
      seen(a) {
        const R = CBZ.renderer, cam = CBZ.camera;
        if (!R || !cam || !a || !a.group) return null;
        cam.updateMatrixWorld(true);
        R.render(CBZ.scene, cam);
        const gl = R.getContext();
        const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
        const box = new T.Box3().setFromObject(a.group);
        if (!isFinite(box.min.x)) return null;
        const c = box.getCenter(new T.Vector3());
        const rad = Math.max(0.6, box.getSize(new T.Vector3()).length() * 0.5);
        const ndc = c.clone().project(cam);
        const px = Math.round((ndc.x * 0.5 + 0.5) * W), py = Math.round((ndc.y * 0.5 + 0.5) * H);
        const dist = c.distanceTo(cam.position);
        const rpx = Math.max(6, Math.round(H * (rad / Math.max(0.5, dist)) /
          (2 * Math.tan(cam.fov * Math.PI / 360))));
        const half = Math.min(Math.floor(Math.min(W, H) / 2) - 2, Math.round(rpx * 1.9));
        const x0 = Math.max(0, px - half), y0 = Math.max(0, py - half);
        const w = Math.min(W - x0, half * 2), h = Math.min(H - y0, half * 2);
        if (w < 8 || h < 8 || ndc.z > 1) return { err: "off screen" };
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        const inR = rpx, outR0 = rpx * 1.35, outR1 = rpx * 1.85;
        const ring = [[], [], []];
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dx = (x0 + x) - px, dy = (y0 + y) - py, d = Math.hypot(dx, dy);
          if (d < outR0 || d > outR1) continue;
          const i = (y * w + x) * 4;
          ring[0].push(buf[i]); ring[1].push(buf[i + 1]); ring[2].push(buf[i + 2]);
        }
        if (ring[0].length < 24) return { err: "no background ring" };
        const med = ring.map((v) => { v.sort((p, q) => p - q); return v[v.length >> 1]; });
        let peak = 0, over = 0, inside = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dx = (x0 + x) - px, dy = (y0 + y) - py;
          if (Math.hypot(dx, dy) > inR) continue;
          const i = (y * w + x) * 4;
          const d = Math.max(Math.abs(buf[i] - med[0]), Math.abs(buf[i + 1] - med[1]),
            Math.abs(buf[i + 2] - med[2]));
          inside++;
          if (d > peak) peak = d;
          if (d >= 3) over++;             // ~1.2% of range: a step an eye resolves
        }
        return {
          rangeM: +dist.toFixed(1), peak255: peak,
          litPct: +(100 * over / Math.max(1, inside)).toFixed(1),
        };
      },
      sightAhead() {
        const ws = CBZ.waterSight;
        return ws ? +ws.rangeAt(-0.25).toFixed(1) : null;
      },
      crosshairOn() {
        const e = document.getElementById("crosshair");
        if (!e) return 0;
        const cs = window.getComputedStyle(e);
        return (cs.display !== "none" && cs.visibility !== "hidden" && +cs.opacity > 0.02) ? 1 : 0;
      },
      camErrDeg() {
        const a = CBZ.cityMountedAnimal && CBZ.cityMountedAnimal();
        if (!a || !CBZ.cam) return null;
        const h = a.heading || 0;
        const want = Math.atan2(-Math.cos(h), -Math.sin(h));
        let d = want - CBZ.cam.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        return +(Math.abs(d) * 180 / Math.PI).toFixed(1);
      },
    };

    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        const flash = document.getElementById("sharkflash");
        if (flash) { flash.style.transition = "none"; flash.style.opacity = "0"; }
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
      advance(sec) { D.step(Math.max(1, Math.round(sec * 30))); },
    };
  }

  const out = {};
  const CH = [
    async function nightHunt() {
      if (!await D.boot()) throw new Error("no match / sim never armed, or the chase seat did not take");
      D.peace();
      D.offshore();
      D.dive(3.0);
      D.night(true);
      D.peace();
      const t = D.placeTarget(14, 0.22);
      if (!t) throw new Error("no target shark");
      Object.assign(out, D.seen(t) || {});
      out.sightAheadM = D.sightAhead();
    },
    async function dayHunt() {
      D.night(false);
      D.peace();
      const t = D.placeTarget(26, 0.22);
      if (!t) throw new Error("no target shark");
      Object.assign(out, D.seen(t) || {});
      out.sightAheadM = D.sightAhead();
    },
    async function eyeView() {
      // the target is not the subject here; put it back out of the way
      if (D.target) { D.target.pos.x += 900; if (D.target.group) D.target.group.visible = false; }
      D.peace();
      if (CBZ.setFPS) CBZ.setFPS(true);
      D.step(40);
      out.crosshair = D.crosshairOn();
      out.fpsSeat = (CBZ.fps && CBZ.fps.active) ? 1 : 0;
    },
    async function camTrail() {
      if (CBZ.setFPS) CBZ.setFPS(false);
      D.step(30);
      const a = CBZ.cityMountedAnimal && CBZ.cityMountedAnimal();
      if (!a || !CBZ.cam) throw new Error("not mounted");
      /* KNOCK IT OFF THE BODY AND LET GO. No movement key is held: this beat is
         about the LENS coming back, and with W down the body would steer itself
         under the camera and close the angle from the other side. */
      const h = a.heading || 0;
      CBZ.cam.yaw = Math.atan2(-Math.cos(h), -Math.sin(h)) + Math.PI / 2;
      D.step(105);                      // 3.5 s of hands off
      out.camErrDeg = D.camErrDeg();
      out.crosshair = D.crosshairOn();
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  await window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      dayness: CBZ.dayness != null ? +CBZ.dayness.toFixed(3) : null,
      fogFar: CBZ.scene && CBZ.scene.fog ? +CBZ.scene.fog.far.toFixed(1) : null,
      submerged: CBZ.cityCameraSubmerged ? !!CBZ.cityCameraSubmerged() : null,
      fps: !!(CBZ.fps && CBZ.fps.active),
    },
    metrics: out,
  };
}

export default {
  id: "shark-eyes",
  title: "The Shark's Eyes — How Far It Sees, And What It Is Not Looking Through",
  description:
    "A FLAGLESS before/after on the live shark sim. BEFORE is the shipped commit, checked out into a throwaway git worktree and served from it; AFTER is this working tree. Three changes, one animal: the underwater sighting range is lifted out of the hole it fell into at night (the pose a shark hunts in read 6.8 m — twenty-two feet — which is the owner's report verbatim), the firearm crosshair is taken off the first-person view of an animal that has no hands, and the chase camera now eases back in behind the body when you stop steering it.",
  beforeLabel: "BEFORE · HEAD (the shipped build)",
  afterLabel: "AFTER · this working tree",
  pairNote: "Same machine · same island · same seed · the game's own camera and HUD",
  method:
    "launchSides() checks HEAD out into a detached git worktree and serves it on its own port, so the before column is a BUILD rather than a flag — none of these three changes ships behind a cfg_ toggle. Each side boots index.html?mode=sharksim on the pinned seed, clicks the mode tile and PLAY exactly like a player with the view pref pinned to the chase seat, and a per-page driver advances the real match with CBZ.stepSim (the frame loop is frozen after boot so a capture cannot race the renderer). The two sighting beats park a wild great white along the LENS's own forward vector at a fixed range and a fixed downward offset, so both columns photograph the same body at the same distance in the same water; night is set through CBZ.dayPhase, the sky clock, because daynight.js re-derives CBZ.dayness from it every frame and a direct write to dayness is silently overwritten.",
  metrics: {
    sightAheadM: { label: "Sighting range, ahead and slightly down", unit: "m", better: "higher" },
    peak255: { label: "Peak contrast of the other shark vs the water", better: "higher" },
    litPct: { label: "Share of the body that differs from the water at all", unit: "%", better: "higher" },
    rangeM: { label: "Where the other shark was parked", unit: "m", better: "neutral" },
    crosshair: { label: "Gunsight on screen", better: "lower" },
    camErrDeg: { label: "Lens off the body's heading after 3.5 s hands-off", unit: "deg", better: "lower" },
  },
  metricsNote:
    "peak255 and litPct are the claim and they are PIXELS, read back off the rendered frame rather than out of the sighting model that is the thing under test: peak |delta| of the animal's disc against the ring of water immediately around it, and the share of that disc differing by at least 3/255 — the step an eye resolves. sightAheadM is the model's own answer for the same direction, shown next to them so you can see the two agree. rangeM is the control: the SAME body at the SAME distance on both sides, so any drift there means the two columns are not photographing the same thing. crosshair is 1 or 0 and 0 is correct on a fish — it is measured through getComputedStyle, not the inline style, because that is what the player's eye gets. camErrDeg is the angle between the lens and the animal's own heading after three and a half seconds with nobody touching the look input; 90 is where it was put and 0 is behind the animal.",
  viewport: { width: 1280, height: 720 },
  readyExpression:
    "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 360000,
  subjects,
  stage: stageSharkEyes,

  /* The before column is a COMMIT, not a flag — see megalodon-sight.mjs, which
     is where this hook was first used in this repo. The worktree is removed and
     re-added every run: a reused one is a previous run's leftovers plus
     whatever wrote into it since, and a "before" quietly serving a dirty tree
     looks exactly like a clean pair while comparing nothing. */
  async launchSides(ctx) {
    const root = (ctx && ctx.repoRoot) || ROOT;
    const wt = path.join(os.tmpdir(), "ba-shark-eyes-head");
    const git = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
    try { git(["worktree", "prune"]); } catch (e) {}
    git(["worktree", "add", "--detach", "--force", wt, "HEAD"]);

    const serverPath = path.join(wt, "tools", "devserver.py");
    if (!existsSync(serverPath)) throw new Error("HEAD worktree has no tools/devserver.py at " + serverPath);
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
    if (!up) throw new Error("HEAD worktree server never answered at " + origin);
    if (ctx && ctx.log) ctx.log(`[shark-eyes] BEFORE = HEAD worktree at ${wt} on ${origin}`);

    return {
      before: origin,
      label: "HEAD vs working tree",
      async close() {
        try { process.kill(-srv.pid, "SIGTERM"); } catch (e) { try { srv.kill(); } catch (e2) {} }
        try { git(["worktree", "remove", "--force", wt]); } catch (e) {}
      },
    };
  },
};
