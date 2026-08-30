/* Shark Sim bites, before/after — A BITE LEAVES A CUT.

   Owner, 2026-08-29, watching a shark bite an orca in Shark Sim:

     "it leaves almost like a puckering lip on the shark or orca that's bit,
      and then that puckered lip fake hole disappears in a second, that's
      fucking dumb. A bite should leave a CUT or REMOVE a piece of the body,
      real physics, no fake shit — and then the piece, like the tail or fin
      etc, bit off should be in the mouth or fall into the water, all real
      physics. Not this fake protruding fake hole but a LINE, a cut, and the
      line lets blood out ... the cut should disappear much much longer after
      than how it does now, and instead of a big circle — that's not what a
      bite looks like, it's a cut or a missing thing ... right now it's this
      dumb basically like a red piece of playdough got stuck to them and falls
      off in 10 sec, that's the shark game currently."

   Three separate defects, all of them in systems/wounds.js, all visible here:

     1. THE SHAPE. The wound was three nested BOWLS OF REVOLUTION, and the
        file's own comment said what they were for: "a raised, everted, ragged
        lip of raw margin stepping down through two darker terraces". A disc
        0.9 m across standing 0.3 m proud of the skin is the playdough. It is
        now a RAKE OF CUTS — 2-3 tapered ragged slits laid along the line the
        attacker was actually travelling, whose lips stand about a ninth of
        their own width off the flank. Same relief budget, spent on a line
        instead of on a dome. The metric is puckerRatio: relief over length.

     2. THE DISAPPEARANCE, which was never a timer. There is no wound timer in
        that file and there never was. The wound record was keyed on the MESH,
        and an orca is ONE generated hull mesh — so a body had exactly one set
        of wound meshes, and the NEXT bite re-seated those same meshes at the
        new point. From the water that is a hole vanishing off the flank once
        a second, forever. Cuts now APPEND and are evicted only by a global
        budget. The metric is marksAfterFive: five bites, how much of it is
        still on the animal.

     3. THE PIECE THAT CAME OFF WENT NOWHERE. The severance branch shrank the
        fin and capped it, so the missing third of a fluke existed precisely
        nowhere — the fin read as retracting. The lobe is now a real object
        with the part's own geometry and material, carried in the attacker's
        jaw for a beat and then thrown, sinking and settling on the sea floor.

   And a fourth, found on the way: marine_predation.js refused a same-species
   bite ("a pod squabble is not a meal"), which deleted exactly the case the
   owner names first — a shark biting ANOTHER SHARK left no mark at all.

   BOTH COLUMNS RUN THIS SAME DRIVER. The BEFORE side is the working tree with
   only the four changed files reverted to HEAD, served on its own port; the
   AFTER side is the working tree. Every bite, position, camera and sim step
   below is identical on both — the only variable is the code under it. Every
   measurement is taken by THIS file out of the live scene graph, so both sides
   are read by one ruler rather than by each build's own audit. */

/* TEN BEATS, EVERY ONE OF THEM A FILM STRIP.

   The first cut of this report was four still pairs and it was not enough to
   argue with: a wound is a THREE-DIMENSIONAL object and one angle cannot say
   whether it stands off the skin, and "it disappears" is a claim about TIME
   that no single frame can answer at all. ba's strip hook is the cheap
   multiplier — an extra frame is a re-render, not a re-run of the chapter — so
   every subject below is a row of frames on each side, and the driver is
   allowed to move the CAMERA between them as well as the clock.

     ORBIT   the lens walks around the wound. This is the pucker's own test:
             a bowl standing off a flank is a lump from every bearing, a cut
             lying in the skin stays a line.
     DOLLY   the lens walks IN, to arm's length. Magnify before judging a shot.
     TIME    the clock runs and the camera does not. This is the owner's "falls
             off in 10 sec", asked directly.

   The strip mode is chosen per subject by id (see D.stripMode below). */
const subjects = [
  {
    id: "orbit-the-wound", ch: 0, strip: { frames: 6, stepSec: 0 },
    label: "Three Bites, Six Bearings — The Pucker's Own Test",
    focus: "The owner's complaint, walked around. Three bites into one flank of an orca held four metres down, then the lens orbits the wound through 140 degrees. BEFORE: three round everted lips that stand off the skin from every bearing — the silhouette gives them away at the grazing angles, where they read as beads stuck onto the animal. AFTER: a rake of cuts that stays a line at every bearing, because it is lying IN the flank rather than sitting on it.",
  },
  {
    id: "dolly-in", ch: 0, strip: { frames: 5, stepSec: 0 },
    label: "The Same Wound, From Eight Metres To Arm's Length",
    focus: "The lens walks in. Close enough, BEFORE resolves into what the owner actually described: a solid red lump with a raised rim, sitting proud of the skin like something pressed onto it. AFTER resolves into two or three tapered slits with raw margins and a near-black parting down each — the black line is the wound, and the margin is the skin it opened.",
  },
  {
    id: "grazing", ch: 0, strip: { frames: 4, stepSec: 0 },
    label: "Edge-On — Where Relief Has Nowhere To Hide",
    focus: "Four raking angles, almost along the flank. This is the harshest test there is for a wound that is really a bump: at a grazing incidence the crater's relief becomes its whole silhouette and it reads as a lump on the animal's outline. The cut is 0.01-0.03 m proud and simply is not there in profile.",
  },
  {
    id: "five-bites", ch: 1, strip: { frames: 5, stepSec: 0 },
    label: "Five Bites Later — Orbited",
    focus: "Two more bites further down the same flank, then the same orbit. The count is the story: BEFORE the animal carries the same number of wound meshes it carried after ONE bite, because bites four and five picked those meshes up and carried them to the new spot. AFTER, every rake is still where its teeth put it.",
  },
  {
    id: "does-it-stay", ch: 1, strip: { frames: 6, stepSec: 5 },
    label: "Thirty Seconds, One Camera — 'Falls Off In 10 Sec'",
    focus: "The clock runs and nothing else moves. This is the owner's sentence asked as a question: photograph the same wound every five simulated seconds for half a minute. Blood thins on both sides, which is right and is what he said was fair. What must not happen is the WOUND going anywhere.",
  },
  {
    id: "taking-the-tail", ch: 2, strip: { frames: 6, stepSec: 0.4 },
    label: "A Tail Lobe Comes Off — Two And A Half Seconds",
    focus: "The severance itself, frame by frame. BEFORE: the fin shrinks and a handful of gristle drifts away; the third of the fluke that is now missing exists at no coordinate in the world, so what you actually watch is a fin retracting. AFTER: the lobe leaves the body as the part's own geometry and material, and the raw cross-section it left behind is the 'skin under the fin ripped off' the owner asked for.",
  },
  {
    id: "where-it-went", ch: 2, strip: { frames: 6, stepSec: 1.3 },
    label: "In The Mouth, Then Thrown, Then On The Bottom",
    focus: "Follow the piece. It rides in the attacker's authored jaw for about a second and a third — banking and rolling with the head that took it, because its transform is read off the mouth seam every frame — then the shake throws it with that head's own velocity, and it sinks, tumbles down, and comes to rest on the sea floor. BEFORE has nothing to follow.",
  },
  {
    id: "shark-bites-shark", ch: 3, strip: { frames: 5, stepSec: 0 },
    label: "A Shark Bites A Shark — The Case That Left No Mark At All",
    focus: "The owner's sentence names this one first, and the old build refused it outright: marine_predation.js declined any same-species wound ('a pod squabble is not a meal'), so a shark chewed by its own kind took the damage and came out geometrically untouched. Orbited, so you can see there is nothing on any side of it.",
  },
  {
    id: "nothing-heals-it", ch: 3, strip: { frames: 4, stepSec: 0 },
    label: "Culled And Brought Back — Housekeeping Is Not A Doctor",
    focus: "The rig is culled for two seconds and restored. BEFORE: the per-frame leak sweep 'freed' its record by calling the wound RESTORE path, which un-shrinks the bitten part and deletes every wound on it — the animal comes back with its tail regrown and its cuts gone, which is a second, entirely separate way for a wound to vanish while you are looking at it. AFTER: the sweep drops a ledger entry and does not touch the body.",
  },
  {
    id: "dry-land", ch: 4, strip: { frames: 4, stepSec: 0 },
    label: "Regression — The Same Code Bites A Land Animal",
    focus: "systems/wounds.js is not a marine file; every land animal in the game goes through the same seat. A bitten land animal has to come out of this looking no worse — a jaw-sized wound on its flank, no water veil, no blood plume in a sea it is nowhere near — and it now carries a rake of cuts instead of a raised bowl for the same reason everything in the ocean does.",
  },
];

async function stageSharkBiteCut(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv || !CBZ.creatureBiteChunk) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkBiteCut;
  if (!D) {
    D = window.__sharkBiteCut = {
      chapter: -1, waterline: 0, pinned: [], orca: null, prey: null, biter: null, spot: null,

      /* Anything staged has to stay staged: the sim keeps running between the
         bite and the capture (that is how the blood evolves), and an orca that
         swims off takes its wounds with it. Re-written on both sides of every
         tick so no system gets the last word on where these bodies are. */
      hold() {
        for (let i = 0; i < D.pinned.length; i++) {
          const p = D.pinned[i], a = p.a;
          if (!a) continue;
          if (a.pos) { a.pos.x = p.x; a.pos.y = p.y; a.pos.z = p.z; }
          if (a.group) a.group.position.set(p.x, p.y, p.z);
          if (p.h != null) {
            a.heading = p.h;
            if (a.group && CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(a.group, p.h); } catch (e) {} }
          }
          if (a._waterMove) { a._waterMove.x = p.x; a._waterMove.z = p.z; }
          if (a.group) a.group.updateMatrixWorld(true);
        }
      },
      pin(a, x, y, z, h) { D.pinned.push({ a: a, x: x, y: y, z: z, h: h }); D.hold(); },

      /* THE PLUME IS NOT THE SUBJECT OF FRAMES ONE AND TWO, AND IT WAS EATING
         THEM. creatureBiteChunk fires gore.js's burst at every wound, which is
         correct and is what the owner wants — but a cloud seeded ON the cuts,
         photographed from eight metres, is an opaque tan wall over the exact
         pixels the two columns differ in. So the burst is muted for the staged
         bites in the wound-shape chapters and left running everywhere else;
         the blood has its own beats in chapters three and four, and the chum
         trail off the wound is untouched here either way.

         IDENTICAL ON BOTH COLUMNS, which is the only thing that makes this a
         staging choice rather than a thumb on the scale: the same function is
         muted for the same calls on the same frames of both builds. */
      noBloom(fn) {
        const b = CBZ.goreBloom, i = CBZ.goreImpact;
        CBZ.goreBloom = function () {}; CBZ.goreImpact = function () {};
        try { return fn(); } finally { CBZ.goreBloom = b; CBZ.goreImpact = i; }
      },
      step(n) { for (let i = 0; i < n; i++) { D.hold(); CBZ.stepSim(1 / 30); D.hold(); } },
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
        /* From here the match advances ONLY when a chapter steps it. Killing
           the page's frame loop is what lets a detached tripod survive to the
           capture; the render hook below draws each frame explicitly. (Straight
           out of shark-sim.mjs / marine-gore.mjs, including the drain of the
           one already-queued callback — left alive it re-stamps the camera at
           an arbitrary later compositor tick.) */
        /* AND THE DICE. Everything below this line rolls Math.random — wound
           jitter, chip velocities, the rake's own scatter — and an unseeded
           roll makes the two columns two different photographs of the same
           idea. Seeded identically on both sides, after boot so world
           generation still gets the real generator and the URL seed. */
        let rs = 0x5eed1234;
        Math.random = function () { rs = (rs * 1664525 + 1013904223) >>> 0; return (rs >>> 8) / 16777216; };
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

      /* A FIXED BEARING, NOT THE PLAYER'S LIVE ONE. This used to read the
         shark's own angle around the arena, and that angle depends on HOW MANY
         SIM STEPS THE BOOT LOOP TOOK — which depends on how fast the page
         happened to load. Two runs of the same preset on the same seed staged
         the fight in different water, and one of those waters put the bite
         point on the wrong side of goreMedium's waterline, which silently
         costs the severed lobe (only a wet bite gets physics debris). The
         columns still matched each other, so the flapping looked like a
         product bug rather than like this. The bearing is now a constant and
         the open-water search does the rest. */
      angle() { return 1.15; },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },

      /* THE LENS STANDS OFF BY THE ANIMAL'S OWN LENGTH, NOT BY A CONSTANT.
         Every camera in this preset was originally a fixed number of metres
         from a staged point, which is fine right up until the staging moves —
         and pinning the bearing for determinism moved it. The same offsets
         that framed a whole orca then put the lens inside its head, and the
         report shot came back as a close-up of a jawline. Measure the body,
         stand off a fraction of it, and aim at the stretch of flank the teeth
         are actually going to land on.

         It stays UNDER the surface on purpose: world/water_underwater.js reads
         the camera, and a lens that breaks the water loses the grade the owner
         is looking through. `dry` turns that clamp off for the land chapter,
         where the sea height is a number about somewhere else entirely. */
      shotAt(a, o) {
        o = o || {};
        a.group.updateMatrixWorld(true);
        const bb = new T.Box3().setFromObject(a.group);
        const c = bb.getCenter(new T.Vector3()), s = bb.getSize(new T.Vector3());
        const h = a.heading || 0;
        const L = Math.max(s.x, s.z);
        const tx = c.x + Math.cos(h) * L * (o.along || 0);
        const tz = c.z + Math.sin(h) * L * (o.along || 0);
        const ty = c.y + s.y * (o.aim == null ? 0.30 : o.aim);
        /* THE FLOOR IS THE ANIMAL'S OWN BEAM, not a constant. A dolly quoted
           only against LENGTH walks the lens straight through the side of a
           body that is two metres wide: the closest frame of the first strip
           was taken from INSIDE the orca and photographed open water. Stand
           off at least half the beam plus a metre, always. */
        const d = Math.max(0.5 * Math.min(s.x, s.z) + 1.0, L * (o.dist == null ? 1.05 : o.dist));
        /* THE BEARING IS RELATIVE TO THE ANIMAL, and it has to be: the orbit
           has to stay on the side the teeth landed on. maul() bites whichever
           flank the lens was on when it fired, and that lens was at yaw 0, so
           every frame of an orbit is quoted as an offset from there. */
        const b = h + Math.PI * 0.5 + (o.yaw || 0);
        const up = o.up == null ? 0.42 : o.up;
        let cy = ty + d * up;
        if (!o.dry) cy = Math.min(D.seaY(tx, tz) - 0.6, cy);
        D.tripod(tx + Math.cos(b) * d, cy, tz + Math.sin(b) * d, tx, ty, tz);
        return { x: tx, y: ty, z: tz, d: d, L: L };
      },
      // the old name, kept because three chapters call it
      flankShot(a, atFrac, backK) {
        return D.shotAt(a, { along: atFrac, dist: backK });
      },

      /* ---- THE STRIP RIG -----------------------------------------------
         ba photographs a subject, then calls advance(stepSec) and photographs
         it again, N times. What "advance" MEANS is this file's business, and
         for a wound it is three different things:

           orbit   walk the lens around the body. Nothing else moves. This is
                   the only way a still report can argue about relief, because
                   relief is exactly the thing that changes with bearing.
           dolly   walk the lens IN toward the wound.
           time    run the clock and hold the camera still.

         A TRAP THAT COST TWO RUNS' WORTH OF FRAMES EARLIER IN THIS FILE: the
         game's own camera update runs INSIDE stepSim and snaps the lens back
         onto the player's shark, so any strip that advances the clock must
         re-aim afterwards or every frame after the first is a photograph of
         the player's own tail. D.reaim is re-run after every step, always. */
      reaim() { if (D._aim) D._aim(); },
      setAim(fn) { D._aim = fn; fn(); },
      stripStep(sec) {
        const m = D.strip || {};
        if (m.mode === "orbit") {
          D.yaw = (D.yaw || 0) + (m.step || 0.42);
          D.reaim();
        } else if (m.mode === "dolly") {
          D.dist = (D.dist == null ? (m.from || 1.15) : D.dist) * (m.k || 0.66);
          D.reaim();
        } else {
          D.sec(sec > 0 ? sec : 0.5);
          D.reaim();
        }
      },

      /* Everything that is not this experiment goes away: a pod converging on
         the player mid-capture would bite the same body with its own timing and
         the two columns would stop being the same photograph. */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a === D.orca || a === D.prey || a === D.biter) continue;
          if (a.species.id === "orca" || (a.species.aquatic && (a.species.bite || 0) >= 24)) {
            a.pos.x += 900; a.hunger = 0;
            if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
          }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 900;
        }
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },

      /* WHERE THE WATER ACTUALLY IS. Staging on a bearing off the shark's nose
         can land on the island's shelf, where the game's own water oracle says
         DRY — and then the whole medium chain answers "air", the plume is
         correctly declined, and the frame comes back with a bitten animal and
         no blood. So the spot is SEARCHED for. (Learned by marine-gore.mjs;
         copied rather than rediscovered.) */
      openWater(ang) {
        for (let r = D.waterline + 18; r < D.waterline + 150; r += 6) {
          const p = D.ringPoint(ang, r);
          const wet = CBZ.cityWaterAt ? CBZ.cityWaterAt(p.x, p.z) : true;
          const dep = CBZ.cityWaterDepthAt ? CBZ.cityWaterDepthAt(p.x, p.z) : 9;
          if (wet && dep > 7) return { x: p.x, z: p.z, depth: dep, r: r };
        }
        return null;
      },
      findOrSpawn(id, x, z, skip) {
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || a.external || a.ridden || !a.species) continue;
          if (a.species.id !== id) continue;
          if (skip && skip.indexOf(a) >= 0) continue;
          return a;
        }
        return CBZ.cityWildlifeSpawnAt ? CBZ.cityWildlifeSpawnAt(id, x, z) : null;
      },

      /* THE RULER, and it is this file's own so both columns are measured by
         one instrument. Every wound mesh either build parents into a rig
         carries `_tornCap`; its matrixWorld columns already hold its own scale
         times every parent's, so their lengths ARE its world extents —
         rotation-invariant, which an axis-aligned Box3 would not be.

         The Z column is the RELIEF (both builds aim their wound's thin axis
         down the surface normal), and the longest of X/Y is the FOOTPRINT. The
         ratio between them is the whole report: a bowl is thick relative to its
         own footprint and photographs as a lump; a cut is not. */
      measure(root) {
        let n = 0, veiled = 0, len = 0, thick = 0, sumRatio = 0;
        if (!root) return { n: 0, len: 0, thick: 0, ratio: 0, veiled: 0 };
        root.updateMatrixWorld(true);
        root.traverse(function (o) {
          if (!o.isMesh || !o._tornCap) return;
          const e = o.matrixWorld.elements;
          const a = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2]);
          const b = Math.sqrt(e[4] * e[4] + e[5] * e[5] + e[6] * e[6]);
          const c = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);
          const foot = Math.max(a, b);
          n++;
          if (foot > len) len = foot;
          if (c > thick) thick = c;
          sumRatio += foot > 1e-6 ? (c / foot) : 0;
          const m = o.material;
          if (m && m.userData && m.userData.cbzVeiled) veiled++;
        });
        return { n: n, len: len, thick: thick, veiled: veiled, ratio: n ? sumRatio / n : 0 };
      },
      // loose severed lobes anywhere in the world (AFTER only — the old build
      // never made one, which is the finding, not a measurement failure)
      pieces() {
        let n = 0;
        CBZ.scene.traverse(function (o) { if (o.isMesh && o._cbzPiece) n++; });
        return n;
      },
      partScale(a) {
        // the smallest scale on any child mesh of the rig: a severed fin is
        // the one part that has been shrunk, so this falls when a piece comes
        // off and RISES again if something heals the animal
        let lo = 1e9;
        const g = a && a.group; if (!g) return 0;
        for (const m of g.children) {
          if (!m.isMesh || m._tornCap) continue;
          lo = Math.min(lo, Math.min(m.scale.x, Math.min(m.scale.y, m.scale.z)));
        }
        return lo === 1e9 ? 0 : lo;
      },
      /* HOW LONG THE CUT IS STILL LEAKING. The first run counted SPRITES near
         the wound and got 0 on both columns while the frame plainly showed a
         red slick — gore.js's blood is not all sprites, so that ruler was
         measuring nothing. Ask gore.js instead: goreChumList is the register of
         open bleed sources, and each carries the ttl it has left. That is the
         owner's own "maybe the blood coming out slows eventually, that's
         fair", measured: a cut that is still open still has seconds on it. */
      /* WOUNDS THAT ARE STILL LEAKING. Two earlier rulers measured nothing on
         either column — sprites near the wound (gore.js's blood is not all
         sprites) and then gore.js's raw chum register (systems/wounds.js hands
         every marine bleed to marine_predation's six-slot arbiter and returns
         before it ever opens a raw handle). The number that is actually about
         THIS change is the one wounds.js publishes itself, on both builds:
         BLEED.length — how many bitten animals are still bleeding from a
         wound. That is the owner's "the line lets blood out". */
      spritesNear(x, z, r) {
        let n = 0; const r2 = r * r;
        CBZ.scene.traverse(function (o) {
          if (!o.isSprite || o.visible === false) return;
          const dx = o.position.x - x, dz = o.position.z - z;
          if (dx * dx + dz * dz <= r2) n++;
        });
        return n;
      },
      bleeders() {
        if (typeof CBZ.creatureBiteChunkAudit !== "function") return 0;
        try { return CBZ.creatureBiteChunkAudit().bleeders || 0; } catch (e) { return 0; }
      },

      /* THE BITES. Fired at real flank points measured off the animal's own
         world bounding box, with the jaw a player megalodon actually carries.
         The camera is put on the wound FIRST because creatureBiteChunk refuses
         outside a 45 m band on BOTH sides. `dir` and `by` are extra keys the
         old build simply ignores, so the same call is legal on both columns. */
      maul(a, n, from) {
        if (!a) return 0;
        a.group.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(a.group);
        const c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
        const h = a.heading || 0, fx = Math.cos(h), fz = Math.sin(h);
        const L = Math.max(s.x, s.z), beam = Math.min(s.x, s.z);
        const nx = -fz, nz = fx;
        const camx = CBZ.camera ? CBZ.camera.position.x : c.x;
        const camz = CBZ.camera ? CBZ.camera.position.z : c.z + 10;
        const side = ((camx - c.x) * nx + (camz - c.z) * nz) >= 0 ? 1 : -1;
        // AFT OF THE PECTORALS, ON THE FLANK: partAt breaks ties toward the
        // SMALLER part, so a bite level with the pectorals takes a pectoral.
        // The owner's screenshot is a wound on the BODY.
        const dir = { x: Math.cos(h + Math.PI * 0.42), y: 0, z: Math.sin(h + Math.PI * 0.42) };
        let hits = 0;
        for (let i = 0; i < n; i++) {
          const along = -L * (0.14 + (from || 0) * 0.10 + i * 0.11);
          const px = c.x + fx * along + nx * side * beam * 0.42;
          const pz = c.z + fz * along + nz * side * beam * 0.42;
          // ON THE UPPER FLANK. Aimed below the centreline these landed on the
          // white underside, which is both the wrong half of a countershaded
          // animal and the half the lens is not looking at.
          const py = c.y + (0.06 + (i % 2) * 0.12) * s.y;
          try {
            if (CBZ.creatureBiteChunk(a, { x: px, y: py, z: pz },
              { jaw: 1.05, sev: 0.85, dir: dir, by: CBZ.sharkSim.shark, bleedS: 16 })) hits++;
          } catch (e) {}
          a.group.updateMatrixWorld(true);
        }
        return hits;
      },
    };

    window.__cbzVisualCompare = {
      /* Awaited before every capture. Under SwiftShader the compositor takes
         over a second to PRESENT a rendered canvas, and a canvas rendered
         outside an animation frame is never presented at all — so render inside
         ONE borrowed real frame (the game's own chain is already dead, so
         lending RAF back for one callback cannot restart it) and then wait the
         compositor out. */
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
      // ba's strip hook. What "advance" means here depends on the subject —
      // see D.stripStep: a bearing, a step closer, or five seconds of clock.
      async advance(sec) { D.stripStep(sec); },
    };
  }

  const out = {};
  const CH = [
    // 0 — the owner's shot: three bites into one flank, close, from the side
    async function report() {
      if (!await D.boot()) throw new Error("sharksim never armed");
      D.peace();
      const P = CBZ.player, ang = D.angle();
      const found = D.openWater(ang) || D.openWater(ang + 1.2) || D.openWater(ang - 1.2);
      if (!found) throw new Error("nowhere wet to stage");
      D.water = found;
      P.pos.x = found.x; P.pos.z = found.z;
      D.step(4);
      const seaward = D.ringPoint(ang, found.r + 13);
      const h = Math.atan2(seaward.z - found.z, seaward.x - found.x);
      CBZ.sharkSim.shark.heading = h;
      const o = D.findOrSpawn("orca", seaward.x, seaward.z);
      if (!o) throw new Error("no orca to maul");
      o.hunger = 0; o.hp = o.maxHp || o.hp;
      D.orca = o;
      /* FOUR AND A HALF METRES DOWN, NOT ONE. The lens has to get ABOVE the
         animal's own back to photograph a wound on its flank, and it has to
         stay under the water to keep the grade — with the orca a metre below
         the surface those two demands leave a two-degree window and every shot
         came back edge-on, looking along a white belly. Depth is what buys the
         angle, and it is also the truer staging: this is a game about being a
         shark, and a shark looks DOWN on what it is eating. */
      const S = D.spot = { x: seaward.x, y: D.seaY(seaward.x, seaward.z) - 4.5, z: seaward.z,
                           sy: D.seaY(seaward.x, seaward.z), h: h };
      D.pin(o, S.x, S.y, S.z, h + Math.PI * 0.5);      // broadside to the lens
      D.step(2);
      /* THE LENS GOES ON THE WOUND BEFORE THE TEETH DO — creatureBiteChunk
         refuses outside a 45 m band on both sides, and the detached tripod is
         what dist2Cam reads. Close, and low: the pucker is a PROFILE read and
         a shot from above flattens it into the disc it is pretending not to be. */
      /* CLOSE, AND ABOVE THE LATERAL LINE. The first run of this preset shot
         from 8 m and half a metre under the surface, which framed the orca's
         WHITE BELLY at the size of a thumbnail — a wound photographed against
         countershading, from below, at range. Everything the owner is
         complaining about is a PROFILE read on the dark back, so the tripod
         drops to 4.2 m out and rides just over the animal's own spine, still
         submerged (world/water_underwater.js reads the camera, and a lens that
         breaks the surface loses the underwater grade the report is about). */
      D.shot = () => D.flankShot(o, -0.16, 1.05);
      D.shot();
      out.bitesLanded = D.noBloom(() => D.maul(o, 3, 0));
      if (!out.bitesLanded) throw new Error("no bite landed on the orca");
      D.sec(0.45);      // enough for blood to leave the flank, not enough to fill the lens
      D.shot();
      const m = D.measure(o.group);
      out.woundMeshes = m.n;
      out.woundLengthM = Number(m.len.toFixed(3));
      out.woundReliefM = Number(m.thick.toFixed(3));
      out.puckerRatioPct = Number((m.ratio * 100).toFixed(1));
      out.woundsVeiled = m.veiled;
      out.bleeders = D.bleeders();
      D.medium = {
        cityWaterAt: CBZ.cityWaterAt ? !!CBZ.cityWaterAt(S.x, S.z) : null,
        depthM: CBZ.cityWaterDepthAt ? Number(CBZ.cityWaterDepthAt(S.x, S.z).toFixed(1)) : null,
        goreMedium: CBZ.goreMedium ? CBZ.goreMedium(S.x, S.y, S.z) : null,
        translucent: CBZ.seaTranslucentOn ? !!CBZ.seaTranslucentOn() : null,
      };
    },
    // 1 — two more bites a second apart: does the first one survive them?
    async function accumulate() {
      const S = D.spot, o = D.orca;
      D.sec(1.3);
      D.shot();
      D.noBloom(() => D.maul(o, 1, 2.4));
      D.sec(1.3);
      D.shot();
      D.noBloom(() => D.maul(o, 1, 4.0));
      D.sec(0.8);
      // a step back, so five bites' worth of flank is all in one frame
      D.flankShot(o, -0.24, 1.30);
      const m = D.measure(o.group);
      out.marksAfterFive = m.n;
      out.woundLengthM = Number(m.len.toFixed(3));
      out.woundReliefM = Number(m.thick.toFixed(3));
      out.puckerRatioPct = Number((m.ratio * 100).toFixed(1));
      out.bleeders = D.bleeders();
    },
    // 2 — take a whole tail lobe off a shark and look for the lobe
    async function piece() {
      const S = D.spot;
      /* A DIFFERENT BEARING, not merely a different radius — but SEARCHED for,
         not assumed. Staged six metres inshore of the orca the first time, the
         prey shark shared the frame with it and the tripod meant for a tail
         lobe photographed a mauled orca instead. Moved to a flat offset off
         the bearing on the second run it landed somewhere the game calls dry,
         which silently costs BOTH the severed lobe (only water gets physics
         debris) and the blood. So walk the ring until the game's own water
         oracle says yes, exactly like the orca's spot. */
      const ang2 = D.angle() - 0.95;
      const w2 = D.openWater(ang2) || D.openWater(ang2 + 0.5) || D.openWater(ang2 - 0.5) || D.water;
      const at = { x: w2.x, z: w2.z };
      const y = D.seaY(at.x, at.z) - 4.2;
      out.preyMedium = CBZ.goreMedium ? CBZ.goreMedium(at.x, y, at.z) : null;
      const prey = D.findOrSpawn("bull_shark", at.x, at.z, [CBZ.sharkSim.shark]) ||
                   D.findOrSpawn("hammerhead_shark", at.x, at.z, [CBZ.sharkSim.shark]) ||
                   D.findOrSpawn("great_white_shark", at.x, at.z, [CBZ.sharkSim.shark]);
      if (!prey) throw new Error("no second shark to bite");
      prey.hunger = 0; prey.hp = prey.maxHp || prey.hp;
      D.prey = prey;
      const ph = D.spot.h + Math.PI * 0.5;
      D.pin(prey, at.x, y, at.z, ph);
      D.step(3);
      prey.group.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(prey.group);
      const c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
      const L = Math.max(s.x, s.z), fx = Math.cos(ph), fz = Math.sin(ph);
      // THE TAIL, not the flank: severance needs a part whose cross-section
      // the jaw can close around, and the caudal fin is the one the owner
      // named. The camera goes on it first (the 45 m band, again).
      const tx = c.x - fx * L * 0.46, tz = c.z - fz * L * 0.46;
      const td = Math.max(2.6, L * 0.62);
      D.tail = () => D.tripod(tx - fz * td, Math.min(D.seaY(tx, tz) - 0.4, y + td * 0.36), tz + fx * td,
                              tx - fx * 0.3, y + 0.05, tz - fz * 0.3);
      D.tail();
      out.piecesBefore = D.pieces();
      out.tailScaleBefore = Number(D.partScale(prey).toFixed(3));
      const dir = { x: fx, y: 0, z: fz };
      /* THE BITE'S OWN Y, AND IT HAS TO BE WET. creatureBiteChunk decides the
         medium at the POINT THE TEETH CLOSED, not at the animal's origin — and
         a tail lobe aimed at the top of the bounding box on a shark riding a
         metre under the surface lands in AIR, which is a legal answer that
         costs the severed lobe its physics. Aim at the pinned depth. */
      const by = y + s.y * 0.05;
      out.biteMedium = CBZ.goreMedium ? CBZ.goreMedium(tx, by, tz) : null;
      for (let i = 0; i < 2; i++) {
        try {
          CBZ.creatureBiteChunk(prey, { x: tx, y: by, z: tz },
            { jaw: 1.3, sev: 0.95, dir: dir, by: CBZ.sharkSim.shark, bleedS: 14 });
        } catch (e) {}
        D.sec(0.5);
        D.tail();
      }
      /* THE SETTLE BELONGS TO THE SUBJECT THAT NEEDS IT. `where-it-went` wants
         the lobe already out of the jaw (PIECE_CARRY is 1.35 s), so it waits.
         `taking-the-tail` is a strip OF the severance and has to start on the
         frame the teeth closed, or its first three frames are all aftermath. */
      if (sub.id !== "taking-the-tail") D.sec(1.6);
      D.tail();
      out.piecesInWater = D.pieces();
      out.tailScaleAfter = Number(D.partScale(prey).toFixed(3));
      const m = D.measure(prey.group);
      out.tailMarks = m.n;
      out.puckerRatioPct = Number((m.ratio * 100).toFixed(1));
    },
    // 3 — a shark bites a shark, and then nothing is allowed to heal it
    async function kinAndCull() {
      const prey = D.prey;
      if (!prey) throw new Error("chapter 2 left no prey");
      /* SAME SPECIES, THROUGH THE REAL BUS. CBZ.marineHurt is the one entry
         every marine blow arrives on, and it is where the species test lived.
         The attacker is a second animal of the SAME species as the victim, so
         the old build's "a pod squabble is not a meal" rule fires and the AFTER
         build's severity discount does. */
      const at = { x: prey.pos.x + 4, z: prey.pos.z + 1.5 };
      /* SPAWN A FRESH ONE, never reuse whatever is swimming about. findOrSpawn
         scans the live wildlife list first, and which animal it hands back
         depends on the order of that list — which depends on how far the world
         had advanced when this chapter ran, which depends on how many sim steps
         the boot loop took, which depends on how fast the page loaded. Three
         runs of this preset picked three different sharks at three different
         offsets from the quarry, and one of those offsets put the pod's flank
         point somewhere the wound code declined; the beat read 3 bites, then 0,
         then 3 again with nothing in the build changing. A fresh spawn at a
         fixed offset is the same animal in the same place every run. */
      const kin = (CBZ.cityWildlifeSpawnAt ? CBZ.cityWildlifeSpawnAt(prey.species.id, at.x, at.z) : null)
        || D.findOrSpawn(prey.species.id, at.x, at.z, [CBZ.sharkSim.shark, prey]);
      out.kinSpecies = prey.species.id;
      out.kinFound = !!kin;

      /* HARNESS TRAP: A DETACHED TRIPOD LIVES UNTIL THE NEXT stepSim, AND NOT
         ONE TICK LONGER. The game's own camera update runs inside the sim step
         and snaps the lens back onto the player's shark, so a tripod set in an
         earlier chapter is gone the moment this one steps. That is invisible
         in a frame (the capture re-aims at the end anyway) and lethal to
         anything the sim gates on distance: creatureBiteChunk refuses outside
         a 45 m band, the lens was 134 m away by the time these bites landed,
         and every one of them was correctly declined. Two runs read that as
         "the same-species fix did not work".

         So: the player goes to the prey, and the lens is re-aimed immediately
         before every blow — the same discipline maul() already follows. */
      const aim = function () { D.flankShot(prey, -0.05, 0.85); };
      CBZ.player.pos.x = prey.pos.x - 6; CBZ.player.pos.z = prey.pos.z - 6;
      CBZ.player.pos.y = prey.pos.y;
      D.step(2);
      aim();
      const auditBefore = (typeof CBZ.marineAudit === "function") ? (CBZ.marineAudit().chunks || 0) : -1;
      let before = D.measure(prey.group).n;
      if (kin) {
        D.biter = kin;
        kin.hunger = 0;
        D.pin(kin, at.x, prey.pos.y, at.z, prey.heading || 0);
        D.step(2);
        /* CHUNK_EVERY IS MEASURED IN WALL TIME, AND THIS PRESET HAS FROZEN
           THE CLOCK THAT MATTERS. marine_predation throttles one wound per
           victim per 1.1 s off performance.now(); D.sec() advances the SIM,
           and thirty-seven stepSim calls take about a tenth of a real second.
           So the first run of this chapter fired three bites inside one
           throttle window and billed exactly one of them — which reads
           identically to "the same-species gate is still there". Sleep for
           real between the blows. */
        /* AND A CONTROL, because "0 marks" has two very different causes and
           the frame cannot tell them apart: the pod code refusing the bite, or
           the wound code refusing to seat one here at all. Fire the production
           seat directly at the same body first and record what it says.

           IT EARNED ITS KEEP ON THE FIRST RUN. Both answers came back "no" —
           the direct call refused too — which located the fault in
           systems/wounds.js (an actor was capped at four BITTEN PARTS and went
           immune to every later bite) rather than in marine_predation.js's
           species test, where the frame alone would have left it. */
        aim();
        try {
          out.directSeatWorks = !!CBZ.creatureBiteChunk(prey,
            { x: prey.pos.x, y: prey.pos.y, z: prey.pos.z + 0.8 },
            { jaw: 0.6, sev: 0.7, by: kin, bleedS: 12 });
        } catch (e) { out.directSeatWorks = "threw: " + e.message; }
        // the control just put a wound on the body: re-baseline, or kinMarks
        // measures the control instead of the thing it is named after
        before = D.measure(prey.group).n;
        // every gate creatureBiteChunk can refuse on, read off the live actor
        const cam = CBZ.camera ? CBZ.camera.position : { x: 0, z: 0 };
        out.kinDiag = {
          culled: !!prey.culled,
          visible: prey.group ? prey.group.visible !== false : null,
          camDist: Number(Math.hypot(prey.pos.x - cam.x, prey.pos.z - cam.z).toFixed(1)),
          bodyMeshes: prey.group ? prey.group.children.filter((m) => m.isMesh && !m._tornCap).length : 0,
          childSafe: !!(prey.child || prey._childSafe),
          posY: Number((prey.pos.y || 0).toFixed(2)),
          groupY: prey.group ? Number(prey.group.position.y.toFixed(2)) : null,
          groupScale: prey.group ? Number(prey.group.scale.x.toFixed(2)) : null,
        };
        out.preyHpFrac = Number(((prey.hp || 0) / (prey.maxHp || 1)).toFixed(2));
        out.preyDead = !!prey.dead;
        out.preyRecords = (typeof CBZ.creatureBiteChunkAudit === "function")
          ? CBZ.creatureBiteChunkAudit().chunks : -1;
        const hp = prey.maxHp || prey.hp || 100;
        for (let i = 0; i < 3; i++) {
          aim();                                   // the step below will undo this
          try { CBZ.marineHurt(prey, hp * 0.12, kin, "bitten by a " + prey.species.id); } catch (e) {}
          D.sec(0.5);
          await sleep(1250);
        }
      }
      out.kinMarks = Math.max(0, D.measure(prey.group).n - before);
      // marine_predation's own counter, so a zero above can be told apart from
      // "the bus never reached the wound code at all"
      out.kinBitesBilled = (typeof CBZ.marineAudit === "function")
        ? Math.max(0, (CBZ.marineAudit().chunks || 0) - auditBefore) : -1;
      out.preyHpAfterKin = Number(((prey.hp || 0) / (prey.maxHp || 1)).toFixed(2));
      out.preyDeadAfterKin = !!prey.dead;

      /* AND NOW NOTHING MAY HEAL IT. `culled` is what the per-frame leak sweep
         reads; the old build answered it by calling the RESTORE path, which
         un-shrinks the bitten part and deletes every wound mesh on it. Two
         seconds is comfortably past that sweep's 1.1 s throttle. */
      const marksPre = D.measure(prey.group).n;
      const scalePre = D.partScale(prey);
      prey.culled = true;
      D.sec(2.0);
      prey.culled = false;
      D.sec(0.3);
      aim();
      const marksPost = D.measure(prey.group).n;
      out.marksSurvivingCull = marksPost;
      out.marksLostToCull = Math.max(0, marksPre - marksPost);
      out.tailRegrewPct = Number((Math.max(0, D.partScale(prey) - scalePre) * 100).toFixed(1));
      /* OUTSIDE THE ANIMAL. The first run put the tripod 7.5 m off the prey's
         CENTRE — which, with the kin shark pinned 4 m to one side and the
         player's own megalodon between them, framed the inside of a pectoral
         fin. Stand off by the animal's own measured length instead of by a
         constant, and look at it from above its own back. */
      D.flankShot(prey, -0.02, 1.15);
    },
    /* 4 — THE REGRESSION THAT MATTERS MOST, and it is not in the sea at all.
       systems/wounds.js is a universal file: every land animal in this game
       goes through the same seat, the same materials and now the same gash
       geometry. A bitten wolf on a beach has to come out of this looking no
       worse than it did — a jaw-sized wound on its flank, no water veil, and
       NO blood plume, because gore.js clamps every puff to the sea surface as
       a lid and a bite in a forest used to spend capped pool slots on clouds
       sitting at y=0 under the terrain. */
    async function land() {
      const at = D.ringPoint(D.angle() + 1.05, Math.max(4, D.waterline - 26));
      let id = null;
      const want = ["wolf", "boar", "deer", "bear", "coyote", "goat", "cow", "horse"];
      const SP = CBZ.WILDLIFE_SPECIES || {};
      for (let i = 0; i < want.length && !id; i++) if (SP[want[i]] && !SP[want[i]].aquatic) id = want[i];
      if (!id) for (const k in SP) { if (SP[k] && !SP[k].aquatic && SP[k].build) { id = k; break; } }
      if (!id || !CBZ.cityWildlifeSpawnAt) throw new Error("no land species to bite");
      const a = CBZ.cityWildlifeSpawnAt(id, at.x, at.z);
      if (!a) throw new Error("land spawn refused: " + id);
      const gy = CBZ.surv.floorAt ? CBZ.surv.floorAt(at.x, at.z) : 0;
      a.hunger = 0;
      D.landA = a;
      out.landSpecies = id;
      D.pin(a, at.x, gy, at.z, D.angle() + 1.05 + Math.PI * 0.5);
      /* AND THE PLAYER COMES ASHORE WITH IT. Wildlife visibility is LOD'd off
         the PLAYER, not off the camera, and the player in this preset is a
         shark forty metres out to sea — so a coyote staged on the beach spawned
         with group.visible === false, creatureBiteChunk refused it on that gate
         alone, and the regression chapter measured a clean zero on BOTH columns
         while looking straight at the animal. A detached tripod is not the same
         thing as being there. */
      CBZ.player.pos.x = at.x - 3; CBZ.player.pos.z = at.z - 3; CBZ.player.pos.y = gy;
      D.step(4);
      if (a.group) a.group.visible = true;
      out.landVisible = !!(a.group && a.group.visible !== false);
      out.landCulled = !!a.culled;
      D.step(2);
      D.hold();
      a.group.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(a.group);
      const c = box.getCenter(new T.Vector3()), sz = box.getSize(new T.Vector3());
      D.shotAt(a, { along: -0.08, dist: 1.5, aim: 0.35, up: 0.30, dry: true });
      const puffsBefore = D.spritesNear(c.x, c.z, 30);
      const dirL = { x: Math.cos(D.angle()), y: 0, z: Math.sin(D.angle()) };
      try {
        out.landBiteTook = !!CBZ.creatureBiteChunk(a,
          { x: c.x, y: c.y + sz.y * 0.12, z: c.z + Math.min(sz.x, sz.z) * 0.5 },
          { jaw: 0.34, sev: 0.8, dir: dirL, bleedS: 10 });
      } catch (e) { out.landBiteTook = "threw: " + e.message; }
      a.group.updateMatrixWorld(true);
      D.shotAt(a, { along: -0.08, dist: 1.5, aim: 0.35, up: 0.30, dry: true });
      const m = D.measure(a.group), L = Math.max(sz.x, sz.z);
      out.landWoundVsBodyPct = Number(((m.len / Math.max(0.4, L)) * 100).toFixed(1));
      out.landPuckerRatioPct = Number((m.ratio * 100).toFixed(1));
      out.landMarks = m.n;
      // a land bite has no business putting blood plumes in the sea
      out.landSeaPuffs = Math.max(0, D.spritesNear(c.x, c.z, 30) - puffsBefore);
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  /* ---- WHAT THIS SUBJECT'S STRIP IS FOR ----------------------------------
     The chapters put the world in a state; this decides what the row of frames
     photographed out of that state is ARGUING. Every aim closure is re-run
     after each step (D.reaim), which is what keeps a time strip pointed at the
     wound instead of at the player's tail. */
  const orca = D.orca, prey = D.prey;
  D.yaw = 0; D.dist = null; D.up = null;
  switch (sub.id) {
    case "orbit-the-wound":
      D.yaw = -1.00;
      D.strip = { mode: "orbit", step: 0.46 };
      D.setAim(() => D.shotAt(orca, { along: -0.16, dist: 1.05, aim: 0.30, yaw: D.yaw }));
      break;
    case "dolly-in":
      D.dist = 1.15;
      D.strip = { mode: "dolly", k: 0.72 };
      D.setAim(() => D.shotAt(orca, { along: -0.16, dist: D.dist, aim: 0.26, up: 0.30 }));
      break;
    case "grazing":
      // low and nearly along the flank: relief IS the silhouette at this
      // incidence, which is the one thing a bowl cannot survive
      D.yaw = 1.02;
      D.strip = { mode: "orbit", step: 0.22 };
      D.setAim(() => D.shotAt(orca, { along: -0.16, dist: 0.72, aim: 0.24, up: 0.03, yaw: D.yaw }));
      break;
    case "five-bites":
      D.yaw = -0.85;
      D.strip = { mode: "orbit", step: 0.44 };
      D.setAim(() => D.shotAt(orca, { along: -0.22, dist: 1.15, aim: 0.30, yaw: D.yaw }));
      break;
    case "does-it-stay":
      D.strip = { mode: "time" };
      D.setAim(() => D.shotAt(orca, { along: -0.20, dist: 1.00, aim: 0.28 }));
      break;
    case "taking-the-tail":
      D.strip = { mode: "time" };
      D.setAim(() => D.shotAt(prey, { along: -0.40, dist: 0.85, aim: 0.30, up: 0.30 }));
      break;
    case "where-it-went":
      /* THE PIECE IS THE SUBJECT, SO THE PIECE IS WHAT THE LENS FOLLOWS — and
         on the BEFORE side there is nothing to follow, which is the finding.
         Falling back to the stump keeps both columns pointed at the same place
         for the same reason rather than one of them wandering. */
      D.strip = { mode: "time" };
      D.setAim(() => {
        let p = null;
        CBZ.scene.traverse((o) => { if (!p && o.isMesh && o._cbzPiece) p = o; });
        if (p) {
          p.getWorldPosition(D._pv = D._pv || new T.Vector3());
          const v = D._pv;
          D.tripod(v.x + 3.2, Math.min(D.seaY(v.x, v.z) - 0.6, v.y + 2.2), v.z + 3.2, v.x, v.y, v.z);
        } else {
          D.shotAt(prey, { along: -0.40, dist: 1.05, aim: 0.25, up: 0.30 });
        }
      });
      break;
    case "shark-bites-shark":
      D.yaw = -0.75;
      D.strip = { mode: "orbit", step: 0.40 };
      D.setAim(() => D.shotAt(prey, { along: -0.02, dist: 1.05, aim: 0.32, yaw: D.yaw }));
      break;
    case "nothing-heals-it":
      D.yaw = -0.55;
      D.strip = { mode: "orbit", step: 0.38 };
      D.setAim(() => D.shotAt(prey, { along: -0.10, dist: 0.95, aim: 0.30, yaw: D.yaw }));
      break;
    case "dry-land":
      D.yaw = -0.60;
      D.strip = { mode: "orbit", step: 0.40 };
      D.setAim(() => D.shotAt(D.landA, { along: -0.08, dist: 1.5, aim: 0.35, up: 0.30, dry: true, yaw: D.yaw }));
      break;
    default:
      D.strip = { mode: "time" };
      break;
  }

  await window.__cbzVisualCompare.render();
  const audit = (typeof CBZ.creatureBiteChunkAudit === "function") ? CBZ.creatureBiteChunkAudit() : null;
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      state: CBZ.game.state, mode: CBZ.game.mode,
      water: D.water || null, medium: D.medium || null,
      chunkAudit: audit,
    },
    metrics: out,
  };
}

export default {
  id: "shark-bite-cut",
  title: "Shark Sim Bites — A Cut, Not A Puckering Lip",
  description: "Ten beats of the same staged fight in Shark Sim, and every one of them is a FILM STRIP rather than a still — around eighty photographs in all, both columns driven by one file. The owner's report is beat one: a bite left \"a puckering lip ... like a red piece of playdough got stuck to them\", and it vanished within seconds. Three of those are separate defects and the strips are what tell them apart. THE SHAPE was three nested bowls of revolution seated ENTIRELY ABOVE THE SKIN — the file's own comment called it \"a raised, everted, ragged lip\" — so the lens ORBITS it, walks IN to arm's length, and drops to a grazing incidence where relief has nowhere to hide; it is a rake of tapered CUTS now, laid along the line the attacker was travelling and standing about a ninth of their own width off the flank. THE DISAPPEARANCE was never a timer: the wound record was keyed on the MESH, and a shark or an orca is one generated hull mesh, so the next bite picked up the same three meshes and carried them to the new point — the thirty-second strip asks that question directly, with the clock running and the camera still. THE PIECE went nowhere: a severed fin lobe is now a real object with the part's own geometry and material, and two strips follow it out of the body, into the attacker's jaw, and down to the sea floor. Behind those, three bites that silently did nothing at all — an animal that went immune after four bitten parts, a pod flank point quoted at the full fin span so the teeth closed in open water, and a same-species refusal that deleted the case the owner names first — plus a per-frame leak sweep that answered \"this rig left the scene\" by calling the wound RESTORE path, i.e. by healing it. The last beat is the regression that matters most: the same code bites a land animal.",
  beforeLabel: "BEFORE · HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same animals · same bite points · same jaw · same cameras",
  method: "EIGHTY-ODD FRAMES, ONE DRIVER. Every subject is a ba film strip: the page is photographed, then this preset's own advance() hook moves something and it is photographed again. What moves is the subject's argument — an ORBIT walks the lens around the wound (the only way stills can argue about relief, because relief is exactly what changes with bearing), a DOLLY walks it in to arm's length, and a TIME strip runs the clock with the camera held still. Both columns photograph the identical bearings and the identical simulated seconds. Both columns boot index.html into ?mode=sharksim with a pinned seed and click the Shark Sim tile + PLAY exactly like a player. A per-page driver freezes the frame loop, quiets the pod, stages the animals at fixed points four metres down (depth is what lets the lens get above an animal's back and still stay under the water), and bites them through the production CBZ.creatureBiteChunk. In the two wound-SHAPE beats gore.js's burst is muted for the staged bites — identically on both columns, same function, same calls, same frames — because a tan cloud seeded on the cuts is an opaque wall over the exact pixels the columns differ in; the blood runs untouched in the other two beats and the chum trail off the wound is never muted anywhere (and, for the same-species beat, through CBZ.marineHurt — the one bus every marine blow arrives on). The `dir` and `by` options the AFTER build reads are extra keys the BEFORE build simply ignores, so the identical call is legal on both. Every measurement is taken by the preset out of the live scene graph: wound meshes carry `_tornCap` on both builds, and their world extents come from the matrixWorld columns so a rotated wound is measured honestly. The Z column is the relief (both builds aim the wound's thin axis down the surface normal) and the longest of X/Y is the footprint — puckerRatio is the mean of relief over footprint, which is the shape argument in one number.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 420000,
  metrics: {
    puckerRatioPct: { label: "Wound relief as a share of its own footprint (the pucker)", unit: "%", better: "lower" },
    woundReliefM: { label: "How far the worst wound stands off the skin", unit: "m", better: "lower" },
    woundLengthM: { label: "Longest wound footprint on the body (context for the ratio)", unit: "m" },
    marksAfterFive: { label: "Wound meshes still on the orca after FIVE bites", better: "higher" },
    piecesInWater: { label: "Severed lobes existing as real objects", better: "higher" },
    tailMarks: { label: "Wound meshes on the bitten shark's tail", better: "higher" },
    kinMarks: { label: "Wound meshes a SAME-SPECIES bite leaves behind", better: "higher" },
    kinBitesBilled: { label: "..and how many of those bites the pod code let through", better: "higher" },
    directSeatWorks: { label: "Control: can the wound code seat ANYTHING on this body right now" },
    marksSurvivingCull: { label: "Wounds still there after the rig is culled and restored", better: "higher" },
    marksLostToCull: { label: "Wounds deleted by the leak sweep (healed by housekeeping)", better: "lower" },
    tailRegrewPct: { label: "How much of the bitten-off tail grew back during the cull", unit: "%", better: "lower" },
    bleeders: { label: "Bitten animals still bleeding from a wound", better: "higher" },
    landPuckerRatioPct: { label: "Land regression: relief over footprint on a bitten land animal", unit: "%", better: "lower" },
    landWoundVsBodyPct: { label: "Land regression: wound footprint as a share of that animal's length", unit: "%" },
    landSeaPuffs: { label: "Land regression: sea-clamped blood puffs spawned by a DRY bite", better: "lower" },
  },
  metricsNote: "puckerRatioPct is the whole shape argument: a solid of revolution 0.9 m across standing 0.3 m proud reads as a lump of playdough stuck to the animal, and a slit whose relief is a ninth of its width reads as a cut. piecesInWater counts meshes tagged `_cbzPiece`, which the BEFORE build never creates — a zero there is the finding (the severed lobe existed nowhere at all), not a measurement failure. woundLengthM carries NO direction on purpose: once the relief is a hundredth of the footprint the wound is a cut, and whether that cut is 0.7 m or 1.9 m long is a tuning question, not the fix — declaring 'higher is better' there would have scored the surface-fitting pass (which trims a rake until its tips stop hanging off a curving flank) as a regression. marksLostToCull and tailRegrewPct are the healing bug measured directly: the old per-frame leak sweep answered 'this rig left the scene' by calling the wound RESTORE path, so a rig that was culled for two seconds came back with its fin regrown and its cuts gone.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.creatureBiteChunk && CBZ.marineHurt && CBZ.cityWildlifeSpawnAt && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkBiteCut,
};
