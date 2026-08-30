/* ============================================================
   city/facades/printed.js — "Printed Shell": extruded in place.

   THE READ. This building was not assembled, it was PRINTED: a nozzle went
   round and round the plan laying a bead of concrete on the bead below, and
   every visible thing about it follows from that one fact.

     PRINT-BEAD COURSES  the entire elevation is horizontal layer lines,
                         unbroken all the way round — no bay, no storey, no
                         corner interrupts them. They are the ONLY texture on
                         the building and there are two hundred of them, so
                         the course loop is the whole cost of this facade and
                         everything else is kept cheap on purpose.
     A SWELLING WALL     each course stands a little further out or in than
                         the one under it (extAt), so the shaft visibly swells
                         and waists as it rises and tapers to its top. A
                         printed wall that came out plumb would just be a box
                         with stripes on it — the wobble IS the grammar.
     NO VERTICAL EDGE    the plan is LOBED: a cross of two boxes chamfers
                         every corner (so the corner reads round, never as an
                         arris) and a bulge runs the full height of each face
                         centre. Nothing on this building is a straight
                         vertical line, which is what separates it at a
                         kilometre from every other tower in the kit.
     PRINTED OPENINGS    the windows are HOLES LEFT IN THE PRINT, so they are
                         round-topped: a nozzle cannot lay a flat lintel, it
                         corbels the bead inward until the hole closes. Three
                         stepped courses over each opening say exactly that.

   WALL "own" — a printed shell has no curtain wall, so the shell hands over
   solid wall with no glazing and this file draws every opening itself. That
   is also why the openings are drawn rather than left as gaps in the courses:
   the courses are full-plan rings, and a ring you can't cut is a ring you
   plug — the opening box stands just proud of the bead line and reads as the
   hole, which is what the eye is actually reading anyway.

   THE PROFILE IS ONE FUNCTION. extAt(y) is how far the print stands outside
   the shell's own wall plane, and it never returns less than the wobble
   amplitude — if it did, the grey shell box would poke out through its own
   cladding and the tower would grow a hard vertical edge.

   SOLIDITY: the four face-centre lobes are the mass a player meets at the
   pavement, so their bottom courses go through F.solid. The door face's lobe
   is centred on the doorway; sbox drops that collider itself (buildings.js
   sboxAtDoor) and the kit carves the drawing, so the entrance stays a hole in
   an otherwise unbroken wall.

   COST: no meshes at all, and the course loop is 7 boxes per bead — a cross,
   a chamfer ring and four lobes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("printed", {
    label: "Printed Shell",
    era: "future",
    // city/collapse.js MATERIALS — printed concrete, mass not frame.
    structure: "concrete",
    wall: "own",
    minStoreys: 14,
    build: function (ctx, F) {
      const FH = ctx.FH, H = ctx.rTop, unit = Math.min(ctx.w, ctx.d);
      const h = function (s) { return ctx.hash(s); };
      const P = F.palette(ctx, "concrete", { pull: 0.62, grain: 0.10 });
      const S = F.solid(ctx), dark = F.shade(P.base, 0.80);

      // ---- A. THE PROFILE. One function, and everything measures off it.
      // e0 is the flare at the foot (a printed wall is thickest where the
      // print started); the sine is the swell and waist; the floor keeps the
      // print outside the shell box at every height, which is what stops a
      // grey vertical corner appearing through it.
      const ch = clamp(FH * 0.20, 0.38, 0.68);            // one bead
      const e0 = clamp(Math.min(unit * 0.11, H * 0.030), 0.5, 3.4), sw = clamp(Math.min(unit * 0.045, H * 0.012), 0.22, 1.40);
      const wa = clamp(unit * 0.010, 0.08, 0.26);         // how far each course wanders
      const ph = h(0x9f01) * 6.28, waves = 2 + ((h(0x9f02) * 3) | 0);
      const extAt = function (y) {
        const u = clamp(y / H, 0, 1);
        return wa + clamp(Math.min(unit * 0.05, H * 0.014), 0.28, 1.4) + e0 * (1 - u) * (1 - u) + sw * (0.5 + 0.5 * Math.sin(u * Math.PI * waves + ph));
      };

      // ---- B. THE COURSES. A cross of two boxes leaves a chamfer at all four
      // corners (c ≤ e, so the shell corner is always still covered), the
      // third box halves that chamfer into an octagon, and the four lobes are
      // the bulge running up each face centre. The bottom courses are SOLID:
      // that is the mass at the pavement.
      const n = Math.max(6, Math.ceil(H / ch));
      for (let k = 0; k < n; k++) {
        const y = (k + 0.5) * ch, e = extAt(y), c = e * 0.85, col = P.course(k);
        const hx = ctx.w / 2 + e, hz = ctx.d / 2 + e;
        const cx = Math.sin(y / (H * 0.21) + ph) * wa, cz = Math.cos(y / (H * 0.17) + ph * 1.7) * wa;
        const bh = ch * 1.04, E = y < 2.9 ? S : ctx.dbox;
        ctx.dbox(cx, y, cz, hx * 2, bh, (hz - c) * 2, col);
        ctx.dbox(cx, y, cz, (hx - c) * 2, bh, hz * 2, col);
        ctx.dbox(cx, y, cz, (hx - c * 0.5) * 2, bh, (hz - c * 0.5) * 2, k % 2 ? col : F.shade(col, 0.94));
        for (const f of F.faces(ctx)) {                   // the four lobes, each stepped so it reads round
          const sp = f.horiz ? ctx.w : ctx.d, lo = e * 1.05, nn = (f.horiz ? hz : hx);
          for (const q of [[sp * 0.56, lo * 0.55], [sp * 0.30, lo]]) {
            if (f.horiz) E(cx, y, cz + f.out * (nn + q[1] * 0.5), q[0], bh, q[1] * 1.7, col);
            else E(cx + f.out * (nn + q[1] * 0.5), y, cz, q[1] * 1.7, bh, q[0], col);
          }
        }
      }

      // ---- C. THE OPENINGS: holes left in the print, corbelled shut at the
      // top because a nozzle cannot lay a lintel. Two storeys apart — at 130 m
      // a per-storey window row is invisible and costs four thousand boxes.
      // The five tangent SLOTS are keyed to the lobe steps, not to a bay
      // count: an opening that straddled the edge of a bulge would be half
      // buried in it, and how deep the hole is punched depends on which step
      // of the lobe it lands on.
      const oh = FH * 1.15, step = FH * 2;
      const slots = [[0, 1.0], [-0.215, 0.55], [0.215, 0.55], [-0.39, 0], [0.39, 0]];
      for (const f of F.faces(ctx)) {
        const ow = clamp(f.span * 0.11, 1.5, 3.4);
        for (let y = FH * 1.25; y + oh + 1.2 < H; y += step) {
          const e = Math.max(extAt(y), extAt(y + oh));
          for (const sl of slots) {
            const t = sl[0] * f.span, pr = e * (1 + 1.05 * sl[1]) + 0.12;
            if (y < 4.6 && !F.clearsDoor(ctx, f, t, ow + 1.0)) continue;
            const lit = h(0x9f40 + f.s * 31 + ((y * 3) | 0) + sl[0] * 10) < 0.34;
            F.box(ctx, f, t, y + oh / 2, ow, oh, pr, lit ? F.mix(P.glass, 0xffd9a0, 0.55) : P.glass);
            for (let i = 0; i < 3; i++) {                 // the corbelled head
              const u = (i + 0.5) / 3;
              F.box(ctx, f, t, y + oh + u * ow * 0.42, ow * Math.sqrt(1 - u * u), ow * 0.16, pr, dark);
            }
            F.box(ctx, f, t, y - 0.10, ow * 0.94, 0.20, pr + 0.10, dark);   // the sill bead
          }
        }
      }

      // ---- D. THE TOP. The print does not stop, it closes: three courses
      // stepping IN over the roofline, so the shaft reads as a tapering
      // organic form that was terminated rather than a tube that was cut off.
      for (let i = 0; i < 3; i++) {
        const e = extAt(H) * (1 - i * 0.22) + 0.12, y = H + i * ch * 1.1 + ch * 0.55;
        ctx.dbox(0, y, 0, (ctx.w / 2 + e) * 2, ch * 1.1, (ctx.d / 2 + e - i * 0.4) * 2, P.course(n + i));
        ctx.dbox(0, y, 0, (ctx.w / 2 + e - i * 0.4) * 2, ch * 1.1, (ctx.d / 2 + e) * 2, P.course(n + i));
      }
    },
  });
})();
