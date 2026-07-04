/* ============================================================
   city/demolition.js — PERSISTENT BUILDING DESTRUCTION.

   Pound a building with enough ordnance and it comes DOWN — and then the
   city visibly heals: smoking rubble → cleared lot behind barriers →
   scaffolding → rebuilt, advancing on the in-game calendar
   (CBZ.dayCount/dayTime from core/daynight.js). No popups, no timers on
   the HUD: you learn the state of a lot by looking at it.

   Architecture (mirrors city/fracture.js, its wall-scale ancestor):
   - HP accumulates per building from every blast that funnels through
     CBZ.cityExplosion / cityAirstrikeExplosion (RPG, C4, grenades,
     cooking cars, helicopter crashes, airstrikes — one chokepoint,
     wrapped here exactly like buildings.js/armored.js already wrap it).
   - Collapse uses the U1 groundwork: CBZ.batchHideGroup zeroes the
     building's slices inside the shared merged buffers, the live group
     hides, colliders/platforms/LOS/doors/glass all unregister through
     the per-building mirrors makeBuilding now returns. Fully reversible.
   - Rubble is DETERMINISTIC — seeded by the lot's coordinates
     (CBZ.hashN), so every client and every reload grows the same pile
     from a record that is just {x, z, atDay}.
   - Ledger records are coordinate-keyed (never array indices), serialize
     into the world save next to cityFracture's holes (net/netpersist.js
     already carries blob.demo), and expose onEvent/applyOne for the
     host-authoritative net relay (networld hooks in, frx-style).
   - CBZ.CONFIG.CITY_DEMOLITION gates everything; flip false and blasts
     behave exactly as before this file existed.

   Deliberately NOT destructible: the flagship mega-tower and any
   building carrying a helipad/hangar (player infrastructure, story
   anchors). They take facade wounds (fracture holes) like always — they
   just never pancake.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CITY_DEMOLITION == null) CBZ.CONFIG.CITY_DEMOLITION = true;

  // ---- tuning ------------------------------------------------------------
  // phases in in-game DAYS since collapse (1 day = 150s real — daynight.js)
  const T_CLEARED = 2.2;    // rubble sits smoking this long
  const T_SCAFFOLD = 4.2;   // then a cleared, barriered lot
  const T_REBUILT = 7.0;    // then scaffolding, then the building returns
  const MAX_STOREYS = 11;   // taller = landmark = never collapses
  // ~3 rockets for a small shop, ~5-6 for a fat 4-storey block (RPG power 1.9)
  function hpMax(b) { return 2 + b.storeys * 1.2 + (b.w * b.d) / 300; }

  const ledger = new Map();      // key "x,z" -> rec
  const hp = new Map();          // lot -> accumulated blast damage (session-local)
  const D = CBZ.cityDemolition = { onEvent: null };

  function keyOf(lot) { return Math.round(lot.cx) + "," + Math.round(lot.cz); }
  function arena() { return CBZ.city && (CBZ.city.arena || CBZ.city); }

  function eligible(lot) {
    const b = lot && lot.building;
    if (!b || !b.group || !b.colliders || !b.colliders.length) return false;
    if (b.storeys > MAX_STOREYS) return false;               // landmark tier
    if (b.helipad || b.hangar || lot.building.helipad || lot.building.hangar) return false;
    if (lot.kind === "park") return false;
    return true;
  }

  // ---- deterministic rubble / phase prop builders --------------------------
  // All geometry derives from CBZ.hashN(lotX, lotZ, salt) — same pile on every
  // client, every reload, from a ledger record that is only {x, z, at}.
  function lotRng(lot, salt) {
    let s = CBZ.hashN ? CBZ.hashN(Math.round(lot.cx), Math.round(lot.cz), salt) : ((lot.cx * 73856093) ^ (lot.cz * 19349663)) >>> 0;
    return function () {              // mulberry32, seeded off the position hash
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mat = (col) => (CBZ.cmat ? CBZ.cmat(col) : new THREE.MeshLambertMaterial({ color: col }));
  function box(g, x, y, z, w, h, d, col, ry) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(col));
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.castShadow = false; m.receiveShadow = true;
    g.add(m);
    return m;
  }

  function buildRubble(rec) {
    const lot = rec.lot, b = lot.building, g = new THREE.Group();
    const rng = lotRng(lot, 0xdead);
    const W = b.w - 1.2, Dp = b.d - 1.2;
    const peak = Math.min(3.6, 1.0 + b.storeys * 0.35);
    // concrete greys + a memory of the building's own wall colour
    const cols = [0x565a5e, 0x4a4e52, 0x63676b, 0x585349];
    const n = 14 + ((rng() * 8) | 0);
    for (let i = 0; i < n; i++) {
      // mound profile: big tilted slabs near the centre, crumbs at the rim
      const ang = rng() * Math.PI * 2, rr = Math.sqrt(rng());
      const x = Math.cos(ang) * rr * W * 0.42, z = Math.sin(ang) * rr * Dp * 0.42;
      const k = 1 - rr;                                        // 1 centre → 0 rim
      const w = 1.2 + rng() * 3.4 * (0.4 + k), d = 1.2 + rng() * 3.4 * (0.4 + k);
      const h = 0.3 + k * peak * (0.5 + rng() * 0.6);
      box(g, b.ox + x, h / 2 - 0.05, b.oz + z, w, h, d, cols[(rng() * cols.length) | 0], rng() * Math.PI);
    }
    // a couple of leaning wall shards — reads as "was a building", not a quarry
    for (let i = 0; i < 2; i++) {
      const sx = rng() < 0.5 ? -1 : 1;
      const m = box(g, b.ox + sx * W * 0.3, peak * 0.55, b.oz + (rng() - 0.5) * Dp * 0.5,
        0.35, peak * 1.5, 2.2 + rng() * 2.5, 0x585349, rng() * 0.4);
      m.rotation.z = sx * (0.35 + rng() * 0.25);               // leaning, not standing
    }
    // one central mound collider: you clamber AROUND a fresh collapse
    const c = { minX: b.ox - W * 0.3, maxX: b.ox + W * 0.3, minZ: b.oz - Dp * 0.3, maxZ: b.oz + Dp * 0.3, y0: 0, y1: Math.max(0.9, peak * 0.55) };
    return { group: g, cols: [c] };
  }

  function buildCleared(rec) {
    const lot = rec.lot, b = lot.building, g = new THREE.Group();
    const rng = lotRng(lot, 0xc1ea);
    // graded gravel pad where the pile was
    box(g, b.ox, 0.06, b.oz, b.w - 0.8, 0.12, b.d - 0.8, 0x54585c);
    // orange/white construction barriers around the perimeter
    const bw = 2.2, hw = b.w / 2 - 0.6, hd = b.d / 2 - 0.6;
    for (let s = 0; s < 4; s++) {
      const horiz = s < 2, sign = s % 2 ? 1 : -1;
      const span = (horiz ? b.w : b.d) - 1.2;
      const nSeg = Math.max(2, Math.round(span / (bw + 1.6)));
      for (let i = 0; i < nSeg; i++) {
        const t = -span / 2 + (i + 0.5) * (span / nSeg) + (rng() - 0.5) * 0.4;
        const x = horiz ? b.ox + t : b.ox + sign * hw;
        const z = horiz ? b.oz + sign * hd : b.oz + t;
        box(g, x, 0.55, z, horiz ? bw : 0.14, 0.7, horiz ? 0.14 : bw, i % 2 ? 0xd2691e : 0xe8e4da, 0);
      }
    }
    return { group: g, cols: [] };
  }

  function buildScaffold(rec) {
    const lot = rec.lot, b = lot.building, g = new THREE.Group();
    const H = Math.min(b.h * 0.75, b.FH * 3.2);                // frame climbs partway up
    const hw = b.w / 2 - 0.5, hd = b.d / 2 - 0.5;
    const POLE = 0x8a8577, PLANK = 0xa88c5f;
    // perimeter poles on a ~3.5u pitch + plank walkways per storey line
    for (let s = 0; s < 4; s++) {
      const horiz = s < 2, sign = s % 2 ? 1 : -1;
      const span = (horiz ? hw : hd) * 2;
      const nP = Math.max(3, Math.round(span / 3.5) + 1);
      for (let i = 0; i < nP; i++) {
        const t = -span / 2 + i * (span / (nP - 1));
        const x = horiz ? b.ox + t : b.ox + sign * hw;
        const z = horiz ? b.oz + sign * hd : b.oz + t;
        box(g, x, H / 2, z, 0.14, H, 0.14, POLE);
      }
      for (let y = b.FH; y < H; y += b.FH) {
        const x = horiz ? b.ox : b.ox + sign * hw;
        const z = horiz ? b.oz + sign * hd : b.oz;
        box(g, x, y, z, horiz ? span : 0.9, 0.09, horiz ? 0.9 : span, PLANK);
      }
    }
    // the rising CORE: a plain concrete storey-or-two inside the frame —
    // the diegetic "they're getting somewhere" beat before the reveal
    box(g, b.ox, b.FH * 0.5, b.oz, b.w - 2.4, b.FH, b.d - 2.4, 0x6a6e72);
    const cols = [{ minX: b.ox - (b.w - 2.4) / 2, maxX: b.ox + (b.w - 2.4) / 2, minZ: b.oz - (b.d - 2.4) / 2, maxZ: b.oz + (b.d - 2.4) / 2, y0: 0, y1: b.FH }];
    return { group: g, cols: [] , solids: cols };
  }

  // ---- phase transitions ---------------------------------------------------
  function clearPhaseProps(rec) {
    if (rec.propGroup) {
      const A = arena();
      if (A && A.root) A.root.remove(rec.propGroup);
      rec.propGroup.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      rec.propGroup = null;
    }
    if (rec.propCols && rec.propCols.length) {
      for (const c of rec.propCols) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
      rec.propCols = [];
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
  }
  function setPhase(rec, phase) {
    if (rec.phase === phase) return;
    clearPhaseProps(rec);
    rec.phase = phase;
    const A = arena();
    if (!A || !A.root) return;
    const built = phase === 1 ? buildRubble(rec) : phase === 2 ? buildCleared(rec) : phase === 3 ? buildScaffold(rec) : null;
    if (built) {
      A.root.add(built.group);
      rec.propGroup = built.group;
      rec.propCols = built.cols.concat(built.solids || []);
      for (const c of rec.propCols) CBZ.colliders.push(c);
      if (rec.propCols.length && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
  }

  // ---- collapse / rebuild --------------------------------------------------
  function destroy(lot, opts) {
    opts = opts || {};
    if (!CBZ.CONFIG.CITY_DEMOLITION) return false;
    if (!eligible(lot) || ledger.has(keyOf(lot))) return false;
    const b = lot.building;

    // 1) the batched shell: merged copies off, shared-buffer slices zeroed
    if (CBZ.batchHideGroup) CBZ.batchHideGroup(b.group);
    b.group.visible = false;
    // 2) glass out of the instanced pools (+ solid panes' meshes/colliders)
    for (const gp of b.windows || []) {
      if (gp.shattered) continue;
      gp.shattered = true;
      if (gp.mesh) gp.mesh.visible = false;
      else if (CBZ._paneShow) CBZ._paneShow(gp, false);
      if (gp.col) { const i = CBZ.colliders.indexOf(gp.col); if (i >= 0) CBZ.colliders.splice(i, 1); }
    }
    // 3) physics + vision: this building no longer blocks anything
    for (const c of b.colliders) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
    for (const p of b.platforms || []) { const i = CBZ.platforms.indexOf(p); if (i >= 0) CBZ.platforms.splice(i, 1); }
    for (const m of b.losMeshes || []) { const i = CBZ.losBlockers.indexOf(m); if (i >= 0) CBZ.losBlockers.splice(i, 1); }
    for (const dr of b.doors || []) {
      dr.demolished = true;
      if (dr.colIn) { const i = CBZ.colliders.indexOf(dr.col); if (i >= 0) CBZ.colliders.splice(i, 1); dr.colIn = false; }
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    // 4) the lot's obligations pause while it's a hole in the ground
    lot.demolished = true;
    if (b.home) { b.home._demoListed = b.home.listed; b.home.listed = false; }

    const rec = {
      k: keyOf(lot), lot, at: opts.at != null ? opts.at : (CBZ.dayTime ? CBZ.dayTime() : 0),
      phase: 0, propGroup: null, propCols: [],
    };
    ledger.set(rec.k, rec);
    setPhase(rec, phaseFor(rec));

    // 5) collapse FX at the moment it happens (skipped for save/net replays)
    if (!opts.quiet) {
      try {
        if (CBZ.cityScorch) CBZ.cityScorch(b.ox, b.oz, Math.max(b.w, b.d) * 0.55);
        if (CBZ.cityChunk) {
          CBZ.cityChunk(b.ox, 1.2, b.oz, { count: 26, force: 9 });
          CBZ.cityChunk(b.ox - b.w * 0.3, b.h * 0.4, b.oz, { count: 12, force: 7 });
          CBZ.cityChunk(b.ox + b.w * 0.3, b.h * 0.4, b.oz, { count: 12, force: 7 });
        }
        if (CBZ.sfx) CBZ.sfx("boom");
      } catch (e) {}
    }
    if (typeof D.onEvent === "function" && !opts.silent) try { D.onEvent({ t: "destroy", x: Math.round(lot.cx), z: Math.round(lot.cz), at: rec.at }); } catch (e) {}
    return true;
  }

  function rebuild(rec, opts) {
    opts = opts || {};
    const lot = rec.lot, b = lot.building;
    clearPhaseProps(rec);
    ledger.delete(rec.k);
    hp.delete(lot);
    lot.demolished = false;
    if (CBZ.batchShowGroup) CBZ.batchShowGroup(b.group);
    b.group.visible = true;
    for (const gp of b.windows || []) {
      if (!gp.shattered) continue;
      gp.shattered = false; gp.cracked = false;
      if (gp.mesh) gp.mesh.visible = true;
      else if (CBZ._paneShow) CBZ._paneShow(gp, true);
      if (gp.col && CBZ.colliders.indexOf(gp.col) === -1) CBZ.colliders.push(gp.col);
    }
    for (const c of b.colliders) if (CBZ.colliders.indexOf(c) === -1) CBZ.colliders.push(c);
    for (const p of b.platforms || []) if (CBZ.platforms.indexOf(p) === -1) CBZ.platforms.push(p);
    for (const m of b.losMeshes || []) if (CBZ.losBlockers.indexOf(m) === -1) CBZ.losBlockers.push(m);
    for (const dr of b.doors || []) {
      dr.demolished = false;
      dr.open = false; dr.hold = 0; dr.t = 0; dr.pivot.rotation.y = 0;
      if (!dr.colIn) { if (CBZ.colliders.indexOf(dr.col) === -1) CBZ.colliders.push(dr.col); dr.colIn = true; }
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (b.home && b.home._demoListed != null) { b.home.listed = b.home._demoListed; b.home._demoListed = null; }
    if (typeof D.onEvent === "function" && !opts.silent) try { D.onEvent({ t: "rebuild", x: Math.round(lot.cx), z: Math.round(lot.cz) }); } catch (e) {}
  }

  function phaseFor(rec) {
    const now = CBZ.dayTime ? CBZ.dayTime() : 0;
    const el = now - rec.at;
    return el >= T_SCAFFOLD ? 3 : el >= T_CLEARED ? 2 : 1;
  }

  // ---- the blast hook: HP accumulation at the single ordnance chokepoint ----
  function onBlast(x, z, opts) {
    if (!CBZ.CONFIG.CITY_DEMOLITION) return;
    if (opts && opts.noDamage) return;                 // cosmetic (heli embers)
    // multiplayer: the HOST is the only authority on structural HP. A guest's
    // local blast is FX-only — networld forwards it to the host, whose
    // destroy decision comes back as a bldx event (fracture's frx pattern).
    if (CBZ.net && CBZ.net.active && !CBZ.net.isHost() && !(opts && opts._fromHost)) return;
    // the wrap chain (buildings/armored/us) can end up layered more than once
    // when siblings re-wrap without copying each other's markers — the SAME
    // opts object flows through every layer, so tag it: one blast, one count.
    if (opts) { if (opts._demoSeen) return; opts._demoSeen = true; }
    const A = arena();
    if (!A || !A.lots) return;
    const power = (opts && opts.power) || 1, R = ((opts && opts.radius) || 6);
    const y = opts && opts.y != null ? opts.y : 1.4;
    for (const lot of A.lots) {
      const b = lot.building;
      if (!b || lot.demolished || !eligible(lot)) continue;
      // distance from blast to the building's XZ box; full damage inside,
      // fading to zero half a blast-radius out
      const dx = Math.max(0, Math.abs(x - b.ox) - b.w / 2);
      const dz = Math.max(0, Math.abs(z - b.oz) - b.d / 2);
      const dist = Math.hypot(dx, dz);
      if (dist > R * 0.6) continue;
      if (y > b.h + 4) continue;                       // detonated way above the roof
      const prox = 1 - dist / (R * 0.6);
      const dmg = power * prox;
      if (dmg <= 0.05) continue;
      const cur = (hp.get(lot) || 0) + dmg;
      hp.set(lot, cur);
      if (cur >= hpMax(b)) destroy(lot);
    }
  }
  // wrap the same entry points buildings.js/armored.js already wrap — each
  // wrapper calls through, so order doesn't matter. Installed lazily (the base
  // fns don't exist until crashfx has run).
  function wrapBoom(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._demoWrapped) return;
    const wrapped = function (x, z, opts) { const r = orig.call(this, x, z, opts); try { onBlast(x, z, opts); } catch (e) {} return r; };
    // carry forward EVERY sibling wrap marker (struct/armored/…) so their
    // idempotence guards hold — copying only one flag is how the chain ends
    // up re-wrapping itself in layers (each layer re-counting damage).
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._demoWrapped = true;
    CBZ[name] = wrapped;
  }

  // ---- ticking: phase advancement (cheap — ledger is tiny, early-out when 0) --
  CBZ.onUpdate(34.5, function () {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    wrapBoom("cityExplosion");
    wrapBoom("cityAirstrikeExplosion");
    if (!ledger.size) return;
    const now = CBZ.dayTime ? CBZ.dayTime() : 0;
    for (const rec of Array.from(ledger.values())) {
      if (now - rec.at >= T_REBUILT) rebuild(rec);
      else setPhase(rec, phaseFor(rec));
    }
  });

  // ---- public surface --------------------------------------------------------
  D.destroy = function (lot, opts) { return destroy(lot, opts); };
  D.has = function (lot) { return ledger.has(keyOf(lot)); };
  D.count = function () { return ledger.size; };
  D.hp = function (lot) { const b = lot && lot.building; return b ? { cur: hp.get(lot) || 0, max: hpMax(b) } : null; };
  D.list = function () { return Array.from(ledger.values()).map((r) => ({ k: r.k, at: r.at, phase: r.phase })); };
  // save / late-join snapshot (netpersist worldBlob.demo — see fracture's twin)
  D.serialize = function () {
    return { v: 1, list: Array.from(ledger.values()).map((r) => ({ x: Math.round(r.lot.cx), z: Math.round(r.lot.cz), at: +r.at.toFixed(3) })) };
  };
  D.applyOne = function (row) {
    if (!row) return false;
    const A = arena();
    if (!A || !A.lots) return false;
    const now = CBZ.dayTime ? CBZ.dayTime() : 0;
    if (row.at != null && now - row.at >= T_REBUILT) return false;   // already healed
    let best = null, bd = 1e9;
    for (const lot of A.lots) {
      const d = Math.hypot(lot.cx - row.x, lot.cz - row.z);
      if (d < bd) { bd = d; best = lot; }
    }
    if (!best || bd > 3) return false;                                // address didn't resolve
    return destroy(best, { quiet: true, silent: true, at: row.at });
  };
  D.apply = function (blob) {
    if (!blob || blob.v !== 1 || !Array.isArray(blob.list)) return;
    for (const row of blob.list) try { D.applyOne(row); } catch (e) {}
  };
  // net-relay surface (networld): a guest applies the host's rebuild event by
  // address; the host applies a guest's forwarded blast without re-running FX.
  D.rebuildAt = function (row) {
    if (!row) return false;
    const rec = ledger.get(Math.round(row.x) + "," + Math.round(row.z));
    if (!rec) return false;
    rebuild(rec, { silent: true });
    return true;
  };
  D.netBlast = function (x, z, opts) { try { onBlast(x, z, opts || {}) } catch (e) {} };
  // full restore for a new run (called from cityGlassReset)
  D.reset = function () {
    for (const rec of Array.from(ledger.values())) rebuild(rec, { silent: true });
    hp.clear();
  };
})();
