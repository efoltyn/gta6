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
  // NUKE_STASH_TRIPLE — the vault cradle carries THREE warheads on a handling
  // rack instead of one bare casing. It is still ONE inventory item and one
  // usable weapon (see the stash block in furnishCommand): the count, the
  // one-per-world scarcity and every existing gate are unchanged. false =>
  // the single casing, byte-for-byte. Declared here too so this file degrades
  // correctly when config.js is older than it is.
  if (CBZ.CONFIG.NUKE_STASH_TRIPLE == null) CBZ.CONFIG.NUKE_STASH_TRIPLE = true;

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
      // the rest of the leaf's steel: a top rib, three vertical stiffeners on
      // the outer face, and a black/yellow band down the meeting edge — all
      // children, so they slide with it
      const ax = along === "x";
      const kid = function (w, h, d, x, y, z, hex, rz) {
        const c = new THREE.Mesh(bg(ax ? w : d, h, ax ? d : w), cm(hex));
        c.position.set(ax ? x : 0, y, ax ? 0 : x);
        if (z) { if (ax) c.position.z = z; else c.position.x = z; }
        if (rz) { if (ax) c.rotation.z = rz; else c.rotation.x = rz; }
        c.castShadow = true; c.userData.blastDoor = true;
        m.add(c);
        return c;
      };
      kid(lw * 0.78, 0.16, t + 0.06, 0, height * 0.38, 0, M.steelD);
      kid(lw * 0.78, 0.12, t + 0.05, 0, -height * 0.36, 0, M.steelD);
      kid(lw * 0.6, height * 0.5, t + 0.012, -s * 0.04, -height * 0.02, 0, 0x7a828c);   // machined face plate
      const edge = -s * (lw / 2 - 0.09);
      kid(0.16, height - 0.1, t + 0.02, edge, 0, 0, M.warn);
      for (let q = 0; q < 6; q++) kid(0.2, 0.07, t + 0.03, edge, -height / 2 + 0.25 + q * (height - 0.4) / 5, 0, 0x1a1b1d, s * 0.7);
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
      cx, cz, y0: 0, y1: height, trav: hw + 0.12, disabled: false, freezeT: 0,
    };
    doors.push(rec);
    return rec;
  }
  function soundDoor(rec, open) {
    const P = CBZ.player && CBZ.player.pos;
    if (!CBZ.sfx || !P || !rec) return;
    const dist = Math.hypot(P.x - rec.cx, P.y - ((rec.y0 + rec.y1) / 2), P.z - rec.cz);
    if (dist >= 34) return;
    const volume = dist <= 5 ? 1 : Math.max(0.06, 1 - (dist - 5) / 29);
    CBZ.sfx(open ? "door_open" : "door_close", { dist: dist, volume: volume });
  }
  function playerInsideDoorBunker(rec) {
    const P = CBZ.player && CBZ.player.pos;
    const b = rec && rec.bunker;
    const q = b && b.interior;
    return !!(P && q &&
      P.x >= q.minX && P.x <= q.maxX && P.z >= q.minZ && P.z <= q.maxZ &&
      P.y >= q.floorY - 0.8 && P.y <= q.ceilY + 0.8);
  }
  function setDoor(rec, open, audible) {
    if (!rec || rec.disabled) return;
    const target = open ? 1 : 0;
    if (rec.target === target) return;
    rec.target = target;
    rec._physicalAudioTarget = target;
    if (open) rec.holdT = 14;                     // generous auto-seal window
    if (audible) {
      soundDoor(rec, open);
      rec.playerSoundCycle = !!open;
    }
  }
  // the one door updater: ease leaves, keep the collider honest. Early-outs
  // when nothing is moving so headless sim ticks pay ~nothing.
  CBZ.onUpdate(38.9, function (dt) {
    if (!doors.length) return;
    const P = CBZ.player;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (d._physicalAudioTarget == null) d._physicalAudioTarget = d.open > 0.5 ? 1 : 0;
      if (d._physicalAudioTarget !== d.target) {
        // Structural breaches/NPC systems may move the same real leaf. They are
        // audible only to somebody physically inside this bunker.
        if (playerInsideDoorBunker(d)) soundDoor(d, d.target === 1);
        d._physicalAudioTarget = d.target;
      }
      // a blast-jammed door finishes its travel on GAME time, then locks in
      // that pose forever (the setTimeout this replaces ran on wall-clock and
      // could freeze a leaf halfway through its ease under a headless burst)
      if (d.freezeT > 0) {
        d.freezeT -= dt;
        if (d.freezeT <= 0) { d.freezeT = 0; d.disabled = true; }
      }
      if (d.disabled) continue;
      // hold open while someone stands in the doorway (elevator no-crush rule)
      if (d.target === 1) {
        d.holdT -= dt;
        let occupied = false;
        if (P && P.pos) {
          const dx = P.pos.x - d.cx, dz = P.pos.z - d.cz;
          occupied = dx * dx + dz * dz < 2.4 * 2.4;
        }
        if (d.holdT <= 0 && !occupied) {
          d.target = 0;
          d._physicalAudioTarget = 0;
          if (d.playerSoundCycle) soundDoor(d, false);
          d.playerSoundCycle = false;
        }
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
  // How hard is this roof, in metres of CONCRETE-EQUIVALENT? This is the
  // number that makes a bunker-buster a skill rather than a button: the
  // weapon's penetration is computed from its real impact energy
  // (city/strategic.js: depth ∝ sqrt(E), GBU-28's published ~6 m at a nominal
  // release) and compared against THIS. A civil-defense shelter is a slab of
  // concrete and a hill; a command shelter is built to survive exactly this
  // attack, so it demands a full-throttle release from real altitude.
  //   command 8.5 CE  → needs ≈2x nominal energy: 240 m/s and ~220 m AGL
  //   outpost 3.2 CE  → almost any competent release opens it
  const ROOF_CE = { command: 8.5, outpost: 3.2 };
  CBZ.strategicBunkerRoof = function (b) {
    if (!b) return 0;
    return b.roofCE != null ? b.roofCE : (ROOF_CE[b.tier] || ROOF_CE.outpost);
  };
  // BREACH — the bunker-buster's structural verdict.
  //   opts.penCE : concrete-equivalent metres the round actually achieved.
  //                Omitted (a caller from before penetration existed) ⇒ treat
  //                as a clean breach, so nothing that used to work stops.
  // Returns { verdict: "breach" | "crack" | "held", roofCE, penCE }.
  //   breach — the entrance hangs open for good, a crater caps the mound, and
  //            the shelter guarantee ends.
  //   crack  — through most of the roof: spall inside, the doors jam OPEN
  //            (the pressure wave takes them), but the structure still shelters.
  //   held   — spent on the berm.
  // (Killing whoever is inside is the WEAPON's job — strategic.js sweeps the
  // interior bounds through the kill bus; this handles only the structure.)
  // TWO IN THE SAME HOLE. A penetrator that does not get through still digs
  // its own depth out of the roof (`wornCE`), and the next one starts from the
  // bottom of that crater — which is how real deep bunkers are attacked (and
  // why a head of state's needs two GBU-57s where a cell's dug-out needs one).
  CBZ.strategicBunkerBreach = function (b, opts) {
    if (!b) return { verdict: "held", roofCE: 0, penCE: 0 };
    const roofCE = Math.max(0, CBZ.strategicBunkerRoof(b) - (b.wornCE || 0));
    const penCE = (opts && opts.penCE != null) ? +opts.penCE : Infinity;
    if (b.breached) return { verdict: "breach", roofCE: roofCE, penCE: penCE };
    if (isFinite(penCE)) b.wornCE = (b.wornCE || 0) + Math.max(0, penCE);
    if (!(penCE >= roofCE)) {
      // not through. A near miss still wrecks the entrance — 60% of the way
      // through a hardened roof is a survivable room, not an untouched one.
      const crack = penCE >= roofCE * 0.6;
      if (crack) {
        b.cracked = true;
        for (const d of b.doors) { d.target = 1; d.holdT = 9e9; d.freezeT = 1.4; }
        if (CBZ.cityScorch) { try { CBZ.cityScorch((b.shell.minX + b.shell.maxX) / 2, (b.shell.minZ + b.shell.maxZ) / 2, 4); } catch (e) {} }
      }
      return { verdict: crack ? "crack" : "held", roofCE: roofCE, penCE: penCE };
    }
    b.breached = true;
    // THE MOUND CAVES IN: the upper tiers and the crown drop into the room
    // (the crater dish and the tumbled slabs below are what is left on top)
    if (b.topMeshes) for (const m of b.topMeshes) { if (m) m.visible = false; }
    for (const d of b.doors) {
      d.target = 1; d.holdT = 9e9;               // hangs open…
      d.disabled = false;                         // (let the ease finish)
    }
    // crater cap: a dark dish + tumbled slabs on the mound top, deterministic
    // per site (the same crater on every client from the same hit).
    try {
      const g = b.root, S = b.shell;
      const cx = (S.minX + S.maxX) / 2, cz = (S.minZ + S.maxZ) / 2;
      // with the tiers caved in, the rubble sits on the first tier
      if (b.topMeshes) b.moundTop = b.interior.floorY + (b.baseTop || 2.4) + 0.3;
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
      // Sustain the door-open pose until the ease lands, then freeze it.
      // This used to be a setTimeout: real wall-clock, so it fired 60x early
      // relative to a headless sim burst and could freeze a door mid-travel.
      // freezeT is ticked by the ONE door updater below, on game dt.
      for (const d of b.doors) { d.disabled = false; d.freezeT = 1.4; }
    } catch (e) {}
    return { verdict: "breach", roofCE: roofCE, penCE: penCE };
  };

  // ============================================================
  //  INTERACTION ZONES — doors, crates, the vault device. One registry,
  //  registered once; find() walks the live per-site token lists so a city
  //  rebuild (which re-runs the landmass builder) just refreshes the lists.
  // ============================================================
  const doorTokens = [];     // {x, z, door, name}
  const crateTokens = [];    // {x, z, kind:"armory"|"cache", site, nextRestock, taken}
  const vaultTokens = [];    // {x, z, site, taken, deviceMesh}
  const strikeTokens = [];   // {x, z, site}  — the command map table
  const nukeTokens = [];     // {x, z, site}  — the nuclear release console
  let _zonesWired = false;
  function nearestTok(list, px, pz, r) {
    let best = null, bd = r * r;
    for (let i = 0; i < list.length; i++) {
      const t = list[i], dx = t.x - px, dz = t.z - pz, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = t; }
    }
    return best;
  }
  /* ---- §DOORS THAT ANSWER TO THE LEDGER -----------------------------------
     ONE-LINE ADOPTION of city/loyalty.js's CBZ.cityLock, degrade-safe: with
     loyalty.js absent every door behaves exactly as it did before (open), so
     flipping LOYALTY_LOCKS off is a true one-line revert and cannot strand a
     player inside a shelter. A token declares `lock` and nothing else; the
     sentence and the routes are the shared law's business, not this file's. */
  function doorLock(t) {
    if (!t || !t.lock) return { open: true, line: "" };
    if (!CBZ.cityLock) return { open: true, line: "" };
    return CBZ.cityLock({
      id: t.lock.id, verb: t.lock.verb, label: t.name || "The door",
      orgs: t.lock.orgs, keys: t.lock.keys, minTier: t.lock.minTier,
      // this door was UNGATED before this wave: a flag-off must re-open it,
      // never seal the endgame behind a switch. (The prison armory, which was
      // already key-gated, deliberately does NOT pass this.)
      wasOpen: true,
      // FORCE IS ALWAYS A KEY. A door already blown open by a bunker buster,
      // or one somebody has opened, must never re-lock behind the player.
      have: !!(t.door && (t.door.disabled || t.door.target === 1)),
    });
  }

  function wireZones() {
    if (_zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    const I = CBZ.interactions;
    I.registerZone({
      id: "bunker-doors", kind: "bunkerdoor", radius: 4.2,
      find: function (px, pz) { return nearestTok(doorTokens, px, pz, 4.2); },
      options: [{
        id: "bunkerdoor-open", slot: "e",
        /* §THE VAULT IS LOCKED, AND THE LOCK SAYS WHAT WOULD OPEN IT.
           The apex prize of the whole game — the one nuclear stash in the world
           — stood behind a blast door with the SAME ungated [E] as a supply
           cupboard. Any player who walked into Fort Brandt took it, at hour
           one, with nothing. That is not a gun room; it is a shelf.
           OWNER LAW 1: "a locked door with something visible behind it
           out-motivates any quest marker". So the door answers to the loyalty
           ledger, and refusing SAYS the route — the door is the quest giver.
           `have` is a blasted/already-open leaf: force is always a valid key,
           which is what keeps the bunker-buster path honest.                */
        canShow: function (t) { return !t.door.disabled; },   // blasted open: nothing left to do with it
        label: function (t) {
          if (t.door.target === 1) return "Seal";
          return doorLock(t).open ? "Open" : "Try";
        },
        onSelect: function (t) {
          if (t.door.disabled) return;
          if (t.door.target === 1) { setDoor(t.door, false, true); return; }
          const L = doorLock(t);
          if (!L.open) {
            if (CBZ.city && CBZ.city.note) CBZ.city.note(L.line, 3.4);
            return;
          }
          setDoor(t.door, true, true);
        },
      }],
    });
    if (I.describe) I.describe("bunkerdoor", function (t) {
      const L = doorLock(t);
      return {
        label: t.name || "Blast Door",
        note: L.open ? "Hardened shelter, the door is the only way in" : "SEALED · " + (t.lockNote || "it answers to somebody who has more than you"),
      };
    });
    // A HAND INTO THE CRATE (systems/verbs_pickup.js): the reach, and what is
    // in it comes out in the hand; the take lands on the grab frame
    const crateHand = function (t, kind, fn) {
      const V = CBZ.verbs, P = CBZ.player;
      if (V && V.pickup && P && P.pos) V.pickup(P, { x: t.x, y: (P.pos.y || 0) + 0.55, z: t.z, kind: kind }, { key: t, pose: "grip", onTaken: fn });
      else fn();
    };
    I.registerZone({
      id: "bunker-crates", kind: "bunkercrate", radius: 3.2,
      find: function (px, pz) { return nearestTok(crateTokens, px, pz, 3.2); },
      options: [{
        id: "bunkercrate-take", slot: "e",
        canShow: function (t) {
          if (t.kind === "armory") return !((CBZ.paceDay ? CBZ.paceDay() : 0) < t.nextRestock);
          return !t.taken;
        },
        label: function (t) { return t.kind === "armory" ? "Take 2" : "Crack open"; },
        onSelect: function (t) {
          const e = CBZ.cityEcon;
          if (t.kind === "armory") {
            /* THE RUNG BELOW THE VAULT. Bunker-buster penetrators are the tool
               that opens the tier above (they are what blows a blast door), so
               the crate that holds them is itself a gun room one step down —
               CLAUDE.md's "ladder of gun rooms, each rung unlocking the tools
               of the next". Ungated, it handed the vault's own counter-key to
               anyone on day one. */
            const L = CBZ.cityLock ? CBZ.cityLock({ id: "bunker-armory", verb: "armory", label: "The ordnance crate", orgs: ["army", "military"], wasOpen: true }) : { open: true };
            if (!L.open) { if (CBZ.city && CBZ.city.note) CBZ.city.note(L.line, 3.2); return; }
            const day = CBZ.paceDay ? CBZ.paceDay() : 0;
            if (day < t.nextRestock) { if (CBZ.city && CBZ.city.note) CBZ.city.note("The quartermaster restocks the penetrators daily.", 2); return; }
            t.nextRestock = day + 1;
            // the hands go into the crate (systems/verbs_pickup.js); loaded on the grab frame
            crateHand(t, "box", function () {
              if (e && e.add) e.add("Bunker Buster", 2);
              if (CBZ.city && CBZ.city.note) CBZ.city.note("2× GBU-57 bunker busters loaded, the B-2's bay carries them.", 2.6);
            });
          } else {
            if (t.taken) return;
            t.taken = true;
            crateHand(t, "cash", function () {
              if (e && e.add) e.add("Bunker Buster", 1);
              if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(2500);
              if (CBZ.cityAddAmmo) { try { CBZ.cityAddAmmo(60); } catch (er) {} }
              if (CBZ.city && CBZ.city.note) CBZ.city.note("Cache: a bunker buster, $2,500 and 60 rounds.", 2.6);
              if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (er) {} }
            });
          }
        },
      }],
    });
    if (I.describe) I.describe("bunkercrate", function (t) {
      return { label: t.kind === "armory" ? "Ordnance Crate" : "Supply Cache", note: t.kind === "armory" ? "GBU-57 penetrators. B-2 payload" : "Left behind when the site went dark" };
    });
    I.registerZone({
      id: "bunker-vault", kind: "nukevault", radius: 2.8,
      find: function (px, pz) { return nearestTok(vaultTokens, px, pz, 2.8); },
      options: [{
        id: "nukevault-take", slot: "e", bad: true,
        // THREE WARHEADS, ONE NUKE: the label says what is on the rack, the
        // ledger below still moves exactly one item.
        canShow: function (t) { return !t.taken; },
        label: function () { return CBZ.CONFIG.NUKE_STASH_TRIPLE === false ? "Take" : "Take 3"; },
        onSelect: function (t) {
          if (t.taken) return;
          const e = CBZ.cityEcon;
          if (e && e.count && e.count("Nuclear Device") > 0) { if (CBZ.city && CBZ.city.note) CBZ.city.note("You already carry the device.", 1.8); return; }
          t.taken = true;
          // TAKEN WITH THE HANDS (systems/verbs_pickup.js): the device comes
          // off the rack in the hands; everything below lands on the grab frame
          const took = function () {
            if (t.deviceMesh) t.deviceMesh.visible = false;
            if (e && e.add) e.add("Nuclear Device", 1);
            if (CBZ.city && CBZ.city.big) { try { CBZ.city.big("You are carrying a NUCLEAR DEVICE."); } catch (er) {} }
            if (CBZ.city && CBZ.city.note) {
              // The timer belongs to strategic.js; read it rather than retyping
              // it — this line was still advertising 45 s long after it moved.
              const sec = (CBZ.strategicState && CBZ.strategicState().plantTimer) || 90;
              CBZ.city.note("Deploy: plant it on foot (" + sec + "s on the clock), or load the B-2's bay.", 4.2);
            }
            // walking out with the country's deterrent is the loudest theft there is
            if (CBZ.cityCrime) { try { CBZ.cityCrime(200, { x: t.x, z: t.z, type: "grand-theft-military", instant: true }); } catch (er) {} }
          };
          if (CBZ.verbs && CBZ.verbs.pickup) CBZ.verbs.pickup(CBZ.player, t.deviceMesh || null, { pose: "grip", keep: true, onTaken: took });
          else took();
        },
      }],
    });
    if (I.describe) I.describe("nukevault", function () {
      return {
        label: "Weapons Vault",
        note: CBZ.CONFIG.NUKE_STASH_TRIPLE === false
          ? "One device. One per world. No second chances."
          : "Three warheads, one stash. One per world. No second chances.",
      };
    });

    /* ---- THE STRIKE CONSOLE ------------------------------------------------
       "Call a strike" without inventing a strike system. Every part of this is
       already in the game and stays there:
         the aimpoint   = fullmap.js's waypoint (CBZ.fullMap.waypoint())
         the sortie     = city/strategic.js's CBZ.strategicCallStrike — a
                          B-52 cell flown in by playerair.js's
                          CBZ.cityStrikeFlight, the one strike flight
         the impacts    = every Mk-82 a real store off its bay clip, through
                          strategic.js's release and CBZ.detonate, once each
         the verb + pill= this registry
       Zero new bookkeeping, and the heat is the real cost: ordering a bombing
       run out of a stolen command shelter is a five-star act.               */
    I.registerZone({
      id: "bunker-strike", kind: "bunkerstrike", radius: 2.6,
      find: function (px, pz) {
        if (!CBZ.strategicCallStrike) return null;
        return nearestTok(strikeTokens, px, pz, 2.6);
      },
      options: [{
        id: "bunkerstrike-call", slot: "e", bad: true,
        canShow: function () { return !!waypoint(); },   // no waypoint: nothing to call it on
        label: function () { return "Call in"; },
        onSelect: function (t) {
          /* AN ORDER NEEDS SOMEBODY WHO CAN GIVE IT. Tasking a bomber is the
             purest "categorical, not numeric" power in the game and it stood
             open to a man with a pistol. `siege` is the rung that opens it. */
          const L = CBZ.cityLock ? CBZ.cityLock({ id: "bunker-strike", verb: "siege", label: "The strike console", orgs: ["army", "military"], wasOpen: true }) : { open: true };
          if (!L.open) { if (CBZ.city && CBZ.city.note) CBZ.city.note(L.line, 3.2); return; }
          const wp = waypoint();
          if (!wp) {
            if (CBZ.city && CBZ.city.note) CBZ.city.note("Open the map and mark the grid you want flattened.", 2.6);
            return;
          }
          const ok = CBZ.strategicCallStrike({
            x: wp.x, z: wp.z, count: 12, kind: "bomb",
            heading: Math.atan2(wp.x - t.x, wp.z - t.z),   // the bomber runs in from here
            byPlayer: true,
          });
          if (!ok) { if (CBZ.city && CBZ.city.note) CBZ.city.note("No sortie available.", 1.8); return; }
          // ordering a bombing run is not a misdemeanour
          if (CBZ.cityCrime) { try { CBZ.cityCrime(400, { x: wp.x, z: wp.z, type: "terrorism", instant: true }); } catch (e) {} }
          if (CBZ.cityAddStars) { try { CBZ.cityAddStars(5, "Airstrike called on a civilian grid"); } catch (e) {} }
        },
      }],
    });
    if (I.describe) I.describe("bunkerstrike", function (t) {
      const wp = waypoint();
      return {
        label: "Strike Console",
        note: wp ? "Tasks a B-52 cell against your marked waypoint" : "Needs a map waypoint to task",
      };
    });

    /* ---- THE NUCLEAR RELEASE CONSOLE ---------------------------------------
       OWNER (2026-08-04): "they should be able to order a nuke on a place and
       literally in the game, a B-2 should fly to that place and drop a nuke.
       The same way that it works when you currently drop a nuke in pilot."

       The console is one verb. Everything behind it already existed or is one
       new seam in the file that owns bombers:
         the aimpoint = fullmap.js's waypoint, the same one the strike console
                        reads — never a second target picker
         the sortie   = strategic.js's CBZ.strategicNuclearSortie, which CLAIMS
                        the parked B-2, flies it here, and calls the same
                        release the player's [B] key calls
         the impact   = whatever that release does, which is nukeDetonate and
                        the bus — this file contributes nothing to the physics
         the verb     = this registry

       WHY A RUNG ABOVE THE STRIKE CONSOLE. `siege` (an outfit) can task iron.
       `vault` is the apex grant — the same authority that opens the nuclear
       vault six metres away — and it is the only thing in this room that
       should be able to order a city erased. The refusal LINE comes back from
       the sortie itself, because every reason it can say no with is a fact
       about the world (no bomber on the pad, no aircrew alive, a weapon
       already in the air) rather than a cooldown, and the player has earned a
       straight answer about which one it is.                                */
    I.registerZone({
      id: "bunker-nuke", kind: "bunkernuke", radius: 2.6,
      find: function (px, pz) {
        if (!CBZ.strategicNuclearSortie) return null;
        return nearestTok(nukeTokens, px, pz, 2.6);
      },
      options: [{
        id: "bunkernuke-release", slot: "e", bad: true,
        canShow: function () { return !!waypoint(); },   // no waypoint: nothing to launch at
        label: function () { return "Launch"; },
        onSelect: function () {
          const L = CBZ.cityLock ? CBZ.cityLock({ id: "bunker-nuke", verb: "vault", label: "The release console", orgs: ["army", "military"], wasOpen: true }) : { open: true };
          if (!L.open) { note(L.line, 3.2); return; }
          const wp = waypoint();
          if (!wp) { note("Open the map and mark the grid.", 2.6); return; }
          const res = CBZ.strategicNuclearSortie({ x: wp.x, z: wp.z, label: wp.label || null, byPlayer: true });
          if (!res || !res.ok) { note((res && res.why) || "No sortie available.", 2.6); return; }
          // Ordering it is the crime. The detonation bills its own terrorism
          // charge when the weapon lands; this is the ORDER, and it is on you
          // from the moment the bomber rolls — the same shape the conventional
          // strike console already uses.
          if (CBZ.cityCrime) { try { CBZ.cityCrime(400, { x: wp.x, z: wp.z, type: "terrorism", instant: true }); } catch (e) {} }
          if (CBZ.cityAddStars) { try { CBZ.cityAddStars(5, "Nuclear release authorised"); } catch (e) {} }
        },
      }],
    });
    if (I.describe) I.describe("bunkernuke", function () {
      const st = CBZ.strategicSortieState ? CBZ.strategicSortieState() : null;
      let n;
      if (st && st.active) n = "A weapon is already airborne";
      else if (st && !st.bomber) n = "No bomber on the pad";
      else if (st && !st.crew) n = "No aircrew on the base";
      else n = waypoint() ? "Tasks the B-2 with one weapon" : "Needs a map waypoint to task";
      return { label: "Nuclear Release Console", note: n };
    });

    if (CBZ.cityLockRegister) { CBZ.cityLockRegister("bunker-armory"); CBZ.cityLockRegister("bunker-strike"); CBZ.cityLockRegister("bunker-nuke"); }
    _zonesWired = true;
  }
  function note(m, s) { if (CBZ.city && CBZ.city.note && m) { try { CBZ.city.note(m, s || 2.6); } catch (e) {} } }
  // the ONE waypoint in the game (systems/fullmap.js) — never a second one
  function waypoint() {
    try {
      const w = CBZ.fullMap && CBZ.fullMap.waypoint && CBZ.fullMap.waypoint();
      return (w && isFinite(w.x) && isFinite(w.z)) ? w : null;
    } catch (e) { return null; }
  }

  // ============================================================
  //  THE BUILDER — one parameterized bunker: an earth-covered shelter
  //  behind a concrete headwall, an enclosed interior, a blast door and
  //  tiered furnishings.
  //  site: {id, name, subtitle, cx, cz, w, d, tier:"command"|"outpost",
  //         floorY, crete, theme}
  //  Interior envelope: (w-5) × (d-5), 3.1 high, door on +Z face.
  //
  //  REBUILD (2026-10-31, Opus 5.5). The berm used to be three stacked earth
  //  BOXES. Their bottom faces pointed down into the room: from inside, the
  //  ceiling you saw was the underside of the second tier at 2.4 m, brown
  //  dirt, below the real 3.1 m ceiling and over the strip lights. And every
  //  piece of furniture was one or two boxes (a bunk was two planks on two
  //  sticks, a gun rack a slab with four sticks in it). Now:
  //    • the berm is a LOFTED MOUND (rock toe, earth shoulders, crown pad):
  //      one vertex-coloured mesh whose faces only ever point out or up, so
  //      nothing of it can be seen from inside; the front is a battered
  //      concrete HEADWALL with the portal standing proud of it;
  //    • the interior is a shelter: painted dado, ceiling beams, a vent duct
  //      on hangers, cable tray, fluorescent fittings in housings;
  //    • the furniture is real: tube-steel bunks with mattresses, blankets,
  //      pillows and a ladder, footlockers, an arms rack carrying the game's
  //      REAL rifles (CBZ.buildActorWeapon, baked), banded ammo crates, a
  //      light-table map, steel desks with monitors and swivel chairs, a 19"
  //      radio rack, a diesel genset, steel drums, folding cots.
  //  Every collider, platform, token, troop spec, door and record field is
  //  where it was; only what you SEE changed. Interior fixtures merge per
  //  finish through CBZ.storeFixtureKit (a few draw calls per bunker).
  // ============================================================

  // ---- the fixture kit: storeFixtureKit when loaded, else loose meshes ----
  function makeKit() {
    if (CBZ.storeFixtureKit) return CBZ.storeFixtureKit.create();
    const parts = [];
    const F = new THREE.Matrix4(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
    const _p = new THREE.Vector3(), _s = new THREE.Vector3();
    const shim = {
      frame: function (x, y, z, yaw) { F.makeRotationY(yaw || 0); F.setPosition(x || 0, y || 0, z || 0); return shim; },
      push: function (geo, color, kind, x, y, z, rx, ry, rz, sx, sy, sz) {
        _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
        _p.set(x || 0, y || 0, z || 0); _s.set(sx || 1, sy || 1, sz || 1);
        _m.compose(_p, _q, _s); _m.premultiply(F);
        geo.applyMatrix4(_m);
        parts.push({ geo: geo, color: color, kind: kind });
        return shim;
      },
      box: function (x, y, z, w, h, d, c, k, rx, ry, rz) { return shim.push(new THREE.BoxGeometry(w, h, d), c, k, x, y, z, rx, ry, rz); },
      cyl: function (x, y, z, rt, rb, h, c, k, rx, ry, rz, seg) { return shim.push(new THREE.CylinderGeometry(rt, rb, h, seg || 12), c, k, x, y, z, rx, ry, rz); },
      torus: function (x, y, z, r, t, c, k, rx, ry, rz, arc, seg) { return shim.push(new THREE.TorusGeometry(r, t, 6, seg || 18, arc == null ? Math.PI * 2 : arc), c, k, x, y, z, rx, ry, rz); },
      sphere: function (x, y, z, r, c, k, sx, sy, sz) { return shim.push(new THREE.SphereGeometry(r, 12, 9), c, k, x, y, z, 0, 0, 0, sx, sy, sz); },
      absorb: function () { return shim; },
      build: function (parent) {
        for (const p of parts) {
          const m = new THREE.Mesh(p.geo, p.kind === "glow" ? cm(p.color, { emissive: p.color, ei: 0.85 }) : cm(p.color));
          parent.add(m);
        }
        parts.length = 0;
      },
    };
    return shim;
  }
  // a real long gun from the weapon factory, stood muzzle-up and baked in
  function rackGun(k, id, x, y, z, lean) {
    if (!CBZ.buildActorWeapon || !CBZ.storeFixtureKit || !CBZ.storeFixtureKit.seat) return false;
    let m = null;
    try { m = CBZ.buildActorWeapon(id); } catch (e) { m = null; }
    if (!m) return false;
    m.rotation.set(0, 0, 0); m.position.set(0, 0, 0);
    const sc = (CBZ.weaponWorldScale && CBZ.weaponWorldScale(m.userData.weaponId || id)) || 0.95;
    m.scale.setScalar(sc);
    const holder = CBZ.storeFixtureKit.seat(m, function (turn, mm) { mm.rotation.set(Math.PI / 2, -Math.PI / 2, 0, "YXZ"); }, "min");
    k.absorb(holder, x, y, z, lean || 0, 0, 0);
    return true;
  }

  // ---- THE MOUND: lofted rings of a chamfered rectangle ------------------
  // rings: [{y, x0, x1, z0, z1, c}] (bottom → top), all in world units.
  // Each straight edge is cut into segments (the same count on every ring,
  // so the loft is a clean quad strip), mid points jittered on rings that
  // ask for it, so 36 m of earth does not read as four flat planes. Faces are
  // wound OUTWARD (tested per triangle against the ring centre), never down.
  let MOUND_MAT = null;
  function moundMesh(rings, opt) {
    opt = opt || {};
    const base = rings[0];
    const segs = [
      Math.max(2, Math.round((base.x1 - base.x0) / 4)), 1,
      Math.max(2, Math.round((base.z1 - base.z0) / 4)), 1,
      Math.max(2, Math.round((base.x1 - base.x0) / 4)), 1,
      Math.max(2, Math.round((base.z1 - base.z0) / 4)), 1,
    ];
    // perimeter walk: back edge (z0, x0→x1), corner, +x edge (z0→z1), corner,
    // FRONT edge (z1, x1→x0), corner, -x edge (z1→z0), corner
    function ring(r, ri) {
      const c = r.c, pts = [];
      const corners = [
        [r.x0 + c, r.z0], [r.x1 - c, r.z0], [r.x1, r.z0 + c], [r.x1, r.z1 - c],
        [r.x1 - c, r.z1], [r.x0 + c, r.z1], [r.x0, r.z1 - c], [r.x0, r.z0 + c],
      ];
      for (let e = 0; e < 8; e++) {
        const a = corners[e], b = corners[(e + 1) % 8], n = segs[e];
        for (let i = 0; i < n; i++) {
          const t = i / n;
          let x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          let y = r.y;
          if (r.jit && i > 0 && e !== 4) {
            const j = h01(x * 1.7 + ri, z * 1.3, 0xb0d);
            const nx = e === 2 ? 1 : (e === 6 ? -1 : 0), nz = e === 0 ? -1 : (e === 4 ? 1 : 0);
            x += nx * (j - 0.5) * r.jit; z += nz * (j - 0.5) * r.jit;
            y += (h01(z, x, 0xb0e) - 0.5) * r.jit * 0.5;
          }
          pts.push({ x: x, y: y, z: z, front: e === 4 || (e === 5 && i === 0) });
        }
      }
      return pts;
    }
    const R = rings.map(ring);
    const pos = [], col = [];
    const C = new THREE.Color();
    const mx = (base.x0 + base.x1) / 2, mz = (base.z0 + base.z1) / 2;
    function tri(a, b, c, hex, up) {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ox = up ? 0 : (a.x + b.x + c.x) / 3 - mx, oz = up ? 0 : (a.z + b.z + c.z) / 3 - mz;
      if (nx * ox + ny * (up ? 1 : 0.2) + nz * oz < 0) { const t = b; b = c; c = t; }
      C.setHex(hex);
      for (const p of [a, b, c]) { pos.push(p.x, p.y, p.z); col.push(C.r, C.g, C.b); }
    }
    for (let ri = 0; ri < R.length - 1; ri++) {
      const A = R[ri], B = R[ri + 1], n = A.length, hex = rings[ri].col;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (opt.openFront && A[i].front && A[j].front) continue;
        // shade each quad a touch by a hash: clods, not a plastic sheet
        const sh = 0.92 + h01(A[i].x * 0.37, A[i].z * 0.41, 0xb0f + ri) * 0.14;
        C.setHex(hex); C.multiplyScalar(sh);
        const hx = C.getHex();
        tri(A[i], A[j], B[j], hx); tri(A[i], B[j], B[i], hx);
      }
    }
    if (opt.top != null) {
      const T = R[R.length - 1];
      let sx = 0, sy = 0, sz = 0;
      for (const p of T) { sx += p.x; sy += p.y; sz += p.z; }
      const ctr = { x: sx / T.length, y: sy / T.length, z: sz / T.length };
      for (let i = 0; i < T.length; i++) tri(ctr, T[i], T[(i + 1) % T.length], opt.top, true);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    if (!MOUND_MAT) { MOUND_MAT = new THREE.MeshLambertMaterial({ vertexColors: true }); MOUND_MAT._shared = true; }
    const m = new THREE.Mesh(geo, MOUND_MAT);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // ---- the concrete headwall: a battered wall with the door notched out --
  function headwall(g, cx, faceZ, FY, W, DOOR_W, DOOR_H, hex) {
    const s = new THREE.Shape();
    const E = W / 2 + 0.5, T = W / 2 - 1.6, H = 4.25;
    s.moveTo(-E, 0); s.lineTo(-DOOR_W / 2 - 0.1, 0); s.lineTo(-DOOR_W / 2 - 0.1, DOOR_H + 0.05);
    s.lineTo(DOOR_W / 2 + 0.1, DOOR_H + 0.05); s.lineTo(DOOR_W / 2 + 0.1, 0); s.lineTo(E, 0);
    s.lineTo(E, 0.7); s.lineTo(T, H); s.lineTo(-T, H); s.lineTo(-E, 0.7); s.lineTo(-E, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: false });
    geo.translate(cx, FY, faceZ - 0.6);
    const m = new THREE.Mesh(geo, cm(hex));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  }

  // ---- furniture (kit frame: +X along the piece, +Z its front, y off the floor)
  const P = {
    olive: 0x4b5534, oliveD: 0x3a4229, oliveL: 0x5e6a42, tube: 0x59606a, tubeD: 0x3c4148,
    tick: 0xb8b4a2, blanket: 0x4a5236, pillow: 0xd9d6cc, wood: 0x6a5537, woodD: 0x4e3e28,
    stencil: 0xd8cf9a, yellow: 0xd2a21c, black: 0x1a1b1d, red: 0xa8261f, steel: 0x7c848e,
    steelL: 0xa9b1ba, screen: 0x0f1a14, phos: 0x7fd99a, amber: 0xffb347, alum: 0xb9bec4,
    paint: 0x56604e, cream: 0xc9c4b0, crete: 0x8d9094, creteD: 0x75787c, rope: 0xb59e6a,
  };
  // two-tier tube-steel bunk, head at local -X, ladder at the +X foot, front +Z
  function bunk(k) {
    const L = 2.0, Wd = 0.9, H = 1.78, t = 0.042;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * (L / 2 - t / 2), H / 2, sz * (Wd / 2 - t / 2), t, H, t, P.tube, "metal");
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * (L / 2 - t / 2), 0.012, sz * (Wd / 2 - t / 2), 0.07, 0.024, 0.07, P.tubeD, "metal"); // feet
    for (const lvl of [0.42, 1.42]) {
      for (const sz of [-1, 1]) k.box(0, lvl, sz * (Wd / 2 - t / 2), L, 0.06, t, P.tube, "metal");      // side rails
      for (const sx of [-1, 1]) k.box(sx * (L / 2 - t / 2), lvl, 0, t, 0.06, Wd, P.tube, "metal");      // end rails
      k.box(0, lvl + 0.02, 0, L - 0.08, 0.012, Wd - 0.08, P.tubeD, "metal");                           // wire deck
      for (let i = 0; i < 6; i++) k.box(-L / 2 + 0.2 + i * 0.32, lvl + 0.01, 0, 0.025, 0.02, Wd - 0.06, P.tubeD, "metal");
      const my = lvl + 0.09;
      k.box(0, my, 0, L - 0.1, 0.12, Wd - 0.1, P.tick);                                               // mattress
      k.box(0.2, my + 0.065, 0, L - 0.5, 0.02, Wd - 0.06, P.blanket);                                // blanket over it
      for (const sz of [-1, 1]) k.box(0.2, my - 0.01, sz * (Wd / 2 - 0.03), L - 0.5, 0.15, 0.02, P.blanket); // tucked sides
      k.box(-L / 2 + 0.66, my + 0.078, 0, 0.18, 0.012, Wd - 0.05, P.cream);                          // folded sheet band
      k.box(-L / 2 + 0.32, my + 0.11, 0, 0.36, 0.1, Wd - 0.32, P.pillow);                            // pillow
    }
    for (const sx of [-1, 1]) for (const y of [0.78, 1.66]) k.box(sx * (L / 2 - t / 2), y, 0, t * 0.8, t * 0.8, Wd, P.tube, "metal"); // head/foot bars
    // the ladder hooked over the foot end, front side
    const lx = L / 2 + 0.05;
    for (const sz of [0.08, 0.38]) k.box(lx, 0.95, sz, 0.03, 1.9, 0.03, P.tube, "metal");
    for (let i = 0; i < 5; i++) k.box(lx, 0.3 + i * 0.32, 0.23, 0.025, 0.025, 0.3, P.tube, "metal");
  }
  // GI footlocker: olive plywood, steel corners, rope-free bail handles, hasp
  function footlocker(k) {
    const L = 0.86, H = 0.36, D = 0.42;
    k.box(0, H / 2, 0, L, H, D, P.olive);
    k.box(0, H - 0.06, 0, L + 0.01, 0.006, D + 0.01, P.oliveD);                       // lid line
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.02, H - 0.02])
      k.box(sx * (L / 2 - 0.02), y, sz * (D / 2 - 0.02), 0.05, 0.04, 0.05, P.steel, "metal");
    for (const sx of [-1, 1]) k.box(sx * (L / 2 + 0.01), H * 0.6, 0, 0.012, 0.03, 0.14, P.steel, "metal");
    k.box(0, H - 0.1, D / 2 + 0.008, 0.06, 0.08, 0.012, P.steel, "metal");
    k.box(0, H / 2 - 0.02, D / 2 + 0.004, 0.32, 0.06, 0.004, P.stencil);              // stencilled name plate
  }
  // a wooden ammunition crate: frame battens, lid boards, rope beckets,
  // stencil band. Origin bottom centre, long axis X.
  function ammoCrate(k, x, y, z, L, H, D, ry) {
    const r = ry || 0, c = Math.cos(r), s = Math.sin(r);
    const B = function (lx, ly, lz, w, h, d, col, kind) { k.box(x + lx * c + lz * s, y + ly, z - lx * s + lz * c, w, h, d, col, kind, 0, r, 0); };
    B(0, H / 2, 0, L - 0.04, H - 0.04, D - 0.04, P.oliveL);
    for (const sy of [0.03, H - 0.03]) for (const sz of [-1, 1]) B(0, sy, sz * (D / 2 - 0.03), L, 0.06, 0.06, P.olive);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B(sx * (L / 2 - 0.03), H / 2, sz * (D / 2 - 0.03), 0.06, H, 0.06, P.olive);
    for (const sx of [-1, 1]) for (const sy of [0.03, H - 0.03]) B(sx * (L / 2 - 0.03), sy, 0, 0.06, 0.06, D, P.olive);
    const boards = Math.max(2, Math.round(D / 0.18));
    for (let i = 1; i < boards; i++) B(0, H + 0.001, -D / 2 + (D * i) / boards, L - 0.1, 0.004, 0.008, P.oliveD);
    B(0, H * 0.55, D / 2 + 0.002, L * 0.5, H * 0.16, 0.004, P.stencil);                   // stencil band
    B(0, H * 0.55, D / 2 + 0.004, L * 0.42, 0.012, 0.004, P.oliveD);
    for (const sx of [-1, 1]) {
      B(sx * (L / 2 + 0.01), H * 0.62, -0.08, 0.02, 0.02, 0.02, P.rope);
      B(sx * (L / 2 + 0.035), H * 0.56, 0, 0.025, 0.025, 0.2, P.rope);                    // rope becket
      B(sx * (L / 2 + 0.01), H * 0.62, 0.08, 0.02, 0.02, 0.02, P.rope);
      B(sx * (L / 2 - 0.2), H - 0.08, D / 2 + 0.01, 0.06, 0.1, 0.012, P.steel, "metal");    // latch
    }
  }
  // steel arms rack: a butt trough, a perforated back, a notched barrel rail,
  // a chain bar, a top shelf of ammo cans; the rifles are the game's own.
  function armsRack(k, L, seed) {
    k.box(0, 0.06, 0, L, 0.12, 0.5, P.tubeD, "metal");                                   // plinth
    k.box(0, 0.3, 0.02, L, 0.36, 0.46, P.olive);                                        // butt trough cabinet
    k.box(0, 0.49, 0.04, L - 0.06, 0.02, 0.36, P.oliveD);                               // trough floor
    k.box(0, 1.2, -0.21, L, 1.6, 0.04, P.olive);                                       // back panel
    for (let r = 0; r < 9; r++) for (let i = 0; i < Math.floor(L / 0.16); i++)          // perforations
      if ((r + i) % 2 === 0) k.box(-L / 2 + 0.1 + i * 0.16, 0.7 + r * 0.13, -0.188, 0.03, 0.03, 0.004, P.oliveD);
    for (const sx of [-1, 1]) k.box(sx * (L / 2 - 0.02), 1.0, 0, 0.04, 2.0, 0.5, P.olive);  // end frames
    k.box(0, 1.42, 0.02, L, 0.05, 0.12, P.tube, "metal");                               // barrel rail
    k.box(0, 1.5, 0.12, L - 0.04, 0.025, 0.025, P.steelL, "metal");                     // chain/lock bar
    for (const sx of [-1, 1]) k.box(sx * (L / 2 - 0.05), 1.5, 0.1, 0.05, 0.08, 0.06, P.tubeD, "metal");
    k.box(0, 1.98, 0, L, 0.04, 0.5, P.olive);                                         // top shelf
    const n = Math.max(3, Math.floor((L - 0.3) / 0.36));
    let real = 0;
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + 0.25 + i * ((L - 0.5) / (n - 1));
      k.box(x, 1.42, 0.08, 0.025, 0.06, 0.04, P.tubeD, "metal");                        // notch divider
      if ((i * 7 + seed * 3) % 5 === 1 || (i * 3 + seed) % 7 === 4) continue;   // signed out: an empty slot
      if (rackGun(k, (i + seed) % 3 === 2 ? "ak47" : "carbine", x, 0.5, -0.06, -0.05)) real++;
      else {
        k.box(x, 0.98, 0.0, 0.05, 0.95, 0.07, P.black, "metal");
        k.box(x, 0.62, 0.03, 0.05, 0.22, 0.1, P.woodD);
      }
    }
    for (let i = 0; i < Math.floor(L / 0.36); i++) {                                     // ammo cans on top
      const x = -L / 2 + 0.2 + i * 0.36;
      k.box(x, 2.0 + 0.09, 0, 0.28, 0.18, 0.14, P.olive, "metal");
      k.box(x, 2.0 + 0.19, 0, 0.29, 0.02, 0.15, P.oliveD, "metal");
      k.box(x, 2.0 + 0.215, 0, 0.12, 0.012, 0.02, P.tubeD, "metal");
    }
    return real;
  }
  // a steel desk: top, modesty panel, drawer pedestal; two monitors, a
  // keyboard and a field telephone. Front (+Z) is where the officer sits.
  function deskStation(k, L, screens) {
    const D = 0.8, TOP = 0.74;
    k.box(0, TOP, 0, L, 0.035, D, 0x6d6a5c);                                            // linoleum top
    k.box(0, TOP - 0.03, 0, L + 0.02, 0.03, D + 0.02, P.tubeD, "metal");
    k.box(-L / 2 + 0.02, TOP / 2 - 0.02, 0, 0.04, TOP - 0.04, D - 0.04, P.paint);      // left end panel
    k.box(L / 2 - 0.23, TOP / 2 - 0.02, 0, 0.42, TOP - 0.04, D - 0.04, P.paint);       // drawer pedestal
    for (let i = 0; i < 3; i++) {
      k.box(L / 2 - 0.23, 0.14 + i * 0.22, D / 2 - 0.005, 0.38, 0.19, 0.012, P.oliveL);
      k.box(L / 2 - 0.23, 0.2 + i * 0.22, D / 2 + 0.006, 0.12, 0.015, 0.015, P.steelL, "metal");
    }
    k.box(0, 0.42, -D / 2 + 0.03, L - 0.06, 0.52, 0.02, P.paint);                        // modesty panel
    for (let i = 0; i < screens; i++) {
      const x = (i - (screens - 1) / 2) * 0.62;
      k.box(x, TOP + 0.03, -0.22, 0.2, 0.02, 0.16, P.black, "metal");                  // foot
      k.box(x, TOP + 0.16, -0.25, 0.04, 0.24, 0.03, P.black, "metal");                 // neck
      k.box(x, TOP + 0.34, -0.23, 0.56, 0.34, 0.04, P.black, "gloss", -0.08);          // bezel
      k.box(x, TOP + 0.34, -0.207, 0.51, 0.29, 0.004, P.screen, "glow", -0.08);        // screen
      for (let r = 0; r < 4; r++) k.box(x - 0.08 + (r % 2) * 0.12, TOP + 0.43 - r * 0.055, -0.204, 0.26 - (r % 3) * 0.06, 0.012, 0.003, r === 2 ? P.amber : P.phos, "glow", -0.08);
    }
    k.box(0, TOP + 0.03, 0.12, 0.46, 0.022, 0.16, 0x2a2c30, "gloss", 0.05);            // keyboard
    k.box(0, TOP + 0.043, 0.12, 0.42, 0.004, 0.13, 0x45484d);
    k.box(L / 2 - 0.3, TOP + 0.06, 0.05, 0.22, 0.09, 0.2, P.oliveD);                    // field phone
    k.box(L / 2 - 0.3, TOP + 0.12, 0.05, 0.2, 0.035, 0.05, P.black, "gloss");          // handset
  }
  // swivel chair: five-star base, gas column, seat, back. Faces local +Z.
  function swivelChair(k) {
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      k.box(Math.sin(a) * 0.15, 0.06, Math.cos(a) * 0.15, 0.04, 0.035, 0.3, P.black, "metal", 0, a, 0);
      k.sphere(Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29, 0.03, P.black, "metal");
    }
    k.cyl(0, 0.26, 0, 0.03, 0.03, 0.36, P.steelL, "metal", 0, 0, 0, 10);
    k.box(0, 0.45, 0, 0.48, 0.08, 0.46, 0x2c3a2e);                                     // seat (top 0.49)
    k.box(0, 0.75, -0.24, 0.44, 0.48, 0.06, 0x2c3a2e, "solid", -0.08);                 // back
    k.box(0, 0.55, -0.25, 0.06, 0.2, 0.04, P.black, "metal");                          // back post
    for (const sx of [-1, 1]) k.box(sx * 0.25, 0.62, 0.0, 0.04, 0.03, 0.3, P.black, "metal"); // arms
  }
  // 19-inch equipment rack: cabinet, units with knobs and LEDs, handset
  function radioRack(k, W, H, D) {
    k.box(0, H / 2, 0, W, H, D, 0x2a2e33, "metal");
    k.box(0, H / 2, D / 2 + 0.01, W - 0.12, H - 0.12, 0.02, 0x15171a);
    const units = [0.22, 0.13, 0.31, 0.13, 0.22, 0.18, 0.22];
    let y = H - 0.08;
    units.forEach(function (u, i) {
      y -= u;
      k.box(0, y + u / 2, D / 2 + 0.025, W - 0.16, u - 0.01, 0.02, i % 2 ? 0x3a3f45 : 0x4b5158, "metal");
      for (let j = 0; j < 4; j++) k.cyl(-W / 2 + 0.2 + j * 0.13, y + u / 2, D / 2 + 0.045, 0.022, 0.022, 0.025, 0x111214, "metal", Math.PI / 2, 0, 0, 10);
      k.box(W / 2 - 0.22, y + u / 2, D / 2 + 0.037, 0.18, Math.min(0.07, u * 0.5), 0.004, i === 2 ? P.amber : P.phos, "glow");
      for (let j = 0; j < 3; j++) k.box(-W / 2 + 0.12, y + u * 0.3 + j * 0.03, D / 2 + 0.037, 0.012, 0.012, 0.004, j === 0 ? 0xff4a3a : 0x6aff7a, "glow");
    });
    k.box(W / 2 + 0.04, 1.2, 0.1, 0.06, 0.2, 0.08, P.black, "gloss");                  // handset on its hook
    k.box(0, H + 0.02, 0, W + 0.02, 0.04, D + 0.02, 0x1d2024, "metal");
  }
  // a fluorescent fitting under the ceiling: housing, diffuser, hangers
  function strip(k, x, y, z, L, alongX) {
    const w = alongX ? L : 0.24, d = alongX ? 0.24 : L;
    k.box(x, y, z, w, 0.07, d, 0xc8ccc8, "metal");
    k.box(x, y - 0.04, z, alongX ? L - 0.06 : 0.16, 0.012, alongX ? 0.16 : L - 0.06, 0xeef6ec, "glow");
    for (const s of [-1, 1]) k.box(x + (alongX ? s * L * 0.35 : 0), y + 0.08, z + (alongX ? 0 : s * L * 0.35), 0.015, 0.1, 0.015, P.tubeD, "metal");
  }
  // 200 l steel drum: ribs, chime rims, bung
  function drum(k, x, y, z, col) {
    k.cyl(x, y + 0.44, z, 0.29, 0.29, 0.86, col, "metal", 0, 0, 0, 16);
    for (const ry of [0.02, 0.29, 0.59, 0.86]) k.torus(x, y + ry, z, 0.292, 0.012, col, "metal", Math.PI / 2, 0, 0, null, 18);
    k.cyl(x + 0.14, y + 0.875, z, 0.03, 0.03, 0.02, P.steelL, "metal", 0, 0, 0, 8);
    k.box(x, y + 0.45, z + 0.29, 0.22, 0.14, 0.005, P.stencil, "solid", 0, 0, 0);
  }
  // folding cot: X-legs, side poles, canvas
  function cot(k) {
    const L = 1.9, Wd = 0.72, Hc = 0.42;
    for (const sz of [-1, 1]) k.box(0, Hc, sz * Wd / 2, L, 0.035, 0.035, 0x6b6248);
    k.box(0, Hc - 0.01, 0, L - 0.08, 0.02, Wd, P.canvasCot || 0x6c7356);
    for (const sx of [-0.7, 0, 0.7]) for (const sz of [-1, 1]) {
      k.box(sx, Hc / 2, sz * (Wd / 2 - 0.02), 0.025, Hc * 1.25, 0.025, P.tubeD, "metal", 0, 0, 0.55);
      k.box(sx, Hc / 2, sz * (Wd / 2 - 0.02), 0.025, Hc * 1.25, 0.025, P.tubeD, "metal", 0, 0, -0.55);
    }
    k.box(-L / 2 + 0.3, Hc + 0.06, 0, 0.3, 0.08, Wd - 0.2, 0x8a8a74);                   // rolled blanket
  }
  // steel shelving: four uprights, five shelves, and what a shelter stocks
  function shelving(k, L, D, H, seed) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sx * (L / 2 - 0.02), H / 2, sz * (D / 2 - 0.02), 0.035, H, 0.035, P.tube, "metal");
    const rr = (CBZ.storeFixtureKit && CBZ.storeFixtureKit.rng) ? CBZ.storeFixtureKit.rng(seed) : function () { return 0.5; };
    for (let s = 0; s < 5; s++) {
      const y = 0.1 + s * (H - 0.15) / 4;
      k.box(0, y, 0, L, 0.025, D, P.tube, "metal");
      k.box(0, y - 0.03, D / 2, L, 0.04, 0.012, P.tubeD, "metal");
      if (s === 4) continue;
      let x = -L / 2 + 0.08;
      while (x < L / 2 - 0.25) {
        const kind = rr();
        if (kind < 0.4) {                                                                 // ration carton
          const w = 0.32 + rr() * 0.1, h = 0.22 + rr() * 0.1;
          k.box(x + w / 2, y + 0.012 + h / 2, 0, w, h, D * 0.8, 0x9a8a62);
          k.box(x + w / 2, y + 0.012 + h * 0.6, D * 0.4 + 0.002, w * 0.7, 0.04, 0.003, 0x3a3428);
          x += w + 0.03;
        } else if (kind < 0.65) {                                                         // water cans
          for (let j = 0; j < 2; j++) k.box(x + 0.09 + j * 0.17, y + 0.2, 0, 0.15, 0.38, 0.32, 0x3e5a6a);
          x += 0.38;
        } else if (kind < 0.85) {                                                         // jerrycan
          k.box(x + 0.09, y + 0.24, 0, 0.16, 0.46, 0.34, P.olive, "metal");
          k.box(x + 0.09, y + 0.49, 0.05, 0.03, 0.04, 0.12, P.olive, "metal");
          x += 0.22;
        } else x += 0.25;                                                                 // a gap
      }
    }
  }
  // diesel genset on a skid: engine, alternator, radiator grille, exhaust
  function genset(k, L, Wd, H) {
    k.box(0, 0.06, 0, L, 0.12, Wd, P.tubeD, "metal");                                    // skid
    k.box(-L * 0.15, 0.12 + H * 0.4, 0, L * 0.55, H * 0.8, Wd * 0.7, 0x5c6a3e, "metal"); // engine block
    k.box(L * 0.28, 0.12 + H * 0.32, 0, L * 0.3, H * 0.64, Wd * 0.62, 0x4c5a34, "metal"); // alternator
    k.cyl(L * 0.28, 0.12 + H * 0.32, 0, H * 0.3, H * 0.3, L * 0.3, 0x4c5a34, "metal", 0, 0, Math.PI / 2, 14);
    k.box(-L / 2 + 0.06, 0.12 + H * 0.45, 0, 0.1, H * 0.9, Wd * 0.85, 0x2f3438, "metal"); // radiator
    for (let i = 0; i < 8; i++) k.box(-L / 2, 0.2 + i * H * 0.1, 0, 0.02, 0.025, Wd * 0.78, 0x1a1c1f, "metal");
    k.cyl(-L * 0.1, H + 0.35, Wd * 0.2, 0.05, 0.05, 0.9, 0x3a2f28, "metal", 0, 0, 0, 10);  // exhaust stack
    k.cyl(-L * 0.1, H + 0.82, Wd * 0.2, 0.07, 0.05, 0.08, 0x2a2420, "metal", 0, 0, 0, 10);
    k.box(L * 0.1, 0.12 + H * 0.82, Wd * 0.36, 0.3, 0.22, 0.02, 0x22262a, "metal");       // control panel
    k.box(L * 0.1, 0.12 + H * 0.84, Wd * 0.37, 0.12, 0.06, 0.004, P.amber, "glow");
    k.box(L * 0.1, 0.06, 0, 0.18, 0.06, Wd + 0.08, 0x22262a, "metal");                    // lifting bar
  }

  function buildBunker(city, root, site) {
    const W = site.w, D = site.d, FY = site.floorY;
    const cx = site.cx, cz = site.cz;
    const IW = W - 5, ID = D - 5;                 // interior envelope
    const ix0 = cx - IW / 2, ix1 = cx + IW / 2;
    const iz0 = cz - ID / 2, iz1 = cz + ID / 2;
    const CEIL = FY + 3.1;                        // clear interior height
    const crete = site.crete || M.concrete;
    const theme = site.theme || "temperate";
    const SKIN = theme === "snow" ? { toe: 0x8e9398, side: 0xd9dee2, top: 0xe8ecef }
      : theme === "desert" ? { toe: 0x8a7a5a, side: 0xa48d64, top: 0xb39c70 }
      : { toe: 0x5f615c, side: 0x55523e, top: 0x4c5732 };

    const g = new THREE.Group();
    g.name = "bunker-" + site.id;
    root.add(g);
    const k = makeKit();                          // the interior's merged fixtures

    // ---- THE BERM. On sloped biome ground a FOUNDATION sinks from the slab
    // grade down past the lowest sampled corner (the floating-geometry law).
    if (site.found && site.found > 0.3) {
      box(g, cx, FY - site.found / 2 - 0.1, cz, W + 1.0, site.found, D + 1.0, M.earthD, { cast: false });
    }
    const faceZ = cz + D / 2;
    const BT = 4.0;                               // the berm body's top (the crater sits here after a breach)
    const fz = faceZ - 0.3;                       // the mound's front plane, hidden in the headwall
    // the body: a rock toe, then earth shoulders, open at the front (the
    // headwall closes it), closed on top. Clears the shell everywhere:
    // the 3.5 m ceiling slab's edge (W/2-1.3 out) is under 3.7 m of slope.
    const body = moundMesh([
      { y: FY - 0.15, x0: cx - W / 2 - 0.4, x1: cx + W / 2 + 0.4, z0: cz - D / 2 - 0.4, z1: fz, c: 1.6, col: SKIN.toe },
      { y: FY + 0.85, x0: cx - W / 2 - 0.05, x1: cx + W / 2 + 0.05, z0: cz - D / 2 - 0.05, z1: fz, c: 1.5, col: SKIN.side, jit: 0.25 },
      { y: FY + 2.3, x0: cx - W / 2 + 0.3, x1: cx + W / 2 - 0.3, z0: cz - D / 2 + 0.3, z1: fz, c: 1.8, col: SKIN.side, jit: 0.3 },
      { y: FY + BT, x0: cx - W / 2 + 1.5, x1: cx + W / 2 - 1.5, z0: cz - D / 2 + 1.5, z1: fz, c: 2.2, col: SKIN.top },
    ], { openFront: true, top: SKIN.top });
    g.add(body);
    // the CAP: what caves in when a bunker buster gets through
    // (strategicBunkerBreach hides topMeshes)
    const moundTop = FY + 5.6;
    const cap = moundMesh([
      { y: FY + BT - 0.02, x0: cx - W / 2 + 1.5, x1: cx + W / 2 - 1.5, z0: cz - D / 2 + 1.5, z1: fz, c: 2.2, col: SKIN.top },
      { y: FY + 5.0, x0: cx - W / 2 + 4, x1: cx + W / 2 - 4, z0: cz - D / 2 + 4, z1: faceZ - 2.6, c: 2.4, col: SKIN.top, jit: 0.35 },
      { y: FY + 5.5, x0: cx - W / 2 + 6.5, x1: cx + W / 2 - 6.5, z0: cz - D / 2 + 6.5, z1: faceZ - 5, c: 1.6, col: SKIN.top },
    ], { top: SKIN.top });
    g.add(cap);
    // the crown: a concrete pad flush in the top, mushroom vents, a hatch
    const crown = new THREE.Group();
    g.add(crown);
    const padW = Math.min(6.5, Math.max(3, W - 14)), padD = Math.min(4.5, Math.max(2.5, D - 14)), padZ = (cz - D / 2 + 6.5 + faceZ - 5) / 2;
    box(crown, cx, FY + 5.48, padZ, padW, 0.24, padD, crete, { cast: false });
    box(crown, cx - padW * 0.25, FY + 5.66, padZ, 1.1, 0.12, 1.1, M.steelD);          // escape hatch
    box(crown, cx - padW * 0.25 + 0.5, FY + 5.74, padZ, 0.06, 0.06, 0.5, M.steel);
    const ventM = cm(M.steelD), ventG = new THREE.CylinderGeometry(0.16, 0.16, 1.3, 10), capG = new THREE.CylinderGeometry(0.42, 0.3, 0.32, 10);
    for (const v of [[-W * 0.22, -2], [W * 0.2, -3]]) {
      const vx = cx + v[0], vz = cz + v[1];
      const pipe = new THREE.Mesh(ventG, ventM); pipe.position.set(vx, FY + 5.6, vz); pipe.castShadow = true; crown.add(pipe);
      const hood = new THREE.Mesh(capG, ventM); hood.position.set(vx, FY + 6.36, vz); hood.castShadow = true; crown.add(hood);
      box(crown, vx, FY + 5.0, vz, 0.9, 0.5, 0.9, crete);                                 // plinth bedded in the earth
    }
    if (site.tier === "command") {
      const mx = cx + W * 0.3, mz = cz + 1;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 6, 6), cm(M.steelD));
      mast.position.set(mx, FY + 7.4, mz); mast.castShadow = true; crown.add(mast);
      box(crown, mx, FY + 4.5, mz, 1.0, 0.6, 1.0, crete);
      for (let i = 0; i < 3; i++) box(crown, mx, FY + 8.6 + i * 0.5, mz, 0.05, 0.05, 1.4 - i * 0.3, M.steel); // yagi elements
      box(crown, mx, FY + 9.1, mz, 0.04, 0.04, 0.04, 0xff3a2a, { cast: false });
    }
    const topMeshes = [cap, crown];

    // ---- ENTRANCE FACE: a battered concrete headwall across the front, and
    // the portal standing proud of it with the recessed blast door.
    const DOOR_W = 3.0, DOOR_H = 2.7;
    headwall(g, cx, faceZ, FY, W, DOOR_W, DOOR_H, crete);
    box(g, cx, FY + 4.31, faceZ - 0.3, W - 3.0, 0.12, 0.72, M.concreteD);              // coping
    // board-form lift lines on the headwall (paint-thin reveals)
    for (const yy of [1.2, 2.4, 3.4]) {
      const half = Math.min(W / 2 + 0.3, W / 2 + 0.5 - (yy - 0.7) * (2.1 / 3.55));
      for (const s of [-1, 1]) {
        const x0 = DOOR_W / 2 + 2.3, x1 = half - 0.2;
        if (x1 > x0) box(g, cx + s * (x0 + x1) / 2, FY + yy, faceZ + 0.005, x1 - x0, 0.03, 0.02, M.concreteD, { cast: false });
      }
    }
    // portal = two cheek slabs + a lintel — the OPENING is real (a single
    // full-width slab here would visually wall off the doorway the colliders
    // leave passable). The door leaves park in the opening and slide INTO
    // the cheeks, elevator-pocket style.
    for (const s of [-1, 1]) box(g, cx + s * (DOOR_W / 2 + 1.1), FY + 1.9, faceZ + 0.35, 2.2, 3.8, 0.9, crete);
    box(g, cx, FY + DOOR_H + (3.8 - DOOR_H) / 2, faceZ + 0.35, DOOR_W + 4.4, 3.8 - DOOR_H, 0.9, crete); // lintel
    box(g, cx, FY + 3.95, faceZ + 0.5, DOOR_W + 5.4, 0.3, 1.4, M.concreteD);           // brow slab
    for (const s of [-1, 1]) box(g, cx + s * (DOOR_W / 2 + 2.45), FY + 1.9, faceZ + 0.82, 0.25, 3.8, 0.06, M.concreteD); // cheek arrises
    // painted hazard bands either side of the opening (black/yellow, paint)
    for (const s of [-1, 1]) {
      const hx = cx + s * (DOOR_W / 2 + 0.3);
      box(g, hx, FY + 1.35, faceZ + 0.81, 0.4, 2.7, 0.02, M.warn, { cast: false });
      for (let i = 0; i < 7; i++) {
        const st = box(g, hx, FY + 0.2 + i * 0.38, faceZ + 0.825, 0.5, 0.12, 0.012, 0x1a1b1d, { cast: false });
        st.rotation.z = s * 0.6;
        st.scale.x = 0.8;
      }
    }
    // the door lamp: a caged bulkhead fitting under the brow
    box(g, cx, FY + 3.68, faceZ + 0.86, 0.5, 0.22, 0.16, M.steelD);
    glow(g, cx, FY + 3.6, faceZ + 0.95, 0.38, 0.12, 0.04, 0xffe9b0, 0.8);
    for (let i = -1; i <= 1; i++) box(g, cx + i * 0.12, FY + 3.6, faceZ + 0.98, 0.015, 0.16, 0.015, M.steelD, { cast: false });
    // a stencilled site plate beside the door + a pair of steel bollards
    box(g, cx + DOOR_W / 2 + 1.2, FY + 2.0, faceZ + 0.815, 1.1, 0.5, 0.02, 0xdcd6c0, { cast: false });
    box(g, cx + DOOR_W / 2 + 1.2, FY + 2.08, faceZ + 0.83, 0.9, 0.08, 0.01, 0x2a2c2e, { cast: false });
    box(g, cx + DOOR_W / 2 + 1.2, FY + 1.92, faceZ + 0.83, 0.7, 0.05, 0.01, 0x2a2c2e, { cast: false });
    // portal cheeks are solid: the ONLY hole in the face is the door span
    col(cx - (DOOR_W + 4.4) / 2, cx - DOOR_W / 2, faceZ - 0.2, faceZ + 0.9, FY, FY + 3.8);
    col(cx + DOOR_W / 2, cx + (DOOR_W + 4.4) / 2, faceZ - 0.2, faceZ + 0.9, FY, FY + 3.8);
    col(cx - (DOOR_W + 4.4) / 2, cx + (DOOR_W + 4.4) / 2, faceZ - 0.2, faceZ + 0.9, FY + DOOR_H, FY + 3.8); // over-door lintel

    // ---- THE BLAST DOOR (elevator-grammar leaves, slides into the cheeks)
    const door = makeDoor(g, cx, faceZ + 0.35, "x", DOOR_W, DOOR_H, M.steel, 0.5);
    door.y0 = FY; door.y1 = FY + DOOR_H;
    door.colRec.y0 = FY; door.colRec.y1 = FY + DOOR_H;
    doorTokens.push({ x: cx, z: faceZ + 1.2, door, name: site.name });

    // ---- INTERIOR SHELL: floor slab, four walls, ceiling. The mound faces
    // all point out or up, so the shell is what you SEE from inside.
    const WT = 1.2;
    box(g, cx, FY - 0.04, cz, IW + 1.4, 0.12, ID + 1.4, M.floor, { cast: false }); // floor skin (top 2 cm proud: feet on it, not in it)
    const walls = [];
    walls.push(box(g, cx, FY + 1.55, iz0 - WT / 2, IW + WT * 2, 3.1, WT, P.cream)); // -Z (back)
    walls.push(box(g, ix0 - WT / 2, FY + 1.55, cz, WT, 3.1, ID + WT * 2, P.cream)); // -X
    walls.push(box(g, ix1 + WT / 2, FY + 1.55, cz, WT, 3.1, ID + WT * 2, P.cream)); // +X
    // +Z wall is split by the door corridor
    walls.push(box(g, (ix0 + cx - DOOR_W / 2) / 2, FY + 1.55, iz1 + WT / 2, (cx - DOOR_W / 2) - ix0, 3.1, WT, P.cream));
    walls.push(box(g, (cx + DOOR_W / 2 + ix1) / 2, FY + 1.55, iz1 + WT / 2, ix1 - (cx + DOOR_W / 2), 3.1, WT, P.cream));
    box(g, cx, CEIL + 0.2, cz, IW + WT * 2, 0.4, ID + WT * 2, 0x9c9d96, { cast: false }); // ceiling slab (whitewashed)
    // door corridor: short lit throat from the face to the hall
    const corrZ0 = iz1, corrZ1 = faceZ;
    box(g, cx - DOOR_W / 2 - 0.3, FY + 1.55, (corrZ0 + corrZ1) / 2, 0.6, 3.1, corrZ1 - corrZ0 + WT, M.wall);
    box(g, cx + DOOR_W / 2 + 0.3, FY + 1.55, (corrZ0 + corrZ1) / 2, 0.6, 3.1, corrZ1 - corrZ0 + WT, M.wall);
    box(g, cx, CEIL + 0.1, (corrZ0 + corrZ1) / 2, DOOR_W + 1.4, 0.3, corrZ1 - corrZ0 + WT, M.ceil, { cast: false });
    k.frame(0, 0, 0, 0);
    strip(k, cx, CEIL - 0.06, (corrZ0 + corrZ1) / 2, 1.4, false);
    // painted dado down the corridor too
    for (const s of [-1, 1]) k.box(cx + s * (DOOR_W / 2 - 0.011), FY + 0.6, (corrZ0 + corrZ1) / 2, 0.02, 1.2, corrZ1 - corrZ0 + WT - 0.1, P.paint);

    // ---- SHELL DRESSING: dado paint + a stripe, ceiling beams, a vent duct on
    // hangers down the -X side, a cable tray down the +X side, strip lights.
    const dado = function (x, z, w, d) {
      k.box(x, FY + 0.6, z, w, 1.2, d, P.paint);
      k.box(x, FY + 1.23, z, w + 0.002, 0.07, d + 0.002, theme === "desert" ? 0xa8742c : 0x6e7a3e);
      k.box(x, FY + 0.06, z, w + 0.004, 0.12, d + 0.004, 0x2e322c);                    // cove skirting
    };
    dado(cx, iz0 + 0.012, IW, 0.024);
    dado(ix0 + 0.012, cz, 0.024, ID);
    dado(ix1 - 0.012, cz, 0.024, ID);
    dado((ix0 + cx - DOOR_W / 2) / 2, iz1 - 0.012, (cx - DOOR_W / 2) - ix0, 0.024);
    dado((cx + DOOR_W / 2 + ix1) / 2, iz1 - 0.012, ix1 - (cx + DOOR_W / 2), 0.024);
    // the floor: a sealed concrete skin with a painted walkway down the
    // spine and saw-cut joints across it
    k.box(cx, FY + 0.025, cz, IW - 0.1, 0.01, ID - 0.1, 0x6a6d68);
    for (const s of [-1, 1]) k.box(cx + s * 1.6, FY + 0.032, cz, 0.08, 0.006, ID - 0.6, theme === "desert" ? 0xc9a03a : 0xc9b23a);
    for (let z = iz0 + 3; z < iz1; z += 3) k.box(cx, FY + 0.031, z, IW - 0.2, 0.004, 0.012, 0x4e514d);
    for (let z = iz0 + 2; z < iz1 - 0.5; z += 4) {
      k.box(cx, CEIL - 0.14, z, IW, 0.28, 0.36, P.crete);                                  // beam
      for (const s of [-1, 1]) k.box(cx + s * (IW / 2 - 0.15), CEIL - 0.42, z, 0.3, 0.3, 0.36, P.creteD); // haunches
    }
    const ductX = ix0 + 0.55, ductY = CEIL - 0.5;
    k.cyl(ductX, ductY, cz, 0.19, 0.19, ID - 0.6, 0x9aa0a4, "metal", Math.PI / 2, 0, 0, 12);
    for (let z = iz0 + 0.8; z < iz1 - 0.3; z += 2) {
      k.torus(ductX, ductY, z, 0.2, 0.012, 0x6a7076, "metal", 0, 0, 0, null, 14);           // seam band
      k.box(ductX, (ductY + CEIL) / 2, z, 0.02, CEIL - ductY, 0.02, P.tubeD, "metal");     // hanger
    }
    for (let z = iz0 + 3; z < iz1 - 1; z += 5) k.box(ductX + 0.2, ductY - 0.05, z, 0.04, 0.16, 0.3, 0x55595e, "metal"); // grilles
    const trayX = ix1 - 0.3, trayY = CEIL - 0.72;
    k.box(trayX, trayY, cz, 0.36, 0.02, ID - 0.4, P.tube, "metal");
    for (const s of [-1, 1]) k.box(trayX + s * 0.18, trayY + 0.04, cz, 0.012, 0.08, ID - 0.4, P.tube, "metal");
    for (let i = 0; i < 5; i++) k.cyl(trayX - 0.12 + i * 0.06, trayY + 0.03, cz, 0.02, 0.02, ID - 0.5, i % 2 ? 0x1c1d20 : 0x3a3a2a, "solid", Math.PI / 2, 0, 0, 6);
    for (let z = iz0 + 0.6; z < iz1; z += 2.2) k.box(trayX + 0.12, (trayY + CEIL) / 2, z, 0.04, CEIL - trayY, 0.04, P.tubeD, "metal");
    for (let z = iz0 + 4; z < iz1 - 0.8; z += 4) strip(k, cx, CEIL - 0.07, z, 1.6, false);
    // a fire extinguisher by the door and an emergency light over it
    k.cyl(cx + DOOR_W / 2 + 0.8, FY + 0.55, iz1 - 0.12, 0.08, 0.08, 0.5, P.red, "gloss", 0, 0, 0, 10);
    k.box(cx + DOOR_W / 2 + 0.8, FY + 0.86, iz1 - 0.12, 0.05, 0.1, 0.05, P.black, "metal");
    k.box(cx, FY + 2.75, iz1 - 0.05, 0.4, 0.14, 0.08, 0xd8dcd8, "metal");
    k.box(cx, FY + 2.75, iz1 - 0.095, 0.32, 0.08, 0.004, 0x55ff88, "glow");

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

    // ---- FURNISH by tier ---------------------------------------------------
    const rec = {
      id: site.id, name: site.name, tier: site.tier, root: g, doors: [door],
      breached: false, cracked: false, moundTop, baseTop: BT,
      // hardness, in metres of concrete-equivalent — what a bunker-buster's
      // penetration is tested against (see CBZ.strategicBunkerBreach)
      roofCE: site.roofCE != null ? +site.roofCE : (ROOF_CE[site.tier] || ROOF_CE.outpost),
      wornCE: 0,                 // metres already dug out of the roof by earlier hits
      owner: site.owner || null, // city/warroom.js: whose bunker (a nation id, or "cell")
      topMeshes: topMeshes, site: site,
      shell: { minX: cx - W / 2, maxX: cx + W / 2, minZ: cz - D / 2, maxZ: cz + D / 2 },
      interior: { minX: ix0, maxX: ix1, minZ: iz0, maxZ: iz1, floorY: FY, ceilY: CEIL, cx, cz },
      troopSpecs: [],
    };
    door.bunker = rec;
    if (site.tier === "command") furnishCommand(g, k, rec, ix0, ix1, iz0, iz1, cx, cz, FY, CEIL);
    else furnishOutpost(g, k, rec, ix0, ix1, iz0, iz1, cx, cz, FY, site);
    const fix = new THREE.Group();
    fix.name = "bunker-fixtures";
    k.build(fix);
    g.add(fix);
    bunkers.push(rec);
    return rec;
  }

  // ---- COMMAND TIER (Fort Brandt): bunks / armory / command room / vault ---
  function furnishCommand(g, k, rec, ix0, ix1, iz0, iz1, cx, cz, FY, CEIL) {
    // BUNK ROWS along the -X wall: five identical double-deck frames — the
    // owner's monotony doctrine; soldiers sleep in a row, not a decorated set.
    for (let i = 0; i < 5; i++) {
      const bz = iz1 - 3.5 - i * 3.1, bx = ix0 + 1.5;
      k.frame(bx - 0.45, FY, bz, 0); bunk(k);
      k.frame(bx, FY, bz + 0.85, 0); footlocker(k);
      col(ix0, ix0 + 2.7, bz - 0.6, bz + 1.2, FY, FY + 1.8);
    }
    // ARMORY along the +X wall: three racks of real rifles, crates, the buster crate
    for (let i = 0; i < 3; i++) {
      const rz = iz1 - 4 - i * 4.2, rx = ix1 - 1.2;
      k.frame(rx + 0.55, FY, rz, -Math.PI / 2); armsRack(k, 2.6, i);
      col(ix1 - 1.9, ix1, rz - 1.4, rz + 1.4, FY, FY + 2.0);
    }
    // the ammo crate stack: two on the floor and one on top, solid as drawn
    k.frame(0, FY, 0, 0);
    for (let i = 0; i < 3; i++) {
      const x = ix1 - 1.4, z = iz0 + 6.5 + (i % 2) * 1.4, y0 = i > 1 ? 0.8 : 0;
      ammoCrate(k, x, y0, z, 1.2, 0.8, 1.2, i === 2 ? 0.08 : 0);
      col(x - 0.6, x + 0.6, z - 0.6, z + 0.6, FY + y0, FY + y0 + 0.8);
    }
    // THE ORDNANCE CRATE — long, banded, on skids (the buster stock)
    const ocX = ix1 - 1.6, ocZ = iz0 + 3.4;
    k.frame(ocX, FY, ocZ, Math.PI / 2);
    for (const s of [-0.5, 0.5]) k.box(0, 0.05, s, 3.4, 0.1, 0.12, P.woodD);            // skids
    ammoCrate(k, 0, 0.1, 0, 3.4, 0.8, 1.4, 0);
    for (const s of [-1.2, 0, 1.2]) k.box(s, 0.5, 0, 0.12, 0.82, 1.43, P.yellow);       // yellow bands
    for (const s of [-0.85, 0.85]) k.box(s, 0.905, 0, 0.18, 0.012, 1.42, P.red);      // explosive marking
    col(ocX - 0.8, ocX + 0.8, ocZ - 1.8, ocZ + 1.8, FY, FY + 0.95);
    crateTokens.push({ x: ocX, z: ocZ, kind: "armory", nextRestock: 0 });

    // COMMAND ROOM across the far (-Z) end: partition wall + doorway gap
    const pZ = iz0 + 7.5;
    box(g, (ix0 + cx - 1.4) / 2, FY + 1.55, pZ, (cx - 1.4) - ix0, 3.1, 0.5, P.cream);
    box(g, (cx + 1.4 + ix1) / 2, FY + 1.55, pZ, ix1 - (cx + 1.4), 3.1, 0.5, P.cream);
    col(ix0, cx - 1.4, pZ - 0.25, pZ + 0.25, FY, FY + 3.1);
    col(cx + 1.4, ix1, pZ - 0.25, pZ + 0.25, FY, FY + 3.1);
    k.frame(0, FY, 0, 0);
    for (const s of [-1, 1]) {                                                           // dado + door casing both faces
      k.box((s < 0 ? (ix0 + cx - 1.4) : (cx + 1.4 + ix1)) / 2, 0.6, pZ, s < 0 ? (cx - 1.4 - ix0) : (ix1 - cx - 1.4), 1.2, 0.52, P.paint);
      k.box(cx + s * 1.45, 1.25, pZ, 0.1, 2.5, 0.6, P.tubeD, "metal");
    }
    k.box(cx, 2.55, pZ, 3.0, 0.1, 0.6, P.tubeD, "metal");
    k.box(cx, 2.78, pZ + 0.27, 1.4, 0.26, 0.02, P.cream);
    k.box(cx, 2.78, pZ + 0.282, 1.2, 0.08, 0.004, 0x2a2c2e);
    // THE MAP TABLE: a back-lit light table on a drawer base
    const mtX = cx + 2.5, mtZ = iz0 + 4.2;
    k.frame(mtX, FY, mtZ, 0);
    k.box(0, 0.4, 0, 2.2, 0.8, 1.3, P.paint);
    for (const sz of [-1, 1]) for (let i = 0; i < 3; i++) {
      k.box(-0.7 + i * 0.7, 0.55, sz * 0.655, 0.62, 0.24, 0.01, P.oliveL);
      k.box(-0.7 + i * 0.7, 0.6, sz * 0.663, 0.14, 0.015, 0.012, P.steelL, "metal");
    }
    k.box(0, 0.86, 0, 2.6, 0.06, 1.7, P.alum, "metal");                                 // aluminium frame
    k.box(0, 0.895, 0, 2.48, 0.01, 1.58, 0x1e3a2c, "glow");                               // lit map sheet
    for (let i = 0; i < 9; i++) k.box(-1.1 + i * 0.275, 0.9, 0, 0.006, 0.004, 1.5, 0x3d6e52, "glow");   // grid
    for (let i = 0; i < 6; i++) k.box(0, 0.9, -0.7 + i * 0.28, 2.4, 0.004, 0.006, 0x3d6e52, "glow");
    for (let i = 0; i < 4; i++) k.box(-0.9 + i * 0.5, 0.902, -0.4 + (i % 2) * 0.5, 0.36 + i * 0.05, 0.004, 0.02, 0x8fd0a0, "glow", 0, 0.4 * i, 0); // coast/contours
    const mk = [[-0.6, 0.2, 0x2a5ad8], [-0.3, -0.35, 0x2a5ad8], [0.5, 0.1, P.red], [0.8, -0.3, P.red], [0.1, 0.45, 0x2a5ad8]];
    for (const m of mk) { k.box(m[0], 0.925, m[1], 0.07, 0.05, 0.05, m[2]); k.box(m[0], 0.957, m[1], 0.012, 0.03, 0.012, P.black); }
    k.box(0.9, 0.91, 0.55, 0.3, 0.02, 0.22, P.cream);                                   // a clipboard
    col(cx + 1.2, cx + 3.8, iz0 + 3.3, iz0 + 5.1, FY, FY + 0.95);
    // THE MAP TABLE IS THE STRIKE CONSOLE. It is the one place in the world
    // that can reach the B-2 without you being in its seat, which is what
    // makes CBZ.strategicBombRun's documented "start one headlessly" seam a
    // thing the PLAYER can touch and not just an API. No new machinery: the
    // verb is one interaction option, the aimpoint is fullmap.js's existing
    // waypoint, and the sortie itself is strategic.js's called run.
    strikeTokens.push({ x: cx + 2.5, z: iz0 + 5.4, site: rec.name });

    /* THE NUCLEAR RELEASE CONSOLE — its own machine, on the other side of the
       room, because it is its own decision. city/interactions.js renders ONE
       verb per card, so a second option on the strike zone would have hidden
       the iron one; and a release console SHOULD be a distinct, locked,
       unmistakable object. Armoured pedestal, canted panel, twin key switches
       a man's arm-span apart, a red release button under a hinged guard. */
    const nzX = cx - 2.6, nzZ = iz0 + 4.2;
    k.frame(nzX, FY, nzZ, 0);
    k.box(0, 0.06, 0, 1.6, 0.12, 1.2, P.black, "metal");                               // plinth
    k.box(0, 0.52, -0.05, 1.5, 0.82, 1.0, 0x3b4249, "metal");                           // pedestal
    for (const sx of [-1, 1]) for (const y of [0.2, 0.84]) k.cyl(sx * 0.76, y, 0.3, 0.02, 0.02, 0.01, P.steelL, "metal", 0, 0, Math.PI / 2, 6);
    k.box(0, 1.0, 0.08, 1.46, 0.08, 0.96, 0x2a3036, "metal", -0.28);                    // canted panel
    k.box(0, 1.045, 0.1, 1.3, 0.004, 0.8, 0x1d2a24, "solid", -0.28);
    for (const s of [-0.42, 0.42]) {                                                    // the two key switches
      k.cyl(s, 1.07, 0.02, 0.06, 0.06, 0.03, P.steelL, "metal", -0.28, 0, 0, 14);
      k.box(s, 1.1, 0.012, 0.012, 0.05, 0.035, 0xc9a24a, "metal", -0.28);
      k.box(s, 1.06, 0.16, 0.12, 0.004, 0.04, P.amber, "glow", -0.28);
    }
    k.cyl(0, 1.08, 0.2, 0.07, 0.07, 0.04, P.red, "gloss", -0.28, 0, 0, 16);              // release button
    k.box(0, 1.14, 0.18, 0.2, 0.08, 0.2, 0xffd0c8, "glass", -0.28);                      // its guard
    k.box(0, 1.06, 0.36, 0.9, 0.03, 0.12, 0x5a1f1f, "glow", -0.28);                      // release light bar
    for (let i = 0; i < 6; i++) k.box(-0.5 + i * 0.2, 1.05, -0.2, 0.05, 0.02, 0.05, i < 2 ? 0x6aff7a : 0x3a1a1a, "glow", -0.28);
    k.box(0, 1.5, -0.58, 0.12, 1.0, 0.12, P.black, "metal");                            // repeater stalk
    k.box(0, 1.92, -0.5, 0.56, 0.5, 0.08, P.black, "metal");
    k.box(0, 1.92, -0.455, 0.48, 0.42, 0.004, 0x1d3a22, "glow");
    k.box(0, 2.02, -0.452, 0.36, 0.05, 0.003, 0x9fd08a, "glow");
    k.box(0, 1.86, -0.452, 0.4, 0.04, 0.003, 0x9fd08a, "glow");
    col(nzX - 0.85, nzX + 0.85, nzZ - 0.7, nzZ + 0.7, FY, FY + 1.1);
    nukeTokens.push({ x: nzX, z: nzZ + 1.0, site: rec.name });

    const deskZ = iz0 + 1.9;
    for (const dxo of [-4.5, -1.5]) {
      const dx = cx + dxo;
      k.frame(dx, FY, deskZ, 0); deskStation(k, 1.8, 2);
      k.frame(dx, FY, deskZ + 0.85, Math.PI); swivelChair(k);
      col(dx - 0.95, dx + 0.95, deskZ - 0.5, deskZ + 0.4, FY, FY + 0.85);
      // an officer takes the seat (peds.js sit grammar — pins pos.y=0, which
      // is exactly this floor). Face -Z: toward the desk + status wall.
      rec.troopSpecs.push({ x: dx, z: deskZ + 0.85, sit: { x: dx, z: deskZ + 0.85, face: Math.PI } });
    }
    // status boards across the back wall — the room WATCHES something.
    // (start EAST of the vault chamber, which owns the wall's west 6m)
    k.frame(0, FY, 0, 0);
    for (let i = 0; i < 4; i++) {
      const bx = ix0 + 8 + i * 3.2, bz = iz0 + 0.06, alert = i === 2;
      k.box(bx, 1.9, bz + 0.05, 2.7, 1.3, 0.1, P.black, "metal");                       // bezel
      k.box(bx, 1.9, bz + 0.102, 2.56, 1.16, 0.004, alert ? 0x2a0e0e : 0x0d1d18, "glow");
      for (let r = 0; r < 7; r++) {
        const w = 0.6 + h01(i, r, 0xb5d) * 1.5;
        k.box(bx - 1.15 + w / 2, 2.36 - r * 0.15, bz + 0.105, w, 0.04, 0.002, alert && r < 2 ? 0xff5a4a : (r === 0 ? P.amber : 0x6ccf8a), "glow");
      }
      for (const s of [-1, 1]) k.box(bx + s * 1.0, 1.15, bz + 0.03, 0.08, 0.2, 0.06, P.tubeD, "metal");   // brackets
    }
    k.frame(ix1 - 2.2, FY, iz0 + 1.6, 0); radioRack(k, 1.2, 1.8, 0.9);
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
    // a hazard-striped steel surround round the vault opening (outside face)
    k.frame(0, FY, 0, 0);
    for (const s of [-1, 1]) k.box(vx1 + 0.58, 1.3, vz1 - 0.9 + s * 1.0, 0.04, 2.6, 0.2, P.yellow);
    k.box(vx1 + 0.58, 2.62, vz1 - 0.9, 0.04, 0.2, 2.2, P.yellow);
    for (let i = 0; i < 6; i++) for (const s of [-1, 1]) k.box(vx1 + 0.605, 0.2 + i * 0.42, vz1 - 0.9 + s * 1.0, 0.01, 0.07, 0.2, P.black, "solid", 0.6 * s, 0, 0);
    k.box(vx1 + 0.58, 2.95, vz1 - 0.9, 0.04, 0.22, 1.2, P.red);                          // the RESTRICTED plate
    k.box(vx1 + 0.605, 2.95, vz1 - 0.9, 0.01, 0.06, 0.9, P.cream);
    // vault door on the +X face of the chamber (single heavy leaf)
    const vdoor = makeDoor(g, vx1 + 0.25, vz1 - 0.9, "z", 1.8, 2.5, M.steelD, 0.55);
    vdoor.y0 = FY; vdoor.y1 = FY + 2.5;
    vdoor.colRec.y0 = FY; vdoor.colRec.y1 = FY + 2.5;
    vdoor.bunker = rec;
    rec.doors.push(vdoor);
    /* THE ONE LOCKED DOOR THAT MATTERS. Three routes, and every one is a thing
       the world already models: a Colonel's card you looted, the army itself
       (a real rank inside it, or a uniform they still believe), or simply
       enough people, guns, money and access that nobody can stop you. That
       last one is the owner's sentence made mechanical. */
    doorTokens.push({
      x: vx1 + 0.9, z: vz1 - 0.9, door: vdoor, name: "Weapons Vault",
      lockNote: "an army rank, a card, or a force big enough to take it",
      lock: { id: "bunker-vault", verb: "vault", orgs: ["army", "military"], keys: ["Vault Card", "Officer's Keycard"], minTier: 4 },
    });
    if (CBZ.cityLockRegister) CBZ.cityLockRegister("bunker-vault");
    /* ---- THE STASH: THREE WARHEADS, ONE NUKE ---------------------------
       OWNER: "theres one nuclear stash — it should actually have 3 warheads
       in it but be considered one nuke."

       So the ROOM changes and the RULES do not. What is drawn is a real
       handling rack carrying three complete weapons: A-frame standards,
       longitudinal rails, saddle cradles, tie-down straps, a stencilled
       kerb. What is BOOKKEPT is untouched: one `vaultTokens` entry, one
       "Nuclear Device" item, one per world, the same theft crime, the same
       "you already carry it" refusal. Taking it takes all three as a unit
       and the whole rack goes with them.

       Every mesh in the stash is stamped `userData.nukeDevice`, which is
       what core/batch.js actually reads (it judges each MESH on its own
       userData), so the device can never be swallowed into a merged buffer
       that `deviceMesh.visible = false` would then fail to hide. */
    const devX = vx0 + 2.6, devZ = vz0 + 2.6;
    const stash = new THREE.Group();
    if (CBZ.CONFIG.NUKE_STASH_TRIPLE !== false && CBZ.nukeWarhead) {
      const N = 3, PITCH = 0.68;                  // three abreast, 0.68 m centres
      const RACK_L = 2.86, RACK_W = PITCH * (N - 1) + 0.92;
      const AXIS_Y = FY + 0.98;                   // the weapons' centreline
      // base skid + two longitudinal rails the saddles bolt to
      box(g, devX, FY + 0.11, devZ, RACK_L, 0.22, RACK_W, M.steelD);
      for (const s of [-1, 1]) {
        box(g, devX, FY + 0.30, devZ + s * (RACK_W / 2 - 0.14), RACK_L, 0.16, 0.16, M.steel);
      }
      // A-frame end standards: two uprights per end, cross-braced
      for (const ex of [-1, 1]) {
        const sx = devX + ex * (RACK_L / 2 - 0.18);
        for (const s of [-1, 1]) {
          box(g, sx, FY + 0.60, devZ + s * (RACK_W / 2 - 0.16), 0.14, 0.78, 0.14, M.steel);
        }
        box(g, sx, FY + 0.97, devZ, 0.12, 0.12, RACK_W - 0.28, M.steel);
      }
      for (let i = 0; i < N; i++) {
        const wz = devZ + (i - (N - 1) / 2) * PITCH;
        /* Two saddle cradles per casing, heights SOLVED: the rail tops sit at
           FY+0.38 and the casing's underside at AXIS_Y - RAD, so a saddle that
           spans exactly that gap touches both and nothing floats. */
        const railTop = FY + 0.38, saddleTop = AXIS_Y - 0.21;
        for (const s of [-0.86, 0.86]) {
          box(g, devX + s, (railTop + saddleTop) / 2, wz,
              0.20, saddleTop - railTop, 0.50, M.steelD);
          box(g, devX + s, saddleTop + 0.43, wz, 0.10, 0.06, 0.46, M.warn); // tie-down strap
        }
        const w = CBZ.nukeWarhead({ mat: cm, geo: bg, chute: false });
        w.position.set(devX, AXIS_Y, wz);
        // alternate which way the noses point, the way a real rack is loaded
        if (i === 1) w.rotation.y = Math.PI;
        stash.add(w);
      }
      // stencilled kerb line in front of the rack — the room says NO ENTRY
      for (let i = 0; i < 4; i++) {
        k.box(devX - 1.2 + i * 0.8, 0.025, devZ + RACK_W / 2 + 0.46, 0.56, 0.01, 0.16, P.yellow);
      }
      col(devX - RACK_L / 2 - 0.1, devX + RACK_L / 2 + 0.1,
          devZ - RACK_W / 2 - 0.1, devZ + RACK_W / 2 + 0.1, FY, FY + 1.35);
    } else {
      // REVERT PATH — the single casing on its saddle, byte-for-byte.
      box(g, devX, FY + 0.35, devZ, 2.0, 0.7, 1.2, M.steelD);
      for (const s of [-0.55, 0.55]) box(g, devX + s, FY + 0.82, devZ, 0.16, 0.28, 1.1, M.steel);
      const shellM = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.7, 12), cm(M.device));
      shellM.rotation.z = Math.PI / 2; stash.add(shellM);
      const noseM = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), cm(M.device));
      noseM.position.x = 0.85; stash.add(noseM);
      const tailM = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.5, 12), cm(M.deviceD));
      tailM.rotation.z = Math.PI / 2; tailM.position.x = -1.05; stash.add(tailM);
      const bandM = new THREE.Mesh(new THREE.CylinderGeometry(0.435, 0.435, 0.18, 12), cm(M.red));
      bandM.rotation.z = Math.PI / 2; bandM.position.x = 0.2; stash.add(bandM);
      stash.position.set(devX, FY + 1.15, devZ);
      col(devX - 1.1, devX + 1.1, devZ - 0.7, devZ + 0.7, FY, FY + 1.5);
    }
    stash.userData.nukeDevice = true;
    stash.traverse(function (o) {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.nukeDevice = true; }
    });
    g.add(stash);
    // the red cage lamp: a caged bulkhead fitting, and painted floor stripes
    k.box(devX, CEIL - FY - 0.08, devZ, 0.5, 0.12, 0.5, P.tubeD, "metal");
    k.box(devX, CEIL - FY - 0.17, devZ, 0.36, 0.06, 0.36, 0xc23a2e, "glow");
    for (let i = 0; i < 3; i++) k.box(vx0 + 0.9 + i * 1.6, 0.025, vz1 - 0.6, 1.1, 0.01, 0.24, P.yellow);
    vaultTokens.push({ x: devX, z: devZ, taken: false, deviceMesh: stash });
  }

  // ---- OUTPOST TIER (mountain / desert): one abandoned room, themed --------
  function furnishOutpost(g, k, rec, ix0, ix1, iz0, iz1, cx, cz, FY, site) {
    const desert = site.theme === "desert";
    // cot rows (civil-defense monotony): 4 cots along the -X wall
    for (let i = 0; i < 4; i++) {
      const bz = iz1 - 2.5 - i * 2.4, bx = ix0 + 1.3;
      k.frame(bx, FY, bz, 0); cot(k);
      col(ix0, ix0 + 2.4, bz - 0.55, bz + 0.55, FY, FY + 0.6);
    }
    // supply shelving along the +X wall, drums in the corner
    for (let i = 0; i < 2; i++) {
      const sz = iz1 - 3 - i * 3.6, sx = ix1 - 1.1;
      k.frame(sx, FY, sz, -Math.PI / 2); shelving(k, 2.4, 0.6, 2.0, 11 + i * 7 + Math.round(cx));
      col(ix1 - 1.5, ix1, sz - 1.3, sz + 1.3, FY, FY + 2.0);
    }
    k.frame(0, FY, 0, 0);
    for (let i = 0; i < 3; i++) drum(k, ix1 - 1.0, 0, iz0 + 1.4 + i * 1.1, i === 1 ? 0x6a4a2a : M.drum);
    col(ix1 - 1.6, ix1 - 0.4, iz0 + 0.8, iz0 + 4.2, FY, FY + 1.1);
    // dead radio desk at the back — the site went dark mid-shift
    k.frame(cx, FY, iz0 + 1.2, 0); deskStation(k, 1.8, 0);
    k.frame(cx, FY + 0.76, iz0 + 0.9, 0); radioRack(k, 1.0, 0.5, 0.42);
    k.frame(cx + 1.6, FY, iz0 + 1.8, Math.PI * 0.85); swivelChair(k);
    col(cx - 0.95, cx + 0.95, iz0 + 0.7, iz0 + 1.7, FY, FY + 1.3);
    // the genset (desert: sand drifted in at the door; snow: frost on the floor)
    k.frame(ix0 + 1.2, FY, iz0 + 1.4, Math.PI / 2); genset(k, 1.1, 1.0, 0.9);
    col(ix0 + 0.3, ix0 + 2.1, iz0 + 0.8, iz0 + 2.0, FY, FY + 1.2);
    k.frame(0, FY, 0, 0);
    k.box(cx + (desert ? 2 : -2), 0.03, cz + 2, 4, 0.02, 3, desert ? M.sand : 0xdfe6ea);
    // THE CACHE — one strong find per site
    const ccX = cx + 2.2, ccZ = iz0 + 3.6;
    k.frame(ccX, FY, ccZ, Math.PI / 2);
    ammoCrate(k, 0, 0, 0, 2.2, 0.9, 1.3, 0);
    for (const s of [-0.7, 0.7]) k.box(s, 0.45, 0, 0.12, 0.92, 1.33, P.yellow);
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

  /* ---- RUNTIME BUNKERS (city/warroom.js) ---------------------------------
     A head of state's bunker by his capital, a terror cell's dug-out in the
     Saltlands, the one a President orders built: the SAME builder, the same
     blast door, the same shell/interior/roof records, the same breach. site:
     {id, name, cx, cz, w, d, tier, roofCE, owner, floorY, grade0, found,
     crete, theme}. Idempotent by id while the record lives; a city rebuild
     clears the list and warroom.js builds them again from its saved list. */
  CBZ.strategicBuildBunker = function (site) {
    if (CBZ.CONFIG.STRAT_BUNKERS === false || !site || !site.id) return null;
    for (let i = 0; i < bunkers.length; i++) if (bunkers[i].id === site.id) return bunkers[i];
    const A = CBZ.city && CBZ.city.arena;
    const root = (A && A.root) || CBZ.scene;
    if (!root || !CBZ.colliders) return null;
    const s = Object.assign({ w: 22, d: 18, tier: "leader", floorY: 0, grade0: 0 }, site);
    if (s.grade && typeof s.grade === "function") {
      const gd = gradeFor(s.grade, s.cx, s.cz, s.w, s.d);
      s.floorY = gd.floorY; s.grade0 = gd.grade0; s.found = gd.found;
    }
    let rec = null;
    try { rec = buildBunker(A || null, root, s); } catch (e) { rec = null; }
    if (!rec) return null;
    rec.dynamic = true;
    if (CBZ.registerNoSpawnZone && A) { try { CBZ.registerNoSpawnZone(A, { minX: rec.shell.minX, maxX: rec.shell.maxX, minZ: rec.shell.minZ, maxZ: rec.shell.maxZ, label: "bunker-" + rec.id }); } catch (e) {} }
    wireZones();
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    return rec;
  };

  CBZ.addLandmass(function (city) {
    if (CBZ.CONFIG.STRAT_BUNKERS === false) return;
    const root = city.root || CBZ.scene;
    // a rebuild re-runs this builder — fresh lists (stale doors/records would
    // point at removed groups; the zones' find() walks these live lists)
    doors.length = 0; bunkers.length = 0;
    doorTokens.length = 0; crateTokens.length = 0; vaultTokens.length = 0; strikeTokens.length = 0;
    nukeTokens.length = 0;
    _npcCursor = 0; _npcSpawned.length = 0;

    // ---- SITE 1: FORT BRANDT DEEP SHELTER (command tier). NW quadrant of
    // the military island — clear of the radar (-590,-900), barracks
    // (-440,-890..-788), watchtowers (corners) and helipads (z=-670).
    // It rides the base's layout dial: the old literal (-762, -872) was dug
    // into Gang City West once Fort Brandt moved. The spot is published once
    // by city/zoning.js (protected land).
    const bs = (CBZ.protectedSite && CBZ.protectedSite("brandt-shelter")) ||
      (function () { const o = (CBZ.worldOff && CBZ.worldOff("military")) || { dx: 0, dz: 0 }; return { cx: -762 + o.dx, cz: -872 + o.dz }; })();
    buildBunker(city, root, {
      id: "brandt", name: "Fort Brandt Deep Shelter", subtitle: "Military Reservation",
      cx: bs.cx, cz: bs.cz, w: 36, d: 30, tier: "command", floorY: 0, grade0: 0,
    });

    // ---- SITE 2: MOUNTAIN EARLY-WARNING POST (outpost). East shoulder of
    // the snow massif (authored rect -70..770 × -1780..-1120, riding the
    // world-layout snow dial), hash-jittered, seated on the sampled grade of
    // the massif height field.
    const _SNW = (CBZ.worldOff && CBZ.worldOff("snow")) || { dx: 0, dz: 0 };
    const m2x = 560 + _SNW.dx + Math.round((h01(11, 71, 0xb11) - 0.5) * 60);
    const m2z = -1600 + _SNW.dz + Math.round((h01(23, 47, 0xb12) - 0.5) * 60);
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
