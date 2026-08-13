/* ============================================================
   city/tsunami.js — THE SEA COMES ASHORE, IN THE REAL WORLD.

   A tsunami already existed in this game and you could never see it: it lived
   in systems/disasters.js, bound to the survival mode's own arena, drawn as
   its own rising mesh over its own island. The main world — the one with the
   beach, the marina, the harbour, the boats, the sharks — had no such thing,
   and could not have had one, because a flood built as a separate rising mesh
   has to be individually taught to every system that cares about water. That
   is why it stayed in the arena.

   THIS ONE AUTHORS NO WATER AT ALL.
   ---------------------------------
   The whole event is ONE NUMBER: CBZ.waterSurgeSet(metres), the sea-level
   offset in world/water_spec.js. Everything else in the game is already
   downstream of sea level:

     • the ocean shader displaces from it, and its shoreline cut walks inland
       with it, so the rendered waterline moves;
     • city/waterfield.js's water mask moves with it, so "is there water here"
       becomes true for streets that were dry — which is what makes it real to
       swimming, drowning, buoyancy, the gore medium and the underwater view;
     • every boat and floating body reads that same surface, so the marina
       lifts on its lines and a drifting corpse rides in over the seawall;
     • the sharks read it too, and their reach is a water test, so deep water
       coming inland means what deep water coming inland means.

   None of those files were told a tsunami exists. That is the entire design.

   THE SHAPE OF THE EVENT — and why the drawdown matters most
   ---------------------------------------------------------
   WARN: the sea pulls OUT. A negative surge, held long enough to be noticed,
   and it is the only warning you get. It is also the real one — the receding
   ocean is the signal that has actually saved lives — and it beats a siren
   because it is information you have to KNOW how to read rather than a label
   telling you what to feel. Boats settle onto the mud, the reef shows.

   SURGE: the sea comes back, fast and much further. HOLD: it stands over the
   waterfront. DRAIN: it goes out slowly, over most of a minute, and what it
   drags with it is the part people remember.

   The event is deliberately RARE and always announced by the water rather than
   by the HUD, and it never fires unattended: no player anywhere near the coast
   means no tsunami, because a disaster nobody witnesses is a save-file event,
   not a scene.

   THE SCARY WATER (2026-08-03) — owner's references: Miyako 2011 at landfall
   (a churning GRAY-BLACK debris soup boiling over the seawall, cars and logs
   tumbling INSIDE it as battering rams, nothing clean or blue about it) and
   the open-sea face (a towering curl with a spray-torn crest). Three things
   were added, and all three are SHARED with the island tsunami in
   systems/disasters.js, because a tsunami that looks different in two modes
   is two tsunamis:
     • the FACE — one curling bore, world/water_spec.js's CBZ.tsuFaceBuild,
       turbid and boiling at landfall, a tall blue-green curl in deep water;
     • the DEBRIS — CBZ.tsuDebrisField, below. Real parked cars and real
       buildings, entrained at the front, tumbling, striking people through
       each mode's own kill bus, stranded where the drain leaves them;
     • the UNDERTOW — the drain pulls seaward harder than anyone can swim,
       and being taken past the shoreline with the breath meter running is a
       death with its own name.

   Flags: TSUNAMI (whole file) · TSUNAMI_AUTO (does it ever fire on its own) ·
   TSUNAMI_PEAK (metres at the crest) · TSUNAMI_PERIOD (mean seconds between) ·
   TSU_FACE_V2 · TSU_DEBRIS · TSU_UNDERTOW (each a one-line revert, and each
   read by BOTH tsunamis).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  if (CBZ.CONFIG.TSUNAMI == null) CBZ.CONFIG.TSUNAMI = true;
  // ON, because a disaster nothing can trigger is exactly the stat fiction
  // CLAUDE.md bans — a complete event behind a door that never opens. It is
  // made safe to leave on by being RARE (TSUNAMI_PERIOD), by never firing
  // unless the player is actually on the coast to see it, and above all by
  // announcing itself with 19 seconds of drawdown before the water turns
  // round. You are not ambushed; you are warned, in the only language the
  // sea has. ?cfg_TSUNAMI_AUTO=0 leaves CBZ.cityTsunami() as the only trigger.
  if (CBZ.CONFIG.TSUNAMI_AUTO == null) CBZ.CONFIG.TSUNAMI_AUTO = true;
  if (CBZ.CONFIG.TSUNAMI_PEAK == null) CBZ.CONFIG.TSUNAMI_PEAK = 5.4;      // metres above mean
  if (CBZ.CONFIG.TSUNAMI_DRAW == null) CBZ.CONFIG.TSUNAMI_DRAW = -2.6;     // metres of drawdown
  if (CBZ.CONFIG.TSUNAMI_PERIOD == null) CBZ.CONFIG.TSUNAMI_PERIOD = 2400; // s between auto events

  /* ---- THE THREE FLAGS OF THE SCARY-WATER WAVE ---------------------------
     Declared HERE, in the tsunami's own file, and consumed by BOTH tsunamis
     (this one and systems/disasters.js's DEFS.flood) through a null-check —
     because there is one tsunami design and two places it happens, and a flag
     that means one thing on the island and another in the city is not a flag.

     TSU_FACE_V2  the shared curling bore face (CBZ.tsuFaceBuild in
                  world/water_spec.js): turbid gray-black at landfall, a
                  towering blue-green curl in deep water. false = the old
                  per-mode face (the island keeps its legacy ribbon; the city
                  goes back to having no face at all).
     TSU_DEBRIS   entrainment. Real world objects — parked cars, trees, the
                  fragments of buildings the water has already taken — picked
                  up at the front, tumbling INSIDE the flow, striking people as
                  battering rams, stranded where the drain leaves them.
     TSU_UNDERTOW the drain's seaward current, strong enough that swimming
                  against it away from cover does not work. */
  if (CBZ.CONFIG.TSU_FACE_V2 == null) CBZ.CONFIG.TSU_FACE_V2 = true;
  if (CBZ.CONFIG.TSU_DEBRIS == null) CBZ.CONFIG.TSU_DEBRIS = true;
  if (CBZ.CONFIG.TSU_UNDERTOW == null) CBZ.CONFIG.TSU_UNDERTOW = true;

  function on() { return CBZ.CONFIG.TSUNAMI !== false && !!CBZ.waterSurgeSet; }

  /* ============================================================
     THE DEBRIS FIELD — WHAT ACTUALLY KILLS PEOPLE IN A TSUNAMI.

     Owner's science, and the whole reason this exists: "tsunami deaths are
     rarely just drowning. The wave is a churning high-speed soup of cars,
     trees, steel, building fragments. Primary death: blunt force trauma —
     battered and crushed by debris acting as battering rams."

     So the water does not kill you here. The things IN it do, and they are
     real things: the car that was parked on the seafront, the tree that was
     growing behind it, the house that went past you thirty seconds ago. They
     are picked up at the front, they TUMBLE inside the flow (a car in a bore
     does not drive, it rolls), they hit people at closing speed, and when the
     water leaves they are simply left where they stopped — which is the image
     everybody who has seen the aftermath footage remembers.

     ONE FIELD, TWO CONSUMERS. This file drives the city's;
     systems/disasters.js drives the island's with the same object and the same
     motion, because a tsunami that looks different in two modes is two
     tsunamis. Neither of them owns a physics bus: the kit reports a STRIKE
     with a cause string and the caller routes it through its own kill bus
     (CBZ.surv.hurt on the island, CBZ.cityKillPed / cityHurtPlayer here).

     cfg: {
       root          Object3D to parent spawned fragments to
       seaY(x,z)     water surface height  (the ONE shared surface, always)
       groundY(x,z)  terrain height
       forEachActor(fn)  fn(actor) — actor.pos{x,y,z}, actor.isPlayer, actor.dead
       strike(actor, info)  info {kind, speed, dirX, dirZ, force, damage, cause}
       againstWall(x,z)     optional; true if a body here has a wall behind it
     }
     ============================================================ */
  const DEB_RAND = () => Math.random();     // runtime FX only — never a build path

  CBZ.tsuDebrisField = function (cfg) {
    cfg = cfg || {};
    const root = cfg.root || null;
    const seaY = cfg.seaY || function () { return 0; };
    const groundY = cfg.groundY || function () { return 0; };
    const items = [];
    const owned = [];              // geometries/materials this field must dispose
    let entrained = 0, strikes = 0, kills = 0, checkPhase = 0;

    // pooled shapes: one geometry + one material per debris class
    let logGeo = null, logMat = null, panelGeo = null, panelMat = null, rubbleGeo = null, rubbleMat = null;
    function pool() {
      if (logGeo) return;
      logGeo = new THREE.CylinderGeometry(0.34, 0.28, 5.4, 7);
      logGeo.rotateZ(Math.PI / 2);
      logMat = new THREE.MeshLambertMaterial({ color: 0x4a3a26 });
      panelGeo = new THREE.BoxGeometry(2.6, 0.16, 1.5);
      panelMat = new THREE.MeshLambertMaterial({ color: 0x7d6749 });
      rubbleGeo = new THREE.BoxGeometry(0.9, 0.6, 0.8);
      rubbleMat = new THREE.MeshLambertMaterial({ color: 0x6d7076 });
      owned.push(logGeo, logMat, panelGeo, panelMat, rubbleGeo, rubbleMat);
    }

    /* MASS IS THE WHOLE POINT. A plank rides on top and stings; a car is two
       tonnes moving at the speed of the water and it kills whatever it meets.
       These three numbers are the only difference between the classes.       */
    const CLASS = {
      car:    { drift: 0.78, hitR: 2.5, dmg: 92, force: 17, sink: 0.55, spin: 1.5 },
      log:    { drift: 0.94, hitR: 1.9, dmg: 44, force: 11, sink: 0.18, spin: 3.0 },
      panel:  { drift: 1.00, hitR: 1.5, dmg: 26, force: 8,  sink: 0.10, spin: 3.6 },
      rubble: { drift: 0.70, hitR: 1.1, dmg: 34, force: 9,  sink: 0.35, spin: 4.2 },
    };

    function add(obj, x, z, kind, opts) {
      opts = opts || {};
      const k = CLASS[kind] ? kind : "panel";
      const it = {
        obj: obj, x: x, z: z, kind: k, cls: CLASS[k],
        ph: DEB_RAND() * 6.28,
        sx: (DEB_RAND() - 0.5) * 2, sy: (DEB_RAND() - 0.5) * 2, sz: (DEB_RAND() - 0.5) * 2,
        yaw: DEB_RAND() * 6.28, roll: 0, pitch: 0,
        lat: (DEB_RAND() - 0.5) * 0.9,
        stranded: false, hitCd: 0, onStrand: opts.onStrand || null, dispose: !!opts.dispose,
      };
      items.push(it); entrained++;
      return it;
    }

    return {
      /* ENTRAIN A REAL WORLD OBJECT. The caller has already taken it out of
         whatever system owned it (pulled its collider, marked the record dead)
         — this only takes over where it is drawn. */
      take(obj, x, z, kind) { return obj ? add(obj, x, z, kind) : null; },

      /* THE WRECKAGE OF SOMETHING THE WATER ALREADY TOOK: n pieces of a
         wood-frame house at (x,z), joining the same flow that removed it. */
      shed(x, z, n, kind) {
        if (!root) return 0;
        pool();
        const k = kind || "panel";
        const geo = k === "log" ? logGeo : (k === "rubble" ? rubbleGeo : panelGeo);
        const mat = k === "log" ? logMat : (k === "rubble" ? rubbleMat : panelMat);
        let made = 0;
        for (let i = 0; i < n; i++) {
          const m = new THREE.Mesh(geo, mat);
          m.castShadow = false;
          const px = x + (DEB_RAND() - 0.5) * 9, pz = z + (DEB_RAND() - 0.5) * 9;
          m.position.set(px, seaY(px, pz), pz);
          m.scale.setScalar(0.7 + DEB_RAND() * 0.9);
          root.add(m);
          add(m, px, pz, k, { dispose: true });
          made++;
        }
        return made;
      },

      /* ONE FRAME OF THE FLOW. env: {dx, dz, flow (m/s, signed — negative is
         the undertow), sediment}. Everything reads the SHARED surface, so an
         object stops being carried the instant the water under it is gone. */
      step(dt, env) {
        env = env || {};
        const dx = Number.isFinite(env.dx) ? env.dx : 1, dz = Number.isFinite(env.dz) ? env.dz : 0;
        const flow = Number.isFinite(env.flow) ? env.flow : 0;
        checkPhase = (checkPhase + 1) % 3;
        for (let i = 0; i < items.length; i++) {
          const it = items[i], c = it.cls;
          if (!it.obj) continue;
          const surf = seaY(it.x, it.z), gnd = groundY(it.x, it.z);
          const depth = surf - gnd;
          if (it.hitCd > 0) it.hitCd -= dt;
          if (depth < 0.4) {
            // STRANDED. The water that carried it here has gone; it stays
            // exactly where it stopped, which is the aftermath photograph.
            if (!it.stranded) {
              it.stranded = true;
              it.obj.rotation.set(it.pitch, it.yaw, it.roll);
              if (it.onStrand) { try { it.onStrand(it); } catch (e) {} }
            }
            it.obj.position.set(it.x, gnd + 0.22, it.z);
            continue;
          }
          it.stranded = false;
          const v = flow * c.drift;
          const step2 = v * dt;
          it.x += dx * step2 - dz * it.lat * dt * Math.abs(v) * 0.25;
          it.z += dz * step2 + dx * it.lat * dt * Math.abs(v) * 0.25;
          // ride the surface, sunk by its own mass, heaving on the churn
          const bob = Math.sin((CBZ.now || 0) * 0.005 + it.ph) * 0.22;
          it.obj.position.set(it.x, surf - c.sink + bob, it.z);
          // TUMBLING, not floating: rotation rate follows the water's speed,
          // so a bore rolls a car over and a slack pool merely turns it.
          const tumble = Math.min(2.4, Math.abs(v) * 0.34) * c.spin * dt;
          it.yaw += it.sy * tumble;
          it.pitch += it.sx * tumble * 0.55;
          it.roll += it.sz * tumble * 0.7;
          it.obj.rotation.set(it.pitch, it.yaw, it.roll);

          // ---- THE BATTERING RAM ----
          if (checkPhase !== (i % 3) || it.hitCd > 0) continue;
          const speed = Math.abs(v);
          if (speed < 1.3 || !cfg.forEachActor || !cfg.strike) continue;
          const r2 = c.hitR * c.hitR;
          const ix = it.x, iz = it.z, iy = it.obj.position.y;
          cfg.forEachActor(function (a) {
            if (!a || a.dead || !a.pos || it.hitCd > 0) return;
            const ax = a.pos.x - ix, az = a.pos.z - iz;
            if (ax * ax + az * az > r2) return;
            if (Math.abs((a.pos.y || 0) - iy) > 3.2) return;    // a roof is a roof
            it.hitCd = 0.9;
            strikes++;
            const wall = cfg.againstWall ? !!cfg.againstWall(a.pos.x, a.pos.z) : false;
            const cause = it.kind === "car"
              ? (wall ? "crushed against a wall by a drifting car" : "struck by a car inside the tsunami")
              : (wall ? "crushed against a wall by tsunami debris" : "battered by tsunami debris");
            const mul = wall ? 1.85 : 1;      // nowhere to give: the load goes into you
            try {
              cfg.strike(a, {
                kind: it.kind, speed: speed, dirX: dx * Math.sign(v || 1), dirZ: dz * Math.sign(v || 1),
                force: c.force * (0.6 + Math.min(1.4, speed / 3.4)) * mul,
                damage: c.dmg * (0.5 + Math.min(1.3, speed / 3.2)) * mul,
                cause: cause, wall: wall,
              });
            } catch (e) {}
            kills++;
          });
        }
      },

      strandAll() {
        for (let i = 0; i < items.length; i++) {
          const it = items[i]; if (!it.obj) continue;
          const gnd = groundY(it.x, it.z);
          it.obj.position.set(it.x, gnd + 0.22, it.z);
          it.obj.rotation.set(it.pitch, it.yaw, it.roll);
          it.stranded = true;
        }
      },
      count() { return items.length; },
      stats() { return { entrained: entrained, strikes: strikes, kills: kills, live: items.length }; },
      dispose() {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (it.dispose && it.obj && it.obj.parent) it.obj.parent.remove(it.obj);
        }
        items.length = 0;
        for (let i = 0; i < owned.length; i++) if (owned[i] && owned[i].dispose) owned[i].dispose();
        owned.length = 0;
        logGeo = null;
      },
    };
  };

  // ---- the arc ------------------------------------------------------------
  // Named beats with durations, read by a single stepper — the propuse.js arc
  // shape. Nothing accumulates, so the event can be cancelled on any frame by
  // dropping the state and zeroing the surge.
  const PHASES = [
    ["draw", 16],     // the sea goes out — the warning
    ["lull", 3.5],    // and holds there, low and wrong
    ["surge", 11],    // it comes back
    ["hold", 13],     // and stands
    ["drain", 34],    // and leaves
  ];
  const TOTAL = PHASES.reduce(function (a, p) { return a + p[1]; }, 0);

  let ev = null;          // { t, phase, peak, draw }
  // Seeded to a FULL period, not 0. Starting at zero means the very first tick
  // of the very first session finds the timer already expired and fires a
  // tsunami in your first second of play — which is not "rare", it is "always".
  let autoCD = CBZ.CONFIG.TSUNAMI_PERIOD;
  let noted = "";
  let _rising = false;    // is the water still coming in (set at 9.2, read at 10.6)
  let panicCD = 0;

  function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }

  // surge in metres for a given time into the event
  function surgeAt(t, peak, draw) {
    let acc = 0;
    for (let i = 0; i < PHASES.length; i++) {
      const name = PHASES[i][0], dur = PHASES[i][1];
      if (t < acc + dur) {
        const u = (t - acc) / dur;
        switch (name) {
          // The drawdown is FAST going out — a receding tsunami empties a bay
          // in well under a minute, and the speed of it is the tell.
          case "draw":  return draw * ease(Math.min(1, u * 1.9));
          case "lull":  return draw;
          // Coming back is faster still, and it overshoots straight past mean
          // sea level without pausing there. That non-stop is the wall.
          case "surge": return draw + (peak - draw) * ease(u);
          case "hold":  return peak * (1 - 0.10 * u);      // sags a little as it spreads
          case "drain": return peak * 0.90 * (1 - ease(u));
        }
      }
      acc += dur;
    }
    return 0;
  }
  function phaseAt(t) {
    let acc = 0;
    for (let i = 0; i < PHASES.length; i++) {
      if (t < acc + PHASES[i][1]) return PHASES[i][0];
      acc += PHASES[i][1];
    }
    return "";
  }

  /* ---- WHO IS ON THE COAST ----------------------------------------------
     Both the trigger gate and the panic radius. `shoreAt` is not public, so
     this asks the question the public API can answer: how far is the player
     from water that already exists. */
  function nearCoast(x, z, r) {
    if (!CBZ.cityWaterAt) return false;
    const step = Math.max(8, r / 8);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const dx = Math.sin(a), dz = Math.cos(a);
      for (let d = 0; d <= r; d += step) if (CBZ.cityWaterAt(x + dx * d, z + dz * d)) return true;
    }
    return false;
  }

  /* ---- THE FRONT ---------------------------------------------------------
     The city event is a LEVEL — one number, and that is still the only thing
     that is physically true about it. But a rising level with no edge does not
     read as a tsunami, it reads as a bath filling. So the event also carries a
     FRONT: an origin, a bearing (out of the sea, toward the land the player is
     standing on) and a scalar position walked by the SAME easing that drives
     the level, so the face and the water arrive together and can never
     disagree. The face rides it; nothing samples it for wetness.            */
  const FRONT_FROM = -190, FRONT_TO = 130;
  function frontAt(u) { return FRONT_FROM + (FRONT_TO - FRONT_FROM) * u; }
  // 0 in deep water, 1 once the bore is scouring the town: the sediment load,
  // the churn, the boil and the palette all hang off this one number.
  function turbidAt(fs) { return Math.max(0, Math.min(1, (fs + 105) / 95)); }
  /* THE CURL SCALES WITH DEPTH. A tsunami in open water is long and low; it
     stands up as it feels the bottom and is at its steepest, most overhung and
     tallest the instant before it breaks on the shore. After that it is not a
     wave at all any more, it is a flood with a dirty edge. */
  function curlAt(fs) {
    const k = (fs + 34) / 74;
    return Math.max(0.18, 1.45 * Math.exp(-k * k) * (fs > 0 ? Math.max(0.15, 1 - fs / 90) : 1));
  }
  /* AND IT SPENDS ITSELF FROM THE SHORE. The old ramp did not start losing
     height until the front was 40 m INSIDE the town and never fell below 30%,
     so the wall crossed the whole waterfront at very nearly its landfall
     height and left still standing — a wave touring a city rather than
     breaking on one. A bore stops being a wall the moment it is over land:
     what it gives up in height is the flood rising behind it, which the surge
     is already doing on this same span. Landfall is fs ~ -10 (where turbidAt
     saturates), so that is where the collapse begins. */
  function faceHeight(peak, fs) {
    const shoal = Math.max(0.42, Math.min(1, 0.42 + 0.58 * Math.exp(-Math.pow((fs + 26) / 96, 2))));
    const inland = Math.max(0, Math.min(1, (fs + 10) / (FRONT_TO + 10)));
    return (5.5 + peak * 1.75) * shoal * Math.max(0.1, Math.pow(1 - inland, 1.45));
  }

  function seaSurface() {
    return (CBZ.waterSeaY ? CBZ.waterSeaY() : 0) + (CBZ.waterSurge ? CBZ.waterSurge() : 0);
  }
  function groundAt(x, z) { return CBZ.floorAt ? CBZ.floorAt(x, z) : 0; }

  /* ---- THE EVENT ---------------------------------------------------------- */
  CBZ.cityTsunami = function (opts) {
    if (!on() || ev) return false;
    opts = opts || {};
    const P = CBZ.player;
    // The bearing is not a random compass point: it is the direction the sea
    // actually lies in from the person who is about to be hit by it.
    let dx = 0, dz = 1;
    if (P && P.pos) {
      const w = scanWaterDir(P.pos.x, P.pos.z);
      if (w) { dx = -w.x; dz = -w.z; }
    }
    ev = {
      t: 0,
      peak: opts.peak != null ? +opts.peak : CBZ.CONFIG.TSUNAMI_PEAK,
      draw: opts.draw != null ? +opts.draw : CBZ.CONFIG.TSUNAMI_DRAW,
      phase: "",
      cx: P && P.pos ? P.pos.x : 0, cz: P && P.pos ? P.pos.z : 0,
      dx: dx, dz: dz, frontS: FRONT_FROM, u: 0,
      face: null, debris: null, structCd: 0, takeCd: 0, undertowT: 0,
    };
    noted = "";
    return true;
  };
  CBZ.cityTsunamiState = function () {
    return ev ? {
      phase: ev.phase, t: ev.t, total: TOTAL,
      surge: CBZ.waterSurge ? CBZ.waterSurge() : 0,
      frontS: ev.frontS, turbid: turbidAt(ev.frontS),
      debris: ev.debris ? ev.debris.stats() : null,
    } : null;
  };
  CBZ.cityTsunamiStop = function () {
    if (ev) {
      if (ev.face && CBZ.tsuFaceDispose) CBZ.tsuFaceDispose(ev.face);
      // the debris does NOT vanish with the water — it is left exactly where
      // the drain put it, which is the entire aftermath
      if (ev.debris) { ev.debris.strandAll(); ev.debris.dispose(); }
    }
    ev = null;
    if (CBZ.waterSurgeSet) CBZ.waterSurgeSet(0);
    if (CBZ.waterEventClear) CBZ.waterEventClear("city-tsunami");
  };

  /* ---- THE FACE ----------------------------------------------------------
     Presentation only, and it says so: it rides the front the level already
     publishes, it carries no wetness and no collision, and if the flag is off
     it is simply never built. Shared with the island through water_spec.js —
     one bore, two worlds.                                                    */
  function faceEnsure() {
    if (!ev || CBZ.CONFIG.TSU_FACE_V2 === false || !CBZ.tsuFaceBuild) return null;
    if (ev.face) return ev.face;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (!root) return null;
    ev.face = CBZ.tsuFaceBuild({ width: 520, height: 5.5 + ev.peak * 1.75 });
    root.add(ev.face.group);
    return ev.face;
  }
  function faceDrive(dt) {
    const f = ev.face; if (!f) return;
    const fs = ev.frontS;
    const visible = ev.phase === "lull" || ev.phase === "surge" || (ev.phase === "hold" && fs < FRONT_TO - 4);
    f.group.visible = visible;
    if (!visible) return;
    CBZ.tsuFaceUpdate(f, {
      t: (CBZ.waterClock ? CBZ.waterClock() : (CBZ.now || 0) * 0.001), dt: dt,
      height: faceHeight(ev.peak, fs), turbid: turbidAt(fs), curl: curlAt(fs),
      foam: 0.55 + turbidAt(fs) * 0.5,
      x: ev.cx + ev.dx * fs, y: seaSurface() - 1.1, z: ev.cz + ev.dz * fs,
      dirX: ev.dx, dirZ: ev.dz,
    });
  }

  /* ---- THE DEBRIS --------------------------------------------------------
     The real cars that were parked on the seafront. A car the bore has taken
     is not a car any more: vehicles.js's own `dead` flag already means "sunk /
     wrecked hull" — its traffic update skips it and `solidCar()` stops
     colliding with it — so taking one costs one flag and no new bookkeeping,
     and what we take over is only where it is DRAWN.                        */
  function debrisEnsure() {
    if (!ev || CBZ.CONFIG.TSU_DEBRIS === false || !CBZ.tsuDebrisField) return null;
    if (ev.debris) return ev.debris;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    ev.debris = CBZ.tsuDebrisField({
      root: root,
      seaY: function () { return seaSurface(); },
      groundY: groundAt,
      againstWall: function (x, z) {
        // a body with a wall behind it has nowhere to give — that is the
        // difference between being hit by a car and being crushed by one
        if (!CBZ.structure || !CBZ.structure.lotAt) return false;
        try { return !!CBZ.structure.lotAt(x, z, 3.2); } catch (e) { return false; }
      },
      forEachActor: function (fn) {
        const P = CBZ.player;
        if (P && !P.dead && !P.driving && P.pos) fn({ pos: P.pos, isPlayer: true, dead: P.dead });
        const peds = CBZ.cityPeds;
        if (!peds) return;
        for (let i = 0; i < peds.length; i++) {
          const p = peds[i];
          if (!p || p.dead || !p.pos) continue;
          fn(p);
        }
      },
      strike: function (a, info) {
        if (a.isPlayer) {
          if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(info.damage, a.pos.x - info.dirX * 3, a.pos.z - info.dirZ * 3, info.cause, false, null, false);
          if (CBZ.body && CBZ.body.hit && CBZ.city && CBZ.city.playerActor) {
            try { CBZ.body.hit(CBZ.city.playerActor, { dir: { x: info.dirX, z: info.dirZ }, force: info.force, knockdown: 1.0 }); } catch (e) {}
          }
          if (CBZ.shake) CBZ.shake(0.7);
          return;
        }
        if (a.hp != null) a.hp -= info.damage;
        if ((a.hp == null || a.hp <= 0) && CBZ.cityKillPed) {
          try { CBZ.cityKillPed(a, { fromX: a.pos.x - info.dirX * 3, fromZ: a.pos.z - info.dirZ * 3, force: info.force, fling: 3.5 }, info.cause); } catch (e) {}
        } else if (CBZ.body && CBZ.body.hit) {
          try { CBZ.body.hit(a, { dir: { x: info.dirX, z: info.dirZ }, force: info.force, fling: 3 }); } catch (e) {}
        }
      },
    });
    return ev.debris;
  }

  // pick up whatever the front has just reached
  function entrain(dt) {
    const field = debrisEnsure(); if (!field) return;
    ev.takeCd -= dt;
    if (ev.takeCd > 0) return;
    ev.takeCd = 0.25;
    const P = CBZ.player; if (!P || !P.pos) return;
    const cars = CBZ.cityCars;
    if (!cars || !CBZ.cityFloodDepthAt) return;
    let taken = 0;
    for (let i = 0; i < cars.length && taken < 2; i++) {
      const c = cars[i];
      if (!c || c.player || c.dead || c._tsuTaken || !c.group || !c.pos) continue;
      if (Math.abs(c.pos.x - P.pos.x) > 230 || Math.abs(c.pos.z - P.pos.z) > 230) continue;
      if (CBZ.cityFloodDepthAt(c.pos.x, c.pos.z) < 0.7) continue;
      c._tsuTaken = 1; c.dead = true; c.abandoned = true; c.ai = false; c.v = 0; c.vx = 0; c.vz = 0;
      field.take(c.group, c.pos.x, c.pos.z, "car");
      taken++;
    }
  }

  /* ---- WHAT STANDS AND WHAT DOES NOT --------------------------------------
     The rule tsunami survival guides actually give: reinforced concrete and
     height save you (vertical evacuation — go UP, and stay up); wood-frame
     buildings are swept off their foundations entirely. So the flood only
     condemns LOW, LIGHT footprints, it does it through city/structural.js's
     one verb, and what comes off them joins the water as more debris.        */
  function sweepStructures(dt) {
    if (!CBZ.structure || !CBZ.structure.hit || !CBZ.CONFIG.TSU_DEBRIS) return;
    ev.structCd -= dt;
    if (ev.structCd > 0) return;
    ev.structCd = 0.8;
    const A = CBZ.city && CBZ.city.arena;
    const P = CBZ.player;
    if (!A || !A.lots || !P || !P.pos || !CBZ.cityFloodDepthAt) return;
    const field = ev.debris;
    for (let i = 0; i < A.lots.length; i++) {
      const lot = A.lots[i], b = lot && lot.building;
      if (!b || lot.demolished || lot._tsuSwept) continue;
      if (Math.abs(b.ox - P.pos.x) > 180 || Math.abs(b.oz - P.pos.z) > 180) continue;
      const st = b.storeys != null ? b.storeys : Math.max(1, Math.round((b.h || 6) / 3.2));
      if (st > 2) continue;                       // concrete and height: a refuge
      const depth = CBZ.cityFloodDepthAt(b.ox, b.oz);
      if (depth < 1.1) continue;
      lot._tsuSwept = 1;
      try {
        CBZ.structure.hit(b.ox, Math.min((b.h || 6) * 0.5, 4), b.oz, 9.5 * depth, {
          kind: "kinetic", sudden: true, lot: lot, dirx: ev.dx, dirz: ev.dz,
        });
      } catch (e) {}
      if (field) field.shed(b.ox, b.oz, 5, "panel");
      return;                                     // one house per beat, never a queue
    }
  }

  /* ---- DROWNING ----------------------------------------------------------
     The flood does not need its own damage model. A body standing in water
     deeper than it is tall is a body underwater, and this game already knows
     what to do with one — city/swim.js owns the player's waterline and
     drowning, and it reads the same surface. So the only thing this file does
     is what nothing else can know: a body that never chose to be in water is
     SWEPT, and being swept is what kills people in a tsunami, not the depth.
     Deaths go through the kill bus like every other death in the game. */
  const SWEEP = 9.0;                    // m/s the flood front drags a body at
  const UNDERTOW = 5.2;                 // m/s of EXTRA seaward pull on the drain
  function sweep(dt, rising) {
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return;
    const d = CBZ.cityFloodDepthAt ? CBZ.cityFloodDepthAt(P.pos.x, P.pos.z) : 0;
    if (d <= 0.35) return;
    // shoved inland on the surge, dragged seaward on the drain — the direction
    // reverses, which is the thing that makes the drain the dangerous half.
    const water = nearestWaterDir(P.pos.x, P.pos.z);
    if (!water) return;
    /* ---- THE UNDERTOW ----------------------------------------------------
       Everything a tsunami brought in has to leave again through the same
       gap, and it leaves faster than it arrived. Survivors of the impacts are
       killed here: pulled off their feet and taken out to sea, where there is
       nothing left to grab. The number is deliberately larger than swim.js's
       fast stroke (2.15 m/s) — you cannot swim out of this, you can only be
       BEHIND something. Cover is the answer, and it is a physical one: a
       building between you and the sea halves it. */
    const draining = !rising && ev && ev.phase === "drain" && CBZ.CONFIG.TSU_UNDERTOW !== false;
    let pull = SWEEP;
    if (draining) {
      let cover = 1;
      if (CBZ.structure && CBZ.structure.lotAt) {
        try { if (CBZ.structure.lotAt(P.pos.x - water.x * 5, P.pos.z - water.z * 5, 4)) cover = 0.42; } catch (e) {}
      }
      pull = SWEEP + UNDERTOW * cover;
      ev.undertowT += dt;
    }
    const s = Math.min(1, d / 2.2) * pull * dt * (rising ? -1 : 1);
    P.pos.x += water.x * s;
    P.pos.z += water.z * s;
    // knocked off your feet: the existing stun channel, not a new one
    if (d > 1.1 && P.stun != null) P.stun = Math.max(P.stun, 0.25);

    /* PAST THE SHORELINE. Being dragged over ground that is genuinely below
       the sea — not a flooded street, the actual sea bed — with the breath
       meter running is the drowning arc, and it deserves its own words in the
       killfeed. swim.js owns the air; this owns why you ran out of it. */
    if (!draining) return;
    const sw = CBZ.citySwimState ? CBZ.citySwimState() : null;
    if (!sw || !sw.swimming) return;
    const gy = groundAt(P.pos.x, P.pos.z);
    if (gy > seaSurface() - 3.2) return;              // still over the town
    if (sw.breath > 0.42) return;                     // the tank is still answering
    if (CBZ.cityHurtPlayer) {
      CBZ.cityHurtPlayer(30 * dt, P.pos.x - water.x * 6, P.pos.z - water.z * 6,
        "dragged out to sea by the undertow", false, null, false);
    }
  }
  // WHICH WAY IS THE SEA. Sixteen bearings × a handful of ranges is ~128 water
  // queries, which is nothing once but real money twice a frame for a minute,
  // so the answer is cached for half a second and against movement. The
  // direction to the coast does not change quickly, and being a beat stale
  // costs a fraction of a metre of shove.
  const _wd = { x: 0, z: 0 };
  let _wdT = -1e9, _wdX = 0, _wdZ = 0, _wdOk = false;
  function nearestWaterDir(x, z) {
    const now = CBZ.now || 0;
    if (now - _wdT < 500 && Math.abs(x - _wdX) < 12 && Math.abs(z - _wdZ) < 12) return _wdOk ? _wd : null;
    _wdT = now; _wdX = x; _wdZ = z;
    _wdOk = false;
    const r = scanWaterDir(x, z);
    _wdOk = !!r;
    return r;
  }
  function scanWaterDir(x, z) {
    if (!CBZ.cityWaterAt) return null;
    let bx = 0, bz = 0, found = false, bd = 1e9;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const dx = Math.sin(a), dz = Math.cos(a);
      for (let d = 6; d <= 90; d += 12) {
        if (!CBZ.cityWaterAt(x + dx * d, z + dz * d)) continue;
        if (d < bd) { bd = d; bx = dx; bz = dz; found = true; }
        break;
      }
    }
    if (!found) return null;
    _wd.x = bx; _wd.z = bz;
    return _wd;
  }

  /* ---- TICK --------------------------------------------------------------- */
  CBZ.onUpdate(9.2, function (dt) {
    if (!on()) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city") {
      if (ev) CBZ.cityTsunamiStop();
      return;
    }
    const P = CBZ.player;

    if (!ev) {
      if (!CBZ.CONFIG.TSUNAMI_AUTO || g.state !== "playing" || !P) return;
      autoCD -= dt;
      if (autoCD > 0) return;
      autoCD = CBZ.CONFIG.TSUNAMI_PERIOD;
      // never unattended, and never while you are already out at sea with no
      // chance of reading the warning
      if (!nearCoast(P.pos.x, P.pos.z, 260)) return;
      CBZ.cityTsunami();
      return;
    }

    const prev = CBZ.waterSurge ? CBZ.waterSurge() : 0;
    ev.t += dt;
    if (ev.t >= TOTAL) { CBZ.cityTsunamiStop(); return; }
    const s = surgeAt(ev.t, ev.peak, ev.draw);
    CBZ.waterSurgeSet(s);
    ev.phase = phaseAt(ev.t);
    const rising = s > prev;

    /* ---- THE FRONT, THE FACE, THE SOUP -----------------------------------
       One fraction drives all three, and it is read back OFF the level rather
       than kept beside it, so the wall can never be somewhere the water is
       not. */
    const frac = Math.max(0, Math.min(1, (s - ev.draw) / Math.max(0.001, ev.peak - ev.draw)));
    ev.u = frac;
    ev.frontS = frontAt(frac);
    const turbid = turbidAt(ev.frontS);
    // flow along the travel axis: shoved inland on the bore, standing on the
    // hold, and torn back out to sea on the drain
    const undertowOn = CBZ.CONFIG.TSU_UNDERTOW !== false;
    const flow = ev.phase === "surge" ? 2.2 + 6.2 * frac
      : ev.phase === "hold" ? 1.4
        : ev.phase === "drain" ? -(undertowOn ? 3.4 + 5.6 * Math.min(1, s / Math.max(0.4, ev.peak * 0.9)) : 1.2)
          : (ev.phase === "draw" ? -1.4 : 0);
    if (CBZ.waterEventSet) CBZ.waterEventSet({
      owner: "city-tsunami", kind: "tsunami", phase: ev.phase === "drain" ? "drain" : (s > 0.2 ? "flooded" : "warn"),
      cx: ev.cx, cz: ev.cz, dx: ev.dx, dz: ev.dz,
      frontS: ev.frontS, frontWet: -2, frontWidth: 24,
      level: seaSurface(), waveAmp: 1.1 + turbid * 0.8, chopAmp: 1.3 + turbid * 1.1,
      flow: flow, sediment: turbid,
    });
    if (CBZ.CONFIG.TSU_FACE_V2 !== false) { faceEnsure(); faceDrive(dt); }
    if (CBZ.CONFIG.TSU_DEBRIS !== false && s > 0.5) {
      entrain(dt);
      sweepStructures(dt);
    }
    if (ev.debris) ev.debris.step(dt, { dx: ev.dx, dz: ev.dz, flow: flow, sediment: turbid });

    // ---- the world reacts, through the channels it already had -------------
    if (ev.phase !== noted) {
      noted = ev.phase;
      const note = CBZ.city && CBZ.city.note;
      // Only the drawdown is announced, and it is announced as an OBSERVATION,
      // not a warning: the game tells you what you can see, and leaves the
      // conclusion to you. Naming it would throw away the only interesting
      // moment the event has.
      if (note && ev.phase === "draw") note("The water is going out. Fast.", 3.4);
      if (note && ev.phase === "surge") note("It's coming back.", 2.6);
    }

    if (P && !P.dead) {
      // panic: the crowd runs from the WATER, which means inland, which is the
      // correct thing to do — and it costs one call because crowd.js's flee
      // already takes a point to run away from.
      const w = nearestWaterDir(P.pos.x, P.pos.z);
      // PANIC — one call, city/cityevents.js's bus. It drives the full-rig
      // peds' rippling per-ped panic (so the fear spreads outward and the
      // brave ones stop to gawk at the water instead of everyone starbursting
      // on the same frame) AND scatters the instanced background crowd itself.
      // Posted from a point OUT TO SEA, so "away from the threat" is inland,
      // which is the correct thing to run.
      //
      // Throttled: the ring is small and each entry radiates for 0.6s, so
      // posting every frame would flush every other event in the world out of
      // it. Twice a second keeps the field alive and leaves the ring usable.
      panicCD -= dt;
      if (w && s > 0.6 && panicCD <= 0) {
        panicCD = 0.5;
        CBZ.cityPostEvent && CBZ.cityPostEvent({
          type: "explosion", pos: { x: P.pos.x + w.x * 40, y: 0, z: P.pos.z + w.z * 40 },
          radius: 150, intensity: 1.2,
        });
      }
      _rising = rising;
      // the dread bus (systems/predator.js) is the game's ONE tension channel;
      // an approaching wall of water is exactly what it is for, so the music
      // and the near-silence before the surge come free.
      if (CBZ.predatorDread && s !== 0) {
        const lvl = ev.phase === "surge" ? 1 : (ev.phase === "draw" ? 0.45 : 0.7);
        CBZ.predatorDread({ id: "tsunami" }, lvl, { dist: 40 });
      }
    }
  });

  /* THE SWEEP RUNS AFTER THE PLAYER, NOT WITH THE WATER.
     The surge has to be set at 9.2 — ahead of the moving platforms at 9.4/9.5
     and updatePlayer at 10 — because everything downstream reads sea level
     that frame. But shoving the body has to happen AFTER updatePlayer has
     resolved, or the movement solve simply overwrites it and the flood pushes
     you nowhere. Same one-frame ordering lesson as city/beach.js's dock. */
  CBZ.onUpdate(10.6, function (dt) {
    if (!ev || !on()) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city" || g.state !== "playing") return;
    sweep(dt, _rising);
  });

  // Evidence: is a surge live, and is the water mask agreeing with the shader.
  // `mismatch` is the one thing that would be a real bug — the sea rendered
  // somewhere the game does not think is wet.
  CBZ.tsunamiAudit = function () {
    const dst = ev && ev.debris ? ev.debris.stats() : null;
    return {
      running: !!ev,
      phase: ev ? ev.phase : null,
      surge: CBZ.waterSurge ? CBZ.waterSurge() : 0,
      floodQuery: !!CBZ.cityFloodDepthAt,
      // ---- the scary-water wave's own evidence ----
      faceV2: CBZ.CONFIG.TSU_FACE_V2 !== false && !!CBZ.tsuFaceBuild,
      faceLive: !!(ev && ev.face && ev.face.group && ev.face.group.visible),
      frontS: ev ? +ev.frontS.toFixed(1) : null,
      turbidity: ev ? +turbidAt(ev.frontS).toFixed(3) : 0,
      curl: ev ? +curlAt(ev.frontS).toFixed(3) : 0,
      debrisEntrained: dst ? dst.entrained : 0,
      debrisLive: dst ? dst.live : 0,
      debrisKills: dst ? dst.kills : 0,
      undertowPull: ev && ev.phase === "drain" && CBZ.CONFIG.TSU_UNDERTOW !== false ? SWEEP + UNDERTOW : 0,
      undertowSecs: ev ? +ev.undertowT.toFixed(2) : 0,
      kitShared: !!(CBZ.tsuFaceBuild && CBZ.tsuDebrisField),
    };
  };
})();
