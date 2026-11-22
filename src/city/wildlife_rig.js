/* ============================================================
   city/wildlife_rig.js — THE ANIMAL BODY RIG, SHARED.

   Discovery-based gait for every species build in the bestiary: any tall,
   thin, ground-touching child is a leg; anything stacked on its (x,z) column
   rides along; far-forward off-ground parts are the head. Nothing here is
   new — this is the exact rig wildlife.js discovered and animated since the
   living-wildlife wave, MOVED OUT so a page that is not the full city can
   walk an animal without loading the 3,700-line hunting engine.

   CONSUMERS (the BLOCK LAW's >= 3):
     1. city/wildlife.js        — the hunting engine (unchanged behaviour;
                                  it binds these names one line down its file)
     2. games/battle.html       — beast armies (the `beasts` studio pack)
     3. city/arena_fights.js    — the beast pit, via wildlife.js's animals

   Standalone: needs window.CBZ and THREE geometry parameters only.
   CBZ.creatureStyleFor (creature_combat.js) is read GUARDED — without it
   every species classifies off danger/size alone, exactly as classify()
   always degraded.

   Publishes:
     CBZ.wildlifeRig = { CLASSES, classify, meshDims, buildGait, animateGait,
                         buildSwim, animateSwim, swimJaw }
     CBZ.buildSwimRig / CBZ.animateSwim / CBZ.swimJaw — the AQUATIC rig,
     moved out of the hunting engine for the same reason the gait was
     CBZ.faceAnimalHeading (the +X nose convention, moved with its comment)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // Every species asset is authored nose-forward on local +X. Three.js yaw
  // rotates that axis toward (cos(yaw), -sin(yaw)), so a world heading
  // (cos(h), sin(h)) maps to yaw=-h — there is no quarter-turn offset. Keep
  // this convention public so tame/companion/biome drivers cannot reintroduce
  // the old sideways-slide independently.
  function faceAnimalHeading(actorOrGroup, heading) {
    const group = actorOrGroup && (actorOrGroup.group || actorOrGroup);
    if (group && group.rotation) group.rotation.y = -heading;
  }
  CBZ.faceAnimalHeading = faceAnimalHeading;

  // ============================================================
  //  BEHAVIOR CLASSES — every species maps to ONE class that fixes its gait
  //  read and its temperament numbers. Derived (not hand-listed) so new
  //  species auto-classify: trophic role + size + the creature_combat style.
  //    stepFreq  rad of leg-swing per unit walked (before leg-height scaling)
  //    bob       body bounce amplitude while moving (× scale)
  //    hop       flee-bound hop height (× scale) — cervids/rabbits BOUND
  //    sway      slow roll while walking (bears LUMBER)
  //    grazeP    chance to stop & graze when a wander leg ends
  //    stalker   big cats: long crouched approach, then a burst charge
  // ============================================================
  //  grazeT [lo,hi]s   how long a graze stop lasts
  //  wanderM/fleeM     speed multipliers on sp.spd
  //  fleeT             s of committed flight after the threat is gone
  //  hearR             u — how far away a GUNSHOT spooks/alerts this class
  //  aggro             u — a dangerous animal this close attacks (danger>=0.5)
  //  giveUp            u — a charging animal further than this quits
  //  atkM              charge speed multiplier
  //  stalk/burst/crouch  big cats: creep-in trigger, pounce-charge trigger,
  //                      crouch speed multiplier
  const CLASSES = {
    herd_prey:  { stepFreq: 2.6, stepCap: 15, bob: 0.05, hop: 0.16, sway: 0,    grazeP: 0.60, grazeT: [3, 7],   wanderM: 0.6, fleeM: 2.6, fleeT: 5,   hearR: 45 },
    small_game: { stepFreq: 4.2, stepCap: 22, bob: 0.04, hop: 0.24, sway: 0,    grazeP: 0.50, grazeT: [1.5, 4], wanderM: 0.7, fleeM: 3.0, fleeT: 3.5, hearR: 55 },
    farm:       { stepFreq: 2.4, stepCap: 13, bob: 0.04, hop: 0,    sway: 0.03, grazeP: 0.70, grazeT: [4, 9],   wanderM: 0.4, fleeM: 1.8, fleeT: 3,   hearR: 30 },
    big_neutral:{ stepFreq: 2.0, stepCap: 10, bob: 0.05, hop: 0,    sway: 0.05, grazeP: 0.60, grazeT: [4, 8],   wanderM: 0.5, fleeM: 1.6, fleeT: 2,   hearR: 38, aggro: 16, giveUp: 45, atkM: 2.2 },
    lumberer:   { stepFreq: 2.1, stepCap: 11, bob: 0.07, hop: 0,    sway: 0.10, grazeP: 0.40, grazeT: [4, 8],   wanderM: 0.5, fleeM: 1.8, fleeT: 2,   hearR: 35, aggro: 20, giveUp: 40, atkM: 2.0 },
    stalker:    { stepFreq: 2.8, stepCap: 16, bob: 0.05, hop: 0,    sway: 0,    grazeP: 0.30, grazeT: [3, 6],   wanderM: 0.5, fleeM: 2.0, fleeT: 3,   hearR: 60, aggro: 12, giveUp: 60, atkM: 2.2, stalk: 55, burst: 18, crouch: 0.35 },
    pack:       { stepFreq: 3.2, stepCap: 18, bob: 0.05, hop: 0.08, sway: 0,    grazeP: 0.35, grazeT: [3, 6],   wanderM: 0.6, fleeM: 2.0, fleeT: 3,   hearR: 55, aggro: 30, giveUp: 50, atkM: 2.2 },
  };
  function classify(sp) {
    if (sp._bclass) return sp._bclass;
    let c;
    const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : "bite";
    const danger = sp.danger || 0;
    if (style === "pounce" && danger >= 0.4) c = CLASSES.stalker;
    // gorillas maul like a bear and LUMBER like one — the knuckle-walk is a
    // roll, not a trot, so the ape shares the bear's class, not the wolf's
    else if (style === "maul" && danger >= 0.4) c = /bear|gorilla/.test(sp.id) ? CLASSES.lumberer : CLASSES.pack;
    else if (danger >= 0.5) c = CLASSES.big_neutral;          // boar/bison/rhino/elephant — dangerous PREY
    else if (sp.biome === "farmland") c = CLASSES.farm;       // barnyard ambler (incl. chicken/sheep)
    else if ((sp.scale || 1) <= 0.85) c = CLASSES.small_game; // rabbits, foxes, raccoons, coyotes
    else if ((sp.scale || 1) >= 1.6) c = CLASSES.big_neutral;
    else c = CLASSES.herd_prey;
    sp._bclass = c;
    if (/rabbit|hare/.test(sp.id)) sp._hopAlways = true;     // rabbits bounce even at a stroll
    if (sp.id === "cheetah") sp._stalk = { trig: 70, burst: 26, giveUp: 80, burstT: 6 };  // the sprinter
    return c;
  }

  // ============================================================
  //  GAIT RIG — the species builds are flat groups of unnamed boxes (feet at
  //  y=0, nose +X), so the rig is DISCOVERED, not declared: any tall, thin,
  //  ground-touching child is a leg; anything stacked on the same (x,z)
  //  column (feet, paw pads, the tiger's leg stripes) rides along with it.
  //  Head parts (far-forward, off the ground) are collected for the graze
  //  dip. Everything is cached per ACTOR (groups are per-animal; geometries
  //  are shared and never mutated — only mesh .position moves, exactly the
  //  dogs.js trot pattern).
  // ============================================================
  function meshDims(m) {
    const p = m.geometry && m.geometry.parameters;
    if (p && p.width != null) return { w: Math.max(p.width, p.depth || p.width), h: p.height };
    const bb = m.geometry && (m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox));
    if (!bb) return null;
    return { w: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), h: bb.max.y - bb.min.y };
  }
  function buildGaitRig(a) {
    const sp = a.species, grp = a.group;
    if (sp.snake || sp.aquatic) return;
    const kids = grp.children, cols = [], rest = [];
    let maxX = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m.isMesh) continue;
      const d = meshDims(m); if (!d) continue;
      if (m.position.x > maxX) maxX = m.position.x;
      const bottom = m.position.y - d.h / 2;
      // a LEG: taller than wide, planted at the ground
      if (d.h >= 0.14 && d.h >= d.w * 1.1 && bottom <= 0.16 && bottom >= -0.05) {
        let col = null;
        // a DECLARED leg (beast_kit stamps userData.leg) is one whole limb:
        // it starts its own column, however close the other foot stands
        const decl = m.userData && m.userData.leg;
        for (let c = 0; c < cols.length && !decl; c++) {
          if (Math.abs(cols[c].x - m.position.x) <= 0.14 && Math.abs(cols[c].z - m.position.z) <= 0.14) { col = cols[c]; break; }
        }
        if (!col) { col = { x: m.position.x, z: m.position.z, top: 0, h: d.h, parts: [] }; cols.push(col); }
        col.top = Math.max(col.top, m.position.y + d.h / 2);
        col.h = Math.max(col.h, d.h);
        col.parts.push({ m: m, bx: m.position.x, by: m.position.y, rz: m.rotation.z });
      } else {
        rest.push({ m: m, d: d, bottom: bottom });
      }
    }
    if (cols.length < 2 || cols.length > 8) return;      // no readable legs — glide
    let anyDecl = false;
    for (let c = 0; c < cols.length; c++) if (cols[c].parts[0].m.userData && cols[c].parts[0].m.userData.leg) anyDecl = true;
    // sweep 2: feet / pads / leg stripes stacked on a column ride with it
    const head = [];
    let headMesh = null, headVol = 0;
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i], m = r.m;
      let joined = false;
      // declared limbs are whole: nothing else rides a declared column (a
      // hare's body sits right over its hind feet and would swing with them)
      for (let c = 0; c < cols.length && !anyDecl; c++) {
        const col = cols[c];
        if (Math.abs(col.x - m.position.x) <= 0.13 && Math.abs(col.z - m.position.z) <= 0.13 &&
            m.position.y - r.d.h / 2 < col.top && r.d.h <= col.h * 1.2) {
          col.parts.push({ m: m, bx: m.position.x, by: m.position.y, rz: m.rotation.z });
          joined = true; break;
        }
      }
      // head cluster (for the graze dip): far forward, up off the ground
      if (!joined && maxX > 0.4 && m.position.x >= maxX * 0.55 && r.bottom >= 0.3) {
        head.push({ m: m, bx: m.position.x, by: m.position.y, bottom: r.bottom, rz: m.rotation.z });
        // THE head box (for the aggro eyes): the biggest far-forward block.
        const vol = r.d.w * r.d.w * r.d.h;
        if (m.position.x >= maxX * 0.62 && vol > headVol) { headVol = vol; headMesh = m; }
      }
    }
    // diagonal-gait phase: FL+RR swing together, FR+RL oppose (a trot). Two
    // legs (birds) degrade to left/right alternation via the same XOR.
    let legH = 0;
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      col.diag = (((col.x >= 0) ? 1 : 0) ^ ((col.z >= 0) ? 1 : 0)) ? -1 : 1;
      legH = Math.max(legH, col.h);
    }
    let dip = 0;
    if (head.length) {
      dip = Infinity;
      for (let i = 0; i < head.length; i++) dip = Math.min(dip, head[i].bottom);
      dip = Math.max(0, Math.min(1.1, dip * 0.7));
    }
    /* A DECLARED NECK ROOT (city/wildlife/beast_kit.js stamps userData.pivot
       on a grazer's neck): the graze then ROTATES the whole head cluster down
       about the withers, the way a neck actually lowers, instead of sliding
       the head off the shoulders. The angle is solved once, here: the one
       that brings the lowest head point to ~10 cm off the grass. */
    // a body that declares its eyes declares which mesh IS the head (a long
    // neck can out-bulk it, which is all the volume test below can see)
    for (let i = 0; i < head.length; i++) { const ud = head[i].m.userData; if (ud && ud.eyes) { headMesh = head[i].m; break; } }
    let pivot = null, grazeA = 0;
    for (let i = 0; i < head.length; i++) { const pv = head[i].m.userData && head[i].m.userData.pivot; if (pv) { pivot = pv; break; } }
    if (pivot && headMesh) {
      const hb = headMesh.geometry.boundingBox || (headMesh.geometry.computeBoundingBox(), headMesh.geometry.boundingBox);
      const tx = headMesh.position.x + hb.max.x - pivot[0], ty = headMesh.position.y + hb.min.y - pivot[1];
      // the lowest the muzzle can go, never past ~63 degrees (the rest of a
      // real graze is splayed forelegs, which a rigid leg cannot do)
      let best = 1e9;
      for (let k = 1; k <= 22; k++) {
        const an = k * 0.05, y = pivot[1] + tx * Math.sin(-an) + ty * Math.cos(-an);
        if (y < best) { best = y; grazeA = an; }
        if (y <= 0.1) break;
      }
    } else pivot = null;
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      // the swing hinges at the top of the leg (the hip / shoulder inside the
      // body), so a stride ROTATES the leg instead of sliding it flat
      col.len = Math.max(0.1, col.top * 0.9);
    }
    const cls = classify(sp);
    a.gait = {
      cols: cols, head: head.length ? head : null, dip: dip, headMesh: headMesh, pivot: pivot, grazeA: grazeA,
      amp: Math.max(0.04, Math.min(0.3, legH * 0.32)),
      freq: Math.max(1.4, Math.min(9, (cls.stepFreq * 2.2) / Math.max(0.22, legH * (sp.scale || 1)))),
      step: 0, k: 0, grazeK: 0,
    };
  }

  // ---- the per-frame gait: legs swing by DISTANCE ACTUALLY MOVED (so every
  //      state — wander, flee, stalk, tame-follow, ridden — animates for free),
  //      plus the class flourishes: bound hop, lumber sway, run bob, graze dip.
  function gaitAnimate(a, dt) {
    const gt = a.gait; if (!gt) return;
    const grp = a.group, sp = a.species, cls = classify(sp);
    const mx = grp.position.x, mz = grp.position.z;
    const mdx = a._gpx == null ? 0 : mx - a._gpx;
    const mdz = a._gpz == null ? 0 : mz - a._gpz;
    const moved = Math.hypot(mdx, mdz);
    a._gpx = mx; a._gpz = mz;
    const walking = moved > 0.0025;
    // Keep a cheap observable invariant for audits: any visible land animal
    // that moved should travel along the direction its nose faces. 1.0 means
    // exact alignment, 0 means the old sideways slide, -1 means moonwalking.
    a._motionMoved = walking ? moved : 0;
    if (walking) {
      const h = a.faceH == null ? a.heading : a.faceH;
      a._motionAlignment = (mdx / moved) * Math.cos(h) + (mdz / moved) * Math.sin(h);
    } else a._motionAlignment = 1;
    // stride rate rides distance moved, but is CAPPED per class (a sprinting
    // animal lengthens its stride, it doesn't blur its legs): elephants top
    // out ~1.6 strides/s, rabbits ~3.5.
    if (walking) gt.step += Math.min(Math.min(moved, 1.5) * gt.freq, dt * (cls.stepCap || 15));
    // TERRAIN SLOPE: pitch the body to the ground it actually walks over —
    // read from the rise along the path (zero extra floorAt calls). At this
    // point grp.position.y is still the CLEAN ground height (flourishes are
    // added below), so d(y)/d(travel) IS the slope under the feet.
    const gy = grp.position.y;
    if (!a.ridden && a._gpy != null && moved > 0.01) {
      const rawS = Math.max(-0.45, Math.min(0.45, Math.atan2(gy - a._gpy, moved)));
      a._slope = (a._slope || 0) + (rawS - (a._slope || 0)) * Math.min(1, dt * 5);
    }                                                  // parked: HOLD the slope it stopped on
    a._gpy = gy;
    // ease the swing weight in/out so legs settle instead of snapping
    gt.k += ((walking ? 1 : 0) - gt.k) * Math.min(1, dt * 8);
    if (gt.k > 0.02) {
      const sw = Math.sin(gt.step) * gt.amp * gt.k;
      const lift = gt.amp * 0.35 * gt.k;
      for (let c = 0; c < gt.cols.length; c++) {
        const col = gt.cols[c], s = sw * col.diag;
        const up = Math.max(0, Math.sin(gt.step + (col.diag > 0 ? 0 : Math.PI))) * lift;
        // rotate about the column top: the foot travels `s`, the hip stays put
        const an = s / col.len, ca = Math.cos(an), sa = Math.sin(an);
        for (let p = 0; p < col.parts.length; p++) {
          const pt = col.parts[p];
          const rx = pt.bx - col.x, ry = pt.by - col.top;
          pt.m.position.x = col.x + rx * ca - ry * sa;
          pt.m.position.y = col.top + rx * sa + ry * ca + up;
          pt.m.rotation.z = pt.rz + an;
        }
      }
    } else if (gt.k <= 0.02 && gt._setl !== 1) {
      gt._setl = 1;
      for (let c = 0; c < gt.cols.length; c++) {
        const col = gt.cols[c];
        for (let p = 0; p < col.parts.length; p++) { const pt = col.parts[p]; pt.m.position.x = pt.bx; pt.m.position.y = pt.by; pt.m.rotation.z = pt.rz; }
      }
    }
    if (walking) gt._setl = 0;
    // class flourishes on the GROUP (after tick set y to ground level):
    const fleeing = a.state === "flee" || a.state === "charge";
    if (walking) {
      if (cls.hop && (fleeing || sp._hopAlways)) {
        grp.position.y += Math.abs(Math.sin(gt.step * 0.5)) * cls.hop * (sp.scale || 1) * 2.2;   // the BOUND
      } else if (cls.bob) {
        grp.position.y += Math.abs(Math.sin(gt.step)) * cls.bob * (sp.scale || 1) * gt.k;
      }
    }
    // body pitch = terrain slope + the lumbering rock (bears) — one composed
    // write, and only while no flinch/attack owns the transform.
    if ((a._flinchT || 0) <= 0 && (a._atkAnim == null || a._atkAnim < 0)) {
      const swayV = (walking && cls.sway) ? Math.sin(gt.step * 0.5) * cls.sway * gt.k : 0;
      grp.rotation.z = (a._slope || 0) + swayV;
    }
    // graze dip: the head cluster eases down to the grass and back up
    if (gt.head) {
      const want = (a.state === "graze") ? 1 : 0;
      gt.grazeK += (want - gt.grazeK) * Math.min(1, dt * 3);
      if (gt.grazeK > 0.01 || gt._setg === 1) {
        gt._setg = gt.grazeK > 0.01 ? 1 : 0;
        if (gt.pivot) {
          const an = -gt.grazeA * gt.grazeK, ca = Math.cos(an), sa = Math.sin(an), px = gt.pivot[0], py = gt.pivot[1];
          for (let i = 0; i < gt.head.length; i++) {
            const h = gt.head[i], rx = h.bx - px, ry = h.by - py;
            h.m.position.x = px + rx * ca - ry * sa;
            h.m.position.y = py + rx * sa + ry * ca;
            h.m.rotation.z = h.rz + an;
          }
        } else {
          const dy = gt.dip * gt.grazeK, dx = gt.dip * 0.3 * gt.grazeK;
          for (let i = 0; i < gt.head.length; i++) {
            const h = gt.head[i];
            h.m.position.y = h.by - dy;
            h.m.position.x = h.bx + dx;
          }
        }
      }
    }
  }

  // ============================================================
  //  THE SWIM RIG — the aquatic half of the same discovery system, and it is
  //  here for exactly the reason the gait is: it was private to the 3,500-line
  //  hunting engine, and the hunting engine is not the only thing in this game
  //  that has to make a shark move. games/battle.html's OPEN WATER arena walks
  //  a megalodon with the `beasts` pack and nothing else; and systems/
  //  predator_anim.js (already IN that pack) reads `a.swim` and hands the gape
  //  to CBZ.swimJaw — so the pack shipped a CONSUMER of a rig the pack did not
  //  contain, and every aquatic body it animated was a rigid mesh sliding
  //  through the sea with its jaw welded shut.
  //
  //  DISCOVERY (no declarations, same law as the leg columns): the models are
  //  authored nose-toward +X, so children behind the origin are the tail. The
  //  ones in the rear half BEHIND the body mass become the tail cluster, with a
  //  weight t that grows to 1 at the tip; the tip's own proportions decide the
  //  swim PLANE — a fin taller than it is wide (shark, mackerel) undulates
  //  LATERALLY, a horizontal fluke (dolphin, humpback) undulates VERTICALLY,
  //  which is the actual difference between a fish and a cetacean.
  //
  //  Phase rides DISTANCE ACTUALLY MOVED (gaitAnimate's law), so a wander, a
  //  tamed follow, a stalk and a shark's rush all animate for free.
  //
  //  FOR THE OWNER: city/wildlife.js:511-708 is now a verbatim second copy of
  //  everything below and should be DELETED. That file loads AFTER this one and
  //  reassigns the same three names to identical functions, so the city is
  //  unaffected either way; the duplicate is here only because wildlife.js was
  //  being edited concurrently when the rig moved.
  // ============================================================

  function tipHorizontal(m) {
    // horizontal fluke (cetacean) vs vertical caudal fin (fish/shark)
    const p = m && m.geometry && m.geometry.parameters;
    if (p && p.depth != null && p.height != null) return p.depth > p.height * 1.25;
    const d = m ? meshDims(m) : null;
    return !!(d && d.w > d.h * 1.6);
  }

  // ============================================================
  //  MARINE_TAIL_V2 — THE WELD (CBZ.CONFIG.MARINE_TAIL_V2, default ON)
  //
  //  OWNER (2026-08-25): "the tail visibly DISCONNECTS from the body. For orca
  //  the vertical disconnect, for sharks the horizontal disconnect."
  //
  //  IT WAS NOT A LAG BUG, A STAGGER BUG OR A MATRIX-OWNERSHIP BUG. It was the
  //  animator's whole model. Every marine body in this game is a BIG RIGID HULL
  //  (`sharkHull` spans local x -1.62..1.68; `cetaceanHull` -2.35..3.25) plus a
  //  handful of separate fin/peduncle meshes bolted onto it. The v1 loop moved
  //  ONLY the bolted-on meshes, and it moved each one by TRANSLATING its whole
  //  body sideways by `sin(phase) * t * amp` — with `t` read off the mesh's
  //  CENTRE — and then spinning it about that same centre by up to 0.42 rad of
  //  "angle of attack" that had nothing to do with the shape of the wave. The
  //  hull never moved at all. Measured on the shipped great white, the caudal
  //  peduncle's FRONT EDGE (the edge that has to stay inside the hull) left the
  //  hull by up to 0.48 m sideways — on a tail stock 0.34 m wide. On the orca
  //  the same arithmetic in the vertical plane walked the peduncle 0.59 m off
  //  the hull. That is the owner's disconnect, in each species' own plane,
  //  exactly as reported, and it got worse with size because `amp` scales with
  //  body length while the joint does not.
  //
  //  V2 IS A HINGE, NOT A SLIDE. Each part now knows two things it never knew:
  //  where the RIGID TRUNK ENDS (`anchorX` — the rear-most point of every mesh
  //  that is NOT part of the tail), and where its OWN ROOT EDGE is (the front
  //  face of its transformed bounding box). It is then placed by fitting its
  //  rigid body as a CHORD of one continuous wave w(u) that is exactly ZERO at
  //  the trunk weld: the root lands on w(u_root), the rear lands on w(u_rear),
  //  and the rotation is whatever angle connects them. A part whose root is at
  //  or in front of the anchor therefore CANNOT MOVE ITS ROOT — the weld is
  //  arithmetic, not a tuning value — while its rear end whips as hard as the
  //  wave says. The angle-of-attack term is deleted: the fin's angle IS the
  //  slope of the wave it sits on, which is also what a real caudal fin does.
  //
  //  AND IT WHIPS HARDER WHEN IT SWIMS HARDER. v1's amplitude was a constant;
  //  only the beat frequency rode speed. Amplitude now rides body-lengths per
  //  second (AMP_SLOW..AMP_FAST), and the trunk itself counter-yaws a little at
  //  speed so the body reads as one animal instead of a plank towing a fin.
  //
  //  ?cfg_MARINE_TAIL_V2=0 restores the v1 slide verbatim for A/B captures.
  // ============================================================
  //  (The v1 slide and its MARINE_TAIL_V2 switch are deleted: git is the undo.)
  //
  //  ============================================================
  //  NATURE-FOOTAGE PASS (2026-09-27) — what drives each motion, in one place:
  //
  //    TAIL BEAT   phase rides DISTANCE travelled (freq rad/unit) + a small
  //                idle flick + an ACCELERATION kick, so a body that is
  //                speeding up beats hard even before it has covered ground
  //                (a real kick-off from rest), and a steady cruise beats slow.
  //    AMPLITUDE   rides body-lengths/s (AMP_SLOW..AMP_FAST): lazy sweeps at
  //                cruise, deep whipping ones at a rush, +45 % while
  //                accelerating.
  //    GLIDE       burst-and-glide. Any deceleration glides (the tail goes
  //                quiet and straightens instead of beating at a braking
  //                body), and an unhurried wild animal alternates a few
  //                seconds of beats with a coast, on a hashed schedule.
  //    TRUNK       rigid hull (thunniform: a great white IS stiff), so the
  //                body wave is the tail chord chain below plus a head
  //                counter-yaw (BODY_SWING) against the beat. Published as
  //                rig.yawSwing so the ridden shark (whose yaw the mount
  //                rewrites late) can apply it when nobody sits on it.
  //    PECTORALS   discovered off the authored fins (finShape.under, span
  //                sideways, forward of the origin) or by name. They trim
  //                with vertical speed (leading edge up to rise), FLARE on
  //                braking (tips down, high angle of attack), sweep back at a
  //                rush, and work differentially in a turn.
  //    BANK        roll into the turn, pitch with vertical speed.
  //    CURL        a static bend a poser can ask for (a._swimCurl, -1..1):
  //                the breach arc and the death throes use it.
  //    DEATH       CBZ.aquaticDeathBegin/Step: a few dying beats that fade,
  //                a slow roll belly-up, the nose dropping, and a shark
  //                SINKING to the bed (no swim bladder) while bony fish and
  //                cetaceans drift up and float. Replaces the land tumble
  //                (a corpse thrown upward at 20 m/s^2 gravity) for anything
  //                aquatic.
  //
  //  Everything is frame-rate independent (exponential easing on dt) and
  //  allocation-free per frame.
  //  ============================================================

  const TAIL_LAG = 1.45;      // rad of phase between the trunk weld and the tip
  const TAIL_ENV = 1.55;      // amplitude envelope exponent along the tail
  const AMP_SLOW = 0.45;      // x rig.amp when it is drifting
  const AMP_FAST = 1.60;      // x rig.amp at a full rush
  const SPD_LO = 0.30;        // body-lengths/s that counts as "drifting"
  const SPD_HI = 2.60;        // ..and as a full rush
  const BODY_SWING = 0.075;   // rad the TRUNK counter-swings at a full rush
  const CURL_AMP = 0.20;      // tip bend, in body lengths, at curl = 1
  function ez(k, dt) { return 1 - Math.exp(-k * dt); }

  const _bb3 = (window.THREE && window.THREE.Box3) ? new window.THREE.Box3() : null;
  // a child mesh's bounding box expressed in its PARENT's (the actor group's)
  // space — which is the space every number in the rig lives in.
  function boxInGroup(m) {
    if (!_bb3 || !m.geometry) return null;
    if (!m.geometry.boundingBox) { try { m.geometry.computeBoundingBox(); } catch (e) { return null; } }
    if (!m.geometry.boundingBox) return null;
    m.updateMatrix();
    return _bb3.copy(m.geometry.boundingBox).applyMatrix4(m.matrix);
  }

  /* ============================================================
     THE SKINNED SWIMMER — every body city/wildlife/aquatic.js builds
     (group.userData.marineBody: one SkinnedMesh with a spine chain, jaws,
     eyes and pectorals).

     The body swims as ONE travelling wave. Every spine bone takes the slope
     of  lateral(xi, t) = A * env(xi) * sin(phase - 2 pi xi / lambda)  at the
     middle of the stretch of body it owns (xi = 0 at the snout, 1 at the tail
     tip), so the chain integrates the curve: the head barely yaws, the swing
     grows toward the tail, and the wave runs backward along the body. Fish
     and sharks bend sideways; whales and dolphins up and down. Tail-beat
     frequency rises linearly with body lengths per second (as measured in
     fish and sharks: f = f0 + fK * U/L), the swing deepens with urgency,
     and an unhurried animal glides between bursts with the tail settling
     straight. A turn bends the body into it.

     The bite is the sequence a great white performs: the snout lifts, the
     lower jaw drops, the upper jaw slides out of the head as the jaws close,
     and the eyes roll back (or, on requiem sharks and hammerheads, the
     nictitating membrane comes up) just before contact.
     ============================================================ */
  const TH3 = window.THREE;
  const _mq = TH3 ? new TH3.Quaternion() : null, _mq2 = TH3 ? new TH3.Quaternion() : null;
  const _mv = TH3 ? new TH3.Vector3() : null, _mv2 = TH3 ? new TH3.Vector3() : null;
  const AX_X = TH3 ? new TH3.Vector3(1, 0, 0) : null, AX_Y = TH3 ? new TH3.Vector3(0, 1, 0) : null, AX_Z = TH3 ? new TH3.Vector3(0, 0, 1) : null;
  function sm01(t) { return t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)); }

  function buildMarineRig(a, mb) {
    const tpl = mb.tpl, spec = tpl.spec, B = mb.bones, ix = mb.ix;
    const L = spec.L, xN = spec.xNose;
    const cb = spec.chain.b, J = spec.chain.J;
    const ends = [xN].concat(J).concat([xN - L]);
    // each chain bone: the middle of the stretch it owns, and its parent in the chain
    const chain = cb.map(function (b, k) {
      const xa = ends[k], xb = ends[k + 1];
      return { bone: B[b], xi: (xN - (xa + xb) * 0.5) / L, par: -1, th: 0 };
    });
    // chain order is head, neck, root, t1..tn: head<-neck<-root, root->t1->t2..
    const rootK = 2;
    chain[0].par = 1; chain[1].par = 2;
    for (let k = 3; k < chain.length; k++) chain[k].par = k - 1;
    chain[3] && (chain[3].par = rootK);
    for (let k = 0; k < B.length; k++) B[k].rotation.order = "YZX";
    const rest = B.map(function (b) { return b.position.clone(); });
    const w = spec.wave || { lambda: 1, amp: 0.08, env: [0.03, 0, 1], f0: 0.4, fK: 1, fMax: 3 };
    const e = w.env, eSum = e[0] + e[1] + e[2];
    const plan = spec.plan || "lateral";
    a.swim = {
      marine: mb, plan: plan, chain: chain, rest: rest, wave: w, eSum: eSum,
      vert: plan === "vertical", len: tpl.len, L: L,
      amp: w.amp * L, ph: (CBZ.hash01 ? CBZ.hash01(a.group.position.x, a.group.position.z, 71) : 0) * 6.283,
      k: 0, spd01: 0, vS: -1, acc: 0, burst: 0, brake: 0, glide: 0, gliding: false, nG: 0, turn: 0, vyS: 0,
      gT: 1 + (CBZ.hash01 ? CBZ.hash01(a.group.position.x, a.group.position.z, 74) : 0.5) * 3.5,
      seed: (CBZ.hash01 ? CBZ.hash01(a.group.position.x, a.group.position.z, 72) : 0.5) * 997,
      curl: 0, yawSwing: 0, roll: 0, pitch: 0, px: null, pz: null, py: null, ph0: a.heading,
      spineY: tpl.bones[ix.root].p[1], jaw: !!tpl.contract, jawK: -1, jawApplied: -1,
      jawCfg: spec.jaw || null, eyeCfg: spec.eye || null,
      pecs: [ix.pecR, ix.pecL].filter(function (q) { return q != null; }).map(function (q, n) { return { bone: B[q], s: n === 0 ? 1 : -1 }; }),
      style: plan === "flap" || plan === "flipper" ? plan : null, sph: 0,
      lod: 0, lodT: 0, lodD: lodDistance(tpl.len * ((a.group.scale && a.group.scale.x) || 1)),
      xiRoot: chain[rootK].xi,
    };
    poseMarine(a.swim, 0, 0, 0, 0);
  }

  // the lateral (or vertical) offset's slope at xi, per unit L
  function waveSlope(rig, xi, A, ph, bend) {
    const e = rig.wave.env, k = 6.283185307 / rig.wave.lambda;
    const env = (e[0] + e[1] * xi + e[2] * xi * xi) / rig.eSum;
    const denv = (e[1] + 2 * e[2] * xi) / rig.eSum;
    const arg = ph - k * xi;
    // the bend is a C about the root: the root keeps the line of travel and
    // both ends come round toward the inside of the curve
    return A * (denv * Math.sin(arg) - k * env * Math.cos(arg)) + bend * 2 * (xi - rig.xiRoot);
  }
  /* Pose the spine for a tail amplitude A (model units), phase ph and a
     static bend (model units at the tail tip; + toward +z / up). */
  function poseMarine(rig, A, ph, bend, dt) {
    const ch = rig.chain, L = rig.L;
    for (let k = 0; k < ch.length; k++) ch[k].th = Math.atan(waveSlope(rig, ch[k].xi, A, ph, bend) / L);
    for (let k = 0; k < ch.length; k++) {
      const c = ch[k], rel = c.th - (c.par >= 0 ? ch[c.par].th : 0);
      if (rig.vert) { c.bone.rotation.y = 0; c.bone.rotation.z = -rel; }
      else c.bone.rotation.y = rel;
    }
    applyMarineJaw(rig, rig.jawK < 0 ? 0 : rig.jawK);
    void dt;
  }
  // the bite on the bones (see the block comment above)
  function applyMarineJaw(rig, k) {
    const J = rig.jawCfg, mb = rig.marine, B = mb.bones, ix = mb.ix;
    if (!J) return;
    const L = rig.L;
    const e1 = sm01(k / 0.55), e2 = sm01(k), e3 = sm01((k - 0.35) / 0.65), e4 = sm01((k - 0.55) / 0.40);
    const head = B[ix.head], jaw = B[ix.jaw], up = B[ix.upperJaw];
    if (!rig.vert && head) head.rotation.z = (J.lift || 0) * e1;
    // the lower jaw hangs off the neck (the snout lifts without it), so it
    // takes the head's own yaw (and a whale's head pitch) to stay under it
    if (jaw) {
      jaw.rotation.z = -(J.drop || 0.6) * e2 + (rig.vert && head ? head.rotation.z : 0);
      jaw.rotation.y = head ? head.rotation.y : 0;
    }
    if (up) {
      const r = rig.rest[ix.upperJaw], pr = J.protrude || [0, 0];
      up.position.set(r.x + pr[0] * L * e3, r.y + pr[1] * L * e3, r.z);
    }
    const roll = J.eyeRoll, rm = (J.rollMax || 1.8) * e4;
    const eR = B[ix.eyeR], eL = B[ix.eyeL];
    if (eR && eL) {
      if (roll === "back") { eR.rotation.set(0, -rm, 0); eL.rotation.set(0, rm, 0); }
      else if (roll === "membrane") { eR.rotation.set(-rm, 0, 0); eL.rotation.set(rm, 0, 0); }
    }
    rig.jawApplied = k;
  }
  // pectorals: aoa (+ leading edge up), drop (+ tips down), diff (+ the
  // right tip down, the left up: a turn), sweep (+ tips back)
  function poseMarinePecs(rig, aoa, drop, diff, sweep) {
    const P = rig.pecs;
    if (!P || !_mq) return;
    for (let i = 0; i < P.length; i++) {
      const s = P[i].s, b = P[i].bone;
      _mq.setFromAxisAngle(AX_Y, -sweep * s);
      _mq2.setFromAxisAngle(AX_X, (drop + diff * s) * s);
      _mq.multiply(_mq2);
      _mq2.setFromAxisAngle(AX_Z, aoa);
      _mq.multiply(_mq2);
      b.quaternion.copy(_mq);
    }
  }
  // a manta's wings and a turtle's flippers are the stroke (aquatic.js
  // builds their bones as wing / flipper chains; see their builders)
  function strokeMarine(a, rig, dt) {
    const mb = rig.marine, ix = mb.ix, B = mb.bones;
    const ph0 = CBZ.wildlifeSwimPhase ? CBZ.wildlifeSwimPhase(a) : null;
    let ph;
    if (ph0 != null && !a.ridden) ph = ph0;
    else { rig.sph += dt * (1.6 + 3.0 * rig.spd01) * (1 - 0.6 * rig.glide); ph = rig.sph; }
    const turn = Math.max(-0.3, Math.min(0.3, rig.turn * 0.25));
    if (rig.style === "flap") {
      // a travelling wave out along each wing: root leads, tip follows
      const amp = (0.56 + 0.22 * rig.spd01 + 0.12 * rig.burst) * (1 - 0.55 * rig.glide);
      const wings = [["wR1", "wR2", "wR3", 1], ["wL1", "wL2", "wL3", -1]];
      for (let s = 0; s < 2; s++) {
        const W = wings[s], sgn = W[3];
        for (let q = 0; q < 3; q++) {
          const b = B[ix[W[q]]];
          if (!b) continue;
          const lag = q * 0.55;
          const v = Math.sin(ph - lag);
          // the downstroke runs a touch deeper than the recovery
          const ang = amp * (q === 0 ? 0.55 : (q === 1 ? 0.35 : 0.30)) * (v > 0 ? v : v * 0.8) + (q === 0 ? turn * sgn * 0.6 : 0);
          b.rotation.set(-ang * sgn, 0, 0);
        }
      }
      // the body pitches gently against the stroke
      const hd = B[ix.head];
      if (hd) hd.rotation.z = 0.035 * Math.cos(ph) * amp;
    } else {
      // a green turtle FLIES with its fore flippers: down and back on the
      // power stroke with the blade square to the water, up and forward
      // feathered; the hind flippers trail as rudders
      const s = Math.sin(ph), c = Math.cos(ph);
      const fl = [["fR1", "fR2", 1], ["fL1", "fL2", -1]];
      for (let q = 0; q < 2; q++) {
        const F = fl[q], sgn = F[2];
        const b1 = B[ix[F[0]]], b2 = B[ix[F[1]]];
        if (b1) {
          _mq.setFromAxisAngle(AX_X, -(0.55 * s + turn * 0.4) * sgn);            // up / down
          _mq2.setFromAxisAngle(AX_Y, (0.30 * (0.5 - 0.5 * c)) * sgn);           // swept back through the stroke
          _mq.multiply(_mq2);
          _mq2.setFromAxisAngle(AX_Z, -0.45 * c);                                 // feathered on the recovery
          _mq.multiply(_mq2);
          b1.quaternion.copy(_mq);
        }
        if (b2) b2.rotation.set(-(0.28 * Math.sin(ph - 0.6)) * sgn, 0, 0);
      }
      const hr = [["hR", 1], ["hL", -1]];
      for (let q = 0; q < 2; q++) {
        const b = B[ix[hr[q][0]]];
        if (b) b.rotation.set(-(0.10 * Math.sin(ph * 0.5) + turn * 0.5) * hr[q][1], 0.12 * hr[q][1], 0);
      }
      const hd = B[ix.head];
      if (hd) hd.rotation.set(0, 0.04 * Math.sin(ph * 0.5), 0.03 * c);
    }
  }
  // the near body inside ~nine body lengths, never further out than 28 m and
  // never closer than forty lengths for a small fish (a sardine swaps at ~9 m)
  /* WHERE THE TEETH ARE. The mouth contract's points (bite: between the
     front teeth; grip: further back between the jaws; hinge) carried by the
     live jaw bones, so a held body follows the head through every shake and
     every change of gape. Between the jaws = the mean of where the upper and
     the lower jaw each carry the point. */
  const _mwA = TH3 ? new TH3.Vector3() : null, _mwB = TH3 ? new TH3.Vector3() : null;
  function marineMouthWorld(g, which, out) {
    const ud = g && g.userData, mb = ud && ud.marineBody, c = ud && ud.aquaticMouth;
    if (!mb || !c || !_mwA) return false;
    const p = c[which] || c.bite, sk = mb.mesh.skeleton, ix = mb.ix;
    g.updateMatrixWorld(true);
    const jb = ix.jaw != null ? ix.jaw : ix.head, ub = ix.upperJaw != null ? ix.upperJaw : ix.head;
    _mwA.set(p.x, p.y, p.z).applyMatrix4(sk.boneInverses[jb]).applyMatrix4(sk.bones[jb].matrixWorld);
    _mwB.set(p.x, p.y, p.z).applyMatrix4(sk.boneInverses[ub]).applyMatrix4(sk.bones[ub].matrixWorld);
    out.x = (_mwA.x + _mwB.x) * 0.5; out.y = (_mwA.y + _mwB.y) * 0.5; out.z = (_mwA.z + _mwB.z) * 0.5;
    // the jaws' opening at that point, in metres
    out.open = _mwA.distanceTo(_mwB);
    return isFinite(out.x) && isFinite(out.y) && isFinite(out.z);
  }
  // the head's axes in the world: f forward (out of the snout), u up, s left
  function marineHeadAxes(g, out) {
    const mb = g && g.userData && g.userData.marineBody;
    if (!mb) return false;
    const e = mb.bones[mb.ix.head].matrixWorld.elements;
    const lf = Math.hypot(e[0], e[1], e[2]) || 1, lu = Math.hypot(e[4], e[5], e[6]) || 1, ls = Math.hypot(e[8], e[9], e[10]) || 1;
    out.fx = e[0] / lf; out.fy = e[1] / lf; out.fz = e[2] / lf;
    out.ux = e[4] / lu; out.uy = e[5] / lu; out.uz = e[6] / lu;
    out.sx = e[8] / ls; out.sy = e[9] / ls; out.sz = e[10] / ls;
    return true;
  }
  /* The gape that closes the teeth on a body of diameter D (metres): the jaw
     setting whose opening between the front teeth is D, measured once per
     species on a scratch pose (capped at the full gape: a torso wider than
     the gape takes the teeth in). */
  function marineClampFor(a, D) {
    const rig = a && a.swim, g = a && a.group;
    if (!rig || !rig.marine || !rig.jawCfg || !g) return 0.6;
    const tpl = rig.marine.tpl, sc = (g.scale && g.scale.x) || 1;
    if (!tpl._open) {
      const was = rig.jawApplied, tmp = {};
      tpl._open = [];
      for (let i = 0; i <= 8; i++) {
        const k = i / 8;
        applyMarineJaw(rig, k);
        marineMouthWorld(g, "bite", tmp);
        tpl._open.push(tmp.open / sc);
      }
      applyMarineJaw(rig, was >= 0 ? was : 0);
    }
    const O = tpl._open, want = D / sc;
    if (want <= O[0]) return 0;
    for (let i = 1; i < O.length; i++) if (O[i] >= want) return (i - 1 + (want - O[i - 1]) / Math.max(1e-6, O[i] - O[i - 1])) / 8;
    return 1;
  }
  // the radius of the bite: half the mouth's width across its tooth rows, at
  // the animal's size (metres)
  function marineJawRadius(g) {
    const c = g && g.userData && g.userData.aquaticMouth;
    if (!c) return 0;
    return c.width * 0.5 * ((g.scale && g.scale.x) || 1);
  }
  CBZ.marineJawRadius = marineJawRadius;
  CBZ.marineMouthWorld = marineMouthWorld;
  CBZ.marineHeadAxes = marineHeadAxes;
  CBZ.marineClampFor = marineClampFor;

  function lodDistance(lenM) { return Math.max(Math.min(28, 40 * lenM), 9 * lenM); }
  function marineLod(a, rig) {
    const cam = CBZ.camera, mesh = rig.marine.mesh;
    if (!cam || !cam.matrixWorld || !mesh) return;
    const e = cam.matrixWorld.elements, g = a.group.matrixWorld.elements;
    const d = Math.hypot(e[12] - g[12], e[13] - g[13], e[14] - g[14]);
    const want = d > rig.lodD * (rig.lod ? 0.9 : 1.1) ? 1 : 0;
    if (want !== rig.lod) {
      const geos = rig.marine.tpl.geo;
      const gg = geos[Math.min(want, geos.length - 1)];
      if (gg) { mesh.geometry = gg; rig.lod = want; rig.marine.lod = want; }
    }
  }

  function buildSwimRig(a) {
    const sp = a.species, grp = a.group;
    if (!sp.aquatic || sp.snake) return;
    if (grp.userData && grp.userData.marineBody) { buildMarineRig(a, grp.userData.marineBody); return; }
    const kids = grp.children;
    let minX = 0, maxX = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m || !m.isMesh) continue;
      if (m.position.x < minX) minX = m.position.x;
      if (m.position.x > maxX) maxX = m.position.x;
    }
    if (minX > -0.3) return;                       // nothing behind the origin: no tail to swing
    const cut = minX * 0.5;                        // the rear half behind the body mass
    const span = minX - cut;
    const parts = [];
    let tip = null, tipX = 1e9;
    // THE TRUNK: how far back the rigid, never-animated geometry actually
    // reaches, and where its long axis sits. Everything the tail does is
    // measured from here, so the weld is a fact about the model rather than a
    // constant somebody has to keep in sync with the bestiary.
    let anchorX = Infinity, spineY = 0, spineZ = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m || !m.isMesh) continue;
      if (m.position.x > cut) {
        const bb = boxInGroup(m);
        if (bb && bb.min.x < anchorX) {
          anchorX = bb.min.x;
          spineY = (bb.min.y + bb.max.y) * 0.5;
          spineZ = (bb.min.z + bb.max.z) * 0.5;
        }
        continue;
      }
      const pb = boxInGroup(m);
      parts.push({
        m: m, bx: m.position.x, by: m.position.y, bz: m.position.z,
        ry: m.rotation.y, rz: m.rotation.z,
        t: Math.max(0, Math.min(1, (m.position.x - cut) / (span || -1))),
        x0: pb ? pb.min.x : m.position.x, x1: pb ? pb.max.x : m.position.x,
      });
      if (m.position.x < tipX) { tipX = m.position.x; tip = m; }
    }
    if (!parts.length) return;
    parts.sort(function (p, q) { return p.t - q.t; });   // base -> tip, so the wave travels

    // ---- v2 stations: hinge, root/rear wave coordinates, lever arm ---------
    let tipRear = Infinity;
    for (let i = 0; i < parts.length; i++) if (parts[i].x0 < tipRear) tipRear = parts[i].x0;
    let anchor = (anchorX < Infinity) ? anchorX : cut;
    if (!(anchor > tipRear)) { anchor = cut; spineY = 0; spineZ = 0; }   // no rigid trunk: fall back
    const tspan = Math.max(0.05, anchor - tipRear);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      // THE HINGE. A part that starts in front of the anchor is buried in the
      // hull; it pivots where it LEAVES the hull, never at its own front face,
      // so nothing bolted to the trunk can ever slide out of it.
      p.hx = Math.min(p.x1, anchor);
      p.u0 = Math.max(0, Math.min(1, (anchor - p.hx) / tspan));
      p.u1 = Math.max(0, Math.min(1, (anchor - p.x0) / tspan));
      p.d = Math.max(tspan * 0.08, p.hx - p.x0);    // hinge -> rear lever arm
      p.dx = p.bx - p.hx;                            // origin, offset from the hinge
      p.dy = p.by - spineY;
      p.dz = p.bz - spineZ;
      p.e0 = p.u0 > 0 ? Math.pow(p.u0, TAIL_ENV) : 0;
      p.e1 = p.u1 > 0 ? Math.pow(p.u1, TAIL_ENV) : 0;
      p.l0 = p.u0 * TAIL_LAG;
      p.l1 = p.u1 * TAIL_LAG;
      p.w0 = 0; p.w1 = 0;
      // THE CHAIN. A caudal fin is not bolted to the hull, it is sleeved onto
      // the PEDUNCLE — and a peduncle is a rigid stick, so its surface is a
      // straight CHORD, not the smooth wave. Rooting the fin on the curve
      // instead leaves the two shearing past each other by the difference.
      // Every part therefore looks for the part in front of it that physically
      // contains its hinge and, when it finds one, takes its root offset off
      // THAT part's chord. `parts` is sorted base -> tip, so a host is always
      // already solved by the time we need it.
      p.host = -1;
      if (p.hx < anchor - 1e-6) {
        let bestW = 0;
        for (let j = 0; j < i; j++) {
          const q = parts[j];
          if (q.x0 <= p.hx && q.x1 > p.hx + 1e-6) {
            const w = q.x1 - q.x0;
            if (w > bestW) { bestW = w; p.host = j; }
          }
        }
      }
      p.hf = p.host >= 0 ? Math.max(0, Math.min(1, (parts[p.host].hx - p.hx) / parts[p.host].d)) : 0;
    }
    // JAW: newly authored sharks expose one lower-jaw Group whose origin is the
    // physical hinge. Older aquatics keep the geometric fallback below, so the
    // shared animator remains backward-compatible and species-agnostic.
    const authoredMouth = grp._aquaticMouth && grp._aquaticMouth.lower
      ? grp._aquaticMouth : null;
    // FALLBACK JAW: far-forward children that hang BELOW the mean of the head
    // cluster — i.e. the lower jaw and its tooth row, never the skull.
    const jawCut = maxX * 0.6;
    let sumY = 0, nY = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m || !m.isMesh || m.position.x < jawCut) continue;
      sumY += m.position.y; nY++;
    }
    const jaw = [];
    let jawBase = null, jawBaseScore = -1;
    if (!authoredMouth && nY >= 3) {
      const meanY = sumY / nY;
      for (let i = 0; i < kids.length && jaw.length < 14; i++) {
        const m = kids[i]; if (!m || !m.isMesh || m.position.x < jawCut) continue;
        if (m.position.y < meanY - 0.05) {
          const part = { m: m, bx: m.position.x, by: m.position.y, rz: m.rotation.z };
          jaw.push(part);
          // The mouth slab is the largest discovered lower-head part. Its actual
          // rear/top edge is the physical jaw hinge. The old `maxX * .62`
          // approximation sat well behind that edge: opening a great white was
          // tolerable, but scaling the same error to a megalodon made the whole
          // lower jaw orbit away like a detached pink board. This geometry solve
          // works for every current/future flat aquatic build without species IDs.
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          if (m.geometry.boundingBox) {
            m.updateMatrix();
            const jb = new window.THREE.Box3().copy(m.geometry.boundingBox).applyMatrix4(m.matrix);
            const jdx = jb.max.x - jb.min.x, jdy = jb.max.y - jb.min.y, jdz = jb.max.z - jb.min.z;
            const score = jdx * jdy * jdz;
            if (score > jawBaseScore) {
              jawBaseScore = score;
              jawBase = { x: jb.min.x, y: jb.max.y };
            }
          }
        }
      }
    }
    const len = Math.max(0.5, maxX - minX);
    // PECTORALS: the paired, sideways, forward fins. Authored fins remember
    // their recipe (aquatic.js finMesh -> userData.finShape/finAt); the orca
    // build names its own. The geometry is baked about the fin's ROOT, so a
    // rotation of the mesh pivots the fin where it joins the body.
    const pecs = [];
    for (let i = 0; i < kids.length && pecs.length < 2; i++) {
      const m = kids[i]; if (!m || !m.isMesh) continue;
      const fs = m.userData && m.userData.finShape;
      const byShape = fs && fs.under && fs.spanDir && Math.abs(fs.spanDir[2]) > 0.5 &&
        m.position.x > 0 && Math.abs(m.position.z) > 0.05 && (fs.span || 0) >= 0.3;
      const byName = /pectoral/i.test(m.name || "") && Math.abs(m.position.z) > 0.05;
      if (!byShape && !byName) continue;
      if (parts.some(function (p) { return p.m === m; })) continue;
      pecs.push({ m: m, s: m.position.z >= 0 ? 1 : -1, rx: m.rotation.x, ry: m.rotation.y, rz: m.rotation.z });
    }
    a.swim = {
      parts: parts, vert: tipHorizontal(tip),
      amp: len * 0.065,                            // sweep at the tip, in local u
      yaw: 0.42,                                   // fin angle-of-attack at the tip
      freq: Math.max(0.8, Math.min(8, 6 / len)),   // radians of beat per unit travelled
      // DETERMINISM: the seeded rng() is a shared, order-fragile stream — a new
      // draw here would shift every later spawn and break the byte-identical
      // world build. Position-hash instead (no stream state at all).
      ph: (CBZ.hash01 ? CBZ.hash01(grp.position.x, grp.position.z, 71) : 0) * 6.283,
      k: 0,
      // v2 spine facts (see MARINE_TAIL_V2 above)
      len: len, anchorX: anchor, tspan: tspan, spineY: spineY, spineZ: spineZ,
      spd01: 0, swingAdd: 0, swingLeft: null,
      jaw: jaw.length ? jaw : null,
      jawX: jawBase ? jawBase.x : maxX * 0.62,
      jawY: jawBase ? jawBase.y : 0,
      jawGroup: authoredMouth ? authoredMouth.lower : null,
      jawUpper: authoredMouth ? authoredMouth.upper : null,
      jawCavity: authoredMouth ? authoredMouth.cavity : null,
      jawContract: authoredMouth ? authoredMouth.contract : null,
      jawLowerRz: authoredMouth ? authoredMouth.lower.rotation.z : 0,
      jawUpperX: authoredMouth ? authoredMouth.upper.position.x : 0,
      jawUpperY: authoredMouth ? authoredMouth.upper.position.y : 0,
      jawCavityScaleY: authoredMouth ? authoredMouth.cavity.scale.y : 1,
      // A builder may own more of the animal than the two generic jaw groups:
      // a shark's rostrum, an orca's white chin, a crocodile's cheek fold.  The
      // shared rig still owns WHEN the mouth opens; this callback lets the
      // builder describe WHAT body envelope follows that one openness value.
      // Keeping the callback on the authored-mouth contract means every
      // consumer (city, battle, mounts, predators and visual staging) drives
      // the same geometry instead of growing species-specific animation loops.
      jawApplyGape: authoredMouth && typeof authoredMouth.applyGape === "function"
        ? authoredMouth.applyGape : null,
      jawK: -1,
      px: null, pz: null, py: null, ph0: a.heading,
      roll: 0, pitch: 0,
      // nature-footage pass state (see the block above the constants)
      pecs: pecs, vS: -1, acc: 0, burst: 0, brake: 0, glide: 0,
      gliding: false, nG: 0, turn: 0, vyS: 0,
      gT: 1 + (CBZ.hash01 ? CBZ.hash01(grp.position.x, grp.position.z, 74) : 0.5) * 3.5,   // staggered first coast
      curl: 0, yawSwing: 0,
      // "flap" (a ray: the wings ARE the stroke) / "flipper" (a turtle rows)
      style: (sp.swimStyle === "flap" || sp.swimStyle === "flipper") && pecs.length === 2 ? sp.swimStyle : null,
      sph: 0,
      seed: (CBZ.hash01 ? CBZ.hash01(grp.position.x, grp.position.z, 72) : 0.5) * 997,
    };
    // hinge height for the gape = the mean y of the jaw parts
    if (jaw.length && !jawBase) {
      let s = 0;
      for (let i = 0; i < jaw.length; i++) s += jaw[i].by;
      a.swim.jawY = s / jaw.length;
    }
  }

  // openness 0..1 — the gape. Called by creature_combat's "lunge" strike and by
  // the seize, so a shark's mouth actually opens on the thing it is biting.
  function swimJaw(actor, openness) {
    const rig = actor && actor.swim;
    if (!rig || (!rig.jaw && !rig.jawGroup)) return;
    let o = openness > 0 ? (openness > 1 ? 1 : openness) : 0;
    if (rig.marine) {
      // written now (a seize poses the jaw after the swim pass has run) and
      // remembered, so the next swim pass re-applies it under the wave
      rig.jawK = o;
      if (Math.abs(o - rig.jawApplied) > 1e-4) applyMarineJaw(rig, o);
      return;
    }
    if (rig.jawK >= 0 && Math.abs(o - rig.jawK) < 0.01) return;   // nothing changed
    rig.jawK = o;
    if (rig.jawGroup) {
      const contract = rig.jawContract || {};
      // The group origin never translates: its world position is therefore a
      // testable invariant and the mandible cannot become floating physics.
      rig.jawGroup.rotation.z = rig.jawLowerRz - o * (contract.travel || contract.maxOpen || 0.58);
      if (rig.jawUpper) {
        // Sharks protrude the upper jaw as they commit to a bite. The travel is
        // deliberately small; the lower hinge remains the dominant motion.
        rig.jawUpper.position.x = rig.jawUpperX + o * (contract.protrude || 0);
        rig.jawUpper.position.y = rig.jawUpperY - o * (contract.upperDrop || 0);
      }
      if (rig.jawCavity && !rig.jawApplyGape) {
        // Reveal the recessed dark cavity with the gape; at rest it remains a
        // narrow mouth line instead of a coloured box stuck under the snout.
        // A builder that publishes applyGape owns its own bore (the sharks
        // fan theirs about the hinge, which this blanket tenfold cannot do),
        // so do not write it here first and have it corrected a line later.
        rig.jawCavity.scale.y = rig.jawCavityScaleY * (1 + o * 9);
      }
      if (rig.jawApplyGape) rig.jawApplyGape(o);
      return;
    }
    const th = -o * 0.62;                       // drop the lower jaw about the hinge
    const c = Math.cos(th), s = Math.sin(th);
    for (let i = 0; i < rig.jaw.length; i++) {
      const p = rig.jaw[i];
      const dx = p.bx - rig.jawX, dy = p.by - rig.jawY;
      p.m.position.x = rig.jawX + dx * c - dy * s;
      p.m.position.y = rig.jawY + dx * s + dy * c;
      p.m.rotation.z = p.rz + th;
    }
  }

  // THE TAIL CHAIN. Chord-fit every rigid tail part onto ONE wave that is
  // exactly zero at the trunk weld (see MARINE_TAIL_V2 above), plus a static
  // bend `curl` (local units at the tip). Shared by the living beat and the
  // death throes so there is one tail law, not two.
  function poseTail(rig, amp, ph, curl) {
    const parts = rig.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      // where the ROOT sits: on its host part's own chord if it is sleeved
      // onto one, otherwise on the wave (which is exactly 0 at the trunk).
      const h = p.host >= 0 ? parts[p.host] : null;
      const w0 = h ? (h.w0 + (h.w1 - h.w0) * p.hf)
                   : (p.e0 > 0 ? amp * p.e0 * Math.sin(ph - p.l0) + curl * p.u0 * p.u0 : 0);
      const w1 = (p.e1 > 0 ? amp * p.e1 * Math.sin(ph - p.l1) : 0) + curl * p.u1 * p.u1;
      p.w0 = w0; p.w1 = w1;
      const th = Math.atan2(w1 - w0, p.d);       // the chord that joins them
      if (rig.vert) {                            // cetacean: the fluke plane is horizontal
        const c = Math.cos(-th), s = Math.sin(-th);
        p.m.position.x = p.hx + p.dx * c - p.dy * s;
        p.m.position.y = rig.spineY + p.dx * s + p.dy * c + w0;
        p.m.rotation.z = p.rz - th;
      } else {                                   // fish/shark: the caudal plane is vertical
        const c = Math.cos(th), s = Math.sin(th);
        p.m.position.x = p.hx + p.dx * c + p.dz * s;
        p.m.position.z = rig.spineZ - p.dx * s + p.dz * c + w0;
        p.m.rotation.y = p.ry + th;
      }
    }
  }

  // THE PECTORALS. aoa: angle of attack (+ = leading edge up), drop: both tips
  // down (+) / up (-), diff: one up one down (the turn), sweep: tips swept back.
  function posePecs(rig, aoa, drop, diff, sweep) {
    const pecs = rig.pecs;
    if (!pecs || !pecs.length) return;
    for (let i = 0; i < pecs.length; i++) {
      const q = pecs[i], s = q.s;
      // rotation.x lowers a +z fin's tip when positive and raises a -z fin's,
      // so `drop` is signed per side and `diff` is not.
      q.m.rotation.x = q.rx + drop * s + diff;
      q.m.rotation.y = q.ry - sweep * s;
      q.m.rotation.z = q.rz + aoa;
    }
  }

  /* THE WING AND THE FLIPPER. A manta does not swim with its tail and a
     turtle does not either; both FLY through the water on their pectorals.
     Before this they got the fish treatment — a tail wag and a pectoral
     trim — so a manta slid along with its wings held flat like a paper
     plane and a turtle wagged its stub tail. The phase comes from
     wildlife.js's sea motion (CBZ.wildlifeSwimPhase) whenever it is steering
     the animal, so each power stroke lands on the same frames as the surge
     of speed it produces; a ridden or otherwise-driven body falls back to
     the rig's own distance-driven beat.
       flap     both wings down together (0.5-1.0 rad at the root, deeper
                the harder it swims), a slow deep beat, the power stroke
                a touch deeper than the recovery.
       flipper  a turtle's flight stroke: down-and-back on the power stroke
                with the blade square to the water, then up feathered. */
  function strokePecs(a, rig, dt) {
    const ph0 = CBZ.wildlifeSwimPhase ? CBZ.wildlifeSwimPhase(a) : null;
    let ph;
    if (ph0 != null && !a.ridden) ph = ph0;
    else { rig.sph += dt * (1.6 + 3.2 * rig.spd01) * (1 - 0.7 * rig.glide); ph = rig.sph; }
    const s = Math.sin(ph), c = Math.cos(ph);
    const turn = Math.max(-0.3, Math.min(0.3, rig.turn * 0.25));
    if (rig.style === "flap") {
      const amp = 0.5 + 0.3 * rig.spd01 + 0.2 * rig.burst;
      // + drop = tips down; the upstroke is a touch shallower than the power stroke
      const drop = s > 0 ? amp * s : amp * 0.8 * s;
      posePecs(rig, 0.12 * c, drop, turn, 0.06 * rig.spd01);
    } else {
      const drop = 0.5 * s;                     // down on the power stroke
      const sweep = 0.32 * (0.5 - 0.5 * c);     // ..and swept back through it
      const feather = -0.35 * c;                // blade edge-on on the recovery
      posePecs(rig, feather, drop, turn, sweep);
    }
  }

  // the skinned swimmer's frame (speed, glide and the rest already eased by
  // animateSwim): beat, bend, pectorals or stroke, then the bank and pitch
  function animateMarine(a, rig, dt, moved, vy) {
    const grp = a.group;
    rig.lodT -= dt;
    if (rig.lodT <= 0) { rig.lodT = 0.3; marineLod(a, rig); }
    const w = rig.wave;
    const blps = Math.max(0, rig.vS);
    const f = Math.min(w.fMax, w.f0 + w.fK * blps) * (1 + 0.25 * rig.burst);
    rig.ph += dt * 6.283185307 * f * (1 - 0.75 * rig.glide);
    if (rig.ph > 1e6) rig.ph -= 1e6;
    // a hovering body still breathes a slow, shallow beat
    const swing = moved > 0.002 ? 1 : 0.35;
    rig.k += (swing - rig.k) * ez(4, dt);
    const ampMul = (0.55 + 0.45 * rig.spd01) * (1 + 0.35 * rig.burst) * (1 - 0.85 * rig.glide);
    const A = rig.amp * ampMul * rig.k * (rig.style ? 0.12 : 1);
    let dh = a.heading - rig.ph0;
    while (dh > Math.PI) dh -= 6.283185307; while (dh < -Math.PI) dh += 6.283185307;
    rig.turn += (dh / dt - rig.turn) * ez(6, dt);
    rig.ph0 = a.heading;
    // a turn bends the body into it; a poser's curl (breach arc, death) adds its own
    const curlWant = a._swimCurl ? Math.max(-1, Math.min(1, a._swimCurl)) : 0;
    rig.curl += (curlWant - rig.curl) * ez(6, dt);
    const bend = (Math.max(-0.12, Math.min(0.12, rig.turn * 0.09)) * (rig.vert ? 0 : 1) + rig.curl * CURL_AMP) * rig.L;
    poseMarine(rig, A, rig.ph, bend, dt);
    // a seize's head shake and clamped jaw (systems/predator.js writes
    // a._mSeize every frame it holds something): the head saws, the neck and
    // the tail stock swing against it, the jaw stays shut on what it holds
    const ms = a._mSeize;
    if (ms && ms.on) {
      const B = rig.marine.bones, ix = rig.marine.ix;
      if (B[ix.head]) B[ix.head].rotation.y += ms.yaw;
      if (B[ix.neck]) B[ix.neck].rotation.y -= ms.yaw * 0.45;
      if (ix.t1 != null && B[ix.t1]) B[ix.t1].rotation.y -= ms.yaw * 0.30;
      applyMarineJaw(rig, ms.jaw >= 0 ? ms.jaw : (rig.jawK < 0 ? 0 : rig.jawK));
    }
    if (rig.style) strokeMarine(a, rig, dt);
    else if (rig.pecs.length) {
      // trim: leading edge up to climb, down to dive; flare on braking;
      // swept back at a rush; differential in a turn; a slow scull at rest
      const trim = Math.max(-0.30, Math.min(0.30, rig.vyS * 0.5));
      const idle = (1 - rig.spd01) * Math.sin(rig.ph * 0.5) * 0.05;
      const aoa = trim + 0.45 * rig.brake + idle;
      const drop = 0.35 * rig.brake - 0.08 * rig.spd01 + idle * 0.6;
      const diff = Math.max(-0.25, Math.min(0.25, rig.turn * 0.15));
      const sweep = 0.18 * rig.spd01 - 0.12 * rig.brake;
      poseMarinePecs(rig, aoa, drop, diff, sweep);
    }
    rig.yawSwing = 0;                 // the recoil lives in the bones now
    if ((a._flinchT || 0) <= 0 && (a._atkAnim == null || a._atkAnim < 0)) {
      const wantRoll = Math.max(-0.5, Math.min(0.5, rig.turn * 0.25 * (0.5 + 0.5 * rig.k)));
      const wantPitch = Math.max(-0.5, Math.min(0.5, vy * 0.11));
      const e = ez(3.2, dt);
      rig.roll += (wantRoll - rig.roll) * e;
      rig.pitch += (wantPitch - rig.pitch) * e;
      const posed = !!a._poseOwn;
      a._poseOwn = false;
      if (!posed) { grp.rotation.x = rig.roll; grp.rotation.z = rig.pitch; }
    }
  }

  function animateSwim(a, dt) {
    const rig = a.swim; if (!rig) return;
    const grp = a.group;
    if (grp.visible === false) return;            // out of the LOD radius: no mesh work
    if (!(dt > 0)) return;
    const mx = grp.position.x, mz = grp.position.z, my = grp.position.y;
    const mdx = rig.px == null ? 0 : mx - rig.px;
    const mdz = rig.pz == null ? 0 : mz - rig.pz;
    let moved = Math.sqrt(mdx * mdx + mdz * mdz);
    const first = rig.px == null;
    const vy = (rig.py == null) ? 0 : (my - rig.py) / dt;
    rig.px = mx; rig.pz = mz; rig.py = my;
    // a teleport / recovery jump is not swimming
    const wlen = Math.max(0.5, rig.len * (grp.scale && grp.scale.x ? grp.scale.x : 1));
    if (moved > wlen * 3) moved = 0;

    // ---- SPEED, ACCELERATION, BRAKING (all in body lengths, all eased) ----
    const blps = moved / dt / wlen;
    let accRaw = 0;                                // BL/s^2
    if (first) rig.vS = -1;                        // no speed until two samples exist
    else if (rig.vS < 0) rig.vS = blps;
    else { const vPrev = rig.vS; rig.vS += (blps - rig.vS) * ez(5, dt); accRaw = (rig.vS - vPrev) / dt; }
    rig.acc += (accRaw - rig.acc) * ez(6, dt);
    rig.burst += (Math.max(0, Math.min(1, rig.acc / 1.1)) - rig.burst) * ez(8, dt);
    rig.brake += (Math.max(0, Math.min(1, -rig.acc / 0.9)) - rig.brake) * ez(6, dt);
    const wantS = Math.max(0, Math.min(1, (Math.max(0, rig.vS) - SPD_LO) / (SPD_HI - SPD_LO)));
    rig.spd01 += (wantS - rig.spd01) * ez(4, dt);
    rig.vyS += (vy / wlen - rig.vyS) * ez(4, dt);

    // ---- BURST AND GLIDE -------------------------------------------------
    // A braking body glides; an unhurried wild one alternates beats and
    // coasts. The schedule is hashed per animal (no Math.random, no shared
    // stream), and anything urgent (accelerating, rushing, ridden) beats.
    let glideWant = rig.brake;
    if (a._mmGlide != null && !a.ridden) {
      // wildlife.js's sea motion owns the coast now (the body really slows in
      // it), so the tail goes quiet on exactly the frames the speed drops
      rig.gliding = false;
      if (a._mmGlide > 0) glideWant = Math.max(glideWant, 0.9);
    } else if (!a.ridden && moved > 0) {
      rig.gT -= dt;
      const calm = rig.spd01 < 0.5 && rig.burst < 0.25 && !(a._atkAnim >= 0);
      if (rig.gliding) {
        if (rig.gT <= 0 || !calm) { rig.gliding = false; rig.gT = 2.2 + hashG(a, rig) * 3.2; }
      } else if (rig.gT <= 0 && calm) {
        rig.gliding = true; rig.gT = 0.9 + hashG(a, rig) * 1.5;
      } else if (rig.gT <= 0) rig.gT = 0.5;
      if (rig.gliding) glideWant = Math.max(glideWant, 0.9);
    } else rig.gliding = false;
    rig.glide += (Math.min(1, glideWant) - rig.glide) * ez(rig.glide < glideWant ? 3.5 : 5, dt);

    if (rig.marine) { animateMarine(a, rig, dt, moved, vy); return; }

    // ---- THE BEAT ----------------------------------------------------------
    // Frequency rides distance (so it scales with speed), plus the kick of
    // acceleration, minus the glide. Capped so nothing ever blurs.
    // rig.freq is per MODEL unit (6 / model length) and `moved` is metres, so
    // it is divided by the scale: a 0.3 m sardine drawn at scale 0.2 beat its
    // tail five times too slowly — a fish sliding along on a lazy wag.
    // (Only the small side is corrected: the big bodies' beats were tuned by
    // eye against the old law and belong to the shark/orca passes.)
    const sc0 = Math.min(1, (grp.scale && grp.scale.x) || 1);
    const adv = Math.min(Math.min(moved, 1.5) / sc0 * rig.freq, dt * 24)
              + dt * (0.9 + 9 * rig.burst);
    rig.ph += adv * (1 - 0.8 * rig.glide);
    if (rig.ph > 1e6) rig.ph -= 1e6;
    const swing = moved > 0.002 ? 1 : 0.4;
    rig.k += (swing - rig.k) * ez(4, dt);
    const ampMul = (AMP_SLOW + (AMP_FAST - AMP_SLOW) * rig.spd01) * (1 + 0.45 * rig.burst) * (1 - 0.85 * rig.glide);
    const amp = rig.amp * ampMul * rig.k * (rig.style ? 0.3 : 1);
    // CURL: a poser's static bend (breach arc, death), eased.
    const curlWant = a._swimCurl ? Math.max(-1, Math.min(1, a._swimCurl)) : 0;
    rig.curl += (curlWant - rig.curl) * ez(6, dt);
    if (rig.tspan > 0) poseTail(rig, amp, rig.ph, rig.curl * CURL_AMP * rig.len);
    // THE TRUNK IS NOT A PLANK: the head yaws against the tail beat, harder
    // the harder it swims (lateral swimmers; a cetacean nods instead).
    const bodySwing = -BODY_SWING * (0.35 + 0.65 * rig.spd01) * (1 + 0.5 * rig.burst) *
      (1 - 0.85 * rig.glide) * rig.k * Math.sin(rig.ph);
    rig.yawSwing = rig.vert ? 0 : bodySwing;

    // ---- TURN RATE (for the bank and the pectorals) ------------------------
    let dh = a.heading - rig.ph0;
    while (dh > Math.PI) dh -= 6.283185307; while (dh < -Math.PI) dh += 6.283185307;
    rig.turn += (dh / dt - rig.turn) * ez(6, dt);
    rig.ph0 = a.heading;

    // ---- PECTORALS ---------------------------------------------------------
    // trim: leading edge up to climb, down to dive; flare on braking; swept
    // back at a rush; differential in a turn; a slow scull at rest.
    if (rig.pecs && rig.pecs.length && rig.style) strokePecs(a, rig, dt);
    else if (rig.pecs && rig.pecs.length) {
      const trim = Math.max(-0.32, Math.min(0.32, rig.vyS * 0.55));
      const idle = (1 - rig.spd01) * Math.sin(rig.ph * 0.5) * 0.05;
      const aoa = trim + 0.55 * rig.brake + idle;
      const drop = 0.45 * rig.brake - 0.10 * rig.spd01 + idle * 0.6;
      const diff = Math.max(-0.3, Math.min(0.3, rig.turn * 0.18));
      const sweep = 0.22 * rig.spd01 - 0.15 * rig.brake;
      posePecs(rig, aoa, drop, diff, sweep);
    }

    /* ---- WHOEVER POSED THIS BODY LAST FRAME KEEPS IT ----------------------
       THE ORDER THIS FILE ASSUMES IS NOT THE ORDER THAT RUNS. `CBZ.onUpdate`
       (config.js) only PUSHES onto CBZ.updaters and core/loop.js sorts that
       list exactly ONCE, at load, and wildlife.js registers its 47.1 lazily at
       world-build time — so it runs LAST, after the orca pose (47.2), the
       shark breach (47.22) and marine_frenzy. A write trap on one orca caught
       this function flattening a 40-degree spy-hop to two degrees every frame.
       The baton is order-INDEPENDENT: a poser stamps a._poseOwn when it writes
       an attitude, and this function yields for exactly that one frame and
       clears the stamp. */
    // BODY: bank into the turn (rotation.x rolls a +X-forward body) and pitch
    // with vertical speed (rotation.z) — a diving shark noses down. Yielded
    // whenever a flinch or a creature_combat strike owns the transform.
    if ((a._flinchT || 0) <= 0 && (a._atkAnim == null || a._atkAnim < 0)) {
      const wantRoll = Math.max(-0.5, Math.min(0.5, rig.turn * 0.25 * (0.5 + 0.5 * rig.k)));
      const wantPitch = Math.max(-0.5, Math.min(0.5, vy * 0.11));
      const e = ez(3.2, dt);
      /* The rig keeps EASING even while it is yielding, so the frame a pose
         ends the swim attitude is already where the body actually is and there
         is no snap back to a stale angle. Only the two writes are yielded. */
      rig.roll += (wantRoll - rig.roll) * e;
      rig.pitch += (wantPitch - rig.pitch) * e;
      const posed = !!a._poseOwn;
      a._poseOwn = false;
      if (!posed) {
        grp.rotation.x = rig.roll;
        grp.rotation.z = rig.pitch + (rig.vert ? bodySwing * 0.6 : 0);
      }
      // The lateral swimmers' trunk swing lands on the YAW, which the mover
      // rewrites from `heading` every frame — so remember exactly what we left
      // behind: unchanged means nobody else wrote and our old offset has to
      // come off first; changed means that new value is the authoritative base.
      // A RIDDEN body's yaw is rewritten late by wildlife_tame.js, which adds
      // rig.yawSwing itself when no rider is drawn on it.
      if (!rig.vert && !a.ridden) {
        if (rig.swingLeft != null && grp.rotation.y === rig.swingLeft) grp.rotation.y -= rig.swingAdd;
        grp.rotation.y += bodySwing;
        rig.swingAdd = bodySwing; rig.swingLeft = grp.rotation.y;
      }
    }
  }

  function hashG(a, rig) {
    rig.nG++;
    return CBZ.hash01 ? CBZ.hash01(rig.nG * 7.13, rig.seed || 0, 73)
                      : ((rig.nG * 0.618034) % 1);
  }

  // ============================================================
  //  AQUATIC DEATH — goes limp, rolls, sinks (or floats).
  //
  //  Before this, every sea animal died through the LAND tumble: thrown
  //  upward at 1.6+ m/s against 20.5 m/s^2 of gravity, spun on three axes and
  //  "bounced" off an invisible floor at its swim depth, then settled on its
  //  side in mid-water and hung there. In water nothing bounces. A dying
  //  shark beats a few times, each weaker and slower, the tail goes slack,
  //  the body coasts to a stop, rolls belly-up and — no swim bladder — sinks
  //  nose-first to the bottom. Bony fish and cetaceans do the same beats and
  //  roll, then drift UP and lie belly-up under the surface.
  //
  //  One state object per corpse (a._aqDeath), no allocation per frame.
  //  Called from wildlife.js's death entry (wildlifeDeathTumble) for any
  //  aquatic body; everything else keeps the land tumble.
  // ============================================================
  function aquaticDeathBegin(a, dir) {
    const grp = a && a.group; if (!grp) return null;
    const sp = a.species || {};
    if (grp.rotation.order !== "YXZ") grp.rotation.order = "YXZ";
    const rig = a.swim;
    const sc = (grp.scale && grp.scale.x) || 1;
    const len = Math.max(0.5, (rig ? rig.len : 3) * sc);
    const v0 = rig && rig.vS > 0 ? Math.min(6, rig.vS * len) : 1.2;
    let side = grp.rotation.x >= 0 ? 1 : -1;
    if (Math.abs(grp.rotation.x) < 0.05 && dir) side = ((+dir.x || 0) + (+dir.z || 0)) >= 0 ? 1 : -1;
    const h = CBZ.hash01 ? CBZ.hash01(grp.position.x, grp.position.z, 91) : 0.5;
    const shark = !!(grp.userData && grp.userData.sharkShape) || /shark|megalodon|hammerhead|mako|tiger/.test(sp.id || "");
    a._aqDeath = {
      t: 0, v0: v0, head: a.heading || 0,
      // belly-up, a little off true so no two corpses lie identically
      rollTo: side * (2.55 + h * 0.5),
      pitchTo: shark ? -(0.28 + h * 0.2) : (0.05 + h * 0.1),
      sink: shark, vy: 0, len: len,
      ph: rig ? rig.ph : 0, amp0: rig ? rig.amp * 1.35 : 0, curl: (h - 0.5) * 0.7,
      done: false,
    };
    return a._aqDeath;
  }

  function aquaticDeathStep(a, dt) {
    const D = a && a._aqDeath, grp = a && a.group;
    if (!D || !grp || !(dt > 0)) return false;
    if (D.done) return false;
    const step = Math.min(0.05, dt);
    D.t += step;
    const t = D.t;
    // COAST: the corpse keeps the way it had and loses it to drag
    const v = D.v0 * Math.exp(-t * 1.1);
    grp.position.x += Math.cos(D.head) * v * step;
    grp.position.z += Math.sin(D.head) * v * step;
    // ROLL + NOSE: slow, heavy, eased — the roll starts once the beats fade
    const rollK = t < 0.6 ? 0.35 : 0.9;
    grp.rotation.x += (D.rollTo - grp.rotation.x) * ez(rollK, step);
    grp.rotation.z += (D.pitchTo - grp.rotation.z) * ez(0.8, step);
    // SINK / FLOAT against the live column
    const x = grp.position.x, z = grp.position.z;
    const surf = CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0;
    const depth = CBZ.cityWaterDepthAt ? Math.max(0, CBZ.cityWaterDepthAt(x, z)) : 30;
    const bed = surf - depth + Math.max(0.25, D.len * 0.09);
    if (D.sink) {
      const vt = -Math.min(1.1, 0.35 + D.len * 0.05);        // terminal sink rate
      D.vy += (vt - D.vy) * ez(0.6, step);
      grp.position.y += D.vy * step;
      if (grp.position.y < bed) { grp.position.y = bed; D.vy = 0; }
    } else {
      const top = surf - Math.max(0.12, D.len * 0.06);
      D.vy += ((top - grp.position.y) * 0.5 - D.vy) * ez(1.2, step);
      grp.position.y += D.vy * step;
      if (grp.position.y > top) grp.position.y = top;
    }
    // THE LAST BEATS: fast and strong at first, each weaker and slower, then
    // slack with a lazy bend. Only when the body is drawn.
    const rig = a.swim;
    if (rig && rig.marine && grp.visible !== false) {
      const env = Math.exp(-t * 1.5);
      D.ph += step * (3 + 11 * Math.exp(-t * 0.9));
      poseMarine(rig, D.amp0 * env, D.ph, D.curl * Math.min(1, t * 0.5) * CURL_AMP * rig.L, step);
      if (rig.style) { rig.spd01 = 0; rig.glide = 1; strokeMarine(a, rig, step * env); }
      else poseMarinePecs(rig, 0.1 * env, 0.30 * Math.min(1, t), 0, 0);
      if (t < 1.2 && swimJaw) swimJaw(a, 0.25 * Math.min(1, t * 2));
    } else if (rig && grp.visible !== false) {
      const env = Math.exp(-t * 1.5);
      D.ph += step * (3 + 11 * Math.exp(-t * 0.9));
      if (rig.tspan > 0) poseTail(rig, D.amp0 * env, D.ph, D.curl * Math.min(1, t * 0.5) * CURL_AMP * rig.len);
      posePecs(rig, 0.1 * env, 0.35 * Math.min(1, t), 0, 0);
      if (t < 1.2 && swimJaw) swimJaw(a, 0.25 * Math.min(1, t * 2));
    }
    // settled: sunk to the bed, or floating, and fully still
    if (t > 14) { D.done = true; return false; }
    return true;
  }
  CBZ.aquaticDeathBegin = aquaticDeathBegin;
  CBZ.aquaticDeathStep = aquaticDeathStep;

  CBZ.buildSwimRig = buildSwimRig;
  CBZ.animateSwim = animateSwim;
  CBZ.swimJaw = swimJaw;

  CBZ.wildlifeRig = {
    CLASSES: CLASSES,
    classify: classify,
    meshDims: meshDims,
    buildGait: buildGaitRig,
    animateGait: gaitAnimate,
    buildSwim: buildSwimRig,
    animateSwim: animateSwim,
    swimJaw: swimJaw,
  };
})();
