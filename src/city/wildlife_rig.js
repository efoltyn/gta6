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
        for (let c = 0; c < cols.length; c++) {
          if (Math.abs(cols[c].x - m.position.x) <= 0.14 && Math.abs(cols[c].z - m.position.z) <= 0.14) { col = cols[c]; break; }
        }
        if (!col) { col = { x: m.position.x, z: m.position.z, top: 0, h: d.h, parts: [] }; cols.push(col); }
        col.top = Math.max(col.top, m.position.y + d.h / 2);
        col.h = Math.max(col.h, d.h);
        col.parts.push({ m: m, bx: m.position.x, by: m.position.y });
      } else {
        rest.push({ m: m, d: d, bottom: bottom });
      }
    }
    if (cols.length < 2 || cols.length > 8) return;      // no readable legs — glide
    // sweep 2: feet / pads / leg stripes stacked on a column ride with it
    const head = [];
    let headMesh = null, headVol = 0;
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i], m = r.m;
      let joined = false;
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        if (Math.abs(col.x - m.position.x) <= 0.13 && Math.abs(col.z - m.position.z) <= 0.13 &&
            m.position.y - r.d.h / 2 < col.top && r.d.h <= col.h * 1.2) {
          col.parts.push({ m: m, bx: m.position.x, by: m.position.y });
          joined = true; break;
        }
      }
      // head cluster (for the graze dip): far forward, up off the ground
      if (!joined && maxX > 0.4 && m.position.x >= maxX * 0.55 && r.bottom >= 0.3) {
        head.push({ m: m, bx: m.position.x, by: m.position.y, bottom: r.bottom });
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
    const cls = classify(sp);
    a.gait = {
      cols: cols, head: head.length ? head : null, dip: dip, headMesh: headMesh,
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
        for (let p = 0; p < col.parts.length; p++) {
          const pt = col.parts[p];
          pt.m.position.x = pt.bx + s;
          pt.m.position.y = pt.by + up;
        }
      }
    } else if (gt.k <= 0.02 && gt._setl !== 1) {
      gt._setl = 1;
      for (let c = 0; c < gt.cols.length; c++) {
        const col = gt.cols[c];
        for (let p = 0; p < col.parts.length; p++) { const pt = col.parts[p]; pt.m.position.x = pt.bx; pt.m.position.y = pt.by; }
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
        const dy = gt.dip * gt.grazeK, dx = gt.dip * 0.3 * gt.grazeK;
        for (let i = 0; i < gt.head.length; i++) {
          const h = gt.head[i];
          h.m.position.y = h.by - dy;
          h.m.position.x = h.bx + dx;
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

  function buildSwimRig(a) {
    const sp = a.species, grp = a.group;
    if (!sp.aquatic || sp.snake) return;
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

    // ---- THE BEAT ----------------------------------------------------------
    // Frequency rides distance (so it scales with speed), plus the kick of
    // acceleration, minus the glide. Capped so nothing ever blurs.
    const adv = Math.min(Math.min(moved, 1.5) * rig.freq, dt * 24)
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
    if (rig && grp.visible !== false) {
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
