/* ============================================================
   city/facades/house_parts.js — THE HOUSE PARTS: one carpentry for every
   domestic grammar (brickhouse, queenanne, victorian, ranch, spanish, manor,
   plantation, romanvilla, techhouse, machiya, greekrev, adobe, desertmod).

   WHY ONE FILE. The thirteen house grammars used to carry thirteen private
   copies of the same five things — a roof, an eave, a window surround, a
   porch, a chimney — each solved differently and each wrong in its own way:
   porch decks laid through the door carve (a notch cut out of the deck in
   front of every front door), roofs that were a stack of lids with no eave,
   no fascia and no soffit, window "surrounds" that were boxes painted over the
   wall with the real window somewhere else, a frieze band of the shell's own
   colour between the windows and the roof. A style is a set of PROPORTIONS
   and MATERIALS. The carpentry that turns those into boxes is the same for a
   Georgian and a ranch, so it lives here once and the grammars only say what
   they are.

   WHAT THE HOST GIVES US (city/facade_kit.js contract): ctx in, emitter calls
   out, axis-aligned boxes only, merged per colour (so a house costs the same
   draw calls as a bare box). There is no rotated primitive, so a pitched roof
   is COURSED: every course of tiles/shingles/slate is one box, stepped by the
   real course exposure (13-18 cm rise), which is how a roof actually reads at
   street distance — a ruled surface of lap shadows over a fascia line.

   THE RULES THESE PARTS KEEP (each one is a bug that used to ship):
     • EVERYTHING GOES THROUGH ctx.lbox. dressFacade's door carve wraps dbox
       only; it cuts every box on the entrance face that crosses a 1.9 m x
       2.4 m window round the door down to its stubs — a porch deck, a step,
       the skin beside the door. These parts leave the doorway open
       themselves (H.doorHole), so nothing needs carving.
     • WINDOWS ARE HOLES. The host reads the openings off where the grammar
       LEFT THE WALL OPEN (FO.scan) and builds a real framed window there. So
       a wall is a SKIN with holes (H.skin, cut with FO.solidRects), the trim
       stands round the hole, never in it, and every storey of every face is
       given enough window that the host's "clad solid" fallback never cuts a
       window of its own through a chimney (H.need).
     • THE PARAPET IS BURIED. The shell always builds a 0.55-1.05 m parapet
       and an 8 cm coping round the roof. A pitched roof's eave base is solved
       from it (H.eaveBase) so the coping is inside the roof mass and the
       soffit sits right on the wall: no frieze band, no coping ledge.
     • NO SHARED PLANES. Trim stands 1-3 cm off the skin it rides, a casing
       stops 1.5 cm short of the reveal, a gable core stands 11 cm proud (past
       the coping). Same-normal faces never lie in one plane.
     • DEPTH STAYS ON THE LOT. Nothing reaches more than its part says
       (eave <= 0.75, porch depth from the caller); facadeReach measures it
       and the host sizes the shell to fit.
     • DETERMINISM: variation only through ctx.hash.

   Faces: 0 = -z, 1 = +z, 2 = -x, 3 = +x. A face box is given in face terms:
   t along the face (local x on 0/1, local z on 2/3), y up, o out from the
   wall's outer plane (o < 0 is inside the wall).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function shade(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  }
  function mix(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return ((((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0));
  }

  // [a0,a1]x[y0,y1] minus holes, as rects. facade_openings.js has the real one
  // (a grid over the hole edges, runs merged); this is its fallback.
  function solidRects(a0, a1, y0, y1, hs) {
    const FO = CBZ.facadeOpenings;
    if (FO && FO.solidRects) return FO.solidRects(a0, a1, y0, y1, hs);
    const mine = hs.filter(function (h) { return h.a1 > a0 && h.a0 < a1 && h.y1 > y0 && h.y0 < y1; });
    if (!mine.length) return [[a0, a1, y0, y1]];
    const xs = [a0, a1];
    for (const h of mine) xs.push(Math.max(a0, h.a0), Math.min(a1, h.a1));
    xs.sort(function (p, q) { return p - q; });
    const out = [];
    for (let i = 0; i < xs.length - 1; i++) {
      const u0 = xs[i], u1 = xs[i + 1];
      if (u1 - u0 < 0.004) continue;
      const um = (u0 + u1) / 2;
      const cut = mine.filter(function (h) { return um > h.a0 && um < h.a1; }).map(function (h) { return [h.y0, h.y1]; });
      cut.sort(function (p, q) { return p[0] - q[0]; });
      let y = y0;
      for (const c of cut) { if (c[0] > y) out.push([u0, u1, y, Math.min(c[0], y1)]); y = Math.max(y, c[1]); }
      if (y < y1) out.push([u0, u1, y, y1]);
    }
    return out;
  }

  // 1-D: [a0,a1] minus the intervals in `cuts` ([[c0,c1]])
  function spans(a0, a1, cuts) {
    let out = [[a0, a1]];
    for (const c of cuts) {
      const nx = [];
      for (const r of out) {
        if (c[1] <= r[0] || c[0] >= r[1]) { nx.push(r); continue; }
        if (c[0] > r[0]) nx.push([r[0], c[0]]);
        if (c[1] < r[1]) nx.push([c[1], r[1]]);
      }
      out = nx;
    }
    return out.filter(function (r) { return r[1] - r[0] > 0.03; });
  }

  const HP = {};
  HP.clamp = clamp; HP.shade = shade; HP.mix = mix; HP.spans = spans;

  /* WHAT THIS HOUSE IS PAINTED. A grammar publishes its body / trim / roof
     colours against the building's world origin, so whatever is built round
     the house afterwards (city/house_yard.js: its garage wing, its fence)
     wears the house's own palette instead of guessing one. Deterministic: the
     same position always publishes the same colours (a dry run included). */
  const PAL = new Map();
  const palKey = function (x, z) { return Math.round(x * 4) + "," + Math.round(z * 4); };
  HP.palAt = function (x, z) { return PAL.get(palKey(x, z)) || null; };

  /* ---- THE BUILDER -----------------------------------------------------------
     H = HP.begin(ctx, F): the house's own numbers and the part emitters,
     bound to this ctx. Every part below hangs off H. */
  HP.begin = function (ctx, F) {
    const H = {};
    H.ctx = ctx; H.F = F;
    H.W = ctx.w; H.D = ctx.d; H.FH = ctx.FH || 3.2;
    H.ST = Math.max(1, ctx.storeys | 0);
    H.rTop = ctx.rTop != null ? ctx.rTop : H.ST * H.FH;
    H.PP = ctx.pp != null ? ctx.pp : 0.8;
    H.doorSide = ctx.doorSide | 0;
    H.noDoor = !!ctx.noDoor;
    H.doorW = ctx.doorW || 1.6;
    H.doorH = ctx.doorH || 2.25;
    H.driveIn = !!(ctx.showroom || ctx.garageGround);
    H.unit = Math.min(H.W, H.D);
    H.faces = [0, 1, 2, 3].map(function (s) { return F.face(ctx, s); });
    H.df = H.faces[H.doorSide];
    H.hash = function (salt) { return ctx.hash ? ctx.hash(salt) : 0.42; };
    H.pick = function (salt, arr) { return arr[Math.min(arr.length - 1, (H.hash(salt) * arr.length) | 0)]; };
    H.range = function (salt, lo, hi) { return lo + (hi - lo) * H.hash(salt); };
    H.sign = function (salt) { return H.hash(salt) < 0.5 ? -1 : 1; };
    H.face = function (s) { return H.faces[s]; };
    // the wall colour this street is painted in, for a light mix-in only
    H.base = (ctx.pal && ctx.pal.wall) || ctx.color || 0x9a948a;
    H.tint = function (hex, t) { return mix(hex, H.base, t == null ? 0.08 : t); };
    H.publish = function (p) {
      if (ctx.grid || !isFinite(ctx.ox) || !isFinite(ctx.oz)) return;
      if (PAL.size > 20000) PAL.clear();
      PAL.set(palKey(ctx.ox, ctx.oz), p);
    };
    const emit = typeof ctx.lbox === "function" ? ctx.lbox : ctx.dbox;

    // a local AABB
    H.ab = function (x0, x1, y0, y1, z0, z1, col) {
      if (x1 - x0 < 0.004 || y1 - y0 < 0.004 || z1 - z0 < 0.004) return;
      emit((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, col);
    };
    // a box in face terms
    H.fb = function (f, t0, t1, y0, y1, o0, o1, col) {
      if (t1 - t0 < 0.004 || y1 - y0 < 0.004 || o1 - o0 < 0.004) return;
      const n0 = f.out * (f.halfN + o0), n1 = f.out * (f.halfN + o1);
      const nc = (n0 + n1) / 2, nd = Math.abs(n1 - n0);
      const tc = (t0 + t1) / 2, tw = t1 - t0, yc = (y0 + y1) / 2, yh = y1 - y0;
      if (f.horiz) emit(tc, yc, nc, tw, yh, nd, col);
      else emit(nc, yc, tc, nd, yh, tw, col);
    };
    // a face point -> local {x, z}
    H.pt = function (f, t, o) {
      const n = f.out * (f.halfN + o);
      return f.horiz ? { x: t, z: n } : { x: n, z: t };
    };
    // a walk surface in face terms
    H.platF = function (f, t0, t1, o0, o1, top) {
      if (!ctx.plat) return;
      const a = H.pt(f, t0, o0), b = H.pt(f, t1, o1);
      ctx.plat(Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.z, b.z), Math.max(a.z, b.z), top);
    };
    // a collider in face terms (buildings.js only; a no-op elsewhere)
    H.solidF = function (f, t0, t1, y0, y1, o0, o1) {
      if (!ctx.solid) return;
      const a = H.pt(f, t0, o0), b = H.pt(f, t1, o1);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
      try { ctx.solid((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0); } catch (e) {}
    };
    H.lamp = function (f, t, y, o, r, col) {
      if (!ctx.lamp) return;
      const p = H.pt(f, t, o);
      ctx.lamp(p.x, y, p.z, r, col);
    };
    H.columnF = function (f, t, o, y, r, h, col, seg) {
      if (!ctx.column) { H.fb(f, t - r, t + r, y, y + h, o - r, o + r, col); return; }
      const p = H.pt(f, t, o);
      ctx.column(p.x, y, p.z, r, h, col, seg || 12);
    };

    /* THE DOOR COLOUR. dressFacade tints the real door leaf from the colours a
       grammar laid on the entrance face through dbox (everything here goes
       through lbox, so that list is otherwise empty). One swatch, inside the
       wall where nothing sees it, makes the door the colour the style wants.
       If the kit's tint rule rejects it (too close to the street's wall
       tone), the kit falls back to a darkened wall, which is still a door. */
    H.doorColour = function (col) {
      if (H.noDoor || typeof ctx.dbox !== "function") return;
      const f = H.df;
      const t1 = f.span / 2 - 0.12, t0 = t1 - 0.5;
      const n0 = f.out * (f.halfN - 0.24), n1 = f.out * (f.halfN - 0.012);
      if (f.horiz) ctx.dbox((t0 + t1) / 2, 1.5, (n0 + n1) / 2, 0.5, 2.4, Math.abs(n1 - n0), col);
      else ctx.dbox((n0 + n1) / 2, 1.5, (t0 + t1) / 2, Math.abs(n1 - n0), 2.4, 0.5, col);
    };

    // ---- the storey grid ----------------------------------------------------
    // a window may run from 0.6 m over a floor to 0.5 m under the next (the
    // host's scan band) — clamped here so what we draw is what it finds
    H.band = function (k) { return [k * H.FH + 0.6, (k + 1) * H.FH - 0.5]; };
    H.win = function (f, k, t, w, sill, head) {
      const b = H.band(k);
      const y0 = clamp(k * H.FH + sill, b[0], b[1] - 0.6);
      const y1 = clamp(k * H.FH + head, y0 + 0.6, b[1]);
      return { s: f.s, f: f, k: k, t: t, w: w, t0: t - w / 2, t1: t + w / 2, y0: y0, y1: y1 };
    };
    // the door's hole and the band a window must keep off it
    H.doorHole = function () {
      if (H.noDoor || H.driveIn) return null;
      return { s: H.doorSide, f: H.df, k: -1, door: true, t: 0, w: H.doorW, t0: -H.doorW / 2 - 0.02, t1: H.doorW / 2 + 0.02, y0: -0.4, y1: H.doorH + 0.02 };
    };
    H.DOOR_CLEAR = H.doorW / 2 + 0.85;          // the host splits windows round +-(doorW/2 + 0.75)
    // the window width a storey of a face needs so the host never forces one
    H.need = function (f) {
      const span = 2 * (f.span / 2 - 0.45);
      const want = Math.max(1, Math.floor((span + 3.1 - 1.1) / 3.1));
      return want * 1.1 * 0.55 + 0.12;
    };
    /* A ROW OF WINDOWS: n bays across face f on storey k (through F.bays, so a
       host's own bay grid — the metro's painted windows — is honoured), each
       w wide, minus any bay `skip(t, w)` vetoes. Widened until the storey
       carries H.need(f) of glass. */
    H.row = function (f, k, o) {
      const per = o.per || 3.0;
      let n = o.n != null ? o.n : F.bayCount(f, per, o.min || 1, o.max || 9);
      if (o.odd && !ctx.grid && n % 2 === 0) n = Math.max(1, n + (f.span / n > per ? 1 : -1));
      const bays = F.bays(f, n, o.margin != null ? o.margin : 0.9);
      const out = [];
      let w = o.w;
      for (let pass = 0; pass < 4; pass++) {
        out.length = 0;
        let have = 0;
        for (const b of bays) {
          const ww = Math.min(w, b.w - 0.5);
          if (ww < 0.55) continue;
          if (f.s === H.doorSide && k === 0 && !H.noDoor && Math.abs(b.t) < H.DOOR_CLEAR + ww / 2) continue;
          if (o.skip && o.skip(b.t, ww, b)) continue;
          out.push(H.win(f, k, b.t, ww, o.sill, o.head));
          have += ww;
        }
        if (have >= H.need(f) || o.fixed) break;
        w = Math.min(w * 1.25, 2.6);
      }
      return out;
    };

    /* ---- THE SKIN: a wall material laid over a face with holes in it ---------
       f, y0..y1, holes (any list; those of this face are used), col, proj.
       o.ext: run past the corner (default: proj on faces 0/1 so the four skins
       meet at the corners without a notch and without overlap), o.t0/t1 to
       limit it, o.margin to grow the holes (a stone surround's rebate). */
    H.skin = function (f, y0, y1, holes, col, proj, o) {
      o = o || {};
      if (y1 - y0 < 0.02) return;
      const ext = o.ext != null ? o.ext : (f.horiz ? proj : 0);
      const a0 = o.t0 != null ? o.t0 : -f.span / 2 - ext, a1 = o.t1 != null ? o.t1 : f.span / 2 + ext;
      const m = o.margin || 0;
      const hs = [];
      for (const h of holes || []) if (h && h.s === f.s && h.y1 > y0 && h.y0 < y1) hs.push({ a0: h.t0 - m, a1: h.t1 + m, y0: h.y0 - m, y1: h.y1 + m });
      for (const r of solidRects(a0, a1, y0, y1, hs)) H.fb(f, r[0], r[1], r[2], r[3], o.o0 || 0, proj, col);
    };
    // the same skin on every face
    H.skinAll = function (y0, y1, holes, col, proj, o) { for (const f of H.faces) H.skin(f, y0, y1, holes, col, proj, o); };
    /* COURSES: horizontal relief laid on a skin — a clapboard drip, a brick
       string, a shingle butt line. h tall, standing `proj` off the wall, every
       `pitch` metres, cut round the holes (with a 2 cm margin so a casing
       covers the cut end). */
    H.courses = function (f, y0, y1, holes, pitch, h, proj, col, o) {
      o = o || {};
      const ext = o.ext != null ? o.ext : (f.horiz ? proj : 0);
      const a0 = o.t0 != null ? o.t0 : -f.span / 2 - ext, a1 = o.t1 != null ? o.t1 : f.span / 2 + ext;
      let i = 0;
      for (let y = y0 + pitch; y < y1 - h * 0.5; y += pitch, i++) {
        const cuts = [];
        for (const hh of holes || []) if (hh && hh.s === f.s && y + h > hh.y0 - 0.02 && y < hh.y1 + 0.02) cuts.push([hh.t0 - 0.02, hh.t1 + 0.02]);
        const c = o.alt && (i % 2) ? o.alt : col;
        for (const r of spans(a0, a1, cuts)) H.fb(f, r[0], r[1], y, y + h, o.o0 != null ? o.o0 : proj - 0.02, proj, c);
      }
    };
    // a band round the house at y (a string course, a water table, a belt),
    // `proj` off the wall, cut round holes
    H.belt = function (y0, y1, holes, proj, col, o) {
      o = o || {};
      for (const f of (o.faces || H.faces)) {
        const ext = f.horiz ? proj : 0;
        const cuts = [];
        for (const hh of holes || []) if (hh && hh.s === f.s && y1 > hh.y0 && y0 < hh.y1) cuts.push([hh.t0 - 0.015, hh.t1 + 0.015]);
        for (const r of spans(-f.span / 2 - ext, f.span / 2 + ext, cuts)) H.fb(f, r[0], r[1], y0, y1, o.o0 || 0, proj, col);
      }
    };
    // a board/pier up each corner of the house, on both meeting faces
    H.cornerBoards = function (y0, y1, wid, proj, col) {
      for (const f of H.faces) for (const sg of [-1, 1]) {
        const e = f.span / 2 + (f.horiz ? proj : 0);
        H.fb(f, sg > 0 ? e - wid - (f.horiz ? 0 : 0) : -e, sg > 0 ? e : -e + wid, y0, y1, 0, proj, col);
      }
    };
    // QUOINS: alternating long and short dressed blocks up every corner
    H.quoins = function (y0, y1, len, h, proj, col, col2) {
      let k = 0;
      for (let y = y0; y + h <= y1 + 0.01; y += h, k++) {
        for (const f of H.faces) for (const sg of [-1, 1]) {
          const longOn = f.horiz ? (k % 2) === 1 : (k % 2) === 0;
          const ll = longOn ? len : len * 0.55;
          const e = f.span / 2 + (f.horiz ? proj : 0);
          const c = (k % 2) ? col : (col2 != null ? col2 : col);
          H.fb(f, sg > 0 ? e - ll : -e, sg > 0 ? e : -e + ll, y + 0.012, y + h - 0.012, 0, proj, c);
        }
      }
    };

    /* ---- A WINDOW'S TRIM -------------------------------------------------------
       op: an opening (H.win). o:
         skin   the skin's proj (the trim stands on it)
         cw     casing width; cp casing proj past the skin; col
         head   "flat" | "cap" (a moulded cornice) | "ped" (a pediment) |
                "seg" (a segmental brick arch) | "jack" (a flat jack arch with a
                keystone) | "none"
         sill   { h, proj, over, col } | null
         shut   { col, w (fraction of the window width), louvre } | null
         apron  true: a panel under the sill
         key    keystone colour                                             */
    H.trim = function (op, o) {
      const f = op.f || H.faces[op.s];
      const sk = o.skin || 0.04, cw = o.cw != null ? o.cw : 0.11, cp = o.cp != null ? o.cp : 0.03;
      const col = o.col, oA = sk - 0.012, oB = sk + cp;
      const t0 = op.t0 - 0.015, t1 = op.t1 + 0.015, y0 = op.y0, y1 = op.y1;
      if (cw > 0) {
        H.fb(f, t0 - cw, t0, y0, y1, oA, oB, col);
        H.fb(f, t1, t1 + cw, y0, y1, oA, oB, col);
      }
      const head = o.head || "flat";
      const hc = o.headCol != null ? o.headCol : col;
      if (head === "flat" && cw > 0) {
        H.fb(f, t0 - cw, t1 + cw, y1 + 0.015, y1 + 0.015 + cw, oA, oB, col);
      } else if (head === "cap") {
        H.fb(f, t0 - cw, t1 + cw, y1 + 0.015, y1 + 0.015 + cw * 1.3, oA, oB, col);
        H.fb(f, t0 - cw - 0.06, t1 + cw + 0.06, y1 + 0.015 + cw * 1.3, y1 + 0.075 + cw * 1.3, oA, oB + 0.06, hc);
        H.fb(f, t0 - cw - 0.03, t1 + cw + 0.03, y1 + 0.075 + cw * 1.3, y1 + 0.115 + cw * 1.3, oA, oB + 0.035, hc);
      } else if (head === "ped") {
        // a low triangular pediment: courses stepping in
        H.fb(f, t0 - cw, t1 + cw, y1 + 0.015, y1 + 0.015 + cw, oA, oB, col);
        const span = t1 - t0 + 2 * cw + 0.16, rise = clamp(span * 0.22, 0.18, 0.42), n = 4;
        for (let i = 0; i < n; i++) {
          const half = span / 2 * (1 - i / n);
          H.fb(f, (t0 + t1) / 2 - half, (t0 + t1) / 2 + half, y1 + 0.015 + cw + i * rise / n, y1 + 0.015 + cw + (i + 1) * rise / n, oA, oB + 0.05, hc);
        }
      } else if (head === "seg" || head === "jack") {
        // brick voussoirs over the head: a jack (flat, splayed) or a
        // segmental arch, with a keystone in the trim colour
        const n = 5, vw = (t1 - t0 + 0.2) / n, hh = o.archH || 0.24;
        for (let v = 0; v < n; v++) {
          const rise = head === "seg" ? 0.08 * (2 - Math.abs(v - 2)) : 0;
          const ta = t0 - 0.1 + v * vw;
          H.fb(f, ta + 0.008, ta + vw - 0.008, y1 + 0.012, y1 + hh + rise, oA, sk + 0.022, hc);
        }
        if (o.key != null) H.fb(f, (t0 + t1) / 2 - 0.09, (t0 + t1) / 2 + 0.09, y1 + 0.012, y1 + hh + 0.12, oA, sk + 0.05, o.key);
      }
      if (o.sill) {
        const S = o.sill;
        H.fb(f, t0 - cw - (S.over || 0.05), t1 + cw + (S.over || 0.05), y0 - 0.045 - (S.h || 0.07), y0 - 0.045, oA, sk + (S.proj || 0.07), S.col != null ? S.col : col);
      }
      if (o.apron) H.fb(f, t0, t1, y0 - 0.42, y0 - 0.14, oA, sk + 0.018, col);
      if (o.shut) {
        const S = o.shut, sw = clamp((op.t1 - op.t0) * (S.w || 0.5), 0.3, 0.7);
        const so0 = sk + 0.005, so1 = sk + 0.045;
        for (const sg of [-1, 1]) {
          const ta = sg < 0 ? t0 - cw - 0.02 - sw : t1 + cw + 0.02, tb = ta + sw;
          if (o.shutClip && !o.shutClip(ta, tb)) continue;
          H.fb(f, ta, tb, y0 + 0.02, y1 - 0.02, so0, so1, S.col);
          // two panels / louvre banks: the rails catch light
          const rc = S.rail != null ? S.rail : shade(S.col, 1.22);
          const ym = (y0 + y1) / 2;
          H.fb(f, ta + 0.04, tb - 0.04, ym - 0.03, ym + 0.03, so1 - 0.005, so1 + 0.012, rc);
          if (S.louvre) {
            for (let y = y0 + 0.2; y < y1 - 0.15; y += 0.38) {
              if (Math.abs(y - ym) < 0.12) continue;
              H.fb(f, ta + 0.05, tb - 0.05, y, y + 0.04, so1 - 0.004, so1 + 0.01, rc);
            }
          }
        }
      }
    };

    /* ---- THE PARAPET RULE --------------------------------------------------------
       Where a pitched roof's eave may sit (the underside of its lowest course
       at the wall line) so the shell's parapet AND its 8 cm coping are inside
       the roof: low enough that the coping is behind the eave, high enough
       that the slope clears the coping's top 10 cm out. */
    H.eaveBase = function (pitch, eave) {
      const top = H.rTop + H.PP + 0.12;              // the coping's top, with a margin
      const lo = top - pitch * Math.max(0, eave - 0.14);
      const hi = H.rTop + H.PP - 0.005;
      return Math.max(H.rTop + 0.05, Math.min(hi, lo));
    };

    /* ---- THE ROOF -------------------------------------------------------------------
       A coursed roof over a rectangle. Everything is written in roof space:
         u  along the ridge, v across it. put(u0,u1,v0,v1,y0,y1,col) maps it.
       H.roof(o) maps it onto the building (o.axis "x" | "z": the ridge
       direction; o.rect {x0,x1,z0,z1}: the wall rectangle, default the
       house). H.roofF(f, o) maps it onto a face (u = t, v = o: a porch roof).
       o:
         kind    "gable" | "hip" | "shed" (falls toward +v) | "pyr"
         base    eave base y (underside of the first course at the wall line)
         pitch   rise / run; step course rise (m); eave, rake overhangs
         roof, roof2   course colours (alternating: the lap line)
         core    gable infill colour (the gable wall); coreAlt (alternating:
                 shingled gable); coreProj (default 0.11: past the coping)
         soffit, fascia, gutter, ridge   colours (null = none)
         rakeBoard    true: a barge board stepping down each verge
         hipCaps      true: hip-ridge tiles down each hip
         v0clip, v1clip, u0clip, u1clip   clip the roof (a wall, a party wall)
       Returns { top, base, run, eave, hv(y) (half-width across at y) }.  */
    function stack(put, R, o) {
      const pitch = o.pitch, step = o.step || 0.15, run = step / pitch;
      const eave = o.eave != null ? o.eave : 0.45, rake = o.rake != null ? o.rake : eave * 0.7;
      const kind = o.kind || "gable";
      const uc = (R.u0 + R.u1) / 2, vc = (R.v0 + R.v1) / 2;
      const A = (R.u1 - R.u0) / 2, C = (R.v1 - R.v0) / 2;
      const base = o.base;
      const roof = o.roof, roof2 = o.roof2 != null ? o.roof2 : shade(o.roof, 0.9);
      const rh = o.ridgeHalf != null ? o.ridgeHalf : 0.07;
      const cp = o.coreProj != null ? o.coreProj : 0.11;
      const clipU0 = o.u0clip != null ? o.u0clip : -1e9, clipU1 = o.u1clip != null ? o.u1clip : 1e9;
      const clipV0 = o.v0clip != null ? o.v0clip : -1e9, clipV1 = o.v1clip != null ? o.v1clip : 1e9;
      const P = function (u0, u1, v0, v1, y0, y1, col) {
        u0 = Math.max(u0, clipU0); u1 = Math.min(u1, clipU1); v0 = Math.max(v0, clipV0); v1 = Math.min(v1, clipV1);
        if (u1 - u0 < 0.01 || v1 - v0 < 0.01 || y1 - y0 < 0.004) return;
        put(u0, u1, v0, v1, y0, y1, col);
      };
      const res = { base: base, run: run, eave: eave, top: base };
      const fasc = o.fascia, gut = o.gutter, sof = o.soffit;
      const fH = o.fasciaH || 0.2;
      if (kind === "gable") {
        const hv0 = C + eave;
        const n = Math.max(1, Math.ceil((hv0 - rh) / run));
        const thick = Math.max(run * 1.5, 0.22);
        const uo = A + rake;
        for (let i = 0; i < n; i++) {
          const y0 = base + i * step, y1 = y0 + step;
          const hv = Math.max(rh, hv0 - i * run);
          const col = (i % 2) ? roof2 : roof;
          if (hv - thick > 0.02 && o.core != null) {
            P(uc - uo, uc + uo, vc + hv - thick, vc + hv, y0, y1, col);
            P(uc - uo, uc + uo, vc - hv, vc - hv + thick, y0, y1, col);
            const cc = o.coreAlt != null && (i % 2) ? o.coreAlt : o.core;
            P(uc - A - cp, uc + A + cp, vc - hv + thick, vc + hv - thick, y0, y1, cc);
          } else {
            P(uc - uo, uc + uo, vc - hv, vc + hv, y0, y1, col);
          }
          if (o.rakeBoard && fasc != null) {
            const bw = Math.min(hv, run + 0.07);
            for (const su of [-1, 1]) {
              const ua = su > 0 ? uc + uo : uc - uo - 0.035, ub = ua + 0.035;
              P(ua, ub, vc + hv - bw, vc + hv, y0 - 0.02, y1, fasc);
              P(ua, ub, vc - hv, vc - hv + bw, y0 - 0.02, y1, fasc);
            }
          }
        }
        res.top = base + n * step;
        if (o.ridge != null) P(uc - uo - 0.02, uc + uo + 0.02, vc - rh - 0.07, vc + rh + 0.07, res.top - 0.03, res.top + 0.08, o.ridge);
        for (const sv of [-1, 1]) {
          const vin = vc + sv * C, vout = vc + sv * hv0;
          if (sof != null) P(uc - uo, uc + uo, Math.min(vin, vout), Math.max(vin, vout), base - 0.03, base, sof);
          if (fasc != null) P(uc - uo - 0.035, uc + uo + 0.035, sv > 0 ? vout : vout - 0.035, sv > 0 ? vout + 0.035 : vout, base - fH + step, base + step + 0.02, fasc);
          if (gut != null) P(uc - uo, uc + uo, sv > 0 ? vout + 0.035 : vout - 0.15, sv > 0 ? vout + 0.15 : vout - 0.035, base - 0.03, base + 0.1, gut);
        }
        res.hv = function (y) { return hv0 - (y - base) / pitch; };
        res.uo = uo;
      } else if (kind === "hip" || kind === "pyr") {
        const hv0 = C + eave, hu0 = A + eave;
        // the courses stop when the SHORTER side closes: the ridge runs along
        // the longer one (a pyramid when they are equal)
        let n = Math.max(1, Math.ceil((Math.min(hu0, hv0) - rh) / run));
        // a truncated hip (a mansard's lower slope): stop at maxH
        if (o.maxH != null) n = Math.min(n, Math.max(1, Math.round(o.maxH / step)));
        for (let i = 0; i < n; i++) {
          const y0 = base + i * step, y1 = y0 + step;
          const hv = Math.max(rh, hv0 - i * run), hu = Math.max(rh, hu0 - i * run);
          const col = (i % 2) ? roof2 : roof;
          P(uc - hu, uc + hu, vc - hv, vc + hv, y0, y1, col);
          if (o.hipCaps && o.ridge != null && hv > 0.25 && hu > 0.25) {
            for (const su of [-1, 1]) for (const sv of [-1, 1]) {
              const ua = uc + su * hu, va = vc + sv * hv;
              P(Math.min(ua, ua - su * 0.13), Math.max(ua, ua - su * 0.13), Math.min(va, va - sv * 0.13), Math.max(va, va - sv * 0.13), y0, y1 + 0.03, o.ridge);
            }
          }
        }
        res.top = base + n * step;
        const hu = Math.max(rh, hu0 - n * run), hvT = Math.max(rh, hv0 - n * run);
        res.huTop = Math.max(rh, hu0 - (n - 1) * run); res.hvTop = Math.max(rh, hv0 - (n - 1) * run); res.uc = uc; res.vc = vc;
        if (o.ridge != null && o.maxH == null) P(uc - hu - 0.04, uc + hu + 0.04, vc - hvT - 0.06, vc + hvT + 0.06, res.top - 0.03, res.top + 0.08, o.ridge);
        // the eave ring: soffit, fascia, gutter on all four sides
        const ring = function (col, d0, d1, ya, yb) {
          // d0..d1: offsets from the roof's outer edge (negative = inward)
          P(uc - hu0 - d1, uc + hu0 + d1, vc + hv0 + d0, vc + hv0 + d1, ya, yb, col);
          P(uc - hu0 - d1, uc + hu0 + d1, vc - hv0 - d1, vc - hv0 - d0, ya, yb, col);
          P(uc + hu0 + d0, uc + hu0 + d1, vc - hv0 - d0, vc + hv0 + d0, ya, yb, col);
          P(uc - hu0 - d1, uc - hu0 - d0, vc - hv0 - d0, vc + hv0 + d0, ya, yb, col);
        };
        if (sof != null) {
          P(uc - hu0, uc + hu0, vc + C, vc + hv0, base - 0.03, base, sof);
          P(uc - hu0, uc + hu0, vc - hv0, vc - C, base - 0.03, base, sof);
          P(uc + A, uc + hu0, vc - C, vc + C, base - 0.03, base, sof);
          P(uc - hu0, uc - A, vc - C, vc + C, base - 0.03, base, sof);
        }
        if (fasc != null) ring(fasc, 0, 0.035, base - fH + step, base + step + 0.02);
        if (gut != null) ring(gut, 0.035, 0.15, base - 0.03, base + 0.1);
        res.hv = function (y) { return hv0 - (y - base) / pitch; };
      } else if (kind === "shed") {
        // high side at v0 (into a wall), falls toward v1
        const hv1 = R.v1 + eave, v0 = R.v0 - (o.back != null ? o.back : 0);
        const n = Math.max(1, Math.ceil((hv1 - v0 - 0.12) / run));
        const uo = A + rake;
        for (let i = 0; i < n; i++) {
          const y0 = base + i * step, y1 = y0 + step;
          const v1 = hv1 - i * run;
          if (v1 - v0 < 0.06) break;
          P(uc - uo, uc + uo, v0, v1, y0, y1, (i % 2) ? roof2 : roof);
          if (o.rakeBoard && fasc != null) for (const su of [-1, 1]) {
            const ua = su > 0 ? uc + uo : uc - uo - 0.035;
            P(ua, ua + 0.035, Math.max(v0, v1 - run - 0.07), v1, y0 - 0.02, y1, fasc);
          }
        }
        res.top = base + n * step;
        if (sof != null) P(uc - uo, uc + uo, R.v1, hv1, base - 0.03, base, sof);
        if (fasc != null) P(uc - uo - 0.035, uc + uo + 0.035, hv1, hv1 + 0.035, base - fH + step, base + step + 0.02, fasc);
        if (gut != null) P(uc - uo, uc + uo, hv1 + 0.035, hv1 + 0.15, base - 0.03, base + 0.1, gut);
      }
      return res;
    }
    H.stack = stack;
    H.roof = function (o) {
      const R0 = o.rect || { x0: -H.W / 2, x1: H.W / 2, z0: -H.D / 2, z1: H.D / 2 };
      const ax = o.axis || "x";
      let put, R;
      if (ax === "x") {
        put = function (u0, u1, v0, v1, y0, y1, col) { H.ab(u0, u1, y0, y1, v0, v1, col); };
        R = { u0: R0.x0, u1: R0.x1, v0: R0.z0, v1: R0.z1 };
      } else {
        put = function (u0, u1, v0, v1, y0, y1, col) { H.ab(v0, v1, y0, y1, u0, u1, col); };
        R = { u0: R0.z0, u1: R0.z1, v0: R0.x0, v1: R0.x1 };
      }
      if (o.flipShed) {
        // a shed falling toward -v: mirror v
        const put0 = put;
        put = function (u0, u1, v0, v1, y0, y1, col) { put0(u0, u1, -v1, -v0, y0, y1, col); };
        R = { u0: R.u0, u1: R.u1, v0: -R.v1, v1: -R.v0 };
      }
      return stack(put, R, o);
    };
    // a roof in face terms: u = t along the face, v = o out from it (a shed
    // over a porch falls away from the wall). Clipped at the wall plane.
    H.roofF = function (f, t0, t1, o0, o1, o) {
      const put = function (u0, u1, v0, v1, y0, y1, col) { H.fb(f, u0, u1, y0, y1, v0, v1, col); };
      return stack(put, { u0: t0, u1: t1, v0: o0, v1: o1 }, Object.assign({ v0clip: o.v0clip != null ? o.v0clip : -0.02 }, o));
    };
    /* A CROSS GABLE: a gable whose ridge runs OUT through face f, its
       gable end standing in that face's plane (o.coreProj proud). tc, wg: its
       centre and width along the face; it runs `back` metres into the house
       (where the main roof swallows it). Same options as H.roof. */
    H.crossGable = function (f, tc, wg, back, o) {
      const put = function (u0, u1, v0, v1, y0, y1, col) { H.fb(f, v0, v1, y0, y1, u0, u1, col); };
      return stack(put, { u0: -back, u1: 0, v0: tc - wg / 2, v1: tc + wg / 2 }, Object.assign({ kind: "gable" }, o));
    };
    // a flat roof's edge: a deep fascia slab oversailing the walls by `ov`,
    // `h` thick, its top at y (desert modern, the tech house, a porch deck)
    H.slab = function (y, h, ov, col, rect, edgeCol) {
      const R = rect || { x0: -H.W / 2, x1: H.W / 2, z0: -H.D / 2, z1: H.D / 2 };
      H.ab(R.x0 - ov, R.x1 + ov, y - h, y, R.z0 - ov, R.z1 + ov, col);
      if (edgeCol != null) H.ab(R.x0 - ov - 0.02, R.x1 + ov + 0.02, y - h - 0.02, y - h + 0.06, R.z0 - ov - 0.02, R.z1 + ov + 0.02, edgeCol);
    };

    /* ---- A DORMER on a gable or hip slope ----------------------------------------
       r: the roof H.roof returned; axis: its ridge axis; side +-1 (which
       slope), u: position along the ridge, w: window width, h: window height,
       cols { cheek, trim, roof, roof2, glass }. The dormer's face stands
       `set` metres inside the wall line; its own little gable ridges run
       back into the main slope. */
    H.dormer = function (r, axis, side, u, w, h, cols, o) {
      o = o || {};
      // C: the wall line's distance from the ridge on this slope; vc: where the
      // ridge line is (a roof over a gallery is not centred on the house)
      const C = o.C != null ? o.C : (axis === "x" ? H.D : H.W) / 2;
      const vc = o.vc || 0;
      const set = o.set != null ? o.set : 0.35;
      const vF = C - set;                                   // the dormer face, from the ridge line
      const ySill = r.base + (C + r.eave - vF) * (o.pitch || 0.8) + 0.12;
      const jw = 0.12, ow = w + 2 * jw;
      const yTop = ySill + h + 0.16;
      const pitchM = o.pitch || 0.8;
      // how far back the cheeks must run before the main slope swallows them
      const back = (yTop + 0.25 - r.base) / pitchM - (C + r.eave - vF);
      const dep = Math.max(0.6, back + 0.2);
      const putV = function (u0, u1, v0, v1, y0, y1, col) {
        // v measured from the ridge line toward this slope's eave
        const va = vc + (side > 0 ? v0 : -v1), vb = vc + (side > 0 ? v1 : -v0);
        if (axis === "x") H.ab(u0, u1, y0, y1, va, vb, col); else H.ab(va, vb, y0, y1, u0, u1, col);
      };
      // the cheeks + front wall
      putV(u - ow / 2, u + ow / 2, vF - dep, vF, ySill - 0.3, yTop, cols.cheek);
      // the trim frame, glass and sill on the front
      putV(u - ow / 2 - 0.02, u - w / 2, vF, vF + 0.04, ySill, yTop - 0.02, cols.trim);
      putV(u + w / 2, u + ow / 2 + 0.02, vF, vF + 0.04, ySill, yTop - 0.02, cols.trim);
      putV(u - ow / 2 - 0.02, u + ow / 2 + 0.02, vF, vF + 0.04, yTop - 0.14, yTop, cols.trim);
      putV(u - w / 2, u + w / 2, vF - 0.06, vF - 0.02, ySill + 0.02, yTop - 0.14, cols.glass);
      putV(u - w / 2, u + w / 2, vF - 0.03, vF + 0.0, (ySill + yTop - 0.14) / 2 - 0.025, (ySill + yTop - 0.14) / 2 + 0.025, cols.trim);
      putV(u - ow / 2 - 0.06, u + ow / 2 + 0.06, vF - 0.02, vF + 0.08, ySill - 0.06, ySill + 0.02, cols.trim);
      // its roof: a little gable, ridge running back into the slope
      const put2 = function (uu0, uu1, vv0, vv1, y0, y1, col) { putV(vv0, vv1, uu0, uu1, y0, y1, col); };
      // in put2, u is "back along the dormer" (the main v), v is across it (the main u)
      const kind = o.kind || "gable";
      if (kind === "shed") {
        putV(u - ow / 2 - 0.12, u + ow / 2 + 0.12, vF - dep, vF + 0.22, yTop, yTop + 0.14, cols.roof);
        putV(u - ow / 2 - 0.12, u + ow / 2 + 0.12, vF + 0.18, vF + 0.22, yTop - 0.1, yTop + 0.14, cols.trim);
      } else {
        stack(put2, { u0: vF - dep, u1: vF, v0: u - ow / 2, v1: u + ow / 2 }, {
          kind: kind === "hip" ? "hip" : "gable", base: yTop, pitch: o.dPitch || 1.0, step: 0.12, eave: 0.14, rake: 0.18,
          roof: cols.roof, roof2: cols.roof2, core: cols.cheek, coreProj: 0.02, fascia: cols.trim, rakeBoard: true, u1clip: vF + 0.2 });
      }
      return { ySill: ySill, yTop: yTop };
    };

    /* ---- A CHIMNEY -------------------------------------------------------------------
       Exterior (o.f set: a breast up a gable end at tangent t, `dp` deep, with
       weathered shoulders) or interior (o.x, o.z: a stack rising out of the
       roof). top: the cap's top (keep it 0.6-0.9 m over the ridge).
       cols { brick, cap, pot }.                                            */
    H.chimney = function (o) {
      const w = o.w || 0.9, dp = o.dp || 0.6, top = o.top, brick = o.brick, cap = o.cap != null ? o.cap : shade(brick, 1.12);
      const pot = o.pot != null ? o.pot : 0x7a4a36;
      let box;
      if (o.f) {
        const f = o.f, t = o.t || 0;
        box = function (hw, y0, y1, d0, d1, col) { H.fb(f, t - hw, t + hw, y0, y1, d0, d1, col); };
        const sh = o.shoulder != null ? o.shoulder : H.rTop - 0.8;    // where the breast narrows
        // the breast, wide to the shoulder, then the stack
        box(w * 0.68, 0, sh, 0, dp + 0.12, brick);
        for (let i = 0; i < 3; i++) box(w * 0.68 - (w * 0.18) * (i + 1) / 3, sh + i * 0.14, sh + (i + 1) * 0.14, 0, dp + 0.12 - 0.04 * (i + 1), shade(brick, 0.94));
        box(w / 2, sh + 0.42, top - 0.3, 0, dp, brick);
        box(w / 2 + 0.07, top - 0.3, top - 0.16, -0.04, dp + 0.07, cap);
        box(w / 2 + 0.035, top - 0.16, top - 0.06, -0.02, dp + 0.035, shade(cap, 0.92));
        const nPot = o.pots != null ? o.pots : (w > 0.8 ? 2 : 1);
        for (let i = 0; i < nPot; i++) {
          const tt = nPot === 1 ? 0 : (i ? 1 : -1) * w * 0.22;
          H.fb(f, t + tt - 0.1, t + tt + 0.1, top - 0.06, top + 0.32, dp * 0.5 - 0.1, dp * 0.5 + 0.1, pot);
        }
        H.fb(f, t - w * 0.68 - 0.05, t + w * 0.68 + 0.05, 0, 0.3, 0, dp + 0.18, shade(brick, 0.8));
      } else {
        const x = o.x, z = o.z, y0 = o.y0 != null ? o.y0 : H.rTop;
        const hx = (o.alongX !== false ? w : dp) / 2, hz = (o.alongX !== false ? dp : w) / 2;
        H.ab(x - hx, x + hx, y0, top - 0.3, z - hz, z + hz, brick);
        H.ab(x - hx - 0.07, x + hx + 0.07, top - 0.3, top - 0.16, z - hz - 0.07, z + hz + 0.07, cap);
        H.ab(x - hx - 0.035, x + hx + 0.035, top - 0.16, top - 0.06, z - hz - 0.035, z + hz + 0.035, shade(cap, 0.92));
        const nPot = o.pots != null ? o.pots : (w > 0.8 ? 2 : 1);
        for (let i = 0; i < nPot; i++) {
          const off = nPot === 1 ? 0 : (i ? 1 : -1) * Math.max(hx, hz) * 0.45;
          const px = o.alongX !== false ? x + off : x, pz = o.alongX !== false ? z : z + off;
          H.ab(px - 0.1, px + 0.1, top - 0.06, top + 0.32, pz - 0.1, pz + 0.1, pot);
        }
      }
    };

    /* ---- A RAIL between t0 and t1 at offset o (a porch balustrade, a
       balcony): a top rail, a bottom rail, balusters at `pitch`. */
    H.rail = function (f, t0, t1, o, y0, h, col, pitch, wid) {
      const rw = wid || 0.08;
      H.fb(f, t0, t1, y0 + h - 0.07, y0 + h, o - rw / 2 - 0.01, o + rw / 2 + 0.01, col);
      H.fb(f, t0, t1, y0 + 0.08, y0 + 0.14, o - rw / 2, o + rw / 2, col);
      const p = pitch || 0.16;
      const n = Math.max(1, Math.round((t1 - t0) / p));
      for (let i = 1; i < n; i++) {
        const t = t0 + (t1 - t0) * i / n;
        H.fb(f, t - 0.022, t + 0.022, y0 + 0.14, y0 + h - 0.07, o - 0.022, o + 0.022, col);
      }
    };
    // the same rail running OUT from the wall (a porch's end rail): along o
    H.railOut = function (f, t, o0, o1, y0, h, col, pitch) {
      H.fb(f, t - 0.05, t + 0.05, y0 + h - 0.07, y0 + h, o0, o1, col);
      H.fb(f, t - 0.04, t + 0.04, y0 + 0.08, y0 + 0.14, o0, o1, col);
      const p = pitch || 0.16, n = Math.max(1, Math.round((o1 - o0) / p));
      for (let i = 1; i < n; i++) {
        const oo = o0 + (o1 - o0) * i / n;
        H.fb(f, t - 0.022, t + 0.022, y0 + 0.14, y0 + h - 0.07, oo - 0.022, oo + 0.022, col);
      }
    };

    /* ---- A PORCH on face f, t0..t1, `dep` deep. ---------------------------------
       The deck's top is 3 cm UNDER the host's door threshold (0.13): the
       door opens onto it, never into it. Posts at real spacing (o.bay,
       ~2.4 m), never in the doorway; a beam; a roof (shed / hip / flat / none);
       a rail on the open bays (o.railCol); steps where the walk meets the
       door. o:
         deckCol, postCol, beamCol, post (width) | round (radius: a turned
         or classical column), beamB (beam underside), beamH, roof {...stack
         options, kind}, railCol, skirtCol, ceilCol, noSteps                  */
    H.DECK = 0.10;
    H.porch = function (f, t0, t1, dep, o) {
      const deck = H.DECK;
      const dc = o.deckCol, pc = o.postCol, bc = o.beamCol != null ? o.beamCol : pc;
      // deck + its nosing + the skirt under it
      H.fb(f, t0, t1, -0.3, deck - 0.03, 0, dep, o.skirtCol != null ? o.skirtCol : shade(dc, 0.7));
      H.fb(f, t0 - 0.03, t1 + 0.03, deck - 0.03, deck, 0, dep + 0.03, dc);
      H.platF(f, t0, t1, 0, dep, deck);
      // posts: at the corners and every ~bay, never in the doorway
      const pw = o.post || 0.16;
      const span = t1 - t0, nb = Math.max(1, Math.round(span / (o.bay || 2.4)));
      const pts = [];
      for (let i = 0; i <= nb; i++) {
        const t = t0 + pw / 2 + 0.04 + (span - pw - 0.08) * i / nb;
        if (f.s === H.doorSide && !H.noDoor && Math.abs(t) < H.doorW / 2 + 0.35 + pw / 2) continue;
        pts.push(t);
      }
      const beamB = o.beamB != null ? o.beamB : Math.min(H.FH - 0.35, 2.75);
      const beamH = o.beamH || 0.24;
      const po = dep - pw / 2 - 0.06;
      for (const t of pts) {
        if (o.round) {
          H.columnF(f, t, po, deck + 0.18, o.round, beamB - deck - 0.18 - 0.14, pc, 12);
          H.fb(f, t - o.round - 0.05, t + o.round + 0.05, deck, deck + 0.18, po - o.round - 0.05, po + o.round + 0.05, pc);
          H.fb(f, t - o.round - 0.06, t + o.round + 0.06, beamB - 0.14, beamB, po - o.round - 0.06, po + o.round + 0.06, pc);
        } else {
          H.fb(f, t - pw / 2, t + pw / 2, deck, beamB, po - pw / 2, po + pw / 2, pc);
          H.fb(f, t - pw / 2 - 0.04, t + pw / 2 + 0.04, deck, deck + 0.22, po - pw / 2 - 0.04, po + pw / 2 + 0.04, pc);
          H.fb(f, t - pw / 2 - 0.03, t + pw / 2 + 0.03, beamB - 0.12, beamB - 0.02, po - pw / 2 - 0.03, po + pw / 2 + 0.03, pc);
          if (o.brackets) for (const sg of [-1, 1]) {
            H.fb(f, t + sg * pw / 2 + (sg > 0 ? 0 : -0.22), t + sg * pw / 2 + (sg > 0 ? 0.22 : 0), beamB - 0.1, beamB, po - 0.03, po + 0.03, o.brackets);
            H.fb(f, t + sg * pw / 2 + (sg > 0 ? 0 : -0.1), t + sg * pw / 2 + (sg > 0 ? 0.1 : 0), beamB - 0.28, beamB - 0.1, po - 0.03, po + 0.03, o.brackets);
          }
        }
        H.solidF(f, t - pw / 2, t + pw / 2, deck, beamB, po - pw / 2, po + pw / 2);
      }
      // a spindle frieze hung under the beam between the posts
      if (o.frieze != null) {
        H.fb(f, t0 + 0.05, t1 - 0.05, beamB - 0.32, beamB - 0.27, po - 0.025, po + 0.025, o.frieze);
        for (let t = t0 + 0.2; t < t1 - 0.15; t += 0.2) {
          if (f.s === H.doorSide && !H.noDoor && Math.abs(t) < H.doorW / 2 + 0.2) continue;
          H.fb(f, t - 0.018, t + 0.018, beamB - 0.27, beamB, po - 0.018, po + 0.018, o.frieze);
        }
      }
      // the beam (fascia of the porch), and the ceiling boards
      H.fb(f, t0, t1, beamB, beamB + beamH, dep - pw - 0.08, dep, bc);
      if (o.ceilCol != null) H.fb(f, t0, t1, beamB + beamH - 0.03, beamB + beamH, 0.02, dep - pw - 0.08, o.ceilCol);
      // the rail on every open bay, broken at the steps
      if (o.railCol != null) {
        const ro = po;
        const all = [t0 + 0.04].concat(pts).concat([t1 - 0.04]).sort(function (a, b) { return a - b; });
        for (let i = 0; i < all.length - 1; i++) {
          const a = all[i] + pw / 2, b = all[i + 1] - pw / 2;
          if (b - a < 0.3) continue;
          if (f.s === H.doorSide && !H.noDoor && a < H.doorW / 2 + 0.4 && b > -H.doorW / 2 - 0.4) continue;   // the steps
          H.rail(f, a, b, ro, deck, 0.86, o.railCol, 0.15);
        }
        if (o.endRails !== false) for (const tt of [t0 + pw / 2 + 0.04, t1 - pw / 2 - 0.04]) H.railOut(f, tt, 0.15, po - pw / 2, deck, 0.86, o.railCol, 0.15);
      }
      // steps down to the walk in front of the door
      if (!o.noSteps && f.s === H.doorSide) {
        const sw = Math.min(span - 0.2, H.doorW + 0.8);
        H.fb(f, -sw / 2, sw / 2, -0.3, deck * 0.5, dep, dep + 0.32, o.stepCol != null ? o.stepCol : dc);
        H.platF(f, -sw / 2, sw / 2, dep, dep + 0.32, deck * 0.5);
      }
      // the roof
      let r = null;
      if (o.roof) {
        const R = o.roof;
        const top = beamB + beamH;
        if (R.kind === "flat") {
          H.fb(f, t0 - 0.12, t1 + 0.12, top, top + (R.h || 0.18), -0.02, dep + 0.14, R.roof);
          if (R.fascia != null) H.fb(f, t0 - 0.14, t1 + 0.14, top - 0.02, top + (R.h || 0.18) + 0.02, dep + 0.14, dep + 0.17, R.fascia);
          if (R.rail != null) H.rail(f, t0 - 0.05, t1 + 0.05, dep + 0.05, top + (R.h || 0.18), 0.9, R.rail, 0.15);
          r = { top: top + (R.h || 0.18) };
        } else if (R.kind === "hip") {
          r = H.porchHip(f, t0, t1, dep, top, R);
        } else {
          r = H.roofF(f, t0, t1, 0, dep, Object.assign({ base: top, kind: "shed", eave: 0.22, rake: 0.18 }, R));
        }
      }
      return { beamB: beamB, top: r ? r.top : beamB + beamH, posts: pts, roof: r };
    };
    // a hip roof over a porch: mirror the rectangle into the house so the
    // ridge lands on the wall, and clip at the wall plane
    H.porchHip = function (f, t0, t1, dep, base, o) {
      return H.roofF(f, t0, t1, -dep, dep, Object.assign({ base: base, kind: "hip", eave: 0.25, v0clip: -0.02 }, o));
    };

    /* ---- THE ENTRANCE: a doorcase round the shell's real door ------------------
       kind: "casing" (flat boards), "pilaster" (pilasters + entablature),
       "ped" (pilasters + a pediment), "fan" (an arched fanlight surround),
       "arch" (a round-headed stone arch), "none". o: { col, skin, w (board),
       cap colour, lamp: {col, side} | null, step: {col, w, d} | null } */
    H.doorcase = function (kind, o) {
      if (H.noDoor || H.driveIn) return;
      const f = H.df, sk = o.skin || 0.04, col = o.col, cw = o.w || 0.16;
      const hw = H.doorW / 2 + 0.015, top = H.doorH + 0.02;
      const oA = sk - 0.012;
      if (kind === "casing" || kind === "pilaster" || kind === "ped" || kind === "fan") {
        const pp = kind === "casing" ? 0.035 : 0.09;
        for (const sg of [-1, 1]) {
          const a = sg < 0 ? -hw - cw : hw;
          H.fb(f, a, a + cw, 0.02, top, oA, sk + pp, col);
          if (kind !== "casing") {
            H.fb(f, a - 0.03, a + cw + 0.03, 0.02, 0.24, oA, sk + pp + 0.03, col);                 // plinth
            H.fb(f, a - 0.03, a + cw + 0.03, top - 0.14, top, oA, sk + pp + 0.03, col);           // capital
          }
        }
        H.fb(f, -hw - cw, hw + cw, top, top + (kind === "casing" ? cw : 0.3), oA, sk + pp, col);   // head / frieze
        if (kind !== "casing") {
          H.fb(f, -hw - cw - 0.08, hw + cw + 0.08, top + 0.3, top + 0.4, oA, sk + pp + 0.1, o.cap != null ? o.cap : col);
        }
        if (kind === "ped") {
          const span = 2 * (hw + cw + 0.08), rise = span * 0.2, n = 5;
          for (let i = 0; i < n; i++) {
            const half = span / 2 * (1 - (i + 0.5) / n);
            H.fb(f, -half, half, top + 0.4 + i * rise / n, top + 0.4 + (i + 1) * rise / n, oA, sk + pp + 0.08, o.cap != null ? o.cap : col);
          }
        }
        if (kind === "fan") {
          // a semicircular fanlight head over the door (stepped), with radiating bars
          const R = hw + cw, n = 5;
          for (let i = 0; i < n; i++) {
            const u = (i + 0.5) / n, half = R * Math.sqrt(1 - u * u);
            H.fb(f, -half - 0.04, -half + 0.12, top + 0.4 + i * R / n, top + 0.4 + (i + 1) * R / n, oA, sk + pp, col);
            H.fb(f, half - 0.12, half + 0.04, top + 0.4 + i * R / n, top + 0.4 + (i + 1) * R / n, oA, sk + pp, col);
          }
          H.fb(f, -0.1, 0.1, top + 0.4 + R - 0.1, top + 0.5 + R, oA, sk + pp + 0.04, o.cap != null ? o.cap : col);
        }
      } else if (kind === "arch") {
        const R = hw + 0.02;
        for (const sg of [-1, 1]) H.fb(f, sg < 0 ? -hw - cw : hw, sg < 0 ? -hw : hw + cw, 0.02, top, oA, sk + 0.06, col);
        const n = 6;
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n, half = R * Math.sqrt(1 - u * u);
          H.fb(f, -R - cw, -half, top + i * R / n, top + (i + 1) * R / n, oA, sk + 0.06, col);
          H.fb(f, half, R + cw, top + i * R / n, top + (i + 1) * R / n, oA, sk + 0.06, col);
        }
        H.fb(f, -R - cw, R + cw, top + R, top + R + cw, oA, sk + 0.06, col);
      }
      if (o.lamp) {
        const side = o.lamp.side || 1, t = side * (hw + cw + 0.32), y = Math.min(H.doorH + 0.05, 2.1);
        H.fb(f, t - 0.07, t + 0.07, y - 0.16, y + 0.16, sk - 0.01, sk + 0.03, 0x24272b);
        H.fb(f, t - 0.025, t + 0.025, y - 0.03, y + 0.03, sk + 0.03, sk + 0.13, 0x24272b);
        H.lamp(f, t, y - 0.06, sk + 0.17, 0.075, o.lamp.col || 0xffd79a);
      }
      if (o.step) {
        const S = o.step, sw = S.w || H.doorW + 0.7, sd = S.d || 0.4;
        H.fb(f, -sw / 2, sw / 2, -0.3, H.DECK, 0, sd, S.col);
        H.platF(f, -sw / 2, sw / 2, 0, sd, H.DECK);
      }
    };
    return H;
  };

  CBZ.HOUSE_PARTS = HP;
})();
