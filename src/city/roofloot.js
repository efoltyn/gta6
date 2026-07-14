/* ============================================================
   city/roofloot.js — ROOF STASHES: the money the street can't see.

   WHY: elevators + fire escapes just shipped, and vertical access
   with nothing up there is an empty flex. The roofs that can be
   REACHED (a lift lobby or a fire-escape climb — the tags
   elevators.js stamps on lot.building) now hold what nobody at
   street level knows about: duffels and crates of cash, product,
   ammo. Climbing becomes a MONEY skill — you case a tower, ride or
   climb up, crack the stash ([E], a pry-beat, a sound), and pocket
   what the set thought was safe above the sightlines. Gang-adjacent
   roofs hold the RICHEST bags because it's THEIR stash — and taking
   it provokes the whole set (cityGangProvoke), no cops though: a
   roof job leaves no witnesses on the street, that's the appeal.
   Stashes restock after long minutes, so a route over the skyline
   becomes a repeatable earner you can show off.

   Draw-call discipline: ONE shared unit box geometry scaled per
   mesh, all materials through the cached CBZ.cmat pool, 2 meshes
   per stash, parented to the building group. No colliders (knee-
   high bags). Looted = a cached-material SWAP, never a mutation.
   Seeding is DETERMINISTIC (fixed LCG) — same roofs, same stashes,
   every run. All DOM/keys headless-guarded.

   Publishes:
     CBZ.cityRoofStashes() — live stash records (map markers)
     CBZ.cityRoofAccess()  — reachable-roof registry {name, via,
                             foot, drop} (careers.js dead-drop jobs)
     CBZ.cityRoofLootReset() — un-loot everything for a fresh run
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const REACH = 2.4;          // [E] crack reach (and the chip prompt range)
  const CRACK_T = 0.9;        // the pry-beat: kneel on it before it gives
  const RESPAWN = 300;        // s — long minutes before a roof restocks

  // deterministic LCG (reseeded at build) — placement never shuffles between runs
  let _s = 70921;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // ---- shared building blocks (mesh-count bound: ONE geometry, cached mats) --
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  const cmat = CBZ.cmat || CBZ.mat;
  // material SWAPS between cached shared mats (the elevators.js button pattern):
  // a full bag glints (worth the climb), a rich bag glints hotter, a cracked
  // one goes dead dark — readable across a roof at a glance.
  const BAG_FULL  = () => cmat(0x2a2f26, { emissive: 0x4caf6e, ei: 0.25 });
  const BAG_RICH  = () => cmat(0x33272a, { emissive: 0xffb347, ei: 0.35 });
  const BAG_EMPTY = () => cmat(0x202020, { emissive: 0x000000, ei: 0 });
  const CRATE_FULL  = () => cmat(0x4a5232, { emissive: 0x4caf6e, ei: 0.18 });
  const CRATE_EMPTY = () => cmat(0x2c3022, { emissive: 0x000000, ei: 0 });
  const STRAP = 0x14171c, LID = 0x3a4128;

  function box(parent, x, y, z, w, h, d, material) {
    const m = new THREE.Mesh(UNIT, material);
    m.scale.set(w, h, d); m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // slab extents (mirrors elevators.js / makeBuilding roof math) so every
  // stash lands on the SOLID roof, never over the open -x stairwell shaft.
  function slabInfo(b) {
    const wt = b.wt != null ? b.wt : 0.4;
    const ixMax = b.w / 2 - wt, izMin = -b.d / 2 + wt, izMax = b.d / 2 - wt;
    const slabMinX = b.hasStairs ? (-b.w / 2 + wt + b.stairW) : (-b.w / 2 + wt);
    return { ixMax, izMin, izMax, slabMinX, slabW: ixMax - slabMinX, slabD: izMax - izMin };
  }

  // whose roof is this REALLY? Owner gang first (derelicts are seeded gang
  // property), else the turf system's live zone owner. Checked again at crack
  // time so a block that changed hands provokes the set that holds it NOW.
  function gangAt(lot) {
    const own = lot.building && lot.building.owner;
    if (own && own.type === "gang" && own.id && own.id !== "player") return own.id;
    const zid = CBZ.cityZoneOwner ? CBZ.cityZoneOwner(lot.cx, lot.cz) : null;
    return (zid && zid !== "player") ? zid : null;
  }

  const stashes = [];   // live stash records
  const access = [];    // reachable-roof registry (careers dead-drops + map)
  let built = false, builtA = null;

  // everything already standing on a reachable roof that a stash (or a drop
  // spot) must keep clear of: helipad, lift headhouse + arrival pad (big radius
  // so the lift's [E] and the stash's [E] can never both be in reach), the
  // and the fire-escape bridge landing.
  function avoidList(lot) {
    const b = lot.building, ox = b.ox, oz = b.oz, S = slabInfo(b);
    const a = [];
    const hp = b.helipad; if (hp) a.push({ x: hp.x, z: hp.z, r: (hp.r || 6) + 1.4 });
    if (b.lift) {
      a.push({ x: b.lift.roof.x, z: b.lift.roof.z, r: 4.0 });                       // arrival pad ([E] zones must not overlap)
      a.push({ x: ox + S.ixMax - 1.7, z: oz + S.izMin + 1.7, r: 2.8 });             // headhouse
    }
    if (b.fireEscape) a.push({ x: ox + b.w / 2 - 1.3, z: b.fireEscape.z, r: 3.0 }); // bridge landing
    return a;
  }
  function clear(avoid, x, z, r) {
    for (const a of avoid) if (Math.hypot(x - a.x, z - a.z) < a.r + (r || 0)) return false;
    return true;
  }

  // candidate corners/edges of the solid slab, walked from a seeded offset so
  // different roofs hide their bags in different spots (but always the same
  // spot on the same roof).
  function spotCandidates(b) {
    const S = slabInfo(b), ox = b.ox, oz = b.oz;
    return [
      { x: ox + S.slabMinX + 1.15, z: oz + (S.izMin + S.izMax) / 2 },
      { x: ox + S.ixMax - 1.15, z: oz + S.izMax - 1.4 },
      { x: ox + (S.slabMinX + S.ixMax) / 2, z: oz + S.izMin + 1.3 },
      { x: ox + S.slabMinX + 1.15, z: oz + S.izMax - 1.4 },
      { x: ox + S.ixMax - 1.15, z: oz + (S.izMin + S.izMax) / 2 },
      { x: ox + (S.slabMinX + S.ixMax) / 2, z: oz + S.izMax - 1.3 },
    ];
  }

  function roofName(lot) {
    const b = lot.building;
    if (b.name) return b.name;
    const e = CBZ.cityEcon;
    const dn = e && e.districtAt ? e.districtName(e.districtAt(lot.cx, lot.cz)) : "city";
    return dn + ((b.storeys || 1) >= 5 ? " high-rise" : " walk-up");
  }

  function buildStash(lot, wx, wz, rich, kind) {
    const b = lot.building, lx = wx - b.ox, lz = wz - b.oz, h = b.h;
    let body;
    if (kind === "crate") {
      body = box(b.group, lx, h + 0.26, lz, 0.9, 0.52, 0.65, CRATE_FULL());
      box(b.group, lx, h + 0.55, lz, 0.96, 0.08, 0.71, cmat(LID));               // lid rim
    } else {
      body = box(b.group, lx, h + 0.24, lz, 1.05, 0.48, 0.52, rich ? BAG_RICH() : BAG_FULL());
      box(b.group, lx, h + 0.49, lz, 0.18, 0.06, 0.56, cmat(STRAP));             // carry strap
    }
    stashes.push({ lot, b, kind, rich, x: wx, z: wz, y: h, body, looted: false, t: 0 });
  }

  function build(A) {
    built = true; builtA = A;
    _s = 70921;                                  // reseed → deterministic layout
    const lots = (A.elevatorLots || []).concat(A.fireEscapeLots || []);
    for (const lot of lots) {
      try {
        const b = lot.building;
        if (!b || !b.group || (!b.lift && !b.fireEscape)) continue;   // only roofs you can actually REACH
        const avoid = avoidList(lot);
        const cands = spotCandidates(b);
        const rich = !!(gangAt(lot) || b.abandoned);                  // their stash > a forgotten bag
        const want = rich ? 2 : 1 + (rng() < 0.45 ? 1 : 0);
        let placed = 0;
        const start = (rng() * cands.length) | 0;
        let dropSpot = null;
        for (let i = 0; i < cands.length; i++) {
          const c = cands[(start + i) % cands.length];
          if (!clear(avoid, c.x, c.z, 0.8)) continue;
          if (placed < want) {
            buildStash(lot, c.x, c.z, rich, rich && placed === 1 ? "crate" : (rng() < 0.3 ? "crate" : "duffel"));
            avoid.push({ x: c.x, z: c.z, r: 2.0 });
            placed++;
          } else if (!dropSpot) { dropSpot = c; break; }              // first clear spot AFTER the bags = the dead-drop point
        }
        if (!dropSpot) {                                              // crowded slab: fall back to its centre
          const S = slabInfo(b);
          dropSpot = { x: b.ox + (S.slabMinX + S.ixMax) / 2, z: b.oz + (S.izMin + S.izMax) / 2 };
        }
        // reachable-roof registry: the waypoint chain a dead-drop runs
        // (foot of the way up → the point on the roof itself)
        const foot = b.lift ? { x: b.lift.ground.x, z: b.lift.ground.z }
          : { x: b.ox + b.w / 2 + 0.75, z: b.oz - b.d / 2 + 1.1 };    // first fire-escape flight
        access.push({
          lot, name: roofName(lot), via: b.lift ? "lift" : "stairs",
          foot, drop: { x: dropSpot.x, y: b.h, z: dropSpot.z },
        });
      } catch (e) { console.error("[roof loot]", e); }
    }
  }

  // ---- CRACKING ONE OPEN -----------------------------------------------------
  function setLook(st, full) {
    if (st.kind === "crate") st.body.material = full ? CRATE_FULL() : CRATE_EMPTY();
    else st.body.material = full ? (st.rich ? BAG_RICH() : BAG_FULL()) : BAG_EMPTY();
  }

  function crackOpen(st) {
    st.looted = true;
    st.t = RESPAWN * (0.8 + rng() * 0.6);        // the restock truck takes its time
    setLook(st, false);
    const b = st.b;
    // cash scales with the tower (a taller climb earns a fatter bag); a set's
    // stash is the real score — that's WHY their roofs are worth provoking them.
    let cash = 80 + (b.storeys || 1) * 35 + ((rng() * 120) | 0);
    if (st.rich) cash = Math.round(cash * 2.4) + 150;
    CBZ.city.addCash(cash);
    let extra = "";
    const econ = CBZ.cityEcon;
    if (st.rich && econ && econ.add) {
      const d = rng() < 0.5 ? "Coke" : "Meth", n = 2 + ((rng() * 2) | 0);
      econ.add(d, n); extra = " + " + n + "× " + d;
    } else if (rng() < 0.4 && econ && econ.add) {
      const d = rng() < 0.6 ? "Weed" : "Pills";
      econ.add(d, 1); extra = " + 1× " + d;
    } else if (rng() < 0.5 && CBZ.cityAddAmmo) {
      CBZ.cityAddAmmo(30); extra = " + 30 rounds";
    }
    CBZ.city.addRespect(st.rich ? 6 : 2);        // a score nobody saw still carries
    if (CBZ.sfx) CBZ.sfx("coin");
    if (st.rich && CBZ.city.big) CBZ.city.big("ROOF STASH + $" + cash);
    // taking THEIR stash provokes the set that holds the block NOW — but no
    // cops: a roof job has no street witnesses. That's the whole appeal.
    const gid = gangAt(st.lot);
    if (st.rich && gid && CBZ.cityGangProvoke) {
      CBZ.cityGangProvoke(gid, 0.8);
      CBZ.city.note("Cracked the set's roof stash — $" + cash + extra + ". They'll know it was light.", 2.8);
    } else {
      CBZ.city.note("Cracked the stash — $" + cash + extra + ".", 2.2);
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // ---- the tiny prompt chip (one DOM node, hidden when idle; headless-safe) --
  let chip = null;
  function dom() {
    if (chip || typeof document === "undefined" || !document.body) return;
    try {
      chip = document.createElement("div");
      chip.id = "roofStashChip";
      chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:278px;z-index:24;display:none;" +
        "padding:6px 12px;border-radius:9px;background:rgba(8,14,22,.78);border:1px solid rgba(255,209,102,.30);" +
        "color:#ffe9bd;font:600 13px/1.2 'Fredoka',system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px #000";
      document.body.appendChild(chip);
    } catch (e) { chip = null; }
  }
  // PERF: callers run at frame rate — skip the DOM writes (display + textContent
  // dirty layout even with identical values) unless the text actually changed.
  let _chipLast;
  function chipText(t) {
    if (t === _chipLast) return;
    dom(); if (!chip) return;
    _chipLast = t;
    if (!t) { chip.style.display = "none"; return; }
    chip.style.display = "block"; chip.textContent = t;
  }

  // the un-cracked stash you're standing over (you must actually be ON the roof)
  function stashNear() {
    const P = CBZ.player; if (!P) return null;
    for (const st of stashes) {
      if (st.looted) continue;
      if (Math.abs(P.pos.y - st.y) > 2.2) continue;
      if (Math.hypot(P.pos.x - st.x, P.pos.z - st.z) <= REACH) return st;
    }
    return null;
  }

  let cracking = null;   // { st, t }
  let _promptT = 0;      // ~12 Hz proximity-prompt clock (the pry-beat stays per-frame)
  CBZ.onUpdate(36.7, function (dt) {            // after elevators (36.6) so the lift/escape tags exist
    if (g.mode !== "city") { cracking = null; chipText(null); return; }
    const A = CBZ.city && CBZ.city.arena;
    if (built && A !== builtA) { built = false; stashes.length = 0; access.length = 0; cracking = null; }   // arena rebuilt → re-seed
    if (!built) {
      if (A && A.lots &&
        ((A.elevatorLots || []).some((l) => l.building && l.building.lift) ||
         (A.fireEscapeLots || []).some((l) => l.building && l.building.fireEscape))) build(A);
      if (!built) return;
    }

    // restock timers (a handful of records — effectively free)
    for (const st of stashes) {
      if (!st.looted) continue;
      st.t -= dt;
      if (st.t <= 0) { st.looted = false; setLook(st, true); }
    }

    const P = CBZ.player;
    if (cracking) {
      const st = cracking.st;
      if (!P || P.dead || st.looted || Math.abs(P.pos.y - st.y) > 2.2 ||
        Math.hypot(P.pos.x - st.x, P.pos.z - st.z) > REACH + 1) { cracking = null; chipText(null); return; }
      cracking.t += dt;
      chipText("Prying it open…");
      if (CBZ.shake && cracking.t > 0.4 && cracking._j !== 1) { cracking._j = 1; CBZ.shake(0.06); }   // the latch fights back
      if (cracking.t >= CRACK_T) { crackOpen(st); cracking = null; chipText(null); }
      return;
    }
    // prompt scan at ~12 Hz, not frame rate — stashNear hypots every stash, and
    // a walk-up prompt doesn't need 60 Hz reactions (the [E] handler re-checks).
    _promptT += dt;
    if (g.state === "playing" && P && !P.dead && !P.driving && !CBZ.cityMenuOpen) {
      if (_promptT >= 1 / 12) {
        _promptT = 0;
        const st = stashNear();
        chipText(st ? (st.rich ? "[E] Crack the set's stash" : "[E] Crack the stash open") : null);
      }
    } else chipText(null);
  });

  // [E] starts the pry. On DOCUMENT with stopPropagation (the elevators.js
  // pattern) so interact.js's window-level "[E] = eat" fallback never fires on
  // the same press. Stash spots are seeded clear of the lift pads, so the two
  // document listeners can't both be in reach.
  function onKey(e) {
    if (!built || g.mode !== "city" || g.state !== "playing" || cracking) return;
    if (CBZ.cityMenuOpen) return;
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    const st = stashNear();
    if (!st) return;
    e.preventDefault();
    e.stopPropagation();
    cracking = { st, t: 0 };
    if (CBZ.sfx) CBZ.sfx("clank");
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKey);

  // ---- PUBLIC ---------------------------------------------------------------
  // live stash records — the map can mark known roofs ({x,z,y,rich,looted})
  CBZ.cityRoofStashes = function () { return stashes; };
  // reachable-roof registry — careers.js dead-drops chain foot → drop point
  CBZ.cityRoofAccess = function () { return access; };
  // fresh run: everything restocked (mirrors cityGangsReset's stash un-loot)
  CBZ.cityRoofLootReset = function () {
    cracking = null;
    for (const st of stashes) { st.looted = false; st.t = 0; setLook(st, true); }
  };
})();
