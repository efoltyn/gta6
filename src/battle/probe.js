"use strict";
/* src/battle/probe.js — NPC War: PROBE: window.__battle, the studio seam.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ PROBE
   The reuse claim, checkable instead of asserted. */
let dbgWall = 0, dbgN = 0;

/* THE FAULTS YOU CAN SEE, COUNTED. A battle you WATCH has exactly one class
   of bug that matters: the kind that shows. Each of these is a thing a
   person would point at on the screen, turned into an integer, so
   tools/battle-check.mjs can hold it at zero instead of somebody squinting.
   Read-only: it never touches a man. */
const QUAL = { overlapPeak: 0, overlapWorstEver: null, embeddedEver: 0,
  blindFire: 0, throughMate: 0, throughSand: 0, fratricide: 0, bodyW: 0,
  stuckSeen: 0, wallSeconds: 0, firstShotT: -1 };
function bodyWidth() {
  if (QUAL.bodyW) return QUAL.bodyW;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || !m.group) continue;
    try {
      const b = new THREE.Box3().setFromObject(m.group);
      QUAL.bodyW = Math.round(Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 1000) / 1000;
    } catch (e) { QUAL.bodyW = -1; }
    break;
  }
  return QUAL.bodyW;
}
/* OVERLAP IS A PAIR'S QUESTION, NOT A CONSTANT.

   0.62 m is the number for two MEN — 0.52 m across the shoulders plus a
   little. Applied to a lion it is meaningless and applied to an elephant it
   is a joke: this probe reported "0 overlap" for armies of animals visibly
   standing inside each other, because it was measuring them with a man's
   shoulders. The threshold is now a FRACTION of the pair's own radii, and
   the fraction is chosen so two men still resolve to exactly 0.62 —
   0.69 * (0.45 + 0.45) — which keeps every number this probe has ever
   reported for a man's war comparable with the ones before it. */
const OVERLAP_K = 0.69;
const BODY_CLEAR = 0.62;      // two men, for the audit line that names it
function quality() {
  const live = [];
  for (let i = 0; i < men.length; i++) if (!men[i].dead) live.push(men[i]);
  let pairs = 0, worst = 9;
  // O(n^2) is fine in a probe and honest in a way a grid pass is not: the
  // grid is the thing under test, so the check must not share its blind spots
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const dx = live[j].pos.x - live[i].pos.x, dz = live[j].pos.z - live[i].pos.z;
      /* TWO MEN ON DIFFERENT LEVELS ARE NOT OVERLAPPING. This probe measured
         XZ alone, which was exactly right while every venue was a flat
         plate. Now that the ground is measured, `gov` has a terrace 3.4 m
         above its lawn and the speedway is banked 11 m: a man on the steps
         and a man below him share a square metre of map and nothing else.
         A body is 1.8 m tall, so anything further apart in Y than that is
         two men in the same footprint on different floors — which is what a
         real venue is FOR. */
      if (Math.abs(live[j].pos.y - live[i].pos.y) >= 1.8) continue;
      const d = Math.hypot(dx, dz);
      const need = OVERLAP_K * ((live[i].rad || 0.45) + (live[j].rad || 0.45));
      if (d < need) {
        pairs++;
        // how deep, as a FRACTION of what this pair owed each other, so a
        // lion pair and a man pair are comparable numbers
        const bite = Math.round((d / need) * 100) / 100;
        if (bite < worst) worst = bite;
      }
    }
  }
  if (pairs > QUAL.overlapPeak) QUAL.overlapPeak = pairs;
  // the WORST gap ever seen, not the worst in the sample that happens to be
  // last — the failure line used to read "3 overlapping pairs (worst null m
  // apart)" because the peak accumulates and the distance did not
  if (pairs && (QUAL.overlapWorstEver == null || worst < QUAL.overlapWorstEver)) QUAL.overlapWorstEver = worst;
  let embedded = 0, stuck = 0, engaged = 0;
  const buf = [];
  for (let i = 0; i < live.length; i++) {
    const m = live[i];
    if (m.tgt && !m.tgt.dead && m.sees) engaged++;
    if ((m.stuckT || 0) > 3.5) stuck++;
    const cols = CBZ.micro.queryColliders(m.pos.x, m.pos.z, 0.1, buf);
    for (let c = 0; c < cols.length; c++) {
      const b = cols[c];
      if (!CBZ.micro.colliderContains(b, m.pos.x, m.pos.z)) continue;
      if (b.y0 != null && (m.pos.y + 0.9 < b.y0 || m.pos.y + 0.9 > b.y1)) continue;
      embedded++; break;
    }
  }
  if (embedded > QUAL.embeddedEver) QUAL.embeddedEver = embedded;
  if (stuck > QUAL.stuckSeen) QUAL.stuckSeen = stuck;
  return {
    alive: live.length, bodyW: bodyWidth(),
    overlapNow: pairs, overlapWorst: QUAL.overlapWorstEver, overlapPeak: QUAL.overlapPeak,
    embedded: embedded, embeddedEver: QUAL.embeddedEver,
    stuck: stuck, stuckPeak: QUAL.stuckSeen,
    // the separation pass's own verdict, and the cell it was run on
    sepResid: sepResid, fineCell: Math.round(FINE * 100) / 100,
    radMax: Math.round(bodyRadMax * 100) / 100,
    wallSeconds: Math.round(QUAL.wallSeconds * 10) / 10,
    blindFire: QUAL.blindFire, throughMate: QUAL.throughMate,
    throughSand: QUAL.throughSand, fratricide: QUAL.fratricide,
    firstShotT: QUAL.firstShotT,
    shots: stats.red.shots + stats.blue.shots, engaged: engaged,
    colliders: (CBZ.colliders && CBZ.colliders.length) || 0,
  };
}

/* THE BEAST AUDIT — and it is OFF unless the roster earns it.

   A battle of riflemen has no beast corpse to describe, and this used to be
   spelled inline in audit(): a sweep of every corpse on the field doing
   quaternion maths, plus the solver's own slot sweep, on every poll of a
   check that samples once a second for a minute. tools/battle-check.mjs
   holds a men-only war to `overlapPeak === 0` — a knife edge — so a probe
   that quietly costs more on the exact battle it is measuring is a probe
   that changes its own answer. Whole thing behind HAS_BEASTS. */
/* THE MEN'S DEATHS, and this one is NOT gated: men are almost always the
   roster, so "is anyone falling like a plank" is the question this page is
   most often asked. Three counters and one loop over the corpse list, which
   is the same loop the beast audit runs and is only ever read on a probe
   poll. `plank` is the number that matters — a body that resolved to the
   canned single-axis topple instead of the solver. */
function manAudit() {
  const o = { men: 0, ragdoll: 0, plank: 0, solver: null, mode: DEATH_OLD ? "old" : "ragdoll" };
  for (let i = 0; i < corpses.length; i++) {
    const c = corpses[i];
    if (c.beast || !c.char) continue;
    o.men++;
    if (c.ragdoll) o.ragdoll++; else o.plank++;
  }
  if (CBZ.ragdollAudit) o.solver = CBZ.ragdollAudit();
  return o;
}

const _EMPTY_AUDIT = {};
function beastAudit() {
  if (!HAS_BEASTS) return _EMPTY_AUDIT;
  const o = { beast: 0, ragdoll: 0, tumble: 0, topple: 0,
    standing: 0, noseUp: 0, flank: 0, noseWorst: 0 };
  for (let i = 0; i < corpses.length; i++) {
    const c = corpses[i];
    if (!c.beast || !c.group) continue;
    o.beast++;
    if (c.ragdoll) o.ragdoll++; else if (c.tumble) o.tumble++; else o.topple++;
    const q = c.group.quaternion;
    _upV.set(0, 1, 0).applyQuaternion(q);            // the body's own UP
    _fwV.set(1, 0, 0).applyQuaternion(q);            // ...and its NOSE (+X authored)
    if (_fwV.y > o.noseWorst) o.noseWorst = Math.round(_fwV.y * 100) / 100;
    if (_fwV.y > 0.5) o.noseUp++;
    else if (_upV.y > 0.62) o.standing++;
    else if (Math.abs(_upV.y) < 0.62) o.flank++;
  }
  return {
    deaths: o,
    deathMode: DEATH_OLD ? "old" : "ragdoll",
    solver: CBZ.quadRagdollAudit ? CBZ.quadRagdollAudit() : null,
    sinking: sinking.length,
    corpseMax: DEATH_OLD ? 260 : CORPSE_MAX,
    // the bite, measured: strikes that connected vs strikes whose jaws
    // closed short. (The blood behind them is bloodAudit(), below — it is
    // not the animals' and a rifle war can stain a street too.)
    bites: { landed: BITES.landed, missed: BITES.missed },
  };
}

/* BLOOD IS NOT THE ANIMALS'. This started life inside beastAudit() because
   the bite was the first thing on this page that drew any, and it therefore
   reported `null` for a rifle war that had loaded the pack with ?blood=1 and
   was staining the street. It belongs wherever gore.js is: one test, and the
   sweep itself only ever runs on a probe poll. */
function bloodAudit() {
  if (!CBZ.goreAudit) return null;
  const g = CBZ.goreAudit();
  return { pools: g.pools, streaks: g.streaks, visible: g.bloodVisible };
}
CBZ.npcwar.onBoot(function () {

  window.__battle = {
    quality: quality,
    audit: function () {
      return {
        clock: { frames: dbgN, wallSum: Math.round(dbgWall * 100) / 100 },
        map: SET.map, started: started, over: over, winner: winner,
        // the lightweight claim, measured: navigation start -> first frame
        ttff: firstFrameAt || null,
        kinds: { red: SET.redU, blue: SET.blueU },
        /* WHO IS STILL IN THE WATER, BY NAME. The red/blue counters answer
           "who is winning"; they cannot answer "did the pod finish the
           megalodon", which on a 8-v-1 is the only question being asked. One
           pass over the live roster, keyed by the species' own id. */
        alive: (function () {
          const o = {};
          for (let i = 0; i < men.length; i++) {
            const m = men[i]; if (m.dead) continue;
            const k = m.beast ? m.species.id : "men";
            o[k] = (o[k] || 0) + 1;
          }
          return o;
        })(),
        /* THE SEA, CHECKABLE. `rigged` is the one that matters: an aquatic body
           with no swim rig is the rigid-mesh-sliding-through-the-ocean bug, and
           it is invisible in a still frame at the wrong moment. */
        sea: SEA.on ? {
          surfaceY: Math.round(swellAt(MAP ? MAP.cx : 0, MAP ? MAP.cz : 0) * 100) / 100,
          seabed: SEA.seabed, trains: SEA.trains.length, boats: SEA.boats.length,
          underwater: !!SEA.under,
          rigged: (function () { let n = 0; for (let i = 0; i < men.length; i++) if (men[i].swim) n++; return n; })(),
          /* THE PREDICTION, WHEN THE SEA'S OWN MODEL IS IN THE ROOM.
             city/marine_predation.js solves "how many does it take" off the
             two time-to-kills (CBZ.marinePodNeeded) rather than typing a five
             into a file. This page is where that number gets to be WRONG in
             public: it states the prediction next to the roster that is
             actually in the water, so a preset can put the two in one column.
             Guarded — the pack does not carry that file, so it is null here
             until somebody puts it in one. */
          podNeeded: (function () {
            if (!CBZ.marinePodNeeded) return null;
            let hunter = null, quarry = null;
            for (let i = 0; i < men.length; i++) {
              const m = men[i];
              if (!m.beast || m.dead) continue;
              if (!hunter && m.team === "red") hunter = m;
              if (!quarry && m.team === "blue") quarry = m;
            }
            if (!hunter || !quarry) return null;
            try { return CBZ.marinePodNeeded(hunter, quarry); } catch (e) { return null; }
          })(),
          deepest: (function () {
            let d = 0;
            for (let i = 0; i < men.length; i++) if (!men[i].dead && (men[i].swimD || 0) > d) d = men[i].swimD;
            return Math.round(d * 100) / 100;
          })(),
        } : null,
        beasts: (function () { let n = 0; for (let i = 0; i < men.length; i++) if (men[i].beast && !men[i].dead) n++; return n; })(),
        steer: STEER_OLD ? "old" : "walls",
        swimMode: SWIM_OLD ? "old" : "rig",
        // the ground, as MEASURED off the raised venue (null for the maps that
        // author their own: city, dunes, arena). A checker can finally assert
        // that the surface men stand on is the surface that got built.
        ground: MEASURED,
        // whether this map CLAIMS to raise a venue. `ground: null` means one
        // thing on arena (it authors its own flat yard) and something else
        // entirely on marina (the venue failed to build) — without this flag a
        // checker cannot tell an honest null from a silent failure.
        raises: !!(MAPS[SET.map] && MAPS[SET.map].raise),
        gap: MAP ? Math.round(MAP.gap) : null,
        centre: MAP ? [Math.round(MAP.cx), Math.round(MAP.cz)] : null,
        // the fight window's own vertical span, measured off groundAt at
        // build — and whether the ground takes part in the sight lines
        relief: MAP ? MAP.relief : null,
        terrainLos: !!(MAP && MAP.terrainLos),
        men: men.length, red: aliveCount("red"), blue: aliveCount("blue"),
        // MORALE (read-only): army nerve 0..1, men running, men gone, and the
        // fight's shape — who is down in a fold, who broke, who is pinned
        morale: { red: Math.round(ARMY.red.morale * 100) / 100, blue: Math.round(ARMY.blue.morale * 100) / 100 },
        routing: { red: ARMY.red.routing, blue: ARMY.blue.routing },
        fled: { red: ARMY.red.fled, blue: ARMY.blue.fled },
        broken: { red: ARMY.red.broken, blue: ARMY.blue.broken },
        cover: (function () {
          let crouched = 0, inHull = 0, pinned = 0;
          for (let i = 0; i < men.length; i++) {
            const m = men[i];
            if (m.dead || m.beast) continue;
            if (m.stance === "crouch") crouched++;
            if (m.hull && m.slot === "hull") inHull++;
            if (m.supp > 0.35) pinned++;
          }
          return { crouched: crouched, hull: inHull, pinned: pinned, hullQ: hullQ, hullHit: hullHit };
        })(),
        queued: spawnQueue.length, corpses: corpses.length, rockets: rockets.length,
        /* THE DEAD, MEASURED — and measured on TWO axes, because the pose in
           the report is not the one a single axis catches.

           A carcass has three ways to be wrong and they need telling apart:
             standing  it came to rest on its own feet        (body up ≈ +Y)
             noseUp    it is SITTING UP, head at the sky      (body FORWARD ≈ +Y)
             flank     it is lying on its side — the correct one
           The first build of this probe read only the up vector, and under the
           reverted `rotation.z = 1.45` topple a nose-to-sky body reports
           up.y ≈ 0.12 — i.e. it scored as a perfect flank while looking exactly
           like the screenshot the owner sent. The forward axis is the one that
           separates them, so both are taken, off the group's real quaternion
           rather than off a rotation channel (the solver writes a quaternion;
           reading .z back off it answers a question nobody asked).

             solver   quadruped_ragdoll's own audit (solving / frozen / refused)
             deaths   how each beast corpse on the field actually resolved
             sinking  bodies mid-retirement (never a pop — retireOldestCorpse) */
        ...beastAudit(),
        dead: manAudit(),
        blood: bloodAudit(),
        solving: deadSolving,
        planes: planes.length, air: AIR.on, sticks: AIR.sticks || 0, nukes: AIR.nukes || 0,
        planesDbg: planes.map(function (p) {
          return { t: p.team, nuke: p.nuke, mode: p.egress ? "egress" : p.mode,
            cool: Math.round(p.dropCool * 10) / 10,
            d: Math.round(p._predD == null ? -1 : p._predD),
            x: Math.round(p.af.pos.x), y: Math.round(p.af.pos.y), z: Math.round(p.af.pos.z) };
        }),
        pixelRatio: RES.steps[RES.idx],
        fps: CBZ.micro.fps || 0,
        calls: (CBZ.renderer && CBZ.renderer.info) ? CBZ.renderer.info.render.calls : null,
        speed: speed, simT: Math.round(simT * 10) / 10,
        stats: JSON.parse(JSON.stringify(stats)),
        guns: JSON.parse(JSON.stringify(GUNS)),
        // the camera, checkable: which shot is up, who it is on, and whether
        // that man is genuinely at the front of his own army
        cam: (function () {
          const m = cam.followM;
          const foe = m ? teamCOM[m.team === "red" ? "blue" : "red"] : null;
          let ahead = null;
          if (m && foe) {
            const md = Math.hypot(m.pos.x - foe.x, m.pos.z - foe.z);
            let n = 0, tot = 0;
            for (let i = 0; i < men.length; i++) {
              const o = men[i];
              if (o.dead || o.team !== m.team) continue;
              tot++;
              if (Math.hypot(o.pos.x - foe.x, o.pos.z - foe.z) < md) n++;
            }
            // the fraction of his own army standing BEHIND him: 1 = the very
            // front of the group, 0 = the back rank the old camera rode
            ahead = tot ? Math.round((1 - n / tot) * 100) / 100 : null;
          }
          /* THE LOCKED LENS, STATED. A preset that says "photograph the
             megalodon" has to be able to prove the lens was on a megalodon and
             at a range derived from that body rather than from a constant, or
             the picture is an assertion. `underwater` is the sea's own read
             (SEA.under), so a shot claiming to be taken below the swell can be
             checked against the frame it produced. */
          const sm = STUDY.m && !STUDY.m.dead ? STUDY.m : null;
          return { mode: cam.mode, shot: cam.shot, team: cam.followTeam,
            on: m ? m.id : null, onDead: m ? !!m.dead : null, frontness: ahead,
            kills: m ? (m.kills || 0) : null, mag: m ? m.mag : null,
            reloads: m ? (m.reloads || 0) : null,
            pitch: Math.round(cam.pitch * 100) / 100,
            y: Math.round(CBZ.camera.position.y * 100) / 100,
            underwater: !!SEA.under,
            waveLock: !!cam.waveLock,
            study: sm ? {
              id: sm.id, species: sm.beast ? sm.species.id : "men",
              len: Math.round((sm.noseR || sm.rad || 0.5) * 2 * 100) / 100,
              range: Math.round(studyRange(sm) * 10) / 10,
              size: Math.round((sm._sizeMul || 1) * 100) / 100,
            } : null,
            killcam: { on: KILL.t > 0, fired: KILL.n } };
        })(),
        caps: CBZ.modeHas ? { blast: CBZ.modeHas("blast"), blastActors: CBZ.modeHas("blastActors") } : null,
        unrouted: CBZ.modeCapsAudit ? CBZ.modeCapsAudit().unrouted : null,
        colliders: (CBZ.colliders && CBZ.colliders.length) || 0,
        nav: { on: NAV.on, cells: NAV.w * NAV.h, blocked: NAV.blocked, solves: NAV.solves },
        town: town ? { lots: town.lots && town.lots.length, roads: town.roads && town.roads.length } : null,
        reuse: {
          iq: !!(CBZ.combatIQ && CBZ.combatIQ.shot), gunfx: !!CBZ.tracer,
          rig: !!CBZ.makeCharacter, guns: !!(CBZ.weaponAppearance && CBZ.weaponAppearance.ak47),
          gunPhysics: !!CBZ.weaponPhysics, wounds: !!CBZ.bodyWound,
        },
        bench: bench,
      };
    },
    speed: setSpeed,

    /* ---- THE STUDIO SEAM: run this war by hand ---------------------------
       freeze()   stop requestAnimationFrame. Nothing moves again until
                  advance() says so, which is what makes a screenshot a
                  statement about a moment rather than about a frame rate.
       advance(s) run exactly `s` seconds of THIS page's own frame, in fixed
                  steps, through microboot's headless stepSim — the same
                  always/updater/frame order the browser loop runs, minus the
                  renderer. Every clock in the battle (the sim, combat_iq's
                  CBZ.now, the corpse solver, the camera director) is driven
                  from that one frame, so they cannot drift apart.
       render()   draw the current state once, on demand.
       corpsesOf()where the dead actually are, so a tool can point a camera at
                  a body instead of guessing at the middle of the map.
       All read/drive-only, and none of it is reachable from play. */
    /* THE ORDERS, THE LINE AND THE SOLDIER, readable (tools/npcwar-headless.mjs) */
    orders: function () { return { red: ORDER.red, blue: ORDER.blue }; },
    tally: function () {
      const alive = { red: 0, blue: 0 }, routed = { red: 0, blue: 0 };
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m.dead || m.fled) continue;
        alive[m.team]++; if (m.routed) routed[m.team]++;
      }
      return { dead: { red: DEADN.red, blue: DEADN.blue }, fled: { red: ARMY.red.fled, blue: ARMY.blue.fled }, alive: alive, routed: routed, simT: simT, winner: winner };
    },
    drift: function () {
      const o = {};
      ["red", "blue"].forEach(function (t) {
        let n = 0, d = 0;
        for (let i = 0; i < men.length; i++) {
          const m = men[i];
          if (m.team !== t || m.dead || m.fled || !m.home) continue;
          n++; d += Math.hypot(m.pos.x - m.home.x, m.pos.z - m.home.z);
        }
        o[t] = n ? Math.round(d / n * 10) / 10 : null;
      });
      return o;
    },
    you: function () {
      const m = YOU.m || YOU.last;
      return { on: !!YOU.m, down: YOU.down, x: m ? m.pos.x : 0, z: m ? m.pos.z : 0,
        shots: m ? m.shotsF : 0, hits: m ? m.hitsF : 0, kills: m ? m.kills : 0, hp: m ? Math.round(m.hp) : 0 };
    },
    youFace: function () {
      const m = YOU.m; if (!m) return false;
      let best = null, bd = Infinity;
      for (let i = 0; i < men.length; i++) {
        const o = men[i];
        if (o.dead || o.fled || o.team === m.team) continue;
        const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) YOU.yaw = Math.atan2(best.pos.x - m.pos.x, best.pos.z - m.pos.z);
      return !!best;
    },
    youHurt: function (n) { if (YOU.m) hurtMan(YOU.m, n, { byTeam: YOU.m.team === "red" ? "blue" : "red" }); return YOU.down; },
    /* TAKE OVER, by hand (player.js takeOver). sel: a unit, "a:3" / "b:0"
       (that side's body by spawn index), or a unit id (the first living one;
       "a:lion" names the side too). */
    take: function (sel) {
      let u = sel && sel.pos ? sel : null;
      if (!u && typeof sel === "string") {
        const ix = /^([ab]):(\d+)$/.exec(sel), sd = /^([ab]):(.+)$/.exec(sel);
        for (let i = 0; i < men.length && !u; i++) {
          const m = men[i];
          if (m.dead || m.fled || m.inVeh) continue;
          if (ix) { if (m.team === (ix[1] === "a" ? "red" : "blue") && m.i === +ix[2]) u = m; continue; }
          const id = sd ? sd[2] : sel;
          if (sd && m.team !== (sd[1] === "a" ? "red" : "blue")) continue;
          if ((m.species && m.species.id === id) || m.unitId === id || (id === "men" && !m.beast && !m.vehicle)) u = m;
        }
      }
      return u ? takeOver(u) : false;
    },
    // a tool's thumbs: { ax, az, run, atk, yaw } instead of the keys (null = the keys)
    youDrive: function (d) { YOU.drive = d || null; return true; },
    youState: function () {
      const m = YOU.m, t = YOU.tgt;
      return { on: !!m, kind: youKind(m), id: m ? m.id : null, hp: m ? Math.round(m.hp) : 0,
        kills: m ? (m.kills || 0) : 0, tgt: t && !t.dead ? t.id : null,
        tgtDist: t && m ? Math.round(Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) * 10) / 10 : null,
        strike: YOU.strike ? YOU.strike.mv.id : null, beat: !!YOU.beat, down: YOU.down,
        moves: YOU.moves || null, hits: YOU.hits || 0, whiffs: YOU.whiffs || 0, tossed: men.filter(function (o) { return !!o._tossed; }).length };
    },
    // where the director is looking and why
    director: function () {
      return { mode: cam.mode, shot: cam.shot, on: cam.followM ? cam.followM.id : null, score: Math.round(cam.score * 10) / 10,
        cuts: cam.cuts, slow: SLOW.n, fov: Math.round(cam.fov * 10) / 10, events: CAMEV.length };
    },
    freeze: function () {
      if (CBZ.micro.stop) CBZ.micro.stop();
      lastWall = 0;                       // the next real frame must not see a gap
      return true;
    },
    advance: function (sec, step) {
      const h = Math.max(1 / 240, Math.min(0.05, step || 1 / 60));
      let left = Math.max(0, +sec || 0), n = 0;
      while (left > 1e-4 && n < 6000) {
        const d = Math.min(h, left);
        injectDt = d;
        CBZ.micro.stepSim(d);
        left -= d; n++;
      }
      return { frames: n, simT: Math.round(simT * 100) / 100 };
    },
    render: function () {
      const R = CBZ.renderer || (CBZ.micro && CBZ.micro.renderer);
      if (R && CBZ.camera) { try { R.render(CBZ.scene, CBZ.camera); } catch (e) {} }
      return true;
    },
    corpsesOf: function (beastOnly) {
      const out = [];
      for (let i = 0; i < corpses.length; i++) {
        const c = corpses[i];
        if (beastOnly && !c.beast) continue;
        out.push({ id: c.id, beast: !!c.beast, team: c.team,
          x: Math.round(c.pos.x * 100) / 100, y: Math.round(c.pos.y * 100) / 100,
          z: Math.round(c.pos.z * 100) / 100,
          ragdoll: !!c.ragdoll, h: c.eyeH || 1 });
      }
      return out;
    },
    /* PARK THE CAMERA ON ONE BODY, at a stated offset. `look()` frames the
       hottest FIGHT, which is the right shot for a spectator and the wrong one
       for a photograph of a corpse — the thing under discussion is by
       definition no longer where the fighting is. */
    // the built props of this map (containers, barriers, crates, reef, wreck,
    // boats) with where they stand, so a capture can frame the scenery itself
    scenery: function () { return SCENERY.map(function (o) { return Object.assign({}, o); }); },
    mapCentre: function () { return MAP ? { x: MAP.cx, z: MAP.cz } : null; },
    lookAt: function (p, off, pitch) {
      cam.mode = "free";
      cam.wFocus.set(p.x, (p.y || 0) + (p.h || 0.5), p.z);
      cam.focus.copy(cam.wFocus);
      cam.wDist = cam.dist = off == null ? 9 : off;
      cam.wPitch = cam.pitch = pitch == null ? 0.30 : pitch;
      if (p.yaw != null) cam.wYaw = cam.yaw = p.yaw;
      return true;
    },

    // park the camera on the hottest fight at a chosen range — the seam a
    // screenshot tool needs, and the one the director already computes
    // `at` (optional {x,z}) overrides the director's own hotspot. The hotspot
    // is the right answer for "show me the battle" and the wrong one for
    // "show me THAT animal": tools/ape-shot.mjs has to frame one gorilla's
    // arms, and the densest fight is rarely where it is standing.
    look: function (dist, pitch, yaw, at) {
      const hs = at || hotspot();
      cam.mode = "free";
      if (hs) { cam.wFocus.set(hs.x, MAP.groundAt(hs.x, hs.z), hs.z); cam.focus.copy(cam.wFocus); }
      cam.wDist = cam.dist = dist || 40;
      cam.wPitch = cam.pitch = pitch == null ? 0.4 : pitch;
      if (yaw != null) cam.wYaw = cam.yaw = yaw;
      return hs;
    },
    /* ---- THE STUDY DESK, FROM A TOOL --------------------------------------
       camMode(mode, pick, yaw) puts the page into one of the locked postures
       and, optionally, on a NAMED body — `pick` is a species id ("megalodon")
       or an index into the living roster. `yaw` states the orbit angle and
       STOPS the orbit, because a photograph taken while the lens is drifting
       is a photograph of a different bearing on each side of a comparison.
       Returns what the lens ended up on, so a preset can assert it. */
    camMode: function (mode, pick, yaw) {
      if (pick != null) studyPickBy(pick);
      if (yaw != null) { STUDY.orbit = +yaw || 0; STUDY.spin = 0; }
      setCamMode(mode);
      // one framing pass now, so the caller does not have to advance the world
      // by a frame just to find out where the camera went
      if (mode === "study") frameStudy(0);
      else if (mode === "under") frameUnder(0);
      else if (mode === "surface") frameWave(0);
      cam.focus.copy(cam.wFocus); cam.yaw = cam.wYaw;
      cam.pitch = cam.wPitch; cam.dist = cam.wDist;
      camApply(1);
      const m = STUDY.m;
      return m ? { id: m.id, species: m.beast ? m.species.id : "men",
        range: Math.round(studyRange(m) * 10) / 10,
        x: Math.round(m.pos.x * 100) / 100, y: Math.round(m.pos.y * 100) / 100,
        z: Math.round(m.pos.z * 100) / 100 } : null;
    },
    // every living animal the study desk can be pointed at, in its own order
    swimmers: function () {
      return studyList().map(function (m) {
        return { id: m.id, team: m.team, species: m.beast ? m.species.id : "men",
          len: Math.round((m.noseR || m.rad || 0.5) * 2 * 100) / 100,
          hp: Math.round(m.hp), depth: Math.round((m.swimD || 0) * 100) / 100,
          x: Math.round(m.pos.x * 100) / 100, y: Math.round(m.pos.y * 100) / 100,
          z: Math.round(m.pos.z * 100) / 100 };
      });
    },
    /* ---- RESTAGE: ANOTHER MATCHUP, THE SAME OCEAN -----------------------
       A TEST BED YOU HAVE TO RELOAD IS NOT A TEST BED.

       Every other way of changing what is fighting here goes back through the
       war room and a full boot — the studio, the packs, the swell, the reef,
       the navmesh — which costs seconds and, worse, hands you a DIFFERENT
       ocean to judge the second fight in. This clears the field and streams a
       new roster onto the same water: the same swell, the reef where it was,
       so "eight orcas" and "one great white in a bait ball" are two shots of
       one place rather than two pages that happen to both be blue.

       It clears exactly what a death clears, through the same calls — the two
       corpse solvers get their slots handed back, every group leaves through
       studio.drop, the ordnance registry loses its targets, and the spawn
       claims go with the roster that made them. Anything it forgot would show
       up as a body standing in the water with nothing driving it, which is a
       thing you can see rather than a thing you have to trust.

       Drive-only: nothing on the page reaches it and no key is bound to it. */
    restage: function (o) {
      o = o || {};
      for (let i = 0; i < men.length; i++) {
        const m = men[i];
        if (m.ordTgt && CBZ.ordnance && CBZ.ordnance.removeTarget) {
          try { CBZ.ordnance.removeTarget(m.ordTgt); } catch (e) {}
        }
        m.ordTgt = null;
        if (CBZ.quadRagdollDrop) { try { CBZ.quadRagdollDrop(m); } catch (e) {} }
        if (CBZ.ragdollDrop) { try { CBZ.ragdollDrop(m); } catch (e) {} }
        if (m.group) { try { CBZ.studio.drop(m.group); } catch (e) {} }
      }
      for (let i = 0; i < sinking.length; i++) { try { CBZ.studio.drop(sinking[i].g); } catch (e) {} }
      for (let i = 0; i < dropGuns.length; i++) {
        const g = dropGuns[i];
        if (g && g.parent) g.parent.remove(g);
      }
      men.length = 0; corpses.length = 0; sinking.length = 0;
      if (STORE) STORE = CBZ.battleStore.create(STORE.cap);
      dropGuns.length = 0; rockets.length = 0; spawnQueue.length = 0;
      squads.red.length = 0; squads.blue.length = 0;
      deadSolving = 0;
      clearClaims();
      cam.followM = null; STUDY.m = null; STUDY.idx = 0;
      KILL.t = 0; KILL.m = null; KILL.cool = 0;
      over = false; winner = null;
      el("end").style.display = "none";
      stats.red.kills = stats.red.shots = stats.red.hits = 0;
      stats.blue.kills = stats.blue.shots = stats.blue.hits = 0;
      if (o.ru) SET.redU = o.ru;
      if (o.bu) SET.blueU = o.bu;
      if (o.rw) SET.redW = o.rw;
      if (o.bw) SET.blueW = o.bw;
      if (o.rt) SET.redT = o.rt;
      if (o.bt) SET.blueT = o.bt;
      // ZERO IS A ROSTER. "The arena with nothing in it" is the first thing a
      // test bed has to be able to show — it is the shot that proves the water
      // is water before anything is swimming in it.
      SET.redN = o.rn == null ? SET.redN : Math.max(0, o.rn | 0);
      SET.blueN = o.bn == null ? SET.blueN : Math.max(0, o.bn | 0);
      HAS_BEASTS = rosterHasBeasts();
      spawnCount.red = SET.redN; spawnCount.blue = SET.blueN;
      spawnTotal = SET.redN + SET.blueN;
      for (let i = 0; i < Math.max(SET.redN, SET.blueN); i++) {
        if (i < SET.redN) spawnQueue.push(["red", i]);
        if (i < SET.blueN) spawnQueue.push(["blue", i]);
      }
      // all of them, now: a tool that asked for a matchup wants the matchup,
      // not ten of it per frame for the next four seconds
      if (o.now !== false) { let g = 0; while (spawnQueue.length && g++ < 4000) drainSpawns(); }
      return { red: SET.redN, blue: SET.blueN, ru: SET.redU, bu: SET.blueU, bodies: men.length };
    },
    reinforce: function (n) { queueMen(n || 10); },
    /* THE LIVE CAST, BY REFERENCE. Every probe above answers a question about
       the ARMY (how many, how far apart, how many rounds); tools/ape-check.mjs
       needs to ask a question about a BODY — is this man still flagged as held
       by something that no longer exists — and no counter can carry that. It
       is the same array the sim walks, deliberately: a copy would let a stale
       flag hide behind the copy. */
    roster: function () { return men; },
    // the squad brain's ledger: tasks, tactics fired, per-tier think cost (ai/squad.js)
    tactics: function () { return tacticsReadout(); },
    /* WHICH PAIRS, AND WHAT WERE THEY DOING. An overlap COUNT tells you the
       bodies are wrong; it never tells you which rule put them there, and
       three rules can produce the same number. This lists the live offenders
       with the state of both parties, which is how the surround ring and the
       strike approach were each caught. Read-only, probe-only. */
    overlaps: function (n) {
      const live = [];
      for (let i = 0; i < men.length; i++) if (!men[i].dead) live.push(men[i]);
      const out = [];
      for (let i = 0; i < live.length && out.length < (n || 12); i++) {
        for (let j = i + 1; j < live.length && out.length < (n || 12); j++) {
          const a = live[i], b = live[j];
          if (Math.abs(a.pos.y - b.pos.y) >= 1.8) continue;
          const d = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
          const need = OVERLAP_K * ((a.rad || 0.45) + (b.rad || 0.45));
          if (d >= need) continue;
          out.push({
            a: a.id, b: b.id, d: Math.round(d * 100) / 100,
            need: Math.round(need * 100) / 100,
            same: a.team === b.team,
            kind: (a.beast ? "beast" : "man") + "/" + (b.beast ? "beast" : "man"),
            slotA: a.slot, slotB: b.slot,
            striking: [(a._atkAnim >= 0), (b._atkAnim >= 0)],
            tgtA: a.tgt && !a.tgt.dead ? a.tgt.id : null,
            tgtB: b.tgt && !b.tgt.dead ? b.tgt.id : null,
            sameTgt: !!(a.tgt && a.tgt === b.tgt),
          });
        }
      }
      return out;
    },
    debugMen: function (n) {
      const out = [];
      for (let i = 0; i < men.length && out.length < (n || 4); i++) {
        const m = men[i];
        if (m.dead) continue;
        const row = { id: m.id, x: Math.round(m.pos.x), z: Math.round(m.pos.z),
          slot: m.slot, sees: !!m.sees, mag: m.mag, rel: Math.round((m.reloadT || 0) * 10) / 10,
          cool: Math.round(m.cool * 100) / 100,
          tgt: m.tgt && !m.tgt.dead ? m.tgt.id : null,
          tx: Math.round(m.target.x), tz: Math.round(m.target.z) };
        if (m.tgt && !m.tgt.dead) row.d = Math.round(Math.hypot(m.tgt.pos.x - m.pos.x, m.tgt.pos.z - m.pos.z) * 10) / 10;
        // the beast's fight-loop internals, so a probe can SEE why an animal
        // is or is not striking instead of inferring it from the scoreboard
        if (m.beast) {
          row.beast = m.species.id; row.reach = Math.round(m.reach * 100) / 100;
          row.nose = Math.round((m.noseR || 0) * 100) / 100;
          row.rad = Math.round((m.rad || 0) * 100) / 100;
          row.k = Math.round((m._sizeMul || 1) * 100) / 100;
          row.atkT = m._atkT == null ? null : Math.round(m._atkT * 100) / 100;
          row.anim = m._atkAnim == null ? null : Math.round(m._atkAnim * 100) / 100;
          row.hp = Math.round(m.hp);
          // the discovered rig, auditable: leg columns found, and the
          // walks-where-it-faces invariant the rig maintains (1 = aligned)
          row.legs = m.gait ? m.gait.cols.length : 0;
          row.align = m._motionAlignment == null ? null : Math.round(m._motionAlignment * 100) / 100;
        }
        out.push(row);
      }
      return out;
    },
  };

  // a shared link or a bench run skips the menu; kicked from here so every
  // declaration above is live before begin() touches it
  if (SET.auto || SET.bench) {
    // the roster's unit files (a tiger, a tank) first; a men-only war runs on
    // the same tick (load.js withUnits)
    const go = function () { withUnits(function () { begin(SET.bench); }); };
    const need = packsFor();
    if (need.length) CBZ.studio.need(need).then(go); else go();
  }
});
