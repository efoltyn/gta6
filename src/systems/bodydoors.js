/* ============================================================
   systems/bodydoors.js — CBZ.bodyDoors: PEOPLE OPEN DOORS.

   Owner wave (2026-09-30): staff, the Secret Service, guards, cops and
   residents walked into shut doors and stood there. Every door system in
   the engine answered the PLAYER only (an [E], a tap, a card reader that
   saw him); a body walking a route met a shut leaf as a wall, and the
   navigator, which rasterises colliders, planned every route as if each
   shut door were concrete.

   ONE LAYER, EVERY GAME. Door owners declare their doors here through a
   PROVIDER (what a door is for this engine: its collider, open?, open it,
   may THIS person open it); the city's interior door kit
   (city/interior_programs.js CBZ.cityUnitDoors) and the prison's door
   registry (CBZ._prisonDoorSpecs, read below) are the two. Then:

     · CBZ.moves.step (entities/moves.js, which every AI body in every game
       walks through) asks `ahead()` a few times a second: a SHUT door across
       the next stride is opened if this person is cleared for it, and
       refused if not (m.doorBlockT, m.stuckN bumped, a pause): a free
       walker's brain picks another errand, a routed one waits as at any
       sealed door.
     · systems/navgrid.js (one navigator, both games) plans THROUGH a shut
       door this person may open and around one he may not (`passable`).
     · a door a body opened shuts behind it once nobody is in or near the
       doorway (a door the player opened is his and stays as he left it).

   CLEARANCE is the provider's `may(rec, actor)`:
     city   a room of state / an office (free): anybody; the Situation Room
            (secured): the President's staff, the detail, police; a flat:
            whoever carries its key (housing.js hands the tenant one);
     prison a room door with no lock: anybody; a card / key / padlock door:
            officers (CBZ.guards); the Warden's office: the warden; a CELL
            FRONT: nobody. Cell fronts are racked by the schedule, the console
            and the officer's own keys, never by a man walking up to them.
============================================================ */
(function () {
  "use strict";
  const CBZ = (typeof window !== "undefined" ? window : globalThis).CBZ;
  if (!CBZ) return;

  // ---- the registry: every door collider, tagged, in an 8 m hash ---------
  // col._bd = { p: provider, rec }  (the tag is also what navgrid reads)
  const CELL = 8;
  const GRID = new Map();
  const key = (x, z) => Math.floor(x / CELL) + "," + Math.floor(z / CELL);
  function tag(col, p, rec) {
    if (!col || !p) return;
    if (col._bd) { if (col._bd.rec === rec) return; untag(col); }
    col._bd = { p: p, rec: rec };
    col.door = true;
    const k = key((col.minX + col.maxX) / 2, (col.minZ + col.maxZ) / 2);
    let a = GRID.get(k);
    if (!a) GRID.set(k, a = []);
    a.push(col);
  }
  function untag(col) {
    if (!col || !col._bd) return;
    const a = GRID.get(key((col.minX + col.maxX) / 2, (col.minZ + col.maxZ) / 2));
    if (a) { const i = a.indexOf(col); if (i >= 0) a.splice(i, 1); }
    const k = OPENED.findIndex((o) => o.col === col);
    if (k >= 0) OPENED.splice(k, 1);
    col._bd = null;
  }
  function isOpen(col) {
    const e = col && col._bd;
    if (!e) return false;
    try { return !!e.p.isOpen(e.rec); } catch (err) { return false; }
  }
  function may(actor, col) {
    const e = col && col._bd;
    if (!e) return false;
    try { return !!e.p.may(e.rec, actor); } catch (err) { return false; }
  }
  // can THIS person get through this door collider right now (open, or his to open)?
  function passable(actor, col) {
    if (!col || !col._bd) return false;
    return isOpen(col) || may(actor, col);
  }

  // ---- AHEAD: the shut door across the next stride -------------------------
  // segment (px,pz)->(px+hx*L, pz+hz*L) against a box grown by r (slab test).
  // THROUGH the leaf, not past it: the stride must point across the door's
  // thin axis (a man walking along a row of cell fronts a hand off the bars
  // is not walking into any of them).
  function crosses(c, px, pz, hx, hz, L, r) {
    const thinX = (c.maxX - c.minX) < (c.maxZ - c.minZ);
    if (Math.abs(thinX ? hx : hz) < 0.4) return false;
    let t0 = 0, t1 = L;
    const lo = [c.minX - r, c.minZ - r], hi = [c.maxX + r, c.maxZ + r], p = [px, pz], h = [hx, hz];
    for (let i = 0; i < 2; i++) {
      if (Math.abs(h[i]) < 1e-9) { if (p[i] < lo[i] || p[i] > hi[i]) return false; continue; }
      let a = (lo[i] - p[i]) / h[i], b = (hi[i] - p[i]) / h[i];
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  }
  const LOOK = 1.25;                      // metres of stride looked down
  let nOpened = 0, nRefused = 0;
  /* -> null (nothing shut ahead), "open" (opened it / it is opening), "deny" */
  function ahead(m, pos, hx, hz, dist) {
    if (!GRID.size || !pos) return null;
    const L = Math.min(LOOK, (dist || LOOK) + 0.3);
    const x = pos.x, z = pos.z, y = pos.y || 0;
    const gx0 = Math.floor((Math.min(x, x + hx * L) - 2) / CELL), gx1 = Math.floor((Math.max(x, x + hx * L) + 2) / CELL);
    const gz0 = Math.floor((Math.min(z, z + hz * L) - 2) / CELL), gz1 = Math.floor((Math.max(z, z + hz * L) + 2) / CELL);
    const actor = m && m.actor;
    for (let i = gx0; i <= gx1; i++) for (let j = gz0; j <= gz1; j++) {
      const a = GRID.get(i + "," + j);
      if (!a) continue;
      for (let q = 0; q < a.length; q++) {
        const c = a[q];
        if (c.y0 != null && (y < c.y0 - 0.7 || y > c.y0 + 1.5)) continue;   // another storey
        if (!crosses(c, x, z, hx, hz, L, 0.28)) continue;
        if (isOpen(c)) continue;
        if (!may(actor, c)) { refuse(m, actor, c); return "deny"; }
        const e = c._bd;
        try { e.p.set(e.rec, true); } catch (err) {}
        if (isOpen(c)) {
          nOpened++;
          if (!OPENED.some((o) => o.col === c)) OPENED.push({ col: c, t: 0, clear: 0 });
        }
        return "open";
      }
    }
    return null;
  }
  // REFUSED: the body stops at the leaf and stands a beat; a free walker gives
  // the errand up, and the navigator already plans with the door counted shut
  // for him (navgrid's `passable`).
  const REFUSED_AT = new Map();          // door id -> refusals (the audit's "where")
  function refuse(m, actor, col) {
    nRefused++;
    const rid = (col._bd && col._bd.rec && (col._bd.rec.id || col._bd.rec.label)) || "?";
    if (REFUSED_AT.size < 64 || REFUSED_AT.has(rid)) REFUSED_AT.set(rid, (REFUSED_AT.get(rid) | 0) + 1);
    if (actor) actor._doorDenied = col;
    /* A BODY THE NAVIGATOR STEERS IS LEFT TO IT (it has a `_nav` record:
       systems/navgrid.js walks him, straight shot or route). The navigator
       already plans with this door shut for him and its sealed wait is the
       answer at a door that is the only way; the leaf's collider holds him.
       Holding him here as well (or throwing his route away) fought it:
       measured on the prison nav gate, 23% -> 31% of the cast's movement
       stalled at the corridor grilles. */
    if (actor && actor._nav) return;
    // a free walker is told (stuckN: entities/npc.js picks another spot,
    // peds.js drops the path) and stands a beat at a door he cannot open
    if (m) { m.doorBlockT = 1.5; if ((m.stuckN | 0) < 3) m.stuckN = 3; }
    if (actor && typeof actor.pause === "number") actor.pause = Math.max(actor.pause, 0.8);
  }

  // ---- AND IT SHUTS BEHIND THEM --------------------------------------------
  const OPENED = [];
  function posOf(b) { return b && !b.dead ? (b.pos || (b.group && b.group.position) || null) : null; }
  function bodyNear(col, pad) {
    const lists = [];
    const P = CBZ.player;
    if (P && P.pos && !P.dead) lists.push([P]);
    const e = col._bd;
    if (e && e.p.bodies) { try { const b = e.p.bodies(); if (b) for (let i = 0; i < b.length; i++) if (b[i]) lists.push(b[i]); } catch (err) {} }
    for (let l = 0; l < lists.length; l++) {
      const L = lists[l];
      for (let i = 0; i < L.length; i++) {
        const p = posOf(L[i]);
        if (!p) continue;
        if (col.y0 != null && p.y != null && (p.y < col.y0 - 1.2 || p.y > col.y0 + 1.6)) continue;
        if (p.x > col.minX - pad && p.x < col.maxX + pad && p.z > col.minZ - pad && p.z < col.maxZ + pad) return true;
      }
    }
    return false;
  }
  function tick(dt) {
    if (!OPENED.length) return;
    for (let i = OPENED.length - 1; i >= 0; i--) {
      const o = OPENED[i];
      const e = o.col._bd;
      if (!e || !isOpen(o.col)) { OPENED.splice(i, 1); continue; }
      // somebody else took the door over (the player opened it on his own
      // [E]): his door now, left as he leaves it
      if (e.p.ownedByBody && !e.p.ownedByBody(e.rec)) { OPENED.splice(i, 1); continue; }
      o.t += dt;
      if (bodyNear(o.col, 1.6)) { o.clear = 0; continue; }
      o.clear += dt;
      if (o.t > 1.0 && o.clear > 0.6) {
        try { e.p.set(e.rec, false); } catch (err) {}
        OPENED.splice(i, 1);
      }
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(34.32, function (dt) { tick(dt || 0.016); prisonSync(); });

  /* ---- THE PRISON'S PROVIDER -----------------------------------------------
     The prison's doors are already one registry (systems/interactions.js:
     CBZ._prisonDoorSpecs, every door primitive declares into it). This reads
     it; a spec may add `npc(actor)` to state its own clearance. */
  function isOfficer(a) {
    if (!a) return false;
    if (a.kind === "warden" || a.kind === "guard" || a.isGuard) return true;
    const G = CBZ.guards;
    return !!(G && G.indexOf(a) >= 0);
  }
  function specKeys(s) {
    try { return typeof s.keys === "function" ? s.keys() : s.keys; } catch (e) { return null; }
  }
  /* WHO MAY OPEN A PRISON DOOR (the rules world/corridorkit.js wrote for its
     own leaves, now the whole compound's):
       unlocked      anybody: an officer, an inmate, the warden
       Keycard       any officer: every officer on the floor is issued a card
       Corridor Key  any officer (the ring the floor rides)
       Gate Key      the gate post and the warden only
       Cell Key      nobody by walking: a cell is opened on purpose, with the
                     key, at the door; a CELL FRONT is racked by the schedule
     An officer who is tied, asleep or down opens nothing. A spec may state
     its own rule with `npc(actor)` (the Warden's office: the warden). */
  function awake(a) { return !!a && !a.dead && !(a.ko > 0) && !a.tied && !a.asleep; }
  function prisonMay(s, a) {
    if (s.permanent && s.permanent()) return true;
    if (!awake(a)) return false;
    if (typeof s.npc === "function") return !!s.npc(a);
    if (/^prison-cell-/.test(s.id || "")) return false;
    const k = specKeys(s);
    if (!s.keyed && !(k && k.length)) return true;               // a room door: a handle
    if (!isOfficer(a)) return false;
    if (k && k.indexOf("Gate Key") >= 0) return a.post === "gate" || a.kind === "warden";
    if (k && k.length === 1 && k[0] === "Cell Key") return false;
    return true;
  }
  const PRISON = {
    name: "prison",
    isOpen: function (s) { return !!(s.isOpen() || (s.permanent && s.permanent())); },
    // a body's hand, not the player's: specs whose set() books the player
    // (corridorkit's port alarm) hand an `npcSet`
    set: function (s, v) { return s.npcSet ? s.npcSet(v) : s.set(v); },
    may: prisonMay,
    bodies: function () { return [CBZ.guards, CBZ.npcs]; },
  };
  /* THE CARD READER'S QUESTION ("is somebody who may open me standing at
     me?"), asked by the prison's door owners (corridorkit, prisonwings,
     adminwing) of the one rule above instead of three private copies of it.
     Officers within R; an inmate only for a door with no lock, and closer. */
  function openerNear(s, x, z, R) {
    if (!s) return null;
    R = R || 2.4;
    const G = CBZ.guards || [];
    for (let i = 0; i < G.length; i++) {
      const g = G[i], p = posOf(g);
      if (!p) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz <= R * R && prisonMay(s, g)) return g;
    }
    const k = specKeys(s);
    if (s.keyed || (k && k.length)) return null;
    const N = CBZ.npcs || [], r = Math.min(R, 1.8);
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (!n || n._crowd) continue;
      const p = posOf(n);
      if (!p || Math.abs(p.x - x) > r || Math.abs(p.z - z) > r) continue;
      if ((p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) <= r * r && prisonMay(s, n)) return n;
    }
    return null;
  }
  let prisonSeen = 0;
  function prisonSync() {
    const specs = CBZ._prisonDoorSpecs;
    if (!specs || specs.length === prisonSeen) return;
    for (let i = prisonSeen; i < specs.length; i++) {
      const s = specs[i];
      if (!s) continue;
      let cols = null;
      try { cols = s.cols ? s.cols() : [s.col()]; } catch (e) { cols = null; }
      if (cols) for (let j = 0; j < cols.length; j++) if (cols[j]) tag(cols[j], PRISON, s);
    }
    prisonSeen = specs.length;
  }

  // every tagged door collider whose centre is within r of (x, z), open or shut
  function near(x, z, r, out) {
    out = out || [];
    out.length = 0;
    prisonSync();
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > GRID.size) {
      GRID.forEach(function (a) { for (let q = 0; q < a.length; q++) { const c = a[q]; if (Math.abs((c.minX + c.maxX) / 2 - x) <= r && Math.abs((c.minZ + c.maxZ) / 2 - z) <= r) out.push(c); } });
      return out;
    }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = GRID.get(i + "," + j);
      if (a) for (let q = 0; q < a.length; q++) out.push(a[q]);
    }
    return out;
  }

  CBZ.bodyDoors = {
    tag: tag, near: near, untag: untag, ahead: ahead, passable: passable, may: may, isOpen: isOpen,
    sync: prisonSync, tick: tick, isOfficer: isOfficer, openerNear: openerNear, prisonMay: prisonMay,
    opened: function () { return OPENED.length; },
    stats: function () {
      const top = Array.from(REFUSED_AT.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return { doors: Array.from(GRID.values()).reduce((n, a) => n + a.length, 0), opened: nOpened, refused: nRefused, holding: OPENED.length, refusedAt: top };
    },
  };
})();
