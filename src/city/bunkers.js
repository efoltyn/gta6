/* ============================================================
   city/bunkers.js — HARDENED BUNKERS (the strategic-weapons layer, part 1).

   WHY (owner mandate: "add bunkers to the game" as part of a coherent
   strategic layer): the nuke needs a HOME (the military vault), the
   bunker-buster needs a REASON (a roof nothing else kills through), and
   the world needs the other half of the fantasy — a place to RIDE OUT
   the blast. So bunkers are three things at once:
     1. the armory/command shelter under Fort Brandt where the nuclear
        device and the bunker-buster stock live,
     2. deterministic FINDS in the wilds (a mountain early-warning post,
        a desert civil-defense shelter) with loot worth the trip,
     3. SHELTER: an actor inside an intact bunker survives a nuclear
        blast (strategic.js queries CBZ.strategicBunkerShelterAt) — and
        the ONLY counter is the bunker-buster, which breaches the roof
        (CBZ.strategicBunkerBreach) and ends the protection.

   "UNDERGROUND" — the engine truth: player support is
   max(terrain, platforms) (systems/physics.js groundAt), so nothing can
   ever WALK below the terrain field. Underground is therefore delivered
   the way classic engines deliver it: the interior sits AT GRADE and the
   earth sits OVER it — a massive tiered berm with rock above your head,
   a full enclosing shell, and a y-gated ceiling collider. You walk in
   through a real blast door and the world above you is gone. (A literal
   y<terrain dig would fight groundAt, floorAt, swim, nav and every
   spawn clamp at once — rejected on engineering grounds, recorded here.)

   DOORS use the elevator grammar (city/elevators.js is the gold
   standard): real sliding steel leaves you walk through, a y-gated
   collider that seals when shut (toggled by mutating y0/y1 — the xz
   broadphase never re-indexes on y, elevators' own trick), eased motion,
   interact-to-open, auto-seal after a hold. The interaction registry
   (systems/interactions.js) owns the verb, so touch gets its pill free.

   INTERIORS follow the owner's interiors doctrine: spartan and
   monotonous ON PURPOSE — repeated bunk frames, rack rows, crate
   stacks, strip lights; the command room seats real officers via the
   peds.js sit grammar (state "sit" + _deskAnchor + char.sitting; that
   path pins pos.y=0, so seated staff exist only in the flat military
   site — the remote finds are ABANDONED, which is also their story).

   DETERMINISM: every position derives from fixed anchors + CBZ.hash01
   jitter; grade seating samples the biome height fields
   (snowTerrainHeightAt / desertTerrainHeightAt) which are pure
   functions of the world seed. No Math.random anywhere in the build.

   CBZ.CONFIG.STRAT_BUNKERS=false → this file builds nothing (one-line
   revert). Plain IIFE, window.CBZ, THREE r128, no build step.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.STRAT_BUNKERS == null) CBZ.CONFIG.STRAT_BUNKERS = true;

  // ---- deterministic stream (never Math.random in a build path) -----------
  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5; }

  // ---- shared palette (cached materials → the batcher can collapse) -------
  const M = {
    earth: 0x5d5a48, earthD: 0x4c4a3c, rock: 0x6b6d70, concrete: 0x8a8d90,
    concreteD: 0x6f7275, steel: 0x565c64, steelD: 0x3a3f46, floor: 0x555a60,
    wall: 0x757a80, ceil: 0x62666c, bunk: 0x4a5238, canvas: 0x6d7457,
    locker: 0x3f4a3a, rack: 0x33383e, gun: 0x22262b, crate: 0x5c6247,
    crateAmmo: 0x556247, warn: 0xd4a017, red: 0xb43a32, map: 0x2e4a38,
    desk: 0x5a4f3c, chair: 0x30343a, radio: 0x2a2f36, vault: 0x4d545e,
    device: 0xb8bec6, deviceD: 0x7b828c, sand: 0x9a8a5e, cotFrame: 0x50565e,
    cot: 0x6a705a, drum: 0x3e6b4f, shelf: 0x6a6046, snowcrete: 0x7d8288,
    dcrete: 0x9a8f76,
  };
  function cm(hex, opts) { return CBZ.cmat ? CBZ.cmat(hex, opts) : (CBZ.mat ? CBZ.mat(hex, opts) : new THREE.MeshLambertMaterial({ color: hex })); }
  function bg(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function box(parent, x, y, z, w, h, d, hex, opts) {
    opts = opts || {};
    const m = new THREE.Mesh(bg(w, h, d), cm(hex, opts.matOpts));
    m.position.set(x, y, z);
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    parent.add(m);
    return m;
  }
  // emissive strip / lamp (cast off — lights don't shadow)
  function glow(parent, x, y, z, w, h, d, hex, ei) {
    return box(parent, x, y, z, w, h, d, hex, { matOpts: { emissive: hex, ei: ei == null ? 0.85 : ei }, cast: false });
  }
  function col(minX, maxX, minZ, maxZ, y0, y1, ref) {
    const c = { minX, maxX, minZ, maxZ, y0: y0 || 0, y1: y1 == null ? 3 : y1, ref: ref || null };
    CBZ.colliders.push(c);
    return c;
  }

  // ============================================================
  //  BLAST DOORS — elevator-grammar leaves. One module list, one updater.
  //  rec: {leaves:[{m,baseX,baseZ,sx,sz}], colRec, open, target, holdT,
  //        cx, cz, y0, y1, trav, disabled}
  //  Collider toggling = mutate y0/y1 (elevators' trick — no re-index).
  // ============================================================
  const doors = [];
  function makeDoor(root, cx, cz, along /* "x"|"z" */, width, height, hex, thick) {
    const t = thick || 0.4, hw = width / 2;
    const leaves = [];
    for (const s of [-1, 1]) {
      const lw = hw + 0.06;                       // slight center overlap when shut
      const lx = along === "x" ? cx + s * (lw / 2) : cx;
      const lz = along === "x" ? cz : cz + s * (lw / 2);
      const m = box(root, lx, height / 2, lz,
        along === "x" ? lw : t, height, along === "x" ? t : lw, hex);
      // a chunky drive rib so the slab reads as MACHINE, not a wall panel —
      // a CHILD of the leaf so it slides with it (a root-parented rib would
      // hang floating in the doorway the moment the leaf moved)
      const rib = new THREE.Mesh(bg(along === "x" ? lw * 0.78 : t + 0.08, 0.22, along === "x" ? t + 0.08 : lw * 0.78), cm(M.steelD));
      rib.position.set(0, height * 0.14, 0);
      rib.castShadow = true; rib.userData.blastDoor = true;
      m.add(rib);
      m.userData.blastDoor = true;                // spare from the static merger
      leaves.push({
        m, baseX: lx, baseZ: lz,
        sx: along === "x" ? s : 0, sz: along === "x" ? 0 : s,
      });
    }
    const pad = 0.2;
    const c = along === "x"
      ? col(cx - hw - pad, cx + hw + pad, cz - t / 2 - 0.1, cz + t / 2 + 0.1, 0, height)
      : col(cx - t / 2 - 0.1, cx + t / 2 + 0.1, cz - hw - pad, cz + hw + pad, 0, height);
    const rec = {
      leaves, colRec: c, open: 0, target: 0, holdT: 0,
      cx, cz, y0: 0, y1: height, trav: hw + 0.12, disabled: false,
    };
    doors.push(rec);
    return rec;
  }
  function setDoor(rec, open) {
    if (!rec || rec.disabled) return;
    rec.target = open ? 1 : 0;
    if (open) rec.holdT = 14;                     // generous auto-seal window
    if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} }
  }
  // the one door updater: ease leaves, keep the collider honest. Early-outs
  // when nothing is moving so headless sim ticks pay ~nothing.
  CBZ.onUpdate(38.9, function (dt) {
    if (!doors.length) return;
    const P = CBZ.player;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d.disabled) continue;
      // hold open while someone stands in the doorway (elevator no-crush rule)
      if (d.target === 1) {
        d.holdT -= dt;
        let occupied = false;
        if (P && P.pos) {
          const dx = P.pos.x - d.cx, dz = P.pos.z - d.cz;
          occupied = dx * dx + dz * dz < 2.4 * 2.4;
        }
        if (d.holdT <= 0 && !occupied) d.target = 0;
      }
      if (d.open === d.target) continue;
      d.open += Math.sign(d.target - d.open) * dt / 0.9;      // ~0.9s travel: HEAVY
      d.open = Math.max(0, Math.min(1, d.open));
      const e = d.open * d.open * (3 - 2 * d.open);            // smoothstep ease
      for (const lf of d.leaves) {
        lf.m.position.x = lf.baseX + lf.sx * d.trav * e;
        lf.m.position.z = lf.baseZ + lf.sz * d.trav * e;
      }
      // seal ↔ pass: mutate the vertical span only (broadphase-safe toggle)
      if (d.open > 0.72) { d.colRec.y0 = -99; d.colRec.y1 = -99; }
      else { d.colRec.y0 = d.y0; d.colRec.y1 = d.y1; }
    }
  });

  // ============================================================
  //  THE BUNKER REGISTRY — what strategic.js (nuke/buster) consumes.
  // ============================================================
  const bunkers = [];
  CBZ.strategicBunkers = bunkers;
  // Is (x, y?, z) inside an INTACT bunker's interior? → the record (shelter).
  CBZ.strategicBunkerShelterAt = function (x, y, z) {
    for (let i = 0; i < bunkers.length; i++) {
      const b = bunkers[i];
      if (b.breached) continue;
      const I = b.interior;
      if (x >= I.minX && x <= I.maxX && z >= I.minZ && z <= I.maxZ &&
          (y == null || (y >= I.floorY - 1 && y <= I.ceilY + 1))) return b;
    }
    return null;
  };
  // Does the mound over a bunker sit under (x,z)? → the record (buster hit test).
  CBZ.strategicBunkerHit = function (x, z) {
    for (let i = 0; i < bunkers.length; i++) {
      const b = bunkers[i], S = b.shell;
      if (x >= S.minX && x <= S.maxX && z >= S.minZ && z <= S.maxZ) return b;
    }
    return null;
  };
  // BREACH — the bunker-buster's structural verdict: the entrance is blown
  // open for good, a crater caps the mound, and the shelter guarantee ends.
  // (Killing whoever is inside is the WEAPON's job — strategic.js sweeps the
  // interior bounds through the kill bus; this handles only the structure.)
  CBZ.strategicBunkerBreach = function (b) {
    if (!b || b.breached) return false;
    b.breached = true;
    for (const d of b.doors) {
      d.target = 1; d.holdT = 9e9;               // hangs open…
      d.disabled = false;                         // (let the ease finish)
    }
    // crater cap: a dark dish + tumbled slabs on the mound top, deterministic
    // per site (the same crater on every client from the same hit).
    try {
      const g = b.root, S = b.shell;
      const cx = (S.minX + S.maxX) / 2, cz = (S.minZ + S.maxZ) / 2;
      const top = b.moundTop;
      const dish = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 4.6, 1.0, 12), cm(0x1c1e20));
      dish.position.set(cx, top - 0.3, cz);
      dish.castShadow = false; dish.receiveShadow = true;
      g.add(dish);
      for (let i = 0; i < 5; i++) {
        const a = h01(cx + i, cz, 0xbc1) * Math.PI * 2, r = 2.6 + h01(cx, cz + i, 0xbc2) * 2.4;
        box(g, cx + Math.cos(a) * r, top + 0.25, cz + Math.sin(a) * r,
          1.0 + h01(i, cx, 0xbc3) * 1.2, 0.5, 0.9 + h01(i, cz, 0xbc4) * 1.1, M.concreteD)
          .rotation.y = a;
      }
      if (CBZ.cityScorch) CBZ.cityScorch(cx, cz, 6);
      // sustain the door-open pose once the ease lands, then freeze the door
      for (const d of b.doors) d.disabled = false;
      setTimeout(function () { for (const d of b.doors) d.disabled = true; }, 1400);
    } catch (e) {}
    return true;
  };

  // ============================================================
  //  INTERACTION ZONES — doors, crates, the vault device. One registry,
  //  registered once; find() walks the live per-site token lists so a city
  //  rebuild (which re-runs the landmass builder) just refreshes the lists.
  // ============================================================
  const doorTokens = [];     // {x, z, door, name}
  const crateTokens = [];    // {x, z, kind:"armory"|"cache", site, nextRestock, taken}
  const vaultTokens = [];    // {x, z, site, taken, deviceMesh}
  let _zonesWired = false;
  function nearestTok(list, px, pz, r) {
    let best = null, bd = r * r;
    for (let i = 0; i < list.length; i++) {
      const t = list[i], dx = t.x - px, dz = t.z - pz, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = t; }
    }
    return best;
  }
  function wireZones() {
    if (_zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    const I = CBZ.interactions;
    I.registerZone({
      id: "bunker-doors", kind: "bunkerdoor", radius: 4.2,
      find: function (px, pz) { return nearestTok(doorTokens, px, pz, 4.2); },
      options: [{
        id: "bunkerdoor-open", slot: "e",
        label: function (t) { return t.door.disabled ? "The door hangs blasted open" : (t.door.target === 1 ? "Seal the blast door" : "Open the blast door"); },
        onSelect: function (t) {
          if (t.door.disabled) return;
          if (t.door.target === 1) { t.door.target = 0; if (CBZ.sfx) { try { CBZ.sfx("door"); } catch (e) {} } }
          else setDoor(t.door, true);
        },
      }],
    });
    if (I.describe) I.describe("bunkerdoor", function (t) {
      return { label: t.name || "Blast Door", note: "Hardened shelter — the door is the only way in" };
    });
    I.registerZone({
      id: "bunker-crates", kind: "bunkercrate", radius: 3.2,
      find: function (px, pz) { return nearestTok(crateTokens, px, pz, 3.2); },
      options: [{
        id: "bunkercrate-take", slot: "e",
        label: function (t) {
          if (t.kind === "armory") {
            const day = CBZ.dayCount ? CBZ.dayCount() : 0;
            return day < t.nextRestock ? "Ordnance crate — restocks tomorrow" : "Take bunker-buster bombs (2)";
          }
          return t.taken ? "The cache is cleaned out" : "Crack open the supply cache";
        },
        onSelect: function (t) {
          const e = CBZ.cityEcon;
          if (t.kind === "armory") {
            const day = CBZ.dayCount ? CBZ.dayCount() : 0;
            if (day < t.nextRestock) { if (CBZ.city && CBZ.city.note) CBZ.city.note("The quartermaster restocks the penetrators daily.", 2); return; }
            t.nextRestock = day + 1;
            if (e && e.add) e.add("Bunker Buster", 2);
            if (CBZ.city && CBZ.city.note) CBZ.city.note("2× GBU-57 bunker busters loaded — the B-2's bay carries them.", 2.6);
            if (CBZ.sfx) { try { CBZ.sfx("clank"); } catch (er) {} }
          } else {
            if (t.taken) return;
            t.taken = true;
            if (e && e.add) e.add("Bunker Buster", 1);
            if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(2500);
            if (CBZ.cityAddAmmo) { try { CBZ.cityAddAmmo(60); } catch (er) {} }
            if (CBZ.city && CBZ.city.note) CBZ.city.note("Cache: a bunker buster, $2,500 and 60 rounds.", 2.6);
            if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (er) {} }
          }
        },
      }],
    });
    if (I.describe) I.describe("bunkercrate", function (t) {
      return { label: t.kind === "armory" ? "Ordnance Crate" : "Supply Cache", note: t.kind === "armory" ? "GBU-57 penetrators — B-2 payload" : "Left behind when the site went dark" };
    });
    I.registerZone({
      id: "bunker-vault", kind: "nukevault", radius: 2.8,
      find: function (px, pz) { return nearestTok(vaultTokens, px, pz, 2.8); },
      options: [{
        id: "nukevault-take", slot: "e", bad: true,
        label: function (t) { return t.taken ? "An empty cradle" : "Take the nuclear device"; },
        onSelect: function (t) {
          if (t.taken) return;
          const e = CBZ.cityEcon;
          if (e && e.count && e.count("Nuclear Device") > 0) { if (CBZ.city && CBZ.city.note) CBZ.city.note("You already carry the device.", 1.8); return; }
          t.taken = true;
          if (t.deviceMesh) t.deviceMesh.visible = false;
          if (e && e.add) e.add("Nuclear Device", 1);
          if (CBZ.city && CBZ.city.big) { try { CBZ.city.big("You are carrying a NUCLEAR DEVICE."); } catch (er) {} }
          if (CBZ.city && CBZ.city.note) CBZ.city.note("Deploy: plant it on foot (it offers a 45s timer), or load the B-2's bay.", 4.2);
          if (CBZ.sfx) { try { CBZ.sfx("alarm"); } catch (er) {} }
          // walking out with the country's deterrent is the loudest theft there is
          if (CBZ.cityCrime) { try { CBZ.cityCrime(200, { x: t.x, z: t.z, type: "grand-theft-military", instant: true }); } catch (er) {} }
        },
      }],
    });
    if (I.describe) I.describe("nukevault", function () {
      return { label: "Weapons Vault", note: "One device. One per world. No second chances." };
    });
    _zonesWired = true;
  }

  // ============================================================
  //  THE BUILDER — one parameterized bunker: tiered berm + enclosed
  //  interior + blast door + tiered furnishings.
  //  site: {id, name, subtitle, cx, cz, w, d, tier:"command"|"outpost",
  //         floorY, crete}
  //  Interior envelope: (w-5) × (d-5), 3.1 high, door on +Z face.
  // ============================================================
  function buildBunker(city, root, site) {
    const W = site.w, D = site.d, FY = site.floorY;
    const cx = site.cx, cz = site.cz;
    const IW = W - 5, ID = D - 5;                 // interior envelope
    const ix0 = cx - IW / 2, ix1 = cx + IW / 2;
    const iz0 = cz - ID / 2, iz1 = cz + ID / 2;
    const CEIL = FY + 3.1;                        // clear interior height
    const crete = site.crete || M.concrete;

    const g = new THREE.Group();
    g.name = "bunker-" + site.id;
    root.add(g);

    // ---- BERM: three shrinking earth tiers + a concrete crown. The mound is
    // the "underground" — rock over your head, honest to the buster fantasy.
    // On sloped biome ground a FOUNDATION sinks from the slab grade down past
    // the lowest sampled corner, so the downhill face reads as a cut footing
    // instead of a floating box (the demolition-check floating-geometry law).
    if (site.found && site.found > 0.3) {
      box(g, cx, FY - site.found / 2 + 0.1, cz, W + 2.0, site.found, D + 2.0, M.earthD, { cast: false });
    }
    const T1H = 2.4, T2H = 1.6, T3H = 1.2;
    box(g, cx, FY + T1H / 2, cz, W, T1H, D, M.earth);
    box(g, cx, FY + T1H + T2H / 2, cz - 0.6, W - 5, T2H, D - 5, M.earthD);
    box(g, cx, FY + T1H + T2H + T3H / 2, cz - 1.2, W - 11, T3H, D - 11, M.earth);
    box(g, cx, FY + T1H + T2H + T3H + 0.2, cz - 1.2, W - 13, 0.4, D - 13, crete); // crown slab
    const moundTop = FY + T1H + T2H + T3H + 0.4;
    // skirt ring so the berm meets uneven ground without a floating seam
    box(g, cx, FY + 0.22, cz, W + 2.4, 0.44, D + 2.4, M.earthD, { cast: false });
    // vents + mast on the crown — a live facility breathes and talks
    box(g, cx - W * 0.22, moundTop + 0.5, cz - 2, 0.9, 1.0, 0.9, crete);
    box(g, cx + W * 0.2, moundTop + 0.5, cz - 3, 0.9, 1.0, 0.9, crete);
    if (site.tier === "command") {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5, 6), cm(M.steelD));
      mast.position.set(cx + W * 0.3, moundTop + 2.5, cz + 1); mast.castShadow = true; g.add(mast);
    }

    // ---- ENTRANCE FACE: a proud concrete portal on the +Z side with the
    // recessed blast door. The door notch is centred at (cx, iz1+…).
    const faceZ = cz + D / 2;
    const DOOR_W = 3.0, DOOR_H = 2.7;
    // portal = two cheek slabs + a lintel — the OPENING is real (a single
    // full-width slab here would visually wall off the doorway the colliders
    // leave passable). The door leaves park in the opening and slide INTO
    // the cheeks, elevator-pocket style.
    for (const s of [-1, 1]) box(g, cx + s * (DOOR_W / 2 + 1.1), FY + 1.9, faceZ + 0.35, 2.2, 3.8, 0.9, crete);
    box(g, cx, FY + DOOR_H + (3.8 - DOOR_H) / 2, faceZ + 0.35, DOOR_W + 4.4, 3.8 - DOOR_H, 0.9, crete); // lintel
    box(g, cx, FY + 3.6, faceZ + 0.45, DOOR_W + 5.4, 0.7, 1.3, M.concreteD);    // lintel brow
    // hazard chevrons flanking the opening (paint, not signage text)
    for (const s of [-1, 1]) {
      glow(g, cx + s * (DOOR_W / 2 + 0.55), FY + 1.25, faceZ + 0.82, 0.28, 2.5, 0.06, M.warn, 0.25);
      box(g, cx + s * (DOOR_W / 2 + 1.0), FY + 1.25, faceZ + 0.82, 0.28, 2.5, 0.06, M.steelD);
    }
    glow(g, cx, FY + 3.35, faceZ + 0.86, 1.4, 0.18, 0.1, 0xffe9b0, 0.7);        // door floodlight
    // portal cheeks are solid: the ONLY hole in the face is the door span
    col(cx - (DOOR_W + 4.4) / 2, cx - DOOR_W / 2, faceZ - 0.2, faceZ + 0.9, FY, FY + 3.8);
    col(cx + DOOR_W / 2, cx + (DOOR_W + 4.4) / 2, faceZ - 0.2, faceZ + 0.9, FY, FY + 3.8);
    col(cx - (DOOR_W + 4.4) / 2, cx + (DOOR_W + 4.4) / 2, faceZ - 0.2, faceZ + 0.9, FY + DOOR_H, FY + 3.8); // over-door lintel

    // ---- THE BLAST DOOR (elevator-grammar leaves, slides into the cheeks)
    const door = makeDoor(g, cx, faceZ + 0.35, "x", DOOR_W, DOOR_H, M.steel, 0.5);
    door.y0 = FY; door.y1 = FY + DOOR_H;
    door.colRec.y0 = FY; door.colRec.y1 = FY + DOOR_H;
    doorTokens.push({ x: cx, z: faceZ + 1.2, door, name: site.name });

    // ---- INTERIOR SHELL: floor slab, four walls, ceiling. The berm boxes
    // above are backface-culled from inside, so the shell is what you SEE —
    // it must close every sightline.
    const WT = 1.2;
    box(g, cx, FY + 0.06, cz, IW + 1.4, 0.12, ID + 1.4, M.floor, { cast: false }); // floor skin
    const walls = [];
    walls.push(box(g, cx, FY + 1.55, iz0 - WT / 2, IW + WT * 2, 3.1, WT, M.wall)); // -Z (back)
    walls.push(box(g, ix0 - WT / 2, FY + 1.55, cz, WT, 3.1, ID + WT * 2, M.wall)); // -X
    walls.push(box(g, ix1 + WT / 2, FY + 1.55, cz, WT, 3.1, ID + WT * 2, M.wall)); // +X
    // +Z wall is split by the door corridor
    walls.push(box(g, (ix0 + cx - DOOR_W / 2) / 2, FY + 1.55, iz1 + WT / 2, (cx - DOOR_W / 2) - ix0, 3.1, WT, M.wall));
    walls.push(box(g, (cx + DOOR_W / 2 + ix1) / 2, FY + 1.55, iz1 + WT / 2, ix1 - (cx + DOOR_W / 2), 3.1, WT, M.wall));
    box(g, cx, CEIL + 0.2, cz, IW + WT * 2, 0.4, ID + WT * 2, M.ceil, { cast: false }); // ceiling slab
    // door corridor: short lit throat from the face to the hall
    const corrZ0 = iz1, corrZ1 = faceZ;
    box(g, cx - DOOR_W / 2 - 0.3, FY + 1.55, (corrZ0 + corrZ1) / 2, 0.6, 3.1, corrZ1 - corrZ0 + WT, M.wall);
    box(g, cx + DOOR_W / 2 + 0.3, FY + 1.55, (corrZ0 + corrZ1) / 2, 0.6, 3.1, corrZ1 - corrZ0 + WT, M.wall);
    box(g, cx, CEIL + 0.1, (corrZ0 + corrZ1) / 2, DOOR_W + 1.4, 0.3, corrZ1 - corrZ0 + WT, M.ceil, { cast: false });
    glow(g, cx, CEIL - 0.12, (corrZ0 + corrZ1) / 2, 0.5, 0.08, 1.6, 0xcfe6d8, 0.8);

    // ---- COLLIDERS: wall ring + corridor throat + ceiling gate. The ceiling
    // collider is why you can't hop "into the hill" — and the fiction the
    // buster breaks is the BERM above it, tested via strategicBunkerHit.
    col(ix0 - WT, ix1 + WT, iz0 - WT, iz0, FY, FY + 3.1);                 // back
    col(ix0 - WT, ix0, iz0 - WT, iz1 + WT, FY, FY + 3.1);                 // -X
    col(ix1, ix1 + WT, iz0 - WT, iz1 + WT, FY, FY + 3.1);                 // +X
    col(ix0 - WT, cx - DOOR_W / 2, iz1, iz1 + WT, FY, FY + 3.1);          // +Z west of door
    col(cx + DOOR_W / 2, ix1 + WT, iz1, iz1 + WT, FY, FY + 3.1);          // +Z east of door
    col(cx - DOOR_W / 2 - 0.6, cx - DOOR_W / 2, corrZ0, corrZ1, FY, FY + 3.1); // throat west
    col(cx + DOOR_W / 2, cx + DOOR_W / 2 + 0.6, corrZ0, corrZ1, FY, FY + 3.1); // throat east
    col(ix0 - WT, ix1 + WT, iz0 - WT, iz1 + WT, CEIL, moundTop + 0.6);    // roof gate
    // berm shoulders outside the shell (you walk AROUND the hill, not through)
    col(cx - W / 2, ix0 - WT, cz - D / 2, cz + D / 2, FY, moundTop);      // west shoulder
    col(ix1 + WT, cx + W / 2, cz - D / 2, cz + D / 2, FY, moundTop);      // east shoulder
    col(cx - W / 2, cx + W / 2, cz - D / 2, iz0 - WT, FY, moundTop);      // back shoulder
    col(cx - W / 2, cx - DOOR_W / 2 - 2.2, iz1 + WT, cz + D / 2, FY, moundTop); // front-west shoulder
    col(cx + DOOR_W / 2 + 2.2, cx + W / 2, iz1 + WT, cz + D / 2, FY, moundTop); // front-east shoulder

    // ---- FLOOR SUPPORT off the flat island: a platform record raises the
    // walkable floor to FY (remote sites sit on sampled-grade slabs), plus an
    // approach ramp from outside grade up to the threshold.
    if (FY > 0.05 && CBZ.platforms) {
      CBZ.platforms.push({ minX: ix0 - WT, maxX: ix1 + WT, minZ: iz0 - WT, maxZ: faceZ + 0.9, top: FY });
      const rampLen = 3.2, g0 = site.grade0 != null ? site.grade0 : 0;
      CBZ.platforms.push({
        minX: cx - DOOR_W / 2 - 0.4, maxX: cx + DOOR_W / 2 + 0.4,
        minZ: faceZ + 0.9, maxZ: faceZ + 0.9 + rampLen, top: FY,
        ramp: { axis: "z", z0: faceZ + 0.9 + rampLen, z1: faceZ + 0.9, y0: g0, y1: FY },
      });
      box(g, cx, (g0 + FY) / 2, faceZ + 0.9 + rampLen / 2, DOOR_W + 0.8, Math.max(0.12, FY - g0), rampLen, crete, { cast: false });
    }

    // ---- LOS: the shell blocks AI vision through the hill (small mesh set)
    if (CBZ.losBlockers) for (const w of walls) CBZ.losBlockers.push(w);

    // ---- STRIP LIGHTS down the hall spine — fluorescent monotony ON PURPOSE
    for (let z = iz0 + 3; z < iz1 - 1; z += 5) glow(g, cx, CEIL - 0.12, z, 0.5, 0.08, 2.2, 0xd8ead9, 0.8);

    // ---- FURNISH by tier ---------------------------------------------------
    const rec = {
      id: site.id, name: site.name, tier: site.tier, root: g, doors: [door],
      breached: false, moundTop,
      shell: { minX: cx - W / 2, maxX: cx + W / 2, minZ: cz - D / 2, maxZ: cz + D / 2 },
      interior: { minX: ix0, maxX: ix1, minZ: iz0, maxZ: iz1, floorY: FY, ceilY: CEIL, cx, cz },
      troopSpecs: [],
    };
    if (site.tier === "command") furnishCommand(g, rec, ix0, ix1, iz0, iz1, cx, cz, FY, CEIL);
    else furnishOutpost(g, rec, ix0, ix1, iz0, iz1, cx, cz, FY, site);
    bunkers.push(rec);
    return rec;
  }

  // ---- COMMAND TIER (Fort Brandt): bunks / armory / command room / vault ---
  function furnishCommand(g, rec, ix0, ix1, iz0, iz1, cx, cz, FY, CEIL) {
    // BUNK ROWS along the -X wall: five identical double-deck frames — the
    // owner's monotony doctrine; soldiers sleep in a row, not a decorated set.
    for (let i = 0; i < 5; i++) {
      const bz = iz1 - 3.5 - i * 3.1, bx = ix0 + 1.5;
      for (const lvl of [0.55, 1.55]) {
        box(g, bx, FY + lvl, bz, 2.1, 0.14, 1.0, M.bunk);
        box(g, bx, FY + lvl + 0.11, bz, 1.9, 0.1, 0.85, M.canvas, { cast: false });
      }
      for (const sx of [-1, 1]) box(g, bx + sx * 1.0, FY + 1.05, bz, 0.1, 2.1, 0.1, M.steelD);
      box(g, bx, FY + 0.3, bz + 0.85, 0.9, 0.6, 0.5, M.locker);   // footlocker
      col(ix0, ix0 + 2.7, bz - 0.6, bz + 1.2, FY, FY + 1.8);
    }
    // ARMORY along the +X wall: rack rows + crate stacks + the buster crate
    for (let i = 0; i < 3; i++) {
      const rz = iz1 - 4 - i * 4.2, rx = ix1 - 1.2;
      box(g, rx, FY + 1.0, rz, 0.5, 2.0, 2.6, M.rack);
      for (let k = 0; k < 4; k++) box(g, rx - 0.1, FY + 0.7 + (k % 2) * 0.8, rz - 0.9 + k * 0.6, 0.16, 1.1, 0.16, M.gun); // racked rifles
      col(ix1 - 1.9, ix1, rz - 1.4, rz + 1.4, FY, FY + 2.0);
    }
    for (let i = 0; i < 3; i++) box(g, ix1 - 1.4, FY + 0.4 + (i > 1 ? 0.8 : 0), iz0 + 6.5 + (i % 2) * 1.4, 1.2, 0.8, 1.2, M.crateAmmo);
    // THE ORDNANCE CRATE — long, striped, unmistakable (the buster stock)
    const ocX = ix1 - 1.6, ocZ = iz0 + 3.4;
    box(g, ocX, FY + 0.45, ocZ, 1.4, 0.9, 3.4, M.crate);
    for (const s of [-1.2, 0, 1.2]) glow(g, ocX, FY + 0.92, ocZ + s, 1.42, 0.06, 0.3, M.warn, 0.3);
    col(ocX - 0.8, ocX + 0.8, ocZ - 1.8, ocZ + 1.8, FY, FY + 0.95);
    crateTokens.push({ x: ocX, z: ocZ, kind: "armory", nextRestock: 0 });

    // COMMAND ROOM across the far (-Z) end: partition wall + doorway gap
    const pZ = iz0 + 7.5;
    box(g, (ix0 + cx - 1.4) / 2, FY + 1.55, pZ, (cx - 1.4) - ix0, 3.1, 0.5, M.wall);
    box(g, (cx + 1.4 + ix1) / 2, FY + 1.55, pZ, ix1 - (cx + 1.4), 3.1, 0.5, M.wall);
    col(ix0, cx - 1.4, pZ - 0.25, pZ + 0.25, FY, FY + 3.1);
    col(cx + 1.4, ix1, pZ - 0.25, pZ + 0.25, FY, FY + 3.1);
    // map table + the two command desks with SEATED officers (seat grammar)
    box(g, cx + 2.5, FY + 0.85, iz0 + 4.2, 2.6, 0.1, 1.7, M.map);
    box(g, cx + 2.5, FY + 0.45, iz0 + 4.2, 2.2, 0.8, 1.3, M.steelD);
    col(cx + 1.2, cx + 3.8, iz0 + 3.3, iz0 + 5.1, FY, FY + 0.95);
    const deskZ = iz0 + 1.9;
    for (const dxo of [-4.5, -1.5]) {
      const dx = cx + dxo;
      box(g, dx, FY + 0.78, deskZ, 1.8, 0.1, 0.9, M.desk);
      for (const s of [-0.8, 0.8]) box(g, dx + s, FY + 0.4, deskZ, 0.12, 0.76, 0.8, M.desk);
      glow(g, dx, FY + 1.15, deskZ - 0.35, 0.8, 0.5, 0.08, 0x2f4436, 0.55);   // console glow
      box(g, dx, FY + 0.28, deskZ + 0.85, 0.6, 0.56, 0.6, M.chair);
      col(dx - 0.95, dx + 0.95, deskZ - 0.5, deskZ + 0.4, FY, FY + 0.85);
      // an officer takes the seat (peds.js sit grammar — pins pos.y=0, which
      // is exactly this floor). Face -Z: toward the desk + status wall.
      rec.troopSpecs.push({ x: dx, z: deskZ + 0.85, sit: { x: dx, z: deskZ + 0.85, face: Math.PI } });
    }
    // status boards across the back wall — the room WATCHES something.
    // (start EAST of the vault chamber, which owns the wall's west 6m)
    for (let i = 0; i < 4; i++) glow(g, ix0 + 8 + i * 3.2, FY + 1.9, iz0 + 0.35, 2.6, 1.2, 0.1, i === 2 ? 0x5a1f1f : 0x24413a, 0.5);
    box(g, ix1 - 2.2, FY + 0.9, iz0 + 1.6, 1.2, 1.8, 0.9, M.radio);          // radio rack
    glow(g, ix1 - 2.2, FY + 1.5, iz0 + 1.2, 0.8, 0.14, 0.06, 0x9fd08a, 0.8);
    col(ix1 - 2.9, ix1 - 1.5, iz0 + 1.1, iz0 + 2.1, FY, FY + 1.9);
    // two hall guards stand the post (stationed idle, island_military idiom)
    rec.troopSpecs.push({ x: cx + 0.9, z: iz1 - 2.2, post: true });
    rec.troopSpecs.push({ x: cx - 1.2, z: iz0 + 8.6, post: true });

    // THE VAULT — a chamber in the command room's west end, its own door.
    const vx0 = ix0, vx1 = ix0 + 6, vz0 = iz0, vz1 = iz0 + 6;
    box(g, vx1 + 0.25, FY + 1.55, (vz0 + vz1) / 2 - 0.9, 0.5, 3.1, (vz1 - vz0) - 1.8, M.vault);
    box(g, (vx0 + vx1) / 2 + 0.9, FY + 1.55, vz1 + 0.25, (vx1 - vx0) - 1.8, 3.1, 0.5, M.vault);
    col(vx1, vx1 + 0.5, vz0, vz1 - 1.8, FY, FY + 3.1);
    col(vx0 + 1.8, vx1, vz1, vz1 + 0.5, FY, FY + 3.1);
    // vault door on the +X face of the chamber (single heavy leaf)
    const vdoor = makeDoor(g, vx1 + 0.25, vz1 - 0.9, "z", 1.8, 2.5, M.steelD, 0.55);
    vdoor.y0 = FY; vdoor.y1 = FY + 2.5;
    vdoor.colRec.y0 = FY; vdoor.colRec.y1 = FY + 2.5;
    rec.doors.push(vdoor);
    doorTokens.push({ x: vx1 + 0.9, z: vz1 - 0.9, door: vdoor, name: "Weapons Vault" });
    // the CRADLE + THE DEVICE (one per world): polished casing on a steel
    // saddle under a red cage lamp — the room exists for this one object.
    const devX = vx0 + 2.6, devZ = vz0 + 2.6;
    box(g, devX, FY + 0.35, devZ, 2.0, 0.7, 1.2, M.steelD);
    for (const s of [-0.55, 0.55]) box(g, devX + s, FY + 0.82, devZ, 0.16, 0.28, 1.1, M.steel);
    const dev = new THREE.Group();
    const shellM = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.7, 12), cm(M.device));
    shellM.rotation.z = Math.PI / 2; dev.add(shellM);
    const noseM = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), cm(M.device));
    noseM.position.x = 0.85; dev.add(noseM);
    const tailM = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.5, 12), cm(M.deviceD));
    tailM.rotation.z = Math.PI / 2; tailM.position.x = -1.05; dev.add(tailM);
    const bandM = new THREE.Mesh(new THREE.CylinderGeometry(0.435, 0.435, 0.18, 12), cm(M.red));
    bandM.rotation.z = Math.PI / 2; bandM.position.x = 0.2; dev.add(bandM);
    dev.position.set(devX, FY + 1.15, devZ);
    dev.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    dev.userData.nukeDevice = true;               // spare from the merger (we hide it on take)
    g.add(dev);
    col(devX - 1.1, devX + 1.1, devZ - 0.7, devZ + 0.7, FY, FY + 1.5);
    glow(g, devX, CEIL - 0.2, devZ, 0.5, 0.14, 0.5, 0xc23a2e, 0.9);           // red cage lamp
    for (let i = 0; i < 3; i++) glow(g, vx0 + 0.9 + i * 1.6, FY + 0.05, vz1 - 0.6, 1.1, 0.04, 0.24, M.warn, 0.25); // floor stripes
    vaultTokens.push({ x: devX, z: devZ, taken: false, deviceMesh: dev });
  }

  // ---- OUTPOST TIER (mountain / desert): one abandoned room, themed --------
  function furnishOutpost(g, rec, ix0, ix1, iz0, iz1, cx, cz, FY, site) {
    const desert = site.theme === "desert";
    // cot rows (civil-defense monotony): 4 cots along the -X wall
    for (let i = 0; i < 4; i++) {
      const bz = iz1 - 2.5 - i * 2.4, bx = ix0 + 1.3;
      box(g, bx, FY + 0.4, bz, 1.9, 0.1, 0.9, M.cotFrame);
      box(g, bx, FY + 0.49, bz, 1.7, 0.08, 0.75, M.cot, { cast: false });
      for (const s of [-0.8, 0.8]) box(g, bx + s, FY + 0.2, bz, 0.09, 0.4, 0.7, M.steelD);
      col(ix0, ix0 + 2.4, bz - 0.55, bz + 0.55, FY, FY + 0.6);
    }
    // supply shelving + water drums along the +X wall
    for (let i = 0; i < 2; i++) {
      const sz = iz1 - 3 - i * 3.6, sx = ix1 - 1.1;
      box(g, sx, FY + 1.0, sz, 0.6, 2.0, 2.4, M.shelf);
      for (let k = 0; k < 3; k++) box(g, sx - 0.05, FY + 0.45 + k * 0.62, sz - 0.6 + k * 0.6, 0.5, 0.34, 0.5, M.crate);
      col(ix1 - 1.5, ix1, sz - 1.3, sz + 1.3, FY, FY + 2.0);
    }
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.0, 10), cm(M.drum));
      d.position.set(ix1 - 1.0, FY + 0.5, iz0 + 1.4 + i * 1.1);
      d.castShadow = true; d.receiveShadow = true; g.add(d);
    }
    col(ix1 - 1.6, ix1 - 0.4, iz0 + 0.8, iz0 + 4.2, FY, FY + 1.1);
    // dead radio desk at the back — the site went dark mid-shift
    box(g, cx, FY + 0.78, iz0 + 1.2, 1.8, 0.1, 0.8, M.desk);
    for (const s of [-0.8, 0.8]) box(g, cx + s, FY + 0.4, iz0 + 1.2, 0.12, 0.76, 0.7, M.desk);
    box(g, cx, FY + 1.25, iz0 + 0.9, 1.0, 0.8, 0.5, M.radio);
    box(g, cx + 1.6, FY + 0.28, iz0 + 1.8, 0.6, 0.56, 0.6, M.chair);
    col(cx - 0.95, cx + 0.95, iz0 + 0.7, iz0 + 1.7, FY, FY + 1.3);
    // generator block (desert: sand-drifted floor patch; snow: frost skin)
    box(g, ix0 + 1.2, FY + 0.55, iz0 + 1.4, 1.6, 1.1, 1.1, M.steelD);
    col(ix0 + 0.3, ix0 + 2.1, iz0 + 0.8, iz0 + 2.0, FY, FY + 1.2);
    box(g, cx + (desert ? 2 : -2), FY + 0.03, cz + 2, 4, 0.06, 3, desert ? M.sand : 0xdfe6ea, { cast: false });
    // THE CACHE — one strong find per site
    const ccX = cx + 2.2, ccZ = iz0 + 3.6;
    box(g, ccX, FY + 0.45, ccZ, 1.3, 0.9, 2.2, M.crate);
    glow(g, ccX, FY + 0.92, ccZ, 1.32, 0.06, 0.3, M.warn, 0.3);
    col(ccX - 0.75, ccX + 0.75, ccZ - 1.2, ccZ + 1.2, FY, FY + 0.95);
    crateTokens.push({ x: ccX, z: ccZ, kind: "cache", taken: false });
  }

  // ============================================================
  //  SITES + LANDMASS REGISTRATION (order 40: after the airport 21 /
  //  military 22 / snow 30 / desert 31 builders, so their height fields
  //  and footprints exist; before the default-50 systems).
  // ============================================================
  // sample a biome height field over the footprint → the slab grade that
  // keeps terrain from poking through the floor anywhere inside.
  function gradeFor(fn, cx, cz, w, d) {
    if (typeof fn !== "function") return { floorY: 0, grade0: 0, found: 0 };
    let hi = -1e9, lo = 1e9, door = 0;
    for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
      let v = 0;
      try { v = fn(cx + gx * w * 0.45, cz + gz * d * 0.45) || 0; } catch (e) { v = 0; }
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    try { door = fn(cx, cz + d / 2 + 3) || 0; } catch (e) { door = 0; }
    const floorY = Math.max(0, hi + 0.15);
    return { floorY, grade0: Math.max(0, door), found: Math.max(0, floorY - Math.max(0, lo)) + 1.2 };
  }

  CBZ.addLandmass(function (city) {
    if (CBZ.CONFIG.STRAT_BUNKERS === false) return;
    const root = city.root || CBZ.scene;
    // a rebuild re-runs this builder — fresh lists (stale doors/records would
    // point at removed groups; the zones' find() walks these live lists)
    doors.length = 0; bunkers.length = 0;
    doorTokens.length = 0; crateTokens.length = 0; vaultTokens.length = 0;
    _npcCursor = 0; _npcSpawned.length = 0;

    // ---- SITE 1: FORT BRANDT DEEP SHELTER (command tier). NW quadrant of
    // the military island — clear of the radar (-590,-900), barracks
    // (-440,-890..-788), watchtowers (corners) and helipads (z=-670).
    buildBunker(city, root, {
      id: "brandt", name: "Fort Brandt Deep Shelter", subtitle: "Military Reservation",
      cx: -762, cz: -872, w: 36, d: 30, tier: "command", floorY: 0, grade0: 0,
    });

    // ---- SITE 2: MOUNTAIN EARLY-WARNING POST (outpost). East shoulder of
    // the snow massif (snow rect -70..770 × -1780..-1120), hash-jittered,
    // seated on the sampled grade of the massif height field.
    const m2x = 560 + Math.round((h01(11, 71, 0xb11) - 0.5) * 60);
    const m2z = -1600 + Math.round((h01(23, 47, 0xb12) - 0.5) * 60);
    const gm = gradeFor(CBZ.snowTerrainHeightAt, m2x, m2z, 22, 18);
    buildBunker(city, root, {
      id: "ridge", name: "Ridge Line Station", subtitle: "Early-Warning Post",
      cx: m2x, cz: m2z, w: 22, d: 18, tier: "outpost", theme: "snow",
      floorY: gm.floorY, grade0: gm.grade0, found: gm.found, crete: M.snowcrete,
    });

    // ---- SITE 3: DESERT CIVIL-DEFENSE SHELTER (outpost). Far SE corner of
    // the basin (680..1560 × -320..620), well clear of the town (~1150,110).
    const d3x = 1450 + Math.round((h01(31, 5, 0xb21) - 0.5) * 50);
    const d3z = 500 + Math.round((h01(7, 13, 0xb22) - 0.5) * 50);
    const gd = gradeFor(CBZ.desertTerrainHeightAt, d3x, d3z, 22, 18);
    buildBunker(city, root, {
      id: "mesa", name: "Station 9 Fallout Shelter", subtitle: "Civil Defense",
      cx: d3x, cz: d3z, w: 22, d: 18, tier: "outpost", theme: "desert",
      floorY: gd.floorY, grade0: gd.grade0, found: gd.found, crete: M.dcrete,
    });

    // regions: the REMOTE finds get named presence (the Brandt shelter lives
    // inside the already-registered Fort Brandt rect — a nested venue).
    if (CBZ.registerCityRegion) {
      CBZ.registerCityRegion(city, { name: "Ridge Line Station", subtitle: "Early-Warning Post", kind: "rect", minX: m2x - 14, maxX: m2x + 14, minZ: m2z - 12, maxZ: m2z + 16, pad: 2 });
      CBZ.registerCityRegion(city, { name: "Station 9", subtitle: "Fallout Shelter", kind: "rect", minX: d3x - 14, maxX: d3x + 14, minZ: d3z - 12, maxZ: d3z + 16, pad: 2 });
    }
    // nobody spawns ON a berm (mirror the runway keep-out idiom)
    if (CBZ.registerNoSpawnZone) {
      for (const b of bunkers) CBZ.registerNoSpawnZone(city, { minX: b.shell.minX, maxX: b.shell.maxX, minZ: b.shell.minZ, maxZ: b.shell.maxZ, label: "bunker-" + b.id });
    }
    wireZones();
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }, 40);

  // ============================================================
  //  BUNKER PERSONNEL — the command shelter is MANNED: two seated duty
  //  officers (peds.js sit grammar) + two stationed hall guards. Spawned
  //  incrementally once the ped factory exists (island_military idiom);
  //  a city ped reset simply lets them respawn on the next pass.
  // ============================================================
  let _npcCursor = 0;
  const _npcSpawned = [];
  CBZ.onUpdate(38.95, function () {
    if (CBZ.CONFIG.STRAT_BUNKERS === false) return;
    const g = CBZ.game;
    if (!g || g.mode !== "city" || !CBZ.cityMakePed || CBZ.citySpawnDraining) return;
    const cmd = bunkers.find(function (b) { return b.tier === "command"; });
    if (!cmd) return;
    // reset detection: all our bodies left the roster → replay the specs
    if (_npcSpawned.length) {
      const roster = CBZ.cityPeds || [];
      let live = 0;
      for (let i = 0; i < _npcSpawned.length; i++) if (roster.indexOf(_npcSpawned[i]) >= 0) live++;
      if (!live) { _npcSpawned.length = 0; _npcCursor = 0; }
    }
    if (_npcCursor >= cmd.troopSpecs.length) return;
    const spec = cmd.troopSpecs[_npcCursor++];              // one per tick — no hitch
    // a REAL seeded LCG for the ped factory's appearance draws (a constant-
    // return closure would hand every roll the same number → clone soldiers)
    let seed = (h01(spec.x, spec.z, 0xbeef + _npcCursor) * 0x7fffffff) | 0;
    const pedRng = function () { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    let p = null;
    try {
      p = CBZ.cityMakePed(spec.x, spec.z, pedRng,
        { job: "soldier", kind: "civilian", armed: !spec.sit, weapon: "AK-47", aggr: 0.4, hp: 140 });
    } catch (e) { p = null; }
    if (!p) return;
    try {
      (cmd.root || CBZ.scene).add(p.group);
      if (CBZ.cityPeds) CBZ.cityPeds.push(p);
      p.organization = "military"; p.organizationLoyalty = 100;
      if (spec.sit) {
        // the officer takes the chair: seat grammar (state "sit" pins the body
        // to the anchor; char.sitting folds the rig; combat interrupts it).
        p.pos.x = spec.sit.x; p.pos.z = spec.sit.z;
        p.group.position.set(spec.sit.x, 0, spec.sit.z);
        p.group.rotation.y = spec.sit.face || 0;
        p._deskAnchor = { x: spec.sit.x, y: 0, z: spec.sit.z, face: spec.sit.face || 0 };
        p.state = "sit"; p.pause = 9e9; p.speed = 0;
        if (p.char) p.char.sitting = true;
      } else {
        p.state = "idle"; p.pause = 9e9;
        p._stationed = { x: spec.x, z: spec.z };
      }
      _npcSpawned.push(p);
    } catch (e) {}
  });
})();
