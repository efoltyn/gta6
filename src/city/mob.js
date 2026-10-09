/* ============================================================
   city/mob.js — THE CROWD THAT MOVES: rallies, marches, police lines,
   breaches. The one mass crowd for every political crowd in the game.

   OWNER: "Just make it cool and real: crowds of people, real mobs."

   WHAT EXISTED AND WHAT THIS GROWS. president_public.js already had a gate
   protest: up to 22 posted rigs standing in rows with signs, a four-man
   police line, a chant over one head and a run when soldiers came. It could
   not grow past a ~50 body budget and it could not move. city/crowd.js is
   the ambient street population (48 real rigs, no politics). This file is
   what the gate protest becomes when it grows up: president_public.js now
   hands its protest bodies to a mob from here, and the address
   (city/address.js) and the transfer of power (city/transfer.js) raise
   theirs the same way. One crowd system, three callers.

   THE MODEL, LAYER BY LAYER
     SOULS     a mob has a SIZE (how many people the country put on the
               street: the number the news reports). Its AGENTS are the
               people simulated here, capped per device; the soul count
               beyond the cap exists only as that number.
     AGENTS    struct-of-arrays bodies: position, velocity, heading, gait
               phase, role (leader / flag / sign / fist / thrower / climber /
               fighter), dress (by ideological group), action. Stepped at a
               fixed 15 Hz: seek a formation slot behind the head, slow with
               local density (the fundamental diagram: packed people shuffle),
               push apart from neighbours (a 1 m hash grid), and stop at a
               police line, which turns the push into PRESSURE.
     STAGES    rally (a dense knot at the muster point, chanting) -> march
               (a column along the route, leaders at the front) -> confront
               (the head meets a line: the front packs, throwers throw,
               climbers go up the barricade, fighters fight) -> breach (the
               line breaks; they pour to the door and inside) -> disperse
               (gas, a Guard line, or simply going home).
     POLICE    a line is a segment with officers in two ranks behind shields.
               Its strength is its bodies (shields x1.4, Guard x2.2, army
               x3). Pressure is the front rank's push minus what the line
               holds; when it passes the break point the line breaks and the
               officers fall back to the door. A line may ADVANCE (the Guard
               clearing a building) and fire tear gas.
     GAS       a canister arcs into the crowd and becomes a pale cloud
               (crashfx's pooled smoke, opts.shade); everyone in it runs out
               of it, the rigs through the shared brain (cityBrain.perform
               "flee"), and the front's push drains away.
     BODIES    the nearest agents (RIG cap per device) are ORDINARY RIGS —
               cityPostNpc civilians and citySpawnCop officers with the whole
               peds.js brain — walked to their formation slot through the
               move-order seam, so they collide, react to gunfire, can be
               shot, cuffed and talked to. Their signs and flags are
               president_public.js's props. They fight officers with the
               shared strike verb (CBZ.verbs.strike) and run from gas through
               cityBrain.perform. Everyone past the rig ring is THE SAME HUMAN,
               drawn by entities/crowdgpu.js: the CBZ.human mesh GPU-instanced
               with its walk / run / chant / cheer / placard / flag baked into
               a bone texture (LOD1 the rig's mid tier, LOD2 its far tier,
               LOD3 impostors rendered from it), in the colours its full rig is
               painted with on promotion and in step with its gait phase. Only
               the props (shields, boards, sticks, flags) are boxes, as boxes.
     BUDGET    agents: desktop 640, tablet 420, phone 260. Rigs: 40/24/14
               civilians plus 10/8/6 officers. Agents beyond 80 m step at a
               quarter rate; past the draw range or behind the camera they
               are not drawn at all. 5 crowd draw calls (2 bodies x 2 mesh
               LODs + 1 impostor) plus the props, for the whole crowd. A mob over 300 m from the player keeps
               moving (the march still reaches the Capitol) but skips the
               contact solve.

   PUBLIC: CBZ.mob = { form(spec), march(id, route), line(id, spec), gas(x,z,r),
     react(kind, id?), chant(id, text), disperse(id, flee), panic(x, z),
     stage(id), get(id), list(), near(x,z,r), budget(), audit() }
     + _step(dt) (tests). Bus: CBZ.presidency.emit("mob", {id, phase, size,
     place, headline, holler}).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE || CBZ.mob) return;
  const g = CBZ.game || (CBZ.game = {});
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---------------------------------------------------------------- budgets
  const DEVICE = CBZ.deviceClass || "desktop";
  const BUDGETS = {
    desktop: { agents: 640, rigs: 40, cops: 10, draw: 190, near: 30 },
    tablet: { agents: 420, rigs: 24, cops: 8, draw: 150, near: 26 },
    phone: { agents: 260, rigs: 14, cops: 6, draw: 120, near: 22 },
  };
  const BUD = Object.assign({}, BUDGETS[DEVICE] || BUDGETS.desktop);
  if (CFG.MOB_AGENTS > 0) BUD.agents = CFG.MOB_AGENTS | 0;
  if (CFG.MOB_RIGS >= 0 && CFG.MOB_RIGS != null) BUD.rigs = CFG.MOB_RIGS | 0;
  const CAP = BUD.agents;
  const SIM_DT = 1 / 15, MAX_STEPS = 3;
  const FAR_SLEEP = 80;          // m: beyond this an agent steps at a quarter rate
  const COARSE = 300;            // m: a whole mob this far off skips the contact solve
  const SEP = 0.55;              // m: two people closer than this push apart
  const CELL = 1.0;              // m: the contact hash
  const SPD = { walk: 1.25, march: 1.15, run: 3.4, flee: 4.6, police: 1.6 };
  const RUN_AT = 2.4;            // m/s: past this a body runs (the run clip)
  // gait phase per metre (rad/m), replaced by the real rig's measured stride
  // once the crowd is baked (crowdgpu clip radPerM)
  const GAIT = { walk: 4.4, run: 2.3, read: false };

  // ---------------------------------------------------------------- helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function h01(a, b, s) {
    let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ ((s | 0) * 0x27d4eb2f)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }
  let _seed = 0x5eed1 >>> 0;
  function rng() { _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0; return _seed / 4294967296; }
  function floorAt(x, z) { if (CBZ.floorAt) { try { const y = CBZ.floorAt(x, z); if (isFinite(y)) return y; } catch (e) {} } return 0; }
  function player() { const P = CBZ.player; return P && P.pos ? P.pos : null; }
  function now() { return CBZ.now || Date.now(); }
  function emit(evt, d) { const p = CBZ.presidency; if (p && p.emit) { try { p.emit(evt, d); } catch (e) {} } }
  function say(ped, text, color, secs) { if (ped && !ped.dead && text && CBZ.citySay) { try { CBZ.citySay(ped, text, color || "#f0e6d0", secs || 2.4); } catch (e) {} } }
  function PP() { return CBZ.presidentPublic && CBZ.presidentPublic.props ? CBZ.presidentPublic.props : null; }
  function arenaRoot() { const A = CBZ.city && CBZ.city.arena; return (A && A.root) || CBZ.scene || null; }
  function inCity() { return !g.mode || g.mode === "city"; }
  // SECURED GROUND IS A WALL (city/perimeter.js): a crowd stands on the public
  // side of a fence, behind the barricades, until it has broken a police line
  // to get through. Spawn, goal and every step are clamped; officers are not.
  const _KO = { x: 0, z: 0, moved: false };
  function walled(m) { return !!CBZ.perimeter && !m.breached && m.stage !== "breach" && m.stage !== "inside"; }
  function keepOut(m, x, z) {
    if (walled(m)) return CBZ.perimeter.clampOut(x, z, _KO);
    _KO.x = x; _KO.z = z; _KO.moved = false; return _KO;
  }

  // ---------------------------------------------------------------- agents (SoA)
  const ax = new Float32Array(CAP), az = new Float32Array(CAP), ay = new Float32Array(CAP);
  const avx = new Float32Array(CAP), avz = new Float32Array(CAP);
  const ahd = new Float32Array(CAP), aph = new Float32Array(CAP), asp = new Float32Array(CAP);
  const aox = new Float32Array(CAP), aoz = new Float32Array(CAP);     // formation slot: lateral, back
  const atx = new Float32Array(CAP), atz = new Float32Array(CAP);     // this step's desired point
  const amob = new Int16Array(CAP).fill(-1);                           // mob slot, -1 free
  const aside = new Uint8Array(CAP);                                   // 0 crowd, 1 police
  const arole = new Uint8Array(CAP);
  const aact = new Uint8Array(CAP);
  const atim = new Float32Array(CAP);
  const acd = new Float32Array(CAP);                                   // a thrower's / fighter's next go
  const aclimb = new Float32Array(CAP);                                // metres up a barricade
  const asign = new Uint8Array(CAP);                                   // slogan index in the mob
  const arig = new Int16Array(CAP).fill(-1);
  const askin = new Int32Array(CAP), ashirt = new Int32Array(CAP), apants = new Int32Array(CAP), ahair = new Int32Array(CAP);
  const ashoes = new Int32Array(CAP), asleeve = new Int32Array(CAP), abody = new Uint8Array(CAP), alook = new Int32Array(CAP).fill(-1);
  const ROLE = { plain: 0, leader: 1, flag: 2, sign: 3, fist: 4, thrower: 5, climber: 6, fighter: 7, officer: 8 };
  const ACT = { none: 0, throw: 1, climb: 2, fight: 3, flee: 4, down: 5, inside: 6, cheer: 7, push: 8 };
  let hiAgent = 0;                                                      // one past the highest used slot
  let freeList = [];
  for (let i = CAP - 1; i >= 0; i--) freeList.push(i);
  function alloc() { const i = freeList.length ? freeList.pop() : -1; if (i >= 0 && i + 1 > hiAgent) hiAgent = i + 1; return i; }
  function release(i) {
    if (amob[i] < 0) return;
    if (arig[i] >= 0) dropRig(i);
    amob[i] = -1; aact[i] = 0; atim[i] = 0; aclimb[i] = 0;
    freeList.push(i);
  }

  // ---------------------------------------------------------------- dress
  const SKINS = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac, 0xa66a3c, 0x6b4226];
  const HAIRS = [0x2a1d16, 0x3a2a1f, 0x6d4b2b, 0x9a7a4a, 0x1a1a1a, 0xb8b0a0, 0x7a3f1c];
  const PANTS = [0x2a3446, 0x3b3f47, 0x1f2226, 0x4a4036, 0x5a6270, 0x2d3a52];
  const PARTY = { red: 0xb3262c, blue: 0x1f4fa8, gold: 0xd4a531, green: 0x2e7d4f, black: 0x1a1a1a, white: 0xe8e6e0 };
  function hexOf(c, fb) {
    if (typeof c === "number" && isFinite(c)) return c | 0;
    if (typeof c === "string") {
      if (PARTY[c]) return PARTY[c];
      const m = /^#?([0-9a-f]{6})$/i.exec(c);
      if (m) return parseInt(m[1], 16);
    }
    return fb;
  }
  // a mob's look is its people's: each group brings a colour (its party's,
  // or its own) worn as a cap, a shirt or both, at the group's share
  function dressAgent(i, mob, k) {
    const G = mob.groups && mob.groups.length ? mob.groups : [{ color: mob.color, share: 1 }];
    let r = h01(k, mob.seed, 11), gi = 0, acc = 0;
    let tot = 0; for (let j = 0; j < G.length; j++) tot += Math.max(0.01, +G[j].share || 1);
    for (let j = 0; j < G.length; j++) { acc += Math.max(0.01, +G[j].share || 1) / tot; if (r <= acc) { gi = j; break; } gi = j; }
    const grp = G[gi];
    const col = hexOf(grp.color, hexOf(mob.color, 0x6e2b33));
    askin[i] = SKINS[(h01(k, mob.seed, 12) * SKINS.length) | 0];
    ahair[i] = HAIRS[(h01(k, mob.seed, 13) * HAIRS.length) | 0];
    apants[i] = PANTS[(h01(k, mob.seed, 14) * PANTS.length) | 0];
    const w = h01(k, mob.seed, 15);
    const plain = [0x2c3e5c, 0x444a52, 0x8a939c, 0xe8e6e0, 0x33573b, 0x6e2b33, 0x23262b, 0xc9a23a];
    ashirt[i] = w < (grp.shirt != null ? grp.shirt : 0.35) ? col : plain[(h01(k, mob.seed, 16) * plain.length) | 0];
    // the group's colour is worn, never dyed into the hair: a cap-share roll
    // that missed the shirt puts the colour on the shirt instead
    if (ashirt[i] !== col && h01(k, mob.seed, 17) < (grp.cap != null ? grp.cap : 0.4) * 0.5) ashirt[i] = col;
    abody[i] = h01(k, mob.seed, 33) < 0.38 ? 1 : 0;
    ashoes[i] = h01(k, mob.seed, 18) < 0.3 ? 0xd8d8d8 : 0x2b2b2b;
    asleeve[i] = h01(k, mob.seed, 19) < 0.4 ? askin[i] : ashirt[i];
    lookOf(i);
    mob.groupCount[gi] = (mob.groupCount[gi] | 0) + 1;
    return gi;
  }
  function dressOfficer(i, kind) {
    askin[i] = SKINS[(h01(i, 7, 21) * SKINS.length) | 0];
    if (kind === "army" || kind === "guard") { ashirt[i] = 0x4b5236; apants[i] = 0x434a31; ahair[i] = 0x3b4229; }
    else { ashirt[i] = 0x1b2436; apants[i] = 0x161c28; ahair[i] = 0x10141c; }
    abody[i] = 0; ashoes[i] = 0x141414; asleeve[i] = ashirt[i];
    lookOf(i);
  }
  // the person's look in the real crowd (entities/crowdgpu.js): the same
  // colours the full rig is painted with when this agent is promoted
  function lookOf(i) {
    const G = CBZ.crowdGPU;
    alook[i] = G ? G.look({ build: abody[i] ? "f" : "m", skin: askin[i], shirt: ashirt[i], pants: apants[i], hair: ahair[i], shoes: ashoes[i], sleeve: asleeve[i] }) : -1;
  }

  // ---------------------------------------------------------------- mobs
  const MOBS = [];               // live mob records (index = slot id)
  let SEQ = 0;
  const LINES = [];
  const GAS = [];
  const STATS = { formed: 0, peakAgents: 0, peakRigs: 0, breaches: 0, gasFired: 0, thrown: 0, linesBroken: 0, stepMs: 0, drawMs: 0, drawn: 0 };
  function mobById(id) { for (let i = 0; i < MOBS.length; i++) if (MOBS[i] && MOBS[i].id === id) return MOBS[i]; return null; }
  function mobSlot(m) { return MOBS.indexOf(m); }
  function liveAgents() { let n = 0; for (let i = 0; i < hiAgent; i++) if (amob[i] >= 0) n++; return n; }

  const CHANT_OF = {
    "STOP THE STEAL": "Stop the steal! Stop the steal!", "NO CURFEW": "No curfew! No curfew!", "SOLDIERS OUT": "Soldiers out!",
    "RESIGN": "Resign! Resign!", "NO DICTATOR": "No dictator!", "RESPECT THE VOTE": "Respect the vote!", "COUNT EVERY VOTE": "Count every vote!",
    "WE THE PEOPLE": "We the people!", "NO KINGS": "No kings! No kings!", "FOUR MORE YEARS": "Four more years!", "ENOUGH": "Enough! Enough!",
    "WHOSE HOUSE": "Whose house? Our house!", "TAKE IT BACK": "Take it back!", "HEAR US": "Hear us!",
  };
  function chantFor(slogan) {
    const s = String(slogan || "").toUpperCase();
    return CHANT_OF[s] || (s ? s.charAt(0) + s.slice(1).toLowerCase() + "!" : "");
  }

  /* form(spec) -> id
       at {x,z}            where they muster
       size                souls: how many people came (the news number)
       face                the way the knot faces while it rallies (rad)
       side                "supporters" | "opposition" (whose crowd it is)
       groups [{name, share, color, cap, shirt}]   who came, and how they dress
       slogans [..]        short real words for the signs (and the chants)
       chants [..]         spoken lines (default: from the slogans)
       flag                a flags.js id to carry (default: the nation's)
       violent 0..1        how many throw, climb and fight
       route [{x,z}]       a march, once march() is called (or spec.march)
       hold                stand where they are until told otherwise
       kind                "rally" | "protest" | "march" | "riot" (the news word)
       place               a name for the news                                  */
  function form(spec) {
    spec = spec || {};
    if (!spec.at || !isFinite(spec.at.x) || !isFinite(spec.at.z)) return null;
    let slot = MOBS.indexOf(null);
    if (slot < 0) { if (MOBS.length >= 6) return null; slot = MOBS.length; MOBS.push(null); }
    const size = Math.max(4, Math.round(+spec.size || 60));
    const m = {
      id: "mob" + (++SEQ), slot: slot, kind: spec.kind || "rally", side: spec.side || "supporters", place: spec.place || null,
      size: size, at: { x: spec.at.x, z: spec.at.z }, face: isFinite(spec.face) ? spec.face : 0,
      head: { x: spec.at.x, z: spec.at.z }, dir: { x: Math.sin(spec.face || 0), z: Math.cos(spec.face || 0) },
      route: null, ri: 0, stage: "rally", stageT: 0, t: 0, speed: SPD.march,
      groups: Array.isArray(spec.groups) ? spec.groups.slice(0, 8) : [], groupCount: [],
      color: spec.color || null, slogans: (spec.slogans || ["HEAR US"]).slice(0, 6).map(function (s) { return String(s).toUpperCase().slice(0, 22); }),
      chants: null, flag: spec.flag || null, violent: clamp(+spec.violent || 0, 0, 1), anger: clamp(spec.anger != null ? +spec.anger : 0.4, 0, 1),
      seed: (h01(SEQ, size, 3) * 1e9) | 0, agents: [], pressure: 0, frontContacts: 0, quiet: !!spec.quiet, line: null, inside: 0, door: spec.door || null,
      insideAt: spec.insideAt || null, hold: !!spec.hold, chantT: 2 + rng() * 2, voiceT: 0.5, chantPulse: 0,
      coarse: false, centroid: { x: spec.at.x, z: spec.at.z }, gone: false, events: [], width: spec.width || 16,
      support: spec.side !== "opposition",
    };
    m.chants = (spec.chants && spec.chants.length ? spec.chants : m.slogans.map(chantFor)).filter(Boolean);
    MOBS[slot] = m;
    // the people who came, as many as the budget simulates: a new crowd may
    // take simulated bodies from crowds farther from the player (their souls,
    // the number the news counts, do not change)
    const want = Math.min(size, Math.floor(CAP * 0.85));
    if (freeList.length < want) reclaim(want, m);
    const n = Math.min(want, freeList.length);
    const R = Math.sqrt(n) * 0.5 + 1;
    // the disk sits BEHIND the muster point (its front edge on it): a crowd
    // mustered at a barricade never starts on the far side of it
    const back = spec.hold || m.kind === "protest" ? R : 0;
    const cx0 = m.at.x - Math.sin(m.face) * back, cz0 = m.at.z - Math.cos(m.face) * back;
    for (let k = 0; k < n; k++) {
      const i = alloc(); if (i < 0) break;
      amob[i] = slot; aside[i] = 0; aact[i] = 0; atim[i] = 0; acd[i] = h01(k, m.seed, 1) * 4; arig[i] = -1; aclimb[i] = 0;
      // a disk, packed toward the front (the face direction)
      const a = h01(k, m.seed, 2) * Math.PI * 2, rr = R * Math.sqrt(h01(k, m.seed, 3));
      const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
      const fx = Math.sin(m.face), fz = Math.cos(m.face);
      ax[i] = cx0 + lx * fz + lz * fx;  az[i] = cz0 - lx * fx + lz * fz;
      { const q = keepOut(m, ax[i], az[i]); ax[i] = q.x; az[i] = q.z; }
      ay[i] = floorAt(ax[i], az[i]);
      avx[i] = 0; avz[i] = 0; ahd[i] = m.face; aph[i] = h01(k, m.seed, 4) * 6.28; asp[i] = 0;
      // the column slot used when they march: leaders in the first rows
      const cols = Math.max(4, Math.round(m.width / 0.95));
      aox[i] = ((k % cols) - (cols - 1) / 2) * (m.width / cols) + (h01(k, m.seed, 5) - 0.5) * 0.4;
      aoz[i] = Math.floor(k / cols) * 0.95 + (h01(k, m.seed, 6) - 0.5) * 0.4;
      const r = h01(k, m.seed, 7);
      let role = ROLE.plain;
      if (k < Math.max(2, n * 0.03)) role = ROLE.leader;
      else if (r < 0.17) role = ROLE.flag;
      else if (r < 0.40) role = ROLE.sign;
      else if (r < 0.62) role = ROLE.fist;
      else if (r < 0.62 + 0.10 * m.violent) role = ROLE.thrower;
      else if (r < 0.62 + 0.16 * m.violent) role = ROLE.climber;
      else if (r < 0.62 + 0.26 * m.violent) role = ROLE.fighter;
      arole[i] = role;
      asign[i] = (h01(k, m.seed, 8) * m.slogans.length) | 0;
      dressAgent(i, m, k);
      m.agents.push(i);
    }
    STATS.formed++;
    STATS.peakAgents = Math.max(STATS.peakAgents, liveAgents());
    if (spec.route) march(m.id, spec.route, !!spec.marchNow);
    note(m, "form");
    return m.id;
  }
  // THE BUDGET IS SHARED BY DISTANCE: bodies come off the crowds farthest from
  // the player first, never below a knot of MIN_KEEP, officers last
  const MIN_KEEP = 40;
  function reclaim(want, except) {
    const P = player();
    const others = MOBS.filter(function (o) { return o && o !== except && !o.gone; });
    others.sort(function (a, b) {
      const da = P ? Math.hypot(P.x - a.centroid.x, P.z - a.centroid.z) : 0, db = P ? Math.hypot(P.x - b.centroid.x, P.z - b.centroid.z) : 0;
      return db - da;
    });
    for (let k = 0; k < others.length && freeList.length < want; k++) {
      const o = others[k];
      let crowd = 0;
      for (let j = 0; j < o.agents.length; j++) if (aside[o.agents[j]] === 0) crowd++;
      for (let j = o.agents.length - 1; j >= 0 && freeList.length < want && crowd > MIN_KEEP; j--) {
        const i = o.agents[j];
        if (aside[i] !== 0 || arig[i] >= 0) continue;
        release(i); crowd--;
      }
      o.agents = o.agents.filter(function (j) { return amob[j] >= 0; });
    }
  }
  // what the news calls it: a number people can picture, and the place
  function many(m) { return m.size >= 1500 ? "Thousands" : m.size >= 200 ? "Hundreds" : "A crowd"; }
  function at_(m) { return m.place ? " at " + m.place : ""; }
  function headline(m, phase, extra) {
    const who = m.kind === "riot" || m.stage === "breach" ? "Rioters" : m.support ? "Supporters" : "Protesters";
    switch (phase) {
      case "form": return m.quiet ? null : { h: many(m) + (m.support ? " rally" : " protest") + at_(m), holler: [{ kind: "citizen", text: m.support ? "Never seen so many flags in one place." : "We're not going anywhere." }] };
      case "march": return { h: many(m) + " march" + (m.place ? " on " + m.place : ""), holler: [{ kind: "citizen", text: "The whole street is moving. " + (m.slogans[0] ? m.slogans[0].charAt(0) + m.slogans[0].slice(1).toLowerCase() + "." : "") }] };
      case "confront": return { h: who + " face a police line" + at_(m), breaking: m.size >= 200 };
      case "gas": return m._gasSaid ? null : (m._gasSaid = true, { h: "Police fire tear gas" + at_(m), holler: [{ kind: "citizen", text: "Gas. Can't breathe. Get back." }] });
      case "breach": return { h: who + " break through police lines" + at_(m), breaking: true, holler: [{ kind: "press", text: "Police lines have broken" + at_(m) + "." }, { kind: "citizen", text: "They're through. They're actually through." }] };
      case "door": return { h: who + " force their way into " + (m.place || "the building"), breaking: true, holler: [{ kind: "citizen", text: "They're inside. Somebody do something." }] };
      case "disperse": return extra && extra.flee ? { h: "The crowd is cleared" + at_(m) } : null;
      default: return null;
    }
  }
  function note(m, phase, extra) {
    m.events.push({ phase: phase, t: m.t });
    const d = Object.assign({ id: m.id, phase: phase, size: m.size, kind: m.kind, side: m.side, place: m.place, at: { x: m.centroid.x, z: m.centroid.z } }, extra || {});
    const H = headline(m, phase, extra);
    if (H) { d.headline = H.h; d.breaking = !!H.breaking; d.cat = "NATION"; if (H.holler) d.holler = H.holler; }
    emit("mob", d);
  }
  // route: [{x,z}, ...] — the head walks it; agents follow in column
  function march(id, route, start) {
    const m = mobById(id); if (!m || !Array.isArray(route) || !route.length) return false;
    m.route = route.map(function (p) { return { x: +p.x, z: +p.z, door: !!p.door, inside: !!p.inside }; });
    m.ri = 0;
    if (start !== false) { m.stage = "march"; m.stageT = 0; m.hold = false; note(m, "march"); }
    return true;
  }
  function setStage(m, st, extra) { if (m.stage === st) return; if (st === "breach") m.breached = true; m.stage = st; m.stageT = 0; note(m, st, extra); }

  // ---------------------------------------------------------------- police lines
  /* line(id, spec): a police line between the mob and what it wants.
       at {x,z}  centre of the line;  face  the way the officers look (rad,
       toward the crowd);  width  m;  n officers;  kind police|guard|army;
       shields;  gas (canisters it may fire);  retreat {x,z}  where a broken
       line falls back to;  advance  m/s toward the crowd (a clearing line) */
  function line(id, spec) {
    const m = mobById(id); if (!m || !spec || !spec.at) return null;
    const kind = spec.kind || "police";
    const f = isFinite(spec.face) ? spec.face : 0, nx = Math.sin(f), nz = Math.cos(f);
    const w = spec.width || 14;
    const L = {
      id: "line" + (++SEQ), mob: m.id, kind: kind, cx: spec.at.x, cz: spec.at.z, nx: nx, nz: nz, tx: nz, tz: -nx, half: w / 2,
      officers: [], strength: 0, broken: false, shields: spec.shields !== false, gas: spec.gas != null ? spec.gas | 0 : (kind === "police" ? 4 : 10),
      gasCD: 6, retreat: spec.retreat || null, advance: +spec.advance || 0, hostile: spec.hostile !== false, held: 0, t: 0,
      rigs: [], breakAt: spec.breakAt || 0,
    };
    const n = clamp(spec.n | 0 || 12, 2, 60);
    if (freeList.length < n) reclaim(n, null);
    for (let k = 0; k < n; k++) {
      const i = alloc(); if (i < 0) break;
      amob[i] = m.slot; aside[i] = 1; arole[i] = ROLE.officer; aact[i] = 0; atim[i] = 0; arig[i] = -1; aclimb[i] = 0;
      const rank = k % 2, j = (k >> 1), per = Math.ceil(n / 2);
      aox[i] = (j - (per - 1) / 2) * (w / Math.max(1, per)); aoz[i] = rank * 1.1;
      ax[i] = L.cx + L.tx * aox[i] - nx * aoz[i]; az[i] = L.cz + L.tz * aox[i] - nz * aoz[i];
      ay[i] = floorAt(ax[i], az[i]); ahd[i] = f; aph[i] = 0; asp[i] = 0; avx[i] = 0; avz[i] = 0;
      dressOfficer(i, kind);
      L.officers.push(i);
      m.agents.push(i);
    }
    const mult = (L.shields ? 1.4 : 1) * (kind === "army" ? 3 : kind === "guard" ? 2.2 : 1);
    L.strength = L.officers.length * mult;
    L.breakAt = L.breakAt || (6 + L.strength * 1.6);
    LINES.push(L);
    if (!m.line || L.hostile) m.line = L;
    note(m, "line", { line: kind, officers: L.officers.length });
    return L.id;
  }
  function lineById(id) { for (let i = 0; i < LINES.length; i++) if (LINES[i].id === id) return LINES[i]; return null; }
  // signed distance of a point in front of the line (positive = on the crowd's side)
  function lineSide(L, x, z) { return (x - L.cx) * L.nx + (z - L.cz) * L.nz; }
  function lineAlong(L, x, z) { return (x - L.cx) * L.tx + (z - L.cz) * L.tz; }
  function breakLine(L, why) {
    if (L.broken) return;
    L.broken = true;
    STATS.linesBroken++;
    const m = mobById(L.mob);
    for (let k = 0; k < L.officers.length; k++) { const i = L.officers[k]; aact[i] = ACT.flee; atim[i] = 6 + h01(i, 3, 5) * 4; }
    if (m) {
      m.pressure = 0;
      setStage(m, "breach", { line: L.kind, why: why || "pressure" });
      STATS.breaches++;
      if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(L.cx, L.cz, 1.4); } catch (e) {} }
    }
  }

  // ---------------------------------------------------------------- gas + projectiles
  const SHOTS = [];        // {x,y,z,vx,vy,vz,kind,alive,t}
  function lob(x0, y0, z0, x1, z1, kind, flight) {
    if (SHOTS.length >= 32) SHOTS.shift();
    const T = flight || 1.1;
    const s = { x: x0, y: y0, z: z0, vx: (x1 - x0) / T, vz: (z1 - z0) / T, vy: 0, t: 0, T: T, kind: kind, alive: true };
    const y1 = floorAt(x1, z1) + 0.2;
    s.vy = (y1 - y0 + 4.9 * T * T) / T;
    SHOTS.push(s);
    if (kind === "gas") STATS.gasFired++; else STATS.thrown++;
    return s;
  }
  function gas(x, z, r) {
    const c = { x: x, z: z, r: r || 6, t: 0, ttl: 14, puffT: 0 };
    GAS.push(c);
    if (GAS.length > 8) GAS.shift();
    // every rig inside runs out of it, through the shared brain
    const B = CBZ.cityBrain;
    for (let i = 0; i < hiAgent; i++) {
      if (amob[i] < 0 || aside[i] !== 0) continue;
      const dx = ax[i] - x, dz = az[i] - z;
      if (dx * dx + dz * dz > (c.r + 2) * (c.r + 2)) continue;
      aact[i] = ACT.flee; atim[i] = 4 + h01(i, 9, 2) * 4;
      const ped = rigPed(i);
      if (ped && B && B.perform) { try { B.perform(ped, "flee", { x: x, z: z, armed: false }); } catch (e) {} }
    }
    const m = nearestMob(x, z, 60);
    if (m) { m.pressure *= 0.85; m.anger = clamp(m.anger - 0.04, 0, 1); note(m, "gas", { at: { x: x, z: z } }); }
    return c;
  }
  function tickShots(dt) {
    for (let k = SHOTS.length - 1; k >= 0; k--) {
      const s = SHOTS[k];
      if (!s.alive) { SHOTS.splice(k, 1); continue; }
      s.t += dt;
      s.x += s.vx * dt; s.z += s.vz * dt; s.vy -= 9.8 * dt; s.y += s.vy * dt;
      if (s.t >= s.T) {
        s.alive = false;
        if (s.kind === "gas") gas(s.x, s.z, 6.5);
      }
    }
  }
  function tickGas(dt) {
    for (let k = GAS.length - 1; k >= 0; k--) {
      const c = GAS[k];
      c.t += dt; c.puffT -= dt;
      if (c.t > c.ttl) { GAS.splice(k, 1); continue; }
      if (c.puffT <= 0 && CBZ.cityCrashSmoke) {
        c.puffT = 1.3;
        const P = player();
        if (!P || Math.hypot(P.x - c.x, P.z - c.z) < 220) {
          try { CBZ.cityCrashSmoke(c.x, floorAt(c.x, c.z) + 0.2, c.z, { count: 3, scale: 1.6 + c.t * 0.05, shade: 0.78 }); } catch (e) {}
        }
      }
    }
  }
  function inGas(x, z) {
    for (let k = 0; k < GAS.length; k++) { const c = GAS[k], dx = x - c.x, dz = z - c.z, r = c.r * (0.7 + Math.min(0.6, c.t * 0.08)); if (dx * dx + dz * dz < r * r) return c; }
    return null;
  }

  // ---------------------------------------------------------------- the step
  // the contact hash: per mob, a grid over the mob's own bounds
  let GH = new Int32Array(4096), GN = new Int32Array(CAP);
  function nearestMob(x, z, r) {
    let best = null, bd = (r || 1e9) * (r || 1e9);
    for (let i = 0; i < MOBS.length; i++) { const m = MOBS[i]; if (!m || m.gone) continue; const dx = m.centroid.x - x, dz = m.centroid.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = m; } }
    return best;
  }
  function headAdvance(m, dt) {
    if (!m.route || m.stage === "rally" || m.stage === "disperse") return;
    if (m.ri >= m.route.length) return;
    const tgt = m.route[m.ri];
    const dx = tgt.x - m.head.x, dz = tgt.z - m.head.z, d = Math.hypot(dx, dz);
    // a crowd's head waits for its body: the column never stretches thin
    let lag = 0, cnt = 0;
    const px = m.dir.z, pz = -m.dir.x;
    for (let k = 0; k < m.agents.length && cnt < 24; k += 3) {
      const i = m.agents[k]; if (aside[i] !== 0 || aoz[i] > 3 || aact[i] === ACT.flee) continue;
      lag += Math.hypot(ax[i] - (m.head.x - m.dir.x * aoz[i] + px * aox[i]), az[i] - (m.head.z - m.dir.z * aoz[i] + pz * aox[i])); cnt++;
    }
    lag = cnt ? lag / cnt : 0;
    let v = m.speed * (lag > 5 ? 0.35 : lag > 3 ? 0.7 : 1);
    // a standing line stops the head at its front
    const L = m.line;
    if (L && !L.broken) {
      const s = lineSide(L, m.head.x, m.head.z);
      if (s < 1.6 && Math.abs(lineAlong(L, m.head.x, m.head.z)) < L.half + 3) {
        v = 0;
        if (m.stage === "march") setStage(m, "confront", { line: L.kind });
      }
    }
    if (d < 0.6) {
      if (tgt.door && m.stage === "breach") { forceDoor(m, tgt); }
      m.ri++;
      if (m.ri >= m.route.length && m.stage === "march") setStage(m, "arrived");
      return;
    }
    if (d > 0.01) {
      const ux = dx / d, uz = dz / d;
      m.dir.x += (ux - m.dir.x) * Math.min(1, dt * 1.5); m.dir.z += (uz - m.dir.z) * Math.min(1, dt * 1.5);
      const dl = Math.hypot(m.dir.x, m.dir.z) || 1; m.dir.x /= dl; m.dir.z /= dl;
      const stepv = Math.min(d, v * dt);
      m.head.x += ux * stepv; m.head.z += uz * stepv;
    }
  }
  function forceDoor(m, at) {
    // the shell doors near the breach point give
    if (CBZ.cityDoorsGet) {
      try {
        const D = CBZ.cityDoorsGet() || [];
        for (let k = 0; k < D.length; k++) { const dr = D[k]; if (dr && isFinite(dr.wx) && Math.hypot(dr.wx - at.x, dr.wz - at.z) < 9) { dr.open = true; dr.hold = 600; } }
      } catch (e) {}
    }
    const U = CBZ.cityUnitDoors;
    if (U && U.at && U.setOpen) {
      try { const d = U.at(at.x, at.z, 6); if (d) { d.forced = true; U.setOpen(d, true, null); } } catch (e) {}
    }
    if (!m.doorForced) { m.doorForced = true; note(m, "door", { at: { x: at.x, z: at.z } }); }
  }
  // the goal, then the perimeter: a goal on secured ground becomes the nearest
  // point outside it, and a crowd going home walks AWAY from the fence
  function desired(m, i) {
    const v = goal(m, i);
    if (aside[i] === 0 && walled(m)) {
      const out = m.stage === "disperse" && CBZ.perimeter.outward ? CBZ.perimeter.outward(atx[i], atz[i]) : null;
      if (out) { atx[i] = ax[i] + out.x * 30; atz[i] = az[i] + out.z * 30; }
      const q = CBZ.perimeter.clampOut(atx[i], atz[i], _KO);
      atx[i] = q.x; atz[i] = q.z;
    }
    return v;
  }
  function goal(m, i) {
    if (aside[i] === 1) {
      // an officer: his slot on the line, or the way back
      const L = lineOf(i);
      if (!L) { atx[i] = ax[i]; atz[i] = az[i]; return SPD.police; }
      if (L.broken && L.retreat) { atx[i] = L.retreat.x + (h01(i, 1, 9) - 0.5) * 6; atz[i] = L.retreat.z + (h01(i, 2, 9) - 0.5) * 6; return SPD.run; }
      atx[i] = L.cx + L.tx * aox[i] - L.nx * aoz[i]; atz[i] = L.cz + L.tz * aox[i] - L.nz * aoz[i];
      return L.advance > 0 ? Math.max(SPD.police, L.advance * 1.5) : SPD.police;
    }
    if (m.stage === "disperse") {
      const dx = ax[i] - m.centroid.x, dz = az[i] - m.centroid.z, d = Math.hypot(dx, dz) || 1;
      atx[i] = ax[i] + dx / d * 30; atz[i] = az[i] + dz / d * 30;
      return m.flee ? SPD.flee : SPD.walk * 1.2;
    }
    if (m.stage === "rally" || (m.hold && m.stage !== "breach")) {
      // a knot round the muster point, facing what they came for
      const fx = Math.sin(m.face), fz = Math.cos(m.face);
      const lat = aox[i] * 0.85, back = aoz[i] * 0.75;
      atx[i] = m.at.x + fz * lat - fx * back; atz[i] = m.at.z - fx * lat - fz * back;
      return SPD.walk;
    }
    if (m.stage === "inside" && m.insideAt) {
      const a = h01(i, 3, 7) * 6.283, r = 2 + h01(i, 4, 7) * (m.insideAt.r || 10);
      atx[i] = m.insideAt.x + Math.cos(a) * r; atz[i] = m.insideAt.z + Math.sin(a) * r;
      return SPD.walk * 1.3;
    }
    // the column behind the head
    const px = m.dir.z, pz = -m.dir.x;
    // at a line they do not stop at the head: they lean into the shields, so
    // the whole column wants to be a couple of metres further than it can be
    const back = aoz[i] * (m.stage === "confront" ? 0.62 : 1) - (m.stage === "confront" ? 2.6 : 0);
    atx[i] = m.head.x - m.dir.x * back + px * aox[i];
    atz[i] = m.head.z - m.dir.z * back + pz * aox[i];
    return m.stage === "breach" ? SPD.walk * 1.7 : (m.stage === "confront" ? SPD.walk : m.speed);
  }
  const LINE_OF = new Int16Array(CAP).fill(-1);
  function lineOf(i) { const k = LINE_OF[i]; return k >= 0 && k < LINES.length ? LINES[k] : null; }
  function indexLines() {
    LINE_OF.fill(-1);
    for (let k = 0; k < LINES.length; k++) { const L = LINES[k]; for (let j = 0; j < L.officers.length; j++) LINE_OF[L.officers[j]] = k; }
  }

  let stepN = 0;
  function simStep(dt) {
    stepN++;
    const P = player();
    indexLines();
    for (let mi = 0; mi < MOBS.length; mi++) {
      const m = MOBS[mi];
      if (!m) continue;
      m.t += dt; m.stageT += dt;
      // the knot's centre (cheap: a stride through its agents)
      let cx = 0, cz = 0, cn = 0;
      for (let k = 0; k < m.agents.length; k += 4) { const i = m.agents[k]; if (aside[i] === 0) { cx += ax[i]; cz += az[i]; cn++; } }
      if (cn) { m.centroid.x = cx / cn; m.centroid.z = cz / cn; }
      m.coarse = !P || Math.hypot(P.x - m.centroid.x, P.z - m.centroid.z) > COARSE;
      headAdvance(m, dt);
      tickLines(m, dt);
      if (m.stage === "breach" && m.route && m.ri >= m.route.length && m.insideAt) setStage(m, "inside");
      if (m.stage === "disperse" && m.stageT > (m.flee ? 30 : 45)) { endMob(m); continue; }
      stepAgents(m, dt);
    }
    // lines whose mob is gone go with it
    for (let k = LINES.length - 1; k >= 0; k--) if (!mobById(LINES[k].mob)) LINES.splice(k, 1);
    tickShots(dt);
    tickGas(dt);
  }
  function tickLines(m, dt) {
    for (let k = 0; k < LINES.length; k++) {
      const L = LINES[k];
      if (L.mob !== m.id) continue;
      L.t += dt;
      if (L.broken) {
        // a broken line is off the field once it reaches its fallback
        continue;
      }
      if (L.advance > 0) {
        // a clearing line walks into the crowd, gas going in ahead of it
        L.cx += L.nx * L.advance * dt; L.cz += L.nz * L.advance * dt;
        m.anger = clamp(m.anger - dt * 0.012 * (L.kind === "army" ? 2 : 1), 0, 1);
        if (m.stage !== "disperse" && (m.anger < 0.12 || L.t > 70)) disperse(m.id, true);
      }
      if (L.hostile && L.gas > 0 && m.stage !== "disperse") {
        L.gasCD -= dt;
        const hot = m.pressure > L.breakAt * 0.45 || L.advance > 0 || m.stage === "breach";
        if (L.gasCD <= 0 && hot) {
          L.gasCD = L.advance > 0 ? 5 : 9;
          L.gas--;
          const d = 6 + rng() * 6, lat = (rng() - 0.5) * L.half * 1.4;
          lob(L.cx - L.nx * 0.5, floorAt(L.cx, L.cz) + 1.6, L.cz - L.nz * 0.5, L.cx + L.nx * d + L.tx * lat, L.cz + L.nz * d + L.tz * lat, "gas", 1.0);
        }
      }
      // the front's push against what the line holds
      if (m.line === L && (m.stage === "confront" || m.stage === "march")) {
        // each body pressed against the shields pushes; the souls behind the
        // simulated ones push through them (the crowd beyond the cap is real
        // weight, it just is not drawn one by one). Tuned so a few thousand
        // angry people take a 16-officer shield line in about a minute, and a
        // few hundred do not take it at all.
        const push = m.frontContacts * 0.05 * (0.4 + m.anger) * (m.size > m.agents.length ? Math.min(2.5, 1 + Math.log(m.size / Math.max(1, m.agents.length)) * 0.5) : 1);
        const hold = L.strength * 0.06;
        m.pressure = Math.max(0, m.pressure + (push - hold) * dt);
        // a crowd pressed against a line gets angrier the longer it is held there
        if (m.stage === "confront" && m.frontContacts > 4) m.anger = clamp(m.anger + dt * 0.006, 0, 1);
        if (m.pressure >= L.breakAt) breakLine(L, "pressure");
      }
    }
  }
  function stepAgents(m, dt) {
    const A = m.agents, n = A.length;
    const P = player();
    const coarse = m.coarse;
    // ---- the contact hash over this mob's bounds
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
    for (let k = 0; k < n; k++) { const i = A[k]; if (ax[i] < minX) minX = ax[i]; if (ax[i] > maxX) maxX = ax[i]; if (az[i] < minZ) minZ = az[i]; if (az[i] > maxZ) maxZ = az[i]; }
    let cs = CELL, gw = Math.ceil((maxX - minX) / cs) + 1, gd = Math.ceil((maxZ - minZ) / cs) + 1;
    while (gw * gd > 65536) { cs *= 2; gw = Math.ceil((maxX - minX) / cs) + 1; gd = Math.ceil((maxZ - minZ) / cs) + 1; }
    const useGrid = !coarse && n > 1;
    if (useGrid) {
      if (GH.length < gw * gd) GH = new Int32Array(gw * gd);
      GH.fill(-1, 0, gw * gd);
      for (let k = 0; k < n; k++) {
        const i = A[k]; if (aact[i] === ACT.inside) continue;
        const c = ((((ax[i] - minX) / cs) | 0) + (((az[i] - minZ) / cs) | 0) * gw);
        GN[i] = GH[c]; GH[c] = i;
      }
    }
    m.frontContacts = 0;
    const L = m.line && !m.line.broken ? m.line : null;
    for (let k = 0; k < n; k++) {
      const i = A[k]; if (amob[i] < 0) continue;
      // sleeping: far from the player, a quarter of the steps
      let ddt = dt;
      if (P && arig[i] < 0) {
        const dpx = ax[i] - P.x, dpz = az[i] - P.z;
        if (dpx * dpx + dpz * dpz > FAR_SLEEP * FAR_SLEEP) { if (((i + stepN) & 3) !== 0) continue; ddt = dt * 4; }
      }
      atim[i] -= ddt; if (acd[i] > 0) acd[i] -= ddt;
      let vmax = desired(m, i);
      // actions with their own clocks
      if (aact[i] === ACT.flee) {
        if (atim[i] <= 0) aact[i] = 0;
        else {
          const c = inGas(ax[i], az[i]);
          const fx = c ? ax[i] - c.x : ax[i] - m.centroid.x, fz = c ? az[i] - c.z : az[i] - m.centroid.z, fd = Math.hypot(fx, fz) || 1;
          atx[i] = ax[i] + fx / fd * 12; atz[i] = az[i] + fz / fd * 12; vmax = SPD.flee;
        }
      } else if (aside[i] === 0 && GAS.length && inGas(ax[i], az[i])) { aact[i] = ACT.flee; atim[i] = 3 + h01(i, stepN, 3) * 3; }
      if (aact[i] === ACT.throw && atim[i] <= 0) aact[i] = 0;
      if (aact[i] === ACT.fight && atim[i] <= 0) aact[i] = 0;
      if (aact[i] === ACT.cheer && atim[i] <= 0) aact[i] = 0;
      // the rig walks itself; its body IS this agent
      if (arig[i] >= 0) { rigFollow(i, m, vmax); continue; }
      // ---- seek (arrive), slowed by how packed it is round them
      let dx = atx[i] - ax[i], dz = atz[i] - az[i];
      const d = Math.hypot(dx, dz);
      let vx = 0, vz = 0;
      if (d > 0.08) {
        const v = Math.min(vmax, d * 1.1);
        vx = dx / d * v; vz = dz / d * v;
      }
      if (useGrid && aact[i] !== ACT.inside) {
        // density + separation in one pass over the 3x3 cells
        const gx = ((ax[i] - minX) / cs) | 0, gz = ((az[i] - minZ) / cs) | 0;
        let near = 0, sx = 0, sz = 0;
        for (let oz = -1; oz <= 1; oz++) {
          const rz = gz + oz; if (rz < 0 || rz >= gd) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const rx = gx + ox; if (rx < 0 || rx >= gw) continue;
            let j = GH[rx + rz * gw], guard = 0;
            while (j >= 0 && guard++ < 24) {
              if (j !== i) {
                const qx = ax[i] - ax[j], qz = az[i] - az[j], q2 = qx * qx + qz * qz;
                if (q2 < 2.25) near++;
                if (q2 < SEP * SEP && q2 > 1e-6) { const q = Math.sqrt(q2), o = (SEP - q) / q; sx += qx * o; sz += qz * o; }
              }
              j = GN[j];
            }
          }
        }
        // the fundamental diagram: at ~4 people per square metre nobody walks
        const rho = near / 7.07;
        const slow = clamp(1 - rho / 4.2, 0.12, 1);
        vx *= slow; vz *= slow;
        ax[i] += sx * 0.5; az[i] += sz * 0.5;
        if (aside[i] === 0 && near > 9 && m.stage === "confront") aact[i] = aact[i] || ACT.push;
      }
      // smooth the velocity (people do not turn on a pin)
      avx[i] += (vx - avx[i]) * Math.min(1, ddt * 4); avz[i] += (vz - avz[i]) * Math.min(1, ddt * 4);
      let nx = ax[i] + avx[i] * ddt, nz = az[i] + avz[i] * ddt;
      // ---- the line: nobody walks through standing officers
      if (L && aside[i] === 0) {
        const s = (nx - L.cx) * L.nx + (nz - L.cz) * L.nz, along = Math.abs((nx - L.cx) * L.tx + (nz - L.cz) * L.tz);
        // the officers' side of the line is theirs; only the people pressed up
        // against it (not a crowd already deep behind it) are held back
        if (along < L.half + 0.6 && s < 0.9 && s > -2.5) {
          if (aclimb[i] > 0.6 && arole[i] === ROLE.climber) { /* over the barricade: the climber is on top of it */ }
          else { nx += L.nx * (0.9 - s); nz += L.nz * (0.9 - s); }
          if (aact[i] !== ACT.flee) m.frontContacts += ddt / dt;      // a sleeping body counts for the steps it slept
          frontActs(i, m, L, ddt);
        }
      }
      if (aside[i] === 0 && walled(m)) {
        const q = CBZ.perimeter.clampOut(nx, nz, _KO);
        if (q.moved) { nx = q.x; nz = q.z; avx[i] *= 0.3; avz[i] *= 0.3; }
      }
      ax[i] = nx; az[i] = nz;
      const sp = Math.hypot(avx[i], avz[i]);
      asp[i] = sp;
      if (sp > 0.15) ahd[i] = Math.atan2(avx[i], avz[i]);
      else if (m.stage === "rally" || m.hold) ahd[i] += (((m.face - ahd[i] + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, ddt * 2);
      else if (L && aside[i] === 0) ahd[i] = Math.atan2(-L.nx, -L.nz);
      aph[i] += ddt * (sp > 0.15 ? sp * (sp > RUN_AT ? GAIT.run : GAIT.walk) : 0);     // the baked stride: feet do not skate
      if (aclimb[i] > 0 && (arole[i] !== ROLE.climber || !L)) aclimb[i] = Math.max(0, aclimb[i] - ddt * 1.2);
      if (!coarse || (stepN & 7) === 0) ay[i] = floorAt(ax[i], az[i]) + aclimb[i];
      if (aside[i] === 1) { const Lo = lineOf(i); if (Lo && !Lo.broken) ahd[i] = Math.atan2(Lo.nx, Lo.nz); }
    }
    if (m._culled) {
      m._culled = false;
      m.agents = m.agents.filter(function (j) { return amob[j] >= 0; });
      for (let k = 0; k < LINES.length; k++) if (LINES[k].mob === m.id) LINES[k].officers = LINES[k].officers.filter(function (j) { return amob[j] >= 0 && aside[j] === 1; });
    }
  }
  // the front rank: throw, climb, fight
  function frontActs(i, m, L, dt) {
    if (aact[i] === ACT.flee || aact[i] === ACT.throw || aact[i] === ACT.fight) return;
    const r = arole[i];
    if (r === ROLE.thrower && acd[i] <= 0 && m.anger > 0.35) {
      aact[i] = ACT.throw; atim[i] = 0.6; acd[i] = 4 + h01(i, stepN, 3) * 5;
      const tx = L.cx + L.tx * (h01(i, stepN, 1) - 0.5) * L.half * 1.6 - L.nx * 1.5, tz = L.cz + L.tz * (h01(i, stepN, 2) - 0.5) * L.half * 1.6 - L.nz * 1.5;
      lob(ax[i], ay[i] + 1.9, az[i], tx, tz, "bottle", 0.9);
      m.anger = clamp(m.anger + 0.004, 0, 1);
    } else if (r === ROLE.climber && m.anger > 0.45) {
      aact[i] = ACT.climb;
      aclimb[i] = Math.min(1.05, aclimb[i] + dt * 0.7);
    } else if (r === ROLE.fighter && acd[i] <= 0 && m.anger > 0.4) {
      aact[i] = ACT.fight; atim[i] = 1.2 + h01(i, stepN, 4); acd[i] = 2.5 + h01(i, stepN, 6) * 2;
      const ped = rigPed(i);
      if (ped && CBZ.verbs && CBZ.verbs.strike) {
        const cop = nearestCopRig(ped.pos.x, ped.pos.z, 2.2);
        if (cop) { try { CBZ.verbs.strike(ped, cop, { kind: h01(i, stepN, 5) < 0.5 ? "shove" : "jab" }); } catch (e) {} }
      }
    }
  }

  // ---------------------------------------------------------------- rigs (the near ring)
  const RIGS = [];          // {i, ped, cop}
  function rigPed(i) { const k = arig[i]; return k >= 0 && RIGS[k] ? RIGS[k].ped : null; }
  function nearestCopRig(x, z, r) {
    let best = null, bd = r * r;
    for (let k = 0; k < RIGS.length; k++) { const R = RIGS[k]; if (!R || !R.cop || !R.ped || R.ped.dead) continue; const dx = R.ped.pos.x - x, dz = R.ped.pos.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = R.ped; } }
    return best;
  }
  function rigCount(cop) { let n = 0; for (let k = 0; k < RIGS.length; k++) if (RIGS[k] && !!RIGS[k].cop === !!cop) n++; return n; }
  const JOBS = ["electrician", "teacher", "retiree", "student", "nurse", "truck driver", "office worker", "farmer", "mechanic", "shop assistant", "veteran", "pastor"];
  function makeRig(i) {
    const m = MOBS[amob[i]]; if (!m) return false;
    let ped = null, cop = aside[i] === 1;
    const x = ax[i], z = az[i];
    try {
      if (cop) {
        const L = lineOf(i);
        if (L && (L.kind === "guard" || L.kind === "army") && CBZ.cityPostNpc) {
          ped = CBZ.cityPostNpc(x, z, { job: "soldier", archetype: "military", kind: "security", armed: true, weapon: "Rifle", aggr: 0.3, face: ahd[i], src: "mob:guard" });
          if (ped) ped.organization = "military";
        } else if (CBZ.citySpawnCop) {
          ped = CBZ.citySpawnCop(x, z, false);
          if (ped && ped.pos && ped.pos.set) ped.pos.set(x, floorAt(x, z), z);
        }
        if (ped && CBZ.cityArmorDressPed) { try { CBZ.cityArmorDressPed(ped, ["helmet"]); } catch (e) {} }
        if (ped) giveShield(ped);
      } else if (CBZ.cityPostNpc) {
        const k = m.agents.indexOf(i);
        // THE SAME PERSON: built with the crowd member's body, skin, shirt and
        // hair style, then painted with the rest of the look (crowdgpu rigOpts
        // + dressRig), so the one who walks up is the one you were watching
        const G = CBZ.crowdGPU, lo = G && alook[i] >= 0 ? G.rigOpts(alook[i]) : {};
        ped = CBZ.cityPostNpc(x, z, Object.assign({
          job: JOBS[(h01(k, m.seed, 31) * JOBS.length) | 0], kind: "civilian", archetype: "resident", face: ahd[i],
          armed: false, aggr: arole[i] === ROLE.fighter ? 0.6 : 0.15 + m.violent * 0.2, wealth: 0.35 + h01(k, m.seed, 32) * 0.3,
          gender: abody[i] ? "f" : "m", skin: askin[i], outfit: ashirt[i], src: "mob:" + m.id,
        }, lo));
        if (ped && ped.char && G && alook[i] >= 0) {
          G.dressRig(ped.char, alook[i]);
          // and in step: the stride carries on from the crowd's gait phase
          const wc = G.clip("walk");
          if (wc) ped.char.phase = wc.phase0 + aph[i];
        }
      }
    } catch (e) { ped = null; }
    if (!ped) return false;
    ped.staffPost = null;
    ped._mob = m.id; ped._mobAgent = i;
    if (!cop) {
      const props = PP();
      if (props) {
        try {
          if (arole[i] === ROLE.sign) props.sign(ped, m.slogans[asign[i] % m.slogans.length], m.support);
          else if (arole[i] === ROLE.flag) props.flag(ped);
        } catch (e) {}
      }
    }
    let k = RIGS.indexOf(null); if (k < 0) { k = RIGS.length; RIGS.push(null); }
    RIGS[k] = { i: i, ped: ped, cop: cop, t: 0 };
    arig[i] = k;
    STATS.peakRigs = Math.max(STATS.peakRigs, rigCount(false));
    return true;
  }
  let _shieldGeo = null, _shieldMat = null;
  function giveShield(ped) {
    if (!ped || !ped.group) return;
    if (!_shieldGeo) {
      _shieldGeo = new THREE.BoxGeometry(0.62, 1.05, 0.04);
      _shieldMat = new THREE.MeshLambertMaterial({ color: 0xc8d6e2, transparent: true, opacity: 0.55, depthWrite: false });
      _shieldMat._shared = true;
    }
    const s = new THREE.Mesh(_shieldGeo, _shieldMat);
    s.position.set(-0.12, 1.05, 0.42);
    s.userData.mobShield = true;
    ped.group.add(s);
  }
  function dropRig(i) {
    const k = arig[i]; arig[i] = -1;
    if (k < 0 || !RIGS[k]) return;
    const R = RIGS[k]; RIGS[k] = null;
    const ped = R.ped;
    if (!ped) return;
    ped.moveOrder = null;
    if (ped.dead) return;            // a body stays where it fell
    if (R.cop) {
      if (CBZ.cityPostRelease) { try { CBZ.cityPostRelease(ped, "stand-down"); } catch (e) {} }
      if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
      const Lc = CBZ.cityCops; if (Lc) { const j = Lc.indexOf(ped); if (j >= 0) Lc.splice(j, 1); }
      const Lp = CBZ.cityPeds; if (Lp) { const j = Lp.indexOf(ped); if (j >= 0) Lp.splice(j, 1); }
      return;
    }
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(ped); return; } catch (e) {} }
  }
  function rigFollow(i, m, vmax) {
    const R = RIGS[arig[i]]; const ped = R && R.ped;
    if (!ped) { arig[i] = -1; return; }
    if (ped.dead) {
      // a marcher who dies stays down, out of the mob
      aact[i] = ACT.down;
      RIGS[arig[i]] = null; arig[i] = -1;
      m._culled = true;                       // taken out of the lists after the step loop
      release(i);
      m.dead = (m.dead | 0) + 1;
      return;
    }
    ax[i] = ped.pos.x; az[i] = ped.pos.z; ay[i] = ped.pos.y || 0;
    const busy = ped.state === "flee" || ped.state === "fight" || ped.ko || ped.restraint || ped.poseCower > 0;
    if (busy && aact[i] !== ACT.flee) { ped.moveOrder = null; return; }      // the brain has him; his own reaction wins
    const L = m.line;
    if (L && !L.broken && aside[i] === 0) {
      // the officers are bodies too, but a target past them would grind into them
      const s = lineSide(L, atx[i], atz[i]);
      if (s < 1.0 && Math.abs(lineAlong(L, atx[i], atz[i])) < L.half + 0.6) { atx[i] += L.nx * (1.0 - s); atz[i] += L.nz * (1.0 - s); }
      if (lineSide(L, ax[i], az[i]) < 1.4 && Math.abs(lineAlong(L, ax[i], az[i])) < L.half + 0.6) { m.frontContacts++; frontActs(i, m, L, SIM_DT); }
    }
    // a standing order, refreshed every step: walk to the slot, then hold it
    // facing what the crowd faces (the brain does not wander off between)
    const dx = atx[i] - ax[i], dz = atz[i] - az[i];
    const there = Math.hypot(dx, dz) < 0.6;
    const face = L && !L.broken && aside[i] === 0 ? Math.atan2(-L.nx, -L.nz) : (m.stage === "rally" || m.hold ? m.face : ahd[i]);
    ped.moveOrder = { x: there ? ax[i] : atx[i], z: there ? az[i] : atz[i], speed: there ? 0 : Math.min(vmax, vmax > 3 ? vmax : 1.6), stop: 0.5, face: there ? face : undefined, t: now() };
  }
  let rigAcc = 0;
  function manageRigs(dt) {
    rigAcc += dt;
    if (rigAcc < 0.25) return;
    rigAcc = 0;
    const P = player();
    // release: too far, or the mob is gone
    for (let k = 0; k < RIGS.length; k++) {
      const R = RIGS[k]; if (!R) continue;
      const i = R.i;
      if (amob[i] < 0 || !P) { dropRig(i); continue; }
      const d = Math.hypot(ax[i] - P.x, az[i] - P.z);
      if (d > BUD.near + 10 || aact[i] === ACT.inside) dropRig(i);
    }
    if (!P || !inCity() || !CBZ.cityPostNpc) return;
    // promote: the nearest agents inside the ring, two a tick
    let made = 0;
    const pairs = [];
    for (let i = 0; i < hiAgent; i++) {
      if (amob[i] < 0 || arig[i] >= 0 || aact[i] === ACT.inside) continue;
      const dx = ax[i] - P.x, dz = az[i] - P.z, d2 = dx * dx + dz * dz;
      if (d2 > BUD.near * BUD.near) continue;
      pairs.push([i, d2]);
    }
    if (!pairs.length) return;
    pairs.sort(function (a, b) { return a[1] - b[1]; });
    let civ = rigCount(false), cops = rigCount(true);
    for (let k = 0; k < pairs.length && made < 2; k++) {
      const i = pairs[k][0];
      if (aside[i] === 1 ? cops >= BUD.cops : civ >= BUD.rigs) continue;
      if (CBZ.citySpawnDraining) break;
      if (makeRig(i)) { made++; if (aside[i] === 1) cops++; else civ++; }
    }
  }

  // ---------------------------------------------------------------- chants, voices
  function tickVoices(m, dt) {
    m.chantT -= dt; m.voiceT -= dt;
    m.chantPulse = Math.max(0, m.chantPulse - dt);
    const P = player();
    const near = P && Math.hypot(P.x - m.centroid.x, P.z - m.centroid.z) < 240;
    if (m.chantT <= 0 && m.chants.length && m.stage !== "disperse") {
      m.chantT = 5.5 + rng() * 3;
      m.chantPulse = 2.4;
      const line_ = m.chants[(rng() * m.chants.length) | 0];
      m.lastChant = line_;
      // the voices that carry are the rigs near you; a leader starts it
      let said = 0;
      for (let k = 0; k < RIGS.length && said < 3; k++) {
        const R = RIGS[k]; if (!R || R.cop || !R.ped || amob[R.i] !== m.slot) continue;
        if (said === 0 || rng() < 0.35) { say(R.ped, line_, m.support ? "#f3e2b8" : "#ffb4a8", 2.6); said++; }
        const props = PP(); if (props && props.hype) { try { props.hype(R.ped, 2.4); } catch (e) {} }
      }
    }
    if (m.voiceT <= 0 && near && CBZ.crowdVoiceAt) {
      m.voiceT = 1.4;
      const angry = m.stage === "confront" || m.stage === "breach" || m.stage === "inside";
      const cheer = angry ? 0.25 + m.anger * 0.3 : (m.support ? 0.55 : 0.25);
      const boo = angry ? 0.6 + m.anger * 0.4 : (m.support ? 0.12 : 0.5);
      try { CBZ.crowdVoiceAt(m.centroid.x, m.centroid.z, { cheer: cheer, boo: boo, size: m.agents.length, volume: Math.min(1, 0.5 + m.agents.length / 500) }); } catch (e) {}
    }
  }
  function react(kind, id) {
    let n = 0;
    for (let mi = 0; mi < MOBS.length; mi++) {
      const m = MOBS[mi]; if (!m || (id && m.id !== id) || m.stage === "disperse") continue;
      const pleased = kind === "cheer" ? m.support : kind === "boo" ? !m.support : true;
      m.chantPulse = 3;
      m.anger = clamp(m.anger + (kind === "roar" ? 0.08 : pleased ? 0.03 : 0.05), 0, 1);
      for (let k = 0; k < m.agents.length; k++) { const i = m.agents[k]; if (aside[i] === 0 && aact[i] === 0 && pleased) { aact[i] = ACT.cheer; atim[i] = 2.5 + h01(i, k, 3); } }
      const P = player();
      if (CBZ.crowdVoiceAt && P && Math.hypot(P.x - m.centroid.x, P.z - m.centroid.z) < 240) {
        try { CBZ.crowdVoiceAt(m.centroid.x, m.centroid.z, { cheer: pleased ? 0.9 : 0.2, boo: pleased ? 0.1 : 0.9, size: m.agents.length, force: true }); } catch (e) {}
      }
      for (let k = 0, said = 0; k < RIGS.length && said < 2; k++) {
        const R = RIGS[k]; if (!R || R.cop || !R.ped || amob[R.i] !== m.slot) continue;
        say(R.ped, pleased ? (m.support ? "Yes!" : "That's right!") : (m.support ? "No!" : "Boo!"), pleased ? "#cfe3ff" : "#ffb4a8", 2);
        said++;
      }
      n++;
    }
    return n;
  }
  function chant(id, text) {
    const m = mobById(id); if (!m || !text) return false;
    m.chants.unshift(String(text)); if (m.chants.length > 6) m.chants.pop();
    m.chantT = 0;
    return true;
  }

  // ---------------------------------------------------------------- endings
  function disperse(id, flee) {
    const m = mobById(id); if (!m || m.stage === "disperse") return false;
    m.flee = !!flee;
    setStage(m, "disperse", { flee: !!flee });
    if (flee) {
      const B = CBZ.cityBrain;
      for (let k = 0; k < RIGS.length; k++) {
        const R = RIGS[k]; if (!R || R.cop || amob[R.i] !== m.slot) continue;
        if (B && B.perform) { try { B.perform(R.ped, "flee", { x: m.centroid.x, z: m.centroid.z }); } catch (e) {} }
      }
    }
    return true;
  }
  function endMob(m) {
    for (let k = m.agents.length - 1; k >= 0; k--) release(m.agents[k]);
    m.agents.length = 0;
    for (let k = LINES.length - 1; k >= 0; k--) if (LINES[k].mob === m.id) LINES.splice(k, 1);
    m.gone = true;
    MOBS[m.slot] = null;
    note(m, "end");
  }
  function panic(x, z) {
    let n = 0;
    for (let mi = 0; mi < MOBS.length; mi++) {
      const m = MOBS[mi]; if (!m) continue;
      if (Math.hypot(m.centroid.x - x, m.centroid.z - z) < 90) { disperse(m.id, true); n++; }
    }
    return n;
  }

  // ---------------------------------------------------------------- the picture
  // EVERY BODY IS THE REAL HUMAN. Past the rig ring the crowd is drawn by
  // entities/crowdgpu.js: the CBZ.human mesh, GPU-instanced, animated from its
  // own baked walk / run / chant / cheer / placard / flag clips, LOD'd down to
  // the rig's far tier and then to impostors rendered from it — and dressed in
  // the same colours its full rig wears when promoted. What stays instanced
  // boxes here is what IS a box: shields, sign boards, sticks, flags, bottles.
  const R_ = { built: false, root: null, crowd: null, parts: null, signs: Object.create(null), flags: Object.create(null), shots: null };
  const PARTS = ["shield", "stick"];
  function instanced(geo, mat, cap) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
    m.userData.dynamic = true; m.userData.transient = true;
    return m;
  }
  function build() {
    if (R_.built) return !!R_.root;
    R_.built = true;
    if (!THREE.InstancedMesh || typeof document === "undefined") return false;
    const root = arenaRoot(); if (!root) { R_.built = false; return false; }
    const grp = new THREE.Group(); grp.name = "mob-props"; grp.userData.dynamic = true;
    root.add(grp); R_.root = grp;
    const P = {};
    P.shield = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xc8d6e2, transparent: true, opacity: 0.55, depthWrite: false }), 120);
    P.stick = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0x8a6a44 }), CAP);
    for (const k of PARTS) grp.add(P[k]);
    R_.parts = P;
    R_.shots = instanced(new THREE.BoxGeometry(0.09, 0.22, 0.09), new THREE.MeshLambertMaterial({ color: 0x5a7a4a }), 32);
    grp.add(R_.shots);
    if (CBZ.crowdGPU) {
      R_.crowd = CBZ.crowdGPU.layer({ name: "mob", cap: CAP, parent: root, maxDraw: BUD.draw });
      const w = CBZ.crowdGPU.clip("walk"), r = CBZ.crowdGPU.clip("run");
      if (w && w.radPerM > 0) GAIT.walk = w.radPerM;
      if (r && r.radPerM > 0) GAIT.run = r.radPerM;
      GAIT.read = true;
    }
    return true;
  }
  function signMesh(text, support) {
    const key = (support ? "s:" : "p:") + text;
    if (R_.signs[key]) return R_.signs[key];
    let mats = null;
    const props = PP();
    if (props && props.signMats) { try { mats = props.signMats(text, support); } catch (e) { mats = null; } }
    if (!mats) { const e = new THREE.MeshLambertMaterial({ color: 0xefe6cf }); mats = [e, e, e, e, e, e]; }
    const m = instanced(new THREE.BoxGeometry(1, 1, 1), mats, Math.max(32, CAP >> 2));
    R_.root.add(m);
    R_.signs[key] = m;
    return m;
  }
  function flagMesh(id) {
    const key = String(id || "home");
    if (R_.flags[key]) return R_.flags[key];
    let tex = null;
    const F = CBZ.flags;
    if (F && F.texture) { try { tex = F.texture(id || (F.home ? F.home() : "republic")); } catch (e) { tex = null; } }
    const face = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex || null, side: THREE.DoubleSide });
    if (!tex) face.color.setHex(0x1d3c7a);
    const edge = new THREE.MeshLambertMaterial({ color: 0xdedad0 });
    const m = instanced(new THREE.BoxGeometry(1, 1, 1), [face, face, edge, edge, edge, edge], Math.max(32, CAP >> 2));
    R_.root.add(m);
    R_.flags[key] = m;
    return m;
  }
  // one box: T(x,y,z) * B * T(pivot) * Rx(rx) * T(0,oy,0) * S(sx,sy,sz), B = Ry(h) [* Rx(bp)]
  const _B = new Float32Array(9);
  function base(h, bp) {
    const c = Math.cos(h), s = Math.sin(h);
    if (!bp) { _B[0] = c; _B[1] = 0; _B[2] = -s; _B[3] = 0; _B[4] = 1; _B[5] = 0; _B[6] = s; _B[7] = 0; _B[8] = c; return; }
    const cb = Math.cos(bp), sb = Math.sin(bp);
    // columns of Ry(h) * Rx(bp)
    _B[0] = c; _B[1] = 0; _B[2] = -s;
    _B[3] = s * sb; _B[4] = cb; _B[5] = c * sb;
    _B[6] = s * cb; _B[7] = -sb; _B[8] = c * cb;
  }
  function putBox(mesh, slot, x, y, z, px, py, pz, rx, oy, sx, sy, sz) {
    const e = mesh.instanceMatrix.array, o = slot * 16;
    const cr = Math.cos(rx), sr = Math.sin(rx);
    // R = B * Rx(rx): col0 = B0, col1 = B1*cr + B2*sr, col2 = -B1*sr + B2*cr
    const c1x = _B[3] * cr + _B[6] * sr, c1y = _B[4] * cr + _B[7] * sr, c1z = _B[5] * cr + _B[8] * sr;
    const c2x = -_B[3] * sr + _B[6] * cr, c2y = -_B[4] * sr + _B[7] * cr, c2z = -_B[5] * sr + _B[8] * cr;
    e[o] = _B[0] * sx; e[o + 1] = _B[1] * sx; e[o + 2] = _B[2] * sx; e[o + 3] = 0;
    e[o + 4] = c1x * sy; e[o + 5] = c1y * sy; e[o + 6] = c1z * sy; e[o + 7] = 0;
    e[o + 8] = c2x * sz; e[o + 9] = c2y * sz; e[o + 10] = c2z * sz; e[o + 11] = 0;
    e[o + 12] = x + _B[0] * px + _B[3] * py + _B[6] * pz + c1x * oy;
    e[o + 13] = y + _B[1] * px + _B[4] * py + _B[7] * pz + c1y * oy;
    e[o + 14] = z + _B[2] * px + _B[5] * py + _B[8] * pz + c1z * oy;
    e[o + 15] = 1;
  }
  // which baked clip a crowd member is playing, from what they are doing
  const TAU = Math.PI * 2;
  const POSE_RATE = { idle: 0.25, cheer: 8 / TAU, fist: 5 / TAU, sign: 1.4 / TAU, flag: 2.2 / TAU };
  let _clip = "idle", _phase = 0, _rate = 0;
  function clipFor(i, m) {
    const r = arole[i], act = aact[i], sp = asp[i];
    if (act === ACT.down) { _clip = "down"; _phase = 0; _rate = 0; return; }
    if (sp > 0.3 || act === ACT.flee) {
      const run = sp > RUN_AT || act === ACT.flee;
      _clip = run ? "run" : (r === ROLE.sign ? "signWalk" : r === ROLE.flag ? "flagWalk" : "walk");
      _phase = aph[i] / TAU; _rate = 0;            // the agent's own gait phase drives the frame
      return;
    }
    const pulse = m.chantPulse > 0;
    if (r === ROLE.sign) _clip = "sign";
    else if (r === ROLE.flag) _clip = "flag";
    else if (r === ROLE.officer) _clip = "idle";
    else if (act === ACT.cheer || act === ACT.climb) _clip = "cheer";
    else if (act === ACT.fight || act === ACT.throw) _clip = "fist";
    else if (pulse && (r === ROLE.fist || r === ROLE.leader || r === ROLE.plain)) _clip = r === ROLE.leader ? "cheer" : "fist";
    else _clip = "idle";
    _phase = h01(i, 3, 9); _rate = POSE_RATE[_clip] || 0.25;
  }
  function draw(t) {
    if (!R_.built) build();
    if (!R_.root) return;
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    const P = R_.parts, crowd = R_.crowd;
    const n = { shield: 0, stick: 0 };
    for (const k in R_.signs) R_.signs[k].count = 0;
    for (const k in R_.flags) R_.flags[k].count = 0;
    if (crowd) crowd.begin();
    const pp = player(), cam = CBZ.camera;
    const cx = cam && cam.position ? cam.position.x : (pp ? pp.x : 0), cz = cam && cam.position ? cam.position.z : (pp ? pp.z : 0);
    const PROP2 = 130 * 130;                   // props past this are a pixel or two
    let bodies = 0;
    for (let i = 0; i < hiAgent; i++) {
      if (amob[i] < 0 || arig[i] >= 0) continue;
      const m = MOBS[amob[i]]; if (!m) continue;
      const x = ax[i], y = ay[i], z = az[i];
      if (crowd && alook[i] >= 0) { clipFor(i, m); crowd.add(x, y, z, ahd[i], alook[i], _clip, _phase, _rate); bodies++; }
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > PROP2 || aact[i] === ACT.down || aact[i] === ACT.flee) continue;
      const r = arole[i];
      base(ahd[i], 0);
      if (r === ROLE.officer && n.shield < P.shield.instanceMatrix.count) {
        putBox(P.shield, n.shield, x, y, z, -0.1, 1.05, 0.42, 0, 0, 0.6, 1.0, 0.04); n.shield++;
      } else if (r === ROLE.sign) {
        // where president_public's placard sits in the same pose: the board
        // over the head, both hands up the stick
        const sm = signMesh(m.slogans[asign[i] % m.slogans.length], m.support);
        const pump = Math.sin(t * 1.4 + i) * 0.04;
        if (sm.count < sm.instanceMatrix.count) { putBox(sm, sm.count, x, y, z, 0, 2.4, 0.2, pump * 0.25, 0, 0.82, 0.52, 0.02); sm.count++; }
        if (n.stick < CAP) { putBox(P.stick, n.stick, x, y, z, 0, 1.68, 0.2, 0, 0, 0.034, 1.0, 0.034); n.stick++; }
      } else if (r === ROLE.flag) {
        const fm = flagMesh(m.flag);
        if (fm.count < fm.instanceMatrix.count) {
          const wv = Math.sin(t * 2.2 + i * 0.7) * 0.1;
          putBox(fm, fm.count, x, y, z, -0.22, 2.2, 0.0, wv, 0, 0.02, 0.4, 0.62); fm.count++;
        }
        if (n.stick < CAP) { putBox(P.stick, n.stick, x, y, z, -0.22, 1.92, 0.3, 0, 0, 0.034, 0.9, 0.034); n.stick++; }
      }
    }
    if (crowd) crowd.commit();
    P.shield.count = n.shield; P.stick.count = n.stick;
    for (const k in P) { const M = P[k]; M.instanceMatrix.needsUpdate = M.count > 0; }
    for (const k in R_.signs) R_.signs[k].instanceMatrix.needsUpdate = R_.signs[k].count > 0;
    for (const k in R_.flags) R_.flags[k].instanceMatrix.needsUpdate = R_.flags[k].count > 0;
    // projectiles in flight
    const S = R_.shots; let ns = 0;
    base(0, 0);
    for (let k = 0; k < SHOTS.length && ns < 32; k++) { const s = SHOTS[k]; if (!s.alive) continue; base(s.t * 9, s.t * 7); putBox(S, ns++, s.x, s.y, s.z, 0, 0, 0, 0, 0, 1, 1, 1); }
    S.count = ns; S.instanceMatrix.needsUpdate = ns > 0;
    STATS.drawn = bodies;
    if (t0) STATS.drawMs = STATS.drawMs * 0.9 + ((performance.now() - t0) * 0.1);
  }
  function blank() {
    if (!R_.root) return;
    if (R_.crowd) R_.crowd.clear();
    for (const k in R_.parts) R_.parts[k].count = 0;
    for (const k in R_.signs) R_.signs[k].count = 0;
    for (const k in R_.flags) R_.flags[k].count = 0;
    if (R_.shots) R_.shots.count = 0;
  }

  // ---------------------------------------------------------------- the frame
  let acc = 0, CLOCK = 0;
  function frame(dt) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    CLOCK += dt;
    let any = false;
    for (let i = 0; i < MOBS.length; i++) if (MOBS[i]) { any = true; break; }
    if (!any && !SHOTS.length && !GAS.length) {
      if (R_.root && STATS.drawn >= 0) { blank(); STATS.drawn = -1; }
      return;
    }
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    acc += dt;
    let steps = 0;
    while (acc >= SIM_DT && steps < MAX_STEPS) { simStep(SIM_DT); acc -= SIM_DT; steps++; }
    if (steps >= MAX_STEPS) acc = 0;
    for (let i = 0; i < MOBS.length; i++) if (MOBS[i]) tickVoices(MOBS[i], dt);
    manageRigs(dt);
    if (t0) STATS.stepMs = STATS.stepMs * 0.9 + ((performance.now() - t0) * 0.1);
    if (inCity()) draw(CLOCK);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(38.792, frame);

  // ---------------------------------------------------------------- public
  function summary(m) {
    let inside = 0, flee = 0, police = 0, crowd = 0;
    for (let k = 0; k < m.agents.length; k++) { const i = m.agents[k]; if (aside[i] === 1) police++; else crowd++; if (aact[i] === ACT.flee) flee++; }
    if (m.insideAt) for (let k = 0; k < m.agents.length; k++) { const i = m.agents[k]; if (aside[i] === 0 && Math.hypot(ax[i] - m.insideAt.x, az[i] - m.insideAt.z) < (m.insideAt.r || 10) + 4) inside++; }
    const L = m.line;
    return {
      id: m.id, kind: m.kind, side: m.side, stage: m.stage, size: m.size, agents: crowd, police: police, fleeing: flee, inside: inside,
      centroid: { x: m.centroid.x, z: m.centroid.z }, head: { x: m.head.x, z: m.head.z }, anger: +m.anger.toFixed(2),
      pressure: +m.pressure.toFixed(1), line: L ? { kind: L.kind, broken: L.broken, strength: +L.strength.toFixed(1), breakAt: +L.breakAt.toFixed(1), officers: L.officers.length } : null,
      place: m.place, slogans: m.slogans.slice(), dead: m.dead | 0, doorForced: !!m.doorForced, events: m.events.map(function (e) { return e.phase; }),
    };
  }
  CBZ.mob = {
    form: form,
    march: march,
    line: line,
    gas: function (x, z, r) { return !!gas(x, z, r); },
    lob: function (x0, y0, z0, x1, z1, kind) { return !!lob(x0, y0, z0, x1, z1, kind || "bottle"); },
    react: react,
    chant: chant,
    disperse: disperse,
    panic: panic,
    stage: function (id) { const m = mobById(id); return m ? m.stage : null; },
    get: function (id) { const m = mobById(id); return m ? summary(m) : null; },
    list: function () { const out = []; for (let i = 0; i < MOBS.length; i++) if (MOBS[i]) out.push(summary(MOBS[i])); return out; },
    near: function (x, z, r) { const m = nearestMob(x, z, r || 60); return m ? summary(m) : null; },
    setAnger: function (id, a) { const m = mobById(id); if (!m) return false; m.anger = clamp(+a || 0, 0, 1); return true; },
    // where the crowd goes once it is through the door: {x, z, r}
    inside: function (id, at) { const m = mobById(id); if (!m || !at) return false; m.insideAt = { x: +at.x, z: +at.z, r: +at.r || 10 }; return true; },
    lineOf: function (id) { const m = mobById(id); return m && m.line ? { id: m.line.id, kind: m.line.kind, broken: m.line.broken } : null; },
    breakLine: function (lineId) { const L = lineById(lineId); if (!L) return false; breakLine(L, "ordered"); return true; },
    budget: function () { return Object.assign({ device: DEVICE, cap: CAP }, BUD); },
    audit: function () {
      return {
        device: DEVICE, cap: CAP, agents: liveAgents(), free: freeList.length, hi: hiAgent, rigs: rigCount(false), copRigs: rigCount(true),
        rigCap: BUD.rigs, copCap: BUD.cops, mobs: MOBS.filter(Boolean).length, lines: LINES.length, gas: GAS.length, shots: SHOTS.length,
        drawn: Math.max(0, STATS.drawn), lods: R_.crowd ? R_.crowd.drawn.slice(1) : null, stepMs: +STATS.stepMs.toFixed(3), drawMs: +STATS.drawMs.toFixed(3), peakAgents: STATS.peakAgents, peakRigs: STATS.peakRigs,
        formed: STATS.formed, breaches: STATS.breaches, linesBroken: STATS.linesBroken, gasFired: STATS.gasFired, thrown: STATS.thrown,
        built: !!R_.root,
      };
    },
    _step: frame,
    _agents: function () { return { ax: ax, az: az, amob: amob, aside: aside, aact: aact, arole: arole, hi: hiAgent }; },
    _reset: function () { for (let i = 0; i < MOBS.length; i++) if (MOBS[i]) endMob(MOBS[i]); GAS.length = 0; SHOTS.length = 0; },
  };
})();
