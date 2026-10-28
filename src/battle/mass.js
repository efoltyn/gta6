"use strict";
/* src/battle/mass.js — NPC War: THE INFANTRY, HOSTED. Every armed rifleman on
   the field, at every battle size from 1 v 1 to a million a side, is a row in
   the infantry core (src/battle/core/infantry.js) and is fought by its rules
   and only by them. There are no tiers of brain: a man near the lens and a
   man two kilometres off are the same sim.

   What this file is: the core's host on this page.
     THE ROWS     who becomes one (an armed man whose gun the core flies:
                  rifles, carbines, machine guns, marksman rifles, pistols,
                  sub-machine guns) and where he forms up (squads of ten in
                  their wedges, squads side by side, platoons behind)
     THE HOST'S BODIES   everything else on the field stays the page's own
                  object (animals, hulls and their crews, a man with bare
                  hands, a launcher, a shotgun, the man YOU are): each has a
                  row too (an EXTERNAL row), written every step, so the core's
                  men see it, shoot at it and are shot by it
     THE SEAM     the core's rounds that reach one of the page's bodies come
                  back (I.extHits) and are flown into it by fire.js's own
                  anatomy and armour; the page's rounds go through the rows
                  by the core's (fire.js resolveRound -> MASS.traceRows); a
                  bite, a crush or a blow on a man of the core lands as a wound
     THE CLOCK    the core steps on its own fixed 0.1 s clock; everything that
                  draws a row carries it along its velocity in between
     THE PUPPETS  the men near the lens get a rig (makeMan) that SHOWS its
                  row: where he is, how he faces, his posture, his rifle on
                  the mark, the shot, the reload, the wound, the fall. A rig
                  never decides anything, so building one cannot change a
                  battle. The rest are drawn by massdraw.js (CBZ.crowdGPU)
     THE ROUNDS ON SCREEN   every round near the lens is drawn along the line
                  the core flew it, to where it really stopped: the tracer,
                  the crack, the strike on the ground

   PUBLIC (the rest of the page and Gang City's army call these)
     MASS.begin(asBench, how) / MASS.open(o) / MASS.reset()
     MASS.addRows(team, from, n) / removeRows(rows) / orderRows(rows, order, homeOf)
     MASS.step(sdt) (tick.js) / MASS.frame(dt) (tick.js animFrame)
     MASS.count / armies / com / inFight / aliveCount / seedNav (morale, orders, the win check)
     MASS.cands(m, range, out, spot) (physics.js pickTarget: rows as ghosts)
     MASS.hurtGhost(g, dmg, imp) / MASS.hurtPuppet(m, dmg, imp) (damage.js hurtMan)
     MASS.traceRows(r, s0, s1) (fire.js resolveRound)
     MASS.blast(x, z, R, by) (every boom on the page)
     MASS.release(m) / MASS.adopt(m) (player.js: YOU take a man, and hand him back)
     MASS.audit()
   URL: ?fullcap=N (rigs near the lens), ?fullr=M (their radius).
   Every src/battle file shares ONE script scope (see ARCHITECTURE.md). */

const MASS = {
  on: false, I: null, T: null, link: null, total: 0, rows: 0,
  caps: null, opt: {}, sq: null, schedAt: -9, ghosts: new Map(), ghostSweepT: 0,
  cnt: { alive: [0, 0], fighting: [0, 0], routing: [0, 0], beasts: [0, 0], pNow: [0, 0], cx: [0, 0], cz: [0, 0], ax: [0, 0], az: [0, 0], at: -1 },
  pending: [], promoteMs: 4, stats: { promoted: 0, demoted: 0, ghosts: 0, ms: { sync: 0, step: 0, events: 0, sched: 0, draw: 0 } },
  ctx: null, unitOf: null, acc: 0, DT: 0.1, vis: [], ext: [], fullRows: [],
};
(function () {
  MASS.opt = {
    fullcap: parseInt(Q.get("fullcap") || "", 10) || 0,
    fullr: parseFloat(Q.get("fullr") || "") || 0,
  };
})();
// a gun the core flies (one round a pull; the cartridge is in weapons/ballistics.js)
const MASS_GUNS = { carbine: 1, ak47: 1, lmg: 1, sniper: 1, smg: 1, uzi: 1, sidearm: 1, revolver: 1, deagle: 1 };
// is body i of a side a row of the core? (else the page's own object)
function massIsRow(team, i) {
  const kind = unitIdAt(team, i);
  if (kind !== "men") return false;
  if (vehicleSeatFor(team, i)) return false;              // a crew or a rider: the hull's
  const wid = pickGun(gunChoiceAt(team, i), i);
  return !!MASS_GUNS[wid];
}

/* ---------------------------------------------------------------- begin */
MASS.reset = function () {
  if (CBZ.massDraw && CBZ.massDraw.reset) CBZ.massDraw.reset();
  MASS.on = false; MASS.I = MASS.T = null; MASS.rows = 0; MASS.sq = null; MASS.pending.length = 0;
  MASS.ghosts.clear(); MASS.schedAt = -9; MASS.cnt.at = -1; MASS.acc = 0;
  MASS.sqIds = null; MASS.unitTypes = null; MASS.vis.length = 0; MASS.ext.length = 0;
};
// the field the rows can reach: both armies, the gap, and the room to run
function massExtent() {
  const n = Math.max(SET.redN, SET.blueN), F = massFormation(n);
  const depth = F.deep * F.rowGap + 60, width = F.wide * F.colGap + 60;
  const runR = 2.2 * (HOST.gap || 150) + 120;
  const hx = (HOST.gap || 150) / 2 + 8 + depth + runR, hz = width / 2 + runR;
  return { x0: HOST.cx - hx, x1: HOST.cx + hx, z0: HOST.cz - hz, z1: HOST.cz + hz };
}
/* THE FORMATION. A squad is ten men in a wedge (the leader at the point,
   alpha back on the left, bravo on the right, 4 m between men). Squads stand
   side by side 50 m apart along the front (a platoon's frontage), and past
   a front of ~1.5 km the rest form up behind, 150 m a rank of squads. */
function massFormation(n) {
  const nsq = Math.max(1, Math.ceil(n / 10));
  const wide = Math.max(1, Math.min(nsq, Math.max(Math.ceil(Math.sqrt(nsq * 2.5)), Math.min(nsq, 30))));
  return { nsq: nsq, wide: wide, deep: Math.ceil(nsq / wide), colGap: 50, rowGap: 150 };
}
function massPlace(team, i, n) {
  if (!HOST.terrainTrue && !(typeof MAP !== "undefined" && MAP && MAP.erg)) return HOST.spawnAt(team, i);    // a venue lays out its own streets
  const F = massFormation(n);
  const sq = (i / 10) | 0, slot = i % 10;
  const col = sq % F.wide, row = (sq / F.wide) | 0;
  const s = team === "red" ? -1 : 1;                      // red forms up on the -x side, facing +x
  const k = slot === 0 ? 0 : slot <= 4 ? slot : slot - 5, sd = slot === 0 ? 0 : slot <= 4 ? -1 : 1;
  const back = row * F.rowGap + (slot === 0 ? 0 : 3 + k * 4);
  const lat = (col - (F.wide - 1) / 2) * F.colGap + sd * (4 + k * 4);
  // the far side is the near side turned 180 degrees about the centre (a fair start)
  return { x: HOST.cx + s * ((HOST.gap || 150) / 2 + 8 + back), z: HOST.cz + s * -lat };
}
/* THE GROUND AND THE COVER, as the core reads them: heights sampled once over
   the field (1.5 m where it fits), and every collider standing on it
   rasterized into a cover grid (its top over the ground, its material and
   how much of it is solid: a container is two thin walls, a crate part wood) */
/* (the samples are laid symmetric about the field's centre, a whole number of
   cells each way: the far side's ground is the near side's turned, sample for
   sample, so neither start line sees the crests a few tenths differently) */
function massGround(ext) {
  const cxF = (ext.x0 + ext.x1) / 2, czF = (ext.z0 + ext.z1) / 2;
  const W = ext.x1 - ext.x0, H = ext.z1 - ext.z0;
  const cell = Math.max(1.5, Math.sqrt(W * H / 3.0e6));
  const hw = Math.ceil(W / 2 / cell), hh = Math.ceil(H / 2 / cell);
  const gw = hw * 2 + 1, gh = hh * 2 + 1, x0 = cxF - hw * cell, z0 = czF - hh * cell;
  const hgt = new Float32Array(gw * gh);
  for (let iz = 0; iz < gh; iz++) for (let ix = 0; ix < gw; ix++) hgt[iz * gw + ix] = HOST.groundAt(x0 + ix * cell, z0 + iz * cell);
  return { x0: x0, z0: z0, cell: cell, w: gw, h: gh, hgt: hgt };
}
const COVER_MATS = ["concrete", "sand", "dirt", "wood", "cinder", "brick", "concrete", "steel", "rha", "snow"];
function massCover(ext, ground) {
  const L = CBZ.colliders;
  if (!L || !L.length) return null;
  // (laid symmetric about the field's centre, as the ground is)
  const cxF = (ext.x0 + ext.x1) / 2, czF = (ext.z0 + ext.z1) / 2;
  const hwC = Math.ceil((ext.x1 - ext.x0) / 2), hhC = Math.ceil((ext.z1 - ext.z0) / 2);
  ext = { x0: cxF - hwC, x1: cxF + hwC, z0: czF - hhC, z1: czF + hhC };
  const cell = 1, w = hwC * 2, h = hhC * 2;
  if (w * h > 3.2e7) return null;                         // (past ~5 km square the cover is too fine to hold)
  const top = new Float32Array(w * h), mat = new Uint8Array(w * h), fillK = new Float32Array(w * h);
  let any = false;
  for (let k = 0; k < L.length; k++) {
    const c = L[k];
    if (!c || c.minX == null || c.maxX < ext.x0 || c.minX > ext.x1 || c.maxZ < ext.z0 || c.minZ > ext.z1) continue;
    if (c.y1 == null) continue;
    const mi = Math.max(1, COVER_MATS.indexOf(c.mat || "concrete"));
    const solid = c.hollow ? Math.min(1, (c.hollow * 2) / Math.max(0.5, Math.min(c.maxX - c.minX, c.maxZ - c.minZ))) : c.fill != null ? c.fill : 1;
    const x0 = Math.max(0, Math.floor((c.minX - ext.x0) / cell)), x1 = Math.min(w - 1, Math.floor((c.maxX - ext.x0) / cell));
    const z0 = Math.max(0, Math.floor((c.minZ - ext.z0) / cell)), z1 = Math.min(h - 1, Math.floor((c.maxZ - ext.z0) / cell));
    for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
      const x = ext.x0 + (ix + 0.5) * cell, z = ext.z0 + (iz + 0.5) * cell;
      if (!HOST.colliderContains(c, x, z, 0)) continue;
      const g = HOST.groundAt(x, z);
      const t = c.y1 - g;
      if (t < 0.15 || c.y0 > g + 1.2) continue;           // a lintel, a roof, a thing under the ground
      const q = iz * w + ix;
      if (t > top[q]) { top[q] = Math.min(12, t); mat[q] = mi; fillK[q] = solid; any = true; }
    }
  }
  if (!any) return null;
  void ground;
  return { x0: ext.x0, z0: ext.z0, cell: cell, w: w, h: h, top: top, mat: mat, mats: COVER_MATS, fill: fillK };
}
// one unit type per training x gun x nation (its doctrine, its rifle, its sight, its kit)
function massUnitType(team, i) {
  const tr = trainingOf(trainAt(team, i));
  const wid = pickGun(gunChoiceAt(team, i), i);
  const nat = nationOf(team);
  const key = tr.id + "|" + wid + "|" + nat;
  const U = MASS.unitTypes || (MASS.unitTypes = new Map());
  let u = U.get(key);
  if (u) return u;
  const C = CBZ.countries, R = C && C.get ? C.get(nat) : null;
  const rifle = R ? R.rifle : null;
  const optic = rifle && rifle.gun === wid ? (rifle.optic || 0) : (wid === "sniper" ? 10 : 0);
  const N = R ? R.kit : (CBZ.combatKit && CBZ.combatKit.nation ? CBZ.combatKit.nation(nat) : null);
  const kit = CBZ.battleInfantry.kitFor(N, tr.id, !!R);
  const typ = MASS.I.unitType({ trn: tr.id, gun: wid, optic: optic, kit: kit });
  u = { kind: "men", wid: wid, tr: tr.id, typ: typ, idx: MASS.unitOf.length, w: (MK.TIER_W[tr.id] || 1) * ((wid === "sniper" || wid === "lmg") ? 1.15 : 1) };
  U.set(key, u);
  MASS.unitOf.push(u);
  return u;
}
function massSquadId(team, sq) {
  const M = MASS.sqIds || (MASS.sqIds = new Map());
  const key = team + ":" + sq;
  let id = M.get(key);
  if (id == null) { id = M.size; M.set(key, id); }
  return id;
}
MASS.begin = function (asBench, how) {
  const S = typeof SETTINGS !== "undefined" ? SETTINGS.cur : null;
  if (S && !asBench) SETTINGS.clampArmy();
  const cp = CBZ.battleLod.caps();
  MASS.caps = { full: MASS.opt.fullcap || (S && S.fullcap) || cp.full, promote: cp.promote };
  if (!MASS.opt.fullr && S) MASS.opt.fullr = S.fullr;
  // EVERY BATTLE WITH RIFLEMEN IN IT: there is no size below which men are fought differently
  let rows = 0;
  if (!asBench && !HOST.water && CBZ.battleInfantry && CBZ.ballistics) {
    for (let i = 0; i < SET.redN && !rows; i++) if (massIsRow("red", i)) rows++;
    for (let i = 0; i < SET.blueN && !rows; i++) if (massIsRow("blue", i)) rows++;
  }
  MASS.on = rows > 0;
  if (!MASS.on) return false;
  if (how && how.restage && typeof resetArmies === "function") resetArmies();
  const total = SET.redN + SET.blueN;
  MASS.total = total;
  STORE.reserve(total + 16);
  const ext = massExtent();
  MASS.ground = massGround(ext);
  MASS.cover = massCover(ext, MASS.ground);
  MASS.I = MASS.T = CBZ.battleInfantry.create(STORE, { ground: MASS.ground, cover: MASS.cover, seed: (lcg() * 0x7ffffffe) | 0 || 1 });
  MASS.unitOf = [];
  spawnQueue.length = 0;
  MASS.spawnAll();
  MASS.buildSquads();
  // (each army's middle first: the first order is "advance on HIM", not on the world's origin)
  MASS.count(true); MASS.com();
  massOrders(true);
  if (CBZ.massDraw) CBZ.massDraw.begin();
  return true;
};
/* A HOST THAT FIELDS FORCES AS IT GOES (Gang City's CBZ.army): the core opens
   on an empty field and each force's men are added as rows when it is
   spawned (MASS.addRows). o = { fullcap, fullr, capHint, groundAt } */
MASS.open = function (o) {
  o = o || {};
  MASS.reset();
  const cp = CBZ.battleLod.caps();
  MASS.caps = { full: o.fullcap || cp.full, promote: cp.promote };
  if (o.fullr) MASS.opt.fullr = o.fullr;
  if (!CBZ.battleInfantry) return false;
  MASS.on = true;
  MASS.total = 0;
  STORE.reserve(o.capHint || 256);
  MASS.ground = null; MASS.cover = null;
  MASS.I = MASS.T = CBZ.battleInfantry.create(STORE, { groundAt: o.groundAt || HOST.groundAt, seed: (lcg() * 0x7ffffffe) | 0 || 1 });
  MASS.unitOf = [];
  MASS.buildSquads();
  if (CBZ.massDraw) { CBZ.massDraw.capHint = o.capHint || 0; CBZ.massDraw.begin(); }
  return true;
};
function massAddRow(team, i, at, n) {
  const C = STORE.cols, s = team === "blue" ? 1 : 0;
  const u = massUnitType(team, i);
  const r = STORE.alloc(team, "man");
  const p = at || massPlace(team, i, n);
  C.x[r] = p.x; C.z[r] = p.z; C.y[r] = HOST.groundAt(p.x, p.z);
  C.heading[r] = spawnHeading(team, i);
  C.unit[r] = u.idx;
  C.squad[r] = massSquadId(team, (i / 10) | 0);
  STORE.col("spawnI", Int32Array)[r] = i;
  MASS.I.add(r, u.typ, C.squad[r], i % 10, s);
  C.tier[r] = 2;                                   // no rig until the lens comes
  ARMY[team].p0 += u.w; ARMY[team].men0++;
  MASS.rows++;
  return r;
}
MASS.spawnAll = function () {
  const n = Math.max(SET.redN, SET.blueN);
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < 2; s++) {
      const team = s ? "blue" : "red", N = s ? SET.blueN : SET.redN;
      if (i >= N) continue;
      if (massIsRow(team, i)) massAddRow(team, i, null, N);
      else spawnQueue.push([team, i]);          // the page's own: an animal, a hull and its crew, bare hands, a launcher
    }
  }
  spawnTotal = SET.redN + SET.blueN;
  spawnCount.red = SET.redN; spawnCount.blue = SET.blueN;
};
/* One booked segment of a side (spawn.js SPAWN_BOOK) onto the field: its
   riflemen as rows, everything else the page's own at once. Returns the rows. */
MASS.addRows = function (team, from, n) {
  if (!MASS.on) return [];
  const rows = [];
  STORE.reserve(STORE.rows + n + 16);
  for (let j = 0; j < n; j++) {
    const i = from + j;
    if (!massIsRow(team, i)) {
      const m = spawnOne(team, i);
      if (m && m.row != null) STORE.cols.squad[m.row] = massSquadId(team, m.sq);
      continue;
    }
    rows.push(massAddRow(team, i, HOST.spawnAt(team, i), n));
  }
  MASS.total += n;
  MASS.buildSquads();
  if (CBZ.massDraw && CBZ.massDraw.added) CBZ.massDraw.added(rows);
  return rows;
};
MASS.removeRows = function (rows) {
  if (!MASS.on) return;
  const C = STORE.cols;
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    const m = STORE.ref[r];
    if (m) { const k = men.indexOf(m); if (k >= 0) men.splice(k, 1); massDropObj(m); STORE.ref[r] = null; }
    MASS.ghosts.delete(r);
    C.life[r] = 3;
    STORE.free(r);
  }
  MASS.buildSquads();
  if (CBZ.massDraw) CBZ.massDraw.died();
};
/* A FORCE'S ORDER ON ITS ROWS: the squads they are in march on the order's
   point (an attack) or on the middle of their homes (hold, move, withdraw) */
const ORDER_K = { hold: 1, move: 2, attack: 3, withdraw: 4 };
MASS.orderRows = function (rows, order, homeOf) {
  if (!MASS.on || !MASS.I) return;
  const C = STORE.cols, k = order ? (ORDER_K[order.type] || 0) : 0;
  const acc = new Map();
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j], q = C.sqd ? C.sqd[r] : -1;
    if (q < 0) continue;
    let p = order && order.at ? order.at : null;
    if (homeOf && k && k !== 3) { const h = homeOf(r, C.spawnI[r]); if (h) p = h; }
    if (!p) continue;
    const a = acc.get(q) || { x: 0, z: 0, n: 0 };
    a.x += p.x; a.z += p.z; a.n++;
    acc.set(q, a);
  }
  acc.forEach(function (a, q) {
    MASS.I.squadOrder(q, k === 0 ? null : { kind: k === 3 ? "advance" : k === 2 ? "move" : "hold", x: a.x / a.n, z: a.z / a.n });
  });
};
MASS.rebuildSquads = function () { MASS.buildSquads(); };

/* ---------------------------------------------------------------- squads (what gets a rig) */
MASS.buildSquads = function () {
  const C = STORE.cols;
  let n = 0;
  for (let r = 0; r < STORE.rows; r++) if (C.squad[r] >= n && !(C.ext && C.ext[r])) n = C.squad[r] + 1;
  const mem = new Int32Array(n * 10).fill(-1), cnt = new Uint8Array(n);
  for (let r = 0; r < STORE.rows; r++) {
    const q = C.squad[r];
    if (q < 0 || C.life[r] === 0 || cnt[q] >= 10 || (C.ext && C.ext[r])) continue;
    mem[q * 10 + cnt[q]++] = r;
  }
  MASS.sq = { n: n, mem: mem, cnt: cnt, cx: new Float32Array(n), cz: new Float32Array(n), men: new Int32Array(n),
    tier: new Uint8Array(n).fill(2), want: new Uint8Array(n).fill(2), forced: new Uint8Array(n), hold: new Float32Array(n), building: new Uint8Array(n) };
};

/* ---------------------------------------------------------------- the host's bodies */
// what the core is told about one of the page's own bodies
function massExtOf(m) {
  const E = CBZ.battleInfantry.EXT;
  if (m.vehicle) {
    const ar = m.def && m.def.stats && m.def.stats.armour;
    const thin = ar ? Math.min(ar.front != null ? ar.front : 1e9, ar.side != null ? ar.side : 1e9, ar.rear != null ? ar.rear : 1e9) : 0;
    return { kind: E.vehicle, w: Math.max(m.vwid || 2.5, m.vlen || 5) * 0.75, h: m.vheight || 2.4, mm: thin < 1e9 ? thin : 0 };
  }
  if (m.beast) return { kind: E.beast, w: Math.max(0.4, m.bodyL || 1.6), h: Math.max(0.3, (m.bodyY0 || 0) + (m.bodyH || 1)), mm: 0 };
  return { kind: E.man, w: 0.5, h: 1.8, mm: 0 };
}
const _POST = { stand: 0, crouch: 1, rush: 0, prone: 2 };
// every page body's row, written before the core steps: where it is, how it stands, whether it lives
function massSyncExt() {
  const C = STORE.cols, I = MASS.I, E = MASS.ext;
  E.length = 0;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.puppet || m.row == null || m.row < 0) continue;
    const r = m.row;
    if (!C.ext[r]) { const x = massExtOf(m); I.addExt(r, m.team === "blue" ? 1 : 0, x.kind, x.w, x.h, x.mm); }
    E.push(r);
    C.x[r] = m.pos.x; C.y[r] = m.pos.y; C.z[r] = m.pos.z;
    C.heading[r] = m.vehicle ? (m.h || 0) : m.beast ? (Math.PI / 2 - (m.heading || 0)) : (m.yaw || 0);
    C.vx[r] = m._vx || 0; C.vz[r] = m._vz || 0;
    C.post[r] = m.beast || m.vehicle ? 0 : (m.downed ? 2 : (_POST[m.stance] || 0));
    C.life[r] = m.dead ? 4 : m.fled ? 3 : m.routed ? 2 : 1;
    C.down[r] = m.downed ? 1 : 0;
    C.hp[r] = m.hp;
    if (m.lastShotT > simT - 0.12) C.flashT[r] = m.lastShotT;
  }
  /* THE HOST'S OWN PEOPLE IN THIS WAR (HOST.targets: Gang City's player, for
     a side that is hostile to him): a row each, on the other side of the one
     hostile to him, so the core's men see him and shoot at him; their rounds
     come back through massExtHits into his own hurt. Not a target (nobody
     hostile, or dead): the row stands down (fled), and comes back when he is. */
  if (HOST.targets) {
    const H = MASS.hostRows || (MASS.hostRows = new Map());
    const seen = _hostSeen; seen.clear();
    ["red", "blue"].forEach(function (t, s) {
      _hostOut.length = 0;
      _hostAsk.team = t; _hostAsk.pos.x = teamCOM[t].x; _hostAsk.pos.z = teamCOM[t].z;
      try { HOST.targets(_hostAsk, 1e7, _hostOut, null); } catch (e) {}
      for (let k = 0; k < _hostOut.length; k += 2) {
        const a = _hostOut[k];
        if (!a || seen.has(a)) continue;
        seen.add(a);
        let r = H.get(a);
        if (r == null) { r = STORE.alloc(s ? "red" : "blue", "man"); H.set(a, r); STORE.ref[r] = a; a.row = r; }
        if (!C.ext[r]) I.addExt(r, s ? 0 : 1, CBZ.battleInfantry.EXT.man, 0.5, 1.8, 0);
        C.side[r] = s ? 0 : 1;
        C.x[r] = a.pos.x; C.y[r] = a.pos.y; C.z[r] = a.pos.z; C.heading[r] = a.yaw || 0;
        C.vx[r] = 0; C.vz[r] = 0; C.post[r] = a.stance === "crouch" ? 1 : 0; C.life[r] = a.dead ? 4 : 1; C.down[r] = 0;
        E.push(r);
      }
    });
    H.forEach(function (r, a) { if (!seen.has(a)) C.life[r] = 3; });
  }
  MASS.fullRows = E;
}
const _hostSeen = new Set(), _hostOut = [], _hostAsk = { team: "red", pos: { x: 0, y: 0, z: 0 }, yaw: 0, _brain: null };
/* THE ORDERS, on the core: a side advances on the enemy's middle, or holds */
let massOrderT = -9;
function massOrders(now) {
  if (!now && simT - massOrderT < 1) return;
  massOrderT = simT;
  const I = MASS.I;
  ["red", "blue"].forEach(function (t, s) {
    const f = teamCOM[t === "red" ? "blue" : "red"];
    const hold = ORDER[t] === "hold" && !HUNT[t];
    I.order[s] = { kind: hold ? "hold" : "advance", x: hold ? NaN : f.x, z: hold ? NaN : f.z };     // a held line holds where it stands
  });
}

/* ---------------------------------------------------------------- the step */
MASS.step = function (sdt) {
  const t0 = performance.now();
  massSyncExt();
  const t1 = performance.now();
  MASS.acc += sdt;
  // the core's own clock: fixed steps of DT, the page's sub-steps accumulated
  let k = 0;
  while (MASS.acc >= MASS.DT && k++ < 4) {
    MASS.acc -= MASS.DT;
    massOrders(false);
    // the army morale the page steps over every man (morale.js: CBZ.brain.morale), into the core
    for (let s = 0; s < 2; s++) { const A = ARMY[s ? "blue" : "red"]; if (A) { MASS.I.army[s].morale = A.morale; MASS.I.army[s].broken = !!A.broken; } }
    const I = MASS.I;
    const cp = CBZ.camera ? CBZ.camera.position : { x: HOST.cx, z: HOST.cz };
    I.camX = cp.x; I.camZ = cp.z; I.shotR = typeof document !== "undefined" ? 260 : 0;
    I.step(MASS.DT);
    MASS.lastStepT = simT;
    massEvents(I.events, I.nEv); I.nEv = 0;
    massExtHits(); I.nExt = 0;
    massShots(); I.nShot = 0;
  }
  if (MASS.acc > MASS.DT * 4) MASS.acc = 0;     // a machine that cannot keep up runs the battle slower, never coarser
  MASS.stats.ms.sync += t1 - t0; MASS.stats.ms.step += performance.now() - t1;
};

/* ---------------------------------------------------------------- what the core said */
let massShotN = 0;
const _mates7 = [];
function massEvents(E, n) {
  const t0 = performance.now();
  const C = STORE.cols, EV = CBZ.battleInfantry.EV;
  for (let i = 0; i < n; i++) {
    const ty = E[i * 4], a = E[i * 4 + 1] | 0, b = E[i * 4 + 2] | 0, v = E[i * 4 + 3];
    if (ty === EV.kill || ty === EV.down) {
      const team = C.side[a] ? "blue" : "red";
      const killer = b >= 0 ? (STORE.ref[b] || null) : null;
      if (ty === EV.kill) {
        DEADN[team] = (DEADN[team] || 0) + 1;
        const kt = b >= 0 ? (C.side[b] ? "blue" : "red") : (team === "red" ? "blue" : "red");
        if (kt !== team && stats[kt]) stats[kt].kills++;
        if (killer && !killer.dead) { killer.kills = (killer.kills || 0) + 1; if (killer.wid) gunLedger(killer.wid).kills++; }
        const g = MASS.ghosts.get(a);
        if (g) { g.dead = true; g.hp = 0; }
        if (CBZ.massDraw) CBZ.massDraw.died(a);
      }
      if (ARMY[team]) MO.deathShock(ARMY[team], (MASS.unitOf[C.unit[a]] || {}).w || 1);
      // the page's own men standing next to him felt it
      const near = fineNear(C.x[a], C.z[a], 7, _mates7);
      for (let k = 0; k < near.length; k++) {
        const o = near[k];
        if (o.dead || o.team !== team || o.beast || o.puppet) continue;
        o.supp = Math.min(SUPP_CAP, (o.supp || 0) + SUPP_MATE);
      }
      const m = STORE.ref[a];
      if (m && m.puppet) puppetFalls(m, ty === EV.kill, killer || (b >= 0 ? massGhost(b) : null));
    } else if (ty === EV.hit) {
      const m = STORE.ref[a];
      if (m && m.puppet && !m.dead && m.char && CBZ.soldier && CBZ.soldier.hit) {
        const by = b >= 0 ? STORE.ref[b] || { pos: { x: C.x[b], z: C.z[b] } } : null;
        let dx = 0, dz = 1;
        if (by) { dx = m.pos.x - by.pos.x; dz = m.pos.z - by.pos.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
        try { CBZ.soldier.hit(m.char, { sev: Math.min(1, v * 1.6 + 0.15), dirX: dx, dirZ: dz }); } catch (e) {}
      }
    } else if (ty === EV.crack) {
      const m = STORE.ref[a];
      if (m && !m.puppet && !m.dead && !m.beast) {
        m.supp = Math.min(SUPP_CAP, (m.supp || 0) + SUPP_SNAP * (0.45 + 0.8 * v));
        if (CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(m, 0.4 + 0.4 * v);
      }
    } else if (ty === EV.fled) {
      const team = C.side[a] ? "blue" : "red";
      ARMY[team].fled++;
      const g = MASS.ghosts.get(a);
      if (g) g.fled = true;
      const m = STORE.ref[a];
      if (m && m.puppet) { m.fled = true; m.group.visible = false; }
      if (CBZ.massDraw) CBZ.massDraw.gone(a);
    } else if (ty === EV.rout) {
      const m = STORE.ref[a];
      if (m && m.puppet) m.routed = true;
    }
  }
  MASS.stats.ms.events += performance.now() - t0;
}
MASS.events = massEvents;
/* THE CORE'S ROUNDS THAT REACHED ONE OF OUR BODIES: flown into him here,
   with fire.js's own anatomy, plates and hull armour (traceBody, armsHit) */
const _xr = { by: null, team: "red", tgt: null, A: null, c: null, v0: 0, k: 0, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0, hk: 1, sT: 0,
  l1: Infinity, l1k: 1, l2: Infinity, l2k: 1, tracer: false };
function massExtHits() {
  const I = MASS.I, E = I.extHits, n = I.nExt, F = I.EXT_F, C = STORE.cols;
  for (let k = 0; k < n; k++) {
    const q = k * F;
    const u = STORE.ref[E[q] | 0];
    if (!u || u.dead || u.fled || u.puppet) continue;
    const sh = E[q + 1] | 0, typ = E[q + 10] | 0;
    const t = I.types[typ];
    if (!t) continue;
    const r = _xr;
    r.by = sh >= 0 ? (STORE.ref[sh] || massGhost(sh)) : null;
    r.team = sh >= 0 ? (C.side[sh] ? "blue" : "red") : (u.team === "red" ? "blue" : "red");
    r.c = t.c; r.v0 = t.v0; r.k = t.k; r.A = null;
    r.ox = E[q + 2]; r.oy = E[q + 3]; r.oz = E[q + 4]; r.dx = E[q + 5]; r.dy = E[q + 6]; r.dz = E[q + 7];
    r.hk = Math.hypot(r.dx, r.dz) || 1; r.sT = E[q + 8] + 40; r.l1 = r.l2 = Infinity; r.l1k = r.l2k = 1;
    r.tgt = u;
    const s0 = E[q + 8];
    if (!traceBody(u, r, s0)) continue;
    armsHit(r, u, E[q + 9]);
  }
}
/* THE ROUNDS ON SCREEN: the line each was flown on, to where it stopped,
   drawn at its real speed (fire.js stepRounds draws the page's own the same
   way). The muzzle flash and the report at the shooter; the strike where it
   stopped. */
function massShots() {
  const I = MASS.I, S = I.shots, n = I.nShot, F = CBZ.battleInfantry.SHOT_F;
  const cam = CBZ.camera && CBZ.camera.position;
  for (let k = 0; k < n; k++) {
    const q = k * F;
    const sh = S[q] | 0, typ = S[q + 10] | 0, t = I.types[typ];
    if (!t) continue;
    const ox = S[q + 1], oy = S[q + 2], oz = S[q + 3], dx = S[q + 4], dy = S[q + 5], dz = S[q + 6], stop = S[q + 7];
    const tracer = S[q + 12] >= 100;
    const V = MASS.vis;
    if (V.length < 900) V.push({ ox: ox, oy: oy, oz: oz, dx: dx, dy: dy, dz: dz, hk: Math.hypot(dx, dz) || 1, v0: S[q + 8], k: S[q + 9], stop: stop,
      t0: MASS.lastStepT - MASS.DT, tracer: tracer, c: t.c, mat: S[q + 12] % 100 | 0, hit: S[q + 11] | 0, landed: false });
    // the shooter: his rig fires (the flash, the smoke, the report, his shoulder) or, past the rigs, the flash where he lies
    const m = STORE.ref[sh];
    if ((massShotN++ & 7) === 0) {
      if (shotsRing.length > 90) shotsRing.shift();
      shotsRing.push({ x: ox, z: oz, t: simT, m: m || null });
    }
    if (QUAL.firstShotT < 0) QUAL.firstShotT = Math.round(simT * 10) / 10;
    stats[STORE.cols.side[sh] ? "blue" : "red"].shots++;
    if (cam) {
      const d2 = (ox - cam.x) * (ox - cam.x) + (oz - cam.z) * (oz - cam.z);
      if (m && m.puppet && !m.dead) {
        m.lastShotT = simT; m.shotsF = (m.shotsF || 0) + 1;
        const w = CBZ.weaponById ? CBZ.weaponById(m.wid) : null;
        const A = armOf(m);
        let from = d2 < 130 * 130 && CBZ.actorMuzzle ? CBZ.actorMuzzle(m, _muz) : null;
        if (!from) from = _muz.set(ox, oy, oz);
        try { armsMuzzle(m, A, w, from, dx / (Math.hypot(dx, dz) || 1), dz / (Math.hypot(dx, dz) || 1), d2); } catch (e) {}
      } else if (d2 < 240 * 240 && CBZ.tracer && fxBudget < 26) {
        fxBudget++;
        _evV.set(ox, oy, oz); _evW.set(ox + dx * 1.2, oy + dy * 1.2, oz + dz * 1.2);
        try { CBZ.tracer(_evV, _evW, { muzzle: true, muzzleScale: 0.9, weapon: t.gunId, hit: false, streak: false }); } catch (e) {}
      }
    }
  }
}
let _evV = null, _evW = null;
CBZ.npcwar.onBoot(function () { _evV = V(); _evW = V(); });
// the rounds in the air, drawn on the frame (and the strike when one lands)
function massDrawRounds(dt) {
  const L = MASS.vis;
  if (!L.length) return;
  const B = CBZ.ballistics, cam = CBZ.camera && CBZ.camera.position;
  for (let i = L.length - 1; i >= 0; i--) {
    const r = L[i];
    const t = simT - r.t0;
    let s = (r.k > 1e-4 ? (r.v0 / r.k) * (1 - Math.exp(-r.k * t)) : r.v0 * t) / r.hk;
    if (s >= r.stop) {
      s = r.stop;
      if (!r.landed) {
        r.landed = true;
        // where it stopped: the ground's own puff, a wall's, a man's (the hit is the wound's own gore)
        if (r.hit < 0 && cam) {
          const x = r.ox + r.dx * s, y = r.oy + r.dy * s, z = r.oz + r.dz * s;
          const mat = r.mat > 0 ? COVER_MATS[r.mat] || "concrete" : groundMatAt();
          try { armsImpactAt(x, Math.max(y, HOST.groundAt(x, z)), z, 0, 1, 0, mat, r.c, B.vAt(r.v0, r.k, s * r.hk), false); } catch (e) {}
        }
      }
    }
    if (cam && CBZ.roundStreak) {
      const v = B.vAt(r.v0, r.k, s * r.hk);
      const tail = Math.max(0, s - (r.tracer ? Math.min(14, v * 0.016) : Math.min(8, Math.max(2.5, v * 0.011))));
      if (s > tail + 0.2) {
        const hx = r.ox + r.dx * s, hz = r.oz + r.dz * s;
        const dc2 = (hx - cam.x) * (hx - cam.x) + (hz - cam.z) * (hz - cam.z);
        if (r.tracer ? dc2 < 900 * 900 : dc2 < 110 * 110) {
          CBZ.roundStreak(r.ox + r.dx * tail, r.oy + r.dy * tail, r.oz + r.dz * tail, hx, r.oy + r.dy * s, hz, r.tracer, r.c.tracer || 0xff6a30, r.c.mm, dt);
        }
      }
    }
    if (r.landed && t > 0.05 + r.stop * r.hk / Math.max(60, r.v0)) { L[i] = L[L.length - 1]; L.pop(); }
  }
}

/* ---------------------------------------------------------------- the seam: the page's hits on our men */
// a round from the page's world (fire.js resolveRound) through the rows; returns where one stopped it
MASS.traceRows = function (r, sMax) {
  if (!MASS.on || !MASS.I || !r.c) return sMax;
  const by = r.by && r.by.row != null ? r.by.row : -1;
  return MASS.I.traceRound(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, r.v0, r.k, r.c, sMax, by, r.team === "blue" ? 1 : 0);
};
// a bite, a crush, a blow on a man of the core (damage.js hurtMan): a wound, in his capacity
function massHurtRow(r, dmg, imp) {
  if (!MASS.on || !MASS.I) return;
  // a blast reaches the rows through MASS.blast (both hosts call it after their own
  // sweep of bodies), never twice through a rig
  if (imp && (imp.cause === "explosion" || imp.cause === "bomb" || imp.blast)) return;
  const by = imp && imp.by && imp.by.row != null ? imp.by.row : -1;
  const now = Math.min(2, dmg / 100);
  MASS.I.wound(r, now, now > 0.25 ? now * 0.01 : 0, by);
  const m = STORE.ref[r];
  if (m && m.puppet) m.hp = STORE.cols.hp[r];
  massEvents(MASS.I.events, MASS.I.nEv); MASS.I.nEv = 0;
}
MASS.hurtGhost = function (g, dmg, imp) { if (!g.dead && !g.fled && !over) massHurtRow(g.row, dmg, imp); };
MASS.hurtPuppet = function (m, dmg, imp) { if (!m.dead && !m.fled && !over) massHurtRow(m.row, dmg, imp); };

/* ---------------------------------------------------------------- the counts (morale, the win check, the HUD) */
MASS.count = function (fresh) {
  const C = STORE.cols, K = MASS.cnt;
  if (!fresh && K.at === simT) return K;
  const LF = C.life, SD = C.side, X = C.x, Z = C.z, KD = C.kind, DN = C.down, UN = C.unit, CP = C.cap;
  let a0 = 0, a1 = 0, f0 = 0, f1 = 0, r0 = 0, r1 = 0, b0 = 0, b1 = 0, p0 = 0, p1 = 0;
  let cx0 = 0, cz0 = 0, cx1 = 0, cz1 = 0, ax0 = 0, az0 = 0, ax1 = 0, az1 = 0;
  for (let r = 0, n = STORE.rows; r < n; r++) {
    const l = LF[r];
    if (l !== 1 && l !== 2) continue;
    const x = X[r], z = Z[r];
    const own = !(C.ext && C.ext[r]);
    const u = own ? MASS.unitOf[UN[r]] : null;
    const w = u ? u.w : 1;
    const p = DN && DN[r] ? 0 : w * (0.45 + 0.55 * Math.max(0, Math.min(1, CP ? CP[r] : 1)));
    const fighting = l === 1 && !(DN && DN[r]);
    if (SD[r] === 0) {
      a0++; ax0 += x; az0 += z; p0 += p;
      if (l === 2) r0++; else if (fighting) { f0++; cx0 += x; cz0 += z; }
      if (KD[r] !== 0) b0++;
    } else {
      a1++; ax1 += x; az1 += z; p1 += p;
      if (l === 2) r1++; else if (fighting) { f1++; cx1 += x; cz1 += z; }
      if (KD[r] !== 0) b1++;
    }
  }
  K.alive[0] = a0; K.alive[1] = a1; K.fighting[0] = f0; K.fighting[1] = f1; K.routing[0] = r0; K.routing[1] = r1;
  K.beasts[0] = b0; K.beasts[1] = b1; K.pNow[0] = p0; K.pNow[1] = p1;
  K.cx[0] = cx0; K.cz[0] = cz0; K.cx[1] = cx1; K.cz[1] = cz1; K.ax[0] = ax0; K.az[0] = az0; K.ax[1] = ax1; K.az[1] = az1;
  K.at = simT;
  return K;
};
MASS.armies = function () {
  const K = MASS.count();
  ["red", "blue"].forEach(function (t, s) {
    const A = ARMY[t];
    A.alive = K.fighting[s] + K.routing[s]; A.routing = K.routing[s]; A.pNow = K.pNow[s]; A.beasts = K.beasts[s];
  });
};
MASS.com = function () {
  const K = MASS.count();
  ["red", "blue"].forEach(function (t, s) {
    if (K.fighting[s]) { teamCOM[t].x = K.cx[s] / K.fighting[s]; teamCOM[t].z = K.cz[s] / K.fighting[s]; }
    else if (K.alive[s]) { teamCOM[t].x = K.ax[s] / K.alive[s]; teamCOM[t].z = K.az[s] / K.alive[s]; }
  });
  return { red: K.fighting[0], blue: K.fighting[1], liveRed: K.alive[0], liveBlue: K.alive[1] };
};
MASS.inFight = function (team) {
  const s = team === "red" ? 0 : 1, K = MASS.count();
  const A = ARMY[team];
  if (!K.fighting[s] && K.alive[s] && A && A.noFightT >= BREAK_GRACE) return 0;
  return K.fighting[s] || (K.routing[s] && !(A && A.noFightT >= BREAK_GRACE) ? K.routing[s] : 0);
};
MASS.aliveCount = function (team) { const K = MASS.count(); const s = team === "red" ? 0 : 1; return K.fighting[s] + K.routing[s]; };
MASS.seedNav = function (team, seed) {
  const C = STORE.cols, sd = team === "red" ? 0 : 1;
  for (let r = 0, n = STORE.rows; r < n; r++) {
    if (C.side[r] === sd || C.life[r] !== 1 || (C.ext && C.ext[r])) continue;
    seed(C.x[r], C.z[r]);
  }
};

/* ---------------------------------------------------------------- ghosts (rows the page's brains aim at) */
function massGhost(r) {
  let g = MASS.ghosts.get(r);
  if (g) return g;
  const C = STORE.cols, team = C.side[r] ? "blue" : "red";
  const u = MASS.unitOf[C.unit[r]] || {};
  g = {
    ghost: true, row: r, team: team, i: C.spawnI ? C.spawnI[r] : 0, id: team + (C.spawnI ? C.spawnI[r] : r), sq: C.squad[r],
    pos: new THREE.Vector3(C.x[r], C.y[r], C.z[r]), yaw: C.heading[r], heading: C.heading[r],
    hp: C.hp[r], maxHp: 100, dead: C.life[r] === 4, fled: C.life[r] === 3, routed: C.life[r] === 2,
    speed: 0, coverK: 1, eyeH: 1.52, losY: 1.35, aimY: 1.28, headY: 1.62, rad: 0.45, stance: "stand",
    armed: true, weapon: u.wid ? GUN_NAME[u.wid] : null, wid: u.wid || null, tier: u.tr || "pro",
    beast: false, vehicle: false, air: false, supp: 0, kills: 0, used: simT,
  };
  MASS.ghosts.set(r, g);
  MASS.stats.ghosts++;
  return g;
}
MASS.ghost = massGhost;
const _GPOST = ["stand", "crouch", "prone"];
function massGhostSync() {
  const C = STORE.cols;
  MASS.ghosts.forEach(function (g, r) {
    g.pos.x = C.x[r]; g.pos.y = C.y[r]; g.pos.z = C.z[r];
    g.yaw = g.heading = C.heading[r];
    g.hp = C.hp[r];
    const l = C.life[r];
    g.dead = l === 4; g.fled = l === 3; g.routed = l === 2; g.downed = !!C.down[r];
    g.speed = Math.hypot(C.vx[r], C.vz[r]); g._vx = C.vx[r]; g._vz = C.vz[r];
    const p = C.post[r];
    g.stance = _GPOST[p] || "stand";
    g.eyeH = p === 2 ? 0.33 : p === 1 ? 1.05 : 1.52; g.losY = p === 2 ? 0.25 : p === 1 ? 0.87 : 1.35;
    g.aimY = p === 2 ? 0.22 : p === 1 ? 0.8 : 1.28; g.headY = p === 2 ? 0.3 : p === 1 ? 1.08 : 1.62;
  });
}
// pickTarget (physics.js): rows a page brain could have noticed, as ghosts
let _mcG = null;
/* every fighting row of the core without a rig, by side, in 32 m cells
   (rebuilt every 0.35 s); a page brain's search walks it ring by ring
   outward, or, for a reach of kilometres (a rocket battery), the occupied
   cells themselves */
const MC = 32;
function mcKey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }
MASS.cands = function (m, range, out, spot) {
  if (!_mcG || simT - _mcG.at > 0.35) massCandGrid();
  const sd = m.team === "red" ? 1 : 0, cells = _mcG.side[sd], C = STORE.cols;
  const cx = Math.floor(m.pos.x / MC), cz = Math.floor(m.pos.z / MC), R = Math.ceil(range / MC);
  const r2 = range * range;
  let found = 0;
  const visit = function (a) {
    for (let i = 0; i < a.length && found < 24; i++) {
      const r = a[i];
      if ((C.life[r] !== 1 && C.life[r] !== 2) || STORE.ref[r]) continue;
      const ox = C.x[r] - m.pos.x, oz = C.z[r] - m.pos.z, d2 = ox * ox + oz * oz;
      if (d2 > r2) continue;
      const g = massGhost(r);
      if (CBZ.brain.perception.sees(m, g, spot)) { out.push(g, d2); found++; g.used = simT; }
    }
  };
  if ((2 * R + 1) * (2 * R + 1) > cells.size * 2) { cells.forEach(visit); return; }
  for (let ring = 0; ring <= R && found < 24; ring++) {
    for (let dz = -ring; dz <= ring; dz++) {
      const edge = dz === -ring || dz === ring, step = edge ? 1 : Math.max(1, 2 * ring);
      for (let dx = -ring; dx <= ring; dx += step) { const a = cells.get(mcKey(cx + dx, cz + dz)); if (a) visit(a); if (!ring) break; }
    }
  }
};
function massCandGrid() {
  const C = STORE.cols;
  const S = _mcG ? _mcG.side : [new Map(), new Map()];
  S[0].forEach(function (a) { a.length = 0; }); S[1].forEach(function (a) { a.length = 0; });
  for (let r = 0, n = STORE.rows; r < n; r++) {
    if (STORE.ref[r] || C.life[r] !== 1 || C.ext[r] || C.down[r]) continue;
    const k = mcKey(Math.floor(C.x[r] / MC), Math.floor(C.z[r] / MC)), M = S[C.side[r]];
    let a = M.get(k);
    if (!a) { a = []; M.set(k, a); }
    a.push(r);
  }
  _mcG = { side: S, at: simT };
}
// the nearest k fighting rows of a side to a point, as (ghost, d2) pairs (a hull's search)
MASS.nearRows = function (team, x, z, range, out, k) {
  if (!_mcG || simT - _mcG.at > 0.35) massCandGrid();
  const cells = _mcG.side[team === "red" ? 0 : 1], C = STORE.cols;
  const cx = Math.floor(x / MC), cz = Math.floor(z / MC), R = Math.ceil(range / MC), r2 = range * range;
  let found = 0;
  const visit = function (a) {
    for (let i = 0; i < a.length; i++) {
      const r = a[i];
      if (C.life[r] !== 1 || STORE.ref[r]) continue;
      const d2 = (C.x[r] - x) * (C.x[r] - x) + (C.z[r] - z) * (C.z[r] - z);
      if (d2 > r2) continue;
      out.push(massGhost(r), d2); found++;
    }
  };
  if ((2 * R + 1) * (2 * R + 1) > cells.size * 2) { cells.forEach(visit); return; }
  for (let ring = 0; ring <= R && found < k; ring++) {
    for (let dz = -ring; dz <= ring; dz++) {
      const edge = dz === -ring || dz === ring, step = edge ? 1 : Math.max(1, 2 * ring);
      for (let dx = -ring; dx <= ring; dx += step) { const a = cells.get(mcKey(cx + dx, cz + dz)); if (a) visit(a); if (!ring) break; }
    }
  }
};
// the densest knot of a side's men (the air's aim point, air.js densestCellOf): rows and rigs alike
MASS.densest = function (team) {
  if (!_mcG || simT - _mcG.at > 0.35) massCandGrid();
  const C = STORE.cols;
  let best = null, bn = 0;
  _mcG.side[team === "red" ? 0 : 1].forEach(function (a) {
    let n = 0, x = 0, z = 0;
    for (let i = 0; i < a.length; i++) { const r = a[i]; if (C.life[r] !== 1) continue; n++; x += C.x[r]; z += C.z[r]; }
    if (n > bn) { bn = n; best = { x: x / n, z: z / n, n: n }; }
  });
  return best;
};

/* ---------------------------------------------------------------- the puppets */
/* A RIG THAT SHOWS ITS ROW. Built inside a per-frame budget (a rig costs
   milliseconds), hidden, and the whole squad shown on one frame. Each frame
   it is put where the row is (carried along its velocity since the core's
   last step), faced as it faces, in its posture; its rifle is laid on the
   row's mark; it fires when the row fires (massShots), flinches when the row
   is hit, falls when the row falls (puppetFalls). */
const _PSTANCE = ["stand", "crouch", "prone"];
function puppetSync(m, dt) {
  const C = STORE.cols, r = m.row;
  if (m.dead) return;
  const age = Math.max(0, Math.min(0.15, simT - (MASS.lastStepT || simT)));
  const x = C.x[r] + C.vx[r] * age, z = C.z[r] + C.vz[r] * age;
  m.speed = Math.hypot(C.vx[r], C.vz[r]);
  m.pos.set(x, HOST.bodyY ? HOST.bodyY(m, x, z) : C.y[r], z);
  // facing: his path while he moves, his mark while he fights
  const tg = C.tgt[r];
  let want = C.heading[r];
  if (m.speed < 0.2) want = C.face[r];
  if (tg >= 0 && m.speed < 0.2) want = Math.atan2(C.x[tg] - x, C.z[tg] - z);
  let d = want - m.yaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  m.yaw += d * Math.min(1, dt * 8);
  m.group.rotation.y = m.yaw;
  const p = C.postT[r] > 0 ? C.postTo[r] : C.post[r];
  const st = C.down[r] ? "prone" : (m.speed > 3.0 && p === 0 ? "rush" : _PSTANCE[p] || "stand");
  if (m.stance !== st) setStance(m, st === "rush" ? "stand" : st);
  m.stance = st;
  m.downed = !!C.down[r];
  m.routed = C.life[r] === 2;
  m.hp = C.hp[r];
  m.mag = C.mag[r]; m.reloadT = C.reloadT[r];
  // his mark, for the rifle's aim (animFrame lays it on with actorAimAt)
  m.tgt = tg >= 0 ? (STORE.ref[tg] || massGhost(tg)) : null;
  m.sees = tg >= 0 && C.expo[r] > 0;
  m.slot = m.speed > 0.3 ? "move" : "fire";
  m.inCover = false;
  if (C.reloadT[r] > 0 && !m._rel && m.char && CBZ.soldier && CBZ.soldier.reload) {
    m._rel = true;
    try { CBZ.soldier.reload(m.char, { dur: Math.min(3, C.reloadT[r]) }); } catch (e) {}
  } else if (C.reloadT[r] <= 0) m._rel = false;
}
function puppetFalls(m, dead, by) {
  if (m.dead) return;
  if (!dead) { m.downed = true; setStance(m, "prone"); return; }
  // the page's death: the rig's own sprawl, the ragdoll, the rifle on the ground, the kill cam
  killMan(m, { by: by, core: true });
}
function massBuild() {
  const Q2 = MASS.sq, C = STORE.cols;
  const lim = performance.now() + MASS.promoteMs;
  let squads = 0;
  while (MASS.pending.length && squads < MASS.caps.promote * 2) {
    const q = MASS.pending[0];
    if (Q2.want[q] !== 0 || Q2.tier[q] === 0) { massAbandon(q); MASS.pending.shift(); Q2.building[q] = 0; continue; }
    let done = true;
    for (let j = 0; j < Q2.cnt[q]; j++) {
      const r = Q2.mem[q * 10 + j];
      const l = C.life[r];
      if ((l !== 1 && l !== 2) || STORE.ref[r]) continue;
      if (performance.now() > lim) { done = false; break; }
      const m = massMakeObj(r);
      if (m) { STORE.ref[r] = m; m.group.visible = false; m._massWait = true; }
    }
    if (!done) break;
    massPromote(q);
    MASS.pending.shift(); Q2.building[q] = 0; squads++;
  }
}
function massAbandon(q) {
  const Q2 = MASS.sq, C = STORE.cols;
  for (let j = 0; j < Q2.cnt[q]; j++) {
    const r = Q2.mem[q * 10 + j];
    const m = STORE.ref[r];
    if (m && m._massWait && C.tier[r] !== 0) { massDropObj(m); STORE.ref[r] = null; }
  }
}
function massMakeObj(r) {
  const C = STORE.cols, team = C.side[r] ? "blue" : "red", i = C.spawnI[r];
  const m = makeMan(team, i);
  if (!m) return null;
  // the rig is a picture of the row: out of every brain the page runs
  const L = squads[team] && squads[team][m.sq];
  if (L) { const k = L.indexOf(m); if (k >= 0) L.splice(k, 1); }
  m.puppet = true;
  return m;
}
function massPromote(q) {
  const Q2 = MASS.sq, C = STORE.cols;
  for (let j = 0; j < Q2.cnt[q]; j++) {
    const r = Q2.mem[q * 10 + j];
    const l = C.life[r];
    const m = STORE.ref[r];
    if (!m || (l !== 1 && l !== 2)) { if (m && m._massWait) { massDropObj(m); STORE.ref[r] = null; } continue; }
    m._massWait = false;
    m.row = r;
    m.yaw = C.heading[r]; m.group.rotation.y = m.yaw;
    m._mc = 1; m._mw = (MASS.unitOf[C.unit[r]] || {}).w || 1;
    puppetSync(m, 1);
    if (CBZ.massDraw) CBZ.massDraw.handoff(r, m, true);
    m.group.visible = true;
    C.tier[r] = 0;
    men.push(m);
    const g = MASS.ghosts.get(r);
    if (g) {
      for (let k = 0; k < men.length; k++) if (men[k].tgt === g) men[k].tgt = m;
      MASS.ghosts.delete(r);
    }
    MASS.stats.promoted++;
  }
  Q2.tier[q] = 0;
}
function massDemote(q, w) {
  const Q2 = MASS.sq, C = STORE.cols;
  for (let j = 0; j < Q2.cnt[q]; j++) {
    const r = Q2.mem[q * 10 + j];
    const m = STORE.ref[r];
    if (C.tier[r] !== 0) continue;
    if (!m) { C.tier[r] = w; continue; }
    if (m.dead) continue;                // the dead keep their rig where they fell
    if (m.you || (typeof STUDY !== "undefined" && STUDY.m === m)) continue;
    C.tier[r] = w;
    if (CBZ.massDraw) CBZ.massDraw.handoff(r, m, false);
    const k = men.indexOf(m);
    if (k >= 0) men.splice(k, 1);
    let g = null;
    for (let i = 0; i < men.length; i++) if (men[i].tgt === m) men[i].tgt = g || (g = massGhost(r));
    massDropObj(m);
    STORE.ref[r] = null;
    MASS.stats.demoted++;
  }
  Q2.tier[q] = w;
}
function massDropObj(m) {
  const sq = squads[m.team] && squads[m.team][m.sq];
  if (sq) { const k = sq.indexOf(m); if (k >= 0) sq.splice(k, 1); }
  if (m.ordTgt) {
    m.ordTgt.alive = false;
    if (CBZ.ordnance && CBZ.ordnance.removeTarget) { try { CBZ.ordnance.removeTarget(m.ordTgt); } catch (e) {} }
    m.ordTgt = null;
  }
  if (m.group) {
    if (m.group.parent) m.group.parent.remove(m.group);
    try { STUDIO.drop(m.group); } catch (e) {}
  }
}
function massSchedule(dt) {
  const Q2 = MASS.sq, C = STORE.cols;
  if (!Q2) return;
  Q2.forced.fill(0);
  if (typeof STUDY !== "undefined" && STUDY.m && STUDY.m.row != null) { const q = C.squad[STUDY.m.row]; if (q >= 0 && q < Q2.n) Q2.forced[q] = 1; }
  if (typeof YOU !== "undefined" && YOU.m && YOU.m.row != null) { const q = C.squad[YOU.m.row]; if (q >= 0 && q < Q2.n) Q2.forced[q] = 1; }
  for (let q = 0; q < Q2.n; q++) {
    let x = 0, z = 0, k = 0;
    for (let j = 0; j < Q2.cnt[q]; j++) {
      const r = Q2.mem[q * 10 + j], l = C.life[r];
      if (l !== 1 && l !== 2) continue;
      x += C.x[r]; z += C.z[r]; k++;
    }
    Q2.men[q] = k;
    if (k) { Q2.cx[q] = x / k; Q2.cz[q] = z / k; }
  }
  const cp = CBZ.camera ? CBZ.camera.position : { x: HOST.cx, z: HOST.cz };
  CBZ.battleLod.schedule(Q2, cp.x, cp.z, dt, { full: MASS.caps.full, mid: 0 }, { fullR: MASS.opt.fullr || 0, midR: 1 });
  for (let q = 0; q < Q2.n; q++) {
    let w = Q2.want[q] === 0 ? 0 : 2;
    const cur = Q2.tier[q];
    if (w === cur || !Q2.men[q]) { if (w === cur) Q2.building[q] = 0; continue; }
    if (w === 0) { if (!Q2.building[q]) { Q2.building[q] = 1; MASS.pending.push(q); } }
    else if (cur === 0) massDemote(q, w);
    else Q2.tier[q] = w;
  }
}

/* ---------------------------------------------------------------- each frame */
MASS.frame = function (dt) {
  if (!MASS.on) return;
  const t0 = performance.now();
  MASS.count(true);
  massGhostSync();
  MASS.ghostSweepT -= dt;
  if (MASS.ghostSweepT <= 0) {
    MASS.ghostSweepT = 2;
    const used = new Set();
    for (let i = 0; i < men.length; i++) { const t = men[i].tgt; if (t && t.ghost) used.add(t); }
    MASS.ghosts.forEach(function (g, r) { if (!used.has(g) && simT - g.used > 4) MASS.ghosts.delete(r); });
  }
  if (simT - MASS.schedAt >= 0.25 || MASS.schedAt < 0) { MASS.schedAt = simT; massSchedule(0.25); }
  massBuild();
  for (let i = 0; i < men.length; i++) { const m = men[i]; if (m.puppet) puppetSync(m, dt); }
  massDrawRounds(dt);
  const t1 = performance.now();
  MASS.stats.ms.sched += t1 - t0;
  if (CBZ.massDraw) CBZ.massDraw.frame(dt);
  MASS.stats.ms.draw += performance.now() - t1;
};

/* ---------------------------------------------------------------- YOU (player.js) */
// YOU take a man of the core: his rig becomes the page's own man; his row an external body
MASS.release = function (m) {
  if (!MASS.on || !m || !m.puppet || m.row == null) return;
  MASS.I.release(m.row);
  m.puppet = false; m._coreMan = true;
  // the page's man needs his squad list back (the page brain reads it while he is not you)
  const L = squads[m.team] && (squads[m.team][m.sq] = squads[m.team][m.sq] || []);
  if (L && L.indexOf(m) < 0) L.push(m);
  m.hp = Math.max(1, STORE.cols.cap[m.row] * 100); m.maxHp = 100;
  m.mag = STORE.cols.mag[m.row];
};
// and hand him back: the core picks him up where you left him
MASS.adopt = function (m) {
  if (!MASS.on || !m || m.row == null || m.dead || m.fled) return;
  const C = STORE.cols, r = m.row;
  C.x[r] = m.pos.x; C.y[r] = m.pos.y; C.z[r] = m.pos.z;
  C.cap[r] = Math.max(0.05, (m.hp || 0) / (m.maxHp || 100)); C.hp[r] = C.cap[r] * 100;
  C.mag[r] = m.mag || 0;
  MASS.I.adopt(r);
  m.puppet = true; m._coreMan = false;
  const L = squads[m.team] && squads[m.team][m.sq];
  if (L) { const k = L.indexOf(m); if (k >= 0) L.splice(k, 1); }
};
// the man of a side nearest a point, with a rig made for him now (the rifle button)
MASS.takeRow = function (team, x, z) {
  if (!MASS.on) return null;
  const C = STORE.cols, sd = team === "blue" ? 1 : 0;
  let best = -1, bd = 1e18;
  for (let r = 0; r < STORE.rows; r++) {
    if (C.side[r] !== sd || C.life[r] !== 1 || C.down[r] || C.ext[r]) continue;
    const d = (C.x[r] - x) * (C.x[r] - x) + (C.z[r] - z) * (C.z[r] - z);
    if (d < bd) { bd = d; best = r; }
  }
  if (best < 0) return null;
  let m = STORE.ref[best];
  if (m && m.puppet) return m;
  m = massMakeObj(best);
  if (!m) return null;
  STORE.ref[best] = m; m.row = best; m._mc = 1; m._mw = (MASS.unitOf[C.unit[best]] || {}).w || 1;
  m.yaw = C.heading[best]; m.group.rotation.y = m.yaw;
  puppetSync(m, 1);
  C.tier[best] = 0;
  men.push(m);
  const q = C.squad[best];
  if (MASS.sq && q >= 0 && q < MASS.sq.n) MASS.sq.tier[q] = 0;
  return m;
};

/* ---------------------------------------------------------------- blasts */
/* A BLAST REACHES THE ROWS TOO, by the core's own rule (the charge's
   overpressure at the man's scaled distance, the fragments by the area he
   shows: a man flat on the ground presents a third of a standing one). The
   charge is the munition's (R is its radius; W is solved back from it when
   the boom names no charge). */
MASS.blast = function (x, z, R, by, W) {
  if (!MASS.on || !MASS.I) return;
  const w = W > 0 ? W : 0.18 * Math.pow(Math.max(1, R) / 12, 3);
  MASS.I.hurt({ kind: "blast", x: x, z: z, W: w, by: by && by.row != null ? by.row : -1 });
  MASS.lastBlast = { t: simT, x: x, z: z, R: 12 * Math.cbrt(w / 0.18) };
  massEvents(MASS.I.events, MASS.I.nEv); MASS.I.nEv = 0;
};
CBZ.npcwar.onBoot(function () {
  const boom = STUDIO && STUDIO.boom;
  if (boom && !boom._mass) {
    STUDIO.boom = function (p, o) {
      const res = boom.apply(this, arguments);
      try { if (MASS.on && p) MASS.blast(p.x, p.z, (res && res.R) || (o && o.radius) || 6, o && o.by, (res && res.W) || (o && o.W) || 0); } catch (e) {}
      return res;
    };
    STUDIO.boom._mass = true;
  }
});
/* the probe's view */
MASS.audit = function () {
  if (!MASS.on) return { on: false };
  const C = STORE.cols;
  let rigs = 0, rows = 0, ext = 0;
  for (let r = 0; r < STORE.rows; r++) {
    if (C.life[r] !== 1 && C.life[r] !== 2) continue;
    if (C.ext[r]) ext++; else { rows++; if (C.tier[r] === 0) rigs++; }
  }
  return { on: true, rows: MASS.rows, alive: rows, rigs: rigs, ext: ext, tiers: { full: rigs, mid: 0, far: rows - rigs },
    caps: MASS.caps, ghosts: MASS.ghosts.size, stats: MASS.stats, simMs: MASS.I ? MASS.I.ms : null, core: MASS.I ? MASS.I.audit() : null };
};
