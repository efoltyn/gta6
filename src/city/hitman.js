/* ============================================================
   city/hitman.js — THE HITMAN LIFE: one pipe, one room, one ladder.

   OWNER (2026-08-03): "how hitman game and then there's another mode like
   hitman game it's confusing make them one and make them better." The two
   title cards (The Contract / The Hitman) are ONE card now (origins.js maps
   the retired `hitman` id onto the surviving `contract` character), and this
   file is the "make them better" half: the freelance contract pipe every
   NON-campaign character uses, the tiered ladder of marks, and the motel
   room the merged origin wakes up in.

   THE ONE PIPE. activities.js used to sell a parallel "Street Hitman
   Contract" — its own target pick, its own completion tick, its own payout —
   which is exactly the duplication the Block Law bans. That code is DELETED;
   the activities entry is now a thin door into CBZ.hitmanStart(). This file
   authors only the offer surface, the tier gate and the prose. Everything
   else is reused:

     objective/waypoint/beacon/payout  -> core/mission.js  (CBZ.mission.start)
     the mark itself                   -> a ped the sim ALREADY RUNS
                                          (aigoals CITY_JOBS roles, power.js
                                          principals, officialdom's sitting
                                          officeholder via contracts.js's own
                                          exposed binder). NEVER spawned.
     death popup                       -> killfeed.js (the only one)
     quiet-vs-loud pricing             -> the existing witness/heat path:
                                          the bonus reads g.wanted at the kill
     the money                         -> core/mission.js pays the fee; the
                                          quiet margin rides the EXISTING
                                          cityEvent("hitman-*") channel.
     the one lock                      -> the CITY SEAL item + g.cityGovWrit,
                                          both authored by govcomplex.js's
                                          strongroom. No second key system.

   THE LADDER OF MARKS (categorical, not numeric):
     tier 0  STREET     a nobody with a real job and a real shift
     tier 1  PROTECTED  a power.js principal, and beating his RING
     tier 2  THE OFFICE the sitting officeholder, and the one rung with
                        a LOCK on it: the CITY SEAL, which is a physical
                        key on a lit plinth behind a steel door in City
                        Hall (govcomplex.js's strongroom).
   If the world cannot supply a tier's mark, that tier is NOT OFFERED.

   NO REPUTATION NUMBER LIVES IN THIS FILE (owner, 2026-08-18: "there's one
   currency for a hitman, that's money, and a box doesn't open up for money,
   it opens up with a key"). A bigger name pays more and is harder to reach:
   that IS the ladder. The only lock left is a key you can carry, drop, stash
   in a chest and SEE through a barred panel before you own it. The gear case
   in the room has no lock at all; it just opens.

   THE ROOM IS THE MENU (doors beat markers): a small annex room staged on
   the motel lot — a WALL OF MARKS (ctx.canvasTexLive board; completed marks
   cross out, and the office card hangs dark naming the KEY it wants, which is
   the locked-door-with-the-thing-visible rule) and a GEAR CASE that has no
   lock on it at all. Walking to the wall is how you browse; walking to the
   case is how you gear up. One button each: READ WALL, OPEN THE CASE.

   FLAGS (owning-file null-check, one-line revert each):
     HITMAN_PIPE   — the freelance pipe (hitmanStart/hitmanBind).
     HITMAN_BOARD  — the motel room + wall + case.
   Ratchet: CBZ.hitmanAudit() — cards must read 1, pipes 1,
   legacyStreetHitmanSites 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE || !CBZ.game) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.HITMAN_PIPE == null) CFG.HITMAN_PIPE = true;
  if (CFG.HITMAN_BOARD == null) CFG.HITMAN_BOARD = true;

  /* ---------------- shared reads ---------------------------------------- */
  function arena() { return CBZ.city && CBZ.city.arena; }
  function P() { return CBZ.player || null; }
  function world() { return CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; }
  function recs() {
    const w = world();
    if (!w) return null;
    w.records = w.records || {};
    w.records.hitman = w.records.hitman || { contracts: 0, completed: 0, failed: 0, highValue: 0, heat: 0, paid: 0 };
    return w.records.hitman;
  }
  function floorY(x, z) {
    try { return CBZ.floorAt ? (CBZ.floorAt(x, z) || 0) : 0; } catch (e) { return 0; }
  }
  function d2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s || 2.4, { from: "GHOSTLINE", app: "missions" }); }
  function campaignOwns() { return !!(CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()); }

  /* ---------------- THE LADDER ------------------------------------------ */
  // Rungs gate the CATEGORY of the mark. Two of them are not gated at all:
  // money is the only currency a contract has, so a harder name simply pays
  // more. The office rung carries the one real lock, and it is a KEY: the
  // city seal, taken off its plinth inside govcomplex.js's strongroom.
  const SEAL = "City Seal";
  const TIERS = [
    { id: "street", label: "A STREET NAME", pay: 900 },
    { id: "protected", label: "A PROTECTED NAME", pay: 4600 },
    { id: "office", label: "THE OFFICE", pay: 15000, key: SEAL },
  ];
  // the key in your bag (cityEcon row) or the writ taking it already granted
  // you (govcomplex sets g.cityGovWrit off the same plinth).
  function haveSeal() {
    const e = CBZ.cityEcon;
    try { if (e && e.count && e.count(SEAL) > 0) return true; } catch (err) {}
    return !!g.cityGovWrit;
  }
  function tierOpen(t) { return !TIERS[t].key || haveSeal(); }
  function keyLine(t) {
    if (!TIERS[t] || !TIERS[t].key) return "No names today.";
    return "That name needs the city seal. It is behind the steel door in City Hall.";
  }
  CBZ.hitmanTier = function () {
    let t = 0;
    for (let i = 0; i < TIERS.length; i++) if (tierOpen(i)) t = i;
    return { tier: t, seal: haveSeal(), key: SEAL };
  };

  /* ---------------- WORLD BINDERS (never spawn a target) ---------------- */
  function principalSet() {
    const s = [];
    if (CBZ.powerPrincipals) { try { return CBZ.powerPrincipals(); } catch (e) {} }
    return s;
  }
  function isPrincipal(p, set) { return set.indexOf(p) >= 0; }

  // tier 0 — a street nobody with a REAL role: the dossier can say where he
  // works because aigoals' CITY_JOBS already knows.
  function bindStreet(opts) {
    const peds = CBZ.cityPeds || [];
    if (!peds.length) return null;
    const pp = P();
    const px = pp && pp.pos ? pp.pos.x : 0, pz = pp && pp.pos ? pp.pos.z : 0;
    const pr = principalSet();
    const pool = [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.pos || !p.group || !p.group.parent || p.culled || p.ko > 0) continue;
      if (p.vendor || p.isFamily || p.kid || p.child || p.kind === "cop" || p.swat || p.gang) continue;
      if (p.companion || p.recruited || p.controlled || p._parked || p._crowd || p._regionLife) continue;
      if (p._campaignTarget || p._campaignCaptive || p._hitMark || p._contractId) continue;
      if (p._powerOf || isPrincipal(p, pr)) continue;             // guards/principals are tier 1
      const d = d2(p.pos.x, p.pos.z, px, pz);
      if (d < (opts && opts.minDist != null ? opts.minDist : 50) || d > 320) continue;
      pool.push(p);
    }
    if (!pool.length) return null;
    // prefer a mark whose job the city actually runs — that is what makes the
    // dossier real instead of prose.
    const roled = pool.filter(function (p) { return p.job && CBZ.cityJobs && CBZ.cityJobs[p.job]; });
    const from = roled.length ? roled : pool;
    const day = CBZ.dayCount ? CBZ.dayCount() : 0;
    const r = CBZ.hash01 ? CBZ.hash01(day, ((recs() || {}).completed | 0) + ((opts && opts.salt) | 0), 0x417) : Math.random();
    const ped = from[Math.min(from.length - 1, (r * from.length) | 0)];
    return { tier: 0, ped: ped, name: ped.name || "the mark", dossier: streetDossier(ped), pay: TIERS[0].pay };
  }
  function streetDossier(p) {
    const bits = [];
    const jt = (CBZ.cityJobTitle && p.job) ? CBZ.cityJobTitle(p.job) : null;
    const J = (CBZ.cityJobs && p.job) ? CBZ.cityJobs[p.job] : null;
    if (jt) bits.push("works as a " + String(jt).toLowerCase());
    if (J && J.lots && J.lots.length) bits.push("clocks in at the " + J.lots[0]);
    else if (J && J.anchor) bits.push("works the " + J.anchor);
    if (J && J.hours) bits.push("shift " + J.hours[0] + ":00-" + J.hours[1] + ":00");
    let home = null;
    try { home = CBZ.cityHomeOf ? CBZ.cityHomeOf(p) : null; } catch (e) { home = null; }
    if (home && home.district) bits.push("beds down in " + home.district);
    return bits.length ? "Dossier: " + bits.join(" · ") + "." : "No paper trail. A face, a name, a habit of walking the same streets.";
  }

  // tier 1 — a protected principal: killing him means beating the RING
  // power.js already runs around him. Officeholders are excluded — they are
  // the tier above, bound through officialdom.
  function bindProtected() {
    const pr = principalSet();
    const out = [];
    for (let i = 0; i < pr.length; i++) {
      const p = pr[i];
      if (!p || p.dead || !p.pos || p._sid) continue;             // _sid = an officeholder body
      if (p._campaignTarget || p._hitMark) continue;
      out.push(p);
    }
    if (!out.length) return null;
    const day = CBZ.dayCount ? CBZ.dayCount() : 0;
    const r = CBZ.hash01 ? CBZ.hash01(day, (recs() || {}).completed | 0, 0x418) : Math.random();
    const ped = out[Math.min(out.length - 1, (r * out.length) | 0)];
    let guards = 0, org = null;
    try { guards = CBZ.powerGuardsOf ? CBZ.powerGuardsOf(ped).length : 0; } catch (e) {}
    try { org = CBZ.powerOrgOf ? CBZ.powerOrgOf(ped) : null; } catch (e) {}
    const role = CBZ.cityTitle ? CBZ.cityTitle(ped) : (ped.job || "principal");
    const doss = "Dossier: " + role + (org ? ", " + org : "") +
      ". Moves with " + (guards || "a") + " gun" + (guards === 1 ? "" : "s") + " on him at all times. " +
      "The ring reads strangers. A borrowed uniform walks closer than your own face.";
    return { tier: 1, ped: ped, name: ped.name || "the principal", dossier: doss, pay: TIERS[1].pay };
  }

  // tier 2 — the sitting officeholder. Bound through contracts.js's OWN
  // exposed world binder (cityOrders._official), so the freelance top rung and
  // the faction assassination point at the same live man; completion reads
  // officialdom's real death broadcast, and succession/approval fall out of
  // systems that already exist.
  let lastOfficialDeath = null, deathSub = false;
  function subOfficialDeath() {
    if (deathSub || !CBZ.onOfficialDeath) return;
    deathSub = true;
    CBZ.onOfficialDeath(function (rec, sid) { lastOfficialDeath = { sid: sid, t: Date.now() }; void rec; });
  }
  function officialPed(sid) {
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i]._sid === sid) return peds[i];
    return null;
  }
  function bindOffice() {
    if (CFG.CONTRACTS_ASSASSINATION === false) return null;
    const o = (CBZ.cityOrders && CBZ.cityOrders._official) ? CBZ.cityOrders._official() : null;
    if (!o) return null;
    subOfficialDeath();
    const doss = "Dossier: " + o.title + " " + o.name +
      ". City hall 09:00-17:00, a public face after. He moves with a real detail, and the whole city hears this one land.";
    return { tier: 2, official: o, name: o.title + " " + o.name, dossier: doss, pay: TIERS[2].pay };
  }

  CBZ.hitmanBind = function (tier, opts) {
    if (CFG.HITMAN_PIPE === false) return null;
    tier = tier | 0;
    let con = null;
    try {
      con = tier === 2 ? bindOffice() : tier === 1 ? bindProtected() : bindStreet(opts || {});
    } catch (e) { con = null; }
    return con;
  };

  /* ---------------- THE PIPE (one mission, through the block) ----------- */
  let serial = 0;
  function escapeStage() {
    let from = null;
    return {
      id: "escape", goal: "custom", text: "Get clear", label: "GET CLEAR", color: 0xffd166,
      onEnter: function (m, st) {
        const p = P(); from = p && p.pos ? { x: p.pos.x, z: p.pos.z } : null;
        st._quiet = (g.wanted | 0) === 0;          // priced at the kill, not the walk
        st._dressed = !!(CBZ.cityDisguise && CBZ.cityDisguise());
      },
      done: function () {
        const p = P(); if (!p || !from) return true;
        if ((g.wanted | 0) > 0) return false;
        return d2(p.pos.x, p.pos.z, from.x, from.z) > 150;
      },
    };
  }
  function settle(m, con) {
    const st = m.stages && m.stages.length ? m.stages[m.stages.length - 1] : null;
    const quiet = !!(st && st._quiet);
    const bonus = quiet ? Math.round(con.pay * 0.4 / 50) * 50 : 0;
    const R0 = recs();
    if (R0) R0.paid = (R0.paid | 0) + con.pay + bonus;    // the wall keeps one number, and it is money
    if (CBZ.cityEvent) {
      try {
        CBZ.cityEvent(con.tier === 2 ? "assassination" : "hitman-complete", {
          cash: bonus, respect: con.tier === 2 ? 12 : con.tier === 1 ? 6 : 3,
          panic: quiet ? 0 : (con.tier === 2 ? 12 : 4), political: con.tier === 2 ? -6 : 0,
          heat: quiet ? 1 : 4,
          label: "Contract: " + con.name, message: quiet ? "Clean. The quiet margin cleared." : "Loud. The fee stands, the margin does not.",
        });
      } catch (e) {}
    }
    note(quiet
      ? "Clean. Fee plus the quiet margin" + (st && st._dressed ? ", and the uniform walked you out." : ".")
      : "It made the scanner. Fee only.", 3);
    paintBoard(true);
  }
  function releaseMark(con) {
    const ped = con && con.ped;
    if (!ped) return;
    ped._hitMark = false;
    ped._campaignTarget = false;
  }

  function buildDef(con) {
    const n = ++serial;
    const stages = [];
    if (con.tier === 2) {
      const o = con.official;
      const targeted = o.sid;
      const since = Date.now();
      let killed = false;
      stages.push({
        id: "close", goal: "reach", at: o.door, radius: 26,
        text: "Get eyes on City Hall", label: "CITY HALL",
      });
      stages.push({
        id: "hit", goal: "custom", text: "Remove " + o.name, label: String(o.name).toUpperCase(),
        at: function () { return officialPed(targeted) || o.door; },
        done: function () {
          if (killed) return true;
          if (lastOfficialDeath && lastOfficialDeath.sid === targeted && lastOfficialDeath.t > since) { killed = true; return true; }
          const ped = officialPed(targeted);
          if (ped && ped.dead) { killed = true; return true; }
          return false;
        },
      });
    } else {
      const ped = con.ped;
      ped._hitMark = true;
      ped._campaignTarget = true;                    // the shared "spoken for" stamp — origins heat + campaign casting both skip it
      stages.push({
        id: "hit", goal: "kill", actor: ped,
        text: "Eliminate " + con.name, label: String(con.name).toUpperCase(),
      });
    }
    stages.push(escapeStage());
    return {
      id: "hit-" + TIERS[con.tier].id + "-" + n,
      title: "CONTRACT: " + con.name,
      targetName: con.name,
      brief: con.dossier + " Quiet pays more. A witnessed kill burns the margin, and the borrowed cloth with it.",
      reward: { cash: con.pay, notoriety: con.tier === 2 ? 160 : con.tier === 1 ? 60 : 20 },
      color: con.tier === 2 ? 0xff4d4d : 0xffc766,
      limit: con.tier === 2 ? 1200 : 900,
      failIf: con.ped ? function () {
        const p = con.ped;
        if (p.dead) return null;                     // dead is the job, not a failure
        return (!p.group || !p.group.parent) ? "the trail went cold" : null;
      } : null,
      doneText: "Contract settled.",
      failText: "Contract lost.",
      onComplete: function (m) { settle(m, con); releaseMark(con); },
      onFail: function () {
        releaseMark(con);
        const R0 = recs(); if (R0) R0.failed++;
        paintBoard(true);
      },
    };
  }

  // The one entry every door uses (activities' Crime tab, the wall, probes).
  // opts.min — lowest acceptable tier (the "protected contract" door passes 1).
  CBZ.hitmanStart = function (opts) {
    opts = opts || {};
    if (CFG.HITMAN_PIPE === false) return null;
    if (campaignOwns()) {                            // the campaign IS this pipe on a contract run
      if (CBZ.campaignUI && CBZ.campaignUI.open) { try { CBZ.campaignUI.open("missions"); } catch (e) {} }
      return null;
    }
    const M = CBZ.mission;
    if (!M || !M.start) { note("No network here.", 2); return null; }
    if (M.busy && M.busy()) { note("Finish what you're carrying first.", 2.2); return null; }
    const min = opts.min | 0;
    if (min > 0 && !tierOpen(min)) { note(keyLine(min), 3); return null; }
    let con = null;
    for (let t = TIERS.length - 1; t >= min; t--) {
      if (!tierOpen(t)) continue;
      con = CBZ.hitmanBind(t, opts);
      if (con) break;
    }
    if (!con) { note("No names today.", 2.2); return null; }
    const m = M.start(buildDef(con));
    if (!m || m.inert) { releaseMark(con); return null; }
    const R0 = recs();
    if (CBZ.cityEvent) {
      try { CBZ.cityEvent("hitman-contract", { highValue: con.tier === 2, hitman: 1, label: "Contract: " + con.name, message: "Contract accepted: " + con.name + "." }, { silent: true }); } catch (e) {}
    } else if (R0) R0.contracts++;
    paintBoard(true);
    return m;
  };

  /* ---------------- THE ROOM (HITMAN_BOARD) ------------------------------ */
  // A crafted annex on the motel lot: floor, three walls + doorway, the WALL
  // OF MARKS, the gear case, a cot and a lamp. Real colliders, real doorway —
  // the room is the menu. Deterministic placement (hash01 side pick), refused
  // rather than forced when the apron is not clear.
  let built = null;                                  // { root, lot, group, spawn, board, case, live, marks }
  let zonesWired = false;

  function disposeGroup(obj) {
    if (!obj) return;
    if (obj.parent) obj.parent.remove(obj);
    obj.traverse(function (node) {
      if (node.geometry && !node.geometry._shared && node.geometry.dispose) { try { node.geometry.dispose(); } catch (e) {} }
      const m = node.material;
      if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    });
  }
  function dropRoomColliders() {
    const cols = CBZ.colliders;
    if (!cols) return;
    for (let i = cols.length - 1; i >= 0; i--) if (cols[i] && cols[i]._hitmanRoom) cols.splice(i, 1);
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
  }
  function solid(minX, minZ, maxX, maxZ, y0, y1, group) {
    const c = { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, y0: y0, y1: y1, ref: group, _hitmanRoom: true };
    (CBZ.colliders = CBZ.colliders || []).push(c);
    return c;
  }
  function footprintClear(cx, cz, hw, hd, gy) {
    const cols = CBZ.colliders || [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c._hitmanRoom) continue;
      if (c.y0 != null && (c.y1 < gy + 0.2 || c.y0 > gy + 2.4)) continue;
      if (cx + hw < c.minX || cx - hw > c.maxX || cz + hd < c.minZ || cz - hd > c.maxZ) continue;
      return false;
    }
    return true;
  }
  function motelLot() {
    if (CBZ.cityFindMotelLot) { try { return CBZ.cityFindMotelLot(); } catch (e) {} }
    const A = arena(); if (!A || !A.lots) return null;
    let motel = null, home = null;
    for (let i = 0; i < A.lots.length; i++) {
      const l = A.lots[i];
      if (!l || !l.building) continue;
      if (l.kind === "motel") { motel = l; break; }
      if (!home && (l.kind === "home" || l.kind === "house" || l.kind === "tower")) home = l;
    }
    return motel || home;
  }

  function lambert(color) { return new THREE.MeshLambertMaterial({ color: color }); }
  function boxAt(group, x, y, z, w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  }

  let refusedRoot = null;                             // this world offered no clear apron — stop rescanning it per frame
  function ensureRoom() {
    if (CFG.HITMAN_BOARD === false || CFG.HITMAN_PIPE === false) return null;
    const A = arena();
    if (!A || !A.root || !A.lots || !A.lots.length) return null;
    if (built && built.root === A.root) return built;
    if (refusedRoot === A.root) return null;
    // a previous world's room: its group died with the old arena root, but the
    // collider records and GPU buffers are ours to release.
    if (built) { dropRoomColliders(); disposeGroup(built.group); built = null; }

    const lot = motelLot();
    if (!lot || !lot.building || !lot.building.door) { refusedRoot = A.root; return null; }
    const door = lot.building.door;
    const nx = door.nx || 0, nz = door.nz || 1;
    const sx = -nz, sz = nx;                          // sideways along the frontage
    const W = 6.4, D = 5.2, H = 2.6;                  // outer footprint
    const hw = W / 2 + 0.4, hd = D / 2 + 0.4;
    // candidate aprons: beside the door left/right, then further out front.
    // hash01 picks which side is tried first, so the address is per-seed stable.
    const flip = (CBZ.hash01 ? CBZ.hash01(lot.cx | 0, lot.cz | 0, 0x517) : 0.5) < 0.5 ? 1 : -1;
    const cands = [
      { x: door.x + nx * 4.2 + sx * flip * 9.5, z: door.z + nz * 4.2 + sz * flip * 9.5 },
      { x: door.x + nx * 4.2 - sx * flip * 9.5, z: door.z + nz * 4.2 - sz * flip * 9.5 },
      { x: door.x + nx * 12.5, z: door.z + nz * 12.5 },
      { x: door.x + nx * 12.5 + sx * flip * 7.5, z: door.z + nz * 12.5 + sz * flip * 7.5 },
    ];
    let at = null;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (footprintClear(c.x, c.z, hw, hd, floorY(c.x, c.z))) { at = c; break; }
    }
    if (!at) { refusedRoot = A.root; return null; }   // no clear apron: no room this seed (never force it)
    const gy = floorY(at.x, at.z);
    const heading = Math.atan2(door.x - at.x, door.z - at.z);   // doorway faces the motel door

    const group = new THREE.Group();
    group.position.set(at.x, gy, at.z);
    group.rotation.y = heading;
    group.userData.transient = false;

    const wallM = lambert(0x4a4038), wallM2 = lambert(0x423a33), floorM = lambert(0x33302c), roofM = lambert(0x2a2724);
    boxAt(group, 0, 0.06, 0, W, 0.12, D, floorM);                       // slab
    boxAt(group, 0, H / 2, -D / 2 + 0.09, W, H, 0.18, wallM);           // back (the board wall)
    boxAt(group, -W / 2 + 0.09, H / 2, 0, 0.18, H, D, wallM2);          // left
    boxAt(group, W / 2 - 0.09, H / 2, 0, 0.18, H, D, wallM2);           // right
    // front wall with a 1.3 m doorway at the right end — the mesh spans
    // exactly what the collider below blocks (local -W/2 .. W/2-1.3), so
    // there is never an invisible-wall strip inside a visible opening.
    boxAt(group, -0.65, H / 2, D / 2 - 0.09, W - 1.3, H, 0.18, wallM);
    boxAt(group, W / 2 - 0.65, H - 0.3, D / 2 - 0.09, 1.3, 0.6, 0.18, wallM);   // lintel over the doorway
    boxAt(group, 0, H + 0.07, 0, W + 0.5, 0.14, D + 0.5, roofM);        // flat roof
    // cot + side table (texture, not furniture anchors — nothing registers a
    // propuse seat here, so the blocked-anchor ratchet never sees this room)
    boxAt(group, -W / 2 + 1.15, 0.32, D / 2 - 1.35, 1.9, 0.4, 0.95, lambert(0x5d5648));
    boxAt(group, -W / 2 + 0.5, 0.42, D / 2 - 2.6, 0.55, 0.6, 0.55, lambert(0x3a332c));
    const lamp = new THREE.PointLight(0xffd9a0, 0.85, 8.5);
    lamp.position.set(0, H - 0.35, 0.4);
    group.add(lamp);

    // THE WALL OF MARKS — a live board (the ctx.canvasTexLive contract: keep
    // the 2d context, paint() is the ONE needsUpdate site, redraw on EVENTS
    // never per frame; the helper itself is package-scoped in core/packages.js
    // so this carries the same record shape). The face stands SCREEN_GAP-proud
    // of the cork so it can never coplanar-fight (the gov-board law: >= 0.025).
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 340;
    const boardTex = new THREE.CanvasTexture(canvas);
    const live = { canvas: canvas, cc: canvas.getContext("2d"), tex: boardTex, w: 512, h: 340, paint: function () { boardTex.needsUpdate = true; return live; } };
    boxAt(group, 0.35, 1.52, -D / 2 + 0.24, 2.9, 1.8, 0.06, lambert(0x241d16));         // cork backing
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(2.72, 1.62),
      new THREE.MeshBasicMaterial({ map: live.tex })
    );
    face.position.set(0.35, 1.52, -D / 2 + 0.24 + 0.03 + 0.031);                        // 0.031 > SCREEN_GAP
    group.add(face);

    // THE GEAR CASE. It has no lock. It is your case, in your room; walking
    // up to it and opening it is the whole interaction.
    const caseGrp = new THREE.Group();
    caseGrp.position.set(W / 2 - 0.85, 0, -D / 2 + 0.95);
    boxAt(caseGrp, 0, 0.3, 0, 1.15, 0.52, 0.6, lambert(0x1e2b24));
    boxAt(caseGrp, 0, 0.585, 0, 1.19, 0.05, 0.64, lambert(0x16211c));                   // lid
    boxAt(caseGrp, 0, 0.34, 0.315, 0.16, 0.2, 0.05, lambert(0x9aa0a4));                 // latch, not a lock
    group.add(caseGrp);

    A.root.add(group);
    // colliders (world space; the group is yawed, so bound conservatively by
    // the rotated rectangle's AABB — walls get their own thin boxes instead of
    // one solid block, so the doorway stays open)
    const cosH = Math.cos(heading), sinH = Math.sin(heading);
    function wpt(lx, lz) { return { x: at.x + lx * cosH + lz * sinH, z: at.z - lx * sinH + lz * cosH }; }
    function wallCol(lx0, lz0, lx1, lz1) {
      const a = wpt(lx0, lz0), b = wpt(lx1, lz1);
      solid(Math.min(a.x, b.x) - 0.14, Math.min(a.z, b.z) - 0.14, Math.max(a.x, b.x) + 0.14, Math.max(a.z, b.z) + 0.14, gy, gy + H, group);
    }
    wallCol(-W / 2, -D / 2, W / 2, -D / 2);                          // back
    wallCol(-W / 2, -D / 2, -W / 2, D / 2);                          // left
    wallCol(W / 2, -D / 2, W / 2, D / 2);                            // right
    wallCol(-W / 2, D / 2, W / 2 - 1.3, D / 2);                      // front minus doorway
    if (CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }

    const boardW = wpt(0.35, -D / 2 + 0.6), caseW = wpt(W / 2 - 0.85, -D / 2 + 1.1), spawnW = wpt(0.2, 0.9);
    built = {
      root: A.root, lot: lot, group: group, live: live, marks: 0, key: "",
      name: (lot.kind === "motel" ? "The motel room" : "The rented room"),
      // `heading` here is a CAMERA yaw. The wall is at local -Z (look
      // direction heading+PI), and the origins scene convention is
      // cam.yaw = lookDir + PI — so waking up facing the wall of marks is
      // yaw = heading.
      spawn: { x: spawnW.x, z: spawnW.z, heading: heading },
      board: { x: boardW.x, z: boardW.z },
      casePos: { x: caseW.x, z: caseW.z },
    };
    paintBoard(true);
    wireZones();
    return built;
  }
  CBZ.hitmanRoom = ensureRoom;

  /* ---------------- the board painting ----------------------------------- */
  // legacy saves carried a two-drawer `caseTier`; anything past the first
  // drawer means the case has already been emptied under the old lock.
  function caseOpened() { const R0 = recs(); return !!(R0 && (R0.caseOpen || (R0.caseTier | 0) >= 2)); }
  function boardKey() {
    const R0 = recs() || {};
    const camp = g.cityCampaign ? (g.cityCampaign.phase + ":" + (g.cityCampaign.contractNo | 0)) : "";
    return [R0.completed | 0, R0.failed | 0, R0.paid | 0, haveSeal() ? 1 : 0, caseOpened() ? 1 : 0, camp].join("|");
  }
  function card(cc, x, y, w, h, tone) {
    cc.save();
    cc.translate(x + w / 2, y + h / 2);
    cc.rotate(((x * 7 + y * 13) % 10 - 5) * 0.006);
    cc.fillStyle = tone || "#e8e2d4";
    cc.fillRect(-w / 2, -h / 2, w, h);
    cc.restore();
  }
  function pin(cc, x, y) { cc.fillStyle = "#b03a30"; cc.beginPath(); cc.arc(x, y, 4, 0, 6.29); cc.fill(); }
  function stringTo(cc, x0, y0, x1, y1) {
    cc.strokeStyle = "rgba(176,58,48,.75)"; cc.lineWidth = 1.6;
    cc.beginPath(); cc.moveTo(x0, y0); cc.quadraticCurveTo((x0 + x1) / 2, Math.min(y0, y1) - 9, x1, y1); cc.stroke();
  }
  function paintBoard(force) {
    if (!built || !built.live) return;
    const key = boardKey();
    if (!force && key === built.key) return;
    built.key = key;
    const b = built.live, cc = b.cc;
    const R0 = recs() || { completed: 0, paid: 0 };
    let marks = 0;

    cc.fillStyle = "#6b563c"; cc.fillRect(0, 0, b.w, b.h);           // cork
    cc.fillStyle = "rgba(0,0,0,.28)"; cc.fillRect(0, 0, b.w, 34);
    cc.fillStyle = "#f0e6cf"; cc.font = "700 20px monospace";
    cc.fillText("MARKS", 14, 24);
    cc.font = "600 13px monospace";
    cc.fillText("$" + (R0.paid | 0).toLocaleString() + " PAID  ·  " + (R0.completed | 0) + " SETTLED", 110, 23);
    const hub = { x: 52, y: 62 };
    pin(cc, hub.x, hub.y);

    // settled marks — small crossed polaroids, capped at 8
    const doneN = Math.min(8, R0.completed | 0);
    for (let i = 0; i < doneN; i++) {
      const x = 16 + (i % 4) * 56, y = 52 + ((i / 4) | 0) * 62;
      card(cc, x, y, 46, 52, "#cfc7b4");
      cc.strokeStyle = "#8a2f28"; cc.lineWidth = 3;
      cc.beginPath(); cc.moveTo(x + 6, y + 8); cc.lineTo(x + 40, y + 46);
      cc.moveTo(x + 40, y + 8); cc.lineTo(x + 6, y + 46); cc.stroke();
      marks++;
    }

    // the ladder — one card per tier. The one card that can hang dark names
    // the KEY it wants and where that key is lying (the locked door with the
    // gun room visible through it).
    for (let t = 0; t < TIERS.length; t++) {
      const x = 262, y = 46 + t * 92, w = 228, h = 78;
      const open = tierOpen(t);
      card(cc, x, y, w, h, open ? "#e8e2d4" : "#2c2723");
      pin(cc, x + w / 2, y + 4);
      stringTo(cc, hub.x, hub.y, x + w / 2, y + 4);
      cc.fillStyle = open ? "#241d16" : "#8a7f6d";
      cc.font = "700 15px monospace";
      cc.fillText(TIERS[t].label, x + 12, y + 26);
      cc.font = "600 12px monospace";
      if (open) {
        cc.fillText("$" + TIERS[t].pay.toLocaleString() + " + quiet margin", x + 12, y + 46);
        cc.fillStyle = "#3f6b46";
        cc.fillText(t === 2 ? "a real officeholder" : t === 1 ? "beat the ring" : "a name with a shift", x + 12, y + 64);
      } else {
        cc.fillText("NEEDS THE " + String(TIERS[t].key).toUpperCase(), x + 12, y + 46);
        cc.fillStyle = "#6d6355";
        cc.fillText("City Hall, behind steel", x + 12, y + 64);
      }
      marks++;
    }

    // the Director's thread — the authored campaign is the same wall
    if (g.cityCampaign && (g.cityOrigin === "contract" || g.cityOrigin === "hitman")) {
      const x = 16, y = 196, w = 228, h = 58;
      card(cc, x, y, w, h, "#1d222b");
      pin(cc, x + w / 2, y + 4);
      stringTo(cc, hub.x, hub.y, x + w / 2, y + 4);
      cc.fillStyle = "#c8b06a"; cc.font = "700 14px monospace";
      cc.fillText("THE DIRECTOR", x + 12, y + 24);
      cc.fillStyle = "#8a93a3"; cc.font = "600 12px monospace";
      const c = g.cityCampaign;
      cc.fillText(c.phase === "endless_contracts" ? ("contract #" + Math.max(1, c.contractNo | 0)) : "still running", x + 12, y + 44);
      marks++;
    }

    // the case line: one word, because the case is one press
    cc.fillStyle = "rgba(0,0,0,.3)"; cc.fillRect(0, b.h - 28, b.w, 28);
    cc.fillStyle = "#d8c9a3"; cc.font = "600 12px monospace";
    cc.fillText("CASE: " + (caseOpened() ? "empty" : "packed"), 14, b.h - 9);

    built.marks = marks;
    b.paint();
  }

  /* ---------------- verbs (interactions zones — no new popup) ------------ */
  function liveHit() {
    const M = CBZ.mission;
    if (!M || !M.live) return null;
    const ms = M.live();
    for (let i = 0; i < ms.length; i++) if (/^hit-/.test(ms[i].id)) return ms[i];
    return null;
  }
  function wireZones() {
    if (zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zonesWired = true;
    // CARD TITLES. Without these the registry prints its "—" placeholder as
    // the card's title, which is where that dash on the owner's screen came
    // from. A title is a NAME, the button under it is the verb.
    if (CBZ.interactions.describe) {
      try {
        CBZ.interactions.describe("hitboard", function () { return { label: "The wall", note: "Names, fees, and what is settled" }; });
        CBZ.interactions.describe("hitcase", function () { return { label: "Gear case", note: caseOpened() ? "Empty" : "Packed" }; });
      } catch (e) {}
    }
    const bTok = { x: 0, z: 0, kind: "hitboard" };
    CBZ.interactions.registerZone({
      id: "hitman-board", kind: "hitboard", radius: 2.6, prio: 14,
      find: function (px, pz) {
        if (!built || g.mode !== "city") return null;
        bTok.x = built.board.x; bTok.z = built.board.z;
        const dx = bTok.x - px, dz = bTok.z - pz;
        return (dx * dx + dz * dz) < 2.6 * 2.6 ? bTok : null;
      },
      options: [{
        id: "hitman-board-read", slot: "e",
        // THE BUTTON IS THE VERB (interactions.js's own law): under 24 chars
        // it IS the button, with no copy bar repeating it. You walk to a wall,
        // you read it. Nothing else needs saying.
        label: function () { return "Read wall"; },
        onSelect: function () {
          paintBoard(true);
          if (campaignOwns()) { if (CBZ.campaignUI && CBZ.campaignUI.open) { try { CBZ.campaignUI.open("missions"); } catch (e) {} } return; }
          const m = liveHit();
          if (m) { note("Finish " + (m.def.targetName || "the open name") + " first.", 2.4); return; }
          CBZ.hitmanStart();
        },
      }],
    });
    const cTok = { x: 0, z: 0, kind: "hitcase" };
    CBZ.interactions.registerZone({
      id: "hitman-case", kind: "hitcase", radius: 2.0, prio: 14,
      find: function (px, pz) {
        if (!built || g.mode !== "city") return null;
        cTok.x = built.casePos.x; cTok.z = built.casePos.z;
        const dx = cTok.x - px, dz = cTok.z - pz;
        return (dx * dx + dz * dz) < 2.0 * 2.0 ? cTok : null;
      },
      options: [{
        id: "hitman-case-open", slot: "e",
        label: function () { return caseOpened() ? "Empty case" : "Open the case"; },
        // NO LOCK (owner, 2026-08-18: "this gearbox should just open"). It is
        // your case in your room; the kit comes out in one press.
        onSelect: function () {
          const R0 = recs(); if (!R0) return;
          if (caseOpened()) { note("Empty. You carry everything it held.", 2); return; }
          R0.caseOpen = true;
          R0.caseTier = 2;                                  // legacy field, pinned so an old save reads empty too
          if (CBZ.cityGiveWeapon) { CBZ.cityGiveWeapon("Sniper"); CBZ.cityGiveWeapon("SMG"); }
          if (CBZ.fpsAddAmmo) { try { CBZ.fpsAddAmmo(20, "sniper"); } catch (e) {} }
          g.cityGunMods = g.cityGunMods || {};
          const cur = g.cityGunMods.smg || { scope: null, mag: null, muzzle: null, under: null };
          cur.muzzle = "suppressor";
          g.cityGunMods.smg = cur;
          if (CBZ.gunModsDressAll) { try { CBZ.gunModsDressAll(); } catch (e) {} }
          note("The long lens and a threaded SMG. That is everything the case held.", 3);
          if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} }
          paintBoard(true);
        },
      }],
    });
  }

  /* ---------------- tick -------------------------------------------------- */
  let repaintT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(39.45, function (dt) {
    if (g.mode !== "city" || g.state !== "playing") return;
    if (CFG.HITMAN_PIPE === false) return;
    ensureRoom();
    repaintT -= dt || 0;
    if (repaintT <= 0) { repaintT = 5; paintBoard(false); }   // dirty-check every 5s; paint only on change
  });

  /* ---------------- THE RATCHET — CBZ.hitmanAudit() ----------------------- */
  // cards must be 1 (one hitman fantasy on the picker), pipes 1 (one contract
  // producer plus any surviving legacy site), legacyStreetHitmanSites 0 (the
  // activities.js parallel system is dead — a live g.cityJob of the retired
  // "hitman" type is the only way this can ever read nonzero again).
  CBZ.hitmanAudit = function () {
    let cards = 0;
    try {
      cards = document.querySelectorAll('#originSelect .origin-btn[data-origin="contract"],#originSelect .origin-btn[data-origin="hitman"]').length;
    } catch (e) { cards = -1; }
    const legacy = (g.cityJob && !g.cityJob._mission && g.cityJob.type === "hitman") ? 1 : 0;
    const T = CBZ.hitmanTier();
    return {
      cards: cards,
      pipes: (typeof CBZ.hitmanStart === "function" && CFG.HITMAN_PIPE !== false ? 1 : 0) + legacy,
      marksLadderTiers: TIERS.length,
      boardMarks: built ? built.marks : 0,
      disguiseHooks: (typeof CBZ.cityDisguise === "function" ? 1 : 0) +
        (typeof CBZ.cityDisguiseTrust === "function" ? 1 : 0) +
        (typeof CBZ.cityOutfitGet === "function" ? 1 : 0),
      legacyStreetHitmanSites: legacy,
      room: !!built,
      caseOpen: caseOpened(),
      repGates: 0,                       // no rung and no box in this file reads a reputation number
      keyedRungs: TIERS.filter(function (t) { return !!t.key; }).length,
      seal: T.seal, tier: T.tier,
    };
  };
})();
