/* ============================================================
   city/facades/gothic.js — "Gothic Revival": the pointed civic hall front.

   WHAT IS BEING MODELLED. The 19th-century Gothic Revival town hall and
   cathedral front (Manchester Town Hall, the Palace of Westminster, Trinity
   Church): a masonry SKELETON rather than a masonry wall. Load is gathered
   into buttresses and thrown to the ground; everything between them is
   dissolved into glass. The whole grammar is one instruction repeated at
   every scale - GO UP AND END IN A POINT. Arches point, gables point,
   buttresses die into pinnacles that point, and the parapet is notched so
   even the roofline refuses to be a horizontal line. A Gothic building with
   a flat, quiet top is a warehouse with lancet windows painted on it.

   WHY EACH ELEMENT IS HERE.
     PLINTH      a battered dark ground course. Buttresses must land on
                 something; without it they look pushed into the pavement.
     BUTTRESSES  one at every bay line and at all four corners, projecting
                 DEEPLY and stepping back in 2-4 diminishing stages. Each
                 stage dies into a sloped weathering course (a stepped run of
                 boxes whose projection shrinks as it rises) which is how real
                 masonry sheds water. The deep projection is the point: it is
                 what casts the vertical shadow bands that make the elevation
                 read as structure and not as pattern.
     PINNACLES   a slender shaft with corner colonnettes, a capital, and a
                 stepped spirelet hung with crockets, standing on every
                 buttress head. These are the silhouette. At 200 m the windows
                 are gone and the pinnacles are the only thing saying Gothic.
     LANCETS     tall, narrow pointed windows in every bay, dark leaded glass,
                 slim jambs, a sill, and a HOOD MOULD arching over the head -
                 the projecting drip that gives every opening its shadow.
     TRACERY     inside each window head: a central mullion that splits into a
                 Y, two pointed sub-lights beneath, and a quatrefoil (four
                 small blocks about a hub) in the spandrel of the head. Read
                 as texture at distance, as craft up close.
     SHAFTS      a slim vertical reveal riding the bay centre through every
                 floor line, so storeys never chop the elevation into layers.
     ROSE        a wheel window on the entrance face over the portal:
                 concentric rings of small blocks with radiating spokes over a
                 field of dark glass. The one circle in a building of points,
                 which is exactly why it is the focus.
     PORTAL      three receding orders of pointed arch, each carried on a slim
                 shaft, around a dark tympanum, under a steep gabled hood with
                 its own crockets and finial. The deep reveal is the drama.
     PARAPET     notched merlons with capped heads plus gargoyle waterspouts
                 jutting at every buttress head, because a Gothic roofline is
                 where the water leaves the building and it is never hidden.

   Every dimension derives from ctx.w / ctx.d / ctx.storeys / ctx.FH /
   ctx.rTop or a face span. An 11 m one-storey shop gets two-stage buttresses,
   short lancets and no rose (there is no wall left for one); a 40 m
   eight-storey block gets four stages, a full lancet grid and a wheel window.

   MESH BUDGET: everything here is ctx.dbox. Not one real mesh is minted -
   the sloped members (weatherings, spire, gable) are all stepped box runs, so
   a Gothic building costs the same draw calls as a bare one.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // world-local x/z of a point sitting off metres out from face f at
  // tangent t. Buttress heads carry pinnacles, and a pinnacle is easier to
  // stack in plain local coordinates than through the face helpers.
  function onFace(ctx, f, t, off) {
    return f.horiz ? { x: t, z: f.out * (f.halfN + off) }
                   : { x: f.out * (f.halfN + off), z: t };
  }

  CBZ.registerFacade("gothic", {
    label: "Gothic Revival",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const W = ctx.w, D = ctx.d, FH = ctx.FH, ST = Math.max(1, ctx.storeys);
      const unit = Math.min(W, D);          // the building's own scale ruler
      const H = ctx.rTop;                   // wall height to be dressed

      // ---- palette: weathered grey-buff limestone + dark leaded glass ----
      const C = {};
      C.stone = F.mix(ctx.color, 0xbdb096, 0.68);
      C.light = F.mix(C.stone, 0xffffff, 0.18);   // sunlit dressings
      C.dark = F.shade(C.stone, 0.54);            // deep reveals
      C.deep = F.shade(C.stone, 0.36);            // the deepest orders
      C.plinth = F.shade(ctx.color, 0.46);
      // leaded glass reads DARK from outside, with a faint warm cast from the
      // painted glass behind it. Never blue - that is a curtain wall.
      C.glass = F.mix(0x1b1712, 0x33241a, 0.35 + ctx.hash(0x60a1) * 0.25);

      // ---- the ruling grid ----------------------------------------
      const PJb = clamp(unit * 0.085, 0.5, 1.9);      // BUTTRESS projection: deep
      const PJw = clamp(unit * 0.022, 0.14, 0.42);    // window dressing relief
      const plinthH = clamp(FH * 0.24, 0.45, 1.3);
      const e = F.entrance(ctx);

      // the portal: sized off the door requirement, then forced tall enough
      // that its head can never hang in front of the doorway.
      const portW = clamp(e.gap * 1.6, unit * 0.26, Math.min(W, D) * 0.58);
      const portH = Math.max(e.head + 0.4, clamp(FH * 1.35, 2.4, H * 0.80));
      const gableH = portW * 0.46;                    // the steep hood over it

      // ============================================================
      //  1. PLINTH — the ground course every buttress lands on
      // ============================================================
      F.ring(ctx, plinthH / 2, plinthH, PJb * 0.42, C.plinth, 0.26);
      F.ring(ctx, plinthH + 0.09, 0.18, PJb * 0.52, C.dark, 0.34);

      // ============================================================
      //  2. THE WALL — lancets, tracery, shafts, string courses
      // ============================================================
      const faces = F.faces(ctx);
      const plan = [];                     // remembered so §3 reuses the rhythm
      for (const f of faces) {
        const per = clamp(unit * 0.30, 2.7, 4.6);
        const n = F.bayCount(f, per, 2, 8);
        const marg = clamp(f.span * 0.06, 0.3, 1.1);
        const lines = F.bayLines(f, n, marg);
        const bays = F.bays(f, n, marg);
        const step = lines.length > 1 ? (lines[1] - lines[0]) : f.span;
        const bw = clamp(step * 0.30, 0.4, step * 0.42);   // buttress width
        plan.push({ f: f, n: n, marg: marg, lines: lines, bays: bays, step: step, bw: bw });

        // --- a string course at every floor line, under the sills. Drawn
        // before the buttresses so the buttresses ride over it, which is what
        // real masonry does.
        for (let s = 1; s <= ST; s++) {
          const y = s * FH;
          if (y > H - 0.2) continue;
          F.band(ctx, f, y - FH * 0.10, clamp(FH * 0.07, 0.12, 0.3), PJb * 0.30, C.light, 0.2);
        }

        // --- the lancets, one per bay per storey ---------------------
        // NARROW is the whole point: a lancet is roughly 1:2.5, never a square
        const winW = clamp(step * 0.26, 0.42, step * 0.34);
        for (const b of bays) {
          for (let s = 0; s < ST; s++) {
            const y0 = s * FH + clamp(FH * 0.18, 0.35, 0.9);
            const top = (s + 1) * FH - clamp(FH * 0.07, 0.14, 0.4);
            const hgt = top - y0;
            if (hgt < FH * 0.35) continue;
            // the entrance bay's ground storey belongs to the portal, and on
            // the door face the rose owns the wall above it.
            if (!F.clearsDoor(ctx, f, b.t, winW + PJw * 4)) {
              if (y0 < portH + gableH + 0.4) continue;
            }
            lancet(ctx, F, f, b.t, y0, winW, hgt, PJw, C);
          }
          // the vertical shaft that carries the bay past every floor line
          F.rib(ctx, f, b.t, plinthH, H, clamp(winW * 0.13, 0.1, 0.3), PJw * 0.9, C.light);
        }
      }

      // ============================================================
      //  3. THE BUTTRESSES — deep, stepping back, weathered at each stage
      // ============================================================
      const stages = ST >= 6 ? 4 : (ST >= 3 ? 3 : 2);
      const heads = [];                    // where the pinnacles will stand
      for (const p of plan) {
        const f = p.f;
        for (let i = 1; i < p.lines.length - 1; i++) {   // ends are corners
          const t = p.lines[i];
          if (!F.clearsDoor(ctx, f, t, p.bw)) continue;
          const top = buttress(ctx, F, f, t, plinthH, H, p.bw, PJb, stages, C);
          heads.push({ f: f, t: t, y: top, bw: p.bw, proj: PJb });
        }
      }
      // CORNER BUTTRESSES: present on both meeting faces, so no corner of the
      // building is ever a bare arris.
      {
        const cw = clamp(unit * 0.13, 0.7, 2.4);
        let y = plinthH;
        const sh = (H - plinthH) / stages;
        for (let i = 0; i < stages; i++) {
          const pj = PJb * (1 - i * 0.20);
          const len = cw * (1 - i * 0.10);
          F.corners(ctx, y + sh / 2, sh, len, pj, i % 2 ? C.stone : C.light);
          // the weathering: three courses whose projection shrinks as they
          // rise, which is a slope drawn out of axis-aligned boxes.
          for (let k = 0; k < 3; k++) {
            const wy = y + sh + k * 0.13;
            F.corners(ctx, wy, 0.14, len * (1 - k * 0.06), pj * (1 - (k + 1) * 0.22), C.light);
          }
          y += sh + 0.42;
        }
      }

      // ============================================================
      //  4. THE ROSE WINDOW — over the portal on the entrance face
      // ============================================================
      {
        const f = e.f;
        const headY = portH + gableH + 0.5;
        const room = H - headY;
        const R = Math.min(clamp(f.span * 0.17, 0.9, 4.2), room * 0.40);
        if (R > 0.8 && room > 2.4) {
          rose(ctx, F, f, 0, headY + room * 0.52, R, PJw, C);
        }
      }

      // ============================================================
      //  5. THE PORTAL — three receding orders under a gabled hood
      // ============================================================
      {
        const f = e.f;
        const jw = clamp(portW * 0.11, 0.2, 0.75);       // one order's thickness
        const rise = portW * 0.62;
        const body = Math.max(0.5, portH - rise);
        // the tympanum: a dark carved field filling the head behind the orders
        F.box(ctx, f, 0, body + rise * 0.34, portW * 0.86, rise * 0.62, PJw * 0.5, C.deep);
        F.box(ctx, f, 0, body * 0.55, portW * 0.86, body * 0.9, PJw * 0.5, C.deep);
        for (let i = 2; i >= 0; i--) {
          const hw = portW / 2 + jw * i;                 // each order steps outward
          const pj = PJb * (0.42 + i * 0.30);            // …and stands further proud
          const col = i === 0 ? C.deep : (i === 1 ? C.dark : C.light);
          for (const sg of [-1, 1]) {
            F.rib(ctx, f, sg * (hw + jw / 2), 0, body, jw, pj, col);
            // the slim shaft carrying the order, with a ring capital
            F.rib(ctx, f, sg * (hw + jw / 2), plinthH * 0.6, body - 0.18, jw * 0.52, pj * 1.14, C.light);
            F.box(ctx, f, sg * (hw + jw / 2), body - 0.08, jw * 1.15, 0.18, pj * 1.2, C.light);
          }
          F.arch(ctx, f, 0, body, hw * 2, rise + jw * i * 0.8, jw * 0.55, pj, col, "pointed");
        }
        // THE GABLE: a steep stepped hood, crocketed, with a finial. This is
        // what turns a doorway into a portal.
        const gw = portW + jw * 7;
        const gsteps = 6;
        for (let k = 0; k < gsteps; k++) {
          const u = (k + 0.5) / gsteps;
          const lw = gw * (1 - u);
          const gy = portH + rise * 0.12 + u * gableH;
          F.box(ctx, f, 0, gy, lw + jw * 1.2, gableH / gsteps + 0.03, PJb * 0.66, C.light);
          if (k % 2 === 0 && lw > jw * 2) {
            for (const sg of [-1, 1])
              F.box(ctx, f, sg * (lw / 2 + jw * 0.5), gy + gableH / gsteps * 0.5,
                jw * 0.7, jw * 0.55, PJb * 0.8, C.stone);   // crockets on the slope
          }
        }
        F.rib(ctx, f, 0, portH + rise * 0.12 + gableH, portH + rise * 0.12 + gableH + gableH * 0.30,
          jw * 0.55, PJb * 0.8, C.light);                    // the finial
      }

      // ============================================================
      //  6. PARAPET, MERLONS, GARGOYLES
      // ============================================================
      // the parapet is a crown, not a storey: on a one-storey chapel it must
      // stay a fraction of the wall it stands on.
      const parH = clamp(FH * 0.42, 0.55, Math.min(2.0, Math.max(0.7, H * 0.24)));
      const parT = clamp(unit * 0.035, 0.22, 0.7);
      F.parapet(ctx, parH, parT, C.stone, C.light);
      for (const p of plan) {
        const f = p.f;
        const mn = Math.max(3, p.n * 2);
        const mw = clamp(f.span / (mn * 2.3), 0.2, 0.9);
        F.merlons(ctx, f, ctx.rTop + parH * 0.72, mn, mw, parH * 1.5, parT * 1.25, C.stone);
        F.merlons(ctx, f, ctx.rTop + parH * 1.5, mn, mw * 1.35, 0.14, parT * 1.5, C.light);
        // blind tracery panelling in the parapet: a little pointed arcade
        for (const b of F.bays(f, mn, 0.2))
          F.arch(ctx, f, b.t, ctx.rTop + parH * 0.30, b.w * 0.5, parH * 0.42,
            0.06, parT * 1.35, C.dark, "pointed");
      }
      // GARGOYLES: waterspouts jutting from every buttress head.
      // A spout throws water clear of the wall, not of the street: its reach is
      // tied to its OWN thickness, or a deep-buttressed block grows scaffolding.
      for (const hd of heads) {
        const g1 = Math.min(hd.proj * 1.2, hd.bw * 1.5);
        F.box(ctx, hd.f, hd.t, ctx.rTop + parH * 0.55, hd.bw * 0.42, hd.bw * 0.34, g1, C.dark, -hd.proj * 0.15);
        F.box(ctx, hd.f, hd.t, ctx.rTop + parH * 0.62, hd.bw * 0.24, hd.bw * 0.2, g1 * 1.35, C.deep, -hd.proj * 0.15);
      }

      // ============================================================
      //  7. PINNACLES — the silhouette
      // ============================================================
      // …and a pinnacle may never out-measure the wall that carries it.
      const pinH = clamp(FH * 1.25, 1.2, Math.max(1.4, H * 0.42));
      for (const hd of heads) {
        const base = clamp(hd.bw * 0.62, 0.24, 1.3);
        const q = onFace(ctx, hd.f, hd.t, hd.proj * 0.45);
        pinnacle(ctx, q.x, q.z, Math.max(hd.y, ctx.rTop + parH * 0.4), base, pinH, C);
      }
      // the four corner pinnacles, taller: the corners of a Gothic tower are
      // always the strongest accents on the skyline.
      {
        const cw = clamp(unit * 0.13, 0.7, 2.4);
        const base = clamp(cw * 0.58, 0.26, 1.5);
        const off = PJb * 0.34;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          pinnacle(ctx, sx * (W / 2 - cw * 0.35 + off), sz * (D / 2 - cw * 0.35 + off),
            ctx.rTop + parH * 0.5, base, pinH * 1.32, C);
        }
      }
    },
  });

  // ------------------------------------------------------------------
  // A STEPPED BUTTRESS. Deep at the bottom, stepping back in stages, each
  // stage dying into a weathering course whose projection shrinks course by
  // course - a slope made of axis-aligned boxes. Returns the head height.
  // ------------------------------------------------------------------
  function buttress(ctx, F, f, t, y0, H, wid, proj, stages, C) {
    const span = H - y0;
    if (span <= 0) return y0;
    const sh = span / stages;
    let y = y0;
    for (let i = 0; i < stages; i++) {
      const pj = proj * (1 - i * 0.20);
      const w = wid * (1 - i * 0.09);
      F.rib(ctx, f, t, y, y + sh, w, pj, i % 2 ? C.stone : C.light);
      // a slim recessed reveal down the buttress face, so it is not a plank
      F.rib(ctx, f, t, y + 0.1, y + sh - 0.1, w * 0.30, pj * 1.06, C.dark);
      // the weathering: three shrinking courses at the setback
      for (let k = 0; k < 3; k++) {
        F.box(ctx, f, t, y + sh + k * 0.13, w * (1 - k * 0.05), 0.14,
          pj * (1 - (k + 1) * 0.22), C.light);
      }
      y += sh + 0.42;
    }
    return y;
  }

  // ------------------------------------------------------------------
  // A PINNACLE: plinth, shaft with corner colonnettes, capital, stepped
  // spirelet with crockets, finial. Local coordinates, all dbox.
  // ------------------------------------------------------------------
  function pinnacle(ctx, x, z, y, base, h, C) {
    ctx.dbox(x, y + base * 0.30, z, base * 1.5, base * 0.6, base * 1.5, C.stone);
    let sy = y + base * 0.6;
    const shaftH = h * 0.38;
    ctx.dbox(x, sy + shaftH / 2, z, base, shaftH, base, C.light);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      ctx.dbox(x + sx * base * 0.48, sy + shaftH / 2, z + sz * base * 0.48,
        base * 0.28, shaftH, base * 0.28, C.stone);
    }
    sy += shaftH;
    ctx.dbox(x, sy + base * 0.11, z, base * 1.45, base * 0.22, base * 1.45, C.light);
    sy += base * 0.22;
    // the spirelet: a stepped taper to a point, crocketed on the way up
    const steps = 6, ssh = (h * 0.52) / steps;
    let sw = base * 1.1;
    for (let i = 0; i < steps; i++) {
      ctx.dbox(x, sy + ssh / 2, z, sw, ssh, sw, i % 2 ? C.stone : C.light);
      if (i % 2 === 0) {
        for (const sg of [-1, 1]) {
          ctx.dbox(x + sg * sw * 0.62, sy + ssh * 0.75, z, sw * 0.34, ssh * 0.42, sw * 0.34, C.stone);
          ctx.dbox(x, sy + ssh * 0.75, z + sg * sw * 0.62, sw * 0.34, ssh * 0.42, sw * 0.34, C.stone);
        }
      }
      sy += ssh; sw *= 0.70;
    }
    ctx.dbox(x, sy + base * 0.24, z, base * 0.20, base * 0.48, base * 0.20, C.light);
  }

  // ------------------------------------------------------------------
  // A LANCET: dark leaded glass, jambs, sill, pointed head, hood mould, and
  // the tracery (mullion, Y split, two sub-lights, a quatrefoil) that turns a
  // slot into a window.
  // ------------------------------------------------------------------
  function lancet(ctx, F, f, t, y0, wid, h, PJ, C) {
    const rise = Math.min(wid * 1.05, h * 0.44);
    const body = h - rise;
    const gp = PJ * 0.34, jp = PJ * 1.25;
    const jw = clamp(wid * 0.16, 0.1, 0.42);
    const mw = clamp(wid * 0.10, 0.07, 0.26);

    // --- the glass field, body then pointed head ---
    F.rib(ctx, f, t, y0, y0 + body, wid, gp, C.glass);
    for (let i = 0; i < 4; i++) {
      const u = (i + 0.5) / 4;
      F.box(ctx, f, t, y0 + body + u * rise, Math.max(0.1, wid * (1 - u)), rise / 4 + 0.02, gp, C.glass);
    }
    // --- jambs, sill, the arch itself, and the hood mould over it ---
    for (const sg of [-1, 1]) F.rib(ctx, f, t + sg * (wid / 2 + jw / 2), y0 - 0.05, y0 + body, jw, jp, C.light);
    F.box(ctx, f, t, y0 - 0.14, wid + jw * 3, 0.16, jp * 1.25, C.light);
    F.arch(ctx, f, t, y0 + body, wid, rise, jw * 0.5, jp, C.light, "pointed");
    F.arch(ctx, f, t, y0 + body + 0.1, wid + jw * 1.4, rise * 1.02, jw * 0.6, jp * 1.35, C.stone, "pointed");
    // --- TRACERY -------------------------------------------------
    F.rib(ctx, f, t, y0, y0 + body + rise * 0.20, mw, jp * 0.95, C.light);      // mullion
    // below this width the sub-lights and the quatrefoil stop being tracery
    // and become a smear of stone: a narrow lancet is honestly a single light.
    if (wid < 0.85) return;
    for (const sg of [-1, 1]) {
      // the Y: three short members stepping out and up from the mullion head
      for (let k = 0; k < 3; k++) {
        F.box(ctx, f, t + sg * wid * (0.06 + k * 0.07), y0 + body + rise * (0.20 + k * 0.09),
          mw, rise * 0.11, jp * 0.95, C.light);
      }
      // a pointed sub-light under each arm of the Y
      F.arch(ctx, f, t + sg * wid * 0.24, y0 + body - rise * 0.02, wid * 0.36, rise * 0.30,
        mw * 0.5, jp * 0.85, C.light, "pointed");
    }
    // the quatrefoil in the head: four lobes about a hub
    const qy = y0 + body + rise * 0.66, qr = Math.max(0.07, wid * 0.15);
    for (const o of [[-1, 0], [1, 0], [0, -1], [0, 1]])
      F.box(ctx, f, t + o[0] * qr, qy + o[1] * qr, qr * 0.9, qr * 0.9, jp * 1.05, C.light);
    F.box(ctx, f, t, qy, qr * 0.55, qr * 0.55, jp * 1.15, C.dark);
  }

  // ------------------------------------------------------------------
  // A ROSE WINDOW: a field of dark glass cut to a circle out of horizontal
  // courses, two concentric rings of small blocks, radiating spokes, a hub.
  // Cheaper than a disc mesh and it reads as a wheel from the street.
  // ------------------------------------------------------------------
  function rose(ctx, F, f, t, cy, R, PJ, C) {
    const gp = PJ * 0.34, sp = PJ * 1.3;
    // glass, as courses whose width follows the circle
    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const v = ((i + 0.5) / rows) * 2 - 1;                 // -1..1
      const hw = R * 0.94 * Math.sqrt(Math.max(0, 1 - v * v));
      if (hw < 0.06) continue;
      F.box(ctx, f, t, cy + v * R * 0.94, hw * 2, (R * 1.88) / rows + 0.02, gp, C.glass);
    }
    // spokes: eight radial mullions, each three short blocks out from the hub
    const spokes = 8;
    for (let s = 0; s < spokes; s++) {
      const a = (s / spokes) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let k = 0; k < 3; k++) {
        const r = R * (0.26 + k * 0.24);
        F.box(ctx, f, t + ca * r, cy + sa * r, R * 0.15, R * 0.15, sp, C.light);
      }
    }
    // two rings of small blocks: the outer moulding and the inner wheel
    for (const spec of [[R, 20, 0.17, C.light], [R * 0.55, 12, 0.13, C.stone]]) {
      const rr = spec[0], nn = spec[1], sz = spec[2] * R, col = spec[3];
      for (let i = 0; i < nn; i++) {
        const a = (i / nn) * Math.PI * 2;
        F.box(ctx, f, t + Math.cos(a) * rr, cy + Math.sin(a) * rr, sz, sz,
          rr === R ? sp * 1.2 : sp, col);
      }
    }
    F.box(ctx, f, t, cy, R * 0.24, R * 0.24, sp * 1.3, C.light);   // the hub
  }
})();
