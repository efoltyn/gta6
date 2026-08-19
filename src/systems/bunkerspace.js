/* ============================================================
   systems/bunkerspace.js — A ROOM UNDER AN INTACT STREET.

   THE WHOLE FEATURE IS ONE SENTENCE: a bunker is a hole with a LID on it, and a
   bunker buster is the thing that takes the lid off.

   A pit is a hole with nothing over it, and this engine has had those since the
   sinkhole — they are single-valued, one floor per (x,z), and floorAt has always
   been able to say so. A bunker is the other thing: street ABOVE and room BELOW,
   both solid, at the same (x,z). That is the one shape the ground could not
   express, and systems/solidground.js expresses it by not storing it at all —
   the lid is what SUBTRACTION LEAVES above a closed carving.

   So there is no bunker geometry system here. There is a box of removed
   material, a liner so the room has surfaces to look at, y-banded colliders so
   it has walls, and a way in. Everything that makes it behave — you stand on the
   street above it, you stand on its floor inside it, you cannot jump through its
   roof, a car drives over it — is the ground model doing its job.

   WHY bunkers.js's MOUND IS NOT THIS. city/bunkers.js delivers "underground" the
   way engines without a lid have always had to: the interior sits AT GRADE and a
   berm is piled over it. Its header records that as a considered decision, and
   for an isolated hillside shelter it is the right one — you can see it from a
   mile away and that is the point. It cannot serve a target hiding under a Gang
   City block, who needs the STREET over his head and nothing on the surface to
   give him away. Both exist; neither is a copy of the other.

   THE BREACH IS NOT A STATE FLAG. A penetrator does not "set breached = true" on
   this room, it CUTS A SECOND CARVING — an open cylinder from the crater down
   through the lid — and the two carvings' spans merge into one column because
   that is what subtraction does. The hole in the roof is a real hole: you can
   see the room through it, drop into it, and shoot down it. Nothing had to learn
   the word "breach" for that to be true.

   Flags:
     BUNKER_SPACE       master; false = no carving bunkers are ever built
     BUNKER_LID_MIN     thinnest lid a bunker may keep (m of earth over the roof)
   Ratchet: CBZ.bunkerSpaceAudit(), tools/bunker-check.mjs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.BUNKER_SPACE == null) CBZ.CONFIG.BUNKER_SPACE = true;
  if (CBZ.CONFIG.BUNKER_LID_MIN == null) CBZ.CONFIG.BUNKER_LID_MIN = 2.5;

  const rooms = [];
  const stats = { built: 0, breached: 0, refused: 0, why: {} };
  let wallMat = null, floorMat = null, ceilMat = null, lampMat = null;

  function mats() {
    if (wallMat) return;
    /* "A REAL LIT ROOM, NEVER A DARK GREY CRATER" is the doctrine city/
       buildings.js states for a blast hole, and a bunker photographed through
       its own breached roof came out a navy box: no sun reaches here, and a
       handful of point lights against a whole room is not enough on this
       renderer. Emissive is the reliable half — it does not depend on a light
       budget, a quality tier or how many lights the frame already has — and
       the lamps then read as sources rather than as the only illumination. */
    wallMat = new THREE.MeshLambertMaterial({ color: 0x6a6c70, emissive: 0x2b2e33 });
    floorMat = new THREE.MeshLambertMaterial({ color: 0x4c4e52, emissive: 0x24262a });
    ceilMat = new THREE.MeshLambertMaterial({ color: 0x3a3c40, emissive: 0x1c1e21 });
    lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9b8 });
    /* THE LINER LIVES INSIDE THE MASK'S BAND AT THE ENTRANCE and, once breached,
       directly under an open mouth. Opting out is a #define — exact, in the
       program cache key, and impossible to "miss" the way a search can. */
    /* The floor, walls and lamps are exempt — they live inside the mask's band
       near the entrance and must not be eaten by it. The CEILING is deliberately
       NOT: it is the underside of the lid, so when something punches a hole
       through the lid the ceiling has to go with it, and the mask's band about
       that hole is exactly the right shape to take it. Exempting it plugged the
       view into the room with a slab of concrete that was no longer there. */
    if (CBZ.groundMaskExempt) [wallMat, floorMat, lampMat].forEach(CBZ.groundMaskExempt);
  }
  function root() { return CBZ.scene; }
  function refuse(w) { stats.refused++; stats.why[w] = (stats.why[w] || 0) + 1; return null; }

  /* A ROOM YOU CAN SEE. The interiors doctrine this game already follows: not
     pretty, LIT. A dark box under the street reads as a bug; a lit one reads as
     a place. Sun never reaches here, so the room brings its own. */
  function buildLiner(b) {
    const g = new THREE.Group();
    g.userData.bunkerSpace = true;
    const hw = b.hw, hd = b.hd, y0 = b.y0, y1 = b.y1, h = y1 - y0;
    const box = (w, hh, d, x, y, z, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
      mesh.position.set(x, y, z); g.add(mesh); return mesh;
    };
    const T = 0.35;
    box(hw * 2, T, hd * 2, 0, y0 - T / 2, 0, floorMat);                    // floor
    box(hw * 2, T, hd * 2, 0, y1 + T / 2, 0, ceilMat);                     // ceiling — the lid's underside
    box(T, h, hd * 2, -hw - T / 2, y0 + h / 2, 0, wallMat);
    box(T, h, hd * 2, hw + T / 2, y0 + h / 2, 0, wallMat);
    box(hw * 2 + T * 2, h, T, 0, y0 + h / 2, -hd - T / 2, wallMat);
    box(hw * 2 + T * 2, h, T, 0, y0 + h / 2, hd + T / 2, wallMat);
    const nL = Math.max(2, Math.round(Math.min(hw, hd) / 3));
    for (let i = 0; i < nL; i++) {
      const t = (i + 0.5) / nL;
      box(1.1, 0.12, 0.3, 0, y1 - 0.25, -hd + t * hd * 2, lampMat);
      const L = new THREE.PointLight(0xffe4b0, 0.75, Math.max(hw, hd) * 2.2, 2);
      L.position.set(0, y1 - 0.6, -hd + t * hd * 2); g.add(L);
    }
    g.position.set(b.cx, 0, b.cz);
    g.rotation.y = b.yaw || 0;
    root().add(g);
    return g;
  }

  /* WALLS ARE ALREADY EXPRESSIBLE. Colliders in this engine have carried an
     optional y band (y0/y1) for a long time — bunkers.js y-gates a ceiling with
     it — so a room below grade needs no new collision concept at all, only the
     records. */
  function addWalls(b) {
    if (!CBZ.orientedCollider) return [];
    const out = [], T = 0.4;
    const put = (cx, cz, hw, hd) => {
      const c = CBZ.orientedCollider(cx, cz, hw, hd, b.yaw || 0, b.y0 - 0.5, b.y1 + 0.5);
      if (c) out.push(c);
    };
    const co = Math.cos(b.yaw || 0), si = Math.sin(b.yaw || 0);
    const at = (lx, lz) => ({ x: b.cx + lx * co - lz * si, z: b.cz + lx * si + lz * co });
    let p = at(-b.hw - T, 0); put(p.x, p.z, T, b.hd + T * 2);
    p = at(b.hw + T, 0); put(p.x, p.z, T, b.hd + T * 2);
    p = at(0, -b.hd - T); put(p.x, p.z, b.hw + T * 2, T);
    p = at(0, b.hd + T); put(p.x, p.z, b.hw + T * 2, T);
    return out;
  }

  /* Build one. `depth` is how far the ROOF sits below grade — the lid — and the
     room hangs beneath it. A lid thinner than BUNKER_LID_MIN is refused: a
     bunker whose roof is a crust is a hole with a lie over it. */
  CBZ.buildBunker = function (x, z, o) {
    o = o || {};
    if (CBZ.CONFIG.BUNKER_SPACE === false || !CBZ.addCarving) return refuse("disabled");
    mats();
    const surf = CBZ.groundBaseAt ? CBZ.groundBaseAt(x, z) : 0;
    if (!Number.isFinite(surf)) return refuse("badPoint");
    const lid = Math.max(CBZ.CONFIG.BUNKER_LID_MIN, o.lid != null ? o.lid : 3.0);
    const hw = Math.max(3, o.hw != null ? o.hw : 8);
    const hd = Math.max(3, o.hd != null ? o.hd : 8);
    const height = Math.max(2.6, o.height != null ? o.height : 3.6);
    const y1 = surf - lid, y0 = y1 - height;

    /* THE SITE LAW IS THE HOLE'S LAW. A room under a tower's footing is the
       same fault as a shaft under it — this engine's structural ledger has no
       concept of "undermined" — so the same refusal applies. */
    if (CBZ.groundShaftCanOpen && !o.force) {
      const can = CBZ.groundShaftCanOpen(x, z, Math.max(hw, hd));
      if (!can.ok) return refuse(can.why || "law");
    }
    const b = {
      cx: x, cz: z, hw: hw, hd: hd, yaw: o.yaw || 0,
      y0: y0, y1: y1, surf: surf, lid: lid, name: o.name || "bunker",
      lidCE: o.lidCE != null ? o.lidCE : lid * 1.6,   // concrete-equivalent metres
      breaches: [], mode: CBZ.game ? CBZ.game.mode : null,
    };
    b.carve = CBZ.addCarving({
      kind: "box", cx: x, cz: z, hw: hw, hd: hd, yaw: b.yaw,
      y0: y0, y1: y1, open: false, dry: true, owner: "bunkerSpace", mode: b.mode,
    });
    b.grp = buildLiner(b);
    b.cols = addWalls(b);
    rooms.push(b);
    stats.built++;
    if (o.entrance !== false) CBZ.bunkerEntrance(b, o.entranceAt);
    return b;
  };

  /* THE WAY IN ON FOOT. A shaft with the primitive's own spiral stair, cut from
     the surface down to the room's floor and overlapping its wall so the two
     volumes join. The stair grammar already clears this game's jump height, so
     the descent is walkable without inventing a ladder. */
  CBZ.bunkerEntrance = function (b, at) {
    if (!b || !CBZ.groundShaft) return null;
    const co = Math.cos(b.yaw || 0), si = Math.sin(b.yaw || 0);
    const lx = at && at.lx != null ? at.lx : 0;
    const lz = at && at.lz != null ? at.lz : (b.hd + 3.2);
    const x = b.cx + lx * co - lz * si, z = b.cz + lx * si + lz * co;
    const sh = CBZ.groundShaft(x, z, {
      r: 3.4, depth: b.surf - b.y0, gy: b.surf, surface: "asphalt",
    });
    if (sh) { sh.bunkerEntrance = true; b.entrance = sh; }
    return sh;
  };

  /* THE BUNKER BUSTER. Not a flag — a second carving. An open cylinder from the
     sky down past the roof, whose span merges with the room's because that is
     what subtraction does, so the crater above and the room below become one
     column. The room is then visible through it, you can fall in, and floorAt
     from the sky reaches the floor. */
  CBZ.breachBunker = function (b, x, z, r) {
    if (!b || !CBZ.addCarving) return null;
    r = Math.max(2.5, r || 5);
    const bx = x != null ? x : b.cx, bz = z != null ? z : b.cz;
    const hole = CBZ.addCarving({
      kind: "cyl", x: bx, z: bz, r: r,
      y0: b.y0, y1: b.surf + 60, open: true, dry: true, owner: "bunkerBreach", mode: b.mode,
    });
    b.breaches.push(hole);
    b.breached = true;
    stats.breached++;
    // the roof over the hole is gone, so the ground above it must stop drawing;
    // the shaft primitive's own liner gives the torn edge and the mask slot
    if (CBZ.groundShaft) {
      // `through`: the room below is the floor, so this cuts a torn rim and a
      // wall down to the roof line and stops. A dish here would plug the hole.
      const rim = CBZ.groundShaft(bx, bz, { r: r, depth: b.surf - b.y1, gy: b.surf, surface: "asphalt", through: true });
      if (rim) { rim.bunkerBreach = true; b.breachRim = rim; }
    }
    return hole;
  };

  /* Which room is under this point, if any. Used by the ordnance path to decide
     whether a hit is over a lid at all. */
  CBZ.bunkerUnder = function (x, z) {
    for (let i = 0; i < rooms.length; i++) {
      const b = rooms[i];
      const dx = x - b.cx, dz = z - b.cz;
      const co = Math.cos(-(b.yaw || 0)), si = Math.sin(-(b.yaw || 0));
      if (Math.abs(dx * co - dz * si) < b.hw && Math.abs(dx * si + dz * co) < b.hd) return b;
    }
    return null;
  };
  CBZ.bunkerSpaceRooms = rooms;
  CBZ.bunkerSpaceAudit = function () {
    let breached = 0;
    for (let i = 0; i < rooms.length; i++) if (rooms[i].breached) breached++;
    return {
      rooms: rooms.length, breached: breached,
      built: stats.built, breaches: stats.breached, refused: stats.refused, why: stats.why,
      lidMin: CBZ.CONFIG.BUNKER_LID_MIN, enabled: CBZ.CONFIG.BUNKER_SPACE !== false,
    };
  };
  CBZ.bunkerSpaceClear = function () {
    for (let i = 0; i < rooms.length; i++) {
      const b = rooms[i];
      if (b.carve) CBZ.removeCarving(b.carve);
      for (let k = 0; k < b.breaches.length; k++) CBZ.removeCarving(b.breaches[k]);
      if (b.entrance && !b.entrance._closed) b.entrance.dispose();
      if (b.breachRim && !b.breachRim._closed) b.breachRim.dispose();
      if (b.grp) { b.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); if (b.grp.parent) b.grp.parent.remove(b.grp); }
    }
    rooms.length = 0;
  };
})();
