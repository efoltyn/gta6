/* Shark Sim — BOATS ON THE WATER, before/after (tools/visual-compare preset).

   OWNER: "this goes into the shark sim game and how boats can be eaten by big
   enough sharks, and how boats can be tipped by sharks etc."

   Before this wave the shark sim had NO BOATS AT ALL. It builds nothing
   physical — it borrows survival's island — and every boat in this game is a
   cityCars record built by city/vehicles.js, which is city-only. So the BEFORE
   column here is not a worse boat: it is the same camera over the same water
   with nothing on it, and it says so.

   The AFTER column is world/sea_craft.js: real registered hulls (the same
   water_hulls.js rows the player can buy), crewed with the island's own
   survivor bots, driven by the game's ONE autopilot (CBZ.marineAutopilot,
   city/piracy.js), seated on the live swell by CBZ.waterRideAt and sunk by
   CBZ.waterFloat. Every beat below is staged by CALLING THE PRODUCTION SEAM
   the two shark drivers call — CBZ.sharkRamHull, CBZ.seaCraft.hurt,
   CBZ.seaCraft.engulf — never by posing a mesh. The numbers in the table come
   from CBZ.seaCraft.audit(), i.e. the file measuring itself.

   Both sides boot ?mode=sharksim at seed 90210. --before is the pre-wave
   checkout served on its own port. */

const subjects = [
  {
    id: "fleet-from-beach", ch: 0,
    label: "The Fleet — What The Sea Looks Like From The Sand",
    focus: "From the beach, looking out. AFTER: two sea kayaks and a PWC in the swimming band, two skiffs at anchor with fishermen aboard, a centre console under way, a sloop and a cruiser further out. BEFORE: the same water, empty — this mode has never had a boat on it.",
  },
  {
    id: "bull-tips-kayak", ch: 1, strip: { frames: 3, stepSec: 0.45 },
    label: "A Bull Shark Cannot Bite A Kayak. It Can Put It Over.",
    focus: "The first verb this game has that is not 'bite the thing in front of you'. A 2.4 m bull shark's jaws do not span a kayak, but 0.37 kN·m of heeling moment against a kayak's 0.03 of righting moment is not close — she goes over and the paddler is in the water.",
  },
  {
    id: "white-under-jetski", ch: 2,
    label: "From Below — The Great White Under The PWC",
    focus: "The same moment with `from: \"under\"`: the lever arm is longer and the hull is lifted as it is rolled. Nothing about this is a special case — it is one flag on the same heeling impulse.",
  },
  {
    id: "white-bites-skiff", ch: 3,
    label: "A Chunk Out Of The Hull",
    focus: "A great white's jaws span a skiff's beam, so this is a BITE: the piece comes off the hull's own mesh in the hull's own material (CBZ.cityShedSolid — all debris comes off something), the hole is left in the boat, the fishermen go over the side alive and bleeding, and the sea starts coming in.",
  },
  {
    id: "meg-eats-speedboat", ch: 4,
    label: "The Whole Boat Goes In The Mouth",
    focus: "18 m of megalodon against a 6.2 m speedboat: loa is under 0.62 of the animal's length, the gape spans the beam and the hull is under an eighth of its displacement, so the whole thing is engulfed — pulled to the tooth ring over half a second with everyone aboard, and billed as a meal on the same ladder a seal is.",
  },
  {
    id: "meg-rolls-cruiser", ch: 5,
    label: "Too Big To Eat, Not Too Big To Roll",
    focus: "A 14 m cruiser is past what a megalodon can swallow and (just) past what its jaws span — so it is neither eaten nor bitten. 962 kN·m of moment against 218 of righting rolls her past the angle of vanishing stability and the crew go in. Nobody wrote 'cruiser' anywhere.",
  },
  {
    id: "sunk-and-drifting", ch: 6,
    label: "Forty Seconds Later",
    focus: "The wreckage is not deleted. The holed skiff has been taking water since the bite and is going down by the stern on water_float's own flooding model; the turtled kayak is still floating inverted and drifting.",
  },
];

async function stageBoats(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__boatBA;
  if (!D) {
    D = window.__boatBA = {
      chapter: -1, waterline: 0, has: false, marks: {},
      step(n) { for (let i = 0; i < n; i++) CBZ.stepSim(1 / 30); },
      sec(s) { D.step(Math.max(1, Math.round(s * 30))); },

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
        D.has = !!CBZ.seaCraft;
        // let the fleet find its water and the crews take their seats
        if (D.has) D.sec(3);
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

      A() { return CBZ.surv.arena; },
      playerAngle() {
        const A = D.A(), P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      ringPoint(ang, r) {
        const A = D.A();
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
      },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.48; },
      /* THE STANDARD BOAT SHOT: low over the water, six to ten metres off,
         three-quarters on, so the hull, the sea line and whatever is under it
         are all in frame. */
      boatShot(x, z, ang, dist, up) {
        const sy = D.seaY(x, z);
        D.tripod(x + Math.cos(ang) * dist, sy + (up == null ? 2.6 : up), z + Math.sin(ang) * dist,
                 x, sy + 0.4, z);
      },
      /* BOTH BODIES IN ONE FRAME, side on. Aiming off a heading recorded when
         the beat was set up put the camera behind the action twice — by the
         capture the animal has turned and the boat has moved. This is solved
         from where the two of them actually ARE. */
      pairShot(a, rec, dist, up) {
        const dx = rec.pos.x - a.pos.x, dz = rec.pos.z - a.pos.z;
        const side = Math.atan2(dz, dx) + Math.PI / 2;
        const mx = (a.pos.x + rec.pos.x) / 2, mz = (a.pos.z + rec.pos.z) / 2;
        const sy = D.seaY(mx, mz);
        D.tripod(mx + Math.cos(side) * dist, sy + up, mz + Math.sin(side) * dist, mx, sy + 0.6, mz);
      },
      /* SURFACE IT FOR THE PORTRAIT. This sea reads opaque from any height —
         a body half a metre under photographs as empty water, which is the
         same trap tools/visual-presets/shark-sim.mjs documents — so a beat
         that happens at a megalodon's own swimming depth is lifted to just
         under the waterline, animal and hull together, with no sim step
         between the lift and the capture. */
      surface(a, rec) {
        /* AND MAKE SURE IT IS DRAWN. city/marine_predation.js hides a wild
           animal that is far from the PLAYER (show(a, pd2)) — which is right
           for the game and wrong for a tripod parked somewhere else: three
           runs photographed a rolled boat with the thing that rolled it
           culled out of frame. Visibility is a view decision, so the capture
           may own it; nothing else about the animal is touched. */
        if (a.group) a.group.visible = true;
        const sy = D.seaY(a.pos.x, a.pos.z);
        const want = sy - 1.2, dy = want - a.group.position.y;
        if (dy <= 0.2) return;
        a.pos.y += dy; a.group.position.y += dy;
        a.group.updateMatrixWorld(true);
        if (rec && rec.group) {
          rec.group.position.y += dy;
          rec._pullY = rec.group.position.y;
          rec.group.updateMatrixWorld(true);
        }
      },
      /* THE FLEET IS SPREAD ROUND THE WHOLE ISLAND, which is correct for the
         game and useless for one photograph: eight boats over 360 degrees put
         about one of them in a 55-degree frame. For the establishing shot the
         SAME boats are fanned across the camera's own bearing, each keeping
         its own radius — nothing is added, invented or resized. */
      fanFleet(ang0) {
        if (!CBZ.seaCraft) return 0;
        const A = D.A(), list = CBZ.seaCraft.list();
        const live = list.filter((c) => c && !c.dead);
        for (let i = 0; i < live.length; i++) {
          const c = live[i];
          const r = Math.hypot(c.pos.x - A.center.x, c.pos.z - A.center.z);
          const a = ang0 + ((i / Math.max(1, live.length - 1)) - 0.5) * 0.62;
          c.pos.x = A.center.x + Math.cos(a) * r;
          c.pos.z = A.center.z + Math.sin(a) * r;
          c.anchor.x = c.pos.x; c.anchor.z = c.pos.z;
          c.heading = a + Math.PI / 2 + (i % 2 ? 0.5 : -0.5);
          c.group.position.set(c.pos.x, c.group.position.y, c.pos.z);
        }
        return live.length;
      },
      /* THE BEFORE SIDE'S SHOT. No boats exist in that build, so every beat
         photographs the same thing: open water off this beach, looking OUT.
         Aimed away from the island deliberately — a shot of the coastline
         would be a picture of something else being absent. */
      emptyWater(k) {
        const ang = D.playerAngle() + (k - 3) * 0.12;
        const at = D.ringPoint(ang, D.waterline + 60 + k * 25);
        const from = D.ringPoint(ang, D.waterline + 30 + k * 25);
        D.tripod(from.x, D.seaY(from.x, from.z) + 3.2, from.z, at.x, D.seaY(at.x, at.z) + 0.6, at.z);
      },
      // a quiet sea: the pod and every rival shark parked far away, so a beat
      // about a boat is only about a boat
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.pos.x += 900; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        if (CBZ.sharkSim) CBZ.sharkSim.podT = 120;
      },
      // the live craft of a given key (or any craft) — nothing is invented
      craftOf(key) {
        if (!CBZ.seaCraft) return null;
        const list = CBZ.seaCraft.list();
        for (const c of list) if (!c.dead && !c._capsized && (!key || c.key === key)) return c;
        for (const c of list) if (!c.dead && (!key || c.key === key)) return c;
        return null;
      },
      /* A craft of this key IN FRONT OF THE PLAYER, whether or not the match
         happened to spawn one there: sea_craft's own spawn(), on measured
         water, is how one is made. */
      craftNear(key, dist, crew, opts) {
        if (!CBZ.seaCraft) return null;
        const P = CBZ.player;
        const ang = D.playerAngle();
        for (let k = 0; k < 14; k++) {
          const a = ang + (k - 7) * 0.14;
          const r = Math.hypot(P.pos.x - D.A().center.x, P.pos.z - D.A().center.z) + dist + k * 2;
          const p = D.ringPoint(a, r);
          const dep = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(p.x, p.z) : 3;
          if (!(dep > 2.5)) continue;
          const rec = CBZ.seaCraft.spawn(key, p.x, p.z, a + Math.PI / 2,
            Object.assign({ crew: crew == null ? 1 : crew }, opts || {}));
          if (rec) return rec;
        }
        return null;
      },
      /* A REAL SHARK OF A GIVEN SPECIES, placed on a hull's beam. The wild
         bestiary body, not a prop: this is the same actor marine_predation
         drives, and every rule below is asked of IT. */
      sharkAt(id, x, z, off) {
        /* SPAWNED HERE, not teleported from wherever the island happened to
           put one. A body the engine built far away has already been culled
           out of the scene graph by the wildlife LOD, and moving it back does
           not put it in the frame — two runs photographed a boat being eaten
           by nothing. */
        let a = CBZ.cityWildlifeSpawnAt ? CBZ.cityWildlifeSpawnAt(id, x + (off ? off.x : 0), z + (off ? off.z : 0)) : null;
        if (!a) {
          for (const w of CBZ.cityWildlife || []) {
            if (w && !w.dead && !w.external && !w.ridden && !w.tamed && w.species && w.species.id === id) { a = w; break; }
          }
        }
        if (!a) return null;
        a.pos.x = x + (off ? off.x : 0);
        a.pos.z = z + (off ? off.z : 0);
        a.pos.y = D.seaY(a.pos.x, a.pos.z) - (off && off.y != null ? off.y : (a.swimDepth || 1.2) * 0.5);
        a.heading = Math.atan2(z - a.pos.z, x - a.pos.x);
        a.faceH = a.heading;
        a.hunger = 1;
        if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; a._waterMove.heading = a.heading; }
        if (a.group) a.group.position.set(a.pos.x, a.pos.y, a.pos.z);
        return a;
      },
    };
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

  const CH = [
    // 0 — the fleet, from the sand
    async function fleet() {
      if (!await D.boot()) throw new Error("shark sim never armed");
      D.peace();
      D.sec(2);
      const ang = D.playerAngle();
      if (D.has) { D.fanFleet(ang); D.sec(1.2); }            // the same hulls, in one frame
      const from = D.ringPoint(ang, D.waterline - 14);       // standing on the beach
      const at = D.ringPoint(ang, D.waterline + 150);        // looking out to sea
      if (CBZ.camera && CBZ.camera.fov !== 55) { CBZ.camera.fov = 55; CBZ.camera.updateProjectionMatrix(); }
      D.tripod(from.x, D.seaY(from.x, from.z) + 6.5, from.z, at.x, D.seaY(at.x, at.z) + 1.0, at.z);
    },
    // 1 — a bull shark puts a kayak over
    async function bullKayak() {
      D.peace();
      if (!D.has) { D.emptyWater(1); return; }
      const k = D.craftNear("kayak", 26, 1) || D.craftOf("kayak");
      if (!k) throw new Error("no kayak");
      D.marks.kayak = k;
      const a = D.sharkAt("bull_shark", k.pos.x, k.pos.z, { x: -5, z: 0, y: 0.9 });
      if (!a) throw new Error("no bull shark");
      D.sec(0.3);
      // THE PRODUCTION SEAM, not a pose: this is the exact call the mounted
      // shark's `ram` branch and marine_predation's tip both make.
      CBZ.sharkRamHull(a, k, { from: "ram", x: a.pos.x, z: a.pos.z, speed: 8 });
      // THE ROLL IS INTEGRATED, not snapped: water_stability.js takes her past
      // the angle of vanishing stability over the next half second, so the
      // strip starts here and watches her go rather than photographing a pose.
      D.sec(0.5);
      D.boatShot(k.pos.x, k.pos.z, k.heading + 1.9, 8.5, 2.8);
    },
    // 2 — from below, under the PWC
    async function whiteJetski() {
      D.peace();
      if (!D.has) { D.emptyWater(2); return; }
      const j = D.craftNear("jetski", 34, 1) || D.craftOf("jetski");
      if (!j) throw new Error("no jetski");
      const a = D.sharkAt("great_white_shark", j.pos.x, j.pos.z, { x: 0, z: 0, y: 3.2 });
      if (!a) throw new Error("no great white");
      D.sec(0.2);
      CBZ.sharkRamHull(a, j, { from: "under", x: j.pos.x, z: j.pos.z, speed: 9 });
      D.sec(1.1);                      // the spray clears; the hull is over
      D.surface(a, null);
      D.boatShot(j.pos.x, j.pos.z, j.heading + 2.2, 10, 3.4);
    },
    // 3 — a chunk out of a skiff
    async function whiteSkiff() {
      D.peace();
      if (!D.has) { D.emptyWater(3); return; }
      const s = D.craftNear("skiff", 44, 2, { anchored: true }) || D.craftOf("skiff");
      if (!s) throw new Error("no skiff");
      D.marks.skiff = s;
      const a = D.sharkAt("great_white_shark", s.pos.x, s.pos.z, { x: 0, z: -4.0, y: 0.8 });
      if (!a) throw new Error("no great white");
      const c = Math.cos(s.heading), sn = Math.sin(s.heading);
      const pt = { x: s.pos.x - c * 1.2, y: D.seaY(s.pos.x, s.pos.z) + 0.2, z: s.pos.z + sn * 1.2 };
      CBZ.seaCraft.hurt(s, 320, { bite: true, point: pt, normal: { x: -c, y: 0, z: sn }, by: a });
      D.sec(0.9);
      D.surface(a, null);                // the animal that did it, in frame
      D.boatShot(s.pos.x, s.pos.z, s.heading + 2.0, 10, 3.4);
    },
    // 4 — the whole boat in the mouth
    async function megBoat() {
      D.peace();
      if (!D.has) { D.emptyWater(4); return; }
      const b = D.craftNear("boat", 45, 2) || D.craftNear("dinghy", 45, 2);
      if (!b) throw new Error("no speedboat");
      /* THE MOUTH HAS TO BREAK THE SURFACE. A megalodon at its own swimming
         depth takes the boat down eight metres and the whole event happens
         under an opaque sea — two runs of empty water proved it. Staged at the
         surface, which is also where a real one takes a boat. */
      const a = D.sharkAt("megalodon", b.pos.x, b.pos.z, { x: -14, z: 0, y: 1.4 });
      if (!a) throw new Error("no megalodon");
      if (!CBZ.sharkCanEngulfHull(a, b)) throw new Error("the megalodon cannot engulf this hull — rules changed");
      CBZ.seaCraft.engulf(b, a);
      D.sec(0.34);                       // mid-pull: the boat on its way in
      D.surface(a, b);
      D.pairShot(a, b, 24, 7.0);
    },
    // 5 — the cruiser rolled
    async function megCruiser() {
      D.peace();
      if (!D.has) { D.emptyWater(5); return; }
      const c = D.craftNear("cruiser", 120, 6) || D.craftOf("cruiser");
      if (!c) throw new Error("no cruiser");
      const a = D.sharkAt("megalodon", c.pos.x, c.pos.z, { x: 0, z: -10, y: 2.2 });
      if (!a) throw new Error("no megalodon");
      D.sec(0.2);
      CBZ.sharkRamHull(a, c, { from: "under", x: c.pos.x, z: c.pos.z, speed: 10 });
      D.sec(1.3);
      D.surface(a, null);
      D.pairShot(a, c, 30, 9.0);
    },
    // 6 — forty seconds later
    async function after() {
      if (!D.has) { D.emptyWater(6); return; }
      D.peace();
      D.sec(40);
      /* WHAT IS LEFT. The holed skiff has been taking water since the bite and
         is on the bottom by now; the turtled kayak is still out here floating
         upside down, because a capsized hull with air under it does not sink —
         it becomes wreckage. Prefer whichever of the two survived. */
      const k = D.marks.kayak, sk = D.marks.skiff;
      let t = null;
      for (const c of [k, sk]) if (c && c.group && c.group.parent && !c._sinking) { t = c; break; }
      if (!t) for (const c of CBZ.seaCraft.list()) if (c._capsized || c._holed) { t = c; break; }
      if (!t) t = D.craftOf(null);
      if (!t) throw new Error("nothing left afloat to photograph");
      D.boatShot(t.pos.x, t.pos.z, t.heading + 2.0, 12, 3.4);
    },
  ];

  const want = sub.ch | 0;
  while (D.chapter < want) {
    D.chapter++;
    await CH[D.chapter]();
  }

  const A = CBZ.seaCraft ? CBZ.seaCraft.audit() : null;
  return {
    ok: true,
    state: A ? (A.craft + " afloat") : "NO BOATS IN THIS MODE",
    note: A ? null : "This build has no world/sea_craft.js: the shark sim borrows survival's island and every boat in the game is a city/vehicles.js record, so there is nothing on this water to photograph.",
    metrics: A ? {
      craft: A.craft,
      aboard: A.aboard,
      tipped: A.tipped,
      eaten: A.eaten,
      holed: A.holed,
      sunk: A.sunk,
      overboard: A.overboard,
      biggestEatenM: A.biggestEatenM,
    } : { craft: 0, aboard: 0, tipped: 0, eaten: 0, holed: 0, sunk: 0, overboard: 0, biggestEatenM: 0 },
  };
}

export default {
  id: "shark-boats",
  title: "Shark Sim — Boats On The Water, And What A Shark Does To One",
  description: "Seven beats of the shark sim's own sea. BEFORE: this mode has never had a single boat on it — it borrows survival's island and every boat in the game is a city/vehicles.js record, which is city-only, so the same camera over the same water photographs nothing. AFTER: world/sea_craft.js puts real registered hulls out there with real crews — kayaks and a PWC in the swimming band, skiffs at anchor with fishermen, a centre console under way, a sloop, a cruiser — and the shark-vs-boat rules decide what happens to each one. A bull shark cannot bite a kayak but puts it over; a great white takes a chunk out of a skiff and the fishermen go in the water; a megalodon swallows a speedboat whole and rolls a cruiser it cannot swallow. Nothing is a special case: the moment is the shark's tonnage times its closing speed times half the beam, against the hull's own righting moment.",
  beforeLabel: "BEFORE · no boats in this mode",
  afterLabel: "AFTER · CBZ.seaCraft",
  pairNote: "Same island · same seed · same camera · the game's own HUD",
  method: "Both sides boot index.html into ?mode=sharksim at seed 90210 exactly like a player (tile + PLAY), freeze the page's frame loop, and advance the real match with CBZ.stepSim. Every beat is staged by calling the PRODUCTION seam the two shark drivers call — CBZ.sharkRamHull, CBZ.seaCraft.hurt, CBZ.seaCraft.engulf — on real bestiary sharks and real water_hulls.js hulls; nothing is posed. The table is read back from CBZ.seaCraft.audit(), the file measuring itself. The before side feature-detects CBZ.seaCraft and, finding none, photographs the same water and reports zeroes.",
  defaultBefore: "local",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 420000,
  metrics: {
    craft: { label: "Boats afloat in the mode", better: "higher" },
    aboard: { label: "People sitting in them", better: "higher" },
    tipped: { label: "Hulls put over by a shark", better: "higher" },
    eaten: { label: "Boats eaten whole", better: "higher" },
    holed: { label: "Hulls with a bite out of them", better: "higher" },
    sunk: { label: "Hulls that foundered and went down", better: "higher" },
    overboard: { label: "People put in the water off a boat", better: "higher" },
    biggestEatenM: { label: "Longest hull swallowed", unit: "m", better: "higher" },
  },
  metricsNote: "The before column is 0 across the board and that is the finding, not a regression: there were no boats in this mode at all.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.cityWildlifeSpawnAt && CBZ.cityMountAnimal && document.getElementById('playBtn')",
  subjects,
  stage: stageBoats,
};
