/* ============================================================
   city/casino.js — REAL CASINOS (owner: "Casino should be a real
   building, there should be many. No bullshit fake shit.").

   WHY THIS EXISTS
   A "casino" was, until now, just a shop kind: a plain retail shell whose
   interior dresser dropped a couple of decorative felt boxes and four slot
   cabinets — no seats, no way to play FROM the floor (you had to open a
   menu), and no exterior that read as a casino. This file turns every
   casino LOT in the world into a real gaming house:

     • EXTERIOR: a marquee header + chase-light strip over the door and a
       tall mast/tower sign — the three cues that instantly say "casino"
       (Wikipedia: marquee + mast sign + porte-cochere). Emissive geometry,
       one mast collider, NO floating sprites (owner rule).
     • INTERIOR: 2–4 felt gaming TABLES (blackjack/roulette), each ringed
       with real sittable seats; a back-to-back SLOT bank; a BAR corner and
       a CASHIER cage near the vendor — the real casino-floor zone mix
       (slots dominate the floor, a table pit, a cage, a perimeter bar).
     • INTERACTION: walking up to any table surfaces "[E] Sit at the table",
       which opens the live casino floor (blackjack/roulette/slots).

   HOW IT RUNS
   An order-90 landmass pass (after every town/biome/mainland building
   exists — the mainland Golden Ace and every composed town casino) scans
   for lot.kind === 'casino' and dresses each once. A single global
   'casino-table' interaction zone reads a live table list, so it stays
   correct across world rebuilds without leaking zones.

   Determinism: table count/placement derive from CBZ.hash01 (folds
   WORLD_SEED). Runtime only. Revert: CBZ.CONFIG.CASINOS_V1 = false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CASINOS_V1 == null) CBZ.CONFIG.CASINOS_V1 = true;

  const GOLD = 0xc9a227;     // the house chase-light / marquee tone
  const FELT = 0x1f6d43;     // gaming-felt green
  const REACH = 3.2;

  // live table registry (world positions) — the single interaction zone reads
  // this; reset at the top of every dress pass so rebuilds never stack.
  CBZ._casinoTables = CBZ._casinoTables || [];

  function litMat(color, ei) {
    return new THREE.MeshLambertMaterial({ color: color, emissive: color, emissiveIntensity: ei == null ? 0.8 : ei });
  }
  function addBox(root, x, y, z, w, h, d, mat, rotY) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); if (rotY) m.rotation.y = rotY;
    m.castShadow = false; m.receiveShadow = false;
    root.add(m); return m;
  }

  // ---- EXTERIOR: marquee + chase lights + mast sign -------------------------
  function dressExterior(root, lot) {
    const b = lot.building || {};
    const door = b.door || { x: lot.cx, z: lot.cz, nx: 0, nz: 1 };
    const nx = door.nx || 0, nz = door.nz || (nx ? 0 : 1);
    // marquee header board: a lit box on the door face, above the entrance
    const fx = lot.cx + nx * (lot.w / 2 + 0.15), fz = lot.cz + nz * (lot.d / 2 + 0.15);
    const along = Math.abs(nx) > 0.5;            // door faces ±X → board spans Z
    const boardW = Math.min((along ? lot.d : lot.w) - 1.2, 9);
    const rotY = along ? Math.PI / 2 : 0;
    addBox(root, fx, 4.6, fz, boardW, 1.3, 0.4, litMat(GOLD, 0.7), rotY);
    // chase-light strip: a row of small emissive bulbs under the marquee
    const bulbs = 9;
    for (let i = 0; i < bulbs; i++) {
      const t = (i + 0.5) / bulbs - 0.5;
      const ox = along ? 0 : t * boardW, oz = along ? t * boardW : 0;
      addBox(root, fx + ox, 3.85, fz + oz, 0.28, 0.28, 0.28, litMat(GOLD, 1.0));
    }
    // MAST / tower sign: a tall pole beside the entrance with a vertical lit
    // board near the top — the "visible from the highway" cue. One collider.
    const side = along ? { x: 0, z: 1 } : { x: 1, z: 0 };
    const mx = lot.cx + nx * (lot.w / 2 + 1.6) + side.x * (lot.w / 2 - 1.0);
    const mz = lot.cz + nz * (lot.d / 2 + 1.6) + side.z * (lot.d / 2 - 1.0);
    const poleH = 12;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, poleH, 8), cmat(0x3a3630));
    pole.position.set(mx, poleH / 2, mz); pole.castShadow = true; root.add(pole);
    addBox(root, mx, poleH - 2.2, mz, 2.4, 4.2, 0.5, litMat(GOLD, 0.85), rotY);
    if (CBZ.colliders) CBZ.colliders.push({ minX: mx - 0.6, maxX: mx + 0.6, minZ: mz - 0.6, maxZ: mz + 0.6, y0: 0, y1: poleH });
  }

  // ---- INTERIOR: tables + seats + slots + bar + cashier ---------------------
  function dressInterior(lot) {
    const b = lot.building;
    if (!b || typeof b.lbox !== "function") return 0;
    const w = b.w, d = b.d, wt = b.wt != null ? b.wt : 0.3;
    const floorY = (b.floorTops && b.floorTops[0] != null) ? b.floorTops[0] : 0.14;
    const ox = b.ox != null ? b.ox : lot.cx, oz = b.oz != null ? b.oz : lot.cz;
    const door = b.door || { nx: 0, nz: 1 };
    const inx = -(door.nx || 0), inz = -(door.nz || (door.nx ? 0 : 1));   // inward unit
    const hx = w / 2 - wt - 1.2, hz = d / 2 - wt - 1.2;                    // usable half-extents
    if (hx < 2 || hz < 2) return 0;                                       // too small — exterior only

    // number of tables from the seed (2..4), clamped by floor room.
    const roll = CBZ.hash01 ? CBZ.hash01(lot.cx, lot.cz, 7734) : 0.5;
    const room = Math.max(1, Math.floor((hx * 2) / 3.2)) * Math.max(1, Math.floor((hz * 2) / 3.2));
    let N = Math.min(4, Math.max(2, 2 + Math.floor(roll * 3)));
    N = Math.min(N, Math.max(1, room - 1));

    // TABLES — a small pit toward the interior, clear of the door lane.
    const tables = [];
    const spanT = hz * 0.9;
    for (let i = 0; i < N; i++) {
      const t = N > 1 ? (i / (N - 1) - 0.5) : 0;
      // place along the tangent to the door normal, pushed to the far (inward) half
      const lx = inx ? inx * (hx * 0.35) : t * spanT;
      const lz = inz ? inz * (hz * 0.35) : t * spanT;
      const tx = inx ? lx : t * spanT * (Math.abs(inx) > 0.5 ? 0 : 1);
      // felt table: base + green top (non-solid so the player can walk up)
      b.lbox(lx, floorY + 0.45, lz, 1.7, 0.9, 1.2, 0x5a3a22, { cast: false });
      b.lbox(lx, floorY + 0.95, lz, 1.9, 0.12, 1.4, FELT, { cast: false });
      const wx = ox + lx, wz = oz + lz;
      tables.push({ x: wx, y: floorY, z: wz, lot: lot });
      CBZ._casinoTables.push({ x: wx, y: floorY, z: wz, lot: lot });
      // 4 sittable "table" seats around the felt (satisfies the pit-ambiance +
      // gives the sit pose; the casino-table zone opens the actual game).
      if (CBZ.propRegisterSeat) {
        const off = 1.4;
        const spots = [[off, 0, -Math.PI / 2], [-off, 0, Math.PI / 2], [0, off, Math.PI], [0, -off, 0]];
        for (const s of spots) CBZ.propRegisterSeat(wx + s[0], floorY, wz + s[1], s[2], "table", lot);
      }
    }

    // SLOT BANK — a back-to-back row of lit cabinets along a side wall (the
    // floor's dominant feature). Solid obstacles.
    const slotN = Math.min(8, Math.max(4, Math.round(hx)));
    const sideSign = inz ? 1 : -1;      // opposite wall from where tables lean
    for (let i = 0; i < slotN; i++) {
      const t = (i / Math.max(1, slotN - 1) - 0.5) * (hx * 1.6);
      const sx = inx ? sideSign * (hx * 0.85) : t;
      const sz = inx ? t : sideSign * (hz * 0.85);
      b.lbox(sx, floorY + 0.75, sz, 0.7, 1.5, 0.6, 0x24202c, { solid: true });
      b.lbox(sx, floorY + 1.15, sz + 0.02, 0.62, 0.6, 0.05, GOLD, { emissive: GOLD, ei: 0.7, cast: false });
    }

    // BAR corner + CASHIER cage near the vendor spot.
    b.lbox(-hx * 0.8, floorY + 0.6, -hz * 0.8, Math.min(3.2, hx), 1.1, 0.7, 0x3a2a1c, { solid: true });
    b.lbox(hx * 0.8, floorY + 0.7, -hz * 0.8, Math.min(2.6, hx), 1.4, 0.7, 0x2a2620, { solid: true });
    b.lbox(hx * 0.8, floorY + 1.5, -hz * 0.8, Math.min(2.6, hx), 0.1, 0.7, GOLD, { emissive: GOLD, ei: 0.5, cast: false });

    lot._casinoTables = tables;
    return tables.length;
  }

  function dressCasino(root, lot) {
    if (!lot || !lot.building || lot._casinoDressed) return;
    lot._casinoDressed = true;
    try { dressExterior(root, lot); } catch (e) {}
    try { dressInterior(lot); } catch (e) {}
  }

  // ---- the single global casino-table interaction zone ----------------------
  function openTable() {
    if (CBZ.cityOpenCasino) CBZ.cityOpenCasino();
    else if (CBZ.cityOpenActivities) CBZ.cityOpenActivities("Betting");
  }
  if (CBZ.interactions && CBZ.interactions.registerZone && !CBZ._casinoZoneReg) {
    CBZ._casinoZoneReg = true;
    CBZ.interactions.registerZone({
      id: "casino-table", kind: "casino-table", prio: 7, driving: false,
      find: function (px, pz, ctx) {
        const py = ctx && ctx.pos ? ctx.pos.y : 0;
        let best = null, bd = REACH * REACH;
        const list = CBZ._casinoTables;
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          if (Math.abs((t.y || 0) - py) > 2.2) continue;
          const dx = t.x - px, dz = t.z - pz, dsq = dx * dx + dz * dz;
          if (dsq < bd) { bd = dsq; best = t; }
        }
        return best;
      },
      options: [{ id: "sit-table", slot: "e", label: "Sit at the table", onSelect: function () { openTable(); } }],
    });
  }

  // ---- ORDER-90 DRESS PASS --------------------------------------------------
  // Runs after every landmass builder (biomes 30-35 build town casinos; the
  // mainland Golden Ace already exists) so it sees every casino lot in one shot.
  CBZ.addLandmass(function (city) {
    if (CBZ.CONFIG.CASINOS_V1 === false) return;
    const A = city || CBZ._settlementArena || (CBZ.city && CBZ.city.arena) || null;
    const root = (city && city.root) || (A && A.root) || null;
    if (!A || !root) return;
    CBZ._casinoTables.length = 0;                 // fresh per world build
    const seen = new Set();
    const scan = function (arr) {
      if (!arr) return;
      for (const lot of arr) {
        if (!lot || lot.kind !== "casino" || !lot.building) continue;
        const key = Math.round(lot.cx) + "," + Math.round(lot.cz);
        if (seen.has(key)) continue; seen.add(key);
        dressCasino(root, lot);
      }
    };
    scan(A.shopLots); scan(A.lots);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }, 90);

  CBZ.dressCasino = dressCasino;
})();
