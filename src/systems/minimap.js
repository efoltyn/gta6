/* ============================================================
   systems/minimap.js — top-down radar in the corner: walls, guards
   (red when hunting), inmates by gang colour, the objective, and you
   as an arrow showing facing. Drawn to a small 2D canvas each frame.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const cv = document.getElementById("minimap");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;

  // world bounds → canvas (cover the whole enlarged compound)
  const WB = CBZ.WORLD || {};
  const X0 = (WB.minX != null ? WB.minX : -32) - 2, X1 = (WB.maxX != null ? WB.maxX : 32) + 2;
  const Z0 = (WB.minZ != null ? WB.minZ : -46) - 2, Z1 = (WB.maxZ != null ? WB.maxZ : 54) + 2;
  const sx = W / (X1 - X0), sz = H / (Z1 - Z0);
  const mx = (x) => (x - X0) * sx;
  const mz = (z) => (z - Z0) * sz;

  function objectivePos() {
    if (!CBZ.keycard.collected) return CBZ.keycard.group.position;
    if (!CBZ.door.open) return { x: 0, z: -8 };
    return CBZ.EXIT;
  }

  function dot(x, z, color, r) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(mx(x), mz(z), r || 2.2, 0, 7); ctx.fill();
  }

  /* ============================================================
     A PRISON MAP, NOT A COLLIDER DUMP.

     This drew EVERY entry in CBZ.colliders as a filled rectangle, and
     CBZ.colliders is not "walls" — it is every solid AABB in the world. A
     trash bag, a traffic cone, a bench, a bunk-room stool, a crate, the three
     colliders each cell face is built from and all twenty-five door leaves each
     got a `Math.max(1, …)` px stamp, so a 0.4 m cone weighed exactly as much
     on a 112x168 canvas as a 76 m perimeter wall. At 112 px across the whole
     compound that is not a map of anything: it is a grey field.

     Two facts already in the collider records separate structure from litter,
     and neither needs a new tag on anyone:

       · `pieceId` — systems/pieces.js stamps it on every collider it makes.
         A piece IS a prop (crates, tables, the yard furniture). Dropped.
       · HEIGHT — world/materials.js's addBox contract: a collider with no
         y-span is a full-height wall, one with y0/y1 is height-gated, and a
         mesh-backed collider knows its own box. Under 1.9 m is furniture you
         step over or round, never a thing that shapes a route. Dropped.

     What survives is classified by FOOTPRINT: a run of 2.2 m or more is a
     wall or a building and gets a filled rect; anything shorter that is still
     tall is a leaf, a jamb or a tower stilt and gets a 2 px mark. That is
     "doors as dots" for free — and doors OPEN as gaps for free too, because
     world/door.js, cellblock.setDoor, the armory gate and world/adminwing.js
     all splice their collider out of CBZ.colliders when they open. The map
     shows you which doors are shut because the shut ones are the only ones in
     the array.

     Cheap: the classification is O(n) and cached, re-derived only when the
     array LENGTH moves (which is exactly when a door opens or closes) — the
     same invalidation world/roofs.js uses for its fixture queue.
     ============================================================ */
  const MIN_TOP = 1.9;     // m — under this it is furniture, not architecture
  const WALL_SPAN = 2.2;   // m — the shortest run that reads as a wall
  let structure = [], leaves = [], seenLen = -1;

  function topOf(c) {
    if (c.y1 != null) return c.y1;
    const r = c.ref, p = r && r.geometry && r.geometry.parameters;
    if (p && p.height != null) return (r.position ? r.position.y : 0) + p.height / 2;
    return 99;             // no vertical contract at all = full-height wall
  }

  function classify() {
    const cols = CBZ.colliders || [];
    seenLen = cols.length;
    structure = []; leaves = [];
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || c.pieceId != null) continue;
      // off-map geometry (the city, when it has been built this session) is
      // not clipped by the canvas for free — every rect still costs a fill.
      if (c.maxX < X0 || c.minX > X1 || c.maxZ < Z0 || c.minZ > Z1) continue;
      if (topOf(c) < MIN_TOP) continue;
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      (Math.max(w, d) >= WALL_SPAN ? structure : leaves).push(c);
    }
  }

  let drawAcc = 0;
  CBZ.onUpdate(47, function (dt) {
    if (CBZ.game.mode !== "escape") return; // survival draws its own minimap
    drawAcc += dt;
    // redraw cadence rides the perf/quality slider — tier0 drops to 6Hz (canvas
    // repaints are pure CPU), Best (tier 4) keeps today's 12Hz exactly.
    const period = 1 / (CBZ.qScale ? CBZ.qScale(6, 12) : 12);
    if (drawAcc < period) return;            // radar does not need a 60 Hz redraw
    drawAcc %= period;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(10,18,30,.55)"; ctx.fillRect(0, 0, W, H);

    // walls and buildings, then the doors still shut across them
    if ((CBZ.colliders || []).length !== seenLen) classify();
    ctx.fillStyle = "rgba(186,196,208,.40)";
    for (let i = 0; i < structure.length; i++) {
      const c = structure[i];
      ctx.fillRect(mx(c.minX), mz(c.minZ), Math.max(1, (c.maxX - c.minX) * sx), Math.max(1, (c.maxZ - c.minZ) * sz));
    }
    ctx.fillStyle = "rgba(255,179,71,.62)";        // the admin-wing lock amber
    for (let i = 0; i < leaves.length; i++) {
      const c = leaves[i];
      ctx.fillRect(mx((c.minX + c.maxX) / 2) - 1, mz((c.minZ + c.maxZ) / 2) - 1, 2, 2);
    }

    // objective
    const o = objectivePos();
    dot(o.x, o.z, "#39ff88", 3.2);

    // inmates
    const GANG = ["#ff5b5b", "#5b8bff"];
    for (const n of CBZ.npcs) {
      if (n.escaped) continue;
      const col = n.dead ? "rgba(120,120,120,.5)" : (n.gang >= 0 ? GANG[n.gang] : "#d9d2c4");
      dot(n.group.position.x, n.group.position.z, col, n.dead ? 1.6 : 2);
    }
    // A light sample hints at the mass crowd without turning the radar into
    // noise or drawing hundreds of tiny canvas arcs every update.
    const ambient = CBZ.ambient;
    for (let i = 0; ambient && i < ambient.total; i += 18) {
      ambient.materialize(i, ambient.clock || 0);
      dot(ambient.posX[i], ambient.posZ[i], "rgba(217,210,196,.32)", 0.8);
    }
    // guards
    for (const g of CBZ.guards) {
      if (g.dead) continue;
      dot(g.group.position.x, g.group.position.z, g.hunt > 0 ? "#ff2a3a" : (g.corrupt ? "#b07aff" : "#ffd451"), 2.4);
    }
    const wp = CBZ.fullMap && CBZ.fullMap.waypoint();
    if (wp && CBZ.fullMap.trace) CBZ.fullMap.trace(ctx, mx, mz);
    if (wp) dot(wp.x, wp.z, "#7de7ff", 3.4);

    // player arrow
    const px = mx(CBZ.player.pos.x), pz = mz(CBZ.player.pos.z);
    const h = CBZ.playerChar.group.rotation.y;
    const ang = Math.atan2(Math.cos(h), Math.sin(h)); // (sin h, cos h) dir → screen angle
    ctx.save(); ctx.translate(px, pz); ctx.rotate(ang);
    ctx.fillStyle = "#ff7a1a";
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3.5, 3); ctx.lineTo(-3.5, -3); ctx.closePath(); ctx.fill();
    ctx.restore();
  });

  // The minimap lives TOP-LEFT now (the bottom-right is the interaction panel).
  // For the first ~2s of a run the objective text holds that spot, then it
  // cross-fades out and the radar fades in. (CSS owns the actual fade.)
  CBZ.onAlways(71, function () {
    const swap = CBZ.game.mode === "escape" && CBZ.game.state === "playing" && (CBZ.game.elapsed || 0) >= 2;
    document.body.classList.toggle("show-minimap", swap);
  });
})();
