/* THE SHORE LAW — how close a ridden shark may get to the people in the water.

   OWNER, 2026-08-25: "all the humans are close to shore and sharks get blocked
   like 5 feet from shore when really they should be blocked like a couple feet
   IN the shore; beaching is possible, orcas do it really well."

   BOTH COLUMNS ARE THE SAME GAME, the same mode, the same seed and the same
   driver. The only difference is the BUILD: BEFORE is the pristine checkout,
   AFTER is the working tree. Every beat gives the two builds the IDENTICAL
   input — hold W at the beach, hold shift+W at the beach, hold W back out —
   and photographs where each one ends up. Nothing is teleported into position
   for a beat that is about whether you can GET there.

   WHAT THE OLD BUILD ACTUALLY DID, and why one number could never have fixed
   it. Four mechanisms stacked:
     1. the mount handed its whole heading to the shore-following navigator
        (`ride.head = nav.heading`), so steering at the beach was steering
        against something stronger than the player;
     2. the navigator's forward feeler tripped at ~0.8 m of water for a bull
        shark and ~2.3 m for a megalodon, thirty-odd metres out;
     3. the body was blocked outright at 0.46 m (bull) to 1.25 m (megalodon);
     4. the ride's own depth oracle CLAMPED the water column to 1.2 m, so even
        parked in the swash the solver sank the animal into imaginary sea.
   The crowd, meanwhile, wandered a band whose deepest point was 0.43 m — so
   even a shark that had beaten all four would have found ankles.

   The AFTER column gives the wheel back to the player, blocks on real DEPTH
   (a hand's depth for a bull, a foot for a megalodon), solves the posture off
   the real seabed, lets a committed sprint carry the body onto the swash, and
   widens the wade band to thigh-deep. */

const subjects = [
  {
    id: "hold-the-shallows", ch: 0,
    label: "Holding Station In Knee-Deep Water",
    focus: "Same input on both builds: swim at the beach and hold. BEFORE the navigator peels the shark off and parks it in open water, a whole surf zone away from anybody. AFTER the body sits in a couple of feet of swash with the dorsal and the tail out of the water, among the waders, exactly where the owner says a shark should be blocked.",
  },
  {
    id: "bite-in-the-shallows", ch: 1, strip: { frames: 5, stepSec: 0.45 },
    label: "The Charge — Five Frames Into A Wader",
    focus: "A film strip of the same two seconds, driven by the same held key. BEFORE the shark runs out of legal water before it runs out of distance and the wader is never reached. AFTER it closes into the shallows and the automatic bite lands on somebody standing in it.",
  },
  {
    id: "beach-the-body", ch: 2, strip: { frames: 5, stepSec: 0.5 },
    label: "Beaching, On Purpose",
    focus: "Shift held: a committed sprint, not a cruise. BEFORE the block line is a wall — the body stops in the water and slides along it. AFTER the lunge carries the shark up onto wet sand, belly down, jaws still working. No damage: an orca does this deliberately.",
  },
  {
    id: "thrash-back", ch: 3, strip: { frames: 5, stepSec: 0.6 },
    label: "Thrashing Back To Sea",
    focus: "From aground, hold the stick seaward. AFTER the body works itself over the sand in shoves — rolling side to side, throwing spray — and swims the moment there is water under it again. The rescue slide is a safety net that only fires after seconds of getting nowhere, not a conveyor that yanks you off the beach.",
  },
  {
    id: "megalodon-in-the-surf", ch: 4,
    label: "Megalodon On The Surf Line",
    focus: "The apex form given the same shoreward hold. BEFORE the biggest body has the biggest exclusion zone — it is walled out in 1.25 m of water, which is the one promise the mode's own storyboard makes and could not keep. AFTER a sixteen-metre animal rides the surf line with its back out of the water.",
  },
];

async function stageShoreLaw(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NEED = [0, 14, 34, 75];

  let D = window.__shoreLaw;
  if (!D) {
    D = window.__shoreLaw = {
      chapter: -1, waterline: 0, follow: null,
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },
      depth(x, z) { return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0; },
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
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        return true;
      },
      // Freeze the page's own frame loop AND drain the straggler callback, so a
      // staged camera survives to the capture instead of being re-stamped by a
      // loop tick at some later compositor beat.
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },

      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      playerRadius() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.hypot(P.pos.x - A.center.x, P.pos.z - A.center.z);
      },
      inwardHeading() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(A.center.z - P.pos.z, A.center.x - P.pos.x);
      },
      // keys.w moves (-sin, -cos)·yaw, so this is the yaw that walks a heading
      camYawAlong(h) { return Math.atan2(-Math.cos(h), -Math.sin(h)); },

      // Park the body offshore, facing the beach, with the same run-up on both
      // builds. This is a SETUP position, never a result: every beat then
      // drives from here with held keys and the build decides where it ends.
      lineUp(offshore) {
        const P = CBZ.player, ang = D.playerAngle();
        const p = D.ringPoint(ang, D.waterline + (offshore == null ? 26 : offshore));
        P.pos.x = p.x; P.pos.z = p.z;
        const S = CBZ.sharkSim.shark;
        if (S) { S.pos.x = p.x; S.pos.z = p.z; }
        D.aim(D.inwardHeading());
        D.step(4);
      },
      aim(h) {
        if (CBZ.cam) { CBZ.cam.yaw = D.camYawAlong(h); CBZ.cam.pitch = 0.26; }
      },
      keys(w, shift) {
        CBZ.keys.w = !!w; CBZ.keys.s = false; CBZ.keys.a = false; CBZ.keys.d = false;
        CBZ.keys.shift = !!shift;
      },
      /* THE ONE MEASUREMENT THIS REPORT IS ABOUT: hold a direction and record
         the shallowest water the body ever reached. The heading is re-aimed
         every tick at the island's centre (or away from it), which is what a
         player holding the stick at the beach is doing. */
      hold(seconds, seaward, sprint) {
        const P = CBZ.player;
        const n = Math.max(1, Math.round(seconds * 30));
        let minD = 1e9, minR = 1e9, ag = 0;
        for (let i = 0; i < n; i++) {
          const h = D.inwardHeading() + (seaward ? Math.PI : 0);
          D.aim(h);
          D.keys(true, sprint);
          CBZ.stepSim(1 / 30);
          const d = D.depth(P.pos.x, P.pos.z);
          if (d < minD) minD = d;
          const r = D.playerRadius();
          if (r < minR) minR = r;
          if (d < 0.22) ag++;
        }
        D.keys(false, false);
        return { minD: minD, minR: minR, agroundSec: +(ag / 30).toFixed(2) };
      },

      // Wildlife that would rather eat you than pose, moved out of the frame.
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.pos.x += 500; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 60;
        }
      },
      /* Stand a handful of the island's own crowd in the water along the line
         the shark is charging. They are real bots on the real bus — this only
         picks WHICH of them are standing here, the same way the mode's own
         relocateBots does, so the beat is not a lottery on where the crowd
         happened to wander. Depths are quoted from the live oracle. */
      waders(n, ang, from, to) {
        let placed = 0; const depths = [];
        for (const b of CBZ.bots || []) {
          if (!b || b.dead || placed >= n) continue;
          const r = from + (placed / Math.max(1, n - 1)) * (to - from);
          const p = D.ringPoint(ang + (placed - (n - 1) / 2) * 0.016, r);
          b.pos.x = p.x; b.pos.z = p.z;
          b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
          b.target.set(b.pos.x, 0, b.pos.z); b.pause = 60;
          depths.push(+D.depth(b.pos.x, b.pos.z).toFixed(2));
          placed++;
        }
        return depths;
      },
      // How much of the LIVE crowd is standing in water a ridden shark can now
      // reach — the whole point of widening the wade band.
      reachableWaders() {
        let n = 0;
        for (const b of CBZ.bots || []) {
          if (!b || b.dead) continue;
          const d = D.depth(b.pos.x, b.pos.z);
          if (d >= 0.35 && d <= 1.0) n++;
        }
        return n;
      },
      deepestWader() {
        let m = 0;
        for (const b of CBZ.bots || []) {
          if (!b || b.dead) continue;
          const d = D.depth(b.pos.x, b.pos.z);
          if (d > m) m = d;
        }
        return +m.toFixed(2);
      },
      // How far the body's back stands out of the sea: the thing you can SEE.
      dorsalOut() {
        const S = CBZ.sharkSim.shark; if (!S) return null;
        const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
        return +(S.pos.y - sy).toFixed(2);
      },
      // Metres past the waterline, up the beach. Positive means ON THE SAND.
      beachedBy() { return +(D.waterline - D.playerRadius()).toFixed(2); },

      /* A TRACKING TRIPOD THAT SURVIVES A FILM STRIP. The comparator advances
         the match between strip frames and camera.js re-stamps the lens every
         tick, so a one-shot tripod is gone by frame two. This one is re-solved
         from the shark's LIVE position inside the render hook, which runs
         immediately before each capture — so a strip gets a real moving
         camera instead of five photographs of an empty sea. */
      setFollow(spec) { D.follow = spec; D.applyFollow(); },
      applyFollow() {
        const f = D.follow, cam = CBZ.camera, S = CBZ.sharkSim && CBZ.sharkSim.shark;
        if (!f || !cam || !S) return;
        const A = CBZ.surv.arena;
        const ang = Math.atan2(S.pos.z - A.center.z, S.pos.x - A.center.x);
        const side = ang + f.side;
        const sy = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(S.pos.x, S.pos.z) : -0.8;
        cam.position.set(
          S.pos.x + Math.cos(side) * f.dist,
          sy + f.height,
          S.pos.z + Math.sin(side) * f.dist);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(S.pos.x, sy + (f.aim == null ? 0.1 : f.aim), S.pos.z));
      },

      /* Climb the ladder for a beat that is about the APEX body, not about
         the climb. Mass is granted; the evolution itself still has to happen
         through the mode's own bite, so a meal is put where the jaw already
         is rather than left to a swim the BEFORE build might not survive. */
      feedToTier(tier) {
        const s = CBZ.sharkSim;
        for (let round = 0; round < 10 && s.tier < tier; round++) {
          D.peace(); D.lineUp(10);
          s.mass = Math.max(s.mass, NEED[tier] + 5);
          const S = s.shark, h = (S && S.heading) || 0;
          let placed = 0;
          for (const b of CBZ.bots || []) {
            if (!b || b.dead || placed >= 2 || !S) continue;
            b.pos.x = S.pos.x + Math.cos(h) * (4 + placed * 1.2);
            b.pos.z = S.pos.z + Math.sin(h) * (4 + placed * 1.2);
            b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
            b.target.set(b.pos.x, 0, b.pos.z); b.pause = 60; placed++;
          }
          for (let k = 0; k < 120 && s.tier < tier; k++) D.step(1);
        }
        return s.tier >= tier && D.armed();
      },
    };

    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        D.applyFollow();                     // re-solve the tripod on the live body
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 1200));
      },
      // Film strips step the real match with the keys the beat left held.
      advance(sec) { D.sec(sec); },
    };
  }

  const out = {};
  const CH = [
    async function holdShallows() {
      if (!await D.boot()) throw new Error("no match / sim never armed");
      D.peace();
      const ang = D.playerAngle();
      const wd = D.waders(6, ang, D.waterline + 1.5, D.waterline + 8.5);
      D.lineUp(26);
      const run = D.hold(6.5, false, false);       // hold W at the beach
      out.shallowestM = +run.minD.toFixed(2);
      out.standoffM = +(D.playerRadius() - D.waterline).toFixed(1);
      out.dorsalOutM = D.dorsalOut();
      out.reachableWaders = D.reachableWaders();
      out.deepestWaderM = D.deepestWader();
      out.waderDepths = wd.join("/");
      D.setFollow({ side: 1.35, dist: 12, height: 1.5, aim: 0.2 });
    },

    async function biteInShallows() {
      D.peace();
      const ang = D.playerAngle();
      D.waders(4, ang, D.waterline + 2.5, D.waterline + 7);
      D.lineUp(20);
      out.eatenBefore = CBZ.sharkSim.eaten;
      D.aim(D.inwardHeading());
      D.keys(true, false);                          // the strip holds the charge
      D.step(1);
      D.setFollow({ side: 1.15, dist: 13, height: 2.0, aim: 0.3 });
    },

    async function beachTheBody() {
      D.keys(false, false);
      D.peace();
      const ang = D.playerAngle();
      D.waders(3, ang, D.waterline + 1.0, D.waterline + 4.0);
      D.lineUp(30);
      // a committed sprint, held: this is the lunge, not a cruise
      D.aim(D.inwardHeading());
      D.keys(true, true);
      D.step(1);
      D.setFollow({ side: 1.5, dist: 11, height: 1.9, aim: 0.4 });
    },

    async function thrashBack() {
      // continue from wherever the lunge left the body, then reverse the stick
      const land = D.hold(2.0, false, true);
      out.beachedByM = D.beachedBy();
      out.landedDepthM = +land.minD.toFixed(2);
      out.agroundSec = land.agroundSec;
      D.aim(D.inwardHeading() + Math.PI);
      D.keys(true, false);                          // hold seaward: the thrash
      D.step(1);
      D.setFollow({ side: 1.5, dist: 10, height: 1.4, aim: 0.25 });
    },

    async function megalodonSurf() {
      D.keys(false, false);
      if (!D.feedToTier(3)) throw new Error("never evolved to megalodon");
      D.peace();
      const ang = D.playerAngle();
      D.waders(5, ang, D.waterline + 2, D.waterline + 9);
      D.lineUp(34);
      const run = D.hold(8.0, false, false);
      out.megShallowestM = +run.minD.toFixed(2);
      out.megStandoffM = +(D.playerRadius() - D.waterline).toFixed(1);
      out.megDorsalOutM = D.dorsalOut();
      D.keys(false, false);
      D.setFollow({ side: 1.25, dist: 34, height: 5.5, aim: 0.6 });
    },
  ];

  const want = sub.ch;
  while (D.chapter < want) {
    D.chapter++;
    await CH[D.chapter]();
  }

  window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: want,
    debug: {
      state: CBZ.game.state,
      tier: CBZ.sharkSim ? CBZ.sharkSim.tier : null,
      species: CBZ.sharkSim && CBZ.sharkSim.shark ? CBZ.sharkSim.shark.species.id : null,
      waterline: Number(D.waterline.toFixed(1)),
      shoreLaw: CBZ.cityAquaticShoreLaw ? CBZ.cityAquaticShoreLaw() : "absent (before build)",
    },
    metrics: out,
  };
}

export default {
  id: "shark-shore-law",
  title: "The Shore Law — How Close A Ridden Shark May Get",
  description: "Five beats of Shark Sim on the disaster island, given identical held-key input on two builds of the same checkout. BEFORE: the mount hands its heading to the shore-following navigator, blocks in 0.46-1.25 m of water depending on the body, and reads a water column clamped to a fake 1.2 m minimum — so it is walled off the surf and the crowd it is supposed to be eating stands in a band no deeper than 0.43 m. AFTER: the player owns the wheel, the body grounds on real depth at roughly a hand's depth, the posture is solved off the real seabed so the dorsal breaks the surface in the shallows, a committed sprint beaches the animal on the sand, thrashing works it back to sea, and the wade band reaches thigh-deep.",
  beforeLabel: "BEFORE · pristine checkout",
  afterLabel: "AFTER · working tree (shore law)",
  pairNote: "Same mode · same seed · same held keys · only the build differs",
  method: "Both sides boot index.html into Shark Sim with a pinned seed, clicking the tile and PLAY like a player. A per-page driver freezes the frame loop and advances the real match with CBZ.stepSim. Every beat lines the body up OFFSHORE and then holds a key — W at the beach, shift+W at the beach, W back out to sea — so the build, not the stager, decides where the shark ends up. Depths are read from the island's own bathymetry oracle (CBZ.survFloodDepthMeanAt) at the body's live position; the crowd is the mode's own bots, only positioned along the charge line so the beat is not a lottery. A tracking tripod is re-solved from the shark inside the capture hook so film strips get a moving camera.",
  defaultBefore: "local",
  beforeParams: { mode: "sharksim", shark: "1", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", shark: "1", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 300000,
  metrics: {
    shallowestM: { label: "Shallowest water the bull shark reached", unit: "m", better: "lower" },
    standoffM: { label: "Where it came to rest, relative to the waterline", unit: "m", better: "lower" },
    dorsalOutM: { label: "Body origin above the sea surface", unit: "m", better: "higher" },
    reachableWaders: { label: "Live crowd standing in 0.35-1.0 m of water", better: "higher" },
    deepestWaderM: { label: "Deepest anybody in the crowd stands", unit: "m", better: "higher" },
    beachedByM: { label: "Metres up the beach past the waterline", unit: "m", better: "higher" },
    landedDepthM: { label: "Water depth under the body at the end of the lunge", unit: "m", better: "lower" },
    agroundSec: { label: "Seconds of the lunge spent genuinely aground", unit: "s", better: "higher" },
    megShallowestM: { label: "Shallowest water the megalodon reached", unit: "m", better: "lower" },
    megStandoffM: { label: "Megalodon resting position vs the waterline", unit: "m", better: "lower" },
    megDorsalOutM: { label: "Megalodon origin above the sea surface", unit: "m", better: "higher" },
  },
  metricsNote: "Negative standoff means INSIDE the waterline — on the wet sand. The waterline sits at radius ~131.8 and the measured foreshore runs 0.24 m of depth at WL+2, 0.45 m at WL+4, 0.83 m at WL+8 and 0.97 m at WL+10, so a metre of standoff is roughly a hand's depth of water.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeStock && CBZ.spawnSurvivorBotAt && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageShoreLaw,
};
