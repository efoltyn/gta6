/* ============================================================
   city/fracture.js — WALL HOLES THAT PERSIST. buildings.js owns the carve
   primitive (CBZ.cityCarveWall: pick the wall, ask the charge law, open it,
   shed its material); this file owns the POLICY around it:
     • blastAt(pt, opts): an explosion's one wall response. opts.charge (kg
       TNT-equivalent) goes to the carve, which asks systems/breach.js's law
       whether the wall breaches and how big the opening is — or opts.r for a
       caller that already knows the opening (a structural failure, a ram).
       The carve is deferred ONE frame for a live blast (the monolith is heavy;
       the boom, dust and shake already fired this frame, which masks it).
     • chewWall(x,y,z): >25 rifle-class rounds into one 1.2 m wall cell grind
       a murder hole — cover you make, then shoot through.
     • caps: MAX_HOLES live holes; overflow plywoods the OLDEST
       (CBZ.cityBoardHole restores its colliders/LOS and frees the slot).
     • persistence: serialize()/apply()/applyOne() re-carve silently from a
       stable address {b: building key, face, u, v, r, gw?, v0?, v1?} —
       coordinate-keyed, so a streamed-out-and-back lot or a save replays the
       same openings, and the net layer broadcasts new ones via onHole.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const MAX_HOLES = 32;     // overflow: the oldest wound gets boarded over
  const CHEW_N = 25;        // heavy rounds into one cell to open a murder hole
  const CHEW_CELL = 1.2;    // wall-cell quantum (metres)
  const CHEW_TO_LEDGER = 4.5;
  const live = [];          // [{h:addr, rec}] un-boarded holes, oldest first
  const pending = [];       // ledger holes waiting for their wall to exist
  const chew = new Map();   // cellKey -> {n, t} heavy-round accumulation
  let lastX = 0, lastZ = 0, lastT = -1e9;   // last LOCAL blast at a wall (dedupes cityBreach)
  let applying = false;     // replaying a ledger — never re-broadcast
  const deferQ = [];        // one-shot local carves drained next frame
  const DEFER_CELL = 1.4;   // collapse near-coincident blasts (anti double-carve)
  let storeyFx = 3;         // gut bays per drain that get the dust/rebar pour

  function nowS() { return performance.now() / 1000; }
  function mayBreach() { return !!CBZ.game && (CBZ.modeHas ? CBZ.modeHas("breach") : CBZ.game.mode === "city"); }

  // ---- stable hole address -------------------------------------------------
  // b = rounded building-group origin, face = 0:-z 1:+z 2:-x 3:+x, u = opening
  // centre along the face RELATIVE to the building origin, v = world height of
  // the opening centre, r = the carve radius. A storey-wide gut opening also
  // records its exact rect (gw, v0, v1) so it replays at the same size.
  function addrOf(rec, r) {
    const g = rec.gap;
    const uc = (g.u0 + g.u1) / 2, vc = (g.v0 + g.v1) / 2;
    const h = {
      b: Math.round(g.px) + "," + Math.round(g.pz),
      face: g.horiz ? (g.outS < 0 ? 0 : 1) : (g.outS < 0 ? 2 : 3),
      u: Math.round((uc - (g.horiz ? g.px : g.pz)) * 10) / 10,
      v: Math.round(vc * 10) / 10,
      r: Math.round(r * 100) / 100,
    };
    if (rec.rect) {
      h.gw = Math.round((g.u1 - g.u0) * 100) / 100;
      h.v0 = Math.round(g.v0 * 100) / 100; h.v1 = Math.round(g.v1 * 100) / 100;
    }
    return h;
  }

  function adopt(rec, r, quiet) {
    const h = addrOf(rec, r);
    rec.addr = h;
    live.push({ h: h, rec: rec });
    if (live.length > MAX_HOLES) {
      const old = live.shift();
      if (CBZ.cityBoardHole) CBZ.cityBoardHole(old.rec);
    }
    if (!quiet && !applying && CBZ.cityFracture.onHole) {
      try { CBZ.cityFracture.onHole(h); } catch (e) {}
    }
    return h;
  }

  /* What pours out of a real carve: the wall already shed its own material
     (buildings.js cuts the removed volume into pieces of itself), so this adds
     only what a blast adds on top — dust and smoke punching out of the wound,
     dangling rebar off a broken header, and for a bomb-class charge the full
     facade cascade. The tier is the CHARGE, not a power class. */
  function debris(rec, W) {
    const g = rec.gap;
    const uc = (g.u0 + g.u1) / 2, vc = (g.v0 + g.v1) / 2;
    const x = g.horiz ? uc : g.fixed, z = g.horiz ? g.fixed : uc;
    const nx = g.horiz ? 0 : g.outS, nz = g.horiz ? g.outS : 0;
    const width = Math.max(0.5, g.u1 - g.u0);
    const L = CBZ.blastLaw;
    const power = L ? Math.max(0.8, Math.min(2.6, 0.9 * L.cbrt(W || 0.7) + 0.4)) : 1.4;
    const ruinArgs = { power: power, width: width, top: g.v1, bottom: g.v0 };
    if ((W || 0) >= 20 && CBZ.cityHeavyWallRuin) CBZ.cityHeavyWallRuin(x + nx * 0.3, vc, z + nz * 0.3, nx, nz, ruinArgs);
    else if (CBZ.cityWallRuin) CBZ.cityWallRuin(x + nx * 0.3, vc, z + nz * 0.3, nx, nz, ruinArgs);
    if (CBZ.cityBlastWallSoot) { try { CBZ.cityBlastWallSoot(rec, power); } catch (e) {} }
  }

  /* ---- blastAt: THE wall response to one explosion ------------------------
     pt   {x,y,z} (or a raycast hit with .point)
     opts.charge   kg TNT-eq — the law decides breach/no-breach and the size
     opts.contact  stuck to the wall (full coupling)
     opts.standoff a known minimum standoff (m) when the seat is not the charge
     opts.shaped, opts.jetPen   a shaped-charge jet (RPG, HEAT)
     opts.r        explicit opening radius (no law: a structural failure / ram)
     opts.gapW, opts.v0, opts.v1   explicit rect (a gutted storey's bay)
     opts.search   how far off the wall the seat may be (default: the law's
                   scar radius + 1 m, clamped 1.2..4 — a grenade in the middle
                   of the street does not reach across it to open a facade)
     opts.now      carve inline (breach.js's legacy seam, tools)
     opts.quiet    replay: no debris, no broadcast */
  function blastAt(pt, opts) {
    opts = opts || {};
    if (pt && pt.point) pt = pt.point;
    if (!pt || !CBZ.cityCarveWall || !mayBreach()) return null;
    const py = pt.y == null ? 1.4 : pt.y;
    const L = CBZ.blastLaw;
    let search = opts.search;
    if (search == null) {
      search = opts.charge > 0 && L
        ? Math.max(1.2, Math.min(4, L.breachRadius(opts.charge) * 1.6 + 1.0))
        : Math.max(1.6, Math.min(4, (opts.r || 1) + 1.2));
    }
    // arm the dedup THIS frame whatever the carve decides (cityBreach asks)
    lastX = pt.x; lastZ = pt.z; lastT = nowS();
    const job = {
      x: pt.x, y: py, z: pt.z, search: search,
      charge: +opts.charge || 0, contact: !!opts.contact, standoff: +opts.standoff || 0, shaped: !!opts.shaped, jetPen: +opts.jetPen || 0,
      r: +opts.r || 0, gapW: opts.gapW, v0: opts.v0, v1: opts.v1, byPlayer: !!opts.byPlayer, storey: !!opts.storey,
    };
    if (!opts.now && !opts.quiet) { enqueueDefer(job); return null; }
    return carveNow(job, !!opts.quiet);
  }

  function carveNow(j, quiet) {
    const co = { search: j.search, byPlayer: j.byPlayer, quiet: quiet };
    if (j.charge > 0) co.charge = { W: j.charge, contact: j.contact, standoff: j.standoff, shaped: j.shaped, jetPen: j.jetPen };
    if (j.gapW != null) co.gapW = j.gapW;
    if (j.v0 != null) co.v0 = j.v0;
    if (j.v1 != null) co.v1 = j.v1;
    if (j.storey) co.storey = true;
    const rec = CBZ.cityCarveWall(j.x, j.y, j.z, j.r || 1, co);
    if (!rec) return null;
    const r = rec.lawR || j.r || (rec.gap.u1 - rec.gap.u0) / 2;
    const h = adopt(rec, r, quiet);
    // a gutted storey opens many bays in one frame: the first few pour dust
    // and rebar, the rest just open (their own pieces still fall)
    if (!quiet && (!j.storey || storeyFx-- > 0)) debris(rec, j.storey ? 1 : (j.charge || 16 * 0.35 * 1.8 * r * r * r));
    return h;
  }

  function enqueueDefer(j) {
    for (let i = 0; i < deferQ.length; i++) {
      const d = deferQ[i];
      if (Math.abs(d.x - j.x) < DEFER_CELL && Math.abs(d.y - j.y) < DEFER_CELL && Math.abs(d.z - j.z) < DEFER_CELL) {
        // the same wall cell twice inside one frame: one carve, the bigger charge
        if (j.charge > d.charge) { d.charge = j.charge; d.shaped = j.shaped; d.jetPen = j.jetPen; d.contact = d.contact || j.contact; }
        if (j.r > d.r) d.r = j.r;
        return;
      }
    }
    deferQ.push(j);
  }

  function drainDefer() {
    if (!deferQ.length) return;
    if (!CBZ.cityCarveWall || !mayBreach() || !CBZ.colliders || !CBZ.colliders.length) { deferQ.length = 0; return; }
    const todo = deferQ.splice(0, deferQ.length);
    storeyFx = 3;
    for (let i = 0; i < todo.length; i++) { try { carveNow(todo[i], false); } catch (e) {} }
  }

  // did a blast just land at a wall here? (cityBreach asks, so the same event
  // never opens a second hole through the legacy ground pass)
  function recentAt(x, z, withinS) {
    const w = withinS == null ? 0.6 : withinS;
    if (nowS() - lastT > w) return false;
    const dx = x - lastX, dz = z - lastZ;
    return dx * dx + dz * dz < 64;
  }
  function recent(x, z) { return recentAt(x, z, 0.6); }

  // ---- murder holes: sustained heavy fire grinds through concrete ----------
  function prune(t) { chew.forEach(function (c, k) { if (t - c.t > 14) chew.delete(k); }); }
  function chewWall(x, y, z) {
    if (!CBZ.cityCarveWall || !mayBreach()) return null;
    const k = Math.round(x / CHEW_CELL) + "," + Math.round(y / CHEW_CELL) + "," + Math.round(z / CHEW_CELL);
    const t = nowS();
    let c = chew.get(k);
    if (!c) { if (chew.size > 64) prune(t); c = { n: 0, t: t }; chew.set(k, c); }
    if (t - c.t > 14) c.n = 0;
    c.t = t; c.n++;
    if (c.n < CHEW_N) return null;
    chew.delete(k);
    const rec = CBZ.cityCarveWall(x, Math.max(0.6, y), z, 0.55, { search: 1.2 });
    if (!rec) return null;
    lastX = x; lastZ = z; lastT = t;
    const h = adopt(rec, 0.55, false);
    const g = rec.gap, nx = g.horiz ? 0 : g.outS, nz = g.horiz ? g.outS : 0;
    if (CBZ.cityChunk) CBZ.cityChunk(x + nx * 0.3, y, z + nz * 0.3, { count: 3, force: 2, dirx: nx, dirz: nz, material: rec.wall && rec.wall.material });
    // a ground-out hole is real structural loss with no blast behind it — the
    // one path that pays the ledger from here
    if (CBZ.structure && CBZ.structure.hit) { try { CBZ.structure.hit(x, 1.6, z, 0.35 * CHEW_TO_LEDGER, { kind: "chew" }); } catch (e) {} }
    return h;
  }

  // ---- persistence ----------------------------------------------------------
  function serialize() {
    const h = [];
    for (let i = 0; i < live.length; i++) h.push(live[i].h);
    return { v: 2, h: h };
  }
  function same(o, h) { return o.b === h.b && o.face === h.face && Math.abs(o.u - h.u) < 0.6 && Math.abs(o.v - h.v) < 0.8; }
  function has(h) {
    for (let i = 0; i < live.length; i++) if (same(live[i].h, h)) return true;
    for (let i = 0; i < pending.length; i++) if (same(pending[i], h)) return true;
    return false;
  }
  // resolve an address back to a world point on a CURRENT wall box
  function resolve(h) {
    const cols = CBZ.colliders;
    if (!cols || !cols.length) return null;
    let best = null, bs = 1e9;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y1 == null || !c.ref) continue;
      if (h.v < c.y0 - 0.4 || h.v > c.y1 + 0.4) continue;
      if (c.y1 - c.y0 < 0.4) continue;
      const ex = c.maxX - c.minX, ez = c.maxZ - c.minZ;
      if (Math.min(ex, ez) > 1.6) continue;
      const mt = c.ref.material; if (mt && mt.transparent) continue;
      const p = c.ref.parent;
      const px = p ? p.position.x : 0, pz = p ? p.position.z : 0;
      if (Math.round(px) + "," + Math.round(pz) !== h.b) continue;
      const horiz = ex >= ez;
      const fixed = horiz ? (c.minZ + c.maxZ) / 2 : (c.minX + c.maxX) / 2;
      const cOff = horiz ? fixed - pz : fixed - px;
      const face = horiz ? (cOff < 0 ? 0 : 1) : (cOff < 0 ? 2 : 3);
      if (face !== h.face) continue;
      const u = (horiz ? px : pz) + h.u;
      const minU = horiz ? c.minX : c.minZ, maxU = horiz ? c.maxX : c.maxZ;
      const s = u < minU ? minU - u : (u > maxU ? u - maxU : 0);
      if (s < bs) {
        bs = s;
        best = { x: horiz ? u : fixed, z: horiz ? fixed : u, y: Math.max(c.y0 + 0.2, Math.min(c.y1 - 0.2, h.v)) };
      }
    }
    return bs <= 0.5 ? best : null;
  }
  function drain() {
    if (!pending.length || !CBZ.cityCarveWall || !CBZ.colliders || !CBZ.colliders.length) return;
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    const todo = pending.splice(0, pending.length);
    for (let i = 0; i < todo.length; i++) {
      const h = todo[i];
      const pt = resolve(h);
      if (!pt) {
        h._tr = (h._tr || 0) + 1;
        if (h._tr < 40) pending.push(h);    // city (or this slice) still building — retry
        continue;
      }
      applying = true;
      try {
        // an opening that exists was already legal: replay it whatever the
        // wall's thickness (a charge may have opened a pier)
        const o = { search: 1.6, quiet: true, maxThick: 3.0 };
        if (h.gw != null) { o.gapW = h.gw; o.v0 = h.v0; o.v1 = h.v1; o.storey = true; }
        const rec = CBZ.cityCarveWall(pt.x, pt.y, pt.z, h.r || 1.2, o);
        if (rec) adopt(rec, h.r || 1.2, true);
      } catch (e) {}
      applying = false;
    }
  }
  function applyOne(h) {
    if (!h || h.b == null || has(h)) return;
    const p = { b: h.b, face: h.face, u: h.u, v: h.v, r: h.r };
    if (h.gw != null) { p.gw = h.gw; p.v0 = h.v0; p.v1 = h.v1; }
    pending.push(p);
    drain();
  }
  function apply(led) {
    if (!led) return;
    const arr = led.h || led;
    if (!arr || !arr.length) return;
    for (let i = 0; i < arr.length; i++) applyOne(arr[i]);
  }
  /* A lot streamed OUT drops its live holes from the books but keeps their
     addresses pending, so the moment its walls exist again the same openings
     re-carve (drain() retries at 2 Hz). `bkey` is the building key "x,z". */
  function forgetLot(bkey) {
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].h.b !== bkey) continue;
      const h = live[i].h;
      live.splice(i, 1);
      pending.push({ b: h.b, face: h.face, u: h.u, v: h.v, r: h.r, gw: h.gw, v0: h.v0, v1: h.v1 });
    }
  }

  function cleared() { live.length = 0; pending.length = 0; chew.clear(); deferQ.length = 0; lastT = -1e9; }

  let acc = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(8.6, function (dt) {
    if (!pending.length || CBZ.game.mode !== "city") return;
    acc += dt; if (acc < 0.5) return; acc = 0;
    drain();
  });
  if (CBZ.onUpdate) CBZ.onUpdate(8.55, function () { if (deferQ.length) drainDefer(); });

  // ---- CBZ.cityFracture(pos, radius, dir) — the pooled ground DEBRIS BURST ---
  // A detonation away from any wall (a car cooks off, a prop blows): chips of
  // the ground, a dust kick and the glass around it. Never carves.
  function fractureBurst(pos, radius, dir) {
    if (pos && pos.point) pos = pos.point;
    if (!pos || !CBZ.game || CBZ.game.mode !== "city") return;
    const x = pos.x, z = pos.z, y = pos.y == null ? 0.4 : pos.y;
    const r = Math.max(0.6, radius || 2.2);
    const power = Math.min(2.6, 0.7 + r * 0.35);
    let dx = dir ? dir.x : 0, dz = dir ? (dir.z != null ? dir.z : 0) : 0;
    const dl = Math.hypot(dx, dz);
    const biased = dl > 1e-3;
    if (biased) { dx /= dl; dz /= dl; }
    if (CBZ.cityChunk) {
      try {
        CBZ.cityChunk(x, Math.max(0.4, y), z, {
          count: Math.round(4 + power * 4), force: 4 + power * 3,
          dirx: biased ? dx : null, dirz: biased ? dz : null,
        });
      } catch (e) {}
    }
    if (CBZ.cityDustKick) { try { CBZ.cityDustKick(x, y, z, power); } catch (e) {} }
    if (CBZ.cityShatter) { try { CBZ.cityShatter(x, z, 3.0 + r * 1.4); } catch (e) {} }
  }

  const api = fractureBurst;
  api.blastAt = blastAt;
  api.chewWall = chewWall;
  api.serialize = serialize;
  api.apply = apply;
  api.applyOne = applyOne;
  api.forgetLot = forgetLot;
  api.onHole = null;          // net layer assigns: fn(hole) on every NEW local carve
  api.recent = recent;
  api.recentAt = recentAt;
  // a caller that opened the wall itself drops the carve this blast deferred
  api.cancelPendingNear = function (x, z, r) {
    const rr = r == null ? DEFER_CELL : r;
    for (let i = deferQ.length - 1; i >= 0; i--) {
      const d = deferQ[i];
      if (Math.abs(d.x - x) <= rr && Math.abs(d.z - z) <= rr) deferQ.splice(i, 1);
    }
  };
  api.burst = fractureBurst;
  api._adopt = function (rec, r) { return adopt(rec, r || (rec.gap ? (rec.gap.u1 - rec.gap.u0) / 2 : 1.6), false); };
  api._cleared = cleared;
  api.liveCount = function () { return live.length; };
  CBZ.cityFracture = api;
})();
