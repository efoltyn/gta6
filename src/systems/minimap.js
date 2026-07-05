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

    // walls (LOS blockers approximate the layout well)
    ctx.fillStyle = "rgba(180,190,200,.35)";
    for (const c of CBZ.colliders) {
      ctx.fillRect(mx(c.minX), mz(c.minZ), Math.max(1, (c.maxX - c.minX) * sx), Math.max(1, (c.maxZ - c.minZ) * sz));
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
