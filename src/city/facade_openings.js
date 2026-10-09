/* ============================================================
   city/facade_openings.js — THE ONE WINDOW AND THE ONE DOOR.

   OWNER: "Every single building in the game should expose real windows and
   have real doors. Many, like townhouses, mess this up, and some facades
   flicker because of overlap with the building structure."

   What was wrong, measured by tools/facade-census.mjs before this file:
     • 31 facade grammars paint their windows as DARK BOXES laid over the
       shell's real glass. On a dressed Gang City street 1,091 of 1,373
       openings were covered: glass behind a painted panel.
     • The shell drew a window as a hole PLUS a stack of liners and trim laid
       on the same planes as the wall round it (reveal liners on the sill and
       head planes, a stone sill sunk 3 cm into the spandrel, corner wall
       boxes that overlap): 2,000-9,000 coplanar face pairs per building, the
       flicker.
     • Three generators had three window systems (buildings.js glazeOpening,
       world/disaster_arena.js glazeBuilding with polygonOffset ranks, the
       metro's painted cells) and no door anywhere had a step, a light or a
       number.

   This file is the ONE vocabulary every generator now builds a window and a
   door from. It knows nothing about scenes, colliders or pools: a host hands
   it an EMITTER and it emits boxes, panes and lamps in building-local metres.

     E.dbox(x, y, z, w, h, d, col)       opaque trim (merged per colour)
     E.glass(x, y, z, w, h, d, o)         one breakable pane (o: {tint, kind})
     E.glow(x, y, z, w, h, nrm, o)        the lit room behind a window (optional)
     E.lamp(x, y, z, w, h, d, col)        a self-lit fitting (optional)
     E.number(x, y, z, nrm, text, h)      a house number (optional)
     E.plat(x0, x1, z0, z1, top)          a walk surface (optional)

   THE ONE RULE THAT KILLS THE FLICKER: nothing this file emits shares a
   plane with the wall it sits in. Frames sit INSIDE the opening (their faces
   meet the reveal back to back, never side by side), sills start at the
   frame and stand proud of the wall, lintels start at the wall face, numbers
   stand 15 mm off the wall. The shell supplies the reveal itself: the wall is
   built AROUND the opening (FO.solidRects), so there is no liner to stack.

   Faces: 0 = -z, 1 = +z, 2 = -x, 3 = +x (city/facade_kit.js F.face).
   `t` is the tangent coordinate along a face: local x on faces 0/1, local z
   on faces 2/3. `o` is the offset from the wall's OUTER plane along the
   outward normal (o < 0 is inside the wall).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const FO = {};

  // ---- faces ---------------------------------------------------------------
  FO.face = function (w, d, s) {
    const horiz = s === 0 || s === 1;
    const out = (s === 0 || s === 2) ? -1 : 1;
    return { s: s, horiz: horiz, out: out, span: horiz ? w : d, halfN: (horiz ? d : w) / 2 };
  };
  FO.faces = function (w, d) { return [0, 1, 2, 3].map(function (s) { return FO.face(w, d, s); }); };
  // a box given in face terms (t centre, y centre, o centre; along, high, deep)
  // → building-local (x, y, z, w, h, d)
  FO.at = function (f, t, y, o, along, high, deep) {
    const n = f.out * (f.halfN + o);
    return f.horiz ? [t, y, n, along, high, deep] : [n, y, t, deep, high, along];
  };
  function emitBox(E, f, t0, t1, y0, y1, o0, o1, col) {
    if (t1 - t0 < 0.004 || y1 - y0 < 0.004 || o1 - o0 < 0.004) return;
    const b = FO.at(f, (t0 + t1) / 2, (y0 + y1) / 2, (o0 + o1) / 2, t1 - t0, y1 - y0, o1 - o0);
    // a host with instanced trim (E.trim: one unit box per member, coloured per
    // instance) takes the module there; otherwise into its merged deco
    (E.trim || E.dbox)(b[0], b[1], b[2], b[3], b[4], b[5], col);
  }
  FO.box = emitBox;

  // ---- THE SOLID PART OF A WALL ---------------------------------------------
  /* [a0,a1] x [y0,y1] minus every hole {a0, a1, y0, y1}: a grid over the hole
     edges, solid cells merged into runs, runs merged down the rows. Returns
     [[a0, a1, y0, y1]]. The wall is built from these, so every opening has
     real reveal faces and nothing has to be laid over it. (Lifted from
     world/disaster_arena.js, which now calls this one.) */
  FO.solidRects = function (a0, a1, y0, y1, hs) {
    const mine = hs.filter(function (h) { return h.a1 > a0 + 0.01 && h.a0 < a1 - 0.01 && h.y1 > y0 + 0.01 && h.y0 < y1 - 0.01; });
    if (!mine.length) return [[a0, a1, y0, y1]];
    const clampA = function (v) { return Math.max(a0, Math.min(a1, v)); };
    const clampY = function (v) { return Math.max(y0, Math.min(y1, v)); };
    const xs = [a0, a1], ys = [y0, y1];
    for (const h of mine) { xs.push(clampA(h.a0), clampA(h.a1)); ys.push(clampY(h.y0), clampY(h.y1)); }
    const uniq = function (arr) {
      arr.sort(function (p, q) { return p - q; });
      const o2 = [];
      for (const v of arr) if (!o2.length || v - o2[o2.length - 1] > 0.004) o2.push(v);
      return o2;
    };
    const X = uniq(xs), Y = uniq(ys);
    const solidCell = function (i, j) {
      const cx = (X[i] + X[i + 1]) / 2, cy = (Y[j] + Y[j + 1]) / 2;
      for (const h of mine) if (cx > h.a0 && cx < h.a1 && cy > h.y0 && cy < h.y1) return false;
      return true;
    };
    let open = new Map();
    const rects = [];
    for (let j = 0; j < Y.length - 1; j++) {
      const rowRuns = [];
      for (let i = 0; i < X.length - 1; ) {
        if (!solidCell(i, j)) { i++; continue; }
        let e = i;
        while (e + 1 < X.length - 1 && solidCell(e + 1, j)) e++;
        rowRuns.push(i + "|" + e);
        i = e + 1;
      }
      const next = new Map();
      for (const key of rowRuns) {
        if (open.has(key)) { next.set(key, open.get(key)); open.delete(key); }
        else { const pr = key.split("|"); next.set(key, { i0: +pr[0], i1: +pr[1], j0: j }); }
      }
      open.forEach(function (r) { rects.push([r.i0, r.i1, r.j0, j - 1]); });
      open = next;
    }
    open.forEach(function (r) { rects.push([r.i0, r.i1, r.j0, Y.length - 2]); });
    return rects.map(function (r) { return [X[r[0]], X[r[1] + 1], Y[r[2]], Y[r[3] + 1]]; });
  };

  // ---- STYLES ---------------------------------------------------------------
  /* One window style per way of building a wall. Every number is a real
     dimension: frame members 45-70 mm, a stone sill 60-70 mm proud, a
     masonry reveal 15-20 cm, a curtain wall's glass 8-10 cm back. */
  FO.STYLES = {
    // glass curtain wall / modern office: slim dark aluminium, a mullion every
    // module, a hairline sill
    curtain:  { rev: 0.10, fw: 0.05, fd: 0.07, frame: 0x2a2f35, mull: 1.5, transom: 0, muntin: null,
      sill: { h: 0.05, proj: 0.04, over: 0.02, col: "trim" }, lintel: null, glass: "clear" },
    // load-bearing brick / stone: a painted timber sash in a deep reveal,
    // meeting rail + glazing bars, stone sill and lintel
    sash:     { rev: 0.16, fw: 0.065, fd: 0.08, frame: 0xe9e5da, mull: 1.2, transom: 0, muntin: "sash",
      sill: { h: 0.09, proj: 0.07, over: 0.10, col: "stone" }, lintel: { h: 0.20, proj: 0.035, over: 0.12, col: "stone" }, glass: "clear" },
    // civic: tall bronze casements, a transom light, stone everything
    civic:    { rev: 0.18, fw: 0.07, fd: 0.09, frame: 0x3a3428, mull: 1.3, transom: 0.78, muntin: null,
      sill: { h: 0.12, proj: 0.08, over: 0.14, col: "stone" }, lintel: { h: 0.24, proj: 0.05, over: 0.18, col: "stone" }, glass: "clear" },
    // bank / utility: narrow steel slot with security bars
    security: { rev: 0.18, fw: 0.06, fd: 0.08, frame: 0x30343a, mull: 0, transom: 0, muntin: "bars",
      sill: { h: 0.08, proj: 0.06, over: 0.06, col: "stone" }, lintel: null, glass: "clear" },
    // industrial: steel factory sash, a grid of small lights
    industrial: { rev: 0.12, fw: 0.05, fd: 0.06, frame: 0x2e3338, mull: 1.0, transom: 0.5, muntin: "grid",
      sill: { h: 0.07, proj: 0.05, over: 0.04, col: "trim" }, lintel: null, glass: "clear" },
    // a shop front / showroom: floor-to-header plate glass in slim dark
    // aluminium, a mullion every 1.5 m, no sill (the frame's bottom rail meets
    // the floor)
    shop:     { rev: 0.12, fw: 0.06, fd: 0.08, frame: 0x24282d, mull: 1.5, transom: 0, muntin: null,
      sill: null, lintel: null, glass: "clear" },
    // a house: a casement pair in a painted frame
    house:    { rev: 0.12, fw: 0.06, fd: 0.07, frame: 0xf1eee6, mull: 0.9, transom: 0, muntin: null,
      sill: { h: 0.07, proj: 0.06, over: 0.06, col: "trim" }, lintel: null, glass: "clear" },
  };
  // which style a facade-kit grammar's walls want, by what it is made of
  FO.styleForStructure = function (structure, storeys) {
    switch (structure) {
      case "glassbox": case "steel": return "curtain";
      case "brick": case "stone": case "masonry": return "sash";
      case "timber": return "house";
      case "adobe": return "house";
      case "concrete": return storeys >= 6 ? "curtain" : "industrial";
      default: return storeys >= 8 ? "curtain" : "sash";
    }
  };
  function resolveCol(c, pal) {
    if (typeof c === "number") return c;
    if (pal && pal[c] != null) return pal[c];
    return 0xbdb6a6;
  }

  /* ---- ONE WINDOW -------------------------------------------------------------
     f: face; op: { t0, t1, y0, y1 } the opening cut in the wall; S: a style
     (FO.STYLES entry, optionally overridden); pal: { trim, stone, frame }.
     o: { sill: bool (default S.sill), lintel: bool, arch: bool, tint, kind,
          glow: {lit, warm} | null, salt }.
     Returns the pane count. */
  FO.window = function (E, f, op, S, pal, o) {
    o = o || {};
    S = S || FO.STYLES.curtain;
    const W = op.t1 - op.t0, H = op.y1 - op.y0;
    if (W < 0.25 || H < 0.25) return 0;
    const fw = Math.min(S.fw, W * 0.12, H * 0.12), fd = S.fd;
    const rev = Math.max(S.rev, fd / 2 + 0.03);       // the frame stays wholly inside the reveal
    const oF0 = -rev - fd / 2, oF1 = -rev + fd / 2;   // frame depth
    const FC = o.frame != null ? o.frame : (pal && pal.frame != null ? pal.frame : S.frame);
    const t0 = op.t0, t1 = op.t1, y0 = op.y0, y1 = op.y1;
    // the frame: head and sill members full width, jambs between them
    emitBox(E, f, t0, t1, y1 - fw, y1, oF0, oF1, FC);
    emitBox(E, f, t0, t1, y0, y0 + fw, oF0, oF1, FC);
    emitBox(E, f, t0, t0 + fw, y0 + fw, y1 - fw, oF0, oF1, FC);
    emitBox(E, f, t1 - fw, t1, y0 + fw, y1 - fw, oF0, oF1, FC);
    // lights: mullions every S.mull metres, a transom at S.transom of the height
    const iT0 = t0 + fw, iT1 = t1 - fw, iY0 = y0 + fw, iY1 = y1 - fw;
    const nM = S.mull > 0 ? Math.max(1, Math.min(12, Math.round((iT1 - iT0) / S.mull))) : 1;
    const mw = fw * 0.8, md = fd * 0.78;
    const cols = [];
    const step = (iT1 - iT0) / nM;
    for (let i = 0; i < nM; i++) {
      const a = iT0 + i * step + (i > 0 ? mw / 2 : 0), b = iT0 + (i + 1) * step - (i < nM - 1 ? mw / 2 : 0);
      cols.push([a, b]);
      if (i > 0) emitBox(E, f, iT0 + i * step - mw / 2, iT0 + i * step + mw / 2, iY0, iY1, -rev - md / 2, -rev + md / 2, FC);
    }
    const rows = [];
    if (S.transom && H > 1.6) {
      const ty = iY0 + (iY1 - iY0) * S.transom;
      emitBox(E, f, iT0, iT1, ty - mw / 2, ty + mw / 2, -rev - md / 2, -rev + md / 2, FC);
      rows.push([iY0, ty - mw / 2], [ty + mw / 2, iY1]);
    } else rows.push([iY0, iY1]);
    // the glass: one breakable pane per light, thin, at the frame's centre plane
    let n = 0;
    const PT = 0.02;
    for (const c of cols) for (const r of rows) {
      const tc = (c[0] + c[1]) / 2, yc = (r[0] + r[1]) / 2;
      const b = FO.at(f, tc, yc, -rev, c[1] - c[0], r[1] - r[0], PT);
      E.glass(b[0], b[1], b[2], b[3], b[4], b[5], { tint: o.tint || 0, kind: o.kind || S.glass, role: o.role || "" });
      n++;
    }
    // glazing bars in front of the glass (never in the frame's plane)
    const bo0 = -rev + PT / 2 + 0.004, bo1 = -rev + fd / 2 - 0.012;
    if (S.muntin && bo1 - bo0 > 0.004) {
      const bw = 0.03;
      for (const c of cols) for (const r of rows) {
        const cw = c[1] - c[0], rh = r[1] - r[0];
        if (S.muntin === "sash") {
          // meeting rail + one glazing bar each way per sash
          const my = (r[0] + r[1]) / 2;
          emitBox(E, f, c[0], c[1], my - bw * 0.8, my + bw * 0.8, bo0, bo1 + 0.006, FC);
          if (cw > 0.7) emitBox(E, f, (c[0] + c[1]) / 2 - bw / 2, (c[0] + c[1]) / 2 + bw / 2, r[0], r[1], bo0, bo1, FC);
          if (rh > 1.2) for (const fy of [0.25, 0.75]) { const yy = r[0] + rh * fy; emitBox(E, f, c[0], c[1], yy - bw / 2, yy + bw / 2, bo0, bo1, FC); }
        } else if (S.muntin === "grid") {
          const nx = Math.max(1, Math.round(cw / 0.45)), ny = Math.max(1, Math.round(rh / 0.45));
          for (let i = 1; i < nx; i++) { const tt = c[0] + cw * i / nx; emitBox(E, f, tt - bw / 2, tt + bw / 2, r[0], r[1], bo0, bo1, FC); }
          for (let j = 1; j < ny; j++) { const yy = r[0] + rh * j / ny; emitBox(E, f, c[0], c[1], yy - bw / 2, yy + bw / 2, bo0, bo1, FC); }
        } else if (S.muntin === "bars") {
          const nb = Math.max(2, Math.round(cw / 0.14));
          for (let i = 1; i < nb; i++) { const tt = c[0] + cw * i / nb; emitBox(E, f, tt - 0.012, tt + 0.012, r[0], r[1], bo0, bo1, 0x22262a); }
        }
      }
    }
    // the sill, under the opening: from the frame face out past the wall
    const sillOn = o.sill != null ? o.sill : !!S.sill;
    if (sillOn && S.sill) {
      const sc = resolveCol(S.sill.col, pal);
      emitBox(E, f, t0 - S.sill.over, t1 + S.sill.over, y0 - S.sill.h + 0.025, y0 + 0.025, oF1, S.sill.proj, sc);
    }
    // the lintel, over it: from the wall face out
    const linOn = o.lintel != null ? o.lintel : !!S.lintel;
    if (linOn && S.lintel) {
      const lc = resolveCol(S.lintel.col, pal);
      const L = S.lintel;
      if (o.arch) {
        // a segmental brick arch of five voussoirs and a keystone
        const vw = (W + 2 * L.over) / 5;
        for (let v = 0; v < 5; v++) {
          const rise = 0.09 * (2 - Math.abs(v - 2));
          const ta = t0 - L.over + v * vw;
          emitBox(E, f, ta, ta + vw, y1, y1 + L.h + rise, 0, L.proj, o.archCol != null ? o.archCol : lc);
        }
        emitBox(E, f, (t0 + t1) / 2 - 0.12, (t0 + t1) / 2 + 0.12, y1 + 0.02, y1 + L.h + 0.26, L.proj, L.proj + 0.03, lc);
      } else {
        emitBox(E, f, t0 - L.over, t1 + L.over, y1, y1 + L.h, 0, L.proj, lc);
      }
    }
    // the room behind it
    if (E.glow && o.glow) {
      const c = FO.at(f, (t0 + t1) / 2, (y0 + y1) / 2, 0, 0, 0, 0);
      // the room panel stands 6 cm behind the glass, never in its plane
      E.glow(c[0], c[1], c[2], W, H, f.horiz ? { x: 0, z: f.out } : { x: f.out, z: 0 }, Object.assign({ inset: rev + 0.06 }, o.glow));
    }
    return n;
  };

  /* ---- ONE DOOR ---------------------------------------------------------------
     The hinged leaf itself is the host's (city/buildings.js makeDoorPanel: a
     pivot, a collider, the open/lock logic). This frames the opening it
     hangs in, and gives the entrance what a real street door has:
       f, dr: { t, w, h (opening), leafW, leafH, recess (leaf front face, m
              behind the wall face), y (threshold) }
       kind: "house" | "townhouse" | "shop" | "lobby" | "office" | "service"
       o: { number, frameCol, stoneCol, lampCol, transom: bool, stoop: bool,
            light: bool, canopy: bool, own: bool (a grammar drew its own
            doorcase: frame + number only) }                                  */
  FO.DOOR = { W: 1.6, H: 2.25, LEAF_RECESS: 0.12 };
  FO.door = function (E, f, dr, kind, o) {
    o = o || {};
    const W = dr.w || FO.DOOR.W;
    const yb = dr.y || 0;                         // threshold top
    const top = dr.top != null ? dr.top : yb + (dr.h || FO.DOOR.H);   // head of the hole
    const t = dr.t || 0;
    const rec = dr.recess != null ? dr.recess : FO.DOOR.LEAF_RECESS;
    const leafTop = dr.leafTop != null ? dr.leafTop : top - 0.03;
    const FC = o.frameCol != null ? o.frameCol : 0x2b2622;
    const STONE = o.stoneCol != null ? o.stoneCol : 0xc9c2b2;
    const out = [];
    // the threshold: a stone sill through the wall's depth under the leaf
    emitBox(E, f, t - W / 2, t + W / 2, yb - 0.14, yb, -(dr.depth || 0.2), 0, STONE);
    // the stop: jambs and head of the frame, in front of the leaf, inside the
    // reveal. They cover the leaf's swing clearance; it swings in behind them.
    const s0 = -rec + 0.012, s1 = -0.035;
    const cw = Math.max(0.06, (W - (dr.leafW || W - 0.16)) / 2 + 0.03);
    const jTop = Math.min(top, leafTop + 0.03);
    emitBox(E, f, t - W / 2, t - W / 2 + cw, yb, jTop, s0, s1, FC);
    emitBox(E, f, t + W / 2 - cw, t + W / 2, yb, jTop, s0, s1, FC);
    if (top - leafTop > 0.3 && E.glass && (o.transom || kind === "townhouse" || kind === "lobby" || kind === "office")) {
      // a transom light over the leaf
      const tb = leafTop + 0.06;
      emitBox(E, f, t - W / 2, t + W / 2, leafTop - 0.03, tb, s0, s1, FC);            // transom bar
      emitBox(E, f, t - W / 2, t + W / 2, top - 0.05, top, s0, s1, FC);                // head
      emitBox(E, f, t - W / 2, t - W / 2 + cw, tb, top - 0.05, s0, s1, FC);
      emitBox(E, f, t + W / 2 - cw, t + W / 2, tb, top - 0.05, s0, s1, FC);
      const g = FO.at(f, t, (tb + top - 0.05) / 2, -rec + 0.035, W - 2 * cw, top - 0.05 - tb, 0.02);
      E.glass(g[0], g[1], g[2], g[3], g[4], g[5], { tint: 0, kind: "clear", role: "transom" });
      out.push("transom");
    } else if (top - leafTop > 0.004) {
      emitBox(E, f, t - W / 2, t + W / 2, leafTop - 0.03, top, s0, s1, FC);            // head stop
    }
    if (o.own) { numberAt(); return out; }
    // ---- the way up to it: a stone step, or a stoop with cheeks ----------------
    if (o.step !== false) {
      if (kind === "townhouse") {
        // a stoop: a landing at the door, a tread down to the walk, cheek walls
        // with newel caps either side
        const SW = W + 0.9, land = 1.05, tread = 0.34;
        const topY = yb - 0.012;
        emitBox(E, f, t - SW / 2, t + SW / 2, -0.3, topY, 0, land, STONE);
        emitBox(E, f, t - SW / 2, t + SW / 2, -0.3, topY * 0.5, land, land + tread, STONE);
        const cheekH = 0.72, cheekT = 0.24, run = land + tread;
        for (const sg of [-1, 1]) {
          const cx = t + sg * (SW / 2 + cheekT / 2);
          emitBox(E, f, cx - cheekT / 2, cx + cheekT / 2, -0.3, topY + cheekH, 0, run, o.cheekCol != null ? o.cheekCol : STONE);
          emitBox(E, f, cx - cheekT / 2 - 0.03, cx + cheekT / 2 + 0.03, topY + cheekH, topY + cheekH + 0.08, run - 0.34, run + 0.03, STONE);
        }
        out.push("stoop");
      } else {
        const SW = (kind === "lobby" || kind === "office") ? W + 1.6 : W + 0.5;
        const SD = (kind === "lobby" || kind === "office") ? 1.2 : 0.42;
        emitBox(E, f, t - SW / 2, t + SW / 2, -0.3, yb - 0.012, 0, SD, STONE);
        out.push("step");
      }
    }
    // ---- a canopy over a lobby / office / shop door, lit from its soffit -------
    if (kind === "lobby" || kind === "office" || o.canopy) {
      const CW = W + 1.4, CD = kind === "shop" ? 0.9 : 1.5;
      const cy = Math.max(top + 0.12, yb + 2.45);
      emitBox(E, f, t - CW / 2, t + CW / 2, cy, cy + 0.16, 0, CD, o.canopyCol != null ? o.canopyCol : 0x33373c);
      out.push("canopy");
      if (E.lamp && o.light !== false) {
        for (const sg of [-1, 1]) {
          const b = FO.at(f, t + sg * W * 0.35, cy - 0.03, CD * 0.6, 0.22, 0.06, 0.22);
          E.lamp(b[0], b[1], b[2], b[3], b[4], b[5], o.lampCol != null ? o.lampCol : 0xffe2a6);
        }
        out.push("light");
      }
    } else if (E.lamp && o.light !== false) {
      // a wall lantern beside the door: a backplate and a lit glass box
      const lt = t + (W / 2 + 0.34) * (o.lampSide || 1);
      const ly = Math.min(top + 0.12, yb + 2.0);
      emitBox(E, f, lt - 0.07, lt + 0.07, ly - 0.15, ly + 0.15, 0, 0.03, 0x24272b);
      const b = FO.at(f, lt, ly, 0.03 + 0.07, 0.13, 0.22, 0.14);
      E.lamp(b[0], b[1], b[2], b[3], b[4], b[5], o.lampCol != null ? o.lampCol : 0xffd79a);
      out.push("light");
    }
    numberAt();
    return out;
    function numberAt() {
      if (o.number == null || !E.number) return;
      // on the other side of the door from the lantern, at eye height; a shop
      // (glass both sides of its door) carries it on the head over the door
      const nt = o.numberOver ? t : t - (W / 2 + 0.36) * (o.lampSide || 1);
      const ny = o.numberOver ? top + 0.22 : Math.min(top - 0.1, yb + 1.85);
      const c = FO.at(f, nt, ny, 0.015, 0, 0, 0);
      E.number(c[0], c[1], c[2], f.horiz ? { x: 0, z: f.out } : { x: f.out, z: 0 }, String(o.number), 0.15);
      out.push("number");
    }
  };

  /* ---- HOUSE NUMBERS -------------------------------------------------------------
     Brass digits standing 15 mm off the wall beside the door. One tiny shared
     atlas (ten digits on a 320x40 canvas, freed after upload), every digit an
     instance of one quad in a pool per 320 m cell: a handful of draw calls for
     every number in the city. The digit's cell in the atlas rides an instance
     attribute. A host passes its group (for the identity host the pool hangs
     on), the WORLD position of the number's centre, the outward normal, the
     text and the digit height. */
  let numPending = [], numAtlas = null, numMat = null, numGeo = null;
  const numPools = [];
  function numberAtlas() {
    if (numAtlas || typeof document === "undefined" || !window.THREE) return numAtlas;
    const c = document.createElement("canvas"); c.width = 320; c.height = 40;
    const x = c.getContext("2d");
    if (!x) return null;
    x.clearRect(0, 0, 320, 40);
    x.fillStyle = "#c9a45a"; x.strokeStyle = "#5a4320"; x.lineWidth = 2;
    x.font = "bold 34px Georgia, 'Times New Roman', serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    for (let i = 0; i < 10; i++) { x.strokeText(String(i), i * 32 + 16, 21); x.fillText(String(i), i * 32 + 16, 21); }
    const T = window.THREE;
    numAtlas = new T.CanvasTexture(c);
    if (T.sRGBEncoding != null) numAtlas.encoding = T.sRGBEncoding;
    numAtlas.anisotropy = 2;
    // the pixels are on the GPU after the first upload: drop the canvas
    numAtlas.onUpdate = function () { try { numAtlas.image = { width: 320, height: 40 }; } catch (e) {} };
    return numAtlas;
  }
  function numberMaterial() {
    if (numMat) return numMat;
    const T = window.THREE;
    numMat = new T.MeshLambertMaterial({ map: numberAtlas(), transparent: true, alphaTest: 0.35, depthWrite: true });
    numMat.onBeforeCompile = function (sh) {
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute float aDigit;")
        .replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_UV\n vUv.x = (vUv.x + aDigit) / 10.0;\n#endif");
    };
    numMat.customProgramCacheKey = function () { return "cbz-house-number"; };
    numMat._shared = true;
    return numMat;
  }
  CBZ.facadeNumber = function (group, wx, wy, wz, nrm, text, h) {
    text = String(text).replace(/[^0-9]/g, "").slice(0, 4);
    if (!text.length) return;
    h = h || 0.15;
    const dw = h * 0.62, n = text.length;
    const nx = nrm.x || 0, nz = nrm.z != null ? nrm.z : 0;
    // tangent: the reader's right when facing the wall
    const tx = -nz, tz = nx;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * dw * 0.92;
      numPending.push({ x: wx + tx * off, y: wy, z: wz + tz * off, nx: nx, nz: nz, w: dw, h: h, dg: +text[i], _grp: group });
    }
  };
  CBZ.facadeNumbersFlush = function () {
    if (!numPending.length || !window.THREE) return;
    const T = window.THREE;
    const batch = numPending; numPending = [];
    if (!numGeo) { numGeo = new T.PlaneGeometry(1, 1); }
    const mat = numberMaterial();
    let root = null;
    for (const r of batch) { if (r._grp) { root = CBZ.poolIdentityHost ? CBZ.poolIdentityHost(r._grp) : r._grp.parent; if (root) break; } }
    if (!root) root = CBZ.scene;
    if (!root) return;
    const SECT = 320, cells = new Map();
    for (const r of batch) { const k = Math.floor(r.x / SECT) + "," + Math.floor(r.z / SECT); let a = cells.get(k); if (!a) { a = []; cells.set(k, a); } a.push(r); }
    const m4 = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), sc = new T.Vector3(), az = new T.Vector3(0, 0, 1), nv = new T.Vector3();
    cells.forEach(function (recs) {
      const g = numGeo.clone();
      const dig = new Float32Array(recs.length);
      let nx0 = 1e9, nx1 = -1e9, ny0 = 1e9, ny1 = -1e9, nz0 = 1e9, nz1 = -1e9;
      for (const r of recs) { nx0 = Math.min(nx0, r.x); nx1 = Math.max(nx1, r.x); ny0 = Math.min(ny0, r.y); ny1 = Math.max(ny1, r.y); nz0 = Math.min(nz0, r.z); nz1 = Math.max(nz1, r.z); }
      g.boundingSphere = new T.Sphere(new T.Vector3((nx0 + nx1) / 2, (ny0 + ny1) / 2, (nz0 + nz1) / 2), Math.hypot(nx1 - nx0, ny1 - ny0, nz1 - nz0) / 2 + 1);
      const im = new T.InstancedMesh(g, mat, recs.length);
      for (let i = 0; i < recs.length; i++) {
        const r = recs[i];
        nv.set(r.nx, 0, r.nz).normalize();
        q.setFromUnitVectors(az, nv);
        m4.compose(p.set(r.x, r.y, r.z), q, sc.set(r.w, r.h, 1));
        im.setMatrixAt(i, m4);
        dig[i] = r.dg;
      }
      g.setAttribute("aDigit", new T.InstancedBufferAttribute(dig, 1));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false; im.receiveShadow = false;
      im.frustumCulled = true;
      im.name = "house-numbers";
      im.userData.worldSpacePool = "houseNumbers";
      root.add(im);
      numPools.push(im);
    });
  };
  CBZ.facadeNumberStats = function () { let n = 0; for (const p of numPools) n += p.count; return { pools: numPools.length, digits: n, pending: numPending.length }; };

  /* ---- WHERE A GRAMMAR LEFT THE WALL OPEN -------------------------------------
     recs: the facade's own boxes, building-local [x,y,z,w,h,d,col]. A box that
     stands proud of the wall (outer > 26 mm) and starts near it (inner < 12 cm)
     COVERS the wall; flush paint does not, and neither does the grammar's own
     glass (it marks a window: isGlass). Scans each storey of each face at three
     heights, grows every clear run up and down, and falls back to a regular
     rhythm on a storey the grammar clad solid. (Lifted from
     world/disaster_arena.js glazeBuilding, which now calls this one.)
     o: { w, d, storeys, fh, doorSide, doorHalf, isGlass(col), skip(f, k) ->
          true to leave a storey alone, tower, house }
     Returns [{ s, k, t0, t1, y0, y1, forced, bare }]. */
  FO.isGlassHex = function (c) {
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    return l < 0.14 && b >= r && b >= g * 0.9;
  };
  FO.scan = function (recs, o) {
    const isGlass = o.isGlass || FO.isGlassHex;
    const faces = FO.faces(o.w, o.d);
    const DEEP_CLAD = 0.34, STEP = 0.06, VSTEP = 0.05;
    const out = [];
    for (const f of faces) {
      const list = [], deep = [];
      for (const b of recs) {
        if (isGlass(b[6])) continue;
        const nC = f.horiz ? b[2] : b[0], nH = (f.horiz ? b[5] : b[3]) / 2;
        const outer = f.out > 0 ? (nC + nH) - f.halfN : -f.halfN - (nC - nH);
        const inner = f.out > 0 ? (nC - nH) - f.halfN : -f.halfN - (nC + nH);
        if (outer < 0.026) continue;
        const tC = f.horiz ? b[0] : b[2], tH = (f.horiz ? b[3] : b[5]) / 2;
        // standing off the wall, a thin post or column is something you see a
        // window past; a SCREEN (a panel 45 cm+ wide within 80 cm of the wall,
        // a fin, a spandrel standing proud) is something it would hide behind
        if (inner > 0.12 && !(inner <= 0.8 && tH * 2 >= 0.45 && b[4] >= 0.3)) continue;
        // shallow RELIEF (a plank reveal, a panel joint: under 8 cm proud and
        // under 12 cm wide or tall) is texture on the wall, not a wall over a
        // window: the cut takes it out of the opening
        if (outer < 0.08 && (b[4] < 0.12 || tH * 2 < 0.12)) continue;
        const q = [tC - tH, tC + tH, b[1] - b[4] / 2, b[1] + b[4] / 2, outer, inner];
        list.push(q);
        // "deep" = architecture standing OFF the wall (a column, a porch, an eave):
        // a forced window never goes behind one. Thick cladding laid AGAINST
        // the wall (an adobe's mass, a rusticated base) is the wall: it is cut.
        if (outer > DEEP_CLAD && inner > 0.05) deep.push(q);
      }
      const hit = function (L, t, y) {
        for (let i = 0; i < L.length; i++) { const q = L[i]; if (t > q[0] && t < q[1] && y > q[2] && y < q[3]) return true; }
        return false;
      };
      const cov = function (t, y) { return hit(list, t, y); };
      const half = f.span / 2 - 0.45;
      for (let k = 0; k < o.storeys; k++) {
        if (o.skip && o.skip(f, k)) continue;
        const shop = false;
        const b0 = k * o.fh + 0.55, b1 = (k + 1) * o.fh - 0.45;
        const doorBand = f.s === o.doorSide && k === 0;
        const made = [];
        const overlapsMade = function (u0, u1, v0, v1) {
          return made.some(function (m) { return u1 > m[0] + 0.02 && u0 < m[1] - 0.02 && v1 > m[2] + 0.02 && v0 < m[3] - 0.02; });
        };
        const runsAt = function (yS) {
          const res = [];
          let start = null;
          for (let t = -half; t <= half + 1e-6; t += STEP) {
            const doorBlock = doorBand && Math.abs(t) < o.doorHalf;
            const open = !doorBlock && !cov(t, yS);
            if (open && start == null) start = t;
            if ((!open || t + STEP > half + 1e-6) && start != null) {
              const end = open ? t : t - STEP;
              if (end - start >= 0.45) res.push([start, end, yS]);
              start = null;
            }
          }
          return res;
        };
        const runs = [];
        for (const frac of [0.55, 0.3, 0.8]) for (const r of runsAt(b0 + (b1 - b0) * frac)) runs.push(r);
        for (const run of runs) {
          const tm = (run[0] + run[1]) / 2, yS = run[2];
          let v0 = yS, v1 = yS;
          while (v0 - VSTEP >= b0 && !cov(tm, v0 - VSTEP)) v0 -= VSTEP;
          while (v1 + VSTEP <= b1 && !cov(tm, v1 + VSTEP)) v1 += VSTEP;
          if (v1 - v0 < 0.5) continue;
          const u0 = run[0] - STEP / 2, u1 = run[1] + STEP / 2;
          if (overlapsMade(u0, u1, v0, v1)) continue;
          made.push([u0, u1, v0, v1]);
          out.push({ s: f.s, k: k, t0: u0, t1: u1, y0: v0, y1: v1, forced: false, bare: !cov(tm, v0 - 0.12), shop: shop });
        }
        // a storey the grammar clad solid still gets windows, on a rhythm
        const span = 2 * half;
        const winW = o.tower ? 1.5 : 1.1, pitch = o.tower ? 2.3 : 3.1;
        const want = Math.max(1, Math.floor((span + pitch - winW) / pitch));
        let have = 0;
        for (const m of made) have += m[1] - m[0];
        if (span > winW + 0.3 && have < want * winW * 0.55) {
          const s0 = k * o.fh;
          const fv0 = Math.max(b0, s0 + (o.tower ? 0.8 : 0.9));
          const fv1 = Math.min(b1, o.tower ? b1 : s0 + 2.15);
          if (fv1 - fv0 >= 0.6) {
            for (let i = 0; i < want; i++) {
              const tc = -half + (i + 0.5) * (span / want);
              const u0 = tc - winW / 2, u1 = tc + winW / 2;
              if (doorBand && u1 > -o.doorHalf && u0 < o.doorHalf) continue;
              if (overlapsMade(u0 - 0.25, u1 + 0.25, fv0, fv1)) continue;
              let blocked = false;
              for (let q = 0; q <= 4 && !blocked; q++) for (let r = 0; r <= 3 && !blocked; r++)
                blocked = hit(deep, u0 + (u1 - u0) * q / 4, fv0 + (fv1 - fv0) * r / 3);
              if (blocked) continue;
              // the cut goes through every layer laid against the wall here
              let reach = 0.3;
              for (const q of list) if (q[5] <= 0.12 && q[1] > u0 && q[0] < u1 && q[3] > fv0 && q[2] < fv1) reach = Math.max(reach, q[4] + 0.02);
              made.push([u0, u1, fv0, fv1]);
              out.push({ s: f.s, k: k, t0: u0, t1: u1, y0: fv0, y1: fv1, forced: true, bare: true, reach: Math.min(1.2, reach) });
            }
          }
        }
      }
    }
    return out;
  };

  /* ---- CUT THE GRAMMAR'S BOXES OUT OF THE OPENINGS ----------------------------
     Every deco box lying in the wall's plane zone loses the part inside an
     opening; a grammar's glass box is cleared from the opening through its
     whole depth (it was a painting of the window that is now real). Proud
     ornament (a frame, a shutter, a column) is kept. In place on `recs`. */
  FO.cutRecs = function (recs, holes, o) {
    if (!holes.length) return recs;
    const SUB = CBZ.FACADE_F && CBZ.FACADE_F.subtractBox;
    if (!SUB) return recs;
    const isGlass = o.isGlass || FO.isGlassHex;
    const faces = FO.faces(o.w, o.d);
    const WT = o.wt || 0.4;
    const volOf = function (h, reach) {
      const f = faces[h.s], n0 = f.halfN - WT - 0.05, n1 = f.halfN + 0.03 + reach;
      const lo = f.out > 0 ? n0 : -n1, hi = f.out > 0 ? n1 : -n0;
      return f.horiz ? { x0: h.t0, x1: h.t1, z0: lo, z1: hi, y0: h.y0, y1: h.y1 }
                     : { x0: lo, x1: hi, z0: h.t0, z1: h.t1, y0: h.y0, y1: h.y1 };
    };
    const vol = holes.map(function (h) { return volOf(h, h.forced ? Math.max(0.3, h.reach || 0) : (h.reach || 0)); });
    const volGlass = holes.map(function (h) { return volOf(h, 2.0); });
    const kept = [];
    const queue = recs.slice();
    for (let qi = 0; qi < queue.length; qi++) {
      const b = queue[qi];
      const bx0 = b[0] - b[3] / 2, bx1 = b[0] + b[3] / 2, by0 = b[1] - b[4] / 2, by1 = b[1] + b[4] / 2, bz0 = b[2] - b[5] / 2, bz1 = b[2] + b[5] / 2;
      const vols = isGlass(b[6]) ? volGlass : vol;
      let hit = null;
      for (let j = 0; j < vols.length; j++) {
        const c = vols[j];
        if (bx1 > c.x0 + 1e-4 && bx0 < c.x1 - 1e-4 && bz1 > c.z0 + 1e-4 && bz0 < c.z1 - 1e-4 && by1 > c.y0 + 1e-4 && by0 < c.y1 - 1e-4) { hit = c; break; }
      }
      if (!hit) { kept.push(b); continue; }
      /* SKIN GOES THROUGH WHOLE. A box laid against the wall and shallow (a
         plank reveal, a render band, a tile course: within 40 cm of the wall
         and starting at it) is cut through its whole depth: cut only to the
         plane zone, its front 2 cm would be left floating across the window. */
      {
        const hs = vol.indexOf(hit) >= 0 ? holes[vol.indexOf(hit)] : (volGlass.indexOf(hit) >= 0 ? holes[volGlass.indexOf(hit)] : null);
        if (hs) {
          const f = faces[hs.s];
          const nC = f.horiz ? b[2] : b[0], nH = (f.horiz ? b[5] : b[3]) / 2;
          const outer = f.out > 0 ? (nC + nH) - f.halfN : -f.halfN - (nC - nH);
          const inner = f.out > 0 ? (nC - nH) - f.halfN : -f.halfN - (nC + nH);
          if (inner <= 0.05 && outer > 0.03 && outer <= 0.4) {
            const deep = volOf(hs, outer + 0.01);
            if (f.horiz) { hit = Object.assign({}, hit, { z0: Math.min(hit.z0, deep.z0), z1: Math.max(hit.z1, deep.z1) }); }
            else { hit = Object.assign({}, hit, { x0: Math.min(hit.x0, deep.x0), x1: Math.max(hit.x1, deep.x1) }); }
          }
        }
      }
      const parts = SUB([bx0, bx1, by0, by1, bz0, bz1], hit);
      for (const p of parts) {
        const nb = [(p[0] + p[1]) / 2, (p[2] + p[3]) / 2, (p[4] + p[5]) / 2, p[1] - p[0], p[3] - p[2], p[5] - p[4], b[6]];
        for (let k = 7; k < b.length; k++) nb.push(b[k]);
        queue.push(nb);
      }
    }
    recs.length = 0;
    for (const b of kept) recs.push(b);
    return recs;
  };

  /* ---- NO TWO SURFACES IN ONE PLANE --------------------------------------------
     The last word on flicker, for ornament the grammars lay on top of each
     other: two boxes of different colours whose faces point the same way and
     lie in the same plane (within 5 mm) over an overlapping area are drawn
     by the depth buffer in whichever order the angle favours. The LATER box
     is the one the author laid on top, so it wins: the earlier box's face is
     pulled back 8 mm behind it (the box shrinks by 8 mm on that side, which
     no eye can see; the face it pulls back is hidden by the later one).
     `walls`, when given ([x0,x1,y0,y1,z0,z1] boxes in the same frame, the
     shell's own wall pieces), are fixed planes: a deco face lying in a wall's
     face is pushed 8 mm OUT of it instead (the dressing replaces the wall
     surface it lies on, it never shares it). In place on `recs`
     ([x,y,z,w,h,d,col,...]); returns the number of faces moved.            */
  FO.resolveCoplanar = function (recs, walls, tol) {
    tol = tol == null ? 0.0068 : tol;   // a hair over the 5 mm the census holds us to
    const EPS = 0.01;
    const n = recs.length;
    if (!n) return 0;
    // box bounds, mutable
    const B = new Float64Array(n * 6);
    for (let i = 0; i < n; i++) {
      const r = recs[i];
      B[i * 6] = r[0] - r[3] / 2; B[i * 6 + 1] = r[0] + r[3] / 2;
      B[i * 6 + 2] = r[1] - r[4] / 2; B[i * 6 + 3] = r[1] + r[4] / 2;
      B[i * 6 + 4] = r[2] - r[5] / 2; B[i * 6 + 5] = r[2] + r[5] / 2;
    }
    // the fixed solids (walls, slabs, veneer) on a coarse grid, to ask "is the
    // air in front of this face really air?" — a face laid against a wall
    // (an ornament's back) is never seen, and is left exactly where it is
    const W = walls || [];
    const GC = 4, wg = new Map();
    for (let k = 0; k < W.length; k++) {
      const w = W[k];
      const i0 = Math.floor(w[0] / GC), i1 = Math.floor(w[1] / GC), k0 = Math.floor(w[4] / GC), k1 = Math.floor(w[5] / GC);
      if ((i1 - i0 + 1) * (k1 - k0 + 1) > 200) continue;
      for (let i = i0; i <= i1; i++) for (let j = k0; j <= k1; j++) { const key = i * 73856093 ^ j * 19349663; let L = wg.get(key); if (!L) { L = []; wg.set(key, L); } L.push(w); }
    }
    function inFixed(x, y, z) {
      const L = wg.get(Math.floor(x / GC) * 73856093 ^ Math.floor(z / GC) * 19349663);
      if (!L) return false;
      for (const w of L) if (x > w[0] && x < w[1] && y > w[2] && y < w[3] && z > w[4] && z < w[5]) return true;
      return false;
    }
    // the point 3 mm in front of face (a, s) of box i, at the centre of [u, v] range
    const pt = [0, 0, 0];
    function faceHidden(i, a, s, u, v, u0, u1, v0, v1) {
      const off = B[i * 6 + a * 2 + s] + (s ? 0.003 : -0.003);
      // hidden only where the WHOLE overlap is backed by solid (a face half over
      // a window opening is seen through the glass from the room): the rect
      // minus every fixed box the air in front of it lies inside, exactly
      pt[a] = off; pt[u] = (u0 + u1) / 2; pt[v] = (v0 + v1) / 2;
      const hs = [];
      const seen = new Set();
      const ci0 = Math.floor(Math.min(a === 0 ? off : (u === 0 ? u0 : v0), a === 0 ? off : (u === 0 ? u1 : v1)) / GC);
      void ci0;
      // the candidate fixed boxes: every grid cell the rect spans
      const xs0 = a === 0 ? off : (u === 0 ? u0 : v0), xs1 = a === 0 ? off : (u === 0 ? u1 : v1);
      const zs0 = a === 2 ? off : (u === 2 ? u0 : v0), zs1 = a === 2 ? off : (u === 2 ? u1 : v1);
      for (let gi = Math.floor(xs0 / GC); gi <= Math.floor(xs1 / GC); gi++) for (let gk = Math.floor(zs0 / GC); gk <= Math.floor(zs1 / GC); gk++) {
        const L = wg.get(gi * 73856093 ^ gk * 19349663); if (!L) continue;
        for (const w of L) {
          if (seen.has(w)) continue; seen.add(w);
          if (!(off > w[a * 2] && off < w[a * 2 + 1])) continue;
          if (w[u * 2 + 1] <= u0 || w[u * 2] >= u1 || w[v * 2 + 1] <= v0 || w[v * 2] >= v1) continue;
          hs.push({ a0: w[u * 2], a1: w[u * 2 + 1], y0: w[v * 2], y1: w[v * 2 + 1] });
        }
      }
      if (!hs.length) return false;
      const left = FO.solidRects(u0, u1, v0, v1, hs);
      for (const r of left) if ((r[1] - r[0]) > 0.002 && (r[3] - r[2]) > 0.002) return false;
      return true;
    }
    let moved = 0;
    const CELL = 0.02;
    // rounds over all three axes: settling a face on one axis can make a box
    // reach into a wall, putting a SIDE face in a jamb's plane
    for (let round = 0; round < 3; round++) {
    const movedBefore = moved;
    for (let a = 0; a < 3; a++) {
      const u = a === 0 ? 1 : 0, v = a === 2 ? 1 : 2;
      for (let s = 0; s < 2; s++) {
        // CLUSTERS, not pairs: every face on (about) one plane that overlaps a
        // face of another colour gets its OWN plane, in the order the boxes
        // were laid: the last one laid stays, each earlier one steps back
        // behind it (a box too thin to give up the depth steps forward
        // instead), to the nearest plane 10 mm steps away where it overlaps
        // NO other face of another colour. Pairwise nudging cascaded.
        const idx = new Map();                     // plane cell -> face indices
        const cellOf = function (p) { return Math.round(p / CELL); };
        // the fixed planes of this side (walls, slabs, veneer, column caps)
        const wb = new Map();
        for (const w of W) {
          const key = cellOf(w[a * 2 + s]);
          let L = wb.get(key); if (!L) { L = []; wb.set(key, L); } L.push(w);
        }
        const fixedAt = function (i, p) {
          const k = cellOf(p);
          for (let kk = k - 1; kk <= k + 1; kk++) {
            const L = wb.get(kk); if (!L) continue;
            for (const w of L) {
              if (Math.abs(w[a * 2 + s] - p) > tol) continue;
              if (Math.min(B[i * 6 + u * 2 + 1], w[u * 2 + 1]) - Math.max(B[i * 6 + u * 2], w[u * 2]) < 0.002) continue;
              if (Math.min(B[i * 6 + v * 2 + 1], w[v * 2 + 1]) - Math.max(B[i * 6 + v * 2], w[v * 2]) < 0.002) continue;
              return true;
            }
          }
          return false;
        };
        const put = function (i) { const k = cellOf(B[i * 6 + a * 2 + s]); let L = idx.get(k); if (!L) { L = []; idx.set(k, L); } L.push(i); };
        const take = function (i) { const k = cellOf(B[i * 6 + a * 2 + s]); const L = idx.get(k); if (L) { const q = L.indexOf(i); if (q >= 0) L.splice(q, 1); } };
        for (let i = 0; i < n; i++) put(i);
        const overlapsUV = function (i, j) {
          return Math.min(B[i * 6 + u * 2 + 1], B[j * 6 + u * 2 + 1]) - Math.max(B[i * 6 + u * 2], B[j * 6 + u * 2]) >= 0.002 &&
                 Math.min(B[i * 6 + v * 2 + 1], B[j * 6 + v * 2 + 1]) - Math.max(B[i * 6 + v * 2], B[j * 6 + v * 2]) >= 0.002;
        };
        // does face i, set at plane p, share it with an overlapping face of another colour?
        const clash = function (i, p) {
          const k = cellOf(p);
          for (let kk = k - 1; kk <= k + 1; kk++) {
            const L = idx.get(kk); if (!L) continue;
            for (const j of L) {
              if (j === i || recs[j][6] === recs[i][6]) continue;
              if (Math.abs(B[j * 6 + a * 2 + s] - p) > tol) continue;
              if (overlapsUV(i, j)) return true;
            }
          }
          return fixedAt(i, p);
        };
        const order = [];
        for (let i = 0; i < n; i++) order.push(i);
        order.sort(function (p, q) { return B[p * 6 + a * 2 + s] - B[q * 6 + a * 2 + s]; });
        const dir = s === 1 ? -1 : 1;              // "back" = into the box
        let c0 = 0;
        while (c0 < order.length) {
          let c1 = c0 + 1;
          while (c1 < order.length && B[order[c1] * 6 + a * 2 + s] - B[order[c1 - 1] * 6 + a * 2 + s] <= tol) c1++;
          if (c1 - c0 >= 2) {
            const L = order.slice(c0, c1);
            const hit = new Set();
            for (let x = 0; x < L.length; x++) for (let y = x + 1; y < L.length; y++) {
              const i = L[x], j = L[y];
              if (recs[i][6] === recs[j][6]) continue;
              if (Math.abs(B[i * 6 + a * 2 + s] - B[j * 6 + a * 2 + s]) > tol) continue;
              if (!overlapsUV(i, j)) continue;
              if (W.length) {
                const u0 = Math.max(B[i * 6 + u * 2], B[j * 6 + u * 2]), u1 = Math.min(B[i * 6 + u * 2 + 1], B[j * 6 + u * 2 + 1]);
                const v0 = Math.max(B[i * 6 + v * 2], B[j * 6 + v * 2]), v1 = Math.min(B[i * 6 + v * 2 + 1], B[j * 6 + v * 2 + 1]);
                if (faceHidden(i, a, s, u, v, u0, u1, v0, v1)) continue;
              }
              hit.add(i); hit.add(j);
            }
            if (hit.size >= 2) {
              const H = Array.from(hit).sort(function (p, q) { return q - p; });   // latest first
              const base = B[H[0] * 6 + a * 2 + s];
              for (let r = 1; r < H.length; r++) {
                const i = H[r];
                if (!clash(i, B[i * 6 + a * 2 + s])) continue;    // an earlier move already freed it
                const size = B[i * 6 + a * 2 + 1] - B[i * 6 + a * 2];
                let placed = false;
                // back first (the box gives up depth), then forward
                for (let k = 1; k <= 12 && !placed; k++) {
                  if (size - EPS * k < 0.006) break;
                  const p = base + dir * EPS * k;
                  if (!clash(i, p)) { take(i); B[i * 6 + a * 2 + s] = p; put(i); placed = true; }
                }
                for (let k = 1; k <= 12 && !placed; k++) {
                  const p = base - dir * EPS * k;
                  if (!clash(i, p)) { take(i); B[i * 6 + a * 2 + s] = p; put(i); placed = true; }
                }
                if (placed) moved++;
              }
            }
          }
          c0 = c1;
        }
        // a deco face lying in a fixed face (a wall's, a slab's): out of it,
        // to the nearest free plane in 10 mm steps (never onto another face)
        if (W.length) {
          const outDir = s === 1 ? 1 : -1;
          for (let i = 0; i < n; i++) {
            const p0 = B[i * 6 + a * 2 + s];
            if (!fixedAt(i, p0)) continue;
            for (let k = 1; k <= 12; k++) {
              const p = p0 + outDir * EPS * k;
              if (!clash(i, p)) { take(i); B[i * 6 + a * 2 + s] = p; put(i); moved++; break; }
            }
          }
        }
      }
    }
    if (moved === movedBefore) break;
    }
    if (moved) for (let i = 0; i < n; i++) {
      const r = recs[i];
      r[0] = (B[i * 6] + B[i * 6 + 1]) / 2; r[3] = B[i * 6 + 1] - B[i * 6];
      r[1] = (B[i * 6 + 2] + B[i * 6 + 3]) / 2; r[4] = B[i * 6 + 3] - B[i * 6 + 2];
      r[2] = (B[i * 6 + 4] + B[i * 6 + 5]) / 2; r[5] = B[i * 6 + 5] - B[i * 6 + 4];
    }
    return moved;
  };

  /* ---- THE PATTERN, FOR THE DISTANCE -------------------------------------------
     What a far proxy needs to paint the same windows the near shell built: per
     face the opening rhythm (bays across the face, sill and head inside a
     storey) and the glass colour. Summarised from the openings actually cut,
     so near and far agree by construction. */
  FO.pattern = function (w, d, fh, storeys, openings) {
    const P = { fh: fh, storeys: storeys, faces: [] };
    for (let s = 0; s < 4; s++) {
      const mine = openings.filter(function (op) { return op.s === s && op.k > 0; });
      const all = mine.length ? mine : openings.filter(function (op) { return op.s === s; });
      if (!all.length) { P.faces.push({ n: 0, frac: 0, sill: 0, head: 0 }); continue; }
      // one storey's worth: the most-populated storey
      const byK = new Map();
      for (const op of all) { const a = byK.get(op.k) || []; a.push(op); byK.set(op.k, a); }
      let best = null;
      byK.forEach(function (a) { if (!best || a.length > best.length) best = a; });
      const span = (s < 2 ? w : d);
      let wsum = 0, sill = 0, head = 0;
      for (const op of best) { wsum += op.t1 - op.t0; sill += op.y0 - op.k * fh; head += op.y1 - op.k * fh; }
      const nB = best.length;
      P.faces.push({ n: nB, frac: Math.min(0.96, wsum / span), sill: sill / nB, head: head / nB,
        t0: Math.min.apply(null, best.map(function (op) { return op.t0; })), t1: Math.max.apply(null, best.map(function (op) { return op.t1; })) });
    }
    return P;
  };

  // a street number for a building with no address of its own: even on one
  // side of the street, odd on the other, position-hashed so it is the same
  // every boot (Gang City lots get theirs from the lot grid, buildings.js)
  FO.houseNumber = function (ox, oz, side) {
    const h = CBZ.hash01 ? CBZ.hash01(ox, oz, 0x4e0b) : 0.37;
    return 2 + 2 * Math.floor(h * 240) + ((side === 1 || side === 3) ? 1 : 0);
  };
  CBZ.facadeOpenings = FO;
})();
