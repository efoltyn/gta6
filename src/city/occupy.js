/* ============================================================
   city/occupy.js — THE OCCUPIED-STRUCTURE BLOCK.

   OWNER (verbatim): "I want gangs to own a building and the boss to be
   sitting in an office in an apt on the top floor, with floors of the
   building filled with security on each floor, then boss top floor with
   family." Same block, different dressing, serves a government ministry, a
   corporate tower or a military base — only the preset changes.

   WHY THIS FILE EXISTS (2026-07-26 census): NINE independent implementations
   of "put NPCs in/near a building in roles" existed, ~1,020 duplicated lines,
   with the four-step boilerplate

       cityMakePed(...) -> root.add(ped.group) -> cityPeds.push(ped) -> stamp anchor

   repeated near-verbatim SEVEN times (gangs.js x2, playergang.js,
   protection.js, club.js, companies.js, security.js) and zero shared entry
   point. `lot.building.floorTops` already existed but NOTHING could place an
   NPC on an arbitrary floor N (the one interior-staff path is capped to
   floors 1-3 and <=6 bodies a building). No access control existed anywhere
   beyond three hardcoded jail rectangles. And no building in this game has
   ever had a staircase (see THE CLIMB below).

   ------------------------------------------------------------------
   THE THREE THINGS THAT MADE "FIGHT YOUR WAY UP" IMPOSSIBLE, AND THE FIX
   ------------------------------------------------------------------
   1. THE CLIMB. buildings.js ships a complete switchback stair rig that has
      never executed once: `stairW = min(SW=4.2, ...)` gated by
      `hasStairs = ... && stairW >= 4.4`. 4.2 is never >= 4.4, so hasStairs is
      dead-false for every building ever built, and the elevator is a sealed
      ground<->roof two-stop. There was no UP.
      FIX: CBZ.cityStairCore(lot) — a real switchback stair core, in
      elevators.js (the file that already owns vertical access), carved through
      the floor slabs with buildings.js's own CBZ.cityCarveShaft, with ONE
      ~1.8m doorway per floor. Every occupied building gets one. That doorway
      is the chokepoint each floor is defended around.

   2. THE HEIGHT. peds.js's move() ends with `ped.pos.y = 0` (peds.js:4236),
      and its turn-to-look-at-you branch does the same (peds.js:4026) — that
      second one is the "an upper-floor NPC snaps to the street the instant
      you target it" bug. CBZ.npcLife.attach dodges both, because peds.js
      `continue`s on _npcAttached before move() ever runs (peds.js:4317) — but
      that skips think() TOO, so an attached body is a STATUE: it cannot
      aggro, cannot shoot, cannot chase. A statue is not a defended floor.
      FIX: don't dodge move() — CORRECT it. One sweep (CBZ.onUpdate at 34.9,
      just after peds.js's own 34) re-lifts every occupancy body to its floor.
      `ped.pos` IS `ped.group.position` (peds.js:556), so that one write moves
      the rig too. Everything else is the shipped brain running at height:
        • collide() inside move() is already called with ped.pos.y, so
          height-gated wall colliders resolve on the RIGHT floor (peds.js:4228)
        • npcAttack bails on |Δy| > 2.2 (peds.js:1986) and FH is 3.2, so
          nobody shoots through a floor slab
        • floor slabs are registered LOS blockers (buildings.js:3290), so
          clearLineOfFire already refuses shots through a floor
      Zero new AI. One arithmetic line per posted body. It also fixes the
      _faceT street-teleport bug for every ped this file owns.

   3. THE POSTURE. A guard that WANDERS a 7m box (the shipped ped.guard leash)
      looks wrong standing in a corner office. A guard that can't move can't
      defend. FIX: both, in sequence — every interior post spawns ROOTED on
      peds.js's own `staffPost` brain (still gunpoint-aware, still dies through
      the kill bus, and staffPost returns from move() BEFORE the y-clamp so it
      holds its floor for free), and the alarm hands it the `ped.guard` +
      `ped.rage` + `state:"fight"` field trio — the exact quartet rallyGang
      already writes — so the floor comes alive when the building learns you
      are in it, and stands back down when it doesn't. Escalation with no
      state machine of its own.

   BLOCK LAW COMPLIANCE (CLAUDE.md):
     1. One-line adoption. The atom REPLACES the four lines a caller writes
        anyway — never extra bookkeeping on top of them:
            const ped = CBZ.cityPostNpc(x, z, { job:"security guard", guard:true });
        and the whole-building form is one call:
            CBZ.cityOccupyBuilding(lot, { preset:"gang", faction:g.id });
     2. Degrade-safe. Every entry point feature-detects and returns
        null/false/0 instead of throwing; `CBZ.cityPostNpc ? ... : <old inline
        cityMakePed block>` is a valid caller idiom, and a caller that has
        never heard of this file still works.
     3. SIX real consumers migrated in this same change: security.js, club.js,
        companies.js, protection.js, gangs.js (crew + boss), playergang.js.
     4. Named in CLAUDE.md.
     5. Ratchet: CBZ.occupyAudit() -> { legacy } — remaining un-migrated
        bespoke NPC-in-building spawners. Baseline 9, now 3. Only ever DOWN.

   WHAT IT REUSES (it invents no AI, no rig, no wardrobe, no death path):
     • CBZ.cityMakePed          — the ONE real-person factory (peds.js)
     • ped.staffPost / ped.guard / ped.rage / ped.mem / ped.alarmed
                                — the shipped posted-staff + guard + hostility
                                  fields, read by peds.js's own think()/move()
     • CBZ.cityStairCore        — the vertical rig (elevators.js)
     • CBZ.interiorFloorRoom / CBZ.interiorProgram / CBZ.interiorStaff
                                — the room kit (interior_programs.js); the
                                  "checkpoint" / "quarters" / "bosssuite"
                                  programs return ROLE-TAGGED anchors, so this
                                  file casts people into an authored room
                                  instead of scattering them round a perimeter
     • CBZ.npcLife.attach       — still used for genuinely SEATED occupants
     • CBZ.citySecurityIntruder — the existing intruder resolver
     • CBZ.cityLogDeath/killfeed, dossier, aim targeting — all free via cityPeds

   HONEST LIMITS (no stat fictions — if the block says six guards, six peds
   exist, are hittable, and shoot back):
     • Guards do not use the stairs. Nothing in this engine paths in Y
       (citynav is strictly 2D — every waypoint is {x,z}), so a guard alerted
       on floor 6 fights on floor 6; it does not descend to meet you. The
       alarm instead PROPAGATES upward floor by floor ahead of the player,
       which is what the reinforcement read is actually made of.
     • Family members never fight. They stay rooted and put their hands up.
       That is a choice, not a gap.
     • Access control is a REAL spatial gate for detection/alarm/queries
       (CBZ.cityMayEnter / cityAccessAt); it does not lock doors, because
       nothing in this engine has a lockable door yet.

   DETERMINISM: every placement roll is CBZ.seedStream("occupy:<id>") or
   CBZ.hash01 — no Math.random in any build path, no draws on a shared stream.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  /* ---------------- config (self-defaulted; see CLAUDE.md §flags) --------- */
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // OCCUPY_V1 (owner: "gangs own a building, boss on the top floor, security
  // on each floor, family up top"). On → cityOccupyBuilding/cityPostNpc place
  // real peds. Flip false (or ?cfg_OCCUPY_V1=0) and every consumer falls back
  // to its own inline spawn — a one-line revert to the exact prior behavior.
  if (CFG.OCCUPY_V1 == null) CFG.OCCUPY_V1 = true;
  // Citywide budget for occupancy-owned bodies (the whole point of one entry
  // point is ONE honest headcount). Mirrors INTERIOR_STAFF_MAX's role.
  if (CFG.OCCUPY_MAX_PEDS == null) CFG.OCCUPY_MAX_PEDS = 96;
  // ...and a per-building ceiling, so one 14-storey tower cannot swallow the
  // whole citywide budget and leave every other HQ empty.
  if (CFG.OCCUPY_MAX_PER_BUILDING == null) CFG.OCCUPY_MAX_PER_BUILDING = 20;
  // Per-floor access model + the trespass watcher (one 4Hz sweep over the
  // occupied-building registry, player only). Off → every floor reads public.
  if (CFG.OCCUPY_ACCESS == null) CFG.OCCUPY_ACCESS = true;
  // Build a real walkable stair core into occupied buildings (elevators.js's
  // CBZ.cityStairCore). Off → the building is still occupied, you just cannot
  // walk up it. This is the flag to flip if stairs ever misbehave.
  if (CFG.OCCUPY_STAIRS == null) CFG.OCCUPY_STAIRS = true;
  // Run the interior room programs (checkpoint/quarters/bosssuite) as each
  // floor is occupied. Off → bodies only, bare shells, no furniture cost.
  if (CFG.OCCUPY_PROGRAMS == null) CFG.OCCUPY_PROGRAMS = true;
  // How many floors above the disturbance the alarm climbs, and how fast.
  if (CFG.OCCUPY_ALARM_SPREAD == null) CFG.OCCUPY_ALARM_SPREAD = 2.2;   // seconds per floor
  // Shared lift ride (the fade+relocate the census found hand-rolled 3x).
  if (CFG.OCCUPY_LIFT == null) CFG.OCCUPY_LIFT = true;

  /* ---------------- small shared helpers --------------------------------- */
  function arenaRoot() {
    const A = CBZ.city && CBZ.city.arena;
    return (A && A.root) || CBZ.scene || null;
  }
  function nowMs() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
  function streamFor(name) {
    if (CBZ.seedStream) { try { return CBZ.seedStream("occupy:" + name); } catch (e) {} }
    // degrade-safe deterministic fallback (never Math.random in a build path)
    let s = 0; const t = "occupy:" + name;
    for (let i = 0; i < t.length; i++) s = (s * 31 + t.charCodeAt(i)) & 0x7fffffff;
    return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }
  // a group is only "live" while still connected to the scene — a torn-down
  // city keeps its local parent chain, so a bare .parent check leaks budget.
  function groupLive(o) {
    let hops = 0;
    while (o && hops++ < 64) { if (o === CBZ.scene) return true; o = o.parent; }
    return false;
  }
  function playerActor() { return (CBZ.city && CBZ.city.playerActor) || CBZ.player || null; }

  /* ======================================================================
     THE ATOM — cityPostNpc. This is the four lines every caller wrote by
     hand, and nothing more. It does not register anything, does not ask for
     a schema, and returns the plain ped so the caller keeps owning it.
     ====================================================================== */
  const observedSrc = Object.create(null);   // audit EVIDENCE (not the pin)

  // keys cityPostNpc consumes itself — everything else passes through to
  // cityMakePed untouched, so a caller never has to learn a second schema.
  const OWN_KEYS = {
    parent: 1, rng: 1, face: 1, homeGuard: 1, pin: 1, pose: 1,
    attach: 1, after: 1, src: 1, floorY: 1, post: 1,
  };

  CBZ.cityPostNpc = function (x, z, opts) {
    opts = opts || {};
    if (!CBZ.cityMakePed || !CBZ.cityPeds) return null;
    const parent = opts.parent || arenaRoot();
    if (!parent) return null;
    const r = opts.rng || streamFor("post:" + Math.round(x * 10) + ":" + Math.round(z * 10));

    // makePed opts = whatever the caller passed, minus this file's own keys.
    // NOTE `guard` and `controlled` deliberately pass THROUGH: cityMakePed
    // already understands them, so a migrating caller keeps its exact opts.
    const mk = {};
    for (const k in opts) if (!OWN_KEYS[k] && Object.prototype.hasOwnProperty.call(opts, k)) mk[k] = opts[k];
    if (mk.guard === true) mk.guard = { x: x, z: z };

    let ped = null;
    try { ped = CBZ.cityMakePed(x, z, r, mk); } catch (e) { ped = null; }
    if (!ped) return null;

    if (opts.face != null && ped.group) ped.group.rotation.y = opts.face;
    parent.add(ped.group);
    CBZ.cityPeds.push(ped);

    // ---- anchor stamps: the EXISTING primitives, never a new brain --------
    if (opts.homeGuard) {
      const h = (opts.homeGuard === true) ? { x: x, z: z } : opts.homeGuard;
      ped.homeGuard = { x: h.x, z: h.z };
    }
    if (opts.pin) {
      // peds.js's posted-staff brain: rooted, no wander, no crowd recast,
      // still gunpoint-aware and still dies through the kill bus. It also
      // returns from move() BEFORE the pos.y=0 clamp, so a pinned body holds
      // whatever height we spawn it at with no help from anyone.
      ped.staffPost = { x: x, z: z, face: opts.face || 0 };
      ped.state = "idle"; ped.speed = 0;
    }
    if (opts.pose && CBZ.setCharPose && ped.char) { try { CBZ.setCharPose(ped.char, opts.pose); } catch (e) {} }
    if (opts.src) { ped._occupySrc = opts.src; observedSrc[opts.src] = (observedSrc[opts.src] | 0) + 1; }

    // ---- FLOOR: the only thing that makes "on storey N" real -------------
    // ped.pos IS ped.group.position (peds.js:556), so this one write puts the
    // body AND the rig on the floor. The sweep below keeps it there.
    if (opts.floorY != null && opts.floorY > 0.2) {
      ped._occupyY = opts.floorY;
      if (ped.pos) ped.pos.y = opts.floorY;
      lift(ped);
    }
    // ---- attached post (seated occupants only) — the npcLife grammar -----
    // opts.attach = { parent, x, y, z, yaw, pose } in PARENT-LOCAL coords.
    if (opts.attach && CBZ.npcLife && CBZ.npcLife.attach) {
      const a = opts.attach;
      const ap = a.parent || parent;
      try {
        CBZ.npcLife.attach(ped, ap, {
          x: a.x || 0, y: a.y || 0, z: a.z || 0, yaw: a.yaw || 0,
          pose: a.pose || "stand", state: a.state || "idle",
        });
      } catch (e) {}
    }
    if (typeof opts.after === "function") { try { opts.after(ped); } catch (e) {} }
    return ped;
  };

  // the matching teardown (the other half every caller also hand-rolled)
  CBZ.cityUnpostNpc = function (ped) {
    if (!ped) return false;
    try {
      if (ped._npcAttached && CBZ.npcLife && CBZ.npcLife.detach) CBZ.npcLife.detach(ped, { parent: arenaRoot() });
      unlift(ped);
      if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
      const arr = CBZ.cityPeds;
      if (arr) { const i = arr.indexOf(ped); if (i >= 0) arr.splice(i, 1); }
    } catch (e) { return false; }
    return true;
  };

  /* ======================================================================
     THE FLOOR LIFT — see item 2 of the header. One sweep, one write, no AI.
     ====================================================================== */
  const LIFTED = [];
  function lift(p) { if (p && LIFTED.indexOf(p) < 0) LIFTED.push(p); }
  function unlift(p) { const i = LIFTED.indexOf(p); if (i >= 0) LIFTED.splice(i, 1); }
  CBZ.cityFloorPed = function (ped, y) {          // public: anyone can stand a ped up a building
    if (!ped || !ped.pos) return false;
    if (y == null || y <= 0.2) { ped._occupyY = 0; unlift(ped); return true; }
    ped._occupyY = y; ped.pos.y = y; lift(ped);
    return true;
  };
  // 34.9: peds.js's own updater is 34 and npclife's attach-sync is 33.8, so we
  // are the last word on Y in the same frame the brain wrote it.
  const LIFT_ORDER = (CBZ.PRIO && CBZ.PRIO.after && CBZ.PRIO.PED_BRAIN != null)
    ? CBZ.PRIO.after(CBZ.PRIO.PED_BRAIN, 90) : 34.9;
  if (CBZ.onUpdate) CBZ.onUpdate(LIFT_ORDER, function () {
    if (!CFG.OCCUPY_V1) return;
    for (let i = LIFTED.length - 1; i >= 0; i--) {
      const p = LIFTED[i];
      // a corpse leaves the sweep: holding a dead body at storey height means
      // it can never fall, and the 2-D medic dispatch can never reach it.
      if (!p || p.culled || p.dead || p._npcAttached || !p.pos) { LIFTED.splice(i, 1); continue; }
      const y = p._occupyY;
      if (!(y > 0.2)) { LIFTED.splice(i, 1); continue; }
      if (p.pos.y !== y) p.pos.y = y;              // the whole mechanism
    }
  });

  /* ======================================================================
     FLOORS — the resolver nobody had. floorTops is stamped by buildings.js
     and read by four files, each re-deriving "which floor is that" by hand.
     ====================================================================== */
  function bldOf(lot) {
    const b = lot && lot.building;
    return (b && b.group && b.w != null && b.d != null) ? b : null;
  }
  function fhOf(b) { return b.FH != null ? b.FH : 3.2; }
  // per-floor arrival Ys, ground..roof. floorTops is the contract; derive it
  // only when a shell predates the stamp.
  CBZ.cityLiftStops = function (lot) {
    const b = bldOf(lot) || (lot && lot.building) || null;
    if (!b) return [];
    if (Array.isArray(b.floorTops) && b.floorTops.length >= 2) return b.floorTops.slice();
    const st = Math.max(1, b.storeys || 1), FH = fhOf(b);
    const out = [0.14];
    for (let L = 1; L <= st; L++) out.push(L * FH);
    return out;
  };
  // interior (walkable, non-roof) floor count for a lot
  CBZ.cityFloorCount = function (lot) {
    const tops = CBZ.cityLiftStops(lot);
    return Math.max(0, tops.length - 1);          // last entry is the ROOF
  };
  // which interior floor index does a world Y sit on
  function floorAtY(lot, y) {
    const tops = CBZ.cityLiftStops(lot);
    if (!tops.length) return 0;
    let k = 0;
    for (let i = 0; i < tops.length; i++) if (y >= tops[i] - 0.6) k = i;
    return Math.min(k, Math.max(0, tops.length - 2));
  }
  CBZ.cityFloorAtY = function (lot, y) { return floorAtY(lot, y); };

  // resolve a `level` directive to a list of interior floor indices
  function levelsOf(level, nFloors) {
    const top = Math.max(0, nFloors - 1);
    const all = function (a, b) { const o = []; for (let i = a; i <= b; i++) if (i >= 0 && i <= top) o.push(i); return o; };
    if (level == null) return [0];
    if (typeof level === "number") { const n = level < 0 ? top + 1 + level : level; return all(n, n); }
    if (Array.isArray(level)) return all(level[0] | 0, level[1] | 0);
    const s = String(level);
    if (s === "ground" || s === "lobby" || s === "door" || s === "outside") return [0];
    if (s === "top") return [top];
    if (s === "all") return all(0, top);
    if (s === "upper") return all(1, top);
    if (s === "mid") return all(1, top - 1);
    const m = s.match(/^(\d+)\s*\.\.\s*(\d+)$/);
    if (m) return all(+m[1], +m[2]);
    const n = parseInt(s, 10);
    return isNaN(n) ? [0] : all(n, n);
  }

  function floorRoom(b, k) {
    if (CBZ.interiorFloorRoom) { const r = CBZ.interiorFloorRoom(b, k); if (r) return r; }
    // degrade-safe inline fallback (interior_programs.js absent)
    const wt = b.wt != null ? b.wt : 0.4, FH = fhOf(b);
    const x0 = b.hasStairs ? (-b.w / 2 + wt + (b.stairW || 0) + 0.4) : (-b.w / 2 + wt + 0.4);
    const x1 = b.w / 2 - wt - 0.4, z0 = -b.d / 2 + wt + 0.4, z1 = b.d / 2 - wt - 0.4;
    if (x1 - x0 < 1.4 || z1 - z0 < 1.4) return null;
    const tops = Array.isArray(b.floorTops) ? b.floorTops : null;
    return { x0: x0, x1: x1, z0: z0, z1: z1, y: tops && tops[k] != null ? tops[k] : (k <= 0 ? 0.14 : k * FH), floor: k, fh: FH };
  }
  function clearAt(b, lx, lz, pad) {
    if (!b.clearFloorPoint) return true;
    try { return !!b.clearFloorPoint(lx, lz, pad == null ? 0.6 : pad); } catch (e) { return true; }
  }
  // FALLBACK posting only — used when a floor runs no program (or the program
  // declined the plate). Perimeter posts facing the room centre, every
  // candidate gated through the building's own clearFloorPoint so the door
  // aisle / stair core / lift chase stay walkable.
  function postPoints(b, room, n, salt) {
    const out = [];
    if (!room || n <= 0) return out;
    const inset = 1.15;
    const x0 = room.x0 + inset, x1 = room.x1 - inset, z0 = room.z0 + inset, z1 = room.z1 - inset;
    if (x1 <= x0 || z1 <= z0) return out;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const per = 2 * ((x1 - x0) + (z1 - z0));
    for (let i = 0; i < n * 3 && out.length < n; i++) {
      const jitter = CBZ.hash01 ? CBZ.hash01(b.ox + i, b.oz + room.floor, salt) : 0.5;
      let t = ((out.length + (i >= n ? 0.5 : 0)) / n + jitter * 0.06) % 1;
      t *= per;
      let lx, lz;
      const wx = x1 - x0, wz = z1 - z0;
      if (t < wx) { lx = x0 + t; lz = z0; }
      else if (t < wx + wz) { lx = x1; lz = z0 + (t - wx); }
      else if (t < 2 * wx + wz) { lx = x1 - (t - wx - wz); lz = z1; }
      else { lx = x0; lz = z1 - (t - 2 * wx - wz); }
      if (!clearAt(b, lx, lz, 0.6)) continue;
      let dup = false;
      for (let q = 0; q < out.length; q++) {
        const dx = out[q].lx - lx, dz = out[q].lz - lz;
        if (dx * dx + dz * dz < 1.2 * 1.2) { dup = true; break; }
      }
      if (dup) continue;
      out.push({ lx: lx, lz: lz, face: Math.atan2(cx - lx, cz - lz), kind: "guard" });
    }
    return out;
  }
  // the VIP point: deepest clear point from the way in, facing it.
  function vipPoint(b, room, arrive) {
    const cx = (room.x0 + room.x1) / 2, cz = (room.z0 + room.z1) / 2;
    const d = arrive || b.localDoor || null;
    let lx = cx, lz = cz;
    if (d && d.nx != null) { lx = cx + d.nx * ((room.x1 - room.x0) * 0.22); lz = cz + d.nz * ((room.z1 - room.z0) * 0.22); }
    if (!clearAt(b, lx, lz, 0.7)) { lx = cx; lz = cz; }
    if (!clearAt(b, lx, lz, 0.7)) return null;
    const face = (d && d.nx != null) ? Math.atan2(-d.nx, -d.nz) : Math.atan2(0 - lx, 0 - lz);
    return { lx: lx, lz: lz, face: face, kind: "boss" };
  }
  // exterior door posts — security.js's exact lateral-offset math, once.
  function doorPoints(lot, n) {
    const d = lot.building && lot.building.door;
    const out = [];
    if (!d || d.x == null || n <= 0) return out;
    const nx = d.nx != null ? d.nx : 0, nz = d.nz != null ? d.nz : 1;
    const nl = Math.hypot(nx, nz) || 1, ux = nx / nl, uz = nz / nl;
    for (let i = 0; i < n; i++) {
      const lateral = (i - (n - 1) / 2) * 1.8;
      out.push({
        wx: d.x - ux * 3.2 + uz * lateral,
        wz: d.z - uz * 3.2 - ux * lateral,
        // d.nx/nz is the door's INWARD normal, and this post stands 3.2m
        // OUTSIDE it — so a doorman faces -n (the street), not n (the wall).
        face: Math.atan2(-ux, -uz), kind: "guard",
      });
    }
    return out;
  }

  /* ======================================================================
     ACCESS — the per-floor model nothing in this repo had. Not a locked
     door (no door in this engine locks); a real spatial answer to "may this
     actor be on this floor", consulted by the trespass sweep and available
     to any caller (missions, detection, dialogue).
     ====================================================================== */
  const RANK = { public: 0, staff: 1, faction: 2, vip: 3 };
  function rankOf(a) { const r = RANK[a]; return r == null ? 0 : r; }
  function actorFaction(a) {
    if (!a) return null;
    // THE PLAYER carries no faction field — mode.js's player actor is a bare
    // {isPlayer,pos,group,hp,dead} literal and membership lives in
    // g.cityMembership / g.playerGangId. Without this line, joining a crew and
    // walking into your OWN HQ trips the trespass alarm and the whole garrison
    // opens up on you.
    if (a.isPlayer && CBZ.cityPlayerGangId) { const gid = CBZ.cityPlayerGangId(); if (gid) return gid; }
    if (a.faction) return a.faction;
    if (a.gang) return a.gang;
    return null;
  }
  function floorRec(rec, k) {
    if (!rec || !rec.floors) return null;
    for (let i = 0; i < rec.floors.length; i++) if (rec.floors[i].k === k) return rec.floors[i];
    return null;
  }
  CBZ.cityFloorAccess = function (lot, k) {
    const rec = lot && lot._occupancy;
    if (!rec || !CFG.OCCUPY_ACCESS) return { access: "public", faction: null, label: null };
    const f = floorRec(rec, k);
    if (!f) return { access: rec.defaultAccess || "public", faction: rec.faction || null, label: rec.label || null };
    return { access: f.access || "public", faction: f.faction || rec.faction || null, label: f.label || rec.label || null };
  };
  CBZ.cityMayEnter = function (actor, lot, k) {
    if (!CFG.OCCUPY_ACCESS) return true;
    const rec = lot && lot._occupancy;
    if (!rec) return true;
    const a = CBZ.cityFloorAccess(lot, k);
    const need = rankOf(a.access);
    if (need <= 0) return true;
    if (!actor) return false;
    if (actor._occupyPass && rankOf(actor._occupyPass[rec.id]) >= need) return true;
    if (actor._occupyOf === rec.id && rankOf(actor._occupyAccess) >= need) return true;
    if (a.faction && actorFaction(actor) === a.faction) return need <= RANK.faction;
    return false;
  };
  // the seam ownership/missions use: hand an actor (default: the player) a
  // standing pass to a building. One line, no schema.
  CBZ.cityOccupyGrant = function (lot, level, actor) {
    const rec = lot && lot._occupancy;
    if (!rec) return false;
    const who = actor || playerActor();
    if (!who) return false;
    who._occupyPass = who._occupyPass || Object.create(null);
    who._occupyPass[rec.id] = level || "staff";
    return true;
  };
  // spatial resolve: which occupied building/floor is this world point in?
  CBZ.cityAccessAt = function (x, y, z) {
    for (let i = 0; i < REG.length; i++) {
      const rec = REG[i], b = rec.b;
      if (!b || !groupLive(b.group)) continue;
      const hw = b.w / 2 + 0.2, hd = b.d / 2 + 0.2;
      if (x < b.ox - hw || x > b.ox + hw || z < b.oz - hd || z > b.oz + hd) continue;
      const k = floorAtY(rec.lot, y);
      const a = CBZ.cityFloorAccess(rec.lot, k);
      return { rec: rec, lot: rec.lot, floor: k, access: a.access, faction: a.faction, label: a.label };
    }
    return null;
  };

  /* ---- ALARM: written through the EXISTING guard fields, not a new brain --
     rallyGang (peds.js) alerts a crew with exactly `o.rage = threat;
     o.state = "fight"`. citySecurityIntruder returns `guard.mem` the moment
     `guard.alarmed > 0`. Both are already read every tick by the shipped
     think(). So "the building learns you are here" is four field writes per
     body — no new loop, no new state machine, and a guard that stands back
     down when it decays.
     Floor propagation: the alerted floor lights instantly, then the front
     climbs one storey every OCCUPY_ALARM_SPREAD seconds — reinforcements
     moving UP the building ahead of you, which is what the escalation read is
     actually made of (nothing here paths in Y, so an honest alarm front beats
     a fake guard walking through a slab).                                  */
  function wake(p, threat) {
    if (!p || p.dead || p._occupyNoFight) return false;
    p.mem = threat;
    p.alarmed = Math.max(p.alarmed || 0, 4);
    if (p.staffPost) {                       // stand him up off the post
      p._occupyPost = p._occupyPost || { x: p.staffPost.x, z: p.staffPost.z, face: p.staffPost.face };
      p.staffPost = null;
    }
    if (p._occupyPost) { p.guard = { x: p._occupyPost.x, z: p._occupyPost.z }; p.homeGuard = p.guard; }
    if (threat) { p.rage = threat; p.state = "fight"; }
    p._occupyAwake = true;
    return true;
  }
  function standDown(p, force) {
    if (!p || p.dead || !p._occupyAwake) return;
    // `force` is what the alarm-expiry path passes. Without it nothing ever
    // clears a woken guard's rage (the player rarely dies), so every survivor
    // would stay in wander-and-fight forever and the building could never go
    // quiet again.
    if (force) { p.rage = null; if (p.state === "fight") p.state = "idle"; p.mem = null; p.alarmed = 0; }
    else if (p.state === "fight" || p.rage) return;    // still busy
    p._occupyAwake = false;
    // only re-ROOT someone who was rooted to begin with. A street doorman was
    // spawned on the ped.guard loiter brain, never pinned — pinning him on
    // stand-down would freeze him on the pavement for the rest of the run.
    if (p._occupyPost && p._occupyPinned && !p._occupyNoFight) {
      p.staffPost = { x: p._occupyPost.x, z: p._occupyPost.z, face: p._occupyPost.face || 0 };
      p.guard = null; p.state = "idle"; p.speed = 0;
      if (p.pos) { p.pos.x = p._occupyPost.x; p.pos.z = p._occupyPost.z; }
    }
  }
  CBZ.cityOccupyAlarm = function (lot, threat, floorK, opts) {
    const rec = lot && lot._occupancy;
    if (!rec) return 0;
    opts = opts || {};
    let n = 0;
    const k = floorK == null ? null : (floorK | 0);
    for (let i = 0; i < rec.peds.length; i++) {
      const p = rec.peds[i];
      if (!p || p.dead) continue;
      if (k != null && p._occupyFloor > k + 1) continue;    // above the front — wakes as it climbs
      if (wake(p, threat)) n++;
    }
    rec.alarmT = Math.max(rec.alarmT || 0, opts.secs || 14);
    if (threat) rec.alarmThreat = threat;
    if (k != null) rec.alarmFront = Math.max(rec.alarmFront || 0, k + 1);
    if (!rec.alarmed) {
      rec.alarmed = true;
      // seed the climb ONCE, when the alarm first arms. Re-seeding it on every
      // call would freeze the front forever: the trespass sweep re-alarms at
      // 4Hz while you stand on a restricted floor, and 0.25s < the 2.2s spread
      // interval, so the timer could never reach zero and the reinforcements
      // would never climb — the headline mechanic, silently dead.
      rec.alarmSpreadT = CFG.OCCUPY_ALARM_SPREAD;
      if (CBZ.sfx && opts.silent !== true) { try { CBZ.sfx("alarm"); } catch (e) {} }
    }
    return n;
  };
  CBZ.cityOccupyAlarmed = function (lot) {
    const rec = lot && lot._occupancy;
    return !!(rec && rec.alarmT > 0);
  };

  /* ======================================================================
     THE BLOCK — cityOccupyBuilding(lot, spec)
     ====================================================================== */
  const REG = [];
  CBZ.cityOccupancies = REG;

  // role table: casting only (job + archetype + temperament). Everything
  // downstream — wardrobe, brain, death — is the shipped ped pipeline.
  const ROLES = {
    security: { job: "security guard", archetype: "security", kind: "security", aggr: 0.72, armed: true, weapon: "Pistol", hp: 140, wealth: 0.42, pose: "foldarms" },
    guard: { job: "security guard", archetype: "security", kind: "security", aggr: 0.72, armed: true, weapon: "Pistol", hp: 140, wealth: 0.42, pose: "foldarms" },
    soldier: { job: "soldier", archetype: "military", kind: "security", aggr: 0.78, armed: true, weapon: "Rifle", hp: 170, wealth: 0.3, pose: "foldarms" },
    agent: { job: "secret service", archetype: "security", kind: "security", aggr: 0.7, armed: true, weapon: "Pistol", hp: 150, wealth: 0.5, pose: "foldarms" },
    bouncer: { job: "doorman", archetype: "professional", aggr: 0.5, armed: true, weapon: "Pistol", hp: 200, wealth: 0.6, pose: "foldarms" },
    muscle: { job: "enforcer", archetype: "gangster", kind: "security", aggr: 0.8, armed: true, weapon: "Pistol", hp: 150, wealth: 0.35, pose: "foldarms" },
    lieutenant: { job: "lieutenant", archetype: "gangster", kind: "security", aggr: 0.86, armed: true, weapon: "SMG", hp: 190, wealth: 0.6, pose: "foldarms" },
    clerk: { job: "office worker", archetype: "worker", aggr: 0.1, armed: false, wealth: 0.45, pose: "table" },
    receptionist: { job: "receptionist", archetype: "worker", aggr: 0.08, armed: false, wealth: 0.42, pose: "table" },
    boss: { job: "boss", archetype: "exec", aggr: 0.45, armed: true, weapon: "Pistol", hp: 220, wealth: 0.92, pose: "table" },
    owner: { job: "executive", archetype: "socialite", aggr: 0.16, armed: false, wealth: 0.85, pose: "table" },
    official: { job: "official", archetype: "exec", aggr: 0.14, armed: false, wealth: 0.8, pose: "table" },
    officer: { job: "commanding officer", archetype: "military", aggr: 0.6, armed: true, weapon: "Pistol", hp: 200, wealth: 0.55, pose: "table" },
    family: { job: "family", archetype: "civilian", aggr: 0.1, armed: false, wealth: 0.7, pose: "stand" },
    staff: { job: "staff", archetype: "worker", aggr: 0.12, armed: false, wealth: 0.4, pose: "stand" },
  };
  CBZ.cityOccupyRoles = ROLES;

  /* ---- PRESETS — the "same fortress, different faction" dial -------------
     Research (Far Cry outposts, GTA/Yakuza faction reskins) says six
     variables carry the whole difference: uniform, prop set, alarm behaviour,
     civilian ratio, the legal consequence of walking in, and the loot. Four
     of those are literally the fields below; the props come from the per-floor
     program name; the consequence from `crime`.
     Each preset is a FUNCTION of the building's real floor count, so the
     escalation curve (more bodies, harder bodies, the higher you go) is
     authored once and fits a 3-storey shophouse and a 12-storey tower alike.
     ---------------------------------------------------------------------- */
  function rampCount(k, n, lo, hi) {
    if (n <= 1) return hi;
    return Math.round(lo + (hi - lo) * (k / (n - 1)));
  }
  const PRESETS = {
    // A crew that lives in the building it holds.
    gang: function (n) {
      const f = [{ level: "door", role: "muscle", count: 2, access: "public", src: "occupy:gang" },
                 { level: 0, role: "muscle", count: 2, program: "lobby", access: "public" }];
      for (let k = 1; k < n - 1; k++) {
        f.push({
          level: k, role: k >= n - 2 ? "lieutenant" : "muscle",
          count: rampCount(k, n, 2, 4),
          program: (k % 2) ? "checkpoint" : "quarters",
          access: "faction",
        });
      }
      if (n > 1) f.push({ level: "top", role: "boss", vip: true, family: 3, count: 2, guardRole: "lieutenant", program: "bosssuite", access: "vip" });
      return { floors: f, crime: "trespass" };
    },
    // A ministry: clerks who work here, agents who watch them, an official up top.
    government: function (n) {
      const f = [{ level: 0, role: "agent", count: 2, program: "lobby", access: "public" },
                 { level: 0, role: "receptionist", count: 1, seated: true, access: "public" }];
      for (let k = 1; k < n - 1; k++) {
        f.push({ level: k, role: "agent", count: rampCount(k, n, 1, 3), program: (k % 3 === 2) ? "storage" : "deskfarm", access: "staff", staff: { role: "clerk", count: 3 } });
      }
      if (n > 1) f.push({ level: "top", role: "official", vip: true, family: 0, count: 3, guardRole: "agent", program: "bosssuite", access: "vip" });
      return { floors: f, crime: "trespass" };
    },
    // A base: nobody civilian, rifles everywhere, bunks and crates.
    military: function (n) {
      const f = [{ level: "door", role: "soldier", count: 2, access: "faction" },
                 { level: 0, role: "soldier", count: 3, program: "checkpoint", access: "faction" }];
      for (let k = 1; k < n - 1; k++) {
        f.push({ level: k, role: "soldier", count: rampCount(k, n, 2, 4), program: (k % 2) ? "quarters" : "checkpoint", access: "faction" });
      }
      if (n > 1) f.push({ level: "top", role: "officer", vip: true, family: 0, count: 3, guardRole: "soldier", program: "bosssuite", access: "vip" });
      return { floors: f, crime: "trespass" };
    },
    // A tower: a desk farm you can walk into, security that escorts you out.
    corporate: function (n) {
      const f = [{ level: 0, role: "security", count: 2, program: "lobby", access: "public" },
                 { level: 0, role: "receptionist", count: 1, seated: true, access: "public" }];
      for (let k = 1; k < n - 1; k++) {
        f.push({ level: k, role: "security", count: rampCount(k, n, 1, 2), program: "deskfarm", access: "staff", staff: { role: "clerk", count: 4 } });
      }
      if (n > 1) f.push({ level: "top", role: "owner", vip: true, family: 1, count: 2, guardRole: "agent", program: "bosssuite", access: "vip" });
      return { floors: f, crime: "trespass" };
    },
  };
  CBZ.cityOccupyPresets = function () { return Object.keys(PRESETS); };
  CBZ.cityOccupyPreset = function (name, nFloors) {
    const fn = PRESETS[name];
    return fn ? fn(Math.max(1, nFloors | 0)) : null;
  };

  function liveBudget() {
    let used = 0;
    for (let i = REG.length - 1; i >= 0; i--) {
      const rec = REG[i];
      if (!rec.b || !groupLive(rec.b.group)) { REG.splice(i, 1); continue; }
      for (let q = rec.peds.length - 1; q >= 0; q--) {
        const p = rec.peds[q];
        if (!p || p.culled || (CBZ.cityPeds && CBZ.cityPeds.indexOf(p) < 0)) rec.peds.splice(q, 1);
      }
      used += rec.peds.length;
    }
    return used;
  }

  CBZ.cityOccupyBuilding = function (lot, spec) {
    if (!CFG.OCCUPY_V1) return null;
    spec = spec || {};
    if (!lot || !CBZ.cityMakePed || !CBZ.cityPeds) return null;
    const b = bldOf(lot);
    const door = lot.building && lot.building.door;
    if (!b && !(door && door.x != null)) return null;   // parks/stubs: nothing to occupy

    const id = spec.id || ("occ:" + Math.round(lot.cx != null ? lot.cx : (b ? b.ox : 0)) + ":" + Math.round(lot.cz != null ? lot.cz : (b ? b.oz : 0)));

    // idempotent: re-occupying a lot replaces the previous cast (a landmass
    // rebuild / a gang taking the building off another gang).
    CBZ.cityUnoccupyBuilding(lot);

    const rng = spec.rng || streamFor(id);
    const nFloors = b ? Math.max(1, CBZ.cityFloorCount(lot)) : 1;

    // ---- THE CLIMB: give the building a staircase before anyone stands on
    // it. This is the ONLY reason "fight your way up" is a thing you can do.
    let core = null;
    if (b && CFG.OCCUPY_STAIRS && spec.stairs !== false && CBZ.cityStairCore) {
      try { core = CBZ.cityStairCore(lot, spec.stairOpts || null); } catch (e) { core = null; }
    }
    // How you ARRIVE on a floor: the front door downstairs, the stairhead
    // everywhere above. Every interior program orients off this, so the boss's
    // desk always faces the way you actually come in.
    const arriveFor = function (k) {
      if (k <= 0) return (b && b.localDoor) || null;
      return (core && core.head) || (b && b.localDoor) || null;
    };
    const insetFor = function (k, room) {
      if (k <= 0 || !core || !room) return 0;
      const d = core.depth + 0.6;
      const along = Math.abs(core.head.nx) > 0.5;
      const depth = along ? (room.x1 - room.x0) : (room.z1 - room.z0);
      return (depth - d >= 9.0) ? d : 0;    // spare it only if a real room is left
    };

    // resolve the preset (or the caller's explicit floor list)
    let floorSpecs = spec.floors;
    let presetRec = null;
    if (!Array.isArray(floorSpecs) && spec.preset) {
      presetRec = CBZ.cityOccupyPreset(spec.preset, nFloors);
      if (presetRec) floorSpecs = presetRec.floors;
    }
    if (!Array.isArray(floorSpecs)) floorSpecs = [];

    const rec = {
      id: id, lot: lot, b: b, faction: spec.faction || null, label: spec.label || null,
      preset: spec.preset || null, core: core,
      defaultAccess: spec.access || "public",
      crime: spec.crime || (presetRec && presetRec.crime) || "trespass",
      floors: [], peds: [], vip: null, family: [],
      requested: 0, placed: 0, alarmT: 0, alarmed: false, alarmFront: 0, alarmSpreadT: 0,
      alarmThreat: null, tres: false, tresT: 0,
    };

    const cityUsed = liveBudget();
    const HERE = CFG.OCCUPY_MAX_PER_BUILDING | 0;
    // two ceilings, one number: whichever runs out first stops the casting.
    const MAX = Math.min(CFG.OCCUPY_MAX_PEDS | 0, cityUsed + (HERE > 0 ? HERE : 1e9));
    let used = cityUsed;

    for (let s = 0; s < floorSpecs.length; s++) {
      const fs = floorSpecs[s] || {};
      const role = ROLES[fs.role] || ROLES.staff;
      const exterior = (fs.level === "door" || fs.level === "outside");
      const ks = exterior ? [0] : levelsOf(fs.level, nFloors);
      const per = fs.per === "building" ? "building" : "floor";
      const wantEach = Math.max(0, fs.count == null ? 1 : (fs.count | 0));

      for (let q = 0; q < ks.length; q++) {
        const k = ks[q];
        const n = (per === "building") ? (q === 0 ? wantEach : 0) : wantEach;
        rec.requested += n + (fs.vip ? 1 : 0) + (fs.family === true ? 2 : (fs.family | 0));

        // reuse a floor record if a previous spec already opened this storey
        let fr = floorRec(rec, k);
        if (!fr) {
          fr = {
            k: k, y: 0, access: fs.access || spec.access || "public",
            faction: fs.faction || spec.faction || null, label: fs.label || null,
            posts: [], exterior: exterior, program: null, anchors: null,
          };
          rec.floors.push(fr);
        } else if (fs.access && rankOf(fs.access) > rankOf(fr.access)) fr.access = fs.access;

        // ---- the interior room + its designed program --------------------
        let room = null;
        if (!exterior && b) {
          room = floorRoom(b, k);
          // IDEMPOTENCY: the ledger lives on the BUILDING, not on this record.
          // Re-occupying a lot (a rival crew taking it, a mission recasting it)
          // tears down the peds and runs again — but the furniture is real
          // geometry, and a second pass would stack a second set of sandbags
          // and a second floor covering on top of the first, forever.
          b._occupyProgrammed = b._occupyProgrammed || Object.create(null);
          b._occupyAnchors = b._occupyAnchors || Object.create(null);
          if (room && fs.program && !fr.program && b._occupyProgrammed[k]) {
            // already dressed by an earlier occupation — reuse the SAME
            // anchors (cleared of their claim flags) so the new cast lands in
            // the authored spots instead of falling back to a perimeter walk.
            fr.program = b._occupyProgrammed[k];
            fr.anchors = (b._occupyAnchors[k] || []).map(function (a) {
              return { x: a.x, y: a.y, z: a.z, face: a.face, lx: a.lx, lz: a.lz, kind: a.kind, pose: a.pose };
            });
          }
          if (room && fs.program && CFG.OCCUPY_PROGRAMS && CBZ.interiorProgram
              && !fr.program && !b._occupyProgrammed[k]) {
            b._occupyProgrammed[k] = fs.program;
            try {
              const out = CBZ.interiorProgram(fs.program,
                { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1, y: room.y },
                // `inset` on upper floors = the stair core's own footprint, so
                // the program dresses the ROOM and not the stairwell (every
                // box in there would be rejected by clearFloorPoint anyway,
                // leaving a half-furnished floor). Only worth paying on a
                // plate big enough to spare it — on a small shell the core
                // eats nearly the whole depth and the program would return an
                // empty room, which is strictly worse than a few dropped
                // boxes in the stairwell corner.
                { b: b, opts: { door: arriveFor(k), inset: insetFor(k, room) } });
              fr.program = fs.program;
              fr.anchors = (out && out.anchors) ? out.anchors.slice() : [];
              b._occupyAnchors[k] = fr.anchors.map(function (a) {
                return { x: a.x, y: a.y, z: a.z, face: a.face, lx: a.lx, lz: a.lz, kind: a.kind, pose: a.pose };
              });
            } catch (e) { fr.program = fs.program; fr.anchors = []; }
          }
        }
        fr.y = room ? room.y : (CBZ.floorAt && door ? CBZ.floorAt(door.x, door.z) : 0);

        // ---- CAST from the program's role-tagged anchors ------------------
        // A program that authored a room knows where a guard belongs in it far
        // better than a perimeter walk does. Anchors carry `kind`; we consume
        // them by kind and only fall back to the perimeter when a program did
        // not author enough of them.
        const take = function (kind, count) {
          const out = [];
          if (!fr.anchors) return out;
          for (let i = 0; i < fr.anchors.length && out.length < count; i++) {
            const a = fr.anchors[i];
            // programs written before role tags existed (deskfarm/lobby) return
            // untagged anchors — those are SEATS, never guard posts, so a
            // guard never ends up standing in a clerk's chair.
            if (!a || a._used || (a.kind || "seat") !== kind) continue;
            a._used = true;
            out.push({ lx: a.lx, lz: a.lz, face: a.face, kind: kind, pose: a.pose });
          }
          return out;
        };

        // ---- POSTS -------------------------------------------------------
        let pts;
        if (exterior) pts = doorPoints(lot, n);
        else {
          pts = take("guard", n);
          if (pts.length < n && room) {
            const more = postPoints(b, room, n - pts.length, 0x0cc0 + k);
            for (let i = 0; i < more.length; i++) pts.push(more[i]);
          }
        }
        // A floor's GUARD role should apply whenever the floor declares one —
        // the `fs.vip` conjunct meant that a floor with guards but no VIP on
        // it cast its posted officers in the FLOOR's role instead of the guard
        // role, so a boss's security landed dressed and titled as more bosses.
        // (city/power.js hit this the moment it stamped floors with vip:false.)
        const postRole = fs.guardRole ? (ROLES[fs.guardRole] || role) : role;
        for (let i = 0; i < pts.length && i < n; i++) {
          if (used >= MAX) break;
          const ped = spawnPost(rec, fs, postRole, k, room, pts[i], exterior, rng, spec, {});
          if (!ped) continue;
          fr.posts.push(ped); used++;
        }

        // ---- SEATED workers (clerks at their desks) ----------------------
        // These genuinely should not move, so they DO use the npcLife seat
        // grammar — that is what it is for.
        const st = fs.staff || (fs.seated ? { role: fs.role, count: n } : null);
        if (st && room && fr.anchors) {
          // deskfarm/lobby return untagged anchors — those ARE the seats.
          const seats = take("clerk", st.count | 0);
          if (seats.length < (st.count | 0)) {
            const more = take("seat", (st.count | 0) - seats.length);
            for (let i = 0; i < more.length; i++) seats.push(more[i]);
          }
          for (let i = 0; i < seats.length && used < MAX; i++) {
            const ped = spawnPost(rec, fs, ROLES[st.role] || ROLES.clerk, k, room, seats[i], false, rng, spec,
              { seated: true, access: fs.access || "staff", pose: "sit" });
            if (ped) { fr.posts.push(ped); used++; }
          }
        }

        // ---- the VIP + family (top floor, the owner's actual ask) --------
        if (fs.vip && room && used < MAX && !rec.vip) {
          const vp = (take("boss", 1)[0]) || vipPoint(b, room, arriveFor(k));
          if (vp) {
            const vrole = ROLES[fs.role] || ROLES.boss;
            const ped = spawnPost(rec, fs, vrole, k, room, vp, false, rng, spec, {
              vip: true, name: fs.name || null,
              pose: fs.pose || vp.pose || (fs.seated === false ? "stand" : "sit"),
              access: fs.access || "vip",
            });
            if (ped) { rec.vip = ped; fr.posts.push(ped); used++; }
          }
        }
        const famN = fs.family === true ? 2 : (fs.family | 0);
        if (famN > 0 && room) {
          const fpts = take("family", famN);
          const base = rec.vip ? { lx: rec.vip._occupyLx, lz: rec.vip._occupyLz } : vipPoint(b, room, arriveFor(k));
          // ring fallback: TRY every slot rather than giving up on the first
          // blocked one, or a single desk leg silently deletes the family.
          for (let a = 0; a < famN * 4 && fpts.length < famN && base && base.lx != null; a++) {
            const ang = (a / (famN * 2)) * Math.PI * 2 + (CBZ.hash01 ? CBZ.hash01(b.ox, b.oz + a, 0xfa) : 0.3) * 2;
            const rad = 1.8 + (a >= famN * 2 ? 1.1 : 0);
            const lx = base.lx + Math.cos(ang) * rad, lz = base.lz + Math.sin(ang) * rad;
            if (!clearAt(b, lx, lz, 0.55)) continue;
            fpts.push({ lx: lx, lz: lz, face: Math.atan2(base.lx - lx, base.lz - lz), kind: "family" });
          }
          for (let i = 0; i < fpts.length && used < MAX; i++) {
            const ped = spawnPost(rec, fs, ROLES.family, k, room, fpts[i], false, rng, spec,
              { family: true, access: fs.access || "vip", pose: fpts[i].pose || "stand" });
            if (ped) { ped.isFamily = true; rec.family.push(ped); fr.posts.push(ped); used++; }
          }
        }
      }
    }

    rec.placed = rec.peds.length;
    lot._occupancy = rec;
    REG.push(rec);

    // ---- RE-FREEZE this building ----------------------------------------
    // Occupancy runs AFTER mode.js's one-shot batch+freeze pass over the arena
    // (mode.js:503 vs the ped/gang spawn at :585), so every stair tread,
    // sandbag and desk we just built would otherwise pay a per-frame matrix
    // recompute forever. freezeStaticUnder is per-root and idempotent, so
    // re-running it over just this building costs one pass and reclaims that.
    //
    // We deliberately do NOT re-run batchStaticUnder here. The batcher ledgers
    // merged vertex ranges per TOP-LEVEL group so batchHideGroup/demolition can
    // reverse them; re-merging a sub-tree that the arena pass already ledgered
    // would put two ledgers on the same geometry, and a wrong merge is
    // unrecoverable. Draw-call cost is therefore real but bounded — see the
    // per-program mesh caps in interior_programs.js, which exist for exactly
    // this reason. (Cheapest true fix, for whoever owns mode.js: move the
    // gang/occupancy spawn ahead of mode.js:503 so the normal batch pass
    // swallows the fortresses for free.)
    if (b && b.group) { try { if (CBZ.freezeStaticUnder) CBZ.freezeStaticUnder(b.group); } catch (e) {} }
    return rec;
  };

  function spawnPost(rec, fs, role, k, room, pt, exterior, rng, spec, extra) {
    extra = extra || {};
    const b = rec.b;
    const wx = exterior ? pt.wx : (b.ox + pt.lx);
    const wz = exterior ? pt.wz : (b.oz + pt.lz);
    const floorY = exterior ? 0 : (room ? room.y : 0);

    const opts = {
      src: spec.src || fs.src || ("occupy:" + (spec.preset || "custom")),
      rng: rng,
      parent: arenaRoot(),
      face: pt.face,
      kind: role.kind || "civilian",
      job: role.job, archetype: role.archetype,
      aggr: fs.aggr != null ? fs.aggr : role.aggr,
      armed: fs.armed != null ? fs.armed : !!role.armed,
      weapon: fs.weapon !== undefined ? fs.weapon : (role.weapon || null),
      hp: fs.hp != null ? fs.hp : (role.hp || null),
      wealth: fs.wealth != null ? fs.wealth : role.wealth,
      name: extra.name || fs.name || null,
      faction: fs.faction || spec.faction || null,
      pose: extra.pose || pt.pose || fs.pose || role.pose || null,
    };
    if (fs.outfit != null) opts.outfit = fs.outfit;
    else if (spec.outfit != null) opts.outfit = spec.outfit;
    if (spec.gang) opts.gang = spec.gang;
    if (spec.overrides) for (const kk in spec.overrides) opts[kk] = spec.overrides[kk];
    if (opts.hp == null) delete opts.hp;
    if (opts.weapon == null) delete opts.weapon;
    if (opts.name == null) delete opts.name;

    if (exterior) {
      // street posts get the REAL loiter-and-defend brain — the existing
      // one-line primitive, on the ground where wandering makes sense.
      opts.guard = { x: wx, z: wz };
      opts.homeGuard = { x: wx, z: wz };
    } else {
      // interior posts spawn ROOTED (staffPost) and are woken by the alarm.
      // staffPost returns from move() before the y-clamp, so this also holds
      // the floor for free; the lift sweep covers the _faceT branch.
      opts.pin = true;
      opts.floorY = floorY;
      if (extra.seated && CBZ.npcLife && CBZ.npcLife.attach && b.group) {
        // a genuinely seated worker is better off attached: no brain needed,
        // and the seated rig rides the building group exactly like a cabin seat.
        opts.parent = b.group;
        opts.attach = { parent: b.group, x: pt.lx, y: floorY + 0.05, z: pt.lz, yaw: pt.face, pose: "sit", state: "sit" };
      }
    }

    const ped = CBZ.cityPostNpc(wx, wz, opts);
    if (!ped) return null;
    ped._occupyOf = rec.id;
    ped._occupyFloor = k;
    ped._occupyAccess = extra.access || fs.access || "staff";
    ped._occupyLx = exterior ? null : pt.lx;
    ped._occupyLz = exterior ? null : pt.lz;
    ped._occupyPost = { x: wx, z: wz, face: pt.face || 0 };
    ped._occupyPinned = !exterior;         // interior posts are rooted until alarmed
    if (extra.family || extra.seated) ped._occupyNoFight = true;
    if (extra.vip) { ped.isVip = true; ped.protectLot = rec.lot; ped.isBoss = ped.isBoss || fs.role === "boss"; }
    if (rec.lot) ped.protectLot = ped.protectLot || rec.lot;
    if (typeof spec.configure === "function") { try { spec.configure(ped, { rec: rec, floor: k, role: fs.role, vip: !!extra.vip, family: !!extra.family }); } catch (e) {} }
    rec.peds.push(ped);
    return ped;
  }

  CBZ.cityUnoccupyBuilding = function (lot) {
    const rec = lot && lot._occupancy;
    if (!rec) return false;
    for (let i = 0; i < rec.peds.length; i++) CBZ.cityUnpostNpc(rec.peds[i]);
    rec.peds.length = 0;
    const i = REG.indexOf(rec);
    if (i >= 0) REG.splice(i, 1);
    lot._occupancy = null;
    return true;
  };
  CBZ.cityOccupyReset = function () {
    for (let i = REG.length - 1; i >= 0; i--) { const r = REG[i]; if (r.lot) r.lot._occupancy = null; }
    REG.length = 0;
    LIFTED.length = 0;
    civicDone = false;                     // a fresh arena gets its city hall back
  };

  /* ---- ONE answer to "who is at this lot" ------------------------------
     The census found two systems disagreeing (CBZ.cityStaff.atLot vs
     CBZ.cityOfficeManagerOf/cityOfficeDesks). This resolves in one place:
     REAL occupants first, the decorative layer as the fallback tier.      */
  CBZ.cityOccupantsOf = function (lot) {
    const rec = lot && lot._occupancy;
    return rec ? rec.peds.slice() : [];
  };
  CBZ.cityOccupyBossOf = function (lot) {
    const rec = lot && lot._occupancy;
    return (rec && rec.vip && !rec.vip.dead) ? rec.vip : null;
  };
  CBZ.cityOccupancyAt = function (lot) {
    const rec = lot && lot._occupancy;
    if (rec) {
      let live = 0;
      for (let i = 0; i < rec.peds.length; i++) if (rec.peds[i] && !rec.peds[i].dead) live++;
      return {
        id: rec.id, real: true, faction: rec.faction, label: rec.label,
        count: live, floors: rec.floors.length, vip: rec.vip || null,
        family: rec.family.length, access: rec.defaultAccess,
        alarmed: rec.alarmT > 0, stairs: !!rec.core, preset: rec.preset,
      };
    }
    // decorative tier (citystaff.js) — kept deliberately as a cheap LOD for
    // queues/headcount at buildings with no real cast. See the report.
    if (CBZ.cityStaff && CBZ.cityStaff.atLot) {
      const e = CBZ.cityStaff.atLot(lot);
      if (e) return { id: null, real: false, faction: null, label: e.company, count: e.count | 0, floors: 1, vip: null, family: 0, access: "public", alarmed: false, stairs: false, preset: null };
    }
    return null;
  };

  /* ======================================================================
     THE SHARED LIFT RIDE — the fade+relocate the census found hand-rolled
     THREE times (elevators.js's cab machine, realestate.js's elevatorUp,
     exec_office.js's relocate). This is the ONE copy; the two teleport
     duplicates now call it. cityLiftStops(lot) is the one stop-list
     resolver, so a multi-stop ride is a loop over it calling cityLiftRide.
     ====================================================================== */
  let fadeEl = null, rideBusyUntil = 0;
  function fade(cb) {
    if (typeof document === "undefined") { try { cb(); } catch (e) {} return; }
    if (!fadeEl) {
      fadeEl = document.createElement("div");
      fadeEl.style.cssText = "position:fixed;inset:0;z-index:65;background:#000;opacity:0;pointer-events:none;transition:opacity .28s ease;";
      document.body.appendChild(fadeEl);
    }
    fadeEl.style.opacity = "1";
    setTimeout(function () {
      try { cb(); } catch (e) {}
      setTimeout(function () { fadeEl.style.opacity = "0"; }, 240);
    }, 320);
  }
  CBZ.cityLiftBusy = function () { return nowMs() < rideBusyUntil; };
  CBZ.cityLiftRide = function (x, y, z, opts) {
    opts = opts || {};
    if (!CFG.OCCUPY_LIFT) return false;
    const P = CBZ.player;
    if (!P || !P.pos) return false;
    if (opts.force !== true && nowMs() < rideBusyUntil) return false;
    rideBusyUntil = nowMs() + (opts.busyMs || 1800);
    const go = function () {
      P.pos.set(x, y, z); P.vy = 0; P.grounded = true;
      if (P._phys) { P._phys.air = false; P._phys.vx = P._phys.vz = P._phys.vy = 0; }
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(P.pos);
      if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
      if (opts.note && CBZ.city && CBZ.city.note) CBZ.city.note(opts.note, opts.noteSecs || 2.2);
      if (typeof opts.onArrive === "function") { try { opts.onArrive(); } catch (e) {} }
    };
    if (opts.fade === false) go(); else fade(go);
    return true;
  };

  /* ======================================================================
     THE TRESPASS + ESCALATION SWEEP — ONE 4Hz pass over the occupied-building
     registry, player only. It decides nothing an existing brain decides; it
     writes ped.mem/alarmed/rage/state, which peds.js's shipped think() reads.
     ====================================================================== */
  let sweepT = 0;
  const ORDER = (CBZ.PRIO && CBZ.PRIO.after) ? CBZ.PRIO.after(CBZ.PRIO.POLICE, 7) : 35.07;
  // just after POLICE(35) so an alarm raised here is executed by the ped
  // brain (34) on the NEXT tick, exactly like aigoals.js's layering.
  if (CBZ.onUpdate) CBZ.onUpdate(ORDER, function (dt) {
    if (!CFG.OCCUPY_V1) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (!REG.length) return;

    // ---- alarm decay + the front climbing the building -------------------
    for (let i = 0; i < REG.length; i++) {
      const rec = REG[i];
      if (rec.alarmT <= 0) { if (rec.alarmed) { rec.alarmed = false; rec.alarmFront = 0; } continue; }
      rec.alarmT -= dt;
      if (rec.alarmT <= 0) {
        // stand the survivors back down onto their posts
        for (let q = 0; q < rec.peds.length; q++) standDown(rec.peds[q], true);
        rec.alarmed = false; rec.alarmFront = 0; rec.alarmThreat = null;
        continue;
      }
      rec.alarmSpreadT -= dt;
      if (rec.alarmSpreadT <= 0) {
        rec.alarmSpreadT = CFG.OCCUPY_ALARM_SPREAD;
        rec.alarmFront++;
        for (let q = 0; q < rec.peds.length; q++) {
          const p = rec.peds[q];
          if (p && !p._occupyAwake && p._occupyFloor <= rec.alarmFront) wake(p, rec.alarmThreat);
        }
      }
    }

    if (!CFG.OCCUPY_ACCESS) return;
    sweepT -= dt;
    if (sweepT > 0) return;
    sweepT = 0.25;
    const P = CBZ.player;
    if (!P || !P.pos || P.dead) return;
    const hit = CBZ.cityAccessAt(P.pos.x, P.pos.y || 0, P.pos.z);
    const actor = playerActor();
    for (let i = 0; i < REG.length; i++) {
      const rec = REG[i];
      // ---- GUNFIRE IS THE OTHER ALARM. Shoot one guard quietly on floor 3
      // and the building learns you are in it — that is the whole reason a
      // stack of floors reads as escalation instead of ten identical rooms.
      // We do not detect the shot; we detect its RESULT (a body with rage or
      // a corpse), which is a field the shipped combat path already writes.
      if (rec.alarmT <= 0) {
        for (let q = 0; q < rec.peds.length; q++) {
          const p = rec.peds[q];
          if (!p) continue;
          // one-shot per body: a corpse must raise the alarm ONCE, or the
          // building would re-alarm forever every time the timer decayed.
          // NOTE the threat is whoever ACTUALLY did it — never assumed to be
          // the player. A guard killed by a rival crew, a car, or a stray
          // blast must not point the whole garrison at you.
          if (p.dead) {
            if (p._occupyMourned) continue;
            p._occupyMourned = true;
            const by = p.killedBy || p.lastAttacker || p.mem || null;
            CBZ.cityOccupyAlarm(rec.lot, (by && !by.dead) ? by : null, p._occupyFloor);
            break;
          }
          if (p.rage && !p._occupyAwake) { CBZ.cityOccupyAlarm(rec.lot, p.rage, p._occupyFloor); break; }
        }
      }
      if (!hit || hit.rec !== rec) { rec.tres = false; continue; }
      if (CBZ.cityMayEnter(actor, rec.lot, hit.floor)) { rec.tres = false; continue; }
      // KEEP the floor you are standing on hot for as long as you stand on it
      // (the alarm decays otherwise, and a guard who forgets you mid-fight
      // reads as broken); the toast/crime report fires once per entry.
      CBZ.cityOccupyAlarm(rec.lot, actor, hit.floor, { silent: rec.tres });
      if (rec.tres) continue;
      rec.tres = true;
      if (CBZ.cityFlavor) {
        try { CBZ.cityFlavor((rec.label || "Restricted floor") + " — you are not supposed to be here.", "#ff9c6b"); } catch (e) {}
      }
      // cityCrime's signature is crime(amount, opts) (wanted.js:357) — passing
      // the type as the FIRST argument charged nothing and fed a NaN into the
      // panic term downstream.
      if (CBZ.cityCrime && rec.crime) {
        try { CBZ.cityCrime(45, { type: rec.crime, x: P.pos.x, z: P.pos.z }); } catch (e) {}
      }
    }
  });

  /* ======================================================================
     THE ONE POLICY LINE — CITY HALL.
     The owner's brief says this capability must "dress up as a government
     building without being rebuilt". A preset table that nothing calls is a
     STAT FICTION (CLAUDE.md bans those), so the claim ships with a real
     building behind it: the city's one cityhall lot is occupied with the
     government preset — a lobby with a receptionist and two agents you can
     walk past, staffed clerk floors above that you may not be on, and an
     official in the top-floor suite with his detail. Same block, same
     staircase, same alarm; only the preset changed. That is the whole proof.
     One building, ~10 bodies, budget-checked, one flag to revert.
     ====================================================================== */
  if (CFG.OCCUPY_CIVIC == null) CFG.OCCUPY_CIVIC = true;
  let civicDone = false;
  if (CBZ.onUpdate) CBZ.onUpdate((CBZ.PRIO && CBZ.PRIO.after) ? CBZ.PRIO.after(CBZ.PRIO.POLICE, 8) : 35.08, function () {
    if (civicDone || !CFG.OCCUPY_V1 || !CFG.OCCUPY_CIVIC) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots || !A.lots.length) return;
    civicDone = true;                                  // one shot per arena
    if (liveBudget() > (CFG.OCCUPY_MAX_PEDS | 0) - 12) return;   // gangs got there first
    for (let i = 0; i < A.lots.length; i++) {
      const lot = A.lots[i];
      if (!lot || lot.kind !== "cityhall" || lot._occupancy) continue;
      const b = bldOf(lot);
      if (!b || (b.storeys | 0) < 2) continue;
      try {
        CBZ.cityOccupyBuilding(lot, {
          id: "civic:cityhall", preset: "government", src: "occupy:civic",
          faction: "state", label: "City Hall", crime: "trespass",
        });
      } catch (e) {}
      break;                                            // there is only one
    }
  });

  /* ======================================================================
     THE RATCHET — CBZ.occupyAudit(). Copy of the tree-connection-law shape
     (CBZ.treeAudit, commit d582a82): a pure counting function that lives in
     the real game file, returns plain counts, and gets pinned in
     tools/math-gate.mjs's PASS block. `legacy` MAY ONLY GO DOWN.

     A site is only flipped migrated:true when its spawn ACTUALLY flows
     through CBZ.cityPostNpc / CBZ.cityOccupyBuilding — `observed` below is
     the runtime evidence for that claim (distinct src tags seen this run).
     ====================================================================== */
  const SITES = [
    { id: "buildings.js:6554 interiorStaff", migrated: false, note: "office-tower staffing; buildings.js is read-only to this domain. It already routes through CBZ.interiorStaff (the shared seat layer), so the duplication is the CALLER's floor policy (floors 1-3, <=6 bodies), not the mechanism. Folds in when buildings.js's owner calls cityOccupyBuilding(lot,{preset:'corporate'}) instead." },
    { id: "officejobs.js:44 desk claim", migrated: false, note: "claims LIVE peds rather than spawning; not a spawner, counted honestly anyway. Folds in once occupancy owns desks." },
    { id: "citystaff.js:24 instanced figures", migrated: false, note: "kept DELIBERATELY as a cheap decorative LOD tier (InstancedMesh, 2 draw calls for 180 figures); its headcount now resolves through cityOccupancyAt so there is ONE answer, but the figures themselves are still a parallel implementation — counted honestly as legacy." },
    // ONE row per site in the 2026-07-26 census, so the table totals the
    // baseline exactly (9). gangs.js's crew spawner and its boss block were a
    // single census row and stay a single row here.
    { id: "gangs.js:283 spawnGangMember + boss block", migrated: true, src: "gangs:crew" },
    { id: "playergang.js:239 restore", migrated: true, src: "playergang:crew" },
    { id: "companies.js:146 spawnOwner", migrated: true, src: "companies:owner" },
    { id: "protection.js:245 spawnMembers", migrated: true, src: "protection:detail" },
    { id: "club.js:169 makeBouncer", migrated: true, src: "club:bouncer" },
    { id: "security.js:18 spawnCitySecurity", migrated: true, src: "security:shop" },
  ];
  CBZ.occupyAudit = function () {
    let legacy = 0, migrated = 0;
    const observed = [];
    for (let i = 0; i < SITES.length; i++) {
      if (SITES[i].migrated) migrated++; else legacy++;
      if (SITES[i].src && observedSrc[SITES[i].src]) observed.push(SITES[i].src + ":" + observedSrc[SITES[i].src]);
    }
    let occupants = 0, stairs = 0, bosses = 0;
    for (let i = 0; i < REG.length; i++) {
      occupants += REG[i].peds.length;
      if (REG[i].core) stairs++;
      if (REG[i].vip) bosses++;
    }
    return {
      legacy: legacy,             // <- THE PIN. Baseline 9. Only ever down.
      migrated: migrated,
      baseline: 9,
      buildings: REG.length,
      occupants: occupants,
      lifted: LIFTED.length,      // bodies standing above the ground floor
      stairs: stairs,             // occupied buildings with a real staircase
      bosses: bosses,
      observed: observed,
      sites: SITES,
    };
  };
})();
