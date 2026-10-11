"use strict";
/* src/battle/mass.js — NPC War: THE MASS. A battle bigger than the full rigs
   this device can carry is fought in tiers (docs/npcwar/ARCHITECTURE.md §9):

     FULL  the squads nearest the lens: a real makeMan / makeBeast object, the
           page's own brain (think.js, step.js, fire.js), exactly as always
     MID   rows in the unit store driven by core/tiersim.js's individual brain
     FAR   rows driven by tiersim's squad brain

   This file is the host half: it spawns the rows, keeps the FULL rows in the
   store current, runs the tier sim (in the page, or in the sim worker through
   core/simlink.js), lands the tier sim's rounds on FULL men through the one
   damage funnel (hurtMan), lands FULL men's rounds on rows through GHOSTS,
   moves squads between tiers (core/lod.js schedule: per squad, nearest
   first, hysteresis + a hold), and draws every non-FULL man through
   entities/crowdgpu.js (src/battle/massdraw.js).

   GHOSTS. A FULL brain targets objects. When it picks a row (pickTarget asks
   MASS.cands), the row is handed over as a ghost: a plain object with the
   fields the fire path reads (pos, team, dead, hp, coverK, losY...), synced
   from the row every frame. hurtMan on a ghost goes to the row (tiersim's
   T.hurt); when the row is promoted, everyone aiming at its ghost is handed
   the real man.

   A battle no bigger than the FULL cap is all FULL and never enters this
   file past begin(): every page that was, still is.

   URL (tools and the settings panel write the same keys):
     ?tier=auto|full|mid|far   force every squad to one tier (tools: the proof)
     ?fullcap=N ?midcap=N      men in the FULL / MID tiers
     ?fullr=M ?midr=M          the FULL / MID radii (m)
     ?worker=0|1               run MID/FAR in the sim worker (default: on in a browser)
   Every src/battle file shares ONE script scope (see ARCHITECTURE.md). */

const MASS = {
  on: false, T: null, link: null, total: 0, rows: 0,
  force: null, caps: null, opt: {}, sq: null, schedAt: -9, ghosts: new Map(), ghostSweepT: 0,
  cnt: { alive: [0, 0], fighting: [0, 0], routing: [0, 0], beasts: [0, 0], pNow: [0, 0], cx: [0, 0], cz: [0, 0], ax: [0, 0], az: [0, 0] },
  pending: [], promoteMs: 4, stats: { promoted: 0, demoted: 0, ghosts: 0, ms: { sync: 0, step: 0, events: 0, sched: 0, draw: 0 } },
  ctx: null, lastSync: 0, unitOf: null,
};
(function () {
  const t = Q.get("tier");
  MASS.force = t === "full" ? 0 : t === "mid" ? 1 : t === "far" ? 2 : null;
  MASS.opt = {
    fullcap: parseInt(Q.get("fullcap") || "", 10) || 0, midcap: parseInt(Q.get("midcap") || "", 10) || 0,
    fullr: parseFloat(Q.get("fullr") || "") || 0, midr: parseFloat(Q.get("midr") || "") || 0,
    worker: Q.get("worker"),
  };
})();

/* ---------------------------------------------------------------- begin */
// called from begin() once the field, HOST and STORE exist
// a new field (begin, or __battle.restage): nothing of the last war survives
MASS.reset = function () {
  if (MASS.link) { try { MASS.link.stop(); } catch (e) {} MASS.link = null; }
  if (CBZ.massDraw && CBZ.massDraw.reset) CBZ.massDraw.reset();
  MASS.on = false; MASS.T = null; MASS.rows = 0; MASS.sq = null; MASS.pending.length = 0;
  MASS.ghosts.clear(); MASS.schedAt = -9; MASS.cnt.at = -1;
};
MASS.begin = function (asBench, how) {
  // the settings panel's choices (src/battle/settingspanel.js) under any URL key
  const S = typeof SETTINGS !== "undefined" ? SETTINGS.cur : null;
  if (S && !asBench && !FRONT) SETTINGS.clampArmy();
  const total = SET.redN + SET.blueN;
  const cp = CBZ.battleLod.caps();
  MASS.caps = { full: MASS.opt.fullcap || (S && S.fullcap) || cp.full, mid: MASS.opt.midcap || (S && S.midcap) || cp.mid, promote: cp.promote };
  if (!MASS.opt.fullr && S) MASS.opt.fullr = S.fullr;
  if (!MASS.opt.midr && S) MASS.opt.midr = S.midr;
  MASS.on = !asBench && !MAP.water && (MASS.force != null ? MASS.force > 0 : total > MASS.caps.full) && !!CBZ.battleTierSim;
  if (!MASS.on) return false;
  // a restaged field starts its armies' books from nothing
  if (how && how.restage && typeof resetArmies === "function") resetArmies();
  MASS.total = total;
  // the worker takes the MID and FAR sims when this page can host one; when
  // the page is cross-origin isolated the store itself is shared with it
  MASS.wantWorker = MASS.opt.worker === "1" || (MASS.opt.worker !== "0" && typeof Worker !== "undefined" &&
    typeof document !== "undefined" && !!CBZ.battleSimLink && !PROBE);
  if (MASS.wantWorker && CBZ.battleStore.canShare && STORE.rows === 0) STORE = CBZ.battleStore.create(total + 16, { shared: true });
  STORE.reserve(total + 16);
  // the ground the rows stand on: groundAt sampled once over the whole field
  const ext = massExtent();
  const cell = 4, gw = Math.ceil((ext.x1 - ext.x0) / cell) + 2, gh = Math.ceil((ext.z1 - ext.z0) / cell) + 2;
  const hgt = new Float32Array(gw * gh);
  for (let iz = 0; iz < gh; iz++) for (let ix = 0; ix < gw; ix++) hgt[iz * gw + ix] = MAP.groundAt(ext.x0 + ix * cell, ext.z0 + iz * cell);
  MASS.ground = { x0: ext.x0, z0: ext.z0, cell: cell, w: gw, h: gh, hgt: hgt };
  MASS.nav = NAV.block ? { x0: NAV.x0, z0: NAV.z0, cell: NAV.cell, w: NAV.w, h: NAV.w, block: NAV.block, on: NAV.on } : null;
  const cfg = {
    morale: MK, spread: CBZ.NPC_SPREAD || null, gap: MAP.gap || 150, ground: MASS.ground,
    terrainLos: !!MAP.terrainLos, nav: MASS.nav, seed: (lcg() * 0x7ffffffe) | 0 || 1,   // the page's own dice pick the tier sim's
    tick: { mid: CBZ.battleLod.BUDGET.tick.mid, far: CBZ.battleLod.BUDGET.tick.far, squad: CBZ.battleLod.BUDGET.think.far },
    budgetMs: { mid: CBZ.battleLod.BUDGET.frameMs.mid, far: CBZ.battleLod.BUDGET.frameMs.far },
  };
  MASS.cfg = cfg;
  MASS.T = CBZ.battleTierSim.create(STORE, cfg);
  MASS.unitOf = [];
  spawnQueue.length = 0;        // the rows are spawned here, not ten a frame
  MASS.spawnAll();
  MASS.T.squads();
  MASS.buildSquads();
  if (MASS.wantWorker) {
    try {
      MASS.link = CBZ.battleSimLink.start(STORE, cfg, MASS.T, {
        onEvents: massEvents,
        fullRows: function () { return MASS.fullRows; },
        // a worker that dies hands the tiers back to the page: the battle goes on
        onDead: function (why) { console.warn("[mass] sim worker stopped:", why); massTakeBack(); },
      });
    } catch (e) { MASS.link = null; console.warn("[mass] worker", e); }
  }
  if (CBZ.massDraw) CBZ.massDraw.begin();
  return true;
};
// the page takes the tiers back from a worker that stopped: its own tier sim
// picks up every row where the store last said it was
function massTakeBack() {
  MASS.link = null;
  const T = MASS.T, C = STORE.cols;
  T.simT = simT;
  for (let r = 0; r < STORE.rows; r++) { C.lastT[r] = simT; C.thinkAt[r] = simT + (r % 7) * 0.03; C.thinkLast[r] = simT - 0.2; C.losAt[r] = 0; }
  T.squads();
}
// the field the rows can reach: both armies, the gap, and the room to run
function massExtent() {
  const n = Math.max(SET.redN, SET.blueN), rows = massRows(n);
  const depth = Math.ceil(n / rows) * 3.1, width = rows * 3.4;
  const runR = MK.FLEE_GAPS * (MAP.gap || 150) + 60;
  const hx = (MAP.gap || 150) / 2 + 8 + depth + runR, hz = width / 2 + runR;
  return { x0: MAP.cx - hx, x1: MAP.cx + hx, z0: MAP.cz - hz, z1: MAP.cz + hz };
}
// ranks across: ten (the page's own grid) until an army is too deep for it,
// then a block that grows wider as fast as it grows deep
function massRows(n) { return n <= 2000 ? 10 : Math.max(10, Math.ceil(1.9 * Math.sqrt(n))); }
function massAt(team, i, n) {
  const rows = massRows(n);
  if (rows === 10) return MAP.spawnAt(team, i);
  const side = team === "red" ? -1 : 1;
  const col = (i / rows) | 0, row = i % rows;
  return {
    x: MAP.cx + side * (MAP.gap / 2 + 8 + col * 3.1) + (sWorld() - 0.5) * 1.8,
    z: MAP.cz + (row - (rows - 1) / 2) * 3.4 + (col % 2) * 1.7 + (sWorld() - 0.5) * 1.8,
  };
}
/* ---------------------------------------------------------------- the rows */
const KIND_ROW = { men: 0, species: 1 };
MASS.spawnAll = function () {
  const T = MASS.T, C = STORE.cols;
  const sqBase = { red: 0, blue: Math.ceil(SET.redN / 10) };
  const n = Math.max(SET.redN, SET.blueN);
  const prof = {};
  let p0r = 0, p0b = 0;
  for (let i = 0; i < n; i++) {
    for (let s = 0; s < 2; s++) {
      const team = s ? "blue" : "red";
      if (i >= (s ? SET.blueN : SET.redN)) continue;
      const kind = kindAt(s ? SET.blueU : SET.redU, i);
      const k = kind === "men" ? "men" : CBZ.unitKit ? CBZ.unitKit.kindOf(kind) : "species";
      // vehicles (and the men who crew them) are FULL objects always: their
      // armour, crews and guns live in vehicles.js and nowhere else
      if (k === "vehicle" || (k === "men" && vehicleSeatFor(team, i))) { spawnQueue.push([team, i]); continue; }
      const u = massUnit(team, i, kind, k, prof);
      if (!u) continue;
      const at = massAt(team, i, s ? SET.blueN : SET.redN);
      const r = STORE.alloc(team, k === "men" ? "man" : "beast");
      C.x[r] = at.x; C.z[r] = at.z; C.y[r] = MAP.groundAt(at.x, at.z);
      C.heading[r] = team === "red" ? Math.PI / 2 : -Math.PI / 2;
      C.hp[r] = C.maxHp[r] = u.hp;
      C.squad[r] = sqBase[team] + ((i / 10) | 0);
      C.tier[r] = 2;
      C.unit[r] = u.idx;
      T.addUnit(r, u.prof, i, u.nerve, u.w, at.x, at.z);
      STORE.cols.sqSlot[r] = i % 10;
      if (s) p0b += u.w; else p0r += u.w;
      MASS.rows++;
    }
  }
  // the army's whole weight is on the books from the first frame (morale.js
  // counts a man the first time it sees him; a row it never sees is counted here)
  ARMY.red.p0 += p0r; ARMY.blue.p0 += p0b;
  ARMY.red.men0 += SET.redN; ARMY.blue.men0 += SET.blueN;
  spawnTotal = SET.redN + SET.blueN;
  spawnCount.red = SET.redN; spawnCount.blue = SET.blueN;
};
// what a row IS: its profile in tiersim (the page's own combat_iq numbers),
// its nerve, its weight to its army, its hit points, and how to draw it
function massUnit(team, i, kind, k, cache) {
  const tr = trainingOf(team === "red" ? SET.redT : SET.blueT);
  if (k === "men") {
    const wid = pickGun(team === "red" ? SET.redW : SET.blueW, i);
    const key = "m|" + tr.id + "|" + wid;
    let u = cache[key];
    if (!u) {
      const fists = wid === "fists";
      const w = fists ? null : (CBZ.weaponById(wid) || CBZ.weaponById("ak47"));
      const a = { armed: !fists, weapon: fists ? null : GUN_NAME[wid], pos: { x: 0, z: 0 } };
      if (tr.id === "swat") a.swat = true; else if (tr.id === "elite") a.kind = "soldier";
      else if (tr.id === "pro") a.kind = "guard"; else if (tr.id === "thug") a.aggr = 0.92;
      let spec;
      if (fists) {
        spec = { melee: true, beast: false, tier: tr.id, reach: 1.1, rate: 1.4, bite: (PUNCH[tr.id] || 8), chase: 6.2, march: 4.6, brave: false };
      } else {
        const p = CBZ.combatIQ.profile(a);
        spec = { tier: p.tier, cls: p.cls, react: p.react, settle: p.settle, disc: p.disc, cover: p.cover, nerve: p.nerve,
          burst: p.burst, rate: p.rate, recycle: p.recycle, lo: p.lo, hi: p.hi, pref: p.pref, falloff: p.falloff,
          hit10: p.hit10, secPerRound: p.secPerRound, dps: p.dps, dpsCap: CBZ.combatIQ.DPS_CAP,
          dmg: w ? w.damage : 14, mag: w ? (w.magSize || w.mag || 30) : 0, reload: w ? (w.reloadTime || w.reload || 1.6) : 1.6,
          wslot: (w && w.slot) || "_def", launcher: !!(w && w.explosive) };
      }
      const wt = (MK.TIER_W[tr.id] || 1) * (spec.launcher ? 1.4 : (wid === "sniper" || wid === "lmg") ? 1.15 : 1);
      u = cache[key] = { prof: MASS.T.profile(spec), hp: tr.hp, w: wt, kind: "men", wid: wid, tr: tr.id, idx: MASS.unitOf.length };
      MASS.unitOf.push(u);
    }
    return { prof: u.prof, hp: u.hp, w: u.w, idx: u.idx, nerve: nerveFor(tr.id, i) };
  }
  // an animal: its species file's numbers (beasts.js beastTuning)
  const sp = (CBZ.WILDLIFE_SPECIES || {})[kind];
  if (!sp) return null;
  const key = "b|" + kind;
  let u = cache[key];
  if (!u) {
    const tn = beastTuning(sp);
    const reach = Math.max(1.2, (sp.scale || 1) * 1.1);
    const spec = { melee: true, beast: true, tier: "beast", reach: reach, rate: tn.rate, bite: tn.dmg, chase: tn.chase, march: tn.march, brave: tn.brave, prey: tn.prey };
    u = cache[key] = { prof: MASS.T.profile(spec), hp: sp.hp || 100, w: Math.max(0.5, (sp.hp || 100) / 100), kind: kind, idx: MASS.unitOf.length };
    MASS.unitOf.push(u);
  }
  return { prof: u.prof, hp: u.hp, w: u.w, idx: u.idx, nerve: 0 };
}

/* ---------------------------------------------------------------- squads (the tier unit) */
MASS.buildSquads = function () {
  const C = STORE.cols;
  let n = 0;
  for (let r = 0; r < STORE.rows; r++) if (C.squad[r] >= n) n = C.squad[r] + 1;
  const mem = new Int32Array(n * 10).fill(-1), cnt = new Uint8Array(n);
  for (let r = 0; r < STORE.rows; r++) {
    const q = C.squad[r];
    if (q < 0 || C.life[r] === 0 || cnt[q] >= 10) continue;
    mem[q * 10 + cnt[q]++] = r;
  }
  MASS.sq = { n: n, mem: mem, cnt: cnt, cx: new Float32Array(n), cz: new Float32Array(n), men: new Int32Array(n),
    tier: new Uint8Array(n).fill(2), want: new Uint8Array(n).fill(2), forced: new Uint8Array(n), hold: new Float32Array(n),
    building: new Uint8Array(n) };
};

/* ---------------------------------------------------------------- each sub-step */
// the FULL men's rows follow them (the tier sim aims at, and walks round, these)
MASS.fullRows = [];
function massSyncFull() {
  const C = STORE.cols, F = MASS.fullRows;
  F.length = 0;
  for (let i = 0; i < men.length; i++) {
    const m = men[i], r = m.row;
    if (r == null || r < 0) continue;
    F.push(r);
    C.x[r] = m.pos.x; C.y[r] = m.pos.y; C.z[r] = m.pos.z;
    C.heading[r] = m.vehicle ? (m.h || 0) : m.beast ? (Math.PI / 2 - (m.heading || 0)) : (m.yaw || 0);
    C.hp[r] = m.hp;
    C.life[r] = m.dead ? 4 : m.fled ? 3 : m.routed ? 2 : 1;
    C.crouch[r] = m.stance === "crouch" ? 1 : 0;
    C.spd[r] = m.speed || 0;
  }
}
MASS.ctxNow = function () {
  const cp = CBZ.camera ? CBZ.camera.position : { x: MAP.cx, z: MAP.cz };
  const c = MASS.ctx || (MASS.ctx = { morale: [1, 1], hunt: [0, 0], hold: [0, 0], broken: [0, 0], com: [0, 0, 0, 0], cam: [0, 0], visR: 0, crowd: 0, over: false });
  c.morale[0] = ARMY.red.morale; c.morale[1] = ARMY.blue.morale;
  c.hunt[0] = HUNT.red ? 1 : 0; c.hunt[1] = HUNT.blue ? 1 : 0;
  c.hold[0] = ORDER.red === "hold" ? 1 : 0; c.hold[1] = ORDER.blue === "hold" ? 1 : 0;
  c.broken[0] = ARMY.red.broken ? 1 : 0; c.broken[1] = ARMY.blue.broken ? 1 : 0;
  c.com[0] = teamCOM.red.x; c.com[1] = teamCOM.red.z; c.com[2] = teamCOM.blue.x; c.com[3] = teamCOM.blue.z;
  c.cam[0] = cp.x; c.cam[1] = cp.z; c.visR = (typeof document !== "undefined" && CBZ.tracer) ? 240 : 0;
  c.crowd = MASS.cnt.alive[0] + MASS.cnt.alive[1];
  c.over = over || !!bench;
  return c;
};
MASS.step = function (sdt) {
  const t0 = performance.now();
  massSyncFull();
  const t1 = performance.now();
  if (MASS.link) MASS.link.step(sdt, MASS.ctxNow());
  else { MASS.T.step(sdt, MASS.ctxNow()); massEvents(MASS.T.events, MASS.T.nEv); MASS.T.nEv = 0; }
  const t2 = performance.now();
  MASS.stats.ms.sync += t1 - t0; MASS.stats.ms.step += t2 - t1;
};
/* ---------------------------------------------------------------- what the tier sim said */
const _evV = { x: 0, y: 0, z: 0 }, _evW = { x: 0, y: 0, z: 0 };
let massShotN = 0;
function massEvents(E, n) {
  const t0 = performance.now();
  const C = STORE.cols, EV = CBZ.battleTierSim.EV;
  for (let i = 0; i < n; i++) {
    const ty = E[i * 4], a = E[i * 4 + 1] | 0, b = E[i * 4 + 2] | 0, v = E[i * 4 + 3];
    if (ty === EV.kill) {
      const team = C.side[a] ? "blue" : "red";
      DEADN[team] = (DEADN[team] || 0) + 1;
      const kt = b >= 0 ? (C.side[b] ? "blue" : "red") : (team === "red" ? "blue" : "red");
      stats[kt].kills++;
      const killer = b >= 0 ? STORE.ref[b] : null;
      if (killer && C.tier[b] === 0) { killer.kills = (killer.kills || 0) + 1; if (killer.wid) gunLedger(killer.wid).kills++; }
      if (ARMY[team] && C.kind[a] === 0) MO.deathShock(ARMY[team], v || 1);
      const g = MASS.ghosts.get(a);
      if (g) { g.dead = true; g.hp = 0; }
      // the men standing next to him felt it (morale.js moraleOnDeath)
      if (C.kind[a] === 0 && men.length) {
        const near = fineNear(C.x[a], C.z[a], 7, _mates);
        for (let k = 0; k < near.length; k++) {
          const o = near[k];
          if (o.dead || o.team !== team || o.beast) continue;
          o.supp = Math.min(SUPP_CAP, (o.supp || 0) + SUPP_MATE);
        }
      }
      if (CBZ.massDraw) CBZ.massDraw.died(a);
    } else if (ty === EV.hitFull) {
      const m = STORE.ref[a];
      if (!m || m.dead || m.fled) continue;
      if (v < 0 && v > -1e5) {
        // a round snapped past him (fire.js's near-miss rattle)
        const miss = -v;
        if (!m.beast) {
          m.supp = Math.min(SUPP_CAP, (m.supp || 0) + SUPP_SNAP * (1.15 - miss / 2.2 * 0.7));
          if (CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(m, 0.7);
        }
        continue;
      }
      const head = v <= -1e6, dmg = head ? -v - 1e6 : v;
      const by = b >= 0 ? (STORE.ref[b] && C.tier[b] === 0 ? STORE.ref[b] : massGhost(b)) : null;
      hurtMan(m, dmg, { by: by, headshot: head });
    } else if (ty === EV.shot) {
      // the round is drawn near the lens, and the director hears where the war is
      if ((massShotN++ & 7) === 0) {
        if (shotsRing.length > 90) shotsRing.shift();
        shotsRing.push({ x: C.x[a], z: C.z[a], t: simT, m: null });
      }
      if (QUAL.firstShotT < 0) QUAL.firstShotT = Math.round(simT * 10) / 10;
      if (CBZ.tracer && fxBudget < 26 && b >= 0) {
        fxBudget++;
        _evV.x = C.x[a] + Math.sin(C.heading[a]) * 0.5; _evV.y = C.y[a] + 1.42; _evV.z = C.z[a] + Math.cos(C.heading[a]) * 0.5;
        _evW.x = C.x[b]; _evW.y = C.y[b] + (v ? 1.28 : 1.6 + Math.random()); _evW.z = C.z[b];
        if (!v) { _evW.x += (Math.random() - 0.5) * 3; _evW.z += (Math.random() - 0.5) * 3; }
        try { CBZ.tracer(_evV, _evW, { muzzle: true, muzzleScale: 0.9 }); } catch (e) {}
      }
    } else if (ty === EV.fled) {
      const team = C.side[a] ? "blue" : "red";
      ARMY[team].fled++;
      const g = MASS.ghosts.get(a);
      if (g) g.fled = true;
      if (CBZ.massDraw) CBZ.massDraw.gone(a);
    }
  }
  MASS.stats.ms.events += performance.now() - t0;
}
MASS.events = massEvents;

/* ---------------------------------------------------------------- the counts (morale, the win check, the HUD) */
// one walk of the rows per sim instant: every asker in the same instant shares it
MASS.count = function (fresh) {
  const C = STORE.cols, K = MASS.cnt;
  if (!fresh && K.at === simT) return K;
  const mw = C.mw, LF = C.life, SD = C.side, X = C.x, Z = C.z, KD = C.kind, HP = C.hp, MH = C.maxHp;
  let a0 = 0, a1 = 0, f0 = 0, f1 = 0, r0 = 0, r1 = 0, b0 = 0, b1 = 0, p0 = 0, p1 = 0;
  let cx0 = 0, cz0 = 0, cx1 = 0, cz1 = 0, ax0 = 0, az0 = 0, ax1 = 0, az1 = 0;
  for (let r = 0, n = STORE.rows; r < n; r++) {
    const l = LF[r];
    if (l !== 1 && l !== 2) continue;
    const x = X[r], z = Z[r];
    let hf = HP[r] / (MH[r] || 1);
    hf = hf < 0 ? 0 : hf > 1 ? 1 : hf;
    const p = (mw[r] || 1) * (0.45 + 0.55 * hf);
    if (SD[r] === 0) {
      a0++; ax0 += x; az0 += z; p0 += p;
      if (l === 2) r0++; else { f0++; cx0 += x; cz0 += z; }
      if (KD[r] !== 0) b0++;
    } else {
      a1++; ax1 += x; az1 += z; p1 += p;
      if (l === 2) r1++; else { f1++; cx1 += x; cz1 += z; }
      if (KD[r] !== 0) b1++;
    }
  }
  K.alive[0] = a0; K.alive[1] = a1; K.fighting[0] = f0; K.fighting[1] = f1; K.routing[0] = r0; K.routing[1] = r1;
  K.beasts[0] = b0; K.beasts[1] = b1; K.pNow[0] = p0; K.pNow[1] = p1;
  K.cx[0] = cx0; K.cz[0] = cz0; K.cx[1] = cx1; K.cz[1] = cz1; K.ax[0] = ax0; K.az[0] = az0; K.ax[1] = ax1; K.az[1] = az1;
  K.at = simT;
  return K;
};
// morale.js updateMorale, in a tiered battle: the army is every row
MASS.armies = function () {
  const K = MASS.count();
  ["red", "blue"].forEach(function (t, s) {
    const A = ARMY[t];
    A.alive = K.alive[s]; A.routing = K.routing[s]; A.pNow = K.pNow[s]; A.beasts = K.beasts[s];
  });
};
// orders.js updateCOM, in a tiered battle: the centre of every fighting row
MASS.com = function () {
  const K = MASS.cnt;
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
  return K.alive[s];
};
MASS.aliveCount = function (team) { return MASS.cnt.alive[team === "red" ? 0 : 1]; };
// physics.js navSolve: every enemy row is a seed of the field
MASS.seedNav = function (team, seed) {
  const C = STORE.cols, sd = team === "red" ? 0 : 1;
  for (let r = 0, n = STORE.rows; r < n; r++) {
    if (C.side[r] === sd || C.life[r] !== 1 || C.tier[r] === 0) continue;
    seed(C.x[r], C.z[r]);
  }
};

/* ---------------------------------------------------------------- ghosts */
function massGhost(r) {
  let g = MASS.ghosts.get(r);
  if (g) return g;
  const C = STORE.cols, team = C.side[r] ? "blue" : "red";
  const u = MASS.unitOf[C.unit[r]] || {};
  g = {
    ghost: true, row: r, team: team, i: C.spawnI[r], id: team + C.spawnI[r], sq: C.squad[r],
    pos: new THREE.Vector3(C.x[r], C.y[r], C.z[r]), yaw: C.heading[r], heading: C.heading[r],
    hp: C.hp[r], maxHp: C.maxHp[r], dead: C.life[r] === 4, fled: C.life[r] === 3, routed: C.life[r] === 2,
    speed: 0, coverK: 1, eyeH: 1.52, losY: 1.35, aimY: 1.28, headY: 1.62, rad: 0.45, stance: "stand",
    armed: u.kind === "men" && u.wid !== "fists", weapon: u.wid ? GUN_NAME[u.wid] : null, wid: u.wid || null,
    beast: C.kind[r] === 1, vehicle: false, air: false, supp: 0, kills: 0, used: simT,
  };
  MASS.ghosts.set(r, g);
  MASS.stats.ghosts++;
  return g;
}
MASS.ghost = massGhost;
function massGhostSync() {
  const C = STORE.cols;
  MASS.ghosts.forEach(function (g, r) {
    g.pos.x = C.x[r]; g.pos.y = C.y[r]; g.pos.z = C.z[r];
    g.yaw = g.heading = C.heading[r];
    g.hp = C.hp[r];
    const l = C.life[r];
    g.dead = l === 4; g.fled = l === 3; g.routed = l === 2;
    g.speed = Math.hypot(C.vx[r], C.vz[r]);
    const cr = C.crouch[r] === 1;
    g.stance = cr ? "crouch" : "stand"; g.coverK = cr ? CROUCH_HIT : 1;
    g.eyeH = cr ? 0.98 : 1.52; g.losY = cr ? 0.87 : 1.35; g.aimY = cr ? 0.83 : 1.28; g.headY = cr ? 1.04 : 1.62;
    // a near miss or a suppression a FULL man put on the ghost reaches the row
    if (g.supp > C.supp[r]) C.supp[r] = g.supp;
    g.supp = C.supp[r];
    if ((g._iqSupp || 0) > C.iqs[r]) C.iqs[r] = g._iqSupp;
  });
}
// hurtMan (damage.js) on a ghost: the round lands on the row
MASS.hurtGhost = function (g, dmg, imp) {
  if (g.dead || g.fled || over) return;
  const by = imp && imp.by;
  const byRow = by && by.row != null ? by.row : -1;
  if (MASS.link) MASS.link.hurt(g.row, dmg, byRow, imp && imp.headshot);
  else {
    MASS.T.hurt(g.row, dmg, byRow, imp && imp.headshot);
    massEvents(MASS.T.events, MASS.T.nEv); MASS.T.nEv = 0;
  }
  // getting shot is information (damage.js): retaliation happens in the row's own brain
};
// pickTarget (physics.js): rows a FULL man could have noticed, as ghosts
let _mcG = null;
MASS.cands = function (m, range, out, spot) {
  if (!_mcG || simT - _mcG.at > 0.35) massCandGrid();
  const G = _mcG, C = STORE.cols, sd = m.team === "red" ? 1 : 0;
  const cx = Math.floor(m.pos.x / 16), cz = Math.floor(m.pos.z / 16), R = Math.ceil(range / 16);
  const r2 = range * range;
  let found = 0;
  for (let dz = -R; dz <= R && found < 24; dz++) for (let dx = -R; dx <= R; dx++) {
    const a = G.cells.get((cx + dx) * 73856093 ^ (cz + dz) * 19349663);
    if (!a) continue;
    for (let i = 0; i < a.length; i++) {
      const r = a[i];
      if (C.side[r] !== sd || (C.life[r] !== 1 && C.life[r] !== 2) || C.tier[r] === 0) continue;
      const ox = C.x[r] - m.pos.x, oz = C.z[r] - m.pos.z, d2 = ox * ox + oz * oz;
      if (d2 > r2) continue;
      const g = massGhost(r);
      if (CBZ.brain.perception.sees(m, g, spot)) { out.push(g, d2); found++; g.used = simT; }
    }
  }
};
// the rows near the FULL ring, hashed for the FULL brains' search (0.35 s)
function massCandGrid() {
  const C = STORE.cols, cp = CBZ.camera ? CBZ.camera.position : { x: MAP.cx, z: MAP.cz };
  const reach = (MASS.opt.fullr || CBZ.battleLod.RULES.FULL_R) * 1.3 + SIGHT * 2 + 20, r2 = reach * reach;
  const cells = _mcG ? _mcG.cells : new Map();
  cells.forEach(function (a) { a.length = 0; });
  for (let r = 0, n = STORE.rows; r < n; r++) {
    if (C.tier[r] === 0 || (C.life[r] !== 1 && C.life[r] !== 2)) continue;
    const dx = C.x[r] - cp.x, dz = C.z[r] - cp.z;
    if (dx * dx + dz * dz > r2) continue;
    const k = Math.floor(C.x[r] / 16) * 73856093 ^ Math.floor(C.z[r] / 16) * 19349663;
    let a = cells.get(k);
    if (!a) { a = []; cells.set(k, a); }
    a.push(r);
  }
  _mcG = { cells: cells, at: simT };
}

/* ---------------------------------------------------------------- each frame: the tiers move with the lens */
MASS.frame = function (dt) {
  if (!MASS.on) return;
  const t0 = performance.now();
  if (MASS.link) MASS.link.poll();
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
  const t1 = performance.now();
  MASS.stats.ms.sched += t1 - t0;
  if (CBZ.massDraw) CBZ.massDraw.frame(dt);
  MASS.stats.ms.draw += performance.now() - t1;
};
function massSchedule(dt) {
  const Q2 = MASS.sq, C = STORE.cols;
  if (!Q2) return;
  const forcedRows = [];
  if (typeof STUDY !== "undefined" && STUDY.m && STUDY.m.row != null) forcedRows.push(STUDY.m.row);
  if (typeof YOU !== "undefined" && YOU.m && YOU.m.row != null) forcedRows.push(YOU.m.row);
  Q2.forced.fill(0);
  for (let i = 0; i < forcedRows.length; i++) { const q = C.squad[forcedRows[i]]; if (q >= 0 && q < Q2.n) Q2.forced[q] = 1; }
  for (let q = 0; q < Q2.n; q++) {
    let x = 0, z = 0, k = 0;
    for (let j = 0; j < Q2.cnt[q]; j++) {
      const r = Q2.mem[q * 10 + j];
      const l = C.life[r];
      if (l !== 1 && l !== 2) continue;
      x += C.x[r]; z += C.z[r]; k++;
    }
    Q2.men[q] = k;
    if (k) { Q2.cx[q] = x / k; Q2.cz[q] = z / k; }
  }
  const cp = CBZ.camera ? CBZ.camera.position : { x: MAP.cx, z: MAP.cz };
  CBZ.battleLod.schedule(Q2, cp.x, cp.z, dt, MASS.caps, { force: MASS.force, fullR: MASS.opt.fullr || 0, midR: MASS.opt.midr || 0 });
  for (let q = 0; q < Q2.n; q++) {
    const w = Q2.want[q], cur = Q2.tier[q];
    if (w === cur || !Q2.men[q]) { if (w === cur) Q2.building[q] = 0; continue; }
    if (w === 0) { if (!Q2.building[q]) { Q2.building[q] = 1; MASS.pending.push(q); } }
    else if (cur === 0) massDemote(q, w);
    else massRetier(q, w);
  }
}
// MID <-> FAR is a column: the row keeps everything it is
function massRetier(q, w) {
  const Q2 = MASS.sq, C = STORE.cols;
  for (let j = 0; j < Q2.cnt[q]; j++) {
    const r = Q2.mem[q * 10 + j];
    if (C.tier[r] === 0) continue;
    C.tier[r] = w;
    if (MASS.link) MASS.link.tier(r, w, null); else MASS.T.adopt(r, null);
  }
  Q2.tier[q] = w;
}
/* PROMOTION: build the squad's rigs inside a per-frame budget (a rig costs
   milliseconds), hidden, and flip the whole squad at once when the last one
   is ready: the instance draws until the frame the rig takes over. */
function massBuild() {
  const Q2 = MASS.sq, C = STORE.cols;
  const lim = performance.now() + MASS.promoteMs;
  let squads = 0;
  while (MASS.pending.length && squads < MASS.caps.promote * 2) {
    const q = MASS.pending[0];
    if (Q2.want[q] !== 0 || Q2.tier[q] === 0) { massAbandon(q); MASS.pending.shift(); Q2.building[q] = 0; if (Q2.asked) Q2.asked[q] = 0; continue; }
    let done = true;
    // the worker owns the rows' full state (transfer mode): ask for it as the
    // rigs start, flip only once it is here (the ask rides the next step)
    if (MASS.link && MASS.link.mode !== "shared" && !Q2.asked) Q2.asked = new Uint8Array(Q2.n);
    if (Q2.asked && MASS.link && !Q2.asked[q]) {
      Q2.asked[q] = 1;
      const rows = [];
      for (let j = 0; j < Q2.cnt[q]; j++) rows.push(Q2.mem[q * 10 + j]);
      MASS.link.want(rows);
    }
    for (let j = 0; j < Q2.cnt[q]; j++) {
      const r = Q2.mem[q * 10 + j];
      const l = C.life[r];
      if ((l !== 1 && l !== 2) || STORE.ref[r]) continue;
      if (performance.now() > lim) { done = false; break; }
      const m = massMakeObj(r);
      if (m) { STORE.ref[r] = m; m.group.visible = false; m._massWait = true; }
    }
    if (done && Q2.asked && MASS.link) {
      for (let j = 0; j < Q2.cnt[q] && done; j++) {
        const r = Q2.mem[q * 10 + j];
        if (STORE.ref[r] && !MASS.link.stateOf(r)) done = false;
      }
    }
    if (!done) break;
    if (Q2.asked) Q2.asked[q] = 0;
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
  const u = MASS.unitOf[C.unit[r]];
  const m = u && u.kind === "men" ? makeMan(team, i) : makeBeast(team, i, u ? u.kind : null);
  if (!m) return null;
  return m;
}
function massPromote(q) {
  const Q2 = MASS.sq, C = STORE.cols;
  for (let j = 0; j < Q2.cnt[q]; j++) {
    const r = Q2.mem[q * 10 + j];
    const l = C.life[r];
    const m = STORE.ref[r];
    if (!m || (l !== 1 && l !== 2)) { if (m && m._massWait) { massDropObj(m); STORE.ref[r] = null; } continue; }
    // the man IS the row: where he stands, how he faces, what he has left
    // (the worker's full word on it, in transfer mode)
    const st = MASS.link ? MASS.link.stateOf(r) : null;
    if (st) { for (const k in st) if (C[k]) C[k][r] = st[k]; MASS.link.forget(r); }
    m._massWait = false;
    m.row = r; m.pos.set(C.x[r], C.y[r], C.z[r]);
    m.target.set(C.gx[r], 0, C.gz[r]);
    m.home = { x: C.hx[r], z: C.hz[r] };
    m.hp = C.hp[r]; m.maxHp = C.maxHp[r];
    m.supp = C.supp[r]; m._iqSupp = C.iqs[r];
    m._mc = 1; m._mw = C.mw[r];
    if (!m.beast) {
      m.yaw = C.heading[r]; m.group.rotation.y = m.yaw;
      m.mag = C.mag[r]; m.reloadT = C.reloadT[r]; m.cool = Math.max(0, C.cool[r]);
      m.routed = l === 2; m.routT = C.routT[r]; m.routBest = C.routBest[r]; m.routStall = C.routStall[r]; m.rallyT = C.rallyT[r];
      if (C.crouch[r]) setStance(m, "crouch");
    } else {
      m.heading = Math.PI / 2 - C.heading[r];
      if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, m.heading);
    }
    const t = C.tgt[r];
    if (t >= 0 && (C.life[t] === 1 || C.life[t] === 2)) m.tgt = C.tier[t] === 0 && STORE.ref[t] ? STORE.ref[t] : massGhost(t);
    m.thinkAt = simT + Math.random() * 0.2;
    if (CBZ.massDraw) CBZ.massDraw.handoff(r, m, true);
    m.group.visible = true;
    C.tier[r] = 0;
    if (MASS.link) MASS.link.tier(r, 0, null);
    men.push(m);
    // anyone aiming at his ghost is now aiming at him
    const g = MASS.ghosts.get(r);
    if (g) {
      for (let k = 0; k < men.length; k++) if (men[k].tgt === g) men[k].tgt = m;
      MASS.ghosts.delete(r);
    }
    MASS.stats.promoted++;
  }
  Q2.tier[q] = 0;
}
/* DEMOTION: the man's state goes back into his row and the rig is dropped */
function massDemote(q, w) {
  const Q2 = MASS.sq, C = STORE.cols;
  for (let j = 0; j < Q2.cnt[q]; j++) {
    const r = Q2.mem[q * 10 + j];
    const m = STORE.ref[r];
    if (C.tier[r] !== 0) continue;
    if (!m) { C.tier[r] = w; continue; }
    if (m.dead) continue;          // the dead keep their rig where they fell
    if (m.you || (typeof STUDY !== "undefined" && STUDY.m === m)) continue;
    C.x[r] = m.pos.x; C.y[r] = m.pos.y; C.z[r] = m.pos.z;
    C.hp[r] = m.hp; C.life[r] = m.fled ? 3 : m.routed ? 2 : 1;
    C.heading[r] = m.beast ? Math.PI / 2 - (m.heading || 0) : (m.yaw || 0);
    C.gx[r] = m.target.x; C.gz[r] = m.target.z;
    const st = { supp: m.supp || 0, crouch: m.stance === "crouch" ? 1 : 0, routT: m.routT || 0, rallyT: m.rallyT || 0 };
    if (!m.beast) { st.mag = m.mag; st.cool = m.cool; st.reloadT = m.reloadT; }
    st.tgt = m.tgt && !m.tgt.dead ? (m.tgt.row != null ? m.tgt.row : -1) : -1;
    C.tier[r] = w;
    if (MASS.link) MASS.link.tier(r, w, st, MASS.link.mode === "shared" ? null :
      { x: C.x[r], y: C.y[r], z: C.z[r], heading: C.heading[r], hp: C.hp[r], life: C.life[r], gx: C.gx[r], gz: C.gz[r] });
    else MASS.T.adopt(r, st);
    if (CBZ.massDraw) CBZ.massDraw.handoff(r, m, false);
    const k = men.indexOf(m);
    if (k >= 0) men.splice(k, 1);
    // everyone aiming at him now aims at his row
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
    try { CBZ.studio.drop(m.group); } catch (e) {}
  }
}
/* A BLAST REACHES THE ROWS TOO. studio.boom sweeps the FULL roster through
   the caps bus; the rows are swept here with the same rule the node world
   gives it (tools/npcwar-headless.mjs realBoom: inside 0.55 R takes it). */
MASS.blast = function (x, z, R, by) {
  if (!MASS.on) return;
  const C = STORE.cols, LR = R * 0.55, L2 = LR * LR;
  const byRow = by && by.row != null ? by.row : -1;
  for (let r = 0, n = STORE.rows; r < n; r++) {
    if (C.tier[r] === 0 || (C.life[r] !== 1 && C.life[r] !== 2)) continue;
    const dx = C.x[r] - x, dz = C.z[r] - z;
    if (dx * dx + dz * dz > L2) continue;
    if (MASS.link) MASS.link.hurt(r, 1e6, byRow, false);
    else MASS.T.hurt(r, 1e6, byRow, false);
  }
  if (!MASS.link) { massEvents(MASS.T.events, MASS.T.nEv); MASS.T.nEv = 0; }
};
CBZ.npcwar.onBoot(function () {
  // every boom on this page (rockets, ordnance, the nuke) also sweeps the rows
  const boom = CBZ.studio && CBZ.studio.boom;
  if (boom && !boom._mass) {
    CBZ.studio.boom = function (p, o) {
      const res = boom.apply(this, arguments);
      try { if (MASS.on && p) MASS.blast(p.x, p.z, (o && o.radius) || 6, o && o.by); } catch (e) {}
      return res;
    };
    CBZ.studio.boom._mass = true;
  }
});
/* the probe's view of a tiered battle */
MASS.audit = function () {
  if (!MASS.on) return { on: false };
  const C = STORE.cols, by = [0, 0, 0];
  for (let r = 0; r < STORE.rows; r++) if (C.life[r] === 1 || C.life[r] === 2) by[C.tier[r]]++;
  return { on: true, rows: MASS.rows, tiers: { full: by[0], mid: by[1], far: by[2] }, worker: MASS.link ? MASS.link.mode : "in-page",
    caps: MASS.caps, force: MASS.force, ghosts: MASS.ghosts.size, stats: MASS.stats, simMs: MASS.T ? MASS.T.ms : null };
};
