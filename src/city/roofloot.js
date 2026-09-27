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

   WHAT IS UP THERE (2026-09-27 de-slop). A stash is a real thing
   somebody hid: a zipped duffel (olive canvas for a forgotten bag,
   black nylon for a set's) or a black hard case, tucked against the
   parapet with its long side to the wall. They used to be two plain
   boxes each — a "duffel" that was a green-glowing brick with a
   strap box on top, a "crate" that was a glowing olive cube with a lid
   box — lit up like arcade pickups so you could spot them across the
   roof. Nothing glows now: a bag against a wall is found by looking.
   Cracked = the SAME object gone through: the duffel slumped open and
   empty, the case with its lid thrown back over plucked foam.

   Draw-call discipline: every variant is BAKED once by city/
   itemassets.js (CBZ.itemAssetBaked — one merged vertex-coloured
   geometry, one shared material), so a stash is ONE draw call full and
   ONE empty (the other is hidden), parented to the building group. No
   colliders (knee-high bags). Seeding is DETERMINISTIC (fixed LCG) —
   same roofs, same stashes, every run. All DOM/keys headless-guarded.

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

  const REACH = 2.4;          // [E] crack reach
  const RESPAWN = 300;        // s — long minutes before a roof restocks

  // deterministic LCG (reseeded at build) — placement never shuffles between runs
  let _s = 70921;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  // ---- the objects. Four baked variants per look, built once, shared. --------
  const LOOK = {
    duffel:     { kind: "moneybag", state: "closed", canvas: 0x4a5a3f, flash: false },
    duffelRich: { kind: "moneybag", state: "closed", canvas: 0x1c1e22, flash: false },
    case:       { kind: "stashcase" },
  };
  function bakedOf(look, empty) {
    const o = Object.assign({}, look);
    if (empty) { if (o.kind === "moneybag") o.state = "empty"; else o.open = true; }
    let m = null;
    if (CBZ.itemAssetBaked) { try { m = CBZ.itemAssetBaked(null, null, null, o); } catch (e) { m = null; } }
    if (!m && CBZ.itemAsset) { try { m = CBZ.itemAsset(null, null, o); } catch (e) { m = null; } }
    if (!m) {                                    // no registry at all: a plain dark bag shape, never a glow
      m = new THREE.Mesh(CBZ.boxGeom ? CBZ.boxGeom(0.34, empty ? 0.14 : 0.30, 0.70) : new THREE.BoxGeometry(0.34, 0.30, 0.70),
        (CBZ.cmat || CBZ.mat)(0x2c3026));
      m.position.y = empty ? 0.07 : 0.15;
      const w = new THREE.Group(); w.add(m); m = w;
    }
    m.castShadow = false;
    m.traverse(function (c) { if (c.isMesh) { c.castShadow = false; c.receiveShadow = true; } });
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
    // the slab centre is where city/mode.js wakes you up on this roof: keep
    // it clear so the first thing you see is the skyline, not somebody's bag
    if (b.roofCx != null) a.push({ x: b.roofCx, z: b.roofCz, r: 2.8 });
    const hp = b.helipad; if (hp) a.push({ x: hp.x, z: hp.z, r: (hp.r || 6) + 1.4 });
    if (b.lift) {
      a.push({ x: b.lift.roof.x, z: b.lift.roof.z, r: 4.0 });                       // arrival pad ([E] zones must not overlap)
      a.push({ x: ox + S.ixMax - 1.7, z: oz + S.izMin + 1.7, r: 2.8 });             // headhouse
    }
    if (b.fireEscape) a.push({ x: ox + b.w / 2 - 1.3, z: b.fireEscape.z, r: 3.0 }); // bridge landing
    // rectangles: the stair/lift shaft heads and the roof crown (a bag is
    // tucked beside those, never inside one)
    const rects = [];
    for (const r of (b.shaftRects || [])) {
      if (r && isFinite(r.x0)) rects.push({ x0: ox + r.x0, x1: ox + r.x1, z0: oz + r.z0, z1: oz + r.z1 });
    }
    if (b.roofCrown) { const c = b.roofCrown; rects.push({ x0: ox + c.x0, x1: ox + c.x1, z0: oz + c.z0, z1: oz + c.z1 }); }
    a.rects = rects;
    return a;
  }
  function clear(avoid, x, z, r) {
    for (const a of avoid) if (Math.hypot(x - a.x, z - a.z) < a.r + (r || 0)) return false;
    const R = (r || 0) + 0.2;
    if (avoid.rects) for (const q of avoid.rects) {
      if (x > q.x0 - R && x < q.x1 + R && z > q.z0 - R && z < q.z1 + R) return false;
    }
    return true;
  }

  // candidate corners/edges of the solid slab, walked from a seeded offset so
  // different roofs hide their bags in different spots (but always the same
  // spot on the same roof).
  // A thing you hide on a roof goes AGAINST THE PARAPET, long side to the
  // wall (`ry` turns the object's back, local -X, to that wall), not out in
  // the open 1.2 m from it.
  function spotCandidates(b) {
    const S = slabInfo(b), ox = b.ox, oz = b.oz, IN = 0.42;
    return [
      { x: ox + S.slabMinX + IN, z: oz + (S.izMin + S.izMax) / 2, ry: 0 },
      { x: ox + S.ixMax - IN, z: oz + S.izMax - 1.4, ry: Math.PI },
      { x: ox + (S.slabMinX + S.ixMax) / 2, z: oz + S.izMin + IN, ry: -Math.PI / 2 },
      { x: ox + S.slabMinX + IN, z: oz + S.izMax - 1.4, ry: 0 },
      { x: ox + S.ixMax - IN, z: oz + (S.izMin + S.izMax) / 2, ry: Math.PI },
      { x: ox + (S.slabMinX + S.ixMax) / 2, z: oz + S.izMax - IN, ry: Math.PI / 2 },
    ];
  }

  function roofName(lot) {
    const b = lot.building;
    if (b.name) return b.name;
    const e = CBZ.cityEcon;
    const dn = e && e.districtAt ? e.districtName(e.districtAt(lot.cx, lot.cz)) : "city";
    return dn + ((b.storeys || 1) >= 5 ? " high-rise" : " walk-up");
  }

  function buildStash(lot, wx, wz, rich, kind, ry) {
    const b = lot.building, lx = wx - b.ox, lz = wz - b.oz, h = b.h;
    const look = kind === "case" ? LOOK.case : (rich ? LOOK.duffelRich : LOOK.duffel);
    const body = new THREE.Group();
    body.position.set(lx, h, lz);
    // a hair off square to the wall, so a row of roofs is not a row of clones
    body.rotation.y = (ry || 0) + (rng() - 0.5) * 0.3;
    const full = bakedOf(look, false), empty = bakedOf(look, true);
    empty.visible = false;
    body.add(full); body.add(empty);
    b.group.add(body);
    stashes.push({ lot, b, kind, rich, x: wx, z: wz, y: h, body, full, empty, looted: false, t: 0 });
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
            buildStash(lot, c.x, c.z, rich, rich && placed === 1 ? "case" : (rng() < 0.3 ? "case" : "duffel"), c.ry);
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
    if (st.full) st.full.visible = !!full;
    if (st.empty) st.empty.visible = !full;
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
    const gid = gangAt(st.lot);
    // A TAKE IS A TRANSFER (city/shops.js's CBZ.cityTill). A SET'S ROOF STASH
    // IS THE SET'S MONEY — it was minted out of nothing, so you could crack
    // the same crew's stash all night and their war chest never moved. It now
    // comes out of gang.treasury, the number gangs.js already spends on wars,
    // raids and promotions: rob a crew's roofs and they genuinely cannot
    // afford the fight they are about to pick with you. The ledger reads and
    // writes THEIR record — it never keeps a copy.
    const TL = CBZ.cityTill;
    if (st.rich && gid && TL && TL.declare) {
      const gang = (CBZ.cityGangs || []).find(function (x) { return x && x.id === gid; });
      if (gang) {
        if (!st._tillSpec) TL.declare(st, {
          name: (gang.name || "the set") + "'s roof stash", kind: "stash", point: "safe",
          // a set does not keep its whole war chest in one duffel on one roof:
          // the stash is the cut this block kicked up, capped by what the set
          // actually has. Both halves are the gang's own record, never ours.
          amount: function () { return Math.min(cash, Math.max(0, gang.treasury || 0)); },
          drain: function (n) { gang.treasury = Math.max(0, (gang.treasury || 0) - n); },
        });
        const got = TL.take(st, { by: "player" });
        // a broke set's roof really is empty — that IS the information the
        // climb bought you, and it is the anti-farm rule with no timer.
        cash = got.taken;
      }
    }
    if (cash > 0) CBZ.city.addCash(cash);
    else {
      CBZ.city.note("The set's tapped out. Nothing in it.", 2.4);
      if (CBZ.cityGangProvoke && gid) CBZ.cityGangProvoke(gid, 0.8);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
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
    // taking THEIR stash provokes the set that holds the block NOW — but no
    // cops: a roof job has no street witnesses. That's the whole appeal.
    if (st.rich && gid && CBZ.cityGangProvoke) {
      CBZ.cityGangProvoke(gid, 0.8);
      CBZ.city.note("The set's money. $" + cash + extra + ". They'll know it was light.", 2.8);
    } else {
      CBZ.city.note("Somebody's stash. $" + cash + extra + ".", 2.2);
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
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

  CBZ.onUpdate(36.7, function (dt) {            // after elevators (36.6) so the lift/escape tags exist
    if (g.mode !== "city") return;
    const A = CBZ.city && CBZ.city.arena;
    if (built && A !== builtA) { built = false; stashes.length = 0; access.length = 0; }   // arena rebuilt → re-seed
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

    // Prying the box is ONE shove of the bar, not a 0.9 s "Prying it
    // open..." chip: a pickup never shows a loading beat (owner).
  });

  let zoned = false;
  CBZ.onUpdate(99.63, function () {
    if (zoned || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zoned = true;
    // the card names the OBJECT in front of you, never the system behind it
    CBZ.interactions.describe("roofstash", function (st) {
      return { label: st && st.kind === "case" ? "A hard case" : "A duffel bag", note: "" };
    });
    CBZ.interactions.registerZone({
      id: "zone-roofstash", kind: "roofstash", prio: 11,
      find: function () { return (built && g.mode === "city") ? stashNear() : null; },
      options: [{
        id: "roofstash-pry", slot: "e", bad: true,
        // a SET'S stash provokes the set that holds the block — the button
        // says whose box you are about to open (the deleted pill's wording)
        label: function (st) {
          if (st && st.kind === "case") return st.rich ? "Pop the set's case" : "Pop the latches";
          return st && st.rich ? "Unzip the set's bag" : "Unzip it";
        },
        onSelect: function (st) { if (st && !st.looted) { if (CBZ.shake) CBZ.shake(0.06); crackOpen(st); } },
      }],
    });
  });

  // ---- PUBLIC ---------------------------------------------------------------
  // live stash records — the map can mark known roofs ({x,z,y,rich,looted})
  CBZ.cityRoofStashes = function () { return stashes; };
  // reachable-roof registry — careers.js dead-drops chain foot → drop point
  CBZ.cityRoofAccess = function () { return access; };
  // fresh run: everything restocked (mirrors cityGangsReset's stash un-loot)
  CBZ.cityRoofLootReset = function () {
    for (const st of stashes) { st.looted = false; st.t = 0; setLook(st, true); }
  };
})();
