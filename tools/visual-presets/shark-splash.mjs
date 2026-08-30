/* Shark Sim, before/after — WHEN THE SEA ANSWERS.

   Owner, 2026-08-29: "look how in shark sim when i jump out of the water,
   sometimes the splash animation is delayed which is really funny and fucking
   dumb — clearly you made fake splashing instead of real physics."

   He is right about the symptom and half right about the cause. It was not an
   animation and it was not faked; it was fired from THE WRONG POINT ON THE
   BODY, and the error is proportional to the animal, which is the whole
   "sometimes".

   THE BUG, AS ONE SENTENCE. Every splash in a breach came from a scalar test on
   the body ORIGIN — city/wildlife_tame.js launches when `W.y >= effTop - 0.12`
   and lands when `W.y <= surf - max(0.18, draft*0.12)` — and the origin is the
   MIDDLE of the animal. The thing a player watches cross the waterline is the
   NOSE. On a twenty-two metre megalodon coming down at fifty degrees the nose
   is eleven metres and two thirds of a second ahead of the middle.

   MEASURED (tools/splash-timing-check.mjs, seed 90210, ridden breach, the
   DRAWN rig's own deepest point as the ruler on both builds):

       hammerhead    4.8 m    entry splash  2 frames late
       great white   5.1 m    entry splash  5 frames late
       megalodon    22.7 m    entry splash 21 frames LATE  (0.70 s, 9.9 m away)

   AND A SECOND ONE ON TOP OF IT. world/water_underwater.js fired a full 78 kg
   BODY splash at the CAMERA on the frame the camera crossed the waterline. A
   chase camera trails the animal, so on the megalodon that landed a second
   complete splash twenty-one frames after the first — in the wake, with nobody
   in it.

   WHAT THE PICTURES SHOW. The chapters below are photographed at frames chosen
   by the DRAWN BODY, not by either build's own opinion: the run is stepped one
   fixed frame at a time until the rig's world box says its deepest point has
   gone back under the live surface, and that frame — the one the animal is
   actually entering the sea on — is the first entry photograph. On HEAD it is a
   flat sea with a shark disappearing into it. Then +5 frames, then +18, which
   is roughly where HEAD's splash finally turns up.

   Both columns run this same driver: BEFORE is pristine wave-start HEAD served
   on its own port, AFTER is the working tree, same island, same seed, same
   ladder climb through the mode's own CBZ.sharkSimBite, the same production
   keys held for the same number of fixed steps, the same lens rule.

   HARNESS TRAP (git show ff27038): several emitters in this engine distance-
   gate on CBZ.camera and camera.js owns the lens at onAlways(50), so inside ONE
   CBZ.stepSim they read the camera the PREVIOUS step left behind. Every step
   here re-stamps the tripod AFTER the step, never only before.

   HARNESS TRAP: the stage function is SERIALIZED and evaluated inside the page,
   so it carries no module scope. Every constant it uses is declared again
   inside it; a free identifier is a ReferenceError and an empty run.
*/

const RUN = 1 / 30;

const subjects = [
  {
    id: "gw-exit", ch: 0,
    label: "Coming Out — the hole the body left",
    focus:
      "Two frames after a great white leaves the water on the same sprint-and-rise on both sides. BEFORE: the exit splash was fired on the launch frame at the ORIGIN's x/z — which for a big animal is metres under the surface and metres behind the nose — so the sea answered above an animal that had not arrived. AFTER: the crossing is owned by the nose against the live surface, the burst is placed where the surface actually cuts the body, and water keeps coming off it for every frame it is still passing through.",
  },
  {
    id: "gw-entry", ch: 1,
    label: "THE MONEY FRAME — the nose is in the water",
    focus:
      "The frame the DRAWN rig's deepest point crosses back under the live surface. This frame is chosen by the body, not by either build. BEFORE: the sea is flat. The animal is going into it and nothing is happening. AFTER: the sheet is up, at the nose, on this frame.",
  },
  {
    id: "gw-entry-5", ch: 2,
    label: "+5 frames — the curtain travelling down the body",
    focus:
      "A sixth of a second later. AFTER: the shark is still passing through the surface and water is still being thrown — the crossing is a PROCESS with a duration, not an instant, and the spray comes off the moving point where the waterline cuts the body. BEFORE: still flat.",
  },
  {
    id: "gw-entry-18", ch: 3,
    label: "+18 frames — where the old splash finally turns up",
    focus:
      "Six tenths of a second after the animal went in. BEFORE: THIS is where the splash arrives — the origin has finally sunk past the threshold, and the sea erupts behind a shark that is already gone. That delay is the owner's complaint, photographed. AFTER: the rebound jet is coming back up out of the cavity (which is a real, deliberate ~0.2 s beat, the opposite of the bug) and the foam scar is drifting downrange with the body.",
  },
  {
    id: "meg-exit", ch: 4,
    label: "A Megalodon Leaves — 87 tonnes through the waterline",
    focus:
      "The same ladder three rungs up, on a body that has eaten its way to twenty-two metres. The bigger the animal, the further its nose is from its middle, and therefore the worse the old timing got. Watch where the water is against where the animal is.",
  },
  {
    id: "meg-entry-5", ch: 5,
    label: "A Megalodon Comes Down — the frame it goes in, plus five",
    focus:
      "The frame the megalodon's drawn body re-crosses the surface, plus five. BEFORE: nothing. Its splash is still twenty frames and nine metres away. AFTER: the sea answers where the nose went in, with the animal's real kilograms, leaning downrange because it ARRIVED travelling rather than fell.",
  },
];

const readyExpression =
  "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && " +
  "CBZ.citySeaHeightAt && CBZ.cityMountedAnimal && CBZ.aquaticMountAudit && " +
  "document.getElementById('playBtn')";

async function stageSharkSplash(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const RUN = 1 / 30;                       // no module scope in here — see above
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkSplash;
  if (!D) {
    D = window.__sharkSplash = {
      chapter: -1, shot: null, _rafOrig: null,
      m: {}, box: new T.Box3(),
      fx: [], frame: -1, emitN: 0, emitFrames: 0,

      // ---------------- the page's own clock ----------------
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      reshoot() { const s = D.shot; if (s) D.tripod(s[0], s[1], s[2], s[3], s[4], s[5]); },
      shoot(px, py, pz, tx, ty, tz) { D.shot = [px, py, pz, tx, ty, tz]; D.tripod(px, py, pz, tx, ty, tz); },
      step(n) { for (let i = 0; i < n; i++) { CBZ.stepSim(RUN); D.reshoot(); } },
      sec(s) { D.step(Math.max(1, Math.round(s / RUN))); },

      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 90 && !D.armed(); t++) { D.step(12); await sleep(20); }
        if (!D.armed()) return false;
        D._rafOrig = window.requestAnimationFrame;
        const orig = D._rafOrig;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
        return true;
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },

      // ---------------- the island's own oracles ----------------
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      col(x, z) { return CBZ.cityWaterDepthAt ? Math.max(0, CBZ.cityWaterDepthAt(x, z)) : 0; },
      deepSpot(minD, ang) {
        const A = CBZ.surv.arena;
        for (let r = A.radius; r < A.radius + 460; r += 4) {
          const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
          if (D.col(x, z) > minD) return { x: x, z: z, r: r, ang: ang };
        }
        return null;
      },
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          a.pos.x += 1400; a.hunger = 0;
          if (a.group) a.group.position.x = a.pos.x;
          if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 9000;
        }
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
      },
      climbTo(tier) {
        for (let guard = 0; guard < 40 && CBZ.sharkSim.tier < tier; guard++) {
          const meal = { dead: true, hp: 0, maxHp: 900, pos: { x: 0, y: 0, z: 0 } };
          try { CBZ.sharkSimBite("animal", meal, CBZ.sharkSim.shark); } catch (e) {}
          D.step(8);
        }
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        D.step(30);
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        return CBZ.sharkSim.tier;
      },
      park(spot, heading) {
        const P = CBZ.player, a = CBZ.cityMountedAnimal && CBZ.cityMountedAnimal();
        P.pos.x = spot.x; P.pos.z = spot.z;
        if (a) {
          if (a.pos) { a.pos.x = spot.x; a.pos.z = spot.z; }
          if (a.group) { a.group.position.x = spot.x; a.group.position.z = spot.z; }
          if (a._waterMove) { a._waterMove.x = spot.x; a._waterMove.z = spot.z; }
        }
        if (CBZ.cityMountedHeading) { try { CBZ.cityMountedHeading(heading); } catch (e) {} }
        if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-Math.cos(heading), -Math.sin(heading)); CBZ.cam.pitch = 0.06; }
        D.step(6);
      },
      keys(w, shift, rise, dive) {
        const K = CBZ.keys || (CBZ.keys = {});
        K.w = !!w; K.shift = !!shift; K[" "] = !!rise; K.control = !!dive;
      },
      mount() { return CBZ.cityMountedAnimal ? CBZ.cityMountedAnimal() : null; },
      airborne() { try { return !!CBZ.aquaticMountAudit().airborne; } catch (e) { return false; } },

      /* ---------------- THE RULERS ----------------
         Everything here reads state BOTH builds have. The waterline questions
         are asked of the DRAWN RIG's world box — the deepest point of the
         animal against the live surface under it — because that is the one
         answer neither build gets to have an opinion about, and it is what the
         owner is looking at. */
      bodyLow() {
        const a = D.mount(), g = a && a.group;
        if (!g) return 99;
        D.box.setFromObject(g);
        return D.box.min.y - D.seaY(g.position.x, g.position.z);
      },
      bodyHigh() {
        const a = D.mount(), g = a && a.group;
        if (!g) return -99;
        D.box.setFromObject(g);
        return D.box.max.y - D.seaY(g.position.x, g.position.z);
      },
      /* WHERE THE NOSE IS. Off the transform and the measured snout offset —
         AFTER publishes CBZ.marineBodyEnds, HEAD does not, so this falls back
         to half of the measured length, which is what HEAD's own splash code
         would have had to assume. Reported, never used to choose a frame. */
      nose() {
        const a = D.mount(), g = a && a.group;
        if (!g) return null;
        let fwd = 0;
        if (typeof CBZ.marineBodyEnds === "function") {
          try { fwd = +(CBZ.marineBodyEnds(a) || {}).fwd || 0; } catch (e) { fwd = 0; }
        }
        if (!(fwd > 0)) {
          let L = 4;
          try { L = +CBZ.marineBodyLenLive(a) || 4; } catch (e) {}
          fwd = L * 0.5;
        }
        const p = g.rotation.z || 0, h = a.heading || 0;
        return { x: g.position.x + Math.cos(h) * Math.cos(p) * fwd,
                 z: g.position.z + Math.sin(h) * Math.cos(p) * fwd };
      },
      poolFree() {
        if (typeof CBZ.waterEmitFree !== "function") return -1;
        try { return CBZ.waterEmitFree() | 0; } catch (e) { return -1; }
      },

      /* WHAT THE SEA WAS TOLD, AND WHEN. CBZ.waterHit, CBZ.waterCrown and
         CBZ.waterEmit are all wrapped for exactly the duration of an arc and
         every call is stamped with the fixed-step index it fired on. This is
         the only honest way to ask "when did the splash happen" — a counter
         either build wrote for itself would report the number its own author
         chose. `emitFrames` counts frames on which the pool took a real batch
         (>= 6 droplets), which is how a CURTAIN that lasts for a dozen frames
         reads differently from a single burst. */
      catch(on) {
        if (on) {
          if (D._orig) return;
          D._orig = { hit: CBZ.waterHit, crown: CBZ.waterCrown, emit: CBZ.waterEmit };
          D.fx = []; D.frame = -1; D.emitFrames = 0; D.emitN = 0;
          if (typeof D._orig.hit === "function") {
            CBZ.waterHit = function (x, y, z, o) {
              try {
                D.fx.push({ f: D.frame, w: "hit", kind: (o && o.kind) || "?",
                  mass: Math.round(+((o && o.mass) || 0)),
                  speed: +(+((o && o.speed) || 0)).toFixed(2), x: x, z: z });
              } catch (e) {}
              return D._orig.hit.apply(this, arguments);
            };
          }
          if (typeof D._orig.crown === "function") {
            CBZ.waterCrown = function (o) {
              try { D.fx.push({ f: D.frame, w: "crown", h: +(+((o && o.h) || 0)).toFixed(2) }); } catch (e) {}
              return D._orig.crown.apply(this, arguments);
            };
          }
          if (typeof D._orig.emit === "function") {
            CBZ.waterEmit = function () { D.emitN++; return D._orig.emit.apply(this, arguments); };
          }
        } else if (D._orig) {
          CBZ.waterHit = D._orig.hit; CBZ.waterCrown = D._orig.crown; CBZ.waterEmit = D._orig.emit;
          D._orig = null;
        }
      },
      /* One fixed step, with the frame stamp and the per-frame droplet batch
         counted around it, and the tripod put back after. */
      tick() {
        D.frame++;
        D.emitN = 0;
        CBZ.stepSim(RUN);
        if (D.emitN >= 6) D.emitFrames++;
        D.reshoot();
      },
      until(test, budget) {
        for (let k = 0; k < budget; k++) { D.tick(); if (test()) return D.frame; }
        return -1;
      },
      firstHit(from) { for (const e of D.fx) if (e.w === "hit" && e.f >= from) return e; return null; },
    };

    window.__cbzVisualCompare = {
      /* HARNESS TRAP — A BACKGROUNDED TAB NEVER FIRES rAF, AND THIS AWAITED IT
         FOREVER. Under SwiftShader the compositor takes over a second to
         PRESENT a rendered canvas, and a canvas rendered outside an animation
         frame may not be presented at all — hence borrowing one real frame back
         (the game's own chain is already dead, so lending rAF for a single
         callback cannot restart it). But `document.hidden` is not ours to
         control: anything that takes focus while a run is in flight — another
         Chrome window, a second capture tab — backgrounds this page, and a
         backgrounded page's requestAnimationFrame is never called. MEASURED on
         a stalled run: `rAF NEVER FIRED (visibility=hidden hidden=true)`, the
         stage sat there until the 15-minute stage timeout, and every remaining
         subject would have done the same. So the borrowed frame is RACED: if it
         has not arrived in 1.5 s, render directly and carry on. A frame drawn
         outside rAF is worth infinitely more than a frame that never comes. */
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const draw = () => { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} };
        const raf = D._rafOrig;
        let drew = false;
        if (raf) {
          await new Promise((res) => {
            let done = false;
            const finish = () => { if (!done) { done = true; res(); } };
            raf.call(window, () => { draw(); drew = true; finish(); });
            setTimeout(finish, 1500);
          });
        }
        if (!drew) draw();                       // the tab was hidden: draw anyway
        await new Promise((r) => setTimeout(r, 1200));
      },
    };
  }

  const out = {};

  /* ONE BREACH, MEASURED. Drives the real keys, finds the launch and the entry
     off the DRAWN body, and leaves the lens framed on the entry point — which
     is the same rule on both sides and, because nothing in this pass touched
     the ride's physics, the same point to within centimetres. */
  async function runBreach(tier, ang, tag) {
    D.peace();
    out[tag + "Tier"] = D.climbTo(tier);
    D.peace();
    const spot = D.deepSpot(24, ang);
    if (!spot) throw new Error("no deep water off this island");
    const heading = spot.ang + Math.PI * 0.5;
    D.park(spot, heading);

    // the run-up: sprint alone first. The breach gate wants sprint AND rise AND
    // the body already at the top of its column, so holding all three from a
    // standstill is a vertical pop, not a leap.
    D.keys(true, true, false, false);
    D.sec(2.0);
    const a = D.mount();
    out[tag + "Species"] = a && a.species ? a.species.id : null;
    let L = 0; try { L = +(+CBZ.marineBodyLenLive(a)).toFixed(2); } catch (e) {}
    out[tag + "LenM"] = L;

    // the lens: abeam the run, low over the swell, aimed a body-length or two
    // downrange of the launch. Framed on the ANCHOR — identical on both sides
    // by construction — never on the animal.
    const g = a.group;
    const lx = g.position.x, lz = g.position.z, ls = D.seaY(lx, lz);
    const nx = Math.cos(heading + Math.PI * 0.5), nz = Math.sin(heading + Math.PI * 0.5);
    const reach = 5 + Math.max(4, L) * 0.9;
    const stand = 14 + Math.max(4, L) * 0.85;
    D.shoot(lx + nx * stand + Math.cos(heading) * reach, ls + 3.1 + L * 0.06,
            lz + nz * stand + Math.sin(heading) * reach,
            lx + Math.cos(heading) * reach, ls + 1.1 + L * 0.05, lz + Math.sin(heading) * reach);

    D.catch(true);
    D.keys(true, true, true, false);
    const li = D.until(() => D.airborne(), 300);
    if (li < 0) throw new Error("the mount never left the water");
    out[tag + "LaunchFrame"] = li;
    // "clear of the water" — the deepest point of the DRAWN body is above the
    // live surface. Both builds carry it; neither gets a say in it.
    const ci = D.until(() => D.bodyLow() > 0, 200);
    out[tag + "ClearFrame"] = ci;
    const exitHit = D.firstHit(0);
    out[tag + "ExitHitFrame"] = exitHit ? exitHit.f : -1;
    /* THE EXIT IS A WINDOW, NOT AN INSTANT: a dorsal fin is already through the
       surface before a breach starts, so there is no honest single frame to
       call "the nose came out". What IS honest is that the sea must answer
       while the body is on its way out — from a couple of frames before the
       origin-based airborne flag flips (the nose legitimately leads it) to the
       frame the body is clear. Outside that is a splash with nobody in it. */
    out[tag + "ExitInWindow"] =
      (exitHit && ci >= 0 && exitHit.f >= li - 3 && exitHit.f <= ci) ? 1 : 0;
    return { a: a, heading: heading, launch: li, clear: ci, L: L, tag: tag };
  }

  /* Fly the arc to the frame the DRAWN body goes back in, then aim the lens at
     that point. Returns the entry frame. */
  function toEntry(run) {
    const free0 = D.poolFree();
    const before = D.emitFrames;
    const ei = D.until(() => D.bodyLow() <= 0, 300);
    if (ei < 0) throw new Error("the mount never came back down");
    const g = run.a.group;
    const ex = g.position.x, ez = g.position.z, es = D.seaY(ex, ez);
    const n = D.nose();
    out[run.tag + "EntryFrame"] = ei;
    out[run.tag + "EntryX"] = +ex.toFixed(2);
    out[run.tag + "EntryZ"] = +ez.toFixed(2);
    D.m[run.tag + "NoseXZ"] = n ? [+n.x.toFixed(2), +n.z.toFixed(2)] : null;
    D.m[run.tag + "Free0"] = free0;
    D.m[run.tag + "EmitFramesAtEntry"] = D.emitFrames - before;
    // re-frame on the entry, by the same rule on both sides
    const nx = Math.cos(run.heading + Math.PI * 0.5), nz = Math.sin(run.heading + Math.PI * 0.5);
    const stand = 11 + Math.max(4, run.L) * 0.72;
    D.shoot(ex + nx * stand, es + 2.6 + run.L * 0.06, ez + nz * stand,
            ex, es + 0.6 + run.L * 0.05, ez);
    return ei;
  }

  /* Everything the entry is worth, as numbers, once the aftermath has run. */
  function readEntry(run, ei) {
    const hit = D.firstHit(ei - 4);
    out[run.tag + "EntryHitFrame"] = hit ? hit.f : -1;
    out[run.tag + "EntryLagFrames"] = hit ? hit.f - ei : 999;
    out[run.tag + "EntryLagSec"] = hit ? +((hit.f - ei) * RUN).toFixed(3) : 9.99;
    const n = D.m[run.tag + "NoseXZ"];
    out[run.tag + "EntryOffsetM"] = (hit && n)
      ? +Math.hypot(hit.x - n[0], hit.z - n[1]).toFixed(2) : 99;
    out[run.tag + "EntryKg"] = hit ? hit.mass : 0;
    let crowns = 0;
    for (const e of D.fx) if (e.w === "crown" && e.f >= ei - 4) crowns++;
    out[run.tag + "EntryCrowns"] = crowns;
  }

  const CH = [
    /* 0 — A GREAT WHITE LEAVES. Two frames after the launch: the water the body
       drags up out of the hole it just made. */
    async function gwExit() {
      if (!await D.boot()) throw new Error("sharksim never armed");
      D.m.gwRun = await runBreach(2, 0.7, "gw");
      D.tick(); D.tick();
      D.reshoot();
    },
    /* 1 — THE MONEY FRAME. */
    async function gwEntry() {
      const run = D.m.gwRun;
      D.m.gwEntry = toEntry(run);
      readEntry(run, D.m.gwEntry);
      D.reshoot();
    },
    /* 2 — +5 frames: the curtain still travelling down the body. */
    async function gwEntry5() {
      for (let i = 0; i < 5; i++) D.tick();
      readEntry(D.m.gwRun, D.m.gwEntry);
      D.reshoot();
    },
    /* 3 — +18 frames: where HEAD's splash finally arrives. */
    async function gwEntry18() {
      for (let i = 0; i < 13; i++) D.tick();
      readEntry(D.m.gwRun, D.m.gwEntry);
      out.gwEmitFrames = D.emitFrames;
      D.keys(false, false, false, false);
      D.catch(false);
      D.reshoot();
    },
    /* 4 — A MEGALODON LEAVES. */
    async function megExit() {
      D.m.megRun = await runBreach(3, 1.9, "meg");
      D.tick(); D.tick();
      D.reshoot();
    },
    /* 5 — AND COMES DOWN. */
    async function megEntry5() {
      const run = D.m.megRun;
      const ei = toEntry(run);
      for (let i = 0; i < 5; i++) D.tick();
      readEntry(run, ei);
      out.megEmitFrames = D.emitFrames;
      D.keys(false, false, false, false);
      D.catch(false);
      D.reshoot();
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  // ---- the overlay ----------------------------------------------------------
  let ov = document.getElementById("__splashOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "__splashOverlay";
    ov.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ov.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-read></div>";
    document.body.appendChild(ov);
  }
  const before = input.side === "before";
  const put = (k, text, css) => {
    const el = ov.querySelector("[data-" + k + "]");
    if (!el) return; el.textContent = text; el.style.cssText = css;
  };
  put("side", before ? input.beforeLabel : input.afterLabel,
    "position:absolute;top:20px;left:24px;padding:7px 11px;border-radius:7px;background:" +
    (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em");
  put("name", sub.label, "position:absolute;top:58px;left:24px;font-size:25px;font-weight:800;letter-spacing:-.02em;text-shadow:0 2px 12px #001019,0 0 26px #001019");
  put("focus", sub.focus, "position:absolute;top:94px;left:22px;color:#dfeaf2;font-size:13px;font-weight:600;max-width:720px;line-height:1.4;background:rgba(4,16,26,.62);padding:9px 12px;border-radius:8px");
  const tag = sub.ch >= 4 ? "meg" : "gw";
  const lag = out[tag + "EntryLagFrames"];
  put("read",
    (out[tag + "Species"] || "-") + " · " + (out[tag + "LenM"] || 0) + " m\n" +
    "entry splash " + (lag == null ? "-" : (lag === 999 ? "NEVER" : (lag > 0 ? "+" + lag : lag) + " frames")) +
      (out[tag + "EntryLagSec"] == null || out[tag + "EntryLagSec"] === 9.99 ? "" :
        " (" + out[tag + "EntryLagSec"] + " s)") + "\n" +
    "placed " + (out[tag + "EntryOffsetM"] == null ? "-" : out[tag + "EntryOffsetM"]) + " m from the nose\n" +
    "sea told " + (out[tag + "EntryKg"] || 0) + " kg · exit in window " + (out[tag + "ExitInWindow"] || 0),
    "position:absolute;right:22px;top:20px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#a6f0c8;white-space:pre;text-align:right;background:rgba(4,16,26,.66);padding:8px 11px;border-radius:8px;line-height:1.5");

  await window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      mode: CBZ.game.mode, tier: CBZ.sharkSim ? CBZ.sharkSim.tier : null,
      fx: D.fx.slice(-14),
      mountAudit: (typeof CBZ.aquaticMountAudit === "function") ? CBZ.aquaticMountAudit() : null,
      impact: (typeof CBZ.waterImpactStats === "function") ? CBZ.waterImpactStats() : null,
      hasWaterline: typeof CBZ.marineWaterline === "function",
    },
    metrics: out,
  };
}

export default {
  id: "shark-splash",
  title: "Shark Sim — When The Sea Answers: the splash was fired off the wrong point on the body",
  description:
    "Six frames of a shark going through the waterline, in Shark Sim on both sides. The owner: \"when i jump " +
    "out of the water, sometimes the splash animation is delayed which is really funny and fucking dumb — " +
    "clearly you made fake splashing instead of real physics.\" It was not an animation and it was not faked. " +
    "Every splash in a breach was fired from a scalar test on the body ORIGIN — the MIDDLE of the animal — " +
    "while the thing a player watches cross the waterline is the NOSE. On a 22.7 m megalodon coming down at " +
    "fifty degrees the nose is 9.9 m and 0.70 s ahead of the middle, which is exactly how late and how far " +
    "away the splash was; on the 4.8 m shark you start as the same error is two frames, which is why it was " +
    "\"sometimes\". A second, independent splash made it worse: world/water_underwater.js fired a full 78 kg " +
    "BODY splash at the CAMERA whenever the camera crossed the surface, and a chase camera trails the animal " +
    "— on the megalodon that was a second complete splash twenty-one frames later, in the wake, with nobody " +
    "in it. AFTER: a shared waterline tracker follows the body's own nose and tail against the live surface " +
    "every frame, fires the crossing where the surface actually cuts the body, keeps throwing water for every " +
    "frame the body is still passing through (a crossing is a process with a duration, not an instant), ends " +
    "it with the tail flick, and leans the whole event downrange because the animal ARRIVED travelling rather " +
    "than fell. The camera's own surface break is a spatter on the lens now, which is what it physically is.",
  beforeLabel: "BEFORE · wave-start HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same ladder · same keys · same fixed steps · same lens rule",
  method:
    "Both columns boot index.html into ?mode=sharksim at a pinned seed and click the Shark Sim tile + PLAY " +
    "exactly like a player. A per-page driver freezes the frame loop (draining the one already-queued rAF " +
    "callback, or it re-stamps the camera at an arbitrary later tick), empties the pod and the rest of the " +
    "sea, and climbs the ladder through the mode's OWN meal call (CBZ.sharkSimBite) so both sides arrive at " +
    "the same species with the same eaten-mass surplus. The breach is then driven with the REAL KEYS — two " +
    "seconds of sprint, then the rise key — held for the same number of fixed 1/30 steps on both sides. " +
    "THE PHOTOGRAPHED FRAMES ARE CHOSEN BY THE DRAWN BODY, not by either build: the run is advanced one step " +
    "at a time until Box3.setFromObject on the live rig says its deepest point has gone back under the live " +
    "surface under it, and THAT frame is the first entry photograph. Nothing in this pass touched the ride's " +
    "physics, so both columns fly the same arc and the entry points agree to centimetres (they are printed " +
    "in the metrics). Timing is read from wrappers this file installs over CBZ.waterHit, CBZ.waterCrown and " +
    "CBZ.waterEmit for exactly the duration of an arc, each call stamped with the fixed-step index it fired " +
    "on — the only honest way to ask WHEN the splash happened, since a counter either build wrote for itself " +
    "would report the number its own author chose.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 900000,
  viewport: { width: 1280, height: 720 },
  subjects,
  readyExpression,
  stage: stageSharkSplash,
  metrics: {
    gwEntryLagFrames: { label: "Great white: frames between the body entering the water and the sea answering", unit: "frames", better: "lower" },
    gwEntryLagSec: { label: "Great white: seconds of that delay", unit: "s", better: "lower" },
    gwEntryOffsetM: { label: "Great white: how far the splash landed from the nose that made it", unit: "m", better: "lower" },
    gwEntryCrowns: { label: "Great white: sheets of water thrown by the entry", unit: "sheets", better: "higher" },
    gwEntryKg: { label: "Great white: kilograms the sea was told the entry weighed", unit: "kg", better: "higher" },
    gwExitInWindow: { label: "Great white: the exit splash fired while the body was actually leaving", better: "higher" },
    megEntryLagFrames: { label: "Megalodon: frames between the body entering the water and the sea answering", unit: "frames", better: "lower" },
    megEntryLagSec: { label: "Megalodon: seconds of that delay", unit: "s", better: "lower" },
    megEntryOffsetM: { label: "Megalodon: how far the splash landed from the nose that made it", unit: "m", better: "lower" },
    megEntryCrowns: { label: "Megalodon: sheets of water thrown by the entry", unit: "sheets", better: "higher" },
    megEntryKg: { label: "Megalodon: kilograms the sea was told the entry weighed", unit: "kg", better: "higher" },
    megExitInWindow: { label: "Megalodon: the exit splash fired while the body was actually leaving", better: "higher" },
    gwEmitFrames: { label: "Great white: frames on which the sea took a real batch of droplets across the arc", unit: "frames", better: "higher" },
    megEmitFrames: { label: "Megalodon: frames on which the sea took a real batch of droplets across the arc", unit: "frames", better: "higher" },
  },
  metricsNote:
    "EntryLagFrames is the owner's complaint as one number, and both columns are measured with the same ruler: " +
    "the frame the DRAWN rig's deepest point crossed back under the live surface, against the frame CBZ.waterHit " +
    "was actually called. Zero means the sea answered on the frame the animal went in. EntryOffsetM is the other " +
    "half of the same bug — the splash was placed at the body's ORIGIN, which on a long body at a steep angle is " +
    "most of a body-length behind the nose that made it. EmitFrames is the difference between a POP and a " +
    "CROSSING: a curtain that lasts for as long as the body takes to pass through the surface consumes droplets " +
    "on a dozen consecutive frames, where a single burst consumes them on one. THE PICTURES ARE THE TEST; these " +
    "numbers only say whether the thing in the picture happened at all.",
};
