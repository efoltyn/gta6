/* ============================================================
   entities/crowdstore.js — THE ONE CROWD STORE. Every crowd member in the
   game (a rally, the Capitol mob, a packed arena, the speedway stands, the
   warlord's men) is one ROW here: a few numbers in typed arrays, never an
   object. Drawing goes through entities/crowdgpu.js (the real CBZ.human,
   GPU-instanced); damage, panic and the casualty count go through this file.

   OWNER (2026-10-09): "If it's no matter how many people, you can make these
   crowds massive. All they need as a tracker is whether they're dead or
   alive, because you need kill counts if there's a bombing or something like
   that, so the news can have the number on it."

   THE ROW (struct of arrays, index = row)
     x y z yaw        where they stand, in their group's local space
     vx vz            velocity (m/s, local): the GPU carries them on it between cuts
     clip phase rate  the baked clip (crowdgpu), its phase in cycles and its rate;
                      pnow = 1 when phase is "as of now" (a moving gait)
     look             the crowdgpu look (palette indices: the clothes)
     aff              affiliation index (an ideology, an institution, "fans")
     grp              which group owns the row
     life             0 free, 1 alive, 2 hurt, 3 dead
     own              1 = the group's owner moves it (mob.js); 0 = this file does
     hide             1 = drawn elsewhere (promoted to a full rig) and not hit here
     panicT fleeX fleeZ   running from a danger point
   Only the nearest few become full rigs with brains: that promotion stays
   with the owner (mob.js's near ring), which sets `hide` on the row.

   GROUPS. group({name, kind, place, who, parent, mode, cap, maxDraw, own,
   life, onLife, onPanic, beforeCut, frame}) -> G. G.add/remove/clear/anim/
   kill/hurt/release/dispose, and for a caller that rebuilds its list every
   frame (the warlord) G.begin()/put()/end(). Each group is ONE crowdgpu layer
   (about 5 draw calls) under its parent.

   THE CUT. A group is re-cut (who is drawn at which LOD) by THIS file, a few
   times a second for a moving crowd and on camera moves for a still one,
   inside a per-frame row budget. Between cuts the GPU walks every body on its
   own velocity and gait, so ten thousand marchers cost ten thousand typed-array
   reads a cut, not a frame.

   DAMAGE (the one path):
     blast(x, z, R, power, o)   every explosion (crashfx applyBlastDamage)
     ring(x, z, r0, r1, pk, o)  a propagating blast band (impactbus waves)
     nuke(x, z, o)              everyone inside the 5 psi ring dies at once;
                                the rest by the measured lethality curve
     ray(ox,oy,oz, dx,dy,dz, maxT)  a round vs every body's capsule (spatial hash)
     shoot(row, o)              that round lands
     runOver(x, z, r, speed, o) a car through them (vehicles.js runOver)
   Survivors panic away from the point; a stampede in a dense crowd knocks
   people down and tramples the fallen.

   THE COUNT. Every casualty joins an EVENT (cause, place, crowd, by whom),
   counted by affiliation. Events report through the paths that already
   exist: the death ledger (killfeed.js cityLogDeath, one entry carrying the
   count, phrased by newsroom.js), and CBZ.politics.act("kill") per affiliation
   so the right groups react, scaled by the toll. The dead lie where they
   fell for a while; the toll lives on in CBZ.game.crowdToll.

   CAPS per device (rows in the store): desktop 40960, tablet 12288, phone
   4096 (CONFIG.CROWD_CAP overrides).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || CBZ.crowds) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  function G_() { return CBZ.game || (CBZ.game = {}); }

  const DEVICE = CBZ.deviceClass || "desktop";
  const CAPS = { desktop: 40960, tablet: 12288, phone: 4096 };
  const CAP = CFG.CROWD_CAP > 0 ? CFG.CROWD_CAP | 0 : (CAPS[DEVICE] || CAPS.desktop);
  const CUT_BUDGET = ({ desktop: 26000, tablet: 9000, phone: 3600 })[DEVICE] || 26000;
  const BODY_TTL = ({ desktop: 600, tablet: 360, phone: 180 })[DEVICE] || 600;
  const DEAD_CAP = ({ desktop: 8000, tablet: 2500, phone: 800 })[DEVICE] || 8000;
  const FREE = 0, ALIVE = 1, HURT = 2, DEAD = 3;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- the rows
  const S = {
    x: new Float32Array(CAP), y: new Float32Array(CAP), z: new Float32Array(CAP), yaw: new Float32Array(CAP),
    vx: new Float32Array(CAP), vz: new Float32Array(CAP),
    phase: new Float32Array(CAP), rate: new Float32Array(CAP), scale: new Float32Array(CAP),
    clip: new Uint8Array(CAP), pnow: new Uint8Array(CAP), look: new Int32Array(CAP).fill(-1),
    aff: new Uint8Array(CAP), grp: new Int16Array(CAP).fill(-1), life: new Uint8Array(CAP),
    own: new Uint8Array(CAP), hide: new Uint8Array(CAP),
    panicT: new Float32Array(CAP), fleeX: new Float32Array(CAP), fleeZ: new Float32Array(CAP),
    hurtT: new Float32Array(CAP), deadT: new Float32Array(CAP), evt: new Int32Array(CAP),
    posT: new Float32Array(CAP),     // store clock when an owner last wrote x/z (a sleeping far walker is drawn on from there)
    wx: new Float32Array(CAP), wy: new Float32Array(CAP), wz: new Float32Array(CAP),
  };
  const gpos = new Int32Array(CAP);                // row's index in its group's list
  const freeRows = new Int32Array(CAP);
  let nFree = 0, hi = 0, live = 0;
  for (let i = CAP - 1; i >= 0; i--) freeRows[nFree++] = i;
  function allocRow() {
    if (!nFree) return -1;
    const r = freeRows[--nFree];
    if (r + 1 > hi) hi = r + 1;
    live++;
    return r;
  }
  function freeRow(r) {
    S.life[r] = FREE; S.grp[r] = -1; S.hide[r] = 0; S.own[r] = 0; S.panicT[r] = 0; S.vx[r] = 0; S.vz[r] = 0;
    S.evt[r] = 0; S.look[r] = -1;
    freeRows[nFree++] = r; live--;
    if (inAct[r]) inAct[r] = 0;
  }

  // ---------------------------------------------------------------- clips
  // crowdgpu's clip order (its CLIPS table); read from it when it is loaded
  const CLIP_NAMES = ["idle", "walk", "run", "cheer", "fist", "sign", "signWalk", "flag", "flagWalk", "sit", "sitCheer", "down", "limp", "crawl"];
  const CLIP = Object.create(null);
  function readClips() {
    const G = CBZ.crowdGPU;
    const L = G && G.clips ? G.clips() : CLIP_NAMES;
    for (let i = 0; i < L.length; i++) CLIP[L[i]] = i;
  }
  readClips();
  function clipIx(c) { if (typeof c === "number") return c; const i = CLIP[c]; return i == null ? 0 : i; }
  let GAITW = 0, GAITR = 0, GAITC = 0, GAITL = 0;
  function gaits() {
    if (GAITW) return;
    const G = CBZ.crowdGPU;
    const w = G && G.clip ? G.clip("walk") : null, r = G && G.clip ? G.clip("run") : null;
    const c = G && G.clip ? G.clip("crawl") : null, l = G && G.clip ? G.clip("limp") : null;
    GAITW = (w && w.radPerM) || 4.4; GAITR = (r && r.radPerM) || 2.3;
    GAITC = (c && c.radPerM) || 5; GAITL = (l && l.radPerM) || 6;
  }
  function gpuNow() { const G = CBZ.crowdGPU; return G && G.now ? G.now() : 0; }

  // ---------------------------------------------------------------- affiliations
  const AFFS = [{ id: "public", name: "the public", ideology: null, inst: null }];
  const AFF_IX = Object.create(null); AFF_IX.public = 0;
  function aff(o) {
    if (typeof o === "number") return o;
    if (typeof o === "string") o = { id: o };
    if (!o || !o.id) return 0;
    let i = AFF_IX[o.id];
    if (i != null) return i;
    if (AFFS.length >= 255) return 0;
    i = AFFS.length;
    AFFS.push({ id: String(o.id), name: o.name || String(o.id), ideology: o.ideology || null, inst: o.inst || null });
    AFF_IX[o.id] = i;
    return i;
  }

  // ---------------------------------------------------------------- hashing (deterministic rolls)
  function h01(a, b, s) {
    let h = (Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ ((s | 0) * 0x27d4eb2f)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }
  let CLOCK = 0;            // seconds of store time
  let SEQ = 1;              // event / roll salt

  // ---------------------------------------------------------------- groups
  const GROUPS = [];        // index = S.grp
  function mw(G) {
    // the parent's world matrix if it is not the identity (rows are local)
    const p = G.parent;
    if (!p || p === CBZ.scene || !p.matrixWorld) { G.m = null; return; }
    const e = p.matrixWorld.elements;
    if (e[0] === 1 && e[5] === 1 && e[10] === 1 && e[12] === 0 && e[13] === 0 && e[14] === 0 && e[8] === 0 && e[2] === 0) { G.m = null; return; }
    G.m = e;
  }
  function toWorld(G, r) {
    const e = G.m, x = S.x[r], y = S.y[r], z = S.z[r];
    if (!e) { S.wx[r] = x; S.wy[r] = y; S.wz[r] = z; return; }
    S.wx[r] = e[0] * x + e[4] * y + e[8] * z + e[12];
    S.wy[r] = e[1] * x + e[5] * y + e[9] * z + e[13];
    S.wz[r] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  // a world direction into the group's local frame (rigid: the rotation transposed)
  function dirLocal(G, dx, dz, out) {
    const e = G.m;
    if (!e) { out[0] = dx; out[1] = dz; return out; }
    out[0] = e[0] * dx + e[2] * dz; out[1] = e[8] * dx + e[10] * dz;
    const l = Math.hypot(out[0], out[1]) || 1; out[0] /= l; out[1] /= l;
    return out;
  }
  function modeOk(G) {
    if (!G.mode) return true;
    const m = G_().mode;
    return G.mode === "city" ? (!m || m === "city") : m === G.mode;
  }

  function group(o) {
    o = o || {};
    let slot = GROUPS.indexOf(null);
    if (slot < 0) { if (GROUPS.length >= 32000) return null; slot = GROUPS.length; GROUPS.push(null); }
    const G = {
      ix: slot, name: o.name || "crowd", kind: o.kind || "crowd", place: o.place || null, who: o.who || null,
      side: o.side || null, parent: o.parent || null, mode: o.mode === undefined ? null : o.mode,
      cap: Math.max(1, Math.min(CAP, o.cap | 0 || 4096)), maxDraw: o.maxDraw || 300,
      own: !!o.own, lifeOn: o.life !== false, frame: !!o.frame, aff: aff(o.aff || 0),
      onLife: o.onLife || null, onPanic: o.onPanic || null, beforeCut: o.beforeCut || null,
      moving: !!o.moving, cutDt: o.cutDt || (o.own ? 0.1 : 0.25),
      rows: [], layer: null, dirty: true, lastCut: -1e9, cutX: 1e9, cutZ: 1e9, m: null,
      released: false, dead: 0, hurt: 0, k: 0, gone: false, shown: true,
    };
    G.add = function (x, y, z, yaw, look, clip, phase, rate, opts) { return add(G, x, y, z, yaw, look, clip, phase, rate, opts); };
    G.remove = function (r) { return remove(G, r); };
    G.clear = function () { for (let k = G.rows.length - 1; k >= 0; k--) remove(G, G.rows[k]); };
    G.count = function () { return G.rows.length; };
    G.living = function () { let n = 0; for (let k = 0; k < G.rows.length; k++) if (S.life[G.rows[k]] === ALIVE) n++; return n; };
    G.anim = function (r, clip, phase, rate, now) { S.clip[r] = clipIx(clip); S.phase[r] = phase || 0; S.rate[r] = rate || 0; S.pnow[r] = now ? 1 : 0; };
    G.markDirty = function () { G.dirty = true; };
    // out of sight entirely (a venue the player is far from): not cut, not drawn; still there
    G.show = function (v) { v = !!v; if (v === G.shown) return; G.shown = v; if (!v && G.layer) G.layer.clear(); G.dirty = true; };
    G.kill = function (r, cause, opts) { return casualty(r, DEAD, cause || "violence", opts || {}); };
    G.hurt = function (r, cause, opts) { return casualty(r, HURT, cause || "violence", opts || {}); };
    // the owner is done with the living (a mob went home): the hurt and the
    // dead stay where they are, this file looks after them, and the group
    // goes when its last body is cleared
    G.release = function () {
      G.released = true; G.own = false; G.onLife = null; G.onPanic = null; G.beforeCut = null;
      for (let k = G.rows.length - 1; k >= 0; k--) { const r = G.rows[k]; if (S.life[r] === ALIVE) remove(G, r); else S.own[r] = 0; }
      G.dirty = true;
      if (!G.rows.length) dispose(G);
    };
    G.dispose = function () { dispose(G); };
    // frame mode: a caller that rebuilds its list every frame
    G.begin = function () { G.k = 0; };
    G.put = function (x, y, z, yaw, look, clip, phase, rate, scale, vx, vz) {
      let r;
      if (G.k < G.rows.length) r = G.rows[G.k];
      else { r = add(G, x, y, z, yaw, look, clip, phase, rate, null); if (r < 0) return -1; }
      G.k++;
      S.x[r] = x; S.y[r] = y; S.z[r] = z; S.yaw[r] = yaw; S.look[r] = look | 0;
      S.clip[r] = clipIx(clip); S.phase[r] = phase || 0; S.rate[r] = rate || 0; S.pnow[r] = 0;
      S.scale[r] = scale > 0 ? scale : 1; S.vx[r] = vx || 0; S.vz[r] = vz || 0; S.life[r] = ALIVE; S.hide[r] = 0;
      S.posT[r] = CLOCK;
      return r;
    };
    G.end = function (cam) {
      for (let k = G.rows.length - 1; k >= G.k; k--) remove(G, G.rows[k]);
      cut(G, cam || null);
    };
    G.world = function (r) { mw(G); toWorld(G, r); return { x: S.wx[r], y: S.wy[r], z: S.wz[r] }; };
    GROUPS[slot] = G;
    return G;
  }
  function add(G, x, y, z, yaw, look, clip, phase, rate, opts) {
    if (G.gone || G.rows.length >= G.cap) return -1;
    const r = allocRow(); if (r < 0) return -1;
    S.x[r] = x; S.y[r] = y; S.z[r] = z; S.yaw[r] = yaw || 0; S.look[r] = look == null ? -1 : look | 0;
    S.clip[r] = clipIx(clip || 0); S.phase[r] = phase || 0; S.rate[r] = rate || 0; S.pnow[r] = 0;
    S.scale[r] = opts && opts.scale > 0 ? opts.scale : 1;
    S.aff[r] = opts && opts.aff != null ? aff(opts.aff) : G.aff;
    S.grp[r] = G.ix; S.life[r] = ALIVE; S.own[r] = G.own ? 1 : 0; S.hide[r] = 0;
    S.vx[r] = 0; S.vz[r] = 0; S.panicT[r] = 0; S.hurtT[r] = 0; S.deadT[r] = 0; S.evt[r] = 0; S.posT[r] = CLOCK;
    gpos[r] = G.rows.length; G.rows.push(r);
    G.dirty = true; if (G.lifeOn) hashAge = 1e9;
    return r;
  }
  function remove(G, r) {
    if (r < 0 || S.grp[r] !== G.ix) return false;
    const k = gpos[r], L = G.rows, last = L[L.length - 1];
    L[k] = last; gpos[last] = k; L.pop();
    if (S.life[r] === DEAD) { G.dead--; deadN--; }
    else if (S.life[r] === HURT) G.hurt--;
    freeRow(r);
    G.dirty = true; if (G.lifeOn) hashAge = 1e9;
    return true;
  }
  function dispose(G) {
    if (G.gone) return;
    for (let k = G.rows.length - 1; k >= 0; k--) remove(G, G.rows[k]);
    G.gone = true;
    if (G.layer) { try { G.layer.dispose(); } catch (e) {} G.layer = null; }
    GROUPS[G.ix] = null;
  }

  // ---------------------------------------------------------------- the spatial hash (world space)
  const CELL = 2, TBL = 1 << 15, MASK = TBL - 1;
  const head = new Int32Array(TBL).fill(-1), nxt = new Int32Array(CAP), stamp = new Int32Array(CAP);
  let hashAge = 1e9, hashT = -1e9, qid = 1;
  function cellKey(cx, cz) { return ((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0) & MASK; }
  function buildHash() {
    head.fill(-1);
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const G = GROUPS[gi];
      if (!G || !G.lifeOn || !modeOk(G)) continue;
      mw(G);
      const L = G.rows;
      for (let k = 0; k < L.length; k++) {
        const r = L[k], lf = S.life[r];
        if (S.hide[r]) continue;
        toWorld(G, r);
        if (lf !== ALIVE && lf !== HURT) continue;
        const c = cellKey(Math.floor(S.wx[r] / CELL), Math.floor(S.wz[r] / CELL));
        nxt[r] = head[c]; head[c] = r;
      }
    }
    hashAge = 0; hashT = CLOCK;
  }
  function ensureHash() { if (hashAge > 0.1 || CLOCK - hashT > 0.1) buildHash(); }

  /* A ROUND VS EVERY BODY. The ray is walked through the hash a cell at a
     time (3x3 round each sample, each row tested once); a standing person is
     a vertical capsule (r 0.27 m, hips to shoulders) plus a head sphere, a
     person on the ground a low one. Returns the nearest: {row, dist, head, x, y, z}. */
  const _hit = { row: -1, dist: 0, head: false, x: 0, y: 0, z: 0 };
  function ray(ox, oy, oz, dx, dy, dz, maxT, opts) {
    if (!(maxT > 0)) return null;
    if (live <= 0) return null;
    ensureHash();
    const q = ++qid;
    const hh = Math.hypot(dx, dz);
    const step = hh > 1e-3 ? Math.min(maxT, 1.6 / hh) : maxT + 1;
    let best = -1, bt = maxT, bhead = false, lastC = 0x7fffffff, lastZ = 0x7fffffff;
    const skipG = opts && opts.skip != null ? opts.skip : -1;
    for (let t = 0; t <= maxT + step; t += step) {
      if (t > bt + 2) break;
      const px = ox + dx * t, pz = oz + dz * t;
      const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      if (cx === lastC && cz === lastZ) continue;
      lastC = cx; lastZ = cz;
      for (let oz2 = -1; oz2 <= 1; oz2++) for (let ox2 = -1; ox2 <= 1; ox2++) {
        let r = head[cellKey(cx + ox2, cz + oz2)];
        while (r >= 0) {
          if (stamp[r] !== q) {
            stamp[r] = q;
            if (S.grp[r] !== skipG) {
              const res = capsule(r, ox, oy, oz, dx, dy, dz, hh, bt);
              if (res >= 0 && res < bt) { bt = res; best = r; bhead = _headHit; }
            }
          }
          r = nxt[r];
        }
      }
      if (hh <= 1e-3) break;
    }
    if (best < 0) return null;
    _hit.row = best; _hit.dist = bt; _hit.head = bhead;
    _hit.x = ox + dx * bt; _hit.y = oy + dy * bt; _hit.z = oz + dz * bt;
    return { row: _hit.row, dist: _hit.dist, head: _hit.head, x: _hit.x, y: _hit.y, z: _hit.z };
  }
  let _headHit = false;
  function capsule(r, ox, oy, oz, dx, dy, dz, hh, maxT) {
    const cx = S.wx[r], cz = S.wz[r], by = S.wy[r];
    const low = S.life[r] === HURT;
    const sit = !low && (S.clip[r] === CLIP.sit || S.clip[r] === CLIP.sitCheer);
    const R = low ? 0.34 : 0.27;
    const y0 = by + (low ? 0.02 : sit ? 0.15 : 0.3), y1 = by + (low ? 0.5 : sit ? 1.2 : 1.5);
    const top = by + (sit ? 1.3 : 1.62);
    let tin, tout;
    if (hh > 1e-3) {
      const h2 = hh * hh;
      const tc = ((cx - ox) * dx + (cz - oz) * dz) / h2;
      const qx = ox + dx * tc - cx, qz = oz + dz * tc - cz, d2 = qx * qx + qz * qz;
      const RR = low ? R : R + 0.05;
      if (d2 > RR * RR) return -1;
      const s = Math.sqrt(RR * RR - d2) / hh;
      tin = tc - s; tout = tc + s;
    } else {
      const qx = ox - cx, qz = oz - cz;
      if (qx * qx + qz * qz > R * R) return -1;
      tin = -1e9; tout = 1e9;
    }
    // the part of [tin, tout] where the ray is between the feet and the crown
    const ytop = low ? y1 : top + 0.13;
    let lo = tin, hi2 = tout;
    if (Math.abs(dy) < 1e-6) { if (oy < y0 || oy > ytop) return -1; }
    else {
      const ta = (y0 - oy) / dy, tb = (ytop - oy) / dy;
      lo = Math.max(lo, Math.min(ta, tb)); hi2 = Math.min(hi2, Math.max(ta, tb));
    }
    if (lo > hi2 || hi2 < 0 || lo > maxT) return -1;
    const t = Math.max(0, lo);
    _headHit = !low && oy + dy * t > y1;
    return t;
  }

  // ---------------------------------------------------------------- events: the count
  const EVENTS = [];
  const EV_JOIN_R = 180, EV_JOIN_T = 25;
  function familyOf(cause) {
    const c = String(cause || "");
    if (/nuclear/.test(c)) return "nuke";
    if (/stampede|trampl/.test(c)) return "stampede";
    if (/car|run/.test(c)) return "car";
    if (/gun|shot|murder|police/.test(c)) return "shooting";
    if (/explo|blast|bomb|terror|air|missile|rocket|grenade/.test(c)) return "blast";
    return "violence";
  }
  function newEvent(cause, x, z, G, o) {
    const E = {
      id: SEQ++, family: familyOf(cause), cause: cause, x: x, z: z, t0: CLOCK, t1: CLOCK,
      dead: 0, hurt: 0, byAff: [], causes: Object.create(null), groups: Object.create(null),
      place: null, crowd: null, who: null, side: null, gid: G ? G.ix : -1,
      byPlayer: !!o.byPlayer, by: o.by || null, rings: o.rings || null, city: o.city || null, est: null,
      said: { dead: 0, hurt: 0 }, priced: 0, pricedAff: [], closed: false, reports: 0,
    };
    if (G) { E.place = G.place; E.crowd = G.kind; E.who = G.who; E.side = G.side; }
    if (o.place) E.place = o.place;
    EVENTS.push(E);
    if (EVENTS.length > 48) EVENTS.shift();
    return E;
  }
  function eventFor(cause, x, z, G, o) {
    if (o.event) return o.event;
    const fam = familyOf(cause);
    let best = null, bd = 1e18;
    for (let i = EVENTS.length - 1; i >= 0; i--) {
      const E = EVENTS[i];
      if (E.closed || CLOCK - E.t1 > EV_JOIN_T) continue;
      // a stampede joins whatever started it; others join their own kind
      if (fam !== "stampede" && E.family !== fam) continue;
      if (fam !== "stampede" && E.byPlayer !== !!o.byPlayer) continue;
      const d = (E.x - x) * (E.x - x) + (E.z - z) * (E.z - z);
      const R = E.family === "nuke" ? 1e8 : EV_JOIN_R * EV_JOIN_R;
      if (d < R && d < bd) { bd = d; best = E; }
    }
    return best || newEvent(cause, x, z, G, o);
  }

  // the toll that outlives the bodies
  function toll() {
    const g = G_();
    return g.crowdToll || (g.crowdToll = { dead: 0, hurt: 0, events: [] });
  }

  // ---------------------------------------------------------------- one casualty
  let deadN = 0;
  const _gore = { n: 0, t: -1 };
  function casualty(r, to, cause, o) {
    const lf = S.life[r];
    if (lf === FREE || lf === DEAD || (to === HURT && lf === HURT)) return false;
    const G = GROUPS[S.grp[r]];
    if (!G) return false;
    mw(G); toWorld(G, r);
    const E = eventFor(cause, o.x != null ? o.x : S.wx[r], o.z != null ? o.z : S.wz[r], G, o);
    E.t1 = CLOCK;
    E.causes[cause] = (E.causes[cause] | 0) + 1;
    E.groups[G.ix] = (E.groups[G.ix] | 0) + 1;
    if (!E.place && G.place && E.family !== "nuke") { E.place = G.place; E.crowd = G.kind; E.who = G.who; E.side = G.side; }
    const a = S.aff[r];
    const T = toll();
    if (to === DEAD) {
      if (lf === HURT) { G.hurt--; T.hurt--; if (S.evt[r] === E.id) E.hurt--; }
      E.dead++; E.byAff[a] = (E.byAff[a] | 0) + 1;
      G.dead++; deadN++; T.dead++;
      // someone shot in their seat goes down where they sat, onto the tread
      if (S.clip[r] === CLIP.sit || S.clip[r] === CLIP.sitCheer) S.y[r] -= 0.4;
      S.life[r] = DEAD; S.deadT[r] = CLOCK; S.vx[r] = 0; S.vz[r] = 0; S.panicT[r] = 0;
      S.clip[r] = CLIP.down; S.rate[r] = 0; S.pnow[r] = 0;
      S.yaw[r] = h01(r, E.id, 7) * TAU;
      if (inAct[r]) inAct[r] = 0;
    } else {
      E.hurt++; G.hurt++; T.hurt++;
      S.life[r] = HURT; S.hurtT[r] = 6 + h01(r, E.id, 3) * 14; S.evt[r] = E.id;
      const crawl = h01(r, E.id, 5) < 0.55;
      S.clip[r] = crawl ? CLIP.crawl : CLIP.limp; S.pnow[r] = 1;
      if (o.fromX != null) { S.fleeX[r] = o.fromX; S.fleeZ[r] = o.fromZ; }
      activate(r);
    }
    S.own[r] = 0;                     // the hurt and the dead are this file's
    G.dirty = true; hashAge = 1e9;
    // blood where they fell, near the lens, pooled (systems/gore.js)
    if (to === DEAD && CBZ.gorePool && _gore.n < 40) {
      const cam = CBZ.camera && CBZ.camera.position;
      if (cam && Math.hypot(S.wx[r] - cam.x, S.wz[r] - cam.z) < 60) { _gore.n++; try { CBZ.gorePool(S.wx[r], S.wz[r], 0.8 + h01(r, 3, 9) * 0.9); } catch (e) {} }
    }
    if (G.onLife) { try { G.onLife(r, to, cause); } catch (e) {} }
    return true;
  }

  // ---------------------------------------------------------------- panic
  const act = new Int32Array(CAP), inAct = new Uint8Array(CAP);
  let nAct = 0;
  function activate(r) { if (!inAct[r]) { inAct[r] = 1; act[nAct++] = r; } }
  function panic(x, z, R, o) {
    o = o || {};
    let n = 0;
    const R2 = R * R;
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const G = GROUPS[gi];
      if (!G || !G.lifeOn || !modeOk(G)) continue;
      mw(G);
      let hitG = false;
      const L = G.rows;
      for (let k = 0; k < L.length; k++) {
        const r = L[k];
        if (S.life[r] !== ALIVE || S.hide[r]) continue;
        toWorld(G, r);
        const dx = S.wx[r] - x, dz = S.wz[r] - z;
        if (dx * dx + dz * dz > R2) continue;
        S.panicT[r] = Math.max(S.panicT[r], (o.secs || 9) + h01(r, SEQ, 11) * 6);
        S.fleeX[r] = x; S.fleeZ[r] = z;
        activate(r);                  // an owner runs its own; the clock and the crush are counted here
        hitG = true; n++;
      }
      if (hitG && G.onPanic) { try { G.onPanic(x, z, R); } catch (e) {} }
    }
    return n;
  }

  // ---------------------------------------------------------------- the damage path
  function liveRows(fn) {
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const G = GROUPS[gi];
      if (!G || !G.lifeOn || !modeOk(G)) continue;
      mw(G);
      const L = G.rows;
      for (let k = L.length - 1; k >= 0; k--) {
        const r = L[k], lf = S.life[r];
        if ((lf !== ALIVE && lf !== HURT) || S.hide[r]) continue;
        toWorld(G, r);
        fn(r, G);
      }
    }
  }
  // the near ones get the real gore (a few per event; the rest pool)
  function goreAt(r, boom) {
    if (!CBZ.gore || _gore.n > 8) return;
    const cam = CBZ.camera && CBZ.camera.position;
    if (!cam || Math.hypot(S.wx[r] - cam.x, S.wz[r] - cam.z) > 40) return;
    _gore.n++;
    try { CBZ.gore(S.wx[r], S.wy[r] + 1, S.wz[r], { explosion: !!boom, amount: boom ? 1 : 0.8 }); } catch (e) {}
  }

  /* blast(x, z, R, power, o): the lethal core is 0.55 R (crashfx's own rule,
     the owner's "realistic lethality"); past it the dead thin out to the rim
     and the hurt carry on to 1.8 R. Everyone alive out to 5 R (30..260 m)
     runs. o: cause, byPlayer, by, place. */
  function blast(x, z, R, power, o) {
    o = o || {};
    if (!(R > 0) || live <= 0) return { dead: 0, hurt: 0 };
    const cause = o.cause || "explosion";
    if (/nuclear/.test(cause) && !o.force) return { dead: 0, hurt: 0 };   // nuke() owns the bomb
    const LR = R * 0.55, HR = R * 1.8, HR2 = HR * HR, salt = SEQ++;
    const ev = { byPlayer: !!o.byPlayer, by: o.by || null, place: o.place || null, fromX: x, fromZ: z, x: x, z: z };
    let dead = 0, hurt = 0;
    liveRows(function (r) {
      const dx = S.wx[r] - x, dz = S.wz[r] - z, d2 = dx * dx + dz * dz;
      if (d2 > HR2) return;
      const d = Math.sqrt(d2), u = h01(r, salt, 1);
      let to = 0;
      if (S.life[r] === HURT) { if (d < LR || (d < R && u < 0.4)) to = DEAD; }
      else if (d < LR * 0.6) to = DEAD;
      else if (d < LR) to = u < 0.85 ? DEAD : HURT;
      else if (d < R) { const k = 1 - (d - LR) / Math.max(0.1, R - LR); to = u < 0.45 * k * k ? DEAD : u < 0.2 + 0.75 * k ? HURT : 0; }
      else { const k = 1 - (d - R) / Math.max(0.1, HR - R); to = u < 0.35 * k ? HURT : 0; }
      if (!to) return;
      if (to === DEAD && d > 0.5) {
        // thrown a little way out from the seat of the blast
        const G = GROUPS[S.grp[r]], th = Math.max(0, 1 - d / R) * 3.5 * Math.min(2, power || 1);
        if (th > 0.1) { const l = dirLocal(G, dx / d, dz / d, _dl); S.x[r] += l[0] * th; S.z[r] += l[1] * th; }
      }
      if (casualty(r, to, cause, ev)) { if (to === DEAD) { dead++; if (d < R * 0.8) goreAt(r, true); } else hurt++; }
    });
    panic(x, z, Math.min(260, Math.max(30, R * 5)), { secs: 10 });
    return { dead: dead, hurt: hurt };
  }
  const _dl = [0, 0];
  // a propagating blast band (impactbus waves): r0..r1 at kill chance pk
  function ring(x, z, r0, r1, pk, o) {
    o = o || {};
    if (live <= 0 || !(r1 > r0)) return { dead: 0, hurt: 0 };
    const cause = o.cause || "explosion", salt = (o.salt | 0) || SEQ++;
    const ev = { byPlayer: !!o.byPlayer, by: o.by || null, fromX: x, fromZ: z, x: x, z: z };
    let dead = 0, hurt = 0;
    liveRows(function (r) {
      const d = Math.hypot(S.wx[r] - x, S.wz[r] - z);
      if (d < r0 || d >= r1) return;
      const u = h01(r, salt, 2);
      const to = u < pk ? DEAD : u < pk + (1 - pk) * 0.5 ? HURT : 0;
      if (to && casualty(r, to, cause, ev)) { if (to === DEAD) dead++; else hurt++; }
    });
    if (r1 > 20) panic(x, z, Math.min(400, r1 * 1.8), { secs: 12 });
    return { dead: dead, hurt: hurt };
  }

  /* THE NUKE. Everyone inside the 5 psi ring dies at once; out to 1 psi the
     measured Hiroshima curve (city/nukefx.js nukeLethalAt) decides, and most
     of the rest are hurt. Counted BY RING. Where the bomb fell on a city with
     a population (city/metro.js's planned cities), the headline figure is the
     city's own people under those rings, not just the crowds drawn. */
  const RING_NAMES = ["fireball", "psi20", "psi10", "psi5", "psi2", "psi1"];
  function rings(fireR) {
    if (CBZ.nukeRings) { try { const T = CBZ.nukeRings(fireR); if (T) return T; } catch (e) {} }
    const k = Math.max(0.05, fireR / 126);
    return { fireball: fireR, psi20: 504 * k, psi10: 756 * k, psi5: 1109 * k, psi2: 2016 * k, psi1: 3276 * k };
  }
  function lethal(d, fireR, T) {
    if (CBZ.nukeLethalAt) { try { const v = CBZ.nukeLethalAt(d, fireR); if (isFinite(v)) return Math.max(0, Math.min(1, v)); } catch (e) {} }
    if (d <= T.psi5) return 1;
    if (d <= T.psi2) return 0.5;
    if (d <= T.psi1) return 0.1;
    return 0;
  }
  function ringOf(d, T) { for (let i = 0; i < RING_NAMES.length; i++) if (d <= T[RING_NAMES[i]]) return i; return 6; }
  function cityAt(x, z) {
    const L = CBZ.metroCities || [];
    let best = null, bd = 1e18;
    for (let i = 0; i < L.length; i++) {
      const M = L[i], st = M && M.plan && M.plan.stats, f = st && st.footprint;
      if (!f || !(st.population > 0)) continue;
      const cx = Math.max(f.minX, Math.min(f.maxX, x)), cz = Math.max(f.minZ, Math.min(f.maxZ, z));
      const d = (cx - x) * (cx - x) + (cz - z) * (cz - z);
      if (d < bd) { bd = d; best = M; }
    }
    return best ? { M: best, d: Math.sqrt(bd) } : null;
  }
  // the city's own people under the rings: its population spread over its footprint
  function estimate(x, z, fireR, T) {
    const c = cityAt(x, z);
    if (!c || c.d > T.psi1) return null;
    const st = c.M.plan.stats, f = st.footprint;
    const W = Math.max(1, f.maxX - f.minX), D = Math.max(1, f.maxZ - f.minZ);
    const dens = st.population / (W * D);
    const step = Math.max(20, Math.sqrt(W * D / 6000));
    let dead = 0, hurt = 0;
    for (let gx = f.minX + step / 2; gx < f.maxX; gx += step) for (let gz = f.minZ + step / 2; gz < f.maxZ; gz += step) {
      const d = Math.hypot(gx - x, gz - z);
      if (d > T.psi1) continue;
      const people = dens * step * step;
      const pk = d <= T.psi5 ? 1 : lethal(d, fireR, T);
      dead += people * pk;
      hurt += people * (1 - pk) * (d <= T.psi2 ? 0.8 : 0.4);
    }
    return { city: c.M.name || null, population: st.population, dead: Math.round(dead), hurt: Math.round(hurt) };
  }
  function nuke(x, z, o) {
    o = o || {};
    const fireR = o.fireR > 0 ? o.fireR : 126;
    const T = rings(fireR);
    const est = estimate(x, z, fireR, T);
    const E = newEvent("nuclear blast", x, z, null, { byPlayer: !!o.byPlayer, by: o.by || null });
    E.rings = [0, 0, 0, 0, 0, 0];
    E.est = est; E.city = est && est.city ? est.city : null;
    if (!E.place) E.place = o.place || E.city || null;
    const ev = { event: E, byPlayer: !!o.byPlayer, by: o.by || null, fromX: x, fromZ: z };
    const salt = SEQ++;
    let dead = 0, hurt = 0;
    _gore.n = 99;                             // no gore storm: the whole field goes at once
    liveRows(function (r) {
      const d = Math.hypot(S.wx[r] - x, S.wz[r] - z);
      const ri = ringOf(d, T);
      if (ri >= 6) return;
      const u = h01(r, salt, 4);
      let to = 0;
      if (ri <= 3) to = DEAD;
      else { const pk = lethal(d, fireR, T); to = u < pk ? DEAD : u < pk + (1 - pk) * (ri === 4 ? 0.8 : 0.45) ? HURT : 0; }
      if (S.life[r] === HURT && to) to = DEAD;
      if (to && casualty(r, to, "nuclear blast", ev)) { if (to === DEAD) { dead++; E.rings[ri]++; } else hurt++; }
    });
    panic(x, z, T.psi1 * 1.6, { secs: 20 });
    E.t1 = CLOCK - 2;                          // report at once
    return { dead: dead, hurt: hurt, rings: E.rings.slice(), est: est, event: E.id };
  }

  /* a round lands on a row: a head shot or a second hit kills; a body shot
     kills about half the time and drops the rest. o: head, cal, cause,
     byPlayer, by, fromX, fromZ */
  function shoot(r, o) {
    o = o || {};
    if (r < 0 || r >= CAP) return 0;
    const lf = S.life[r];
    if (lf !== ALIVE && lf !== HURT) return 0;
    const u = h01(r, SEQ++, 6), cal = o.cal || 1;
    const to = lf === HURT ? (u < 0.8 ? DEAD : 0) : (o.head ? (u < 0.95 ? DEAD : HURT) : (u < 0.42 + 0.12 * Math.min(2, cal) ? DEAD : HURT));
    if (!to) return 0;
    const G = GROUPS[S.grp[r]]; if (G) { mw(G); toWorld(G, r); }
    const cause = o.cause || (o.byPlayer ? "gunfire" : "gunfire");
    casualty(r, to, cause, { byPlayer: !!o.byPlayer, by: o.by || null, fromX: o.fromX, fromZ: o.fromZ });
    // the people round them run (a crowd under fire breaks)
    const px = S.wx[r], pz = S.wz[r];
    if (CLOCK - lastShotPanic > 0.35 || Math.hypot(px - lspX, pz - lspZ) > 20) {
      lastShotPanic = CLOCK; lspX = px; lspZ = pz;
      panic(o.fromX != null ? o.fromX : px, o.fromZ != null ? o.fromZ : pz, 45, { secs: 9 });
    }
    return to;
  }
  let lastShotPanic = -1e9, lspX = 0, lspZ = 0;

  // a car through them: o: speed (m/s), byPlayer, heading {x,z}
  function runOver(x, z, r, speed, o) {
    o = o || {};
    if (live <= 0 || !(speed > 4)) return 0;
    ensureHash();
    const q = ++qid, R = r || 1.7, salt = SEQ++;
    let n = 0;
    const ev = { byPlayer: !!o.byPlayer, by: o.by || null, fromX: x, fromZ: z, x: x, z: z };
    const c0x = Math.floor((x - R) / CELL), c1x = Math.floor((x + R) / CELL), c0z = Math.floor((z - R) / CELL), c1z = Math.floor((z + R) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      let rr = head[cellKey(cx, cz)];
      while (rr >= 0) {
        const nx_ = nxt[rr];
        if (stamp[rr] !== q) {
          stamp[rr] = q;
          const dx = S.wx[rr] - x, dz = S.wz[rr] - z;
          if (dx * dx + dz * dz < R * R && (S.life[rr] === ALIVE || S.life[rr] === HURT)) {
            const u = h01(rr, salt, 8);
            const to = speed >= 13 ? (u < 0.8 ? DEAD : HURT) : speed >= 8 ? (u < 0.3 ? DEAD : HURT) : HURT;
            // knocked aside off the bonnet
            const G = GROUPS[S.grp[rr]], d = Math.hypot(dx, dz) || 1;
            if (G) { const l = dirLocal(G, dx / d, dz / d, _dl); const th = 0.6 + speed * 0.12; S.x[rr] += l[0] * th; S.z[rr] += l[1] * th; }
            if (casualty(rr, to, "car crash", ev)) { n++; if (to === DEAD) goreAt(rr, false); }
          }
        }
        rr = nx_;
      }
    }
    if (n) panic(x, z, 25, { secs: 8 });
    return n;
  }

  // a promoted rig died (mob.js): its body is the rig's; the count is the crowd's
  function noteDead(r, cause, o) {
    if (r < 0 || S.life[r] === DEAD || S.life[r] === FREE) return false;
    const G = GROUPS[S.grp[r]]; if (!G) return false;
    mw(G); toWorld(G, r);
    // only when something is already being counted round here: a lone
    // killing near the march is the ordinary death ledger's story
    let open = null;
    for (let i = EVENTS.length - 1; i >= 0; i--) {
      const E = EVENTS[i];
      if (!E.closed && CLOCK - E.t1 < EV_JOIN_T && Math.hypot(E.x - S.wx[r], E.z - S.wz[r]) < EV_JOIN_R) { open = E; break; }
    }
    S.hide[r] = 1;
    if (!open) { S.life[r] = DEAD; S.deadT[r] = CLOCK; G.dead++; deadN++; toll().dead++; return true; }
    return casualty(r, DEAD, cause || open.cause, Object.assign({ event: open }, o || {}));
  }

  // ---------------------------------------------------------------- the store's own motion: the panicked, the hurt, the stampede
  const _ld = [0, 0];
  let actAcc = 0, trampleRR = 0;
  function tickActive(dt) {
    let w = 0;
    let crowded = false;
    for (let k = 0; k < nAct; k++) {
      const r = act[k];
      if (!inAct[r]) continue;
      const lf = S.life[r], G = GROUPS[S.grp[r]];
      if (!G || lf === FREE || lf === DEAD) { inAct[r] = 0; continue; }
      let keep = false;
      if (lf === ALIVE && S.panicT[r] > 0) {
        S.panicT[r] -= dt;
        if (S.own[r]) { keep = S.panicT[r] > 0; crowded = true; }
        else if (S.panicT[r] <= 0) { S.vx[r] = 0; S.vz[r] = 0; S.clip[r] = CLIP.idle; S.rate[r] = 0.25; S.pnow[r] = 0; G.dirty = true; }
        else {
          // run from the point, each on a line of their own
          mw(G); toWorld(G, r);
          let dx = S.wx[r] - S.fleeX[r], dz = S.wz[r] - S.fleeZ[r];
          const a = (h01(r, 13, 2) - 0.5) * 0.9, c = Math.cos(a), s = Math.sin(a);
          const l0 = Math.hypot(dx, dz) || 1; dx /= l0; dz /= l0;
          const rx = dx * c - dz * s, rz = dx * s + dz * c;
          const l = dirLocal(G, rx, rz, _ld);
          const seated = S.clip[r] === CLIP.sit || S.clip[r] === CLIP.sitCheer;
          const sp = (seated ? 2.2 : 3.6) + h01(r, 17, 3) * 1.0;
          S.vx[r] = l[0] * sp; S.vz[r] = l[1] * sp;
          S.x[r] += S.vx[r] * dt; S.z[r] += S.vz[r] * dt; S.posT[r] = CLOCK;
          S.yaw[r] = Math.atan2(S.vx[r], S.vz[r]);
          gaits();
          S.phase[r] = ((S.phase[r] + dt * sp * GAITR / TAU) % 1 + 1) % 1;
          S.clip[r] = CLIP.run; S.rate[r] = sp * GAITR / TAU; S.pnow[r] = 1;
          keep = true; crowded = true;
        }
      } else if (lf === HURT) {
        if (S.hurtT[r] > 0) {
          S.hurtT[r] -= dt;
          mw(G); toWorld(G, r);
          let dx = S.wx[r] - S.fleeX[r], dz = S.wz[r] - S.fleeZ[r];
          const l0 = Math.hypot(dx, dz) || 1; dx /= l0; dz /= l0;
          const l = dirLocal(G, dx, dz, _ld);
          const crawl = S.clip[r] === CLIP.crawl;
          const sp = crawl ? 0.32 : 0.6;
          gaits();
          S.vx[r] = l[0] * sp; S.vz[r] = l[1] * sp;
          S.x[r] += S.vx[r] * dt; S.z[r] += S.vz[r] * dt; S.posT[r] = CLOCK;
          S.yaw[r] = Math.atan2(S.vx[r], S.vz[r]);
          const rpm = crawl ? GAITC : GAITL;
          S.phase[r] = ((S.phase[r] + dt * sp * rpm / TAU) % 1 + 1) % 1; S.rate[r] = sp * rpm / TAU; S.pnow[r] = 1;
          if (S.hurtT[r] <= 0) {
            // down where they got to: sat on the ground, hurt
            S.vx[r] = 0; S.vz[r] = 0;
            S.clip[r] = CLIP.sit; S.rate[r] = 0.25; S.pnow[r] = 0; S.y[r] -= 0.45;
            G.dirty = true;
          } else keep = true;
        }
      }
      if (keep) act[w++] = r; else inAct[r] = 0;
    }
    nAct = w;
    if (crowded) trample(dt);
  }
  /* THE STAMPEDE. Running people packed past ~5 to a 0.75 m circle knock each
     other down; a fallen person with runners over them is trampled. Bounded:
     a slice of the runners each tick. */
  function trample(dt) {
    ensureHash();
    const n = nAct, per = Math.min(n, 1600);
    for (let j = 0; j < per; j++) {
      trampleRR = (trampleRR + 1) % Math.max(1, n);
      const r = act[trampleRR];
      if (!inAct[r] || S.life[r] !== ALIVE || S.panicT[r] <= 0) continue;
      const sp = Math.hypot(S.vx[r], S.vz[r]);
      if (sp < 2.4) continue;
      const cx = Math.floor(S.wx[r] / CELL), cz = Math.floor(S.wz[r] / CELL);
      let near = 0, fallen = -1;
      for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
        let q = head[cellKey(cx + ox, cz + oz)];
        while (q >= 0) {
          if (q !== r) {
            const dx = S.wx[q] - S.wx[r], dz = S.wz[q] - S.wz[r], d2 = dx * dx + dz * dz;
            if (d2 < 0.5625) { if (S.life[q] === HURT) fallen = q; else near++; }
          }
          q = nxt[q];
        }
      }
      const kdt = dt * n / Math.max(1, per);
      if (fallen >= 0 && h01(fallen, SEQ++, 9) < 0.035 * kdt) casualty(fallen, DEAD, "stampede", { fromX: S.fleeX[r], fromZ: S.fleeZ[r] });
      else if (near >= 5 && h01(r, SEQ++, 10) < 0.012 * (near - 4) * kdt) casualty(r, HURT, "stampede", { fromX: S.fleeX[r], fromZ: S.fleeZ[r] });
    }
  }

  // ---------------------------------------------------------------- the bodies go, the count stays
  let cleanT = 0;
  function cleanup() {
    const cam = CBZ.camera && CBZ.camera.position;
    let over = deadN - DEAD_CAP;
    for (let gi = 0; gi < GROUPS.length; gi++) {
      const G = GROUPS[gi]; if (!G || G.frame) continue;
      mw(G);
      const L = G.rows;
      for (let k = L.length - 1; k >= 0; k--) {
        const r = L[k];
        if (S.life[r] !== DEAD) continue;
        const age = CLOCK - S.deadT[r];
        if (age < BODY_TTL && !(over > 0 && age > 20)) continue;
        if (cam) { toWorld(G, r); if (Math.hypot(S.wx[r] - cam.x, S.wz[r] - cam.z) < 40) continue; }
        remove(G, r); over--;
      }
      if (G.released && !G.rows.length) dispose(G);
    }
  }

  // ---------------------------------------------------------------- the report
  function fmt(n) { n = Math.round(n); return n.toLocaleString ? n.toLocaleString("en-US") : String(n); }
  function placeOf(E) {
    if (E.place) return E.place;
    if (CBZ.cityZoneAt) { try { const z = CBZ.cityZoneAt(E.x, E.z); if (z && z.name) return String(z.name).toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); } catch (e) {} }
    return null;
  }
  function round2(n) { if (n >= 10000) return Math.round(n / 1000) * 1000; if (n >= 1000) return Math.round(n / 100) * 100; return n; }
  // the record the news phrases (newsroom.js massHeadline)
  function snapshot(E) {
    let dead = E.dead, hurt = Math.max(0, E.hurt);
    if (E.family === "nuke" && E.est) { dead = round2(Math.max(dead, E.est.dead)); hurt = round2(Math.max(hurt, E.est.hurt)); }
    let top = null, tn = 0;
    for (const c in E.causes) if (E.causes[c] > tn && c !== "stampede") { tn = E.causes[c]; top = c; }
    return {
      id: E.id, family: E.family, cause: top || E.cause, dead: dead, hurt: hurt, place: placeOf(E), crowd: E.crowd, who: E.who, side: E.side,
      byPlayer: E.byPlayer, by: E.by, city: E.city, rings: E.rings ? E.rings.slice() : null, trampled: E.causes.stampede | 0,
      drawnDead: E.dead,
    };
  }
  function ledgerCause(M) {
    if (M.family === "nuke") return "nuclear blast";
    if (M.family === "stampede") return "stampede";
    if (M.family === "car") return "car crash";
    if (M.family === "shooting") return M.byPlayer ? "murder" : M.by === "police" ? "police" : "gunfire";
    if (M.family === "blast") return /air|missile|rocket/.test(M.cause) ? "airstrike" : /terror|bomb|c4/.test(M.cause) ? "terrorist attack" : "explosion";
    return M.cause || "killed";
  }
  function report(E) {
    E.reports++;
    const M = snapshot(E);
    const nNew = Math.max(0, M.dead - E.said.dead);
    E.said.dead = M.dead; E.said.hurt = M.hurt;
    const T = toll();
    // the death ledger: ONE entry carrying the count (newsroom.js phrases it)
    const label = M.dead === 1 ? "1 person" : fmt(M.dead) + " people";
    if (CBZ.cityLogDeath) {
      try { CBZ.cityLogDeath(label, ledgerCause(M), { n: nNew, mass: M, by: M.byPlayer ? "You" : (M.by === "police" ? "Police" : M.by === "army" ? "Soldiers" : null) }); } catch (e) {}
    } else if (CBZ.news && CBZ.news.push && CBZ.news.massHeadline) {
      try { CBZ.news.push(CBZ.news.massHeadline(M), { kind: M.dead >= 5 ? "breaking" : "story", cat: "NATION", tag: "mass:" + M.id }); } catch (e) {}
    }
    // the record that outlives the bodies
    let rec = null;
    for (let i = 0; i < T.events.length; i++) if (T.events[i].id === E.id) { rec = T.events[i]; break; }
    if (!rec) { rec = { id: E.id }; T.events.push(rec); if (T.events.length > 24) T.events.shift(); }
    rec.family = M.family; rec.cause = M.cause; rec.dead = M.dead; rec.hurt = M.hurt; rec.place = M.place; rec.crowd = M.crowd;
    rec.day = CBZ.worldDay ? (function () { try { return CBZ.worldDay() | 0; } catch (e) { return 0; } })() : 0;
    if (CBZ.news && CBZ.news.massHeadline) { try { rec.h = CBZ.news.massHeadline(M); } catch (e) {} }
    price(E, M);
    if (CBZ.presidency && CBZ.presidency.emit) { try { CBZ.presidency.emit("casualties", { id: E.id, dead: M.dead, hurt: M.hurt, place: M.place, family: M.family, news: false }); } catch (e) {} }
  }
  /* THE COUNTRY REACTS, by who died. Each affiliation's new dead are one
     politics act ("kill", the group or institution as target), its weight
     the size of the toll (log: ten dead is news, ten thousand is a turning
     point). Done by your hand or on an order: blamed. Done by someone else:
     the groups mourn and the government that let it happen pays a little. */
  function price(E, M) {
    const P = CBZ.politics;
    if (!P || !P.act) return;
    const by = E.byPlayer ? "self" : (E.by && /^(police|army|fbi|cia|ss)$/.test(E.by) ? E.by : null);
    let fresh = 0;
    for (let a = 0; a < E.byAff.length; a++) {
      const n = (E.byAff[a] | 0) - (E.pricedAff[a] | 0);
      if (n <= 0) continue;
      E.pricedAff[a] = E.byAff[a] | 0;
      fresh += n;
      const A = AFFS[a];
      const target = A && (A.ideology || A.inst);
      if (!target || !by) continue;
      const scale = Math.min(2.6, Math.log(1 + n) / Math.LN10 / 1.6);
      try { P.act("kill", { target: target, by: by, blame: true, scale: scale, quiet: true, place: M.place || null }); } catch (e) {}
    }
    // the estimated dead past the drawn crowd (a nuke on a city)
    if (M.family === "nuke" && E.est && !E.estPriced) { E.estPriced = true; fresh += Math.max(0, M.dead - E.dead); }
    if (fresh > 0 && P.shock) {
      const k = Math.log(1 + fresh) / Math.LN10;
      try { P.shock(-Math.min(by ? 16 : 9, k * (by ? 4 : 2.2))); } catch (e) {}
    }
  }
  let repAcc = 0;
  function tickEvents() {
    for (let i = 0; i < EVENTS.length; i++) {
      const E = EVENTS[i];
      if (E.closed) continue;
      const idle = CLOCK - E.t1;
      const M_dead = E.family === "nuke" && E.est ? Math.max(E.dead, E.est.dead) : E.dead;
      // the first word needs two dead or five hurt (one killing is the
      // ordinary death ledger's); after that, each time the toll grows a quarter
      const grew = E.reports === 0 ? (M_dead >= 2 || E.hurt >= 5 || E.family === "nuke")
        : (M_dead >= E.said.dead * 1.25 + 1 || E.hurt >= E.said.hurt * 1.5 + 5);
      if ((idle > 1.2 || CLOCK - E.t0 > 5) && grew && (M_dead + E.hurt) > 0) report(E);
      if (idle > 90) E.closed = true;
    }
  }

  // ---------------------------------------------------------------- THE CUT (drawing through crowdgpu)
  function camPos() { const c = CBZ.camera; return c && c.position ? c.position : null; }
  function cut(G, cam) {
    const CG = CBZ.crowdGPU;
    if (!CG || !CG.layer) return 0;
    if (!G.layer) {
      if (CG.ok && !CG.ok()) return 0;
      G.layer = CG.layer({ name: G.name, cap: G.cap, parent: G.parent || CBZ.scene, maxDraw: G.maxDraw });
      if (!G.layer) return 0;
      gaits();
    }
    if (!modeOk(G)) { G.layer.clear(); G.lastCut = CLOCK; return 0; }
    if (G.beforeCut) { try { G.beforeCut(); } catch (e) {} }
    const L = G.layer, now = gpuNow();
    L.begin();
    const rows = G.rows;
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      if (S.hide[r] || S.look[r] < 0) continue;
      const lf = S.life[r];
      if (lf === DEAD) { L.add(S.x[r], S.y[r], S.z[r], S.yaw[r], S.look[r], CLIP.down, 0, 0, S.scale[r]); continue; }
      const rate = S.rate[r];
      let ph = S.pnow[r] ? S.phase[r] - now * rate : S.phase[r];
      let x = S.x[r], z = S.z[r];
      if ((S.vx[r] !== 0 || S.vz[r] !== 0) && S.posT[r] > 0) {
        // a moving body is written every few ticks (an owner's far band, this
        // file's 10 Hz runners): draw it on along its velocity from when it
        // was last written (the GPU carries on from here)
        const age = Math.min(0.6, Math.max(0, CLOCK - S.posT[r]));
        x += S.vx[r] * age; z += S.vz[r] * age; ph += age * rate;
      }
      L.add(x, S.y[r], z, S.yaw[r], S.look[r], S.clip[r], ph, rate, S.scale[r], S.vx[r], S.vz[r]);
    }
    L.commit(cam && cam.isCamera ? cam : null);
    G.dirty = false; G.lastCut = CLOCK;
    const c = camPos(); if (c) { G.cutX = c.x; G.cutZ = c.z; }
    return rows.length;
  }
  let rr0 = 0;
  function cutAll() {
    const c = camPos();
    let budget = CUT_BUDGET, did = 0;
    const n = GROUPS.length;
    for (let j = 0; j < n; j++) {
      const G = GROUPS[(rr0 + j) % n];
      if (!G || G.frame || G.gone || !G.shown) continue;
      const age = CLOCK - G.lastCut;
      const moved = c ? Math.hypot(c.x - G.cutX, c.z - G.cutZ) : 0;
      const moving = G.own || G.moving || anyActive(G);
      const want = G.dirty && age > 0.05 || (moving && age >= G.cutDt) || (moved > 2.5 && age > 0.2) || (moved > 0.5 && age > 0.6) || age > 2;
      if (!want) continue;
      if (G.rows.length > budget && did > 0 && age < 0.6) continue;
      budget -= G.rows.length; did++;
      cut(G, null);
    }
    rr0 = n ? (rr0 + 1) % n : 0;
  }
  function anyActive(G) {
    // a still crowd with people running / crawling in it moves this cut
    if (!nAct) return false;
    const L = G.rows;
    for (let k = 0; k < L.length && k < 4096; k += 7) if (inAct[L[k]]) return true;
    return false;
  }

  // ---------------------------------------------------------------- the frame
  function frame(dt) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    CLOCK += dt; hashAge += dt; _gore.n = 0;
    if (!live && !EVENTS.length) return;
    actAcc += dt;
    if (actAcc >= 0.1) { const d = actAcc; actAcc = 0; if (nAct) tickActive(d); }
    repAcc += dt;
    if (repAcc >= 0.5) { repAcc = 0; tickEvents(); }
    cleanT += dt;
    if (cleanT >= 5) { cleanT = 0; cleanup(); }
    cutAll();
  }
  if (CBZ.onUpdate) CBZ.onUpdate(38.9, frame);

  // ---------------------------------------------------------------- public
  CBZ.crowds = {
    S: S, FREE: FREE, ALIVE: ALIVE, HURT: HURT, DEAD: DEAD, CLIP: CLIP,
    cap: function () { return CAP; }, device: DEVICE, clock: function () { return CLOCK; }, hi: function () { return hi; }, live: function () { return live; }, room: function () { return nFree; },
    group: group, aff: aff, affOf: function (i) { return AFFS[i] || null; }, clip: clipIx,
    blast: blast, ring: ring, nuke: nuke, ray: ray, shoot: shoot, runOver: runOver, panic: panic, noteDead: noteDead,
    kill: function (r, cause, o) { return casualty(r, DEAD, cause || "violence", o || {}); },
    hurt: function (r, cause, o) { return casualty(r, HURT, cause || "violence", o || {}); },
    life: function (r) { return S.life[r]; },
    alive: function (r) { return S.life[r] === ALIVE; },
    events: function () { return EVENTS.map(snapshot); },
    toll: function () { const T = toll(); return { dead: T.dead, hurt: T.hurt, events: T.events.slice() }; },
    groups: function () { return GROUPS.filter(Boolean).map(function (G) { return { name: G.name, kind: G.kind, place: G.place, rows: G.rows.length, dead: G.dead, hurt: G.hurt, drawn: G.layer ? G.layer.drawn.slice(1) : null }; }); },
    audit: function () {
      let alive = 0, hurt = 0, dead = 0;
      for (let r = 0; r < hi; r++) { const l = S.life[r]; if (l === ALIVE) alive++; else if (l === HURT) hurt++; else if (l === DEAD) dead++; }
      return { device: DEVICE, cap: CAP, rows: live, alive: alive, hurt: hurt, dead: dead, groups: GROUPS.filter(Boolean).length, active: nAct, events: EVENTS.length, cutBudget: CUT_BUDGET, bodyTtl: BODY_TTL };
    },
    _step: frame,
    _report: function () { for (let i = 0; i < EVENTS.length; i++) EVENTS[i].t1 -= 10; tickEvents(); },
    _reset: function () { for (let i = 0; i < GROUPS.length; i++) if (GROUPS[i]) dispose(GROUPS[i]); EVENTS.length = 0; nAct = 0; },
  };
})();
