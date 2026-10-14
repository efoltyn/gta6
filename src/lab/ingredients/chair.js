/* lab ingredient "chair": the game's own chair, as the game builds a loose one.

   city/furniture.js CBZ.furnish.chair(x, y, z, yaw, {loose}) draws the chair
   at real metric proportions, registers its city/propuse.js seat anchor where
   it stands, and (with `loose`) hands it to systems/pushables.js as a piece:
   one collider over its footprint, slides when walked into, tips when run
   into or hit by a car, its seat rides along and stops being a seat while it
   lies on its back. Nothing here draws or moves a chair.

   opts: at [x, z], yaw (deg, the way the seat faces), kind chair|taskChair|stool,
         tone (furniture palette)
   state(): position, yaw, tipped, sliding speed, the seat's occupant */
CBZ.lab.ingredient("chair", {
  files: ["src/city/furniture.js", "src/systems/pushables.js", "src/city/propuse.js", "src/systems/rest.js"],
  make: function (W, o) {
    const THREE = window.THREE;
    const at = o.at || [0, 0];
    const yaw = (o.yaw || 0) * Math.PI / 180;
    const kind = o.kind || "chair";
    const host = W.root || (W.root = (function () { const g = new THREE.Group(); g.name = "labHost"; W.scene.add(g); return g; })());
    const ledger = W.ledger || (W.ledger = []);
    const F = CBZ.furnish;
    if (!F || !F[kind]) throw new Error("CBZ.furnish." + kind + " missing (city/furniture.js not loaded or FURNISH_KIT off)");
    const rec = F[kind](at[0], 0, at[1], yaw, {
      loose: { parent: host, ledger: ledger, owner: "lab", mode: (CBZ.game && CBZ.game.mode) || "lab" },
      tone: o.tone,
    });
    const piece = rec && rec.loose;
    const seat = rec && rec.seats && rec.seats[0] && rec.seats[0].rec;
    if (!piece) W.event(o.name, "WARNING: not a loose piece (systems/pushables.js absent or PUSH_PROPS_V1 off): static chair");
    const x0 = at[0], z0 = at[1];
    const h = {
      rec: rec, piece: piece, seat: seat,
      obj: piece && piece.pool ? piece.pool.mesh : null,
      pos: function () { return piece ? { x: piece.ux != null ? piece.ux : piece.x, z: piece.uz != null ? piece.uz : piece.z } : { x: x0, z: z0 }; },
      moved: function () { const p = h.pos(); return Math.hypot(p.x - x0, p.z - z0); },
      tipped: function () { return !!(piece && piece.tipS); },
      state: function () {
        const p = h.pos();
        return {
          pos: [L(p.x), 0, L(p.z)], moved: L(h.moved()),
          yawDeg: piece ? L((piece.yaw || 0) * 180 / Math.PI) : (o.yaw || 0),
          tipped: h.tipped(), tipDeg: piece ? L((piece.tipA || 0) * 180 / Math.PI) : 0,
          speed: piece ? L(Math.hypot(piece.vx || 0, piece.vz || 0)) : 0,
          seat: seat ? { occupant: seat.occupant ? (seat.occupant.labName || "someone") : null, tipped: !!seat.tipped } : null,
          collider: piece && piece.col ? [L(piece.col.minX), L(piece.col.maxX), L(piece.col.minZ), L(piece.col.maxZ), L(piece.col.y1 || 0)] : null,
        };
      },
      watch: {
        tipped: function () { return h.tipped() ? (piece.tipS === 2 ? "lying" : "falling") : "upright"; },
        moving: function () { return piece && Math.hypot(piece.vx || 0, piece.vz || 0) > 0.05 ? "sliding" : "still"; },
        seat: function () { return seat && seat.occupant ? "taken by " + (seat.occupant.labName || "someone") : "free"; },
      },
    };
    // a box the camera can frame even before the pool has bounds
    if (!h.obj) h.obj = null;
    return h;
    function L(v) { return Math.round(v * 1000) / 1000; }
  },
});
