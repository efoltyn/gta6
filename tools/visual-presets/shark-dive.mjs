/* SHARK SIM — THE WATER COLUMN. A same-checkout flag A/B.

   Both columns boot the SAME build of index.html?mode=sharksim on the disaster
   island with the same pinned seed. The ONLY difference between them is the
   query string: the BEFORE column turns this wave's five flags off
   (cfg_SHARK_RIDE_DIVE=0, cfg_SHARK_BREACH=0, cfg_SHARK_RIDE_TOUCH_VERT=0,
   cfg_TOUCH_MOUNT_DIVE=0, cfg_MARINE_SIT_DEEPER=0) and therefore runs the
   pre-wave code path, byte for byte. Nothing is posed in a studio; every
   capture is the live game's own screen and HUD, advanced with CBZ.stepSim so
   the storyboard cannot depend on how fast this machine rasterises.

   THE BRIEF IT ANSWERS (owner, 2026-08-25):
     "in nat disaster world on touch when in the water you get rise and dive and
      there's real underwater; in shark sim game there's just water surface and
      you can't really dive and jumps are fake"
     "orcas and sharks are just slightly too high up in the water, it's not bad
      but this out-of-water bit should go under water and dive more naturally"

   THE TOUCH SUBJECT WANTS A TABLET. Run it on its own frame:
     node tools/visual-compare.mjs --preset shark-dive --before local \
       --subjects touch-controls --devices ipad-mini --orientations landscape
   and the rest on the default viewport:
     node tools/visual-compare.mjs --preset shark-dive --before local \
       --subjects dive-underwater,breach-air,orca-blow,wild-cruise
*/

const subjects = [
  {
    id: "touch-controls",
    label: "The Thumb Gets A Vertical Axis",
    focus: "iPad, mounted on the shark, mid-match. BEFORE: the saddle's whole touch vocabulary is one DISMOUNT pill — on a tablet there was literally no way to tell the shark to go down. AFTER: DIVE and RISE stand in the aux rail on the same Space/Ctrl grammar the survival swimmer's own pills already use, clear of the on-foot cluster (FIRE there is the mounted bite).",
  },
  {
    id: "dive-underwater",
    label: "Four Seconds Of Holding DIVE",
    focus: "Identical inputs, identical seconds, identical water. BEFORE: the body sinks but the CAMERA is pinned at the waterline — camera.js frames an island player from a 2.08 m pivot on a ~7 m boom, so the lens stays in the air and every underwater treatment in the game stays switched off. AFTER: the lens goes down with the animal and world/water_underwater.js — which was there the whole time, watching the camera — finally has something to grade.",
  },
  {
    id: "breach-air",
    strip: { frames: 6, stepSec: 0.22 },
    label: "The Jump Was Fake · Now It Is Ballistic",
    focus: "Sprint + RISE held at the top of the column, then the same 1.1 s on both sides. BEFORE: `breach: id === \"dolphin\"` meant a shark was never allowed to leave the water at all, so the 'jump' was the surface clamp letting go for a moment. AFTER: a real launch speed solved from the body's own size against the same gravity the airborne integrator uses, a real arc, and a re-entry splash scaled to the hull.",
  },
  {
    id: "orca-blow",
    label: "An Orca Taking A Breath",
    focus: "The most frequent thing an orca does — every 26-60 s, every animal in the pod. BEFORE: the blow's lift is a target ABOVE the waterline (0.85 x draft), and the animal's own CBZ.orcaSurfaceRead measured the body 2.10 m clear of the sea with a mean of 4.07 m of dorsal in the air. AFTER: the same eased curve aims at a shallow DEPTH instead of a height, and depth()'s own submersion clamp stops it with the back and the dorsal showing and nothing more.",
  },
  {
    id: "wild-cruise",
    label: "Resting Depth · A Shark And An Orca Doing Nothing",
    focus: "The idle sea, same tripod, same second. The cruise and disengage depths (the two states nobody is being hunted in) drop one notch; every hunting state — scent, circle, bump, rush, seize — keeps its own number, because those are the ones the fin is SUPPOSED to be up for.",
  },
];

async function stageSharkDive(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  Math.random = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(20260825);

  let D = window.__sharkDive;
  if (!D) {
    D = window.__sharkDive = {
      track: null,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      keys(o) {
        const k = CBZ.keys; if (!k) return;
        k.w = k.a = k.s = k.d = k.shift = k.control = k.c = false; k[" "] = false;
        for (const n in o) k[n] = o[n];
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
        for (let t = 0; t < 80 && !D.armed(); t++) { D.step(15); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline;
        /* From here the match advances ONLY when a subject steps it. Killing
           the page's own frame loop is what lets a staged camera survive to the
           capture; drain the one already-queued callback in a frame we control
           so its re-arm hits the stub and the chain is dead for good. */
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
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      /* Put the ridden body in a known, DEEP, identical column on both sides.
         Depth is the subject of this whole report, so a beat staged over a
         sandbar on one side and a trench on the other would compare nothing. */
      /* Put the ridden body in a known column of a CHOSEN depth on both sides.
         `wantDeep` matters more than it looks: the shelf where this game is
         actually played is 8-14 m (the crowd is the food, and the crowd is on
         the beach), and that is exactly the band where the old boom kept the
         lens in the air — over a 40 m trench even the unpatched camera
         eventually follows you down, so staging the dive in the abyss would
         photograph the one place the bug is mildest. */
      offshore(extra, wantDeep) {
        const P = CBZ.player, ang = D.playerAngle();
        const want = wantDeep || 34;
        let best = null, bestD = -1;
        for (let r = D.waterline + (extra || 20); r < D.waterline + 620; r += 6) {
          const p = D.ringPoint(ang, r);
          const d = CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(p.x, p.z) : 0;
          if (d > bestD) { bestD = d; best = p; }
          if (d >= want) { P.pos.x = p.x; P.pos.z = p.z; D.step(4); return d; }
        }
        if (best) { P.pos.x = best.x; P.pos.z = best.z; D.step(4); }
        return bestD;
      },
      /* Point the ride's OWN heading out to sea. keys.w moves along cam.yaw, so
         setting the yaw is how a driver steers this animal — and a dive staged
         with the nose pointed at the island swims itself into the shallows and
         photographs a bed clamp instead of a descent. */
      headOut(sec) {
        const A = CBZ.surv.arena, P = CBZ.player;
        const outward = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
        if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(outward); CBZ.cam.pitch = 0.16; }
        D.keys({ w: true });
        D.sec(sec == null ? 1.0 : sec);
        return outward;
      },
      // the camera yaw that looks ALONG a world heading (keys.w moves (-sin,-cos)·yaw)
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },
      playerCam(h, pitch) {
        if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(h); CBZ.cam.pitch = pitch == null ? 0.22 : pitch; }
        D.step(2);
      },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },
      /* Everything with teeth gets pushed away and the shark gets its hit
         points back, so a beat about DEPTH is never really a beat about a pod
         that arrived mid-capture. */
      /* NOTHING WITH TEETH IS HUNTING RIGHT NOW — and nothing is TELEPORTED to
         achieve it. The first shape of this pushed every predator 900 m down
         the x axis, which worked beautifully for one subject and then poisoned
         every later one in the same run: the pod that the resting-depth beat
         is supposed to photograph had been thrown into the deep ocean, woken
         cold with no lead to keep station on, and fell through to the generic
         wander. Measured, that turned an honest 5.02 m cruise into a 2.02 m
         submersion clamp and made two sides disagree for a reason that had
         nothing to do with the flags. Disengaging in place costs nothing and
         leaves the world it is protecting intact. */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.hunger = 0;
            const s = a._orca;
            if (s) { s.committed = false; s.interest = 0; s.quarry = null; s.rolling = 0; s.retreat = 0; s.act = ""; s.lift = 0; s.cool = 30; }
            if (a._shark) { a._shark.state = "cruise"; a._shark.bail = 6; }
            if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 120); } catch (e) {} }
          }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 120;
        }
      },
      wildOrSpawn(id, dx, dz) {
        const P = CBZ.player;
        let a = null;
        for (const w of CBZ.cityWildlife || []) {
          if (w && !w.dead && !w.external && !w.ridden && w.species && w.species.id === id && w.grow == null) { a = w; break; }
        }
        if (!a && CBZ.cityWildlifeSpawnAt) a = CBZ.cityWildlifeSpawnAt(id, P.pos.x + dx, P.pos.z + dz);
        if (!a) return null;
        a.pos.x = P.pos.x + dx; a.pos.z = P.pos.z + dz;
        if (a.group) { a.group.position.x = a.pos.x; a.group.position.z = a.pos.z; }
        if (a.home) { a.home.x = a.pos.x; a.home.z = a.pos.z; }
        if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
        a.hunger = 0.2;
        return a;
      },
      clearBanner() {
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      depths() { return (CBZ.cityAquaticRideDepths && CBZ.cityAquaticRideDepths()) || {}; },
      auxPills() {
        return Array.from(document.querySelectorAll("#tvAux .tvbtn"))
          .filter((b) => b.offsetParent !== null || b.getClientRects().length)
          .map((b) => (b.textContent || "").trim()).filter(Boolean);
      },
    };
    window.__cbzVisualCompare = {
      /* Awaited by the comparator before every capture. Under SwiftShader the
         compositor takes over a second to PRESENT a rendered canvas, so a
         shorter barrier photographs the PREVIOUS composite. */
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
      /* Film strips step the real match — and then RE-AIM, because the whole
         claim of the breach strip is that a body MOVES, and a fixed tripod
         watching a body leave the frame proves the opposite of the point. */
      advance(sec) { D.sec(sec); if (D.track) { try { D.track(); } catch (e) {} } },
    };
  }

  if (!D.booted) {
    D.booted = await D.boot();
    if (!D.booted) return { ok: false, error: "sharksim never armed" };
  }
  D.track = null;
  D.clearBanner();
  D.keys({});
  const out = {};

  if (sub.id === "touch-controls") {
    /* The touch layer builds itself on a coarse-pointer device; the comparator
       applies the iPad identity BEFORE navigation, so it is already up. The
       context watcher (touch_vehicle.js, onAlways 97) runs on the sim tick, so
       one short step is what makes it notice the saddle. */
    D.peace(); D.offshore(60, 11);
    if (CBZ.touchMode == null && CBZ.isTouchDevice && CBZ.isTouchDevice()) { /* layer decides */ }
    D.keys({ w: true });
    D.step(20);
    D.keys({});
    D.playerCam(CBZ.sharkSim.shark.heading || 0, 0.20);
    D.step(6);
    out.touchMode = !!CBZ.touchMode;
    out.auxPills = D.auxPills().join(" · ");
    out.verticalPills = D.auxPills().filter((t) => t === "DIVE" || t === "RISE").length;
    out.mountVerticalSeam = typeof CBZ.cityAquaticMountVertical === "function" ? 1 : 0;
  } else if (sub.id === "dive-underwater") {
    D.peace();
    /* THE SHELF, NOT THE ABYSS. Measured: over a 40 m trench even the
       unpatched boom eventually follows you down, so staging a dive in deep
       water photographs the one place the old camera was least wrong. The band
       this game is actually played in is the 7-9 m shelf off the beach — the
       crowd is the food and the crowd is on the sand — and that is exactly
       where a 2.08 m pivot on a ~7 m boom keeps the lens in the air no matter
       how far down the animal goes. */
    out.columnDepthM = +D.offshore(14, 8).toFixed(1);
    const S = CBZ.sharkSim.shark;
    D.headOut(0.7);
    // FOUR SECONDS OF THE SAME INPUT ON BOTH SIDES. Nothing else is staged:
    // where the lens ends up is the entire subject.
    // DIVE ONLY — no forward key. Swimming while sounding walks the body out of
    // the staged column and turns a depth comparison into a bathymetry lottery.
    D.keys({ control: true });
    D.sec(4);
    D.keys({});
    // A THREE-QUARTER CHASE, not dead astern: a shark photographed tail-on is
    // a dark blob, and the subject here is a body in a water column.
    if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong((S.heading || 0) + 0.9); CBZ.cam.pitch = 0.10; }
    D.step(3);
    const d = D.depths();
    out.bodyDepthM = d.bodyDepth;
    out.camDepthM = d.camDepth;
    out.cameraSubmerged = d.submerged ? 1 : 0;
    out.fogFarM = CBZ.scene && CBZ.scene.fog ? +CBZ.scene.fog.far.toFixed(1) : null;
  } else if (sub.id === "breach-air") {
    D.peace(); D.offshore(20, 14);
    const S = CBZ.sharkSim.shark, P = CBZ.player;
    D.headOut(1.0);
    /* THE RUN-UP IS DELIBERATELY UNARMED. The launch gate is sprint + rise at
       the top of the column, so holding all three through the climb fires the
       breach at some unrepeatable moment during it — and the capture then
       lands wherever the arc happened to be. Climb on RISE alone, then add
       sprint and step ONE TICK AT A TIME until the launch edge, so both sides
       are photographed the same number of milliseconds after the same input. */
    D.keys({ w: true, " ": true });
    D.sec(1.8);
    D.keys({ w: true, shift: true, " ": true });
    let launched = false;
    for (let i = 0; i < 150 && !launched; i++) { D.step(1); launched = !!D.depths().airborne; }
    D.sec(0.30);                                  // toward the top of the arc
    const h = S.heading || 0;
    // A PROFILE TRIPOD, ABEAM AND AT THE WATERLINE, that re-aims every strip
    // step: an arc photographed from behind is a dot.
    D.track = function () {
      const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z) : -0.8;
      const side = h + Math.PI / 2;
      D.tripod(P.pos.x + Math.cos(side) * 17 - Math.cos(h) * 3, sy + 2.4, P.pos.z + Math.sin(side) * 17 - Math.sin(h) * 3,
        P.pos.x, sy + 1.6, P.pos.z);
    };
    D.track();
    const d = D.depths();
    out.airborne = d.airborne ? 1 : 0;
    out.aboveSurfaceM = +Math.max(0, -d.bodyDepth).toFixed(2);
    const A = CBZ.aquaticMountAudit ? CBZ.aquaticMountAudit() : {};
    out.breaches = A.breaches || 0;
    out.launchSpeedMS = A.breachVel || 0;
  } else if (sub.id === "orca-blow") {
    D.peace(); D.offshore(60, 16);
    const P = CBZ.player;
    const o = D.wildOrSpawn("orca", 26, 8);
    if (!o) return { ok: false, error: "no orca" };
    o.pos.y = (CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(o.pos.x, o.pos.z) : -0.8) - (o.swimDepth || 2.6) * 1.4;
    if (o.group) o.group.position.y = o.pos.y;
    D.sec(1.2);
    if (!CBZ.orcaStage || !CBZ.orcaSurfaceRead) return { ok: false, error: "no orca staging seam" };
    CBZ.orcaStage(o, "blow", 4.2);
    /* CAPTURE THE TOP OF THE BREATH, NOT A CLOCK READING. A fixed 2.05 s only
       lands on the peak when the animal starts from the depth it started from
       last time; run the beats in a different order and the same clock
       photographs a different part of the curve on each side. Step until the
       body stops rising and stop THERE — the same event, both sides. */
    let prev = 1e9, R = null, rose = 0, flat = 0;
    for (let i = 0; i < 90; i++) {
      D.step(2);
      R = CBZ.orcaSurfaceRead(o);
      if (!R) break;
      if (R.depthM < prev - 0.005) { prev = R.depthM; rose++; flat = 0; }
      else if (rose > 2 && (++flat > 5 || R.depthM > prev + 0.02)) break;
      // A rise that ends AT a clamp plateaus instead of turning over, so a
      // pure "it started sinking again" test would run past the act itself.
      if (rose > 2 && R.act !== "blow") break;
    }
    out.orcaActAtPeak = R ? (R.act || "") : null;
    // THE ORCA'S OWN TRANSFORM, not its last-known actor position: everything
    // in this file moves a marine body through group.position, and a tripod
    // aimed at the stale `pos` photographs the water it used to be in.
    const gp = o.group.position;
    const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(gp.x, gp.z) : -0.8;
    const toO = Math.atan2(gp.z - P.pos.z, gp.x - P.pos.x);
    const side = toO + 0.9;
    D.tripod(gp.x - Math.cos(side) * 26, sy + 2.6, gp.z - Math.sin(side) * 26,
      gp.x, sy + 0.2, gp.z);
    out.orcaBodyDepthM = R ? +R.depthM.toFixed(2) : null;
    out.orcaDorsalOutM = R ? +R.authoredM.toFixed(2) : null;
    out.orcaOriginAboveSeaM = R ? +Math.max(0, -R.depthM).toFixed(2) : null;
  } else if (sub.id === "wild-cruise") {
    /* GO TO THE ANIMALS; DO NOT MOVE THE ANIMALS. A body teleported next to the
       camera loses the state that decides its depth — a spawned-in orca has no
       pod and no lead to keep station on, a spawned-in shark has no hunt, and
       BOTH then fall through to wildlife.js's generic wander, which parks them
       at exactly `surface − swimDepth` and never consults the cruise numbers
       this subject exists to photograph. (Measured: staging that way produced
       1.94 m on both sides — the submersion clamp, identical, telling us
       nothing.) So the ridden body swims to THEM, LOD wakes them where they
       live, and the tripod goes to the pod. */
    const P = CBZ.player;
    const pick = (test) => {
      const hits = [];
      for (const a of CBZ.cityWildlife || []) {
        if (!a || a.dead || a.ridden || a.external || !a.species || !a.group) continue;
        if ((CBZ.survFloodDepthMeanAt ? CBZ.survFloodDepthMeanAt(a.group.position.x, a.group.position.z) : 0) < 12) continue;
        if (test(a)) hits.push(a);
      }
      return hits;
    };
    const orcas = pick((a) => a.species.id === "orca");
    const gw = pick((a) => /shark|megalodon/.test(a.species.id))[0] || null;
    if (!orcas.length) return { ok: false, error: "no wild orca in deep water" };
    /* AND IT HAS TO BE A BRAIN-OWNED BODY. An orca outside wildlife_orca.js's
       own SIM_R falls through to wildlife.js's generic wander, which parks it
       at exactly `surface − swimDepth` and never reads a cruise number at all —
       so photographing the first orca in the list can silently photograph the
       one animal in the sea this change cannot touch. Swim to each candidate
       in turn and keep the first one whose own brain actually claims it. */
    /* THE SHARK IS THE SUBJECT AND THE ORCA IS THE SECOND OPINION, for a
       reason worth writing down: city/wildlife_shark.js's brain runs IN FRONT
       of wildlife.js's LOD gate (a stalking shark hunts from beyond the visible
       radius), so a shark in deep water is reliably brain-owned and its cruise
       and disengage depths are genuinely the numbers this change edits. An
       orca's brain has an ordinary SIM_R gate and only claims the transform
       while a pod lead or an act owns it — a lone one falls through to
       wildlife.js's generic wander, which parks it at exactly
       `surface − swimDepth` and reads no cruise number at all. So the orca's
       depth is reported WITH whether its own brain was driving, rather than
       quietly averaged in as if it were the same measurement. */
    if (!gw) return { ok: false, error: "no wild shark in deep water" };
    gw.hunger = 0.1;
    for (const c of orcas) c.hunger = 0.1;
    if (CBZ.sharkSim) CBZ.sharkSim.podT = 120;
    P.pos.x = gw.group.position.x - 44; P.pos.z = gw.group.position.z + 10;
    D.sec(10);                                     // LOD wakes it; depth settles
    let o = null, od = 1e9;
    for (const c of orcas) {
      const d = Math.hypot(c.group.position.x - P.pos.x, c.group.position.z - P.pos.z);
      if (d < od) { od = d; o = c; }
    }
    out.orcaBrainOwned = !!(o && o._orca && o._orca.owned) ? 1 : 0;
    const gp = gw.group.position;
    const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(gp.x, gp.z) : -0.8;
    const toG = Math.atan2(gp.z - P.pos.z, gp.x - P.pos.x);
    D.tripod(gp.x - Math.cos(toG + 0.6) * 26, sy + 2.6, gp.z - Math.sin(toG + 0.6) * 26,
      gp.x, sy - 1.0, gp.z);
    const R = o && CBZ.orcaSurfaceRead ? CBZ.orcaSurfaceRead(o) : null;
    out.orcaCruiseDepthM = R ? +R.depthM.toFixed(2) : null;
    out.orcaDorsalOutM = R ? +R.authoredM.toFixed(2) : null;
    out.orcaAct = R ? (R.act || "cruise") : null;
    out.sharkSpecies = gw.species.id;
    out.sharkCruiseDepthM = +(sy - gp.y).toFixed(2);
    out.sharkState = gw._shark ? (gw._shark.state || "?") : null;
  } else {
    return { ok: false, error: "unknown subject " + sub.id };
  }

  await window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, subject: sub.id,
    debug: {
      mode: CBZ.game.mode, state: CBZ.game.state,
      species: CBZ.sharkSim && CBZ.sharkSim.shark ? CBZ.sharkSim.shark.species.id : null,
      flags: {
        SHARK_RIDE_DIVE: CBZ.CONFIG.SHARK_RIDE_DIVE !== false,
        SHARK_BREACH: CBZ.CONFIG.SHARK_BREACH !== false,
        TOUCH_MOUNT_DIVE: CBZ.CONFIG.TOUCH_MOUNT_DIVE !== false,
        MARINE_SIT_DEEPER: CBZ.CONFIG.MARINE_SIT_DEEPER !== false,
      },
    },
    metrics: out,
  };
}

export default {
  id: "shark-dive",
  title: "Shark Sim — The Water Column",
  description: "One checkout, one island, one seed; the BEFORE column flips this wave's five flags off in the query string and runs the pre-wave code path. Five beats: the touch layer's missing vertical axis, four seconds of holding DIVE, the fake jump becoming a ballistic breach, an orca taking a breath two metres above the sea, and the idle resting depth of a wild shark and orca.",
  beforeLabel: "BEFORE · cfg_SHARK_RIDE_DIVE=0 &c (same build)",
  afterLabel: "AFTER · flags default-ON",
  pairNote: "Same checkout · same island · same seed · same inputs for the same simulated seconds",
  method: "Both sides boot index.html?mode=sharksim from THIS checkout and click the tile + PLAY exactly like a player, differing only by the cfg_* flags in the query string. A per-page driver freezes the frame loop after boot and advances the real match with CBZ.stepSim, so a beat is a number of GAME seconds rather than a number of rasterised frames; every capture is the live screen, HUD included. Depth numbers come from the engine's own seams (CBZ.cityAquaticRideDepths, CBZ.orcaSurfaceRead) rather than from the pixels.",
  defaultBefore: "local",
  urlParams: { mode: "sharksim", seed: "90210", bots: "30", cfg_BOOT_METER: "0" },
  beforeParams: {
    cfg_SHARK_RIDE_DIVE: "0",
    cfg_SHARK_BREACH: "0",
    cfg_SHARK_RIDE_TOUCH_VERT: "0",
    cfg_TOUCH_MOUNT_DIVE: "0",
    cfg_MARINE_SIT_DEEPER: "0",
  },
  afterParams: {},
  stageTimeoutMs: 300000,
  metrics: {
    verticalPills: { label: "DIVE/RISE pills on the saddle's touch rail", better: "higher" },
    auxPills: { label: "What the aux rail actually offers" },
    columnDepthM: { label: "Water column staged in", unit: "m" },
    camDepthM: { label: "Camera below the surface after 4 s of DIVE", unit: "m", better: "higher" },
    bodyDepthM: { label: "Body below the surface after 4 s of DIVE", unit: "m", better: "higher" },
    cameraSubmerged: { label: "cityCameraSubmerged() at that moment", better: "higher" },
    fogFarM: { label: "Underwater fog far plane (the visible water column)", unit: "m" },
    airborne: { label: "Body genuinely out of the water", better: "higher" },
    aboveSurfaceM: { label: "Height of the body over the sea at capture", unit: "m", better: "higher" },
    launchSpeedMS: { label: "Solved launch speed for this species", unit: "m/s", better: "higher" },
    orcaOriginAboveSeaM: { label: "Orca body ABOVE the waterline while breathing", unit: "m", better: "lower" },
    orcaDorsalOutM: { label: "Orca dorsal tip above the water", unit: "m", better: "lower" },
    orcaBodyDepthM: { label: "Orca body below the surface while breathing", unit: "m", better: "higher" },
    orcaCruiseDepthM: { label: "Wild orca resting depth", unit: "m", better: "higher" },
    sharkCruiseDepthM: { label: "Wild shark resting depth", unit: "m", better: "higher" },
    orcaAct: { label: "What the orca was doing at capture" },
    orcaActAtPeak: { label: "The act still running at the top of the rise" },
    orcaBrainOwned: { label: "The photographed orca is brain-owned (not the generic wander)" },
    sharkState: { label: "The shark's hunt state at capture" },
    sharkSpecies: { label: "Which shark was photographed" },
  },
  metricsNote: "Every number is read off the engine's own measurement seams at the instant of the capture, on both sides, with identical staging and identical inputs.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkDive,
};
