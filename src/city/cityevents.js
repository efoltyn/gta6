/* ============================================================
   city/cityevents.js — the CITY EVENT BUS + per-ped PANIC that makes the
   crowd flee like PEOPLE, not robots.

   THE PROBLEM this fixes: the old crowd reaction (CBZ.cityPanic / cityAlarm)
   was an instant, UNIFORM scatter — one gunshot and every meek ped within a
   radius flips to flee on the SAME frame, a synchronized starburst that reads
   as scripted. Real crowds don't do that: a few people closest to the bang
   bolt first, the fear RIPPLES outward as those runners spook their neighbours,
   the brave/nosy stop and GAWK instead of running, and everyone's threshold to
   break is different. That texture is what this file adds.

   HOW (kept dirt-cheap at ~1000 agents):
     • A small fixed RING of events (CBZ.cityPostEvent) — alloc-free, overwrite
       oldest. Emit sites (gunfx muzzle, a fresh corpse, an explosion, a landed
       punch) push {type,pos,radius,intensity}; they DON'T walk the crowd.
     • ONE city-gated onUpdate pass (order 33.5 — after aigoals@33, before the
       ped brain @34, so a flee flipped here is acted on the SAME frame) walks
       the live events, NOT the peds: for each event it buckets the near-rig
       subjects with the shared spatial hash (CBZ.makeGrid) and only touches the
       handful inside the event radius → O(events × local), never O(npcs).
     • Each subject carries `panic` ∈ [0,1]. An event adds intensity·(1−d/r);
       a panicking neighbour within 4m adds CONTAGION (this is the ripple); every
       frame it bleeds off by a small decay. Per-ped `bravery` (derived from the
       existing aggr spectrum) sets WHERE on that scale the ped breaks — so a
       meek tourist bolts at a whiff while a hardened ganger just turns to watch.
     • Cross the break threshold → CBZ.cityFleeFrom (peds.js owns the vetted
       away-heading). Brave/curious peds instead GAWK: face the event, hold a
       beat. Variety, for free.

   OWNERSHIP: this file is ADDITIVE. It never edits the ped brain — it only sets
   peds.js-owned fields the brain already honours (state="flee" via cityFleeFrom,
   group.rotation for the gawk facing) plus three NEW fields it alone owns
   (panic, bravery, _gawkT). The instanced ambient crowd (crowd.js) has no public
   flee hook and crowd.js is out of scope this wave, so panic-driven flee runs on
   the full-rig peds (CBZ.cityPeds) — the agents you can actually read close up.
   This layers ON TOP of the existing cityPanic instant-scatter; the two don't
   fight (cityFleeFrom is idempotent — re-flee just re-vets the heading).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const A0 = () => (CBZ.CITY && CBZ.CITY.aggro) || {};

  // ---- the EVENT RING ---------------------------------------------------
  // Fixed-size, alloc-free. Each slot is a pre-built record we OVERWRITE in
  // place (never `new` in the hot path). When the ring wraps it clobbers the
  // oldest unprocessed event — fine: a stale event a few frames old has already
  // had its chance to scare everyone in range. `age` (frames) lets the delivery
  // pass treat each posted event ONCE per subject set, then age it out so a
  // single shot doesn't keep re-scaring the same standing crowd every frame.
  const RING = 24;                       // plenty: emit sites are sparse per frame
  const evType = new Array(RING);
  const evX = new Float32Array(RING), evZ = new Float32Array(RING);
  const evR = new Float32Array(RING), evInt = new Float32Array(RING);
  const evAge = new Float32Array(RING);  // seconds since posted; <0 = empty slot
  for (let i = 0; i < RING; i++) { evType[i] = null; evAge[i] = -1; }
  let evHead = 0;                        // next write slot (overwrite oldest)

  // How long a posted event keeps radiating fear before it ages out. Short — a
  // gunshot is a momentary scare, not a lingering field; the panic it LEAVES on
  // each ped (and the neighbour contagion) is what sustains the flee.
  const EVENT_TTL = 0.6;

  // CBZ.cityPostEvent({type,pos,radius,intensity}) — the public emit. Guarded so
  // emit-site one-liners can call it unconditionally. pos may be a {x,y,z}/Vector3
  // (gunfire muzzle) or a {x,z} (ground event); we read x/z only.
  CBZ.cityPostEvent = function (ev) {
    if (!ev || !ev.pos) return;
    const i = evHead;
    evHead = (evHead + 1) % RING;
    evType[i] = ev.type || "noise";
    evX[i] = ev.pos.x || 0;
    evZ[i] = ev.pos.z || 0;
    evR[i] = ev.radius > 0 ? ev.radius : 24;
    evInt[i] = ev.intensity > 0 ? ev.intensity : 1;
    evAge[i] = 0;
    // also scatter the INSTANCED background crowd (crowd.js). The full-rig peds react
    // in the delivery pass below; this closes the gap where the 760-strong mass kept
    // strolling through gunfire. Gated inside cityCrowdFlee by CBZ.crowdMassFlee
    // (default OFF); intensity gate keeps minor noises from stampeding the street.
    if (CBZ.cityCrowdFlee && evInt[i] >= 0.5) CBZ.cityCrowdFlee(evX[i], evZ[i], evR[i], evInt[i]);
  };

  // ---- spatial hash over the near subjects ------------------------------
  // Lazily built (CBZ.makeGrid may not exist yet at module load). Cell ~ the
  // contagion radius so a 3×3 cell sweep covers both "in event radius" and the
  // neighbour scan with one structure. Rebuilt once per delivery pass from the
  // SUBJECT list we collect below (not all peds — only the alive, reactive ones
  // near the camera), so the grid stays small and the rebuild stays cheap.
  const GRID_CELL = 8;
  let grid = null;
  // module-level scratch — the per-pass subject list, reused (never reallocated).
  // Holds peds we might scare this frame: alive, free-willed, near enough to see.
  const subjects = [];
  // distance-bucket gate: only rigs within this of the camera are SUBJECTS. Past
  // it a ped is a far dead-reckoned dot the player can't read anyway, so scaring
  // it is invisible work. Matches the rig "mid LOD" band (peds.js FAR_D2=110²).
  const SUBJECT_D2 = 120 * 120;

  // bravery from the personality spectrum: meek (low aggr) breaks at a hair of
  // panic; the violent barely break at all. We map aggr→bravery once per ped and
  // cache it (bravery doesn't change once spawned). The night recast / promotion
  // can rewrite aggr; we re-derive lazily whenever the cached source disagrees.
  function braveryOf(p) {
    if (p.bravery != null && p._braverySrc === p.aggr) return p.bravery;
    const a = p.aggr != null ? p.aggr : 0.24;
    // 0 aggr → ~0.12 bravery (panics almost instantly); 1 aggr → ~0.95 (rock).
    // A touch of per-ped jitter off the deterministic slice so two identical-aggr
    // peds don't break on the EXACT same frame (kills the synchronized look).
    const jitter = ((p.slice || 0) % 7) * 0.012;
    p.bravery = Math.max(0.08, Math.min(0.97, 0.12 + a * 0.85 + jitter));
    p._braverySrc = p.aggr;
    return p.bravery;
  }

  // can this ped REACT at all right now? Skip the busy/owned/non-free states the
  // ped brain (and other systems) are already driving — never yank a driver, a
  // surrendering ped, a controlled companion, a corpse, etc. into a flee.
  function reactive(p) {
    if (!p || p.dead || p._parked || p.inCar) return false;
    if (p.ko > 0 || p.controlled || p.companion || p.recruited) return false;
    if (p.surrender || p.vendor) return false;     // hands-up / shopkeepers hold their post
    return true;
  }

  // ---- the delivery + panic-integration pass ----------------------------
  // Runs every frame in city mode. Two phases over the (small) subject list:
  //   1) DECAY each subject's standing panic a little (so fear fades).
  //   2) For every live event, scare the subjects inside its radius, then add
  //      neighbour CONTAGION, then resolve flee-vs-gawk on the threshold cross.
  // Phase 2 is driven by the EVENTS (few) and the GRID (local), so it's
  // O(events × localSubjects), independent of the full crowd size.
  const DECAY = 0.9;                 // panic bleed per second (≈0.015/frame @60)
  const CONTAGION_R2 = 4 * 4;        // a neighbour within 4m spreads fear
  const PANIC_THRESH = 0.55;         // base break point (scaled DOWN by bravery)
  const GAWK_HOLD = 1.6;             // seconds a gawker faces the event

  CBZ.onUpdate(33.5, function (dt) {
    if (g.mode !== "city") return;
    const peds = CBZ.cityPeds;
    if (!peds || !peds.length) return;
    if (!grid && CBZ.makeGrid) grid = CBZ.makeGrid(GRID_CELL);

    // age the ring; find whether ANY event is still live this frame. (Cheap —
    // RING is tiny.) If nothing's radiating we still want to decay standing
    // panic + tick gawk timers, so we don't early-out on "no events".
    let anyLive = false;
    for (let i = 0; i < RING; i++) {
      if (evAge[i] < 0) continue;
      evAge[i] += dt;
      if (evAge[i] > EVENT_TTL) { evAge[i] = -1; evType[i] = null; }
      else anyLive = true;
    }

    // ---- gather SUBJECTS (alive, reactive, near camera) -------------------
    const cam = CBZ.camera;
    const camx = cam ? cam.position.x : 0, camz = cam ? cam.position.z : 0;
    subjects.length = 0;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      // FRESH-CORPSE event sourcing: peds.js owns ped death (off-limits here), so
      // we detect a newly-dead rig ourselves and post a "dead-body" scare ONCE.
      // Cheap: one flag check per ped, and only the first frame after a death
      // actually posts. This keeps the corpse emit out of the forbidden file.
      if (p.dead) {
        if (!p._panicCorpseSeen) {
          p._panicCorpseSeen = true;
          if (p.pos) CBZ.cityPostEvent({ type: "dead-body", pos: p.pos, radius: 12, intensity: 0.8 });
        }
        continue;
      }
      if (!reactive(p)) continue;
      const dx = p.pos.x - camx, dz = p.pos.z - camz;
      if (dx * dx + dz * dz > SUBJECT_D2) {
        // out of read range: still let any standing panic bleed off so it isn't
        // frozen mid-fear when it walks back into view, but no event/contagion work.
        if (p.panic > 0) p.panic = Math.max(0, p.panic - DECAY * dt);
        if (p._gawkT > 0) p._gawkT -= dt;
        continue;
      }
      subjects.push(p);
    }
    const ns = subjects.length;
    if (!ns) return;

    // phase 1: standing-panic decay + gawk-hold tick for every near subject.
    for (let s = 0; s < ns; s++) {
      const p = subjects[s];
      if (p.panic > 0) p.panic = Math.max(0, p.panic - DECAY * dt);
      if (p._gawkT > 0) {
        p._gawkT -= dt;
        // keep the gawker turned toward what they're watching while the hold lasts
        if (p._gawkT > 0 && p.group && p._gawkX !== undefined) {
          const dx = p._gawkX - p.pos.x, dz = p._gawkZ - p.pos.z;
          if (dx * dx + dz * dz > 0.25) p.group.rotation.y = Math.atan2(dx, dz);
        }
      }
    }

    if (anyLive) {
      // (re)bucket the subjects so the per-event radius sweep + the contagion scan
      // are both local cell lookups. One rebuild per pass amortized over all events.
      if (grid) grid.rebuild(subjects, _subjVec);

      // phase 2a: direct fear from each live event onto subjects in its radius.
      for (let e = 0; e < RING; e++) {
        if (evAge[e] < 0) continue;
        // only the FIRST frame of an event delivers its full hit; subsequent
        // frames within TTL keep it "live" for contagion bookkeeping but don't
        // re-stack direct fear (else a standing crowd ratchets to max every frame).
        if (evAge[e] > dt * 1.5) continue;
        const ex = evX[e], ez = evZ[e], er = evR[e], inten = evInt[e];
        const r2 = er * er;
        if (grid) {
          const gx = grid.cellIndex(ex), gz = grid.cellIndex(ez);
          // how many cells out the radius reaches (radius/cell, rounded up).
          const span = Math.ceil(er / GRID_CELL);
          for (let ix = gx - span; ix <= gx + span; ix++) {
            for (let iz = gz - span; iz <= gz + span; iz++) {
              const a = grid.bucket(ix, iz); if (!a) continue;
              for (let k = 0; k < a.length; k++) scare(a[k], ex, ez, r2, er, inten);
            }
          }
        } else {
          // no grid (makeGrid missing): fall back to the linear subject scan.
          for (let s = 0; s < ns; s++) scare(subjects[s], ex, ez, r2, er, inten);
        }
      }
    }

    // phase 2b: CONTAGION + resolve. Walk the subjects once; a subject already
    // panicking (>0.5) infects its near neighbours (the ripple), then every
    // subject over its personal threshold breaks (flee) or, if brave/nosy, gawks.
    for (let s = 0; s < ns; s++) {
      const p = subjects[s];
      // CONTAGION: pick up a little extra panic from any spooked neighbour. Grid
      // makes this local; without it we skip contagion (the direct fear + decay
      // still give non-uniform behaviour, just no ripple).
      if (grid && p.panic < 0.95) {
        const gx = grid.cellIndex(p.pos.x), gz = grid.cellIndex(p.pos.z);
        for (let ix = gx - 1; ix <= gx + 1; ix++) {
          for (let iz = gz - 1; iz <= gz + 1; iz++) {
            const a = grid.bucket(ix, iz); if (!a) continue;
            for (let k = 0; k < a.length; k++) {
              const o = a[k];
              if (o === p || o.panic <= 0.5) continue;
              const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z, dd = dx * dx + dz * dz;
              if (dd >= CONTAGION_R2) continue;
              // closer + more panicked neighbour spreads more, scaled by dt.
              p.panic = Math.min(1, p.panic + o.panic * (1 - dd / CONTAGION_R2) * 0.6 * dt);
            }
          }
        }
      }
      if (p.panic <= 0) continue;
      resolve(p, dt);
    }
  });

  // getVec for the grid rebuild — module-level so it's not a per-frame closure.
  function _subjVec(p) { return p.pos; }

  // add direct fear to one subject from an event at (ex,ez) radius `er` (r2 cached).
  function scare(p, ex, ez, r2, er, inten) {
    const dx = p.pos.x - ex, dz = p.pos.z - ez, dd = dx * dx + dz * dz;
    if (dd >= r2) return;
    const fall = 1 - Math.sqrt(dd) / er;          // 1 at centre → 0 at the edge
    p.panic = Math.min(1, (p.panic || 0) + inten * fall);
    // remember WHERE the scare came from, so a break flees away from it / a gawk
    // faces it. Latest (usually nearest/loudest) source wins.
    p._panicSrcX = ex; p._panicSrcZ = ez;
  }

  // a subject with standing panic decides: flee, gawk, or just stew.
  function resolve(p, dt) {
    // already committed to a flee/fight? let that play out — don't re-trigger.
    if (p.state === "flee" || p.rage || p.state === "fight") return;
    const bravery = braveryOf(p);
    // bravery RAISES the break point: a meek ped (bravery~0.12) breaks at ~0.49,
    // a hardened one (bravery~0.95) needs ~1.07 (i.e. effectively never on its
    // own — only a point-blank max-intensity blast pushes it there).
    const thresh = PANIC_THRESH + bravery * 0.55;
    if (p.panic < thresh) return;
    const sx = p._panicSrcX, sz = p._panicSrcZ;
    if (sx === undefined) return;
    // GAWK vs FLEE. The bold+ don't run from a distant scare — they rubberneck:
    // face the commotion, hold a beat. (A point-blank max scare still flips even
    // the bold via the high panic, but a gunshot across the street just turns
    // their head — the variety the crowd was missing.) Only flee the meek/wary,
    // OR anyone whose panic has truly maxed (right on top of it).
    const bold = p.aggr >= (A0().bold || 0.5);
    if (bold && p.panic < 0.92) {
      // start (or refresh) a gawk hold if not already gawking
      if ((p._gawkT || 0) <= 0) {
        p._gawkT = GAWK_HOLD;
        p._gawkX = sx; p._gawkZ = sz;
        // face it now; the phase-1 tick keeps them turned for the hold
        if (p.group) {
          const dx = sx - p.pos.x, dz = sz - p.pos.z;
          if (dx * dx + dz * dz > 0.25) p.group.rotation.y = Math.atan2(dx, dz);
        }
        // a brief flinch read (reactions.js consumes poseCower) sells the startle
        p.poseCower = Math.max(p.poseCower || 0, 0.4);
      }
      return;
    }
    // BREAK AND RUN — peds.js owns the vetted away-heading + scream punctuation.
    if (CBZ.cityFleeFrom) {
      p.fear = Math.min(10, (p.fear || 0) + 6);   // feed the ped brain's own fear scale
      p.alarmed = Math.max(p.alarmed || 0, 5);
      CBZ.cityFleeFrom(p, sx, sz);
    }
  }
})();
