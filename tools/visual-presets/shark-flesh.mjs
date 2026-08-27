/* Shark Sim, before/after — WHAT A MOUTH LEAVES BEHIND.

   HARNESS TRAP (see D.step below): in this engine every gore and wound emitter
   distance-gates on CBZ.camera, gore emits at onAlways(8) and camera.js owns
   the lens at onAlways(50) — so inside ONE CBZ.stepSim the emitters read the
   camera the PREVIOUS step left behind. Any preset that stages an effect which
   is emitted from inside stepSim must re-stamp its tripod AFTER each step, not
   before. Set it before and the camera updater overwrites it in the same tick;
   the effect is then emitted from wherever the game's own lens was and quietly
   refused by the distance gate, which is indistinguishable from a broken
   feature. Cost me two full capture runs. A `ba` adapter that offered a
   "hold this camera across N sim steps" helper would remove this for good.


   Owner, 2026-08-25, playing Shark Sim:
     "when i bite someone it puts a red square where i bit them, and when i bit
      a person it dosnt look like im biting them, ripping limbs off etc... the
      blood clouds in water are great but they float like a mist over the
      water — blood is never a mist lol... the blood trail is so so well done,
      one of the best things."

   Three separate failures, one frame apart, and every one of them turned out
   to be a wiring or a geometry bug rather than a missing feature:

     1. THE RED SQUARE is gore.js's stump cap: `new THREE.Mesh(G_GIB,
        lambert(BLOOD_D))` — a BoxGeometry(1,1,1) scaled to 36 x 15 x 36 cm,
        axis-aligned in the rig's frame, untextured, and (because this
        renderer runs outputEncoding = sRGBEncoding with r128's colour
        management off) leaving the pipe near #a5 rather than the dark maroon
        of its swatch. A bright red slab where a leg used to be. Its animal
        cousin is wounds.js's cut face: three nested jittered BOXES, whose own
        comment admits the jitter exists "so the three [don't] read as nested
        squares".

     2. IT DOESN'T LOOK LIKE A BITE because the bite mark is not stamped where
        the mouth closed. creature_combat.js's biteWound throws away the real
        clamped contact point and passes `target.pos.y + 1.0`, and wounds.js's
        pickPart splits torso from legs at local y > 1.02 — so EVERY shark
        bite on a person landed on an upper-leg panel no matter where the jaw
        was. Limbs came off only for a megalodon (a static species-scale test
        that Shark Sim's continuous growth never raises), and gore.js's
        restore-on-reuse audit then grew the leg back within 0.85 s because it
        restores any severed actor that is still ALIVE. And a shark kill on a
        survivor drew no death gore at all: trauma.js's cause table has no row
        matching "eaten by a ...", so profile() returned null and the whole
        event was skipped.

     3. THE MIST OVER THE WATER is gore.js's aerosol, which has no water
        awareness whatsoever. creature_combat.js's biteBlood fires goreImpact
        with mist:true at the JAW on every shark lunge, and a jaw above the
        swell — or anywhere in the shore shallows, where woundInWater's
        SWIMMABLE test refuses water under 1.2 m — takes the air branch and
        launches camera-facing quads UPWARD over the sea. The plume underneath
        made it worse: updatePuffs clamps a puff's CENTRE to 5 cm under the
        surface while the sprite it draws is metres across and still growing,
        so half of every good underwater cloud was always drawn in the air.

   BOTH COLUMNS RUN THIS SAME DRIVER. BEFORE is pristine HEAD served on its
   own port; AFTER is the working tree. The island, the seed, the victim, the
   bite geometry, the sim steps and the cameras are identical between them —
   the only variable is the code underneath. Every number at the bottom is
   read by THIS file out of the live scene graph, so both sides are measured
   by one ruler rather than by each build's own audit. */

const subjects = [
  {
    id: "the-bite", ch: 0,
    label: "The Bite — Nothing Happens",
    focus:
      "A bull shark takes a wader in thigh-deep water, photographed at the instant of contact. BEFORE: the killfeed says EATEN BY A BULL SHARK and the body is untouched — no wound where the mouth was, every limb still on, not one drop of blood in the sea. trauma.js has no cause row matching \"eaten by a ...\", so the entire death-gore event was skipped, and the jaw print that did get stamped was stamped at the navel because creature_combat passed target.pos.y + 1.0. AFTER: the mark lands on the part the teeth closed on, the body leaves with less of itself, and the water goes red.",
  },
  {
    id: "mist-over-the-sea", ch: 1,
    label: "Blood Is Never A Mist — The Lens On The Waterline",
    focus:
      "An orca mauled just under the surface, from a lens one metre above the swell looking flat across it. This is the frame the complaint was written about. BEFORE: the top half of every blood cloud is drawn in the AIR — updatePuffs clamps a puff's CENTRE to 5 cm under the surface while the sprite is metres across and still growing — so the plume the owner likes underwater reads as pink fog lying on the sea. AFTER: the lid clamps the whole quad, what reaches the surface flattens into a slick, and the air above the waterline is empty.",
  },
  {
    id: "bite-strip", ch: 2, strip: { frames: 5, stepSec: 0.4 },
    label: "Two Seconds Of It — Strike, Bloom, Trail",
    focus:
      "Five frames of the same two seconds from the same waterline lens. The blood trail is the thing the owner already loves and the thing this pass must not break: it should still billow, still fold, still drift with the current and still follow the wounded body — while not one puff of it crosses the waterline.",
  },
  {
    id: "deep-kill", ch: 3,
    label: "The Kill Cloud, From A Boat's Eye",
    focus:
      "The orca dies. BEFORE: gore.js's kill cloud seeds its shell on a sphere of the body's own scale — up to 2.2 m of that is spawned ABOVE the water, and the lid then pins each sprite's centre just under the surface with metres of it standing proud, which from up here is a pink cloud hovering over the swell. AFTER: the cloud is under the water where a cloud belongs, reddest at the wound and going brown with depth, and the only thing visible from above is the slick spreading over it.",
  },
  {
    id: "orca-crater", ch: 4,
    label: "The Red Square, Animal Half — A Hole, Not A Plate",
    focus:
      "Close on the flank. BEFORE: the cut face is three nested BoxGeometry slabs whose ±0.15 corner jitter never breaks a rectangle, so a bite reads as a red plate lying on the animal. AFTER: a torn crater — a ragged outline, a bore that goes in, and a raw margin around it.",
  },
  {
    id: "red-square", ch: 5,
    label: "The Red Square, Human Half — A Stump, Close",
    focus:
      "Exactly the same amputation on both sides: one CBZ.goreSever call on the same leg of the same body, on dry sand so nothing about the water can be blamed for the read. BEFORE: an axis-aligned untextured 36 x 15 x 36 cm BoxGeometry that leaves this renderer's sRGB encoder bright red — the owner's red square, literally. AFTER: a torn cross-section with a ragged silhouette, a dark bore and bone in the middle.",
  },
  {
    id: "grows-back", ch: 6,
    label: "And A Second And A Half Later",
    focus:
      "Same camera, same body, 1.4 seconds on. BEFORE: the leg is back. gore.js's restore-on-reuse audit runs every 0.85 s and restores any severed actor that is still ALIVE, so surviving a shark attack quietly undid the amputation. AFTER: the audit still guarantees a recycled rig leaves whole — that is what it is for — but a living amputee stays an amputee.",
  },
];

async function stageSharkFlesh(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv || !CBZ.goreSever) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkFlesh;
  if (!D) {
    D = window.__sharkFlesh = {
      chapter: -1, waterline: 0, pinned: [], victim: null, spot: null,
      jaw: null, deep: null, orca: null, orcaAt: null, mauled: 0, shot: null,

      /* Anything staged has to stay staged. The sim keeps running between the
         bite and the capture — that is how the plume evolves — and a shark
         that swims on takes the geometry of the shot with it. Re-written on
         both sides of every tick so no system gets the last word. */
      hold() {
        for (let i = 0; i < D.pinned.length; i++) {
          const p = D.pinned[i], a = p.a;
          if (!a) continue;
          if (a.pos) { a.pos.x = p.x; a.pos.y = p.y; a.pos.z = p.z; }
          if (a.group && a.group.position !== a.pos) a.group.position.set(p.x, p.y, p.z);
          if (p.h != null) {
            if (a.heading != null || a.species) a.heading = p.h;
            if (a.species && a.group && CBZ.faceAnimalHeading) {
              try { CBZ.faceAnimalHeading(a.group, p.h); } catch (e) {}
            } else if (a.group) a.group.rotation.y = p.h;
          }
          if (a._waterMove) { a._waterMove.x = p.x; a._waterMove.z = p.z; }
          if (a.target && a.target.set) a.target.set(p.x, 0, p.z);
          if (a.pause != null) a.pause = 99;
          if (a.group) a.group.updateMatrixWorld(true);
        }
      },
      pin(a, x, y, z, h) { D.pinned.push({ a: a, x: x, y: y, z: z, h: h }); D.hold(); },
      unpin(a) {
        for (let i = D.pinned.length - 1; i >= 0; i--) if (D.pinned[i].a === a) D.pinned.splice(i, 1);
      },
      /* HARNESS TRAP: a staged emitter reads the camera the PREVIOUS tick left.
         THE LENS HAS TO BE RIGHT *DURING* THE STEP, NOT AFTER IT. Every gore
         and wound emitter in this game distance-gates on CBZ.camera, and
         camera.js owns the lens at onAlways(50) while gore.js emits at
         onAlways(8) — so within one stepSim the emitters read the camera the
         PREVIOUS step left behind. Set the tripod before a step and the camera
         updater overwrites it; set it after, and the next step's emitters see
         it. Measured: without this, a staged bite three metres from the tripod
         was emitted with the camera 53 m away and 29 m up, and wounds.js
         refused it as "bite:too-far" — a staging bug that reads exactly like a
         broken feature. */
      step(n) { for (let i = 0; i < n; i++) { D.hold(); CBZ.stepSim(1 / 30); D.hold(); D.reshoot(); } },
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
           capture, and the already-queued callback has to be DRAINED in a
           frame we control — left alive it re-stamps the camera at some
           arbitrary later compositor tick. (shark-sim.mjs paid for this.) */
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

      // ---- the island's own oracles, asked rather than assumed --------------
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      depth(x, z) { return CBZ.cityWaterDepthAt ? Math.max(0, CBZ.cityWaterDepthAt(x, z)) : 0; },
      wet(x, z) { return CBZ.cityWaterAt ? !!CBZ.cityWaterAt(x, z) : false; },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      playerAngle() {
        const A = CBZ.surv.arena, P = CBZ.player;
        return Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
      },
      /* WHERE THE WATER IS THE DEPTH I ASKED FOR. marine-gore.mjs learned this
         the expensive way: stage over the island's shelf and the whole medium
         chain answers "air", the build correctly declines to put blood in the
         sea, and the frame comes back bloodless with nothing wrong with it.
         So the spot is SEARCHED for against the game's own water oracle, and
         a chapter refuses to stage rather than photograph a lie. */
      findWater(ang, dMin, dMax) {
        for (let r = Math.max(4, D.waterline - 14); r < D.waterline + 190; r += 2.5) {
          const p = D.ringPoint(ang, r);
          if (!D.wet(p.x, p.z)) continue;
          const d = D.depth(p.x, p.z);
          if (d >= dMin && d <= dMax) return { x: p.x, z: p.z, depth: d, r: r };
        }
        return null;
      },
      water(dMin, dMax) {
        const a0 = D.playerAngle();
        for (const off of [0, 0.7, -0.7, 1.5, -1.5, 2.4, -2.4, 3.14]) {
          const f = D.findWater(a0 + off, dMin, dMax);
          if (f) { f.ang = a0 + off; return f; }
        }
        return null;
      },

      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      // re-aim the last tripod; every chapter calls this AFTER its final step
      // because stepping is what re-stamps the chase camera over ours.
      reshoot() { const s = D.shot; if (s) D.tripod(s[0], s[1], s[2], s[3], s[4], s[5]); },
      shoot(px, py, pz, tx, ty, tz) { D.shot = [px, py, pz, tx, ty, tz]; D.tripod(px, py, pz, tx, ty, tz); },

      /* Everything that is not this experiment goes away. A converging pod or
         a second wader wandering into frame would bite on its own timing and
         the two columns would stop being the same photograph. */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a === D.orca) continue;
          a.pos.x += 900; a.hunger = 0;
          if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 900;
        }
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      // the crowd, minus the one person this run is about
      clearCrowd(keep) {
        const bots = CBZ.bots || [];
        for (let i = 0; i < bots.length; i++) {
          const b = bots[i];
          if (!b || b === keep) continue;
          b.pos.x += 700; b.pause = 99;
          if (b.target && b.target.set) b.target.set(b.pos.x, 0, b.pos.z);
        }
      },
      // dry sand: walk INLAND off the waterline until the water oracle says no
      dryBeach(ang) {
        for (let r = D.waterline - 3; r > Math.max(6, D.waterline - 40); r -= 1.5) {
          const p = D.ringPoint(ang, r);
          if (!D.wet(p.x, p.z)) return { x: p.x, z: p.z, r: r };
        }
        const p = D.ringPoint(ang, Math.max(6, D.waterline - 14));
        return { x: p.x, z: p.z, r: Math.max(6, D.waterline - 14) };
      },
      liveBot() {
        const bots = CBZ.bots || [];
        for (let i = 0; i < bots.length; i++) if (bots[i] && !bots[i].dead) return bots[i];
        return null;
      },
      /* THE VICTIM. One survivor, stood in water of a chosen depth, pinned and
         with its wander clock parked so it is standing in the same place on
         both sides at the same sim second. */
      stageVictim(spot) {
        const b = D.liveBot(); if (!b) return null;
        D.clearCrowd(b);
        const gy = CBZ.surv.floorAt ? CBZ.surv.floorAt(spot.x, spot.z) : 0;
        b.hp = 100; b.dead = false; b.state = "wander"; b.speed = 0;
        D.pin(b, spot.x, gy, spot.z, spot.ang + Math.PI);
        D.step(2);
        return b;
      },

      /* HOW FAR AHEAD OF ITS OWN ORIGIN THIS MOUTH IS. Asked of the live rig
         rather than assumed, because Shark Sim's whole progression is the body
         growing — a bull shark's jaw and a megalodon's jaw are not the same
         standoff, and creature_combat's own selection measures from the mouth. */
      jawAhead(a) {
        const p = D.jawPoint(a);
        if (!p || !a.group) return 1.4;
        return Math.hypot(p.x - a.group.position.x, p.z - a.group.position.z);
      },
      halfSpan(v) {
        if (!v || !v.group) return 0.35;
        v.group.updateMatrixWorld(true);
        const s = new T.Box3().setFromObject(v.group).getSize(new T.Vector3());
        return Math.max(0.2, Math.hypot(s.x, s.z) * 0.5);
      },
      /* THE APPROACH, held every tick. Straight out of bite-angles.mjs, which
         solved this first: the ride's heading is NOT the animal's `heading`
         field — inBiteFront tests `ride.head`, which lives in a closure and is
         published only through CBZ.cityMountedHeading. Setting the actor's
         heading and pinning the group (what this preset tried first) turned
         the body and left the mouth's own front test pointing wherever the
         player last swam, so every staged bite selected no target at all and
         the swing played out on empty water. */
      holdShark(x, y, z, h) {
        const a = CBZ.sharkSim.shark, P = CBZ.player;
        if (!a) return;
        if (a.hp <= 1) { a.hp = a.maxHp || 100; a.dead = false; }
        a.pos.x = x; a.pos.z = z; if (y != null) a.pos.y = y;
        if (a.group) a.group.position.set(x, a.group.position.y, z);
        if (a._waterMove) { a._waterMove.x = x; a._waterMove.z = z; }
        P.pos.x = x; P.pos.z = z; if (y != null) P.pos.y = y;
        if (CBZ.cityMountedHeading) { try { CBZ.cityMountedHeading(h); } catch (e) {} }
      },

      /* THE STRIKE, through the production trigger. The shark is parked at the
         standoff its own mouth needs, nose on the victim, and then the real
         auto-bite is pulled — the same call shark_sim.js makes every 0.12 s —
         so everything downstream (the angle contest, creatureBiteWound,
         surv.hurt, the meal ledger) runs exactly as it does in play. Held on
         both sides of every tick so the contact geometry is identical in both
         columns, and released the moment a bite lands. The standoff is SWEPT
         rather than guessed: selectBiteTarget is a distance AND a front test
         against a box clamp, and one hardcoded number that works on a bull
         shark misses on a megalodon. */
      strike(victim) {
        const a = CBZ.sharkSim.shark, P = CBZ.player;
        if (!a || !victim || !victim.group) return false;
        const diag = { tries: [] };
        D.diag = diag;
        // the shark comes in from the deep side: outward on the arena ring is
        // seaward, so it approaches the shore and the mouth faces inland.
        const ang = (D.spot && D.spot.ang != null)
          ? D.spot.ang
          : Math.atan2(victim.pos.z - CBZ.surv.arena.center.z, victim.pos.x - CBZ.surv.arena.center.x);
        const ox = Math.cos(ang), oz = Math.sin(ang);
        const h = Math.atan2(-oz, -ox);                    // pointing back inland
        const base = D.halfSpan(victim) + D.jawAhead(a);
        const before = D.hits();
        /* NOT GATED ON cityAquaticBiteProbe. That getter returns null while an
           attack or its cooldown is in flight, and shark_sim.js pulls the
           auto-bite every 0.12 s of its own accord — so on a live match the
           probe reads null almost always, whether or not there is a wader
           standing in front of the mouth. The honest test is the audit's
           landed-hit counter. */
        for (const k of [0.55, 0.85, 0.25, 1.25, 1.75, 2.5]) {
          const R = base + k;
          const sx = victim.pos.x + ox * R, sz = victim.pos.z + oz * R;
          const sy = D.seaY(sx, sz) - 0.5;
          for (let i = 0; i < 45; i++) {
            D.holdShark(sx, sy, sz, h);
            D.hold();
            if (CBZ.cityMountedAnimalAttack) { try { CBZ.cityMountedAnimalAttack(true); } catch (e) {} }
            CBZ.stepSim(1 / 30);
            D.holdShark(sx, sy, sz, h);
            D.hold();
            D.reshoot();          // see step(): the lens must be right for the NEXT tick's emitters
            if (D.hits() > before) {
              D.jaw = D.jawPoint(a);
              diag.hitAt = Number(R.toFixed(2));
              /* WHERE THE LENS WAS AT THE MOMENT OF CONTACT. Every wound and
                 gore emitter in this game distance-gates on CBZ.camera, and a
                 refusal reads identically to "the feature is broken" — so the
                 distance is recorded rather than assumed. */
              const cm = CBZ.camera && CBZ.camera.position;
              if (cm) {
                diag.cam = [+cm.x.toFixed(1), +cm.y.toFixed(1), +cm.z.toFixed(1)];
                diag.camToVictim = +Math.hypot(cm.x - victim.pos.x, cm.z - victim.pos.z).toFixed(2);
                diag.camToJaw = D.jaw ? +Math.hypot(cm.x - D.jaw.x, cm.z - D.jaw.z).toFixed(2) : null;
              }
              diag.woundAudit = (typeof CBZ.woundDecalAudit === "function") ? CBZ.woundDecalAudit() : null;
              if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-Math.cos(h), -Math.sin(h)); CBZ.cam.pitch = 0.05; }
              return true;
            }
          }
          diag.tries.push(D.geomProbe(a, victim, R, h));
        }
        return false;
      },
      /* WHY A STANDOFF MISSED, in the game's own terms: where the mouth is,
         where the nearest point of the victim's box is from it, and the two
         tests selectBiteTarget actually runs (a reach and a forward cone off
         ride.head, not off the animal's heading field). */
      geomProbe(a, victim, R, h) {
        const j = D.jawPoint(a);
        victim.group.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(victim.group);
        const cp = box.clampPoint(new T.Vector3(j.x, j.y, j.z), new T.Vector3());
        const d = cp.distanceTo(new T.Vector3(j.x, j.y, j.z));
        const dx = cp.x - j.x, dz = cp.z - j.z, dl = Math.hypot(dx, dz) || 1;
        const head = (typeof CBZ.cityMountedHeading === "function") ? CBZ.cityMountedHeading() : h;
        return {
          R: Number(R.toFixed(2)),
          gap: Number(d.toFixed(2)),
          fwd: Number(((dx * Math.cos(head) + dz * Math.sin(head)) / dl).toFixed(3)),
          head: Number(head.toFixed(2)), want: Number(h.toFixed(2)),
          jawY: Number(j.y.toFixed(2)), boxY: Number(box.max.y.toFixed(2)),
          hits: D.hits(),
        };
      },
      hits() {
        if (typeof CBZ.aquaticMountAudit !== "function") return 0;
        try { return CBZ.aquaticMountAudit().hits || 0; } catch (e) { return 0; }
      },
      /* THE MOUTH, IN WORLD. creatureJawPoint answers in the rig's OWN frame —
         wildlife_tame's jawWorld multiplies it through group.matrixWorld and
         this file has to do the same. Read as-is it comes back around (1, 0.8,
         0), which subtracted from a world position 500 m from the origin makes
         a 535 m standoff and a shark staged half a kilometre out to sea. */
      jawPoint(a) {
        if (!a) return null;
        if (a.group && typeof CBZ.creatureJawPoint === "function") {
          try {
            const p = CBZ.creatureJawPoint(a);
            if (p && isFinite(p.x)) {
              a.group.updateMatrixWorld(true);
              const v = new T.Vector3(p.x, p.y, p.z).applyMatrix4(a.group.matrixWorld);
              return { x: v.x, y: v.y, z: v.z };
            }
          } catch (e) {}
        }
        return a.pos ? { x: a.pos.x, y: a.pos.y, z: a.pos.z } : null;
      },

      /* THE ORCA, and why the plume chapters need one. A shark bite on a
         PERSON draws no blood at all on HEAD — trauma.js has no cause row for
         "eaten by a ...", so the whole death-gore event is skipped — which is
         its own finding and its own chapter. The plume the owner is
         complaining about is the one wildlife makes of wildlife: creature
         bites open a bloom and a chum trail, and THAT is the cloud that stands
         half out of the water. So the waterline chapters stage the fight that
         actually produces it. Held just under the surface on purpose: a plume
         rises 1-2 m over its life, so a wound 5 m down never reaches the lid
         and the bug never photographs. */
      stageOrca() {
        const spot = D.water(9, 90);
        if (!spot) return null;
        D.deep = spot;
        let o = null;
        for (const a of CBZ.cityWildlife || []) {
          if (a && !a.dead && !a.external && !a.ridden && a.species && a.species.id === "orca") { o = a; break; }
        }
        if (!o && CBZ.cityWildlifeSpawnAt) o = CBZ.cityWildlifeSpawnAt("orca", spot.x, spot.z);
        if (!o) return null;
        o.hunger = 0; o.hp = o.maxHp || o.hp;
        D.orca = o;
        const sy = D.seaY(spot.x, spot.z);
        D.orcaAt = { x: spot.x, y: sy - 1.5, z: spot.z, sy: sy, ang: spot.ang, h: spot.ang + Math.PI * 0.5 };
        D.pin(o, D.orcaAt.x, D.orcaAt.y, D.orcaAt.z, D.orcaAt.h);
        D.step(3);
        return o;
      },
      /* THE BITES, at real flank points measured off the animal's own world
         box, with the jaw a player shark actually carries. The lens has to be
         on the wound FIRST: every gore emitter in this game distance-gates
         itself and creatureBiteChunk refuses outside a 45 m band on both
         sides. */
      maulOrca(n) {
        const o = D.orca; if (!o) return 0;
        o.group.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(o.group);
        const c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
        const h = (o.heading != null) ? o.heading : D.orcaAt.h;
        const fx = Math.cos(h), fz = Math.sin(h);
        const nx = -fz, nz = fx;
        const L = Math.max(s.x, s.z), beam = Math.min(s.x, s.z);
        const camx = CBZ.camera ? CBZ.camera.position.x : c.x;
        const camz = CBZ.camera ? CBZ.camera.position.z : c.z + 10;
        const side = ((camx - c.x) * nx + (camz - c.z) * nz) >= 0 ? 1 : -1;
        let hits = 0;
        for (let i = 0; i < n; i++) {
          const along = -L * (0.14 + (D.mauled + i) * 0.09);
          const px = c.x + fx * along + nx * side * beam * 0.42;
          const pz = c.z + fz * along + nz * side * beam * 0.42;
          const py = c.y - (0.05 + ((D.mauled + i) % 2) * 0.10) * s.y;
          try {
            if (CBZ.creatureBiteChunk(o, { x: px, y: py, z: pz }, { jaw: 0.95, sev: 0.85, bleedS: 16 })) hits++;
          } catch (e) {}
          o.group.updateMatrixWorld(true);
        }
        D.mauled += n;
        return hits;
      },
      orcaBox() {
        const o = D.orca; if (!o) return null;
        o.group.updateMatrixWorld(true);
        const b = new T.Box3().setFromObject(o.group);
        return { c: b.getCenter(new T.Vector3()), s: b.getSize(new T.Vector3()) };
      },

      /* ---- THE RULERS -----------------------------------------------------
         Every one of these reads the live scene graph by a signature that
         exists on BOTH sides, never by a flag or a tag only the new build
         carries. That is the whole point: one instrument, two builds. */

      /* Blood drawn in the AIR over the sea. Two populations, both of them
         camera-facing, both of them the owner's complaint:
           - gore.js's aerosol: a Mesh on the shared unit PlaneGeometry with
             renderOrder 5, a feathered map, transparent and depthWrite off.
           - gore.js's plume: pooled Sprites, also renderOrder 5.
         The measurement is the TOP of the quad, not its centre, because the
         bug being measured is precisely that the old lid clamped the centre
         while metres of sprite stood above the waterline. The blood texture is
         feathered, so ~0.42 of the scale is the visible half-extent. */
      airBlood(x, z, r) {
        let n = 0, worst = 0, aerosol = 0;
        const r2 = r * r;
        CBZ.scene.traverse(function (o) {
          if (o.visible === false) return;
          const isPuff = !!o.isSprite && o.renderOrder === 5;
          const isMist = !!o.isMesh && o.renderOrder === 5 && o.geometry &&
            o.geometry.type === "PlaneGeometry" && o.material && o.material.transparent &&
            o.material.depthWrite === false && !!o.material.map;
          if (!isPuff && !isMist) return;
          const p = o.position;
          const dx = p.x - x, dz = p.z - z;
          if (dx * dx + dz * dz > r2) return;
          if (isMist) aerosol++;
          const half = 0.42 * Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y));
          const above = (p.y + half) - D.seaY(p.x, p.z);
          if (above > 0.05) { n++; if (above > worst) worst = above; }
        });
        return { n: n, worst: worst, aerosol: aerosol };
      },
      // the good stuff: plume sprites that are entirely UNDER the surface
      plumeIn(x, z, r) {
        let n = 0;
        const r2 = r * r;
        CBZ.scene.traverse(function (o) {
          if (!o.isSprite || o.visible === false || o.renderOrder !== 5) return;
          const p = o.position;
          const dx = p.x - x, dz = p.z - z;
          if (dx * dx + dz * dz > r2) return;
          if (p.y + 0.42 * Math.abs(o.scale.y) <= D.seaY(p.x, p.z) + 0.05) n++;
        });
        return n;
      },
      // gore.js seats a water splat flat on the live surface; that is its
      // signature from outside — a horizontal unlit decal at sea level.
      slicksNear(x, z, r) {
        let n = 0;
        const r2 = r * r, sy = D.seaY(x, z);
        CBZ.scene.traverse(function (o) {
          if (!o.isMesh || o.isSprite || !o.geometry) return;
          if (Math.abs(o.position.y - sy) > 0.6) return;
          if (Math.abs(o.rotation.x + Math.PI / 2) > 0.01) return;
          const dx = o.position.x - x, dz = o.position.z - z;
          if (dx * dx + dz * dz <= r2) n++;
        });
        return n;
      },
      /* Wound decals on a humanoid. wounds.js seats every one of them as a
         polygon-offset unlit decal parented into the struck body PART, which
         is a signature both builds share (the offset is what keeps a decal off
         the skin it lies on; no build can drop it). Their centroid answers the
         only question that matters here: did the mark land where the mouth
         was, or at the navel-projected default? */
      marks(actor) {
        const g = actor && actor.group;
        const out = { n: 0, cx: 0, cy: 0, cz: 0 };
        if (!g) return out;
        g.updateMatrixWorld(true);
        const v = new T.Vector3();
        g.traverse(function (o) {
          if (!o.isMesh || !o.material || !o.material.polygonOffset) return;
          out.n++;
          v.setFromMatrixPosition(o.matrixWorld);
          out.cx += v.x; out.cy += v.y; out.cz += v.z;
        });
        if (out.n) { out.cx /= out.n; out.cy /= out.n; out.cz /= out.n; }
        return out;
      },
      // how far the jaw print sits from the point the jaw was actually at
      markToJaw(actor) {
        const m = D.marks(actor);
        if (!m.n || !D.jaw) return null;
        return Math.sqrt((m.cx - D.jaw.x) ** 2 + (m.cy - D.jaw.y) ** 2 + (m.cz - D.jaw.z) ** 2);
      },
      /* THE RED SQUARE, measured rather than described. severBody parents its
         stump cap straight onto the rig, so the honest both-sides test is a
         DIFF: snapshot the rig's meshes, sever, and look at what appeared.
         BoxGeometry is the failing answer; how many of its silhouette's
         distinct rim radii it has is the passing one. */
      rigMeshes(actor) {
        const s = [];
        const g = actor && actor.group; if (!g) return s;
        g.traverse(function (o) { if (o.isMesh) s.push(o); });
        return s;
      },
      newMeshes(actor, before) {
        const now = D.rigMeshes(actor), out = [];
        for (let i = 0; i < now.length; i++) if (before.indexOf(now[i]) < 0) out.push(now[i]);
        return out;
      },
      limbsOff() {
        if (typeof CBZ.goreAudit !== "function") return 0;
        try { return CBZ.goreAudit().severed || 0; } catch (e) { return 0; }
      },
      // the animal wound: wounds.js tags every cut face `_tornCap` on both
      // sides, so a BoxGeometry among them IS the plate the owner photographed
      capShapes(actor) {
        const out = { n: 0, boxes: 0, span: 0 };
        const g = actor && actor.group; if (!g) return out;
        g.updateMatrixWorld(true);
        g.traverse(function (o) {
          if (!o.isMesh || !o._tornCap) return;
          out.n++;
          if (o.geometry && o.geometry.type === "BoxGeometry") out.boxes++;
          const e = o.matrixWorld.elements;
          const a = Math.hypot(e[0], e[1], e[2]), b = Math.hypot(e[4], e[5], e[6]);
          const s = Math.max(a, b);
          if (s > out.span) out.span = s;
        });
        return out;
      },
      goreBits() {
        if (typeof CBZ.goreAudit !== "function") return 0;
        try { const a = CBZ.goreAudit(); return (a.bits || 0) + (a.puffs || 0) + (a.pools || 0) + (a.slicks || 0); } catch (e) { return 0; }
      },
    };

    window.__cbzVisualCompare = {
      /* Awaited before every capture. Under SwiftShader the compositor takes
         over a second to PRESENT a rendered canvas, and a canvas rendered
         outside an animation frame is never presented at all — so render
         inside ONE borrowed real frame (the game's own chain is already dead,
         so lending rAF back for a single callback cannot restart it) and then
         wait the compositor out. */
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
      // film strips advance the real match; the tripod is re-stamped after,
      // because stepping hands the chase camera the lens back.
      advance(sec) { D.sec(sec); D.reshoot(); },
    };
  }

  const out = {};
  const CH = [
    /* 0 — THE BITE. Thigh-deep water on purpose: that is where the beach
       crowd stands, and it is the band gore.js's woundInWater refuses (its
       SWIMMABLE floor is 1.2 m), so a bite here is the one the old code was
       least equipped to draw. */
    async function bite() {
      if (!await D.boot()) throw new Error("sharksim never armed");
      D.peace();
      const spot = D.water(0.7, 1.15);
      if (!spot) throw new Error("no thigh-deep water on this island");
      D.spot = spot;
      const v = D.stageVictim(spot);
      if (!v) throw new Error("no survivor to bite");
      D.victim = v;
      const sy = D.seaY(spot.x, spot.z);
      // the lens goes on the victim BEFORE the teeth do: every gore emitter in
      // this game distance-gates itself, and a detached tripod is what
      // dist2Cam reads.
      D.shoot(spot.x - Math.cos(spot.ang) * 3.4, sy + 1.25, spot.z - Math.sin(spot.ang) * 3.4 + 2.0,
        spot.x, sy + 0.45, spot.z);
      out.biteLanded = D.strike(v) ? 1 : 0;
      if (!out.biteLanded) throw new Error("no bite landed on the wader :: " + JSON.stringify(D.diag));
      out.woundMarksAtContact = D.marks(v).n;
      D.sec(0.35);
      D.reshoot();
      const air = D.airBlood(spot.x, spot.z, 24);
      out.aerosolQuads = air.aerosol;
      out.bloodAboveSeaN = air.n;
      out.bloodAboveSeaM = Number(air.worst.toFixed(2));
      out.plumePuffs = D.plumeIn(spot.x, spot.z, 24);
      out.slicks = D.slicksNear(spot.x, spot.z, 18);
      out.woundMarks = D.marks(v).n;
      /* DELIBERATELY NOT A DECLARED METRIC. It measures the jaw print's
         centroid against CBZ.creatureJawPoint — the mouth's ORIGIN, not the
         clamped contact point on the victim's surface — so a bigger, more
         correct mouth reads as a worse number, and on the after side a severed
         limb takes its own marks out of the centroid. Kept as a debug reading
         because it is useful when the mark lands somewhere absurd; charting it
         as better/worse would be charting a coincidence of geometry. */
      const d = D.markToJaw(v);
      out.woundToJawM = d == null ? null : Number(d.toFixed(2));
      out.limbsOff = D.limbsOff();
      out.goreDrawn = D.goreBits();
      D.medium = {
        depthM: Number(spot.depth.toFixed(2)),
        goreMedium: CBZ.goreMedium && D.jaw ? CBZ.goreMedium(D.jaw.x, D.jaw.y, D.jaw.z) : null,
        seaY: Number(sy.toFixed(2)),
        jawY: D.jaw ? Number(D.jaw.y.toFixed(2)) : null,
        victimDead: !!(D.victim && D.victim.dead),
        woundDecals: (typeof CBZ.woundDecalAudit === "function") ? CBZ.woundDecalAudit() : null,
      };
    },

    /* 1 — THE WATERLINE LENS. The plume the owner is complaining about is the
       one WILDLIFE makes of wildlife: a creature bite opens a bloom and a chum
       trail, and that is the cloud that stands half out of the sea. So this
       chapter stages the fight that actually produces it, held 1.5 m under the
       surface — a plume only rises a metre or two over its life, and a wound
       five metres down never reaches the lid at all. */
    async function waterline() {
      if (!D.stageOrca()) throw new Error("no deep water / no orca to maul");
      const A = D.orcaAt;
      const back = 13;
      // ON the waterline: the lens a metre over the swell, looking flat across
      // it, which is exactly how the owner was looking at the sea when he
      // wrote the note.
      D.shoot(A.x - Math.cos(A.ang) * back, A.sy + 1.0, A.z - Math.sin(A.ang) * back,
        A.x, A.sy + 0.15, A.z);
      out.woundsLanded = D.maulOrca(3);
      if (!out.woundsLanded) throw new Error("no bite landed on the orca");
      D.sec(1.5);
      D.reshoot();
      const air = D.airBlood(A.x, A.z, 34);
      out.aerosolQuads = air.aerosol;
      out.bloodAboveSeaN = air.n;
      out.bloodAboveSeaM = Number(air.worst.toFixed(2));
      out.plumePuffs = D.plumeIn(A.x, A.z, 34);
      out.slicks = D.slicksNear(A.x, A.z, 26);
      D.medium2 = {
        depthM: Number(D.deep.depth.toFixed(1)),
        goreMedium: CBZ.goreMedium ? CBZ.goreMedium(A.x, A.y, A.z) : null,
        chum: (CBZ.goreChumList && CBZ.goreChumList()) ? CBZ.goreChumList().length : null,
      };
    },

    /* 2 — THE STRIP. One more bite so the strip opens on a strike, then the
       runner advances the real match 0.4 s per frame from the same lens. */
    async function strip() {
      const A = D.orcaAt;
      D.reshoot();
      out.woundsLanded = (out.woundsLanded || 0) + D.maulOrca(1);
      D.reshoot();
      const air = D.airBlood(A.x, A.z, 34);
      out.aerosolQuads = air.aerosol;
      out.bloodAboveSeaN = air.n;
      out.bloodAboveSeaM = Number(air.worst.toFixed(2));
      out.plumePuffs = D.plumeIn(A.x, A.z, 34);
      out.slicks = D.slicksNear(A.x, A.z, 26);
    },

    /* 3 — THE KILL, from above the surface. A kill cloud is a volume, so the
       lens pulls back and up: this is the boat's-eye read, where "there is a
       pink cloud floating on the sea" either is or is not true. */
    async function kill() {
      const A = D.orcaAt, o = D.orca;
      D.sec(0.5);
      o.hp = 0; o.dead = true;
      D.sec(1.2);
      D.shoot(A.x - Math.cos(A.ang) * 16, A.sy + 5.2, A.z - Math.sin(A.ang) * 16,
        A.x, A.sy - 0.8, A.z);
      D.sec(0.4);
      D.reshoot();
      const air = D.airBlood(A.x, A.z, 40);
      out.aerosolQuads = air.aerosol;
      out.bloodAboveSeaN = air.n;
      out.bloodAboveSeaM = Number(air.worst.toFixed(2));
      out.plumePuffs = D.plumeIn(A.x, A.z, 40);
      out.slicks = D.slicksNear(A.x, A.z, 30);
    },

    /* 4 — THE CUT FACE, close. Same animal, same wounds, the angle the owner
       photographs from. */
    async function crater() {
      const A = D.orcaAt, b = D.orcaBox();
      if (!b) throw new Error("the orca left");
      const c = b.c, s = b.s;
      const h = (D.orca.heading != null) ? D.orca.heading : A.h;
      const fx = Math.cos(h), fz = Math.sin(h), nx = -fz, nz = fx;
      const L = Math.max(s.x, s.z);
      D.shoot(c.x + nx * 5.6 - fx * L * 0.12, c.y + 0.7, c.z + nz * 5.6 - fz * L * 0.12,
        c.x - fx * L * 0.18, c.y - 0.15, c.z - fz * L * 0.18);
      D.step(2);
      D.reshoot();
      const cap = D.capShapes(D.orca);
      out.capMeshes = cap.n;
      out.boxCutFaces = cap.boxes;
      out.capSpanM = Number(cap.span.toFixed(2));
      out.plumePuffs = D.plumeIn(A.x, A.z, 30);
    },

    /* 5 — THE RED SQUARE, isolated. Not the wiring, the OBJECT: one identical
       CBZ.goreSever on one identical leg of a fresh body on both sides, on dry
       sand so nothing about the water can be blamed for the read. */
    async function square() {
      const ang = D.playerAngle() + 2.1;
      const at = D.dryBeach(ang);
      const b = D.liveBot();
      if (!b) throw new Error("no survivor left to amputate");
      D.clearCrowd(b);
      const gy = CBZ.surv.floorAt ? CBZ.surv.floorAt(at.x, at.z) : 0;
      b.hp = 100; b.dead = false;
      D.unpin(b);
      // faced across the lens so the OUTSIDE of the left leg is the subject
      D.pin(b, at.x, gy, at.z, ang + Math.PI * 0.5);
      D.step(3);
      D.stump = b;
      const before = D.rigMeshes(b);
      try { CBZ.goreSever(b, "ll", { dir: { x: Math.cos(ang), z: Math.sin(ang) } }); } catch (e) {}
      b.group.updateMatrixWorld(true);
      const added = D.newMeshes(b, before);
      let boxes = 0;
      for (let i = 0; i < added.length; i++) {
        const g = added[i].geometry;
        if (g && g.type === "BoxGeometry") boxes++;
      }
      out.stumpMeshes = added.length;
      out.stumpIsBox = boxes;
      out.limbsOff = D.limbsOff();
      /* AIM AT THE THING ITSELF. The stump cap is 15 cm thick and the entire
         argument is what its silhouette does at contact range, so the lens is
         put on the cap's OWN world position after the cut rather than at a
         guessed hip height — the rigs differ in height and a fixed offset
         framed the small of a back on the first run. (goreSever has no
         distance gate, so severing first and aiming after costs nothing.) */
      let sp = null;
      for (let i = 0; i < added.length; i++) {
        if (added[i].parent && added[i].parent !== CBZ.scene) { sp = added[i]; break; }
      }
      const wp = new T.Vector3();
      if (sp) sp.getWorldPosition(wp);
      else { const bx = new T.Box3().setFromObject(b.group); bx.getCenter(wp); }
      const off = ang + Math.PI * 0.5;          // out from the severed side
      D.shoot(wp.x + Math.cos(off) * 2.15, wp.y + 0.62, wp.z + Math.sin(off) * 2.15,
        wp.x, wp.y + 0.02, wp.z);
      D.step(4);
      D.reshoot();
    },

    /* 6 — AND A SECOND AND A HALF LATER. gore.js's severAudit runs on a 0.85 s
       throttle; 1.4 s guarantees at least one pass on both sides. Same lens,
       same body, nothing else touched. */
    async function later() {
      D.sec(1.4);
      D.reshoot();
      out.limbsOffLater = D.limbsOff();
      const b = D.stump;
      out.legStillGone = (b && b.char && b.char.parts && b.char.parts.ll &&
        b.char.parts.ll.visible === false) ? 1 : 0;
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
      state: CBZ.game.state, mode: CBZ.game.mode,
      spot: D.spot || null, medium: D.medium || null, medium2: D.medium2 || null, jaw: D.jaw || null, diag: D.diag || null,
      goreAudit: (typeof CBZ.goreAudit === "function") ? CBZ.goreAudit() : null,
      chumSources: (CBZ.goreChumList && CBZ.goreChumList()) ? CBZ.goreChumList().length : null,
      aquatic: (typeof CBZ.aquaticMountAudit === "function") ? CBZ.aquaticMountAudit() : null,
    },
    metrics: out,
  };
}

export default {
  id: "shark-flesh",
  title: "Shark Sim — A Mouth Leaves A Hole, Not A Sticker",
  description:
    "Seven beats of one shark attack on a person, photographed in Shark Sim on both sides. BEFORE is pristine HEAD; AFTER is the working tree; the island, the seed, the victim, the bite geometry, the sim steps and the cameras are identical between them. Three failures the owner named in one sentence, each traced to a single line: the RED SQUARE is gore.js's stump cap, a BoxGeometry(1,1,1) at 36x15x36 cm that leaves this renderer's sRGB encoder bright red; IT DOESN'T LOOK LIKE A BITE because creature_combat.js stamps the jaw print at target.pos.y + 1.0 (which wounds.js's pickPart resolves to an upper-leg panel, always) while limbs came off for a megalodon only and grew back inside 0.85 s under the restore-on-reuse audit; and the MIST OVER THE WATER is aerosol with no water awareness at all, fired at the jaw on every lunge, over a plume whose surface lid clamped a sprite's centre while metres of it stood above the waterline. After: the mark lands where the mouth closed, the body keeps losing what came off it, and every drop of blood is either in the water or on it.",
  beforeLabel: "BEFORE · pristine HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same wader · same jaw · same sim seconds · same cameras",
  method:
    "Both columns boot index.html into ?mode=sharksim with a pinned seed and click the Shark Sim tile + PLAY exactly like a player. A per-page driver freezes the frame loop (draining the one already-queued rAF callback, or it re-stamps the camera at an arbitrary later tick), empties the pod and the rest of the crowd, stands ONE survivor in water of a searched depth, and pulls the production auto-bite trigger — CBZ.cityMountedAnimalAttack, the same call shark_sim.js makes every 0.12 s — so bite angles, creatureBiteWound, surv.hurt and the meal ledger all run as they do in play. The thigh-deep band is chosen deliberately: gore.js's woundInWater refuses water under 1.2 m, so the shore shallows are exactly where the old code takes the air branch, and that is where the owner was looking. Every number is read by this preset out of the live scene graph by a signature both builds share — camera-facing quads and pooled sprites at renderOrder 5 for blood, polygon-offset unlit decals for wound marks, a before/after mesh DIFF on the rig for the stump cap, the shared _tornCap flag for animal cut faces — so both columns are measured by one instrument.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 360000,
  metrics: {
    bloodAboveSeaM: { label: "Highest blood drawn above the waterline", unit: "m", better: "lower" },
    bloodAboveSeaN: { label: "Blood quads/sprites breaking the surface", better: "lower" },
    aerosolQuads: { label: "Airborne aerosol quads alive over the sea", better: "lower" },
    plumePuffs: { label: "Plume puffs fully IN the water (the good stuff)", better: "higher" },
    slicks: { label: "Blood slicks on the surface", better: "higher" },
    goreDrawn: { label: "Gore drawn by a shark eating a person", better: "higher" },
    woundMarks: { label: "Wound marks on the bitten body", better: "higher" },
    limbsOff: { label: "Body parts actually missing from the victim", better: "higher" },
    limbsOffLater: { label: "..still missing 1.4 s later", better: "higher" },
    legStillGone: { label: "The severed leg is still off the rig", better: "higher" },
    stumpIsBox: { label: "Stump caps that are literally a BoxGeometry", better: "lower" },
    boxCutFaces: { label: "Animal cut faces that are literally a BoxGeometry", better: "lower" },
    capSpanM: { label: "Widest single cut face on the orca", unit: "m", better: "lower" },
  },
  metricsNote:
    "bloodAboveSeaM is the mist complaint as one number: metres of blood drawn in the AIR over the sea. It has to reach zero, and not by removing blood — plumePuffs, the count of cloud that is properly under the water, must hold or rise in the same frame. goreDrawn is the bite complaint as one number: on HEAD a shark eating a person draws literally nothing, because trauma.js has no cause row for it. woundToJawM is the other half — on HEAD it is the distance from the shark's mouth to the victim's thigh, because every bite mark in the game was stamped at pos.y + 1.0. stumpIsBox and boxCutFaces are the red square itself, counted; both must be zero. legStillGone is the amputation that used to grow back inside a second.",
  viewport: { width: 1280, height: 720 },
  readyExpression:
    "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.bots && CBZ.goreSever && CBZ.goreAudit && CBZ.creatureBiteChunk && CBZ.cityMountedAnimalAttack && CBZ.citySeaHeightAt && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkFlesh,
};
