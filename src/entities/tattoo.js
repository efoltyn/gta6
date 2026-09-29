/* ============================================================
   entities/tattoo.js — INK IN SKIN.

   OWNER (2026-09-29): "i want an opus on tattoos ... as if it was drawn by a
   little kid and you are a 3D and drawing genius."

   What was here before: heritage.js drew a sleeve as a handful of fillRects
   into clothes.js's 128x256 outfit atlas (the whole arm was 64x40 pixels), and
   head ink as squiggles on a 128x64 canvas. Blocks, not tattoos.

   What this file is: ONE owner for every mark on skin, in three steps.

   1. CHARTS. Each body surface that can show skin has a cylindrical /
      atlas chart that matches the UVs of the mesh it lands on:
        arm    the WHOLE arm, shoulder (canvas top) to wrist (bottom), u round
               the limb. character.js's flat limb loft maps its upper segment
               into y [0, ARM_SPLIT] and its forearm into [ARM_SPLIT, 1] (so
               one texture spans both and a web can sit ACROSS the elbow).
               u follows the loft's quadrants (front, +x, back, -x).
        fore   first person only: the forearm alone at several times the density, laid
               for fphands' real-proportioned forearm (lathe u = angle).
        head   character.js HEAD_ATLAS: front / side (both sides, mirrored) /
               back columns, skull y [0, .8], neck [.8, 1].
        hand   fphands' hand: four finger columns (knuckle -> tip) and the
               back of the hand as a planar patch; the palm side reads blank.
      A chart is drawn WHITE with ink on it. It goes on the skin material as
      `map`, and material.color is the skin tone, so the renderer multiplies
      ink through skin exactly as ink sits under the epidermis: dark on light
      skin, faint on dark skin, and every tint (hit flash, corpse grey, a
      crowd promotion's repaint) keeps working with no knowledge of ink.

   2. DESIGNS. A real motif library drawn at chart resolution in physical
      units (anisotropic transforms undo each chart's stretch, so a rose is
      round ON THE ARM, and every motif is tiled at u-1/u/u+1 so it wraps):
      roses, skulls, elbow webs, barbed wire, script words, area codes in old
      english, clocks with no hands, masks, crosses and rays, rosaries,
      nautical and eight-point stars, domes, daggers, swallows, anchors,
      irezumi scales and blossoms, Polynesian and batok bands, yant rows,
      knuckle letters and finger rings, teardrops, dots. Then the INK pass:
      a blown-out halo and a softened copy under the line (ink spreads in the
      dermis), uneven saturation, age (fresh blue-black -> old blue-green
      grey, softer), and homemade prison ink goes shakier and bluer.

   3. PEOPLE. A profile per rig (ch._inkProfile), rolled once: a prison man's
      from his heritage ink family (heritage.js: chicano, paisa, block,
      vory, yant, ...), a city person's from a sparser, cleaner street set
      (some colour: traditional, fine line, an armband). refresh(ch) puts
      the ink on whatever of his skin is BARE right now: a flat skin arm
      segment, the hands, the head. A sleeve, a glove, a painted garment is
      left alone, so dressing and undressing need no bookkeeping beyond
      calling refresh after a re-dress (outfits.js recolorRig does).

   BATCHING (entities/pedinstance.js texture pages): a chart is a canvas
   under 496 px wide with default clamp/flipY, so it is PAGED: every inked
   forearm of a shape shares one pool, the chart rides the per-instance
   slot. Materials are shared per (skin tone x chart), charts per design
   key, so a yard of inked men is a handful of textures, not one per man.

   FIRST PERSON: fphands' forearm and hands carry UVs for these charts and
   call fpSync from onBeforeRender; the player's own profile is drawn at FP
   density, so the ink down your lens is the ink the chase camera sees.

   API
     CBZ.tattoo.refresh(ch)        ink whatever skin is bare now (idempotent)
     CBZ.tattoo.profile(ch)        the rig's profile (rolled on first ask)
     CBZ.tattoo.assign(ch, fam, o) set a family explicitly (heritage.js)
     CBZ.tattoo.isInk(material)    true for an ink skin material
     CBZ.tattoo.skinOf(material)   the skin hex behind an ink material
     CBZ.tattoo.fpSync(mesh, kind) first-person hand / forearm (fphands.js)
     CBZ.tattoo.paint(kind, key, canvas)  draw a chart (node previews)
     CBZ.tattoo.ARM_SPLIT          the upper/fore split of the arm chart
     CBZ.tattoo.sigOf(ch)          a short signature of his pieces (cache keys)
     CBZ.tattoo.census()           live counts
     rig._inkFrom = rig | "player" a stand-in body (portrait, mugshot booth)
                                   wears its subject's ink
   Charts are painted lazily (idle time, else one a frame); a rig whose chart
   is still queued shows plain skin and is re-inked when it lands.
   Checked by tools/tattoo-check.mjs (and tools/human-audit.mjs wears it).
============================================================ */
(function () {
  "use strict";
  const root = typeof window !== "undefined" ? window : globalThis;
  const CBZ = root.CBZ = root.CBZ || {};
  if (CBZ.tattoo && CBZ.tattoo.version) return;

  const ARM_SPLIT = 0.6;               // arm chart: shoulder..elbow = y [0, .6], elbow..wrist = [.6, 1]
  // chart sizes. The body charts stay <= 496 px wide so pedinstance can page
  // them (a page is 2048 wide and wants 4 mip-guttered slots across), and are
  // sized so a page holds a crowd's worth (6 x 6 arm charts, 4 x 8 heads,
  // 6 x 11 hands): measured on tools/human-audit.mjs's all-inked 864-body
  // crowd, 384 px arms took 16 pages. First person has its own, denser charts.
  const SIZE = {
    arm: [320, 320],                   // body arm, both segments (~5x the old 64 x 40 arm row, each way)
    head: [448, 224],                  // the head atlas at 3.5x the old 128x64
    hand: [320, 160],                  // body hands
    fore: [768, 768],                  // first-person forearm (not paged: one player)
    fphand: [1024, 512],               // first-person hands
  };
  // physical aspect (length / circumference) of each limb segment the chart
  // wraps: adult body loft (arm 0.30 wide, upper 0.44 long, forearm 0.32 with
  // its overlap) and the first-person forearm (real metres, ~0.25 x 0.27)
  const ASPECT = { up: 0.50, lo: 0.44, fp: 0.95 };

  // ---- deterministic randomness ----------------------------------------------
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    return h >>> 0;
  }
  function rngOf(seed) {
    let s = (typeof seed === "number" ? seed : hash(String(seed))) >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pickW(list, r) {
    let t = 0;
    for (let i = 0; i < list.length; i++) t += list[i][1];
    let x = r * t;
    for (let i = 0; i < list.length; i++) { x -= list[i][1]; if (x <= 0) return list[i][0]; }
    return list[list.length - 1][0];
  }
  function pick(list, r) { return list[Math.min(list.length - 1, Math.floor(r * list.length))]; }

  // ---- canvases ---------------------------------------------------------------
  function mkCanvas(w, h) {
    if (CBZ.tattoo && CBZ.tattoo._mkCanvas) return CBZ.tattoo._mkCanvas(w, h);
    if (typeof document === "undefined" || !document.createElement) return null;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    return cv;
  }
  let _filterOk = null;
  function filterOk(ctx) {
    if (_filterOk == null) {
      try { ctx.filter = "blur(2px)"; _filterOk = ctx.filter === "blur(2px)"; ctx.filter = "none"; } catch (e) { _filterOk = false; }
    }
    return _filterOk;
  }
  // a soft copy of `src`: canvas blur where the browser has it (Chrome,
  // Firefox), else a down-and-up resample (Safari), which is a fair box blur
  function blurred(src, r) {
    const w = src.width, h = src.height;
    const out = mkCanvas(w, h);
    const o = out.getContext("2d");
    if (r <= 0.05) { o.drawImage(src, 0, 0); return out; }
    if (filterOk(o)) { o.filter = "blur(" + r.toFixed(2) + "px)"; o.drawImage(src, 0, 0); o.filter = "none"; return out; }
    const k = Math.max(1.25, r * 1.2);
    const sw = Math.max(1, Math.round(w / k)), sh = Math.max(1, Math.round(h / k));
    const t = mkCanvas(sw, sh), tc = t.getContext("2d");
    tc.imageSmoothingEnabled = true;
    tc.drawImage(src, 0, 0, sw, sh);
    o.imageSmoothingEnabled = true;
    o.drawImage(t, 0, 0, w, h);
    return out;
  }

  // ---- ink --------------------------------------------------------------------
  // Blue-black carbon under skin. Fresh reads near black; years move it toward
  // a blue-green grey and soften it. Homemade prison ink (soot, pen ink) is
  // bluer and never as dense. Under the game's exposure ink must START near
  // black to end up reading as ink (heritage.js measured it on the lineup).
  const INK_AGE = [[14, 17, 24], [26, 34, 46], [44, 58, 70]];
  const INK_HOME = [[22, 30, 56], [34, 46, 72], [52, 66, 88]];
  const COLORS = {
    red: [168, 28, 34], deepred: [110, 16, 24], green: [26, 104, 58], yellow: [222, 168, 36],
    blue: [34, 70, 146], pink: [214, 96, 130], teal: [22, 110, 118], purple: [90, 44, 120],
  };
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function css(rgb, a) { return "rgba(" + (rgb[0] | 0) + "," + (rgb[1] | 0) + "," + (rgb[2] | 0) + "," + (a == null ? 1 : +a.toFixed(3)) + ")"; }

  /* K — the pen for one chart: the ink colour for its age, colour inks, the
     shake of a homemade machine, and the rng every motif draws from. */
  function pen(o) {
    const age = Math.max(0, Math.min(2, o.age | 0));
    const ink = (o.home ? INK_HOME : INK_AGE)[age];
    const r = rngOf(o.seed || "ink");
    return {
      age: age, home: !!o.home, rng: r, color: !!o.color, lw: o.lw || 1,
      ink: ink,
      shake: o.home ? 0.55 + 0.35 * age : 0.12 * age,
      I: function (a) { return css(ink, a == null ? 0.94 : a); },
      C: function (name, a) {
        const c = COLORS[name] || COLORS.red;
        return css(mix(c, [150, 140, 136], 0.16 * age), a == null ? 0.9 : a);
      },
    };
  }

  /* ---- drawing primitives (current transform: motif units) ---------------- */
  // a hand-drawn line: subdivided and nudged by the pen's shake
  function wobble(K, pts) {
    if (!(K.shake > 0.01) || pts.length < 2) return pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        out.push([a[0] + (b[0] - a[0]) * t + (K.rng() - 0.5) * K.shake, a[1] + (b[1] - a[1]) * t + (K.rng() - 0.5) * K.shake]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function poly(c, pts, close) {
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (close) c.closePath();
  }
  function stroke(K, c, pts, w, col, close) {
    const p = wobble(K, close ? pts.concat([pts[0]]) : pts);
    poly(c, p, false);
    c.lineWidth = w * (K.lw || 1); c.lineCap = "round"; c.lineJoin = "round";
    c.strokeStyle = col || K.I(); c.stroke();
  }
  // sample a cubic bezier into points (for shaky strokes and fills alike)
  function bez(p0, p1, p2, p3, n, out) {
    out = out || [];
    for (let i = out.length ? 1 : 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
    return out;
  }
  function quad(p0, p1, p2, n, out) {
    out = out || [];
    for (let i = out.length ? 1 : 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    return out;
  }
  function circlePts(x, y, r, n, a0) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = (a0 || 0) + i / n * Math.PI * 2; out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
    return out;
  }
  function fillPts(c, pts, style) { poly(c, pts, true); c.fillStyle = style; c.fill(); }
  // erase what is under a shape (a front petal hides the back petal's line)
  function knock(c, pts) {
    c.save(); c.globalCompositeOperation = "destination-out";
    fillPts(c, pts, "#000"); c.restore();
  }
  function radial(c, x, y, r0, r1, stops) {
    const g = c.createRadialGradient(x, y, r0, x, y, r1);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }
  function linear(c, x0, y0, x1, y1, stops) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }
  // whip shading: a fan of soft short strokes (the grey a tattooer pulls out
  // of a line), drawn light so the ink pass blends it into a wash
  function whip(K, c, x, y, ang, len, spread, n, a) {
    c.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5, aa = ang + t * spread;
      const l = len * (0.6 + 0.4 * K.rng());
      c.lineWidth = 1.2 + K.rng() * 1.6;
      c.strokeStyle = K.I(a * (0.5 + 0.5 * K.rng()));
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(aa) * l, y + Math.sin(aa) * l); c.stroke();
    }
  }

  // ---- lettering ----------------------------------------------------------------
  const FONT = {
    script: '"Snell Roundhand","Brush Script MT","Segoe Script","Apple Chancery","Lucida Handwriting","Bradley Hand",cursive',
    old: '"Old English Text MT","Engravers Old English BT","Luminari","Blackmoor LET","Apple Chancery","Times New Roman",serif',
    block: '"Arial Black","Helvetica Neue","Arial Narrow",Arial,sans-serif',
    serif: '"Didot","Bodoni 72","Times New Roman",Georgia,serif',
  };
  /* A word fitted into a box w x h (motif units), centred at 0,0. Shaky pens
     letter by letter (each glyph a little off its neighbour); clean pens set
     the whole word so a joined script keeps its joins. `shade` drops a grey
     copy down-right first: the classic lettering shadow. */
  function word(K, c, text, face, w, h, o) {
    o = o || {};
    const weight = o.weight || (face === "block" ? "900" : face === "old" ? "700" : "400");
    const style = face === "script" ? "italic " : "";
    const base = 40;
    c.font = style + weight + " " + base + "px " + (FONT[face] || FONT.serif);
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    const tw = Math.max(1, c.measureText(text).width);
    const k = Math.min(w / tw, h / (base * (face === "script" ? 0.95 : 0.78)));
    c.save();
    c.scale(k, k);
    const x0 = -tw / 2, y0 = base * (face === "script" ? 0.28 : 0.36);
    const draw = function (fill, dx, dy) {
      c.fillStyle = fill;
      if (K.shake > 0.3) {
        let x = x0;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i], cw = c.measureText(ch).width;
          c.save();
          c.translate(x + dx + (K.rng() - 0.5) * K.shake * 2.2, y0 + dy + (K.rng() - 0.5) * K.shake * 3);
          c.rotate((K.rng() - 0.5) * 0.09 * K.shake);
          c.fillText(ch, 0, 0);
          c.restore();
          x += cw;
        }
      } else c.fillText(text, x0 + dx, y0 + dy);
    };
    if (o.shade) draw(K.I(face === "script" ? 0.16 : 0.34), face === "script" ? 1.1 : 2.4, face === "script" ? 1.3 : 2.6);
    if (o.outline) {                                      // hollow letters with a grey fill
      draw(K.I(0.30), 0, 0);
      c.lineWidth = 2.2; c.strokeStyle = K.I();
      c.lineJoin = "round";
      c.strokeText(text, x0, y0);
    } else draw(o.fill || K.I(), 0, 0);
    c.restore();
    return tw * k;
  }

  /* ============================================================
     MOTIFS. Each draws centred on 0,0 in a ~100-unit box (x right, y DOWN,
     "up" = toward the shoulder / crown / fingertip). The caller's transform
     makes 100 units the size it asked for on the body.
     ============================================================ */
  const M = {};

  // a petal lobe from a base point toward `ang`: rounded shoulders and a tip
  // whose edge rolls back in a shallow notch, the way a rose petal curls
  function lobe(bx, by, ang, len, wid) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = function (f, s) { return [bx + ca * f - sa * s, by + sa * f + ca * s]; };
    const out = [];
    bez(P(0, -wid * 0.22), P(len * 0.30, -wid * 0.80), P(len * 0.92, -wid * 0.74), P(len * 0.98, -wid * 0.14), 10, out);
    quad(P(len * 0.98, -wid * 0.14), P(len * 1.02, -wid * 0.02), P(len * 0.90, 0), 4, out);
    quad(P(len * 0.90, 0), P(len * 1.02, wid * 0.02), P(len * 0.98, wid * 0.14), 4, out);
    bez(P(len * 0.98, wid * 0.14), P(len * 0.92, wid * 0.74), P(len * 0.30, wid * 0.80), P(0, wid * 0.22), 10, out);
    return out;
  }
  function leaf(K, c, x, y, ang, len, wid, colorful) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = function (f, s) { return [x + ca * f - sa * s, y + sa * f + ca * s]; };
    const pts = [];
    bez(P(0, 0), P(len * 0.3, -wid), P(len * 0.75, -wid * 0.8), P(len, 0), 10, pts);
    bez(P(len, 0), P(len * 0.75, wid * 0.8), P(len * 0.3, wid), P(0, 0), 10, pts);
    knock(c, pts);
    if (colorful) fillPts(c, pts, linear(c, P(0, 0)[0], P(0, 0)[1], P(len, 0)[0], P(len, 0)[1], [[0, K.C("green", 0.95)], [1, K.C("green", 0.55)]]));
    else {
      // one half dark (the leaf turned from the light), the other a fine wash
      const half = [];
      bez(P(0, 0), P(len * 0.3, -wid), P(len * 0.75, -wid * 0.8), P(len, 0), 10, half);
      half.push(P(len * 0.5, 0));
      fillPts(c, half, K.I(0.55));
      fillPts(c, pts, K.I(0.12));
    }
    stroke(K, c, pts, 2.0);
    stroke(K, c, [P(0, 0), P(len * 0.85, 0)], 1.2, K.I(0.8));
    for (let i = 1; i <= 3; i++) {
      const f = len * (0.2 + i * 0.18);
      stroke(K, c, [P(f, 0), P(f + len * 0.1, -wid * 0.45)], 0.9, K.I(0.6));
      stroke(K, c, [P(f, 0), P(f + len * 0.1, wid * 0.45)], 0.9, K.I(0.6));
    }
  }
  function shadeLobe(K, c, pts, bx, by, len, colorful, hue) {
    if (colorful) fillPts(c, pts, radial(c, bx, by, 0, len * 1.05, [[0, K.C(hue === "red" ? "deepred" : hue, 0.95)], [0.55, K.C(hue, 0.9)], [1, K.C(hue, 0.55)]]));
    else fillPts(c, pts, radial(c, bx, by, 0, len * 1.02, [[0, K.I(0.86)], [0.45, K.I(0.42)], [0.85, K.I(0.06)], [1, K.I(0)]]));
  }
  // THE ROSE. Back petals, side petals, the cup, the front petals, the curl,
  // two leaves: each petal knocks out what it covers, so it reads in depth.
  M.rose = function (K, c, o) {
    o = o || {};
    const col = !!(o.color && K.color), hue = o.hue || "red";
    if (o.leaves !== false) {
      leaf(K, c, -18, 16, Math.PI * 0.80, 30, 10, col);
      leaf(K, c, 18, 18, Math.PI * 0.12, 27, 9, col);
    }
    const cx = 0, cy = -4;
    const petals = [
      [cx, cy - 2, -Math.PI / 2, 30, 34], [cx - 3, cy, -Math.PI * 0.80, 30, 30], [cx + 3, cy, -Math.PI * 0.20, 30, 30],
      [cx - 4, cy + 4, Math.PI * 0.94, 29, 28], [cx + 4, cy + 4, Math.PI * 0.06, 29, 28],
      [cx - 3, cy + 6, Math.PI * 0.68, 27, 30], [cx + 3, cy + 6, Math.PI * 0.32, 27, 30],
    ];
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i], pts = lobe(p[0], p[1], p[2], p[3], p[4]);
      knock(c, pts);
      shadeLobe(K, c, pts, p[0], p[1], p[3], col, hue);
      stroke(K, c, pts, 2.3);
    }
    // the cup: an open bowl whose back rim is lit and whose inside is deep
    const cup = [];
    bez([cx - 17, cy - 3], [cx - 16, cy + 14], [cx + 16, cy + 14], [cx + 17, cy - 3], 12, cup);
    bez([cx + 17, cy - 3], [cx + 10, cy - 13], [cx - 10, cy - 13], [cx - 17, cy - 3], 12, cup);
    knock(c, cup);
    if (col) fillPts(c, cup, radial(c, cx, cy - 4, 0, 18, [[0, K.C("deepred", 1)], [1, K.C(hue, 0.85)]]));
    else fillPts(c, cup, radial(c, cx, cy - 5, 2, 18, [[0, K.I(0.92)], [0.6, K.I(0.55)], [1, K.I(0.15)]]));
    stroke(K, c, cup, 2.3);
    // the front lip rolled over the cup
    const lip = [];
    bez([cx - 15, cy + 2], [cx - 8, cy + 9], [cx + 8, cy + 9], [cx + 15, cy + 2], 12, lip);
    bez([cx + 15, cy + 2], [cx + 8, cy + 14], [cx - 8, cy + 14], [cx - 15, cy + 2], 12, lip);
    knock(c, lip);
    fillPts(c, lip, col ? K.C(hue, 0.62) : K.I(0.14));
    stroke(K, c, lip, 2.0);
    // the curl at the heart
    const sp = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40, a = -0.6 + t * 9.5, r = 1.5 + t * 8.5; sp.push([cx + Math.cos(a) * r, cy - 5 + Math.sin(a) * r * 0.62]); }
    stroke(K, c, sp, 1.8);
  };

  // THE SKULL: cranium, cheekbones, a nasal cavity, deep sockets, two rows of
  // teeth in a hinged jaw, grey pulled into the temples and under the cheeks.
  M.skull = function (K, c, o) {
    o = o || {};
    const cran = [];
    bez([-23, 6], [-36, -4], [-33, -42], [0, -43], 14, cran);
    bez([0, -43], [33, -42], [36, -4], [23, 6], 14, cran);
    bez([23, 6], [22, 14], [17, 15], [14, 21], 6, cran);
    cran.push([13, 27], [-13, 27]);
    bez([-14, 21], [-17, 15], [-22, 14], [-23, 6], 6, cran);
    knock(c, cran);
    fillPts(c, cran, radial(c, -6, -22, 4, 44, [[0, K.I(0)], [0.55, K.I(0.10)], [0.85, K.I(0.42)], [1, K.I(0.62)]]));
    // temple hollows and the cheek shadow
    fillPts(c, circlePts(-24, -6, 7, 14), K.I(0.18));
    fillPts(c, circlePts(24, -6, 7, 14), K.I(0.18));
    stroke(K, c, cran, 2.6);
    // jaw
    const jaw = [];
    bez([-15, 24], [-17, 34], [-12, 44], [0, 45], 10, jaw);
    bez([0, 45], [12, 44], [17, 34], [15, 24], 10, jaw);
    jaw.push([12, 30], [-12, 30]);
    knock(c, jaw);
    fillPts(c, jaw, K.I(0.22));
    stroke(K, c, jaw, 2.4);
    // teeth: an upper and a lower row with dark gaps
    for (let row = 0; row < 2; row++) {
      const y0 = row ? 29 : 21, h = row ? 7 : 7.5;
      for (let i = 0; i < 6; i++) {
        const x = -12 + i * 4, w = 3.4;
        const t = [[x + 0.3, y0], [x + w, y0], [x + w - 0.2, y0 + h - 1], [x + w / 2, y0 + h], [x + 0.4, y0 + h - 1]];
        knock(c, t);
        fillPts(c, t, K.I(0.08));
        stroke(K, c, t, 1.1);
      }
    }
    // eye sockets: soft-cornered, deepest at the inner top
    for (const s of [-1, 1]) {
      const eye = [];
      bez([s * 3, -10], [s * 2, -18], [s * 19, -19], [s * 20, -8], 10, eye);
      bez([s * 20, -8], [s * 20, 0], [s * 8, 2], [s * 3, -10], 10, eye);
      fillPts(c, eye, radial(c, s * 9, -11, 1, 13, [[0, K.I(0.98)], [0.7, K.I(0.92)], [1, K.I(0.7)]]));
      stroke(K, c, eye, 1.6);
    }
    // the nose: an inverted heart
    const nose = [];
    bez([0, 3], [-5, 5], [-5, 12], [0, 13], 6, nose);
    bez([0, 13], [5, 12], [5, 5], [0, 3], 6, nose);
    fillPts(c, nose, K.I(0.95));
    // a crack over the brow
    if (o.crack) stroke(K, c, [[8, -42], [10, -34], [6, -30], [9, -24]], 1.2);
  };

  // A WEB: spokes from the hub, threads sagging toward it between spokes
  M.web = function (K, c, o) {
    o = o || {};
    const n = o.spokes || 9, rings = o.rings || 5, R = 50;
    const ang = [];
    for (let i = 0; i < n; i++) ang.push(i / n * Math.PI * 2 + (K.rng() - 0.5) * 0.25);
    for (let i = 0; i < n; i++) stroke(K, c, [[0, 0], [Math.cos(ang[i]) * R, Math.sin(ang[i]) * R]], 1.5);
    for (let k = 1; k <= rings; k++) {
      const r = R * (k / rings) * (0.92 + K.rng() * 0.08);
      for (let i = 0; i < n; i++) {
        const a0 = ang[i], a1 = ang[(i + 1) % n] + (i === n - 1 ? Math.PI * 2 : 0), am = (a0 + a1) / 2;
        const p = quad([Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(am) * r * 0.74, Math.sin(am) * r * 0.74], [Math.cos(a1) * r, Math.sin(a1) * r], 8);
        stroke(K, c, p, 1.2);
      }
    }
    if (o.spider) {
      const sx = Math.cos(ang[1]) * R * 0.55, sy = Math.sin(ang[1]) * R * 0.55;
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
        const a = (i - 1.5) * 0.45;
        stroke(K, c, [[sx, sy], [sx + s * 5, sy + a * 6 - 2], [sx + s * 8, sy + a * 9 + 2]], 1.0);
      }
      fillPts(c, circlePts(sx, sy + 3.5, 3.4, 12), K.I());
      fillPts(c, circlePts(sx, sy - 1, 2.2, 10), K.I());
    }
  };

  // BARBED WIRE across [-50, 50] (tiles seamlessly when it wraps a limb):
  // two strands twisting round each other, a lit core down each (the skin
  // left in the middle of a line reads as round steel), and a barb at every
  // other crossing: a tight coil with two spikes standing off the wire
  M.wire = function (K, c, o) {
    o = o || {};
    const n = o.twists || 8, P = 100 / n, A = o.amp || 1.9, W = o.w || 1.5;
    const strand = function (ph) {
      const pts = [];
      for (let x = -50; x <= 50.01; x += 0.8) pts.push([x, Math.sin((x + 50) / P * Math.PI * 2 + ph) * A]);
      return pts;
    };
    const s1 = strand(0), s2 = strand(Math.PI);
    const core = function (pts) {
      c.save(); c.globalCompositeOperation = "destination-out";
      stroke(K, c, pts.map(function (p) { return [p[0], p[1] - W * 0.12]; }), W * 0.34, "rgba(0,0,0,0.6)");
      c.restore();
    };
    stroke(K, c, s1, W); core(s1);
    c.save(); c.globalCompositeOperation = "destination-out"; stroke(K, c, s2, W * 2.1, "#000"); c.restore();
    stroke(K, c, s2, W); core(s2);
    for (let k = 0; k < n; k++) {
      // a barb: one short wire wrapped twice round both strands, its two cut
      // ends standing off as spikes (an X across the twist)
      const x = -50 + (k + 0.5) * P, d = o.barb || 4.6;
      for (const s of [-1, 1]) {
        const spike = [[x - s * d * 0.6, -d], [x + s * d * 0.6, d]];
        c.save(); c.globalCompositeOperation = "destination-out"; stroke(K, c, spike, W * 1.6, "#000"); c.restore();
        stroke(K, c, spike, W * 0.75);
      }
      stroke(K, c, [[x - 0.9, -A - 0.8], [x - 0.3, A + 0.8]], W * 0.7);
      stroke(K, c, [[x + 0.5, -A - 0.8], [x + 1.1, A + 0.8]], W * 0.7);
    }
  };

  // a SOLID BAND with a hand-laid edge (a machine packs black; it is never ruled)
  M.band = function (K, c, o) {
    o = o || {};
    const h = o.h || 8, pts = [], j = 0.18 * (1 + K.shake);
    for (let x = -50; x <= 50.01; x += 2) pts.push([x, -h / 2 + (K.rng() - 0.5) * j]);
    for (let x = 50; x >= -50.01; x -= 2) pts.push([x, h / 2 + (K.rng() - 0.5) * j]);
    fillPts(c, pts, K.I(o.a || 0.95));
  };

  // CLOUDS: the black-and-grey filler that ties pieces into a sleeve. One
  // bank of puffs: only the OUTER top silhouette is lined (an arc hidden
  // inside a neighbouring puff is skipped), a smaller rim inside the big
  // puffs gives them depth, and the grey rises from a dark base and fades
  // out at the bottom — smoke, no hard lower edge
  M.clouds = function (K, c, o) {
    o = o || {};
    const n = o.n || 5, puffs = [];
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1 || 1) - 0.5) * 76 + (K.rng() - 0.5) * 6;
      const r = 10 + K.rng() * 7 + (i % 2 ? 0 : 3);
      puffs.push([x, 4 - r * 0.55, r]);
    }
    const inside = function (x, y, skip) {
      for (let j = 0; j < puffs.length; j++) if (j !== skip && Math.hypot(x - puffs[j][0], y - puffs[j][1]) < puffs[j][2] - 0.4) return true;
      return false;
    };
    const base = 6;
    // the grey: clipped to the bank, dark at its base, open at the top
    c.save();
    c.beginPath();
    for (const p of puffs) { c.moveTo(p[0] + p[2], p[1]); c.arc(p[0], p[1], p[2], 0, Math.PI * 2); }
    c.rect(-44, -4, 88, base + 4);
    c.clip();
    c.fillStyle = linear(c, 0, -26, 0, base, [[0, K.I(0)], [0.4, K.I(0.05)], [0.8, K.I(0.28)], [1, K.I(0.4)]]);
    c.fillRect(-60, -40, 120, 60);
    c.restore();
    // the outer silhouette of the puffs' tops
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      let run = [];
      for (let a = Math.PI * 0.92; a <= Math.PI * 2.08; a += 0.06) {
        const x = p[0] + Math.cos(a) * p[2], y = p[1] + Math.sin(a) * p[2];
        if (y > base - 1 || inside(x, y, i)) { if (run.length > 1) stroke(K, c, run, 1.7); run = []; continue; }
        run.push([x, y]);
      }
      if (run.length > 1) stroke(K, c, run, 1.7);
      if (p[2] > 13) {                                          // an inner rim
        const rim = [];
        for (let a = Math.PI * 1.15; a <= Math.PI * 1.7; a += 0.08) rim.push([p[0] + 3 + Math.cos(a) * p[2] * 0.62, p[1] + 3 + Math.sin(a) * p[2] * 0.62]);
        stroke(K, c, rim, 1.1, K.I(0.6));
      }
    }
    // the bottom dissolves
    c.save(); c.globalCompositeOperation = "destination-out";
    c.fillStyle = linear(c, 0, base - 5, 0, base + 1, [[0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.95)"]]);
    c.fillRect(-60, base - 5, 120, 12);
    c.restore();
  };

  // THE CLOCK WITH NO HANDS — doing time. Double rim, hour ticks, cracked glass.
  M.clock = function (K, c, o) {
    o = o || {};
    const R = 34;
    knock(c, circlePts(0, 0, R + 4, 40));
    fillPts(c, circlePts(0, 0, R + 4, 40), radial(c, 0, 0, R * 0.6, R + 4, [[0, K.I(0)], [0.75, K.I(0.2)], [1, K.I(0.65)]]));
    stroke(K, c, circlePts(0, 0, R + 4, 48), 2.6, null, true);
    stroke(K, c, circlePts(0, 0, R, 48), 1.6, null, true);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, r0 = i % 3 ? R - 5 : R - 9;
      stroke(K, c, [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * (R - 1.5), Math.sin(a) * (R - 1.5)]], i % 3 ? 1.4 : 2.6);
    }
    fillPts(c, circlePts(0, 0, 2.4, 10), K.I());
    if (o.crack !== false) {
      stroke(K, c, [[8, -6], [16, -14], [19, -12], [27, -20]], 1.1, K.I(0.8));
      stroke(K, c, [[8, -6], [13, 2], [22, 4], [29, 11]], 1.1, K.I(0.8));
      stroke(K, c, [[8, -6], [4, -18], [6, -26]], 1.0, K.I(0.7));
    }
  };

  // SMILE NOW, CRY LATER: two theatre masks, the laughing one in front
  M.masks = function (K, c) {
    const mask = function (dx, rot, happy) {
      const ca = Math.cos(rot), sa = Math.sin(rot);
      const T = function (p) { return [dx + p[0] * ca - p[1] * sa, p[1] * ca + p[0] * sa]; };
      const face = [];
      bez([-17, -18], [-19, 6], [-10, 24], [0, 26], 12, face);
      bez([0, 26], [10, 24], [19, 6], [17, -18], 12, face);
      bez([17, -18], [9, -24], [-9, -24], [-17, -18], 8, face);
      const F = face.map(T);
      knock(c, F);
      fillPts(c, F, linear(c, T([-18, 0])[0], 0, T([18, 0])[0], 0, [[0, K.I(happy ? 0.05 : 0.55)], [1, K.I(happy ? 0.45 : 0.10)]]));
      stroke(K, c, F, 2.4);
      for (const s of [-1, 1]) {
        const eye = [];
        if (happy) { bez([s * 3, -6], [s * 5, -12], [s * 12, -12], [s * 13, -6], 8, eye); bez([s * 13, -6], [s * 11, -8], [s * 5, -8], [s * 3, -6], 8, eye); }
        else { bez([s * 3, -9], [s * 5, -4], [s * 12, -4], [s * 13, -8], 8, eye); bez([s * 13, -8], [s * 11, -2], [s * 5, -2], [s * 3, -9], 8, eye); }
        fillPts(c, eye.map(T), K.I());
        const brow = happy ? [[s * 3, -15], [s * 8, -18], [s * 13, -15]] : [[s * 3, -12], [s * 9, -15], [s * 14, -17]];
        stroke(K, c, brow.map(T), 1.6);
      }
      const mouth = [];
      if (happy) { bez([-10, 8], [-5, 19], [5, 19], [10, 8], 10, mouth); bez([10, 8], [4, 12], [-4, 12], [-10, 8], 10, mouth); }
      else { bez([-9, 16], [-4, 8], [4, 8], [9, 16], 10, mouth); bez([9, 16], [4, 12], [-4, 12], [-9, 16], 10, mouth); }
      fillPts(c, mouth.map(T), K.I());
      if (!happy) fillPts(c, [[9, -1], [11, 5], [9, 7], [7, 5]].map(T), K.I(0.9));   // the tear
    };
    mask(13, 0.22, false);
    mask(-11, -0.18, true);
  };

  // A CROSS in rays of light with clouds at its foot
  M.cross = function (K, c, o) {
    o = o || {};
    if (o.rays !== false) for (let i = 0; i < 18; i++) {
      const a = -Math.PI / 2 + (i - 8.5) / 18 * Math.PI * 1.7, L = i % 2 ? 46 : 36;
      stroke(K, c, [[Math.cos(a) * 12, -12 + Math.sin(a) * 12], [Math.cos(a) * L, -12 + Math.sin(a) * L]], 0.9, K.I(0.55));
    }
    const w = 5.5, pts = [[-w, -40], [w, -40], [w, -24], [20, -24], [20, -14], [w, -14], [w, 34], [-w, 34], [-w, -14], [-20, -14], [-20, -24], [-w, -24]];
    knock(c, pts);
    fillPts(c, pts, linear(c, -20, 0, 20, 0, [[0, K.I(0.62)], [0.5, K.I(0.1)], [1, K.I(0.5)]]));
    stroke(K, c, pts, 2.2, null, true);
    if (o.clouds !== false) { c.save(); c.translate(0, 34); c.scale(0.8, 0.55); M.clouds(K, c, { n: 4 }); c.restore(); }
  };

  // ROSARY: beads round a wrist (tiles across [-50, 50]) with a crucifix
  // hanging on its own short drop at x 0
  M.rosary = function (K, c) {
    for (let x = -50; x < 50; x += 4.2) {
      fillPts(c, circlePts(x, Math.sin((x + 50) / 100 * Math.PI * 2) * 1.5, 1.55, 10), K.I(0.95));
    }
    for (let i = 1; i <= 4; i++) fillPts(c, circlePts(0, 2 + i * 3.8, 1.5, 10), K.I(0.95));
    const cr = [[-1.6, 19], [1.6, 19], [1.6, 22.5], [5, 22.5], [5, 25.5], [1.6, 25.5], [1.6, 34], [-1.6, 34], [-1.6, 25.5], [-5, 25.5], [-5, 22.5], [-1.6, 22.5]];
    fillPts(c, cr, K.I());
  };

  // A STAR: `points` points, each split down its ridge into dark and light
  M.star = function (K, c, o) {
    o = o || {};
    const n = o.points || 5, R = 46, r = o.inner || 19, rot = -Math.PI / 2;
    const tip = function (i) { const a = rot + i / n * Math.PI * 2; return [Math.cos(a) * R, Math.sin(a) * R]; };
    const val = function (i) { const a = rot + (i + 0.5) / n * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; };
    const all = [];
    for (let i = 0; i < n; i++) all.push(tip(i), val(i));
    knock(c, all);
    for (let i = 0; i < n; i++) {
      const t = tip(i), vl = val(i - 1 < 0 ? n - 1 : i - 1), vr = val(i);
      fillPts(c, [[0, 0], vl, t], o.color && K.color ? K.C(o.color, 0.92) : K.I(0.95));
      fillPts(c, [[0, 0], t, vr], o.color2 && K.color ? K.C(o.color2, 0.85) : K.I(0.06));
      stroke(K, c, [[0, 0], t], 1.2);
    }
    stroke(K, c, all, 2.4, null, true);
  };

  // AN ONION-DOMED CHURCH: each dome a year inside (the vory count)
  M.domes = function (K, c, o) {
    o = o || {};
    const n = o.domes || 3;
    const body = [[-34, 12], [34, 12], [34, 42], [-34, 42]];
    knock(c, body);
    fillPts(c, body, K.I(0.12));
    stroke(K, c, body, 2.0, null, true);
    for (let i = 0; i < 3; i++) {                          // arched windows
      const x = -20 + i * 20, win = [];
      win.push([x - 4, 36]); win.push([x - 4, 24]);
      bez([x - 4, 24], [x - 4, 18], [x + 4, 18], [x + 4, 24], 6, win);
      win.push([x + 4, 36]);
      fillPts(c, win, K.I(0.9));
    }
    for (let i = 0; i < n; i++) {
      const x = (n === 1 ? 0 : (i / (n - 1) - 0.5) * 48), big = n % 2 === 1 && i === (n - 1) / 2;
      const s = big ? 1.25 : 0.9, by = big ? 2 : 10;
      const drum = [[x - 6 * s, by + 10], [x + 6 * s, by + 10], [x + 6 * s, by], [x - 6 * s, by]];
      knock(c, drum); fillPts(c, drum, K.I(0.3)); stroke(K, c, drum, 1.6, null, true);
      const dome = [];
      bez([x - 7 * s, by], [x - 14 * s, by - 10 * s], [x - 2 * s, by - 16 * s], [x, by - 24 * s], 10, dome);
      bez([x, by - 24 * s], [x + 2 * s, by - 16 * s], [x + 14 * s, by - 10 * s], [x + 7 * s, by], 10, dome);
      knock(c, dome);
      fillPts(c, dome, linear(c, x - 12 * s, 0, x + 12 * s, 0, [[0, K.I(0.85)], [0.55, K.I(0.25)], [1, K.I(0.7)]]));
      stroke(K, c, dome, 1.8, null, true);
      stroke(K, c, [[x, by - 24 * s], [x, by - 34 * s]], 1.5);
      stroke(K, c, [[x - 3.5 * s, by - 30 * s], [x + 3.5 * s, by - 30 * s]], 1.4);
    }
  };

  // A DAGGER, point down, optionally through a heart
  M.dagger = function (K, c, o) {
    o = o || {};
    if (o.heart) M.heart(K, c, { color: o.color, y: 8, s: 0.62 });
    const blade = [[-5, -12], [5, -12], [4, 30], [0, 46], [-4, 30]];
    knock(c, blade.filter(function (p, i) { return !o.heart || i === 0 || i === 1 || p[1] > 28; }));
    fillPts(c, blade, linear(c, -5, 0, 5, 0, [[0, K.I(0.55)], [0.5, K.I(0.05)], [0.52, K.I(0.3)], [1, K.I(0.62)]]));
    stroke(K, c, blade, 2.0, null, true);
    stroke(K, c, [[0, -10], [0, 38]], 0.9, K.I(0.7));
    const guard = [[-16, -16], [16, -16], [18, -12], [-18, -12]];
    fillPts(c, guard, K.I(0.9));
    const grip = [[-3.5, -34], [3.5, -34], [3.5, -16], [-3.5, -16]];
    fillPts(c, grip, K.I(0.3)); stroke(K, c, grip, 1.6, null, true);
    for (let y = -32; y < -17; y += 3) stroke(K, c, [[-3.5, y], [3.5, y + 2]], 1.0);
    fillPts(c, circlePts(0, -38, 4.5, 14), K.I(0.95));
  };
  M.heart = function (K, c, o) {
    o = o || {};
    const s = o.s || 1, y = o.y || 0;
    const pts = [];
    bez([0, y + 30 * s], [-30 * s, y + 6 * s], [-34 * s, y - 24 * s], [0, y - 12 * s], 14, pts);
    bez([0, y - 12 * s], [34 * s, y - 24 * s], [30 * s, y + 6 * s], [0, y + 30 * s], 14, pts);
    knock(c, pts);
    if (o.color && K.color) fillPts(c, pts, radial(c, -9 * s, y - 8 * s, 1, 34 * s, [[0, K.C("red", 0.55)], [0.5, K.C("red", 0.92)], [1, K.C("deepred", 1)]]));
    else fillPts(c, pts, radial(c, -9 * s, y - 8 * s, 1, 34 * s, [[0, K.I(0.05)], [0.6, K.I(0.4)], [1, K.I(0.85)]]));
    stroke(K, c, pts, 2.4);
  };
  // a ribbon banner with a word on it
  M.banner = function (K, c, o) {
    o = o || {};
    const body = [];
    bez([-40, -6], [-20, -12], [20, 0], [40, -6], 12, body);
    bez([40, 6], [20, 12], [-20, 0], [-40, 6], 12, [body[body.length - 1]].concat([])).forEach(function (p, i) { if (i) body.push(p); });
    const b2 = body.slice(0, 13).concat(bez([40, 6], [20, 12], [-20, 0], [-40, 6], 12));
    for (const s of [-1, 1]) {                                // the folded tails
      const t = [[s * 40, -6], [s * 52, -3], [s * 47, 3], [s * 53, 9], [s * 40, 6]];
      knock(c, t); fillPts(c, t, K.I(0.4)); stroke(K, c, t, 1.8, null, true);
    }
    knock(c, b2);
    fillPts(c, b2, o.color && K.color ? K.C(o.color, 0.25) : K.I(0.06));
    stroke(K, c, b2, 2.0, null, true);
    c.save(); c.translate(0, 0); c.rotate(-0.03);
    word(K, c, o.text || "Mom", o.face || "script", 60, 11);
    c.restore();
  };

  // A SWALLOW in flight, facing left: dark back and wings, red throat (colour)
  M.swallow = function (K, c) {
    const col = K.color;
    const wingU = []; bez([4, -4], [-6, -26], [18, -44], [42, -40], 12, wingU); bez([42, -40], [26, -30], [22, -14], [12, -2], 10, wingU);
    const wingD = []; bez([2, 6], [-4, 22], [10, 34], [30, 40], 10, wingD); bez([30, 40], [22, 28], [18, 16], [12, 4], 10, wingD);
    const body = []; bez([-30, -4], [-18, -14], [10, -10], [24, -2], 12, body); bez([24, -2], [10, 10], [-16, 8], [-30, -4], 12, body);
    const tail = [[20, -4], [46, 6], [30, 2], [46, 16], [18, 4]];
    for (const part of [wingD, tail, body, wingU]) knock(c, part);
    fillPts(c, wingD, col ? K.C("blue", 0.95) : K.I(0.9));
    fillPts(c, tail, col ? K.C("blue", 0.95) : K.I(0.9));
    fillPts(c, body, linear(c, 0, -10, 0, 8, [[0, col ? K.C("blue", 0.95) : K.I(0.9)], [0.55, col ? K.C("blue", 0.9) : K.I(0.7)], [0.56, K.I(0.04)], [1, K.I(0.04)]]));
    fillPts(c, wingU, col ? K.C("blue", 0.95) : K.I(0.9));
    fillPts(c, circlePts(-22, -2, 5.5, 14), col ? K.C("red", 0.9) : K.I(0.35));
    for (const part of [wingD, tail, body, wingU]) stroke(K, c, part, 2.0, null, true);
    for (let i = 0; i < 4; i++) {                              // feather lines on the wing
      stroke(K, c, [[16 + i * 5, -36 + i * 2], [10 + i * 3, -14 + i]], 1.0, K.I(0.4));
    }
    fillPts(c, [[-30, -4], [-38, -2], [-30, 0]], col ? K.C("yellow", 0.95) : K.I(0.8));
    fillPts(c, circlePts(-25, -6, 1.3, 8), "rgba(0,0,0,0)");
    c.save(); c.globalCompositeOperation = "destination-out"; fillPts(c, circlePts(-25, -6.5, 1.4, 8), "#000"); c.restore();
  };

  // AN ANCHOR with a rope through the ring
  M.anchor = function (K, c) {
    const sh = [[-3, -30], [3, -30], [3, 26], [-3, 26]];
    knock(c, sh); fillPts(c, sh, K.I(0.85)); stroke(K, c, sh, 1.6, null, true);
    stroke(K, c, circlePts(0, -36, 6, 20), 2.6, null, true);
    const st = [[-18, -24], [18, -24], [18, -19], [-18, -19]];
    fillPts(c, st, K.I(0.9));
    const arm = [];
    for (let i = 0; i <= 20; i++) { const a = Math.PI * 0.08 + i / 20 * Math.PI * 0.84; arm.push([Math.cos(a) * 30, 2 + Math.sin(a) * 28]); }
    stroke(K, c, arm, 5.2);
    for (const s of [-1, 1]) fillPts(c, [[s * 29, 8], [s * 36, 2], [s * 32, 16]], K.I());
    const rope = [];
    for (let i = 0; i <= 30; i++) { const t = i / 30; rope.push([-20 + t * 40 + Math.sin(t * 12) * 2, -30 + Math.sin(t * Math.PI) * 26 + t * 8]); }
    stroke(K, c, rope, 1.6, K.I(0.75));
  };

  // A PAIR OF DICE, lit from the top left
  M.dice = function (K, c) {
    const die = function (x, y, s, pips) {
      const top = [[x, y - 10 * s], [x + 14 * s, y - 17 * s], [x + 28 * s, y - 10 * s], [x + 14 * s, y - 3 * s]];
      const left = [[x, y - 10 * s], [x + 14 * s, y - 3 * s], [x + 14 * s, y + 13 * s], [x, y + 6 * s]];
      const right = [[x + 14 * s, y - 3 * s], [x + 28 * s, y - 10 * s], [x + 28 * s, y + 6 * s], [x + 14 * s, y + 13 * s]];
      for (const f of [top, left, right]) knock(c, f);
      fillPts(c, top, K.I(0.05)); fillPts(c, left, K.I(0.3)); fillPts(c, right, K.I(0.62));
      for (const f of [top, left, right]) stroke(K, c, f, 1.8, null, true);
      const pip = function (f, u, v) {
        const p = [f[0][0] + (f[1][0] - f[0][0]) * u + (f[3][0] - f[0][0]) * v, f[0][1] + (f[1][1] - f[0][1]) * u + (f[3][1] - f[0][1]) * v];
        fillPts(c, circlePts(p[0], p[1], 1.6 * s, 8), K.I());
      };
      const P = { 1: [[0.5, 0.5]], 2: [[0.25, 0.25], [0.75, 0.75]], 3: [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8]], 4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]], 5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]], 6: [[0.25, 0.2], [0.25, 0.5], [0.25, 0.8], [0.75, 0.2], [0.75, 0.5], [0.75, 0.8]] };
      (P[pips[0]] || []).forEach(function (q) { pip(top, q[0], q[1]); });
      (P[pips[1]] || []).forEach(function (q) { pip(left, q[0], q[1]); });
      (P[pips[2]] || []).forEach(function (q) { pip(right, q[0], q[1]); });
    };
    die(-34, 4, 1.05, [5, 6, 2]);
    die(2, -2, 1.05, [1, 3, 4]);
  };

  // A TEARDROP: hollow (a loss) or filled (a debt paid)
  M.tear = function (K, c, o) {
    const pts = [];
    bez([0, -40], [4, -22], [26, 4], [0, 38], 12, pts);
    bez([0, 38], [-26, 4], [-4, -22], [0, -40], 12, pts);
    if (o && o.filled) fillPts(c, pts, K.I());
    else stroke(K, c, pts, 7);
  };
  M.dots = function (K, c, o) {
    o = o || {};
    const n = o.n || 3, r = o.r || 9;
    const P = n === 5 ? [[-26, -26], [26, -26], [0, 0], [-26, 26], [26, 26]] : n === 1 ? [[0, 0]] : [[-24, 18], [24, 18], [0, -22]];
    for (let i = 0; i < P.length; i++) fillPts(c, circlePts(P[i][0], P[i][1], r, 16), K.I());
  };

  // IREZUMI WATER (tiles across [-50, 50]): seigaiha scales for the sea,
  // and over them a row of crests that rise, curl forward and break into
  // claws of foam, each carrying two flow lines — the Japanese wave
  M.waves = function (K, c, o) {
    o = o || {};
    const R = 100 / (o.across || 7) / 2, rows = o.rows || 3;
    for (let j = rows - 1; j >= 0; j--) {
      const y = 4 + j * R * 0.95, off = (j % 2) ? R : 0;
      for (let x = -50 - R + off; x <= 50 + R; x += 2 * R) {
        const disc = [];
        for (let a = Math.PI; a <= Math.PI * 2 + 0.01; a += 0.12) disc.push([x + Math.cos(a) * R, y + Math.sin(a) * R]);
        disc.push([x + R, y + R * 0.6], [x - R, y + R * 0.6]);
        knock(c, disc);
        fillPts(c, disc, linear(c, 0, y - R, 0, y, [[0, K.I(0.04)], [1, K.I(0.3)]]));
        for (let k = 4; k >= 1; k--) {
          const rr = R * k / 4, arc = [];
          for (let a = Math.PI; a <= Math.PI * 2 + 0.01; a += 0.1) arc.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
          stroke(K, c, arc, k === 4 ? 1.7 : 1.0, K.I(k === 4 ? 0.95 : 0.65));
        }
      }
    }
    const m = o.crests || 3, w = 100 / m;
    for (let i = 0; i < m; i++) {
      const x0 = -50 + i * w, X = function (f) { return x0 + w * f; };
      // the wave: its back rises from the trough to a crest, the lip throws
      // forward and curls down into a spiral; the face under the lip is a
      // parallel inner line, and the band between them is the dark water
      const outer = [];
      bez([X(-0.02), 5], [X(0.20), 3], [X(0.28), -19], [X(0.56), -22], 12, outer);
      bez([X(0.56), -22], [X(0.84), -24], [X(1.0), -12], [X(0.86), -5], 10, outer);
      bez([X(0.86), -5], [X(0.76), 0], [X(0.64), -8], [X(0.72), -13], 8, outer);
      bez([X(0.72), -13], [X(0.78), -17], [X(0.86), -11], [X(0.80), -9], 6, outer);
      const inner = [];
      bez([X(0.10), 5], [X(0.26), 2], [X(0.34), -13], [X(0.55), -15], 12, inner);
      bez([X(0.55), -15], [X(0.70), -16], [X(0.78), -12], [X(0.74), -8], 8, inner);
      const water = outer.slice(0, 23).concat(inner.slice().reverse());
      knock(c, outer.concat([[X(0.70), 5]]));
      fillPts(c, water, linear(c, 0, -22, 0, 5, [[0, K.I(0.72)], [1, K.I(0.92)]]));
      fillPts(c, inner.concat([[X(0.70), 5]]), linear(c, 0, -15, 0, 5, [[0, K.I(0.03)], [1, K.I(0.28)]]));
      stroke(K, c, outer, 2.2);
      stroke(K, c, inner, 1.5);
      for (let f = 1; f <= 2; f++) {                          // flow lines down the face
        const fl = [];
        bez([X(0.16 + f * 0.05), 5], [X(0.30 + f * 0.04), 1], [X(0.38 + f * 0.03), -9 + f * 2], [X(0.56), -11 + f * 3], 10, fl);
        stroke(K, c, fl, 1.0, K.I(0.7));
      }
      // foam: claws thrown forward off the lip, each a little hook
      for (let k = 0; k < 5; k++) {
        const t = k / 4, px = X(0.50 + t * 0.34), py = -23 + t * t * 11;
        const claw = [];
        for (let q = 0; q <= 8; q++) {
          const u = q / 8, a2 = -Math.PI * 0.7 + u * Math.PI * 1.3, rr = 2.8 * (1 - u * 0.45);
          claw.push([px + 1.6 + Math.cos(a2) * rr, py - 2.6 + Math.sin(a2) * rr]);
        }
        stroke(K, c, claw, 1.2);
      }
      fillPts(c, circlePts(X(0.93), -20, 1.1, 8), K.I());   // spray
      fillPts(c, circlePts(X(0.97), -16, 0.8, 8), K.I());
    }
  };
  // WIND BARS: the black ground an irezumi sleeve is carved out of, with long
  // sweeping bars left as skin, tapered at both ends (tiles across [-50, 50])
  M.windbars = function (K, c, o) {
    o = o || {};
    const h = o.h || 24;
    fillPts(c, [[-50, -h / 2], [50, -h / 2], [50, h / 2], [-50, h / 2]], K.I(0.93));
    c.save(); c.globalCompositeOperation = "destination-out";
    const lanes = Math.max(2, Math.round(h / 7));
    for (let i = 0; i < lanes; i++) {
      const y0 = -h / 2 + (i + 0.5) * h / lanes;
      let x = -50 - (i % 2) * 22 - K.rng() * 10;
      while (x < 50) {
        const L = 34 + K.rng() * 26, mw = h / lanes * (0.42 + K.rng() * 0.2), top = [], bot = [];
        for (let q = 0; q <= 16; q++) {
          const t = q / 16, cx = x + t * L, cy = y0 + Math.sin(t * Math.PI * 1.4 + i) * 1.6;
          const ww = mw * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.8) * (1 - 0.35 * t);
          top.push([cx, cy - ww / 2]); bot.push([cx, cy + ww / 2]);
        }
        fillPts(c, top.concat(bot.reverse()), "#000");
        x += L + 6 + K.rng() * 6;
      }
    }
    c.restore();
  };
  // a CHERRY BLOSSOM: five notched petals, stamens
  M.blossom = function (K, c, o) {
    o = o || {};
    const pink = o.color && K.color;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i / 5 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const P = function (f, s) { return [ca * f - sa * s, sa * f + ca * s]; };
      const pet = [];
      bez(P(3, -2), P(14, -14), P(30, -12), P(34, -3), 8, pet);
      pet.push(P(30, 0));
      bez(P(34, 3), P(30, 12), P(14, 14), P(3, 2), 8, pet);
      knock(c, pet);
      fillPts(c, pet, radial(c, 0, 0, 2, 34, pink ? [[0, K.C("pink", 0.9)], [1, K.C("pink", 0.35)]] : [[0, K.I(0.55)], [0.5, K.I(0.12)], [1, K.I(0)]]));
      stroke(K, c, pet, 1.8, null, true);
    }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      stroke(K, c, [[0, 0], [Math.cos(a) * 8, Math.sin(a) * 8]], 0.9);
      fillPts(c, circlePts(Math.cos(a) * 8.5, Math.sin(a) * 8.5, 1.2, 6), K.I());
    }
  };

  // POLYNESIAN BAND (tiles across [-50, 50]): solid rules, shark teeth,
  // spearheads and an ocean line, the way a Samoan/Marquesan band stacks
  M.tribal = function (K, c, o) {
    o = o || {};
    const n = o.teeth || 12, w = 100 / n;
    fillPts(c, [[-50, -20], [50, -20], [50, -16], [-50, -16]], K.I());
    for (let i = 0; i < n; i++) {
      const x = -50 + i * w;
      fillPts(c, [[x, -14], [x + w, -14], [x + w / 2, -5]], K.I());
      fillPts(c, [[x + w / 2, -4], [x + w * 1.5, -4], [x + w, -12.5]], K.I(i % 2 ? 0.95 : 0));
    }
    fillPts(c, [[-50, -3], [50, -3], [50, -1.2], [-50, -1.2]], K.I());
    for (let i = 0; i < n; i++) {                             // spearheads
      const x = -50 + i * w + w / 2;
      fillPts(c, [[x - w * 0.45, 7], [x, 1], [x + w * 0.45, 7], [x, 4.5]], K.I());
    }
    const sea = [];
    for (let x = -50; x <= 50.01; x += 0.8) sea.push([x, 10.5 + Math.sin((x + 50) / w * Math.PI) * 1.8]);
    stroke(K, c, sea, 1.8);
    fillPts(c, [[-50, 14], [50, 14], [50, 20], [-50, 20]], K.I());
  };
  // BATOK: Visayan / Kalinga linework — ladders, chevrons, a diamond chain
  M.batok = function (K, c, o) {
    o = o || {};
    const n = o.n || 10, w = 100 / n;
    stroke(K, c, [[-50, -18], [50, -18]], 1.8); stroke(K, c, [[-50, -13], [50, -13]], 1.8);
    for (let x = -50; x < 50; x += w / 2) stroke(K, c, [[x, -18], [x, -13]], 1.4);
    for (let i = 0; i < n; i++) {
      const x = -50 + i * w;
      stroke(K, c, [[x, -2], [x + w / 2, -9], [x + w, -2]], 2.2);
      stroke(K, c, [[x, 3], [x + w / 2, -4], [x + w, 3]], 1.4);
      const d = [[x + w / 2, 6], [x + w, 11.5], [x + w / 2, 17], [x, 11.5]];
      fillPts(c, d, K.I(i % 2 ? 0.95 : 0.35)); stroke(K, c, d, 1.2, null, true);
    }
    stroke(K, c, [[-50, 20], [50, 20]], 2.4);
  };
  // YANT: rows of Khom-style script (open loops, a small circle at each
  // stroke's head) between ruled lines — abstract, never a real text
  M.yant = function (K, c, o) {
    o = o || {};
    const rows = o.rows || 5, cols = o.cols || 9, lh = 100 / rows * 0.8;
    for (let r = 0; r <= rows; r++) stroke(K, c, [[-44, -40 + r * lh], [44, -40 + r * lh]], 0.9, K.I(0.6));
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = -40 + q * (80 / (cols - 1)), y = -40 + r * lh + lh * 0.55, s = lh * 0.3;
      fillPts(c, circlePts(x - s * 0.6, y - s * 0.5, s * 0.22, 8), K.I());
      const g = [], kind = Math.floor(K.rng() * 3);
      if (kind === 0) { g.push([x - s * 0.6, y - s * 0.5]); bez([x - s * 0.6, y - s * 0.5], [x - s * 0.8, y + s * 0.7], [x + s * 0.8, y + s * 0.7], [x + s * 0.6, y - s * 0.6], 8, g); }
      else if (kind === 1) { g.push([x - s * 0.6, y - s * 0.5]); bez([x - s * 0.6, y - s * 0.5], [x - s * 0.6, y + s * 0.6], [x, y + s * 0.6], [x, y - s * 0.2], 8, g); bez([x, y - s * 0.2], [x, y + s * 0.6], [x + s * 0.6, y + s * 0.6], [x + s * 0.6, y - s * 0.6], 8, g); }
      else { g.push([x - s * 0.6, y - s * 0.5]); bez([x - s * 0.6, y - s * 0.5], [x + s, y - s], [x + s, y + s * 0.8], [x - s * 0.3, y + s * 0.5], 8, g); }
      stroke(K, c, g, 1.1);
    }
  };
  // GAO YORD: nine spires over a base, the Thai master yant
  M.spires = function (K, c) {
    for (let i = 0; i < 9; i++) {
      const x = (i - 4) * 9, h = 34 - Math.abs(i - 4) * 3;
      const sp = [];
      sp.push([x - 3.4, 16]);
      bez([x - 3.4, 16], [x - 4, 16 - h * 0.6], [x - 1, 16 - h * 0.9], [x, 16 - h], 8, sp);
      bez([x, 16 - h], [x + 1, 16 - h * 0.9], [x + 4, 16 - h * 0.6], [x + 3.4, 16], 8, sp);
      stroke(K, c, sp, 1.4);
      const sw = [];
      for (let k = 0; k <= 12; k++) { const t = k / 12, a = t * Math.PI * 3; sw.push([x + Math.cos(a) * 1.8 * (1 - t), 16 - h - 3 + Math.sin(a) * 1.8 * (1 - t)]); }
      stroke(K, c, sw, 0.9);
    }
    stroke(K, c, [[-42, 17], [42, 17]], 2.0);
    stroke(K, c, [[-42, 21], [42, 21]], 1.2);
    c.save(); c.translate(0, 40); c.scale(0.9, 0.45); M.yant(K, c, { rows: 2, cols: 9 }); c.restore();
  };
  // a modern BLACKWORK geometric: dotwork rings, a triangle, a sun of petals
  M.geo = function (K, c) {
    for (let k = 1; k <= 3; k++) {
      const r = 12 + k * 9, n = 10 + k * 8;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; fillPts(c, circlePts(Math.cos(a) * r, Math.sin(a) * r, 0.9 + 0.25 * (3 - k), 6), K.I(0.9)); }
    }
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const p = quad([ca * 4, sa * 4], [ca * 12 - sa * 5, sa * 12 + ca * 5], [ca * 18, sa * 18], 6).concat(quad([ca * 18, sa * 18], [ca * 12 + sa * 5, sa * 12 - ca * 5], [ca * 4, sa * 4], 6));
      stroke(K, c, p, 1.1);
    }
    stroke(K, c, [[0, -46], [40, 23], [-40, 23]], 1.6, null, true);
    fillPts(c, circlePts(0, 0, 3.5, 12), K.I());
  };
  // FINE LINE: a single-needle stem with small leaves and a bud
  M.sprig = function (K, c) {
    const stem = [];
    bez([0, 44], [-6, 14], [6, -16], [0, -40], 20, stem);
    stroke(K, c, stem, 1.0);
    for (let i = 0; i < 5; i++) {
      const t = 0.2 + i * 0.14, p = stem[Math.floor(t * (stem.length - 1))], s = i % 2 ? 1 : -1;
      const lf = quad([p[0], p[1]], [p[0] + s * 9, p[1] - 8], [p[0] + s * 13, p[1] - 3], 6).concat(quad([p[0] + s * 13, p[1] - 3], [p[0] + s * 6, p[1] + 1], [p[0], p[1]], 6));
      stroke(K, c, lf, 0.9);
    }
    const bud = [];
    bez([0, -40], [-5, -44], [-4, -52], [0, -54], 6, bud); bez([0, -54], [4, -52], [5, -44], [0, -40], 6, bud);
    stroke(K, c, bud, 1.0);
  };
  // KNUCKLE MARKS (hand chart, one finger column)
  M.letter = function (K, c, o) {
    word(K, c, o.ch, o.face || "block", 60, 70, { weight: "900" });
  };
  M.ring = function (K, c, o) {
    // a vory "ring" on a finger: a band with a patterned square on the back
    fillPts(c, [[-50, -10], [50, -10], [50, -6], [-50, -6]], K.I());
    fillPts(c, [[-50, 6], [50, 6], [50, 10], [-50, 10]], K.I(0.9));
    const sq = [[-16, -16], [16, -16], [16, 16], [-16, 16]];
    knock(c, sq);
    const k = (o && o.kind) || 0;
    if (k === 0) fillPts(c, sq, K.I());
    else if (k === 1) { stroke(K, c, sq, 3, null, true); fillPts(c, [[-16, -16], [16, 16], [-16, 16]], K.I()); }
    else if (k === 2) { stroke(K, c, sq, 3, null, true); stroke(K, c, [[0, -16], [0, 16]], 3); stroke(K, c, [[-16, 0], [16, 0]], 3); }
    else { fillPts(c, sq, K.I()); c.save(); c.globalCompositeOperation = "destination-out"; fillPts(c, circlePts(0, 0, 7, 16), "#000"); c.restore(); }
  };

  /* ============================================================
     CHART LAYOUTS: where a motif lands and at what size. `put` tiles an arm
     motif at u-1, u, u+1 so a piece wraps round the limb seamlessly.
     ============================================================ */
  // anatomical u on the ARM chart. The loft's u runs front (+z) -> +x -> back
  // -> -x; the LEFT arm hangs at +x (character.js la), so its outer face is
  // the +x quadrant, the right arm's is -x. Hanging relaxed the palm faces
  // the thigh: front = the thumb side of the forearm / the biceps, outer =
  // the back of the forearm (the side you see down your own arms), inner =
  // the soft inside of the forearm, back = the triceps / the elbow point.
  function armU(side) {
    const L = side === "L";
    return { F: 0.125, O: L ? 0.375 : 0.875, B: 0.625, I: L ? 0.875 : 0.375 };
  }
  function armPainter(ctx, W, H, pad, mode, fpScale) {
    const segs = mode === "fore"
      ? { lo: { y0: 0, y1: H, a: ASPECT.fp } }
      : { up: { y0: 0, y1: H * ARM_SPLIT, a: ASPECT.up }, lo: { y0: H * ARM_SPLIT, y1: H, a: ASPECT.lo } };
    const k = mode === "fore" ? (fpScale || 1.4) : 1;
    // first person sees the WRIST half of its forearm (the elbow is under the
    // lens), so a forearm piece rides nearer the wrist there; an elbow piece
    // stays on the elbow
    const fpT = mode === "fore" ? function (t) { return t < 0.12 ? t : 0.28 + 0.72 * t; } : function (t) { return t; };
    return {
      mode: mode,
      // size: motif width as a share of the circumference; t: 0 top .. 1 bottom of the segment
      put: function (seg, u, t, size, fn, rot, sy) {
        const S = segs[seg];
        if (!S) return;
        const sx = W * size * k / 100, syy = (S.y1 - S.y0) / S.a * size * k / 100 * (sy || 1);
        const y = S.y0 + fpT(t) * (S.y1 - S.y0), r = rot || 0, cr = Math.cos(r), sr = Math.sin(r);
        for (let rep = -1; rep <= 1; rep++) {
          const x = pad + (u + rep) * W;
          if (x + W * size * k < 0 || x - W * size * k > W + 2 * pad) continue;
          ctx.save();
          ctx.setTransform(sx * cr, syy * sr, -sx * sr, syy * cr, x, y);
          fn(ctx);
          ctx.restore();
        }
      },
      // a band round the whole limb at t (motif spans [-50, 50] = one full turn)
      band: function (seg, t, hPct, fn) {
        const S = segs[seg];
        if (!S) return;
        const sx = W / 100, syy = (S.y1 - S.y0) / S.a / 100 * (hPct || 1) * k;
        const y = S.y0 + fpT(t) * (S.y1 - S.y0);
        for (let rep = -1; rep <= 1; rep++) {
          ctx.save();
          ctx.setTransform(sx, 0, 0, syy, pad + (0.5 + rep) * W, y);
          fn(ctx);
          ctx.restore();
        }
      },
    };
  }
  // HEAD: front [0, .5], side [.5, .75], back [.75, 1] of the width; skull y
  // [0, .8], neck [.8, 1]. One unit = 1% of the head's width both ways.
  const HEAD_COLS = { front: [0, 0.5], side: [0.5, 0.75], back: [0.75, 1] };
  /* THE NECK (atlas y .8 .. 1) is character.js's neck column: a quadrant loft
     whose front QUARTER (about 0.235 of arc, 39% of a head's width) is the
     whole front column, each side quarter the side column, the back quarter
     the back, over 0.30 of height. So a throat piece is drawn at the neck's
     own scale and must fit its quarter (a wider one would run into the side
     column's picture, not round the neck). */
  const NECK = { arc: 39.2, tall: 50 };            // in 1%-of-head-width units
  function headPainter(ctx, W, H, pad) {
    return {
      put: function (col, fx, fy, size, fn, rot) {
        const C = HEAD_COLS[col], cw = (C[1] - C[0]) * W;
        const neck = fy >= 0.8;
        const sx = neck ? cw / NECK.arc * size / 100 : cw * size / 1e4;
        const sy = neck ? H * 0.2 / NECK.tall * size / 100 : H * 0.8 * size / 1e4;
        const r = rot || 0, cr = Math.cos(r), sr = Math.sin(r);
        ctx.save();
        ctx.beginPath(); ctx.rect(pad + C[0] * W, neck ? H * 0.8 : 0, cw, neck ? H * 0.2 : H * 0.8); ctx.clip();
        ctx.setTransform(sx * cr, sy * sr, -sx * sr, sy * cr, pad + C[0] * W + fx * cw, fy * H);
        fn(ctx);
        ctx.restore();
      },
    };
  }
  // HAND: finger columns (index, middle, ring, little, thumb) of 1/8 width,
  // knuckle at y .75H, tip at 0; the back of the hand in x [.625, 1],
  // knuckles at the top. Below .75H in the finger block is the blank the
  // palm side samples.
  const HAND = { col: 0.125, fingerH: 0.75, palmX: 0.625, blank: [0.30, 0.05] };
  function handPainter(ctx, W, H, pad) {
    return {
      // finger i, a = 0 knuckle .. 1 tip
      finger: function (i, a, size, fn) {
        const cw = HAND.col * W, fh = HAND.fingerH * H;
        ctx.save();
        ctx.beginPath(); ctx.rect(pad + i * cw, 0, cw, fh); ctx.clip();
        ctx.setTransform(cw * size / 1e4, 0, 0, fh / 1.46 * size / 1e4, pad + (i + 0.5) * cw, fh * (1 - a));
        fn(ctx);
        ctx.restore();
      },
      // the back of the hand: fx 0 thumb side .. 1 little-finger side (right
      // hand; the left hand's UVs are mirrored so the same art reads true),
      // fy 0 knuckles .. 1 wrist
      back: function (fx, fy, size, fn, rot) {
        const x0 = pad + HAND.palmX * W, pw = (1 - HAND.palmX) * W;
        const sx = pw * size / 1e4, sy = H / 1.14 * size / 1e4, r = rot || 0, cr = Math.cos(r), sr = Math.sin(r);
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, 0, pw, H); ctx.clip();
        ctx.setTransform(sx * cr, sy * sr, -sx * sr, sy * cr, x0 + fx * pw, fy * H);
        fn(ctx);
        ctx.restore();
      },
    };
  }

  /* ============================================================
     WORDS. Real words people get, never a real gang's name or symbol.
     Area codes and home states stand where a yard's numbers would.
     ============================================================ */
  const WORDS = {
    chicano: ["Familia", "Madre", "Rosa", "Lupita", "Por Vida", "Mi Vida", "Carnal", "Barrio", "Consuelo", "Esperanza"],
    black: ["Loyalty", "Respect", "Blessed", "Mama", "Trust No One", "Only God", "Real", "Faith", "Legacy", "Rest Easy"],
    white: ["Mother", "Sinner", "Lost Soul", "Loyalty", "Outlaw", "Sarah", "Forgive Me", "No Regrets"],
    city: ["Mom", "Faith", "Hope", "Love", "Family", "Blessed", "Believe", "Breathe", "Isabella", "Grace", "Sophia", "Marcus"],
    area: ["213", "323", "310", "562", "619", "818", "909", "951", "510", "415", "504", "713", "312", "305", "718", "602"],
    state: ["Jalisco", "Sinaloa", "Michoacan", "Oaxaca", "Guerrero", "Durango", "Zacatecas", "Sonora"],
    knuckles: [["HOLD", "FAST"], ["STAY", "TRUE"], ["LOVE", "HATE"], ["HARD", "TIME"], ["RIDE", "SLOW"], ["GOOD", "LUCK"], ["LIFE", "LOSS"]],
    island: ["Aloha", "Ohana", "Malu", "Tama"],
  };

  /* ============================================================
     COMPOSITIONS. key = kind:fam:side:variant:age[:home] — everything a chart
     needs to redraw itself identically from its key alone.
     ============================================================ */
  // line weight by style: fine-line black-and-grey and single-needle work run
  // thin, American traditional runs bold
  const LINE = { chicano: 0.62, script: 0.7, fine: 0.55, yant: 0.7, paisa: 0.75, trad: 1.15, color: 1.05 };
  function parseKey(key) {
    const p = String(key).split(":");
    return { kind: p[0], fam: p[1] || "", side: p[2] || "R", v: +p[3] || 0, age: +p[4] || 0, home: p[5] === "h" };
  }
  function carWords(fam) {
    if (fam === "chicano" || fam === "paisa") return WORDS.chicano;
    if (fam === "block" || fam === "dots" || fam === "script") return WORDS.black;
    if (fam === "blackwork" || fam === "web" || fam === "vory") return WORDS.white;
    return WORDS.city;
  }

  // ---- ARMS ------------------------------------------------------------------
  const ARM = {};
  ARM.chicano = function (P, K, side, v) {
    const U = armU(side), r = K.rng;
    const w = pick(carWords("chicano"), r());
    if (side === "R") {
      if (v % 2 === 0) { P.put("up", U.O, 0.44, 0.36, function (c) { M.rose(K, c, {}); }); P.put("up", U.O, 0.80, 0.40, function (c) { M.clouds(K, c, { n: 4 }); }, 0, 0.8); }
      else { P.put("up", U.O, 0.44, 0.38, function (c) { M.masks(K, c); }); P.put("up", U.O, 0.82, 0.42, function (c) { M.clouds(K, c, { n: 4 }); }, 0, 0.8); }
      P.put("lo", U.O, 0.46, 0.40, function (c) { word(K, c, w, "script", 92, 40, { shade: true }); }, Math.PI);
      if (v >= 2) P.put("lo", U.F, 0.4, 0.26, function (c) { M.clock(K, c); });
    } else {
      if (v % 2 === 0) P.put("up", U.O, 0.42, 0.34, function (c) { M.cross(K, c); });
      else P.put("up", U.O, 0.44, 0.34, function (c) { M.dice(K, c); });
      P.put("lo", U.O, 0.44, 0.40, function (c) { word(K, c, pick(WORDS.area, r()), "old", 84, 40, { shade: true }); });
      P.band("lo", 0.93, 0.9, function (c) { M.rosary(K, c); });
    }
  };
  ARM.paisa = function (P, K, side, v) {
    const U = armU(side), r = K.rng;
    if (side === "R") {
      P.put("lo", U.O, 0.5, 0.38, function (c) { word(K, c, pick(WORDS.state, r()), "script", 92, 34); }, Math.PI);
      if (v % 2) P.put("lo", U.O, 0.18, 0.12, function (c) { M.star(K, c, {}); });
    } else if (v >= 2) P.put("lo", U.I, 0.55, 0.18, function (c) { M.cross(K, c, { rays: false, clouds: false }); });
  };
  ARM.dots = function (P, K, side, v) {
    const U = armU(side);
    if (side === "R") for (let i = 0; i < 5; i++) P.put("lo", U.O, 0.18 + i * 0.16, 0.05, function (c) { M.dots(K, c, { n: 1, r: 30 }); });
    else if (v % 2) P.put("up", U.O, 0.5, 0.18, function (c) { M.dots(K, c, { n: 3 }); });
  };
  ARM.block = function (P, K, side, v) {
    const U = armU(side), r = K.rng;
    P.put("lo", U.O, 0.46, 0.42, function (c) { word(K, c, pick(WORDS.area, r()), "old", 86, 42, { shade: true }); });
    if (side === "R") P.put("up", U.F, 0.42, 0.34, function (c) { M.banner(K, c, { text: pick(carWords("block"), r()) }); });
    else if (v % 2) P.put("up", U.O, 0.44, 0.30, function (c) { M.star(K, c, {}); });
  };
  ARM.script = function (P, K, side, v) {
    const U = armU(side), r = K.rng;
    if (side === "R") P.put("lo", U.I, 0.5, 0.46, function (c) { word(K, c, pick(carWords("script"), r()), "script", 94, 38); }, Math.PI);
    else if (v % 2) P.put("up", U.O, 0.5, 0.40, function (c) { word(K, c, pick(carWords("script"), r()), "script", 92, 34); });
  };
  ARM.web = function (P, K, side) {
    const U = armU(side);
    P.put("lo", U.B, 0.02, 0.46, function (c) { M.web(K, c, { spider: side === "L" }); });
  };
  ARM.blackwork = function (P, K, side, v) {
    const U = armU(side);
    P.band("up", 0.20, 1.2, function (c) { M.wire(K, c, {}); });
    P.put("lo", U.B, 0.02, 0.46, function (c) { M.web(K, c, {}); });
    if (side === "R") {
      P.put("up", U.O, 0.60, 0.34, function (c) { M.skull(K, c, { crack: v % 2 }); });
      P.put("lo", U.O, 0.50, 0.32, function (c) { M.dice(K, c); });
      P.band("lo", 0.90, 1, function (c) { M.band(K, c, { h: 9 }); });
    } else {
      P.put("up", U.O, 0.62, 0.30, function (c) { M.star(K, c, {}); });
      P.put("lo", U.O, 0.50, 0.34, function (c) { M.skull(K, c, {}); });
      P.band("lo", 0.90, 1, function (c) { M.wire(K, c, { twists: 6 }); });
    }
  };
  ARM.vory = function (P, K, side, v) {
    const U = armU(side);
    P.put("up", U.F, 0.14, 0.24, function (c) { M.star(K, c, { points: 8, inner: 12 }); });
    if (side === "R") P.put("up", U.O, 0.58, 0.40, function (c) { M.domes(K, c, { domes: 1 + (v % 3) * 1 + 1 }); });
    else P.put("lo", U.O, 0.42, 0.40, function (c) { M.dagger(K, c, { heart: false }); });
    // the bracelet: two rules round the wrist
    P.band("lo", 0.86, 1, function (c) { M.band(K, c, { h: 2.6 }); });
    P.band("lo", 0.93, 1, function (c) { M.band(K, c, { h: 2.6 }); });
  };
  ARM.sleeve = function (P, K, side) {
    const U = armU(side);
    if (side !== "R") return;
    P.band("up", 0.13, 1.8, function (c) { M.windbars(K, c, { h: 16 }); });
    P.put("up", U.O, 0.52, 0.30, function (c) { M.blossom(K, c, { color: true }); });
    P.put("up", U.F, 0.62, 0.22, function (c) { M.blossom(K, c, { color: true }); }, 0.6);
    P.put("up", U.B, 0.48, 0.24, function (c) { M.blossom(K, c, { color: true }); }, -0.4);
    P.band("up", 0.94, 1.3, function (c) { M.windbars(K, c, { h: 12 }); });
    P.band("lo", 0.36, 1.25, function (c) { M.waves(K, c, { across: 7, rows: 3 }); });
    P.band("lo", 0.84, 1, function (c) { M.windbars(K, c, { h: 14 }); });
  };
  ARM.yant = function (P, K, side) {
    const U = armU(side);
    if (side === "R") P.put("up", U.O, 0.46, 0.44, function (c) { M.spires(K, c); });
    else P.put("up", U.O, 0.5, 0.40, function (c) { M.yant(K, c, { rows: 5, cols: 7 }); }, 0, 1.2);
  };
  ARM.batok = function (P, K, side) {
    P.band("up", 0.26, 1, function (c) { M.batok(K, c, { n: 10 }); });
    P.band("lo", 0.40, 1, function (c) { M.batok(K, c, { n: 9 }); });
    if (side === "R") P.band("up", 0.64, 0.8, function (c) { M.batok(K, c, { n: 12 }); });
  };
  ARM.tribal = function (P, K, side) {
    P.band("up", 0.36, 1.3, function (c) { M.tribal(K, c, { teeth: 12 }); });
    if (side === "R") P.band("lo", 0.40, 1.1, function (c) { M.tribal(K, c, { teeth: 10 }); });
  };
  ARM.teardrop = function () {};
  ARM.chest = function () {};
  // ---- the street (cleaner, sparser, some colour) ----
  ARM.trad = function (P, K, side, v) {
    const U = armU(side), r = K.rng;
    if (side === "R") {
      if (v % 3 === 0) P.put("up", U.O, 0.48, 0.38, function (c) { M.swallow(K, c); });
      else if (v % 3 === 1) P.put("up", U.O, 0.48, 0.34, function (c) { M.star(K, c, { color: "red", color2: null }); });
      else P.put("up", U.O, 0.48, 0.30, function (c) { M.dagger(K, c, { heart: true, color: true }); });
      P.put("lo", U.O, 0.44, 0.34, function (c) { M.rose(K, c, { color: true }); });
    } else {
      if (v % 2) P.put("up", U.O, 0.5, 0.40, function (c) { M.heart(K, c, { color: true, s: 0.8 }); M.banner(K, c, { text: pick(["Mom", "Mother", "Mama"], r()), color: "yellow" }); });
      else P.put("lo", U.O, 0.44, 0.30, function (c) { M.anchor(K, c); });
    }
  };
  ARM.fine = function (P, K, side, v) {
    const U = armU(side), r = K.rng;
    if (side === "R") P.put("lo", U.I, 0.74, 0.28, function (c) { word(K, c, pick(WORDS.city, r()), "script", 92, 30, { weight: "400" }); }, Math.PI);
    else if (v % 2) P.put("lo", U.I, 0.62, 0.20, function (c) { M.sprig(K, c); });
    else P.put("lo", U.F, 0.80, 0.10, function (c) { M.heart(K, c, { color: false, s: 0.8 }); });
  };
  ARM.armband = function (P, K, side, v) {
    if ((side === "R") === (v % 2 === 0)) P.band("up", 0.40, 1.2, function (c) { M.tribal(K, c, { teeth: 14 }); });
  };
  ARM.color = function (P, K, side, v) {
    const U = armU(side);
    if (side !== "R") return;
    P.put("up", U.O, 0.36, 0.36, function (c) { M.rose(K, c, { color: true }); });
    P.put("up", U.F, 0.72, 0.26, function (c) { M.blossom(K, c, { color: true }); }, 0.5);
    P.put("up", U.B, 0.56, 0.26, function (c) { M.rose(K, c, { color: true, hue: v % 2 ? "purple" : "red" }); }, -0.3);
    P.put("lo", U.O, 0.34, 0.30, function (c) { M.swallow(K, c); });
    P.put("lo", U.I, 0.46, 0.26, function (c) { M.blossom(K, c, { color: true }); });
    P.band("lo", 0.93, 0.55, function (c) { M.waves(K, c, { across: 8, rows: 2 }); });
  };
  ARM.geo = function (P, K, side) {
    const U = armU(side);
    if (side === "R") P.put("lo", U.O, 0.46, 0.36, function (c) { M.geo(K, c); });
  };

  // ---- HEADS -------------------------------------------------------------------
  // landmarks: eye y .35 (bottom .40), cheek .47, throat .86-.95; front x .5 =
  // the nose; the character's right eye sits at front x ~.32, left ~.68
  const HEAD = {};
  HEAD.teardrop = function (P, K, v) { P.put("front", 0.315, 0.475, 5.2, function (c) { M.tear(K, c, { filled: v % 2 === 1 }); }); };
  HEAD.chicano = function (P, K, v) {
    const w = pick(WORDS.chicano, K.rng());
    P.put("front", 0.5, 0.915, 34, function (c) { word(K, c, w, "script", 94, 34, { shade: true }); });
    P.put("front", 0.75, 0.465, 7, function (c) { M.dots(K, c, { r: 11 }); });
    if (v >= 2) HEAD.teardrop(P, K, 1);
  };
  HEAD.paisa = function () {};
  HEAD.dots = function (P, K) {
    P.put("front", 0.75, 0.465, 7.5, function (c) { M.dots(K, c, { r: 11 }); });
    for (let i = 0; i < 4; i++) P.put("side", 0.22 + i * 0.18, 0.9, 2.6, function (c) { M.dots(K, c, { n: 1, r: 40 }); });
  };
  HEAD.block = function (P, K) {
    const a = pick(WORDS.area, K.rng());
    P.put("front", 0.5, 0.915, 30, function (c) { word(K, c, a, "old", 92, 46, { shade: true }); });
    P.put("side", 0.5, 0.885, 16, function (c) { M.star(K, c, {}); });
  };
  HEAD.script = function (P, K) {
    const w = pick(WORDS.black, K.rng());
    P.put("front", 0.5, 0.915, 36, function (c) { word(K, c, w, "script", 94, 34); });
  };
  HEAD.web = function (P, K) { P.put("side", 0.5, 0.88, 32, function (c) { M.web(K, c, { rings: 4, spokes: 8 }); }); };
  HEAD.blackwork = function (P, K, v) {
    const w = pick(WORDS.white, K.rng());
    P.put("side", 0.74, 0.43, 22, function (c) { M.web(K, c, { rings: 4, spokes: 8 }); });
    P.put("side", 0.30, 0.18, 16, function (c) { c.translate(0, -8); M.band(K, c, { h: 9 }); c.translate(0, 16); M.band(K, c, { h: 9 }); });
    P.put("front", 0.5, 0.915, 34, function (c) { word(K, c, w, "old", 94, 40, { shade: true }); });
    P.put("back", 0.5, 0.9, 39.2, function (c) { M.wire(K, c, { twists: 4, amp: 2.4, w: 2.4, barb: 6 }); });
    if (v % 2) HEAD.teardrop(P, K, 1);
  };
  HEAD.vory = function (P, K) { P.put("side", 0.5, 0.885, 20, function (c) { M.star(K, c, { points: 8, inner: 12 }); }); };
  HEAD.tribal = function (P, K) { P.put("side", 0.5, 0.88, 39.2, function (c) { M.tribal(K, c, { teeth: 6 }); }); };
  HEAD.batok = function (P, K) { P.put("side", 0.5, 0.88, 39.2, function (c) { M.batok(K, c, { n: 5 }); }); };
  HEAD.yant = function (P, K) { P.put("back", 0.5, 0.88, 38, function (c) { M.yant(K, c, { rows: 3, cols: 7 }); }); };
  HEAD.trad = function (P, K) { P.put("side", 0.45, 0.9, 18, function (c) { M.rose(K, c, { color: true, leaves: true }); }); };
  HEAD.fine = function (P, K) { P.put("side", 0.8, 0.52, 8, function (c) { M.heart(K, c, { s: 0.7 }); }); };

  // ---- HANDS -------------------------------------------------------------------
  /* KNUCKLE LETTERS read the way knuckle ink is laid: for the man across
     from you when the fists come up, knuckles forward. So each letter's top
     is toward the knuckle (drawn turned half round), the first word is on
     the RIGHT fist, read little finger -> index, and the second on the
     left, index -> little. */
  const HANDS = {};
  function knuckleWord(P, K, side, text) {
    for (let j = 0; j < 4; j++) {
      const fi = side === "R" ? 3 - j : j;
      P.finger(fi, 0.18, 42, function (c) { c.rotate(Math.PI); M.letter(K, c, { ch: text[j] }); });
    }
  }
  HANDS.block = function (P, K, side, v) {
    const pair = pick(WORDS.knuckles, rngOf("k" + v)());
    knuckleWord(P, K, side, side === "R" ? pair[0] : pair[1]);
  };
  HANDS.blackwork = function (P, K, side, v) {
    if (v % 2) HANDS.block(P, K, side, v);
    else for (let i = 0; i < 4; i++) P.finger(i, 0.18, 26, function (c) { M.dots(K, c, { n: 1, r: 40 }); });
    if (side === "L") P.back(0.46, 0.38, 42, function (c) { M.web(K, c, { rings: 4 }); });
  };
  HANDS.vory = function (P, K, side, v) {
    for (let i = 0; i < 3; i++) P.finger(i + (side === "L" ? 1 : 0), 0.20, 70, function (c) { M.ring(K, c, { kind: (v + i) % 4 }); });
  };
  HANDS.chicano = function (P, K, side) {
    if (side === "L") P.back(0.16, 0.30, 16, function (c) { M.dots(K, c, { r: 10 }); });
    else P.back(0.52, 0.42, 30, function (c) { M.cross(K, c, { clouds: false }); });
  };
  HANDS.dots = function (P, K, side) {
    if (side === "L") P.back(0.16, 0.30, 16, function (c) { M.dots(K, c, { r: 10 }); });
    else P.back(0.20, 0.30, 18, function (c) { M.dots(K, c, { n: 5, r: 8 }); });
  };
  HANDS.web = function (P, K, side) { if (side === "R") P.back(0.46, 0.4, 44, function (c) { M.web(K, c, { rings: 4 }); }); };
  HANDS.tribal = function (P, K) { for (let i = 0; i < 4; i++) P.finger(i, 0.2, 100, function (c) { M.band(K, c, { h: 6 }); }); };
  HANDS.batok = function (P, K) { P.back(0.5, 0.78, 100, function (c) { M.batok(K, c, { n: 6 }); }); };
  HANDS.trad = function (P, K, side) {
    if (side === "R") P.back(0.5, 0.42, 34, function (c) { M.star(K, c, { color: "red" }); });
  };
  HANDS.fine = function (P, K, side, v) {
    if (side === "L") P.finger(v % 2 ? 0 : 2, 0.18, 40, function (c) { M.heart(K, c, { s: 0.7 }); });
  };

  // ---- painting a chart -----------------------------------------------------
  /* The ink pass. Motifs were drawn crisp onto a transparent layer; skin
     takes ink softly: the line spreads in the dermis (a wide faint halo and a
     tighter soft copy), saturation is uneven (a speckle eats a little of it),
     and years soften everything and move the colour. */
  let _noise = null;
  function noiseTile() {
    if (_noise) return _noise;
    const n = mkCanvas(64, 64);
    if (!n) return null;
    const x = n.getContext("2d"), r = rngOf("skin-noise");
    for (let i = 0; i < 900; i++) {
      x.fillStyle = "rgba(0,0,0," + (0.25 + r() * 0.75).toFixed(2) + ")";
      const s = 0.6 + r() * 1.4;
      x.fillRect(r() * 64, r() * 64, s, s);
    }
    return (_noise = n);
  }
  function inkPass(layer, K, scale) {
    const lc = layer.getContext("2d");
    const nt = noiseTile();
    if (nt) {
      lc.save();
      lc.globalCompositeOperation = "destination-out";
      lc.globalAlpha = 0.10 + 0.07 * K.age + (K.home ? 0.08 : 0);
      lc.fillStyle = lc.createPattern(nt, "repeat");
      lc.fillRect(0, 0, layer.width, layer.height);
      lc.restore();
    }
    const s = Math.max(0.5, scale);
    const halo = blurred(layer, (2.2 + 1.6 * K.age) * s);
    const soft = blurred(layer, (0.55 + 0.75 * K.age + (K.home ? 0.4 : 0)) * s);
    return { halo: halo, soft: soft, crisp: layer,
      a: [0.20 + 0.10 * K.age, 0.40 + 0.18 * K.age, 0.86 - 0.18 * K.age - (K.home ? 0.08 : 0)] };
  }

  function paint(kind, key, canvas) {
    const d = parseKey(key);
    const W = canvas.width, H = canvas.height;
    const wraps = kind === "arm" || kind === "fore";
    const pad = wraps ? Math.round(W * 0.25) : 6;
    const layer = mkCanvas(W + 2 * pad, H);
    if (!layer) return canvas;
    const lc = layer.getContext("2d");
    const K = pen({ age: d.age, home: d.home, seed: key, color: d.fam === "trad" || d.fam === "color" || d.fam === "sleeve", lw: LINE[d.fam] || 1 });
    // everything drawn in density-independent units: a stroke of 2 units is
    // the same share of the motif whatever the chart's size
    if (kind === "arm" || kind === "fore") {
      const P = armPainter(lc, W, H, pad, kind);
      const fn = ARM[d.fam];
      if (fn) fn(P, K, d.side, d.v);
    } else if (kind === "head") {
      const P = headPainter(lc, W, H, pad);
      const fn = HEAD[d.fam];
      if (fn) fn(P, K, d.v);
    } else if (kind === "hand" || kind === "fphand") {
      const P = handPainter(lc, W, H, pad);
      const fn = HANDS[d.fam];
      if (fn) fn(P, K, d.side, d.v);
    }
    // the ink spreads the same share of a stroke on every chart: the blur is
    // sized to the chart's density (a first-person chart is 2-3x a body one)
    const L = inkPass(layer, K, kind === "fore" || kind === "fphand" ? 2 : W / 384);
    const c = canvas.getContext("2d");
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, W, H);
    c.globalAlpha = L.a[0]; c.drawImage(L.halo, -pad, 0);
    c.globalAlpha = L.a[1]; c.drawImage(L.soft, -pad, 0);
    c.globalAlpha = L.a[2]; c.drawImage(L.crisp, -pad, 0);
    c.restore();
    return canvas;
  }

  /* ============================================================
     PEOPLE: who carries what. A profile is five chart keys (arms L/R,
     hands L/R, head), rolled once per rig and kept on it.
     ============================================================ */
  // does this composition put anything on this surface? (a dry run with a
  // painter that only counts, so nobody gets a texture of blank skin)
  function hasInk(kind, fam, side, v) {
    const T = kind === "arm" ? ARM : kind === "head" ? HEAD : HANDS;
    const fn = T[fam];
    if (!fn) return false;
    let n = 0;
    const count = function () { n++; };
    const P = { put: count, band: count, finger: count, back: count };
    try { if (kind === "head") fn(P, pen({ seed: "dry" }), v); else fn(P, pen({ seed: "dry" }), side, v); } catch (e) { return false; }
    return n > 0;
  }
  // families that are machine work (a tattooer's, not a cell's)
  const PRO_ONLY = { sleeve: 1, yant: 1, color: 1, trad: 1, tribal: 1, batok: 1, geo: 1 };
  // families whose hands carry anything, and how often
  const HAND_ODDS = { block: 0.85, blackwork: 0.7, vory: 0.75, chicano: 0.45, dots: 0.6, web: 0.35, tribal: 0.3, batok: 0.3, trad: 0.12, fine: 0.2 };
  // families whose head / neck carries anything, and how often
  const HEAD_ODDS = { teardrop: 1, chicano: 0.75, dots: 0.8, block: 0.7, script: 0.55, web: 0.8, blackwork: 0.9, vory: 0.6, tribal: 0.55, batok: 0.5, yant: 0.6, trad: 0.08, fine: 0.06 };
  function build(fam, r, o) {
    if (!fam) return null;
    const prison = !!o.prison;
    const v = Math.floor(r() * 4);
    const age = pickW(prison ? [[0, 2], [1, 4], [2, 4]] : [[0, 5], [1, 4], [2, 1]], r());
    const home = prison && !PRO_ONLY[fam] && r() < 0.45;
    const tail = ":" + v + ":" + age + (home ? ":h" : "");
    const prof = { fam: fam, v: v, age: age, home: home, arm: [null, null], hand: [null, null], head: null };
    ["L", "R"].forEach(function (side, i) {
      if (hasInk("arm", fam, side, v)) prof.arm[i] = "arm:" + fam + ":" + side + tail;
    });
    const hOdds = o.hands != null ? o.hands : (HAND_ODDS[fam] || 0);
    if (r() < hOdds) ["L", "R"].forEach(function (side, i) {
      if (hasInk("hand", fam, side, v)) prof.hand[i] = "hand:" + fam + ":" + side + tail;
    });
    const nOdds = o.head != null ? o.head : (HEAD_ODDS[fam] || 0);
    if (r() < nOdds && hasInk("head", fam, "R", v)) prof.head = "head:" + fam + ":R" + tail;
    if (!prof.arm[0] && !prof.arm[1] && !prof.hand[0] && !prof.hand[1] && !prof.head) return null;
    return prof;
  }
  function isPlayer(ch) { return !!ch && ch === CBZ.playerChar; }
  function seedOf(ch) {
    if (isPlayer(ch)) return "player";
    const g = ch.group || ch.model || null;
    if (g && g.id != null) return "rig:" + g.id;
    if (ch._inkSeed == null) ch._inkSeed = Math.floor(Math.random() * 1e9);
    return "rig:" + ch._inkSeed;
  }
  /* The street: sparser and cleaner. A quarter of grown men, fewer women,
     never a child; traditional colour, fine line, a word, an armband, now
     and then a full sleeve. The player always carries something (it is his
     own arm down the lens): a piece on the forearm, often the knuckles. */
  function rollCity(ch) {
    const P = ch.profile || {};
    if (P.child || (P.ageYears != null && P.ageYears < 18)) return null;
    const r = rngOf(seedOf(ch));
    if (isPlayer(ch)) {
      const fam = pick(["script", "chicano", "blackwork", "trad", "block"], r());
      return build(fam, r, { prison: false, hands: fam === "block" || fam === "blackwork" ? 1 : 0.5, head: 0 });
    }
    const fem = !!P.fem;
    if (r() >= (fem ? 0.14 : 0.24)) return null;
    const fam = pickW(fem
      ? [["fine", 5], ["trad", 2], ["color", 1], ["script", 1.2], ["armband", 0.3]]
      : [["trad", 3], ["fine", 2], ["armband", 1.5], ["script", 1.5], ["geo", 1], ["color", 0.8], ["sleeve", 0.4], ["chicano", 0.6], ["block", 0.4], ["blackwork", 0.4]], r());
    return build(fam, r, { prison: false });
  }
  function profile(ch) {
    if (!ch) return null;
    // a stand-in body (the portrait, the mugshot booth) wears its subject's ink
    if (ch._inkFrom) {
      const src = ch._inkFrom === "player" ? CBZ.playerChar : ch._inkFrom;
      return src && src !== ch && !src._inkFrom ? profile(src) : null;
    }
    const who = isPlayer(ch) ? "player" : "rig";
    if (ch._inkProfile !== undefined && ch._inkFor === who) return ch._inkProfile;
    const was = ch._inkFor;
    ch._inkFor = who;
    if (ch._inkFam != null) {
      ch._inkProfile = ch._inkFam ? build(ch._inkFam, rngOf(ch._inkSeed2 || seedOf(ch)), { prison: true }) : null;
      if (!ch._inkProfile && who === "player") ch._inkProfile = rollCity(ch);
    } else ch._inkProfile = rollCity(ch);
    // the rig became (or stopped being) the player after it was inked: its
    // body re-inks to match the arms the lens will show
    if (was && was !== who && ch.skinSlots) refresh(ch);
    return ch._inkProfile;
  }
  /* A family chosen by someone who knows the man (heritage.js: his car's
     ink culture). "" = clean skin. `seed` makes a named man look the same
     every boot. Refreshes whatever is already bare. */
  function assign(ch, fam, o) {
    if (!ch) return null;
    ch._inkFam = fam || "";
    ch._inkSeed2 = (o && o.seed) || null;
    ch._inkProfile = undefined;
    const p = profile(ch);
    refresh(ch);
    return p;
  }

  /* ============================================================
     TEXTURES AND MATERIALS
     ============================================================ */
  const THREE = root.THREE;
  const TEX = new Map(), FAILED = new Set();
  function chartTex(kind, key) {
    if (!THREE || !key) return null;
    const id = kind + "|" + key;
    let t = TEX.get(id);
    if (t && !t._cbzDead) return t;
    if (FAILED.has(id)) return null;
    const sz = SIZE[kind];
    const cv = sz && mkCanvas(sz[0], sz[1]);
    // no 2D canvas (a headless stub): no chart, and the skin stays plain
    if (!cv || !cv.getContext || !cv.getContext("2d")) { FAILED.add(id); return null; }
    /* Painted now (this runs in idle time), but the canvas is not kept: it
       goes back once the texture is uploaded or copied into a ped atlas page
       (core/texfree.js lazyCanvasTexture), and a later read paints it again. */
    if (CBZ.lazyCanvasTexture && !(CBZ.tattoo && CBZ.tattoo._mkCanvas)) {
      let ok = true;
      cv.width = 1; cv.height = 1;             // (only the capability probe)
      t = CBZ.lazyCanvasTexture(sz[0], sz[1], function (ctx, c) { try { paint(kind, key, c); } catch (e) { ok = false; } }, { eager: true });
      if (!ok) { FAILED.add(id); return null; }
    } else {
      try { paint(kind, key, cv); } catch (e) { FAILED.add(id); return null; }
      t = new THREE.CanvasTexture(cv);
    }
    t.magFilter = THREE.LinearFilter;
    t.name = "ink:" + id;
    t._shared = true;
    t.userData = { cbzInk: id };
    if (kind === "fore") {
      // fphands' forearm lathe runs u = angle / 2pi from +x; the chart runs
      // from the loft's front. Right forearm: the thumb side (-x) is the
      // chart's front; left: +x is. Repeat wrap carries the seam.
      t.wrapS = THREE.RepeatWrapping;
      t.offset.x = parseKey(key).side === "L" ? 0.125 : -0.375;
    }
    const dispose = t.dispose;
    t.dispose = function () { t._cbzDead = true; TEX.delete(id); return dispose.apply(this, arguments); };
    TEX.set(id, t);
    return t;
  }
  /* LAZY CHARTS. A chart is 10-40 ms of canvas work and a yard dressing its
     tank tops at once asks for dozens, so charts are QUEUED and painted in
     idle time (requestIdleCallback) or, where there is none, one per frame
     from the always-loop. A rig that asked for a chart that is not ready yet
     shows plain skin and waits; when a chart lands every waiting rig is
     refreshed. CBZ.tattoo.lazy = false paints on the spot (node checks). */
  const QUEUE = [], QSET = new Set(), WAIT = new Set();
  let pumpArmed = false, idleArmed = false;
  function lazy() { return CBZ.tattoo.lazy !== false && pumpArmed; }
  // -> the texture, null while it is queued, false when it can never paint
  function ready(kind, key) {
    if (!key) return null;
    const id = kind + "|" + key;
    const t = TEX.get(id);
    if (t && !t._cbzDead) return t;
    if (FAILED.has(id)) return false;
    if (!lazy()) return chartTex(kind, key) || false;
    if (!QSET.has(id)) { QSET.add(id); QUEUE.push([kind, key]); wake(); }
    return null;
  }
  const clock = function () { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); };
  function drain(budgetMs, deadline) {
    const t0 = clock();
    let n = 0;
    while (QUEUE.length) {
      const job = QUEUE.shift();
      QSET.delete(job[0] + "|" + job[1]);
      chartTex(job[0], job[1]);
      n++;
      if (deadline ? deadline.timeRemaining() < 8 : clock() - t0 >= budgetMs) break;
    }
    if (n && WAIT.size) {
      const list = Array.from(WAIT);
      WAIT.clear();
      for (let i = 0; i < list.length; i++) refresh(list[i]);
    }
  }
  function wake() {
    if (idleArmed || typeof root.requestIdleCallback !== "function") return;
    idleArmed = true;
    root.requestIdleCallback(function (dl) {
      idleArmed = false;
      drain(0, dl);
      if (QUEUE.length) wake();
    }, { timeout: 400 });
  }
  if (typeof CBZ.onAlways === "function" && typeof document !== "undefined") {
    pumpArmed = true;
    // the fallback pump: one chart a frame when the browser has no idle
    // callback (Safari), and a floor under it when idle never comes
    let lastIdle = 0;
    CBZ.onAlways(97.4, function () {
      if (!QUEUE.length) return;
      if (typeof root.requestIdleCallback === "function" && clock() - lastIdle < 250) return;
      lastIdle = clock();
      drain(1);
    });
  }

  const MATS = new Map();
  const MINE = new Set();
  function plainSkin(hex) {
    return CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex });
  }
  // one shared material per (skin tone x chart): cmat's own material for the
  // tone (Lambert, or its PBR twin on a PBR tier) with the chart as its map
  function inkMat(skin, tex) {
    const id = (skin | 0) + "|" + tex.userData.cbzInk;
    let m = MATS.get(id);
    if (m && m.map === tex) return m;
    m = plainSkin(skin).clone();
    m.map = tex;
    m.name = "ink-skin";
    m._shared = true;
    m.userData = { cbzInk: tex.userData.cbzInk, cbzInkSkin: skin | 0 };
    MATS.set(id, m);
    MINE.add(m);
    return m;
  }
  // an ink material: its map is a chart of ours (a shared arm/hand material,
  // a head's own material with its chart, a first-person twin)
  function isInk(m) { return !!(m && !Array.isArray(m) && m.map && m.map.userData && m.map.userData.cbzInk); }
  function skinOf(m) {
    if (!m || Array.isArray(m)) return null;
    if (m.userData && m.userData.cbzInkSkin != null) return m.userData.cbzInkSkin;
    return m.color ? m.color.getHex() : null;
  }

  // the rig's visible skin: the hands are the truth (a crowd promotion
  // repaints them with the imposter's tone), unless gloved
  function rigSkin(ch) {
    const s = ch.skinSlots;
    const h = s && s.hands && s.hands[0], m = h && h.material;
    if (m && !Array.isArray(m) && ch._gloved == null) {
      if (isInk(m)) return skinOf(m);
      if (!m.map && m.color) return m.color.getHex();
    }
    return ch.skinTone != null ? ch.skinTone : 0xcf9a72;
  }
  // -> 1 inked, 0 nothing to do, -1 the chart is still being painted
  function inkMesh(mesh, kind, key, skin) {
    let m = mesh.material;
    if (!m || Array.isArray(m)) return 0;
    if (isInk(m)) {
      if (!MINE.has(m)) return 0;                      // a clone someone else owns (a corpse tint)
      const want = key ? kind + "|" + key : null;
      if (want && m.userData.cbzInk === want && m.userData.cbzInkSkin === skin) return 1;
      mesh.material = m = plainSkin(m.userData.cbzInkSkin);
    }
    // a flat skin segment only: a painted garment (its own map) and a sleeve
    // (not this skin tone) are cloth
    if (!key || m.map || !m.color || m.color.getHex() !== skin) return 0;
    const t = ready(kind, key);
    if (t === false) return 0;
    if (!t) return -1;
    mesh.material = inkMat(skin, t);
    return 1;
  }
  function inkHead(head, key) {
    const m = head.material;
    if (!m || Array.isArray(m)) return 0;
    const cur = m.map;
    if (cur && !(cur.userData && cur.userData.cbzInk)) return 0;   // somebody else's map
    let want = key ? ready("head", key) : null;
    if (want === false) want = null;
    else if (key && !want) return -1;
    if (cur === want) return 0;
    m.map = want;
    m.needsUpdate = true;
    return 1;
  }
  /* Ink whatever of this rig's skin is bare right now, and take it off what
     is not skin any more. Idempotent and cheap on a second call. A chart
     still in the queue leaves that part plain until it lands. */
  function refresh(ch) {
    if (!ch || !ch.skinSlots || !THREE) return false;
    const prof = profile(ch);
    const s = ch.skinSlots, skin = rigSkin(ch);
    let wait = false;
    for (let i = 0; i < 2; i++) {
      const key = prof ? prof.arm[i] : null;
      const up = s.arms && s.arms[i], lo = s.armsLower && s.armsLower[i];
      if (up && inkMesh(up, "arm", key, skin) < 0) wait = true;
      if (lo && inkMesh(lo, "arm", key, skin) < 0) wait = true;
    }
    const hands = s.hands || [];
    for (let i = 0; i < hands.length; i++) {
      const h = hands[i];
      if (!h) continue;
      const k = prof ? prof.hand[h.userData && h.userData.side < 0 ? 0 : 1] : null;
      if (inkMesh(h, "hand", k, skin) < 0) wait = true;
    }
    const head = s.head && s.head[0];
    if (head && inkHead(head, prof ? prof.head : null) < 0) wait = true;
    if (wait) WAIT.add(ch);
    return !!prof;
  }

  /* ---- FIRST PERSON (fphands.js calls this from onBeforeRender) ----------
     The caller owns the viewmodel's material and recolours it every frame
     (dressOf). We keep it as the BASE and, while the skin under it is bare,
     draw a twin of it that carries the player's chart at first-person
     density, copying colour and the viewmodel's render flags each frame. A
     material swap made here lands on the next frame. */
  const FPM = new Map();
  function near(a, b) {
    const dr = ((a >> 16) & 255) - ((b >> 16) & 255), dg = ((a >> 8) & 255) - ((b >> 8) & 255), db = (a & 255) - (b & 255);
    return dr * dr + dg * dg + db * db < 300;
  }
  function fpSync(mesh, kind) {
    const cur = mesh.material;
    if (!cur || Array.isArray(cur)) return;
    let base = mesh.userData.inkBase;
    if (!base || (cur !== base && !(cur.userData && cur.userData.cbzFp))) base = mesh.userData.inkBase = cur;
    const ch = CBZ.playerChar;
    let key = null;
    if (ch && ch.skinSlots && base.color && !base.map) {                // (a textured viewmodel material is someone else's look)
      const prof = profile(ch);
      if (prof) {
        const arm = kind === "fore" ? mesh.parent : null;
        const side = kind === "hand" ? mesh.userData.side : (arm && arm.userData ? arm.userData.side : 1);
        const i = side < 0 ? 0 : 1;
        const sleeved = !!(arm && arm.userData && arm.userData.sleeved);
        const k = kind === "hand" ? prof.hand[i] : prof.arm[i];
        if (k && !sleeved && near(base.color.getHex(), rigSkin(ch))) key = k;
      }
    }
    const tex = key ? ready(kind === "hand" ? "fphand" : "fore", key) : null;
    if (!tex) { if (mesh.material !== base) mesh.material = base; return; }
    const id = base.uuid + "|" + tex.userData.cbzInk;
    let m = FPM.get(id);
    if (!m || m.map !== tex) {
      m = base.clone();
      m.map = tex;
      m.userData = { cbzFp: true, cbzInk: tex.userData.cbzInk };
      FPM.set(id, m);
    }
    m.color.copy(base.color);
    if (m.transparent !== base.transparent || m.depthTest !== base.depthTest || m.depthWrite !== base.depthWrite || m.side !== base.side) {
      m.transparent = base.transparent; m.depthTest = base.depthTest; m.depthWrite = base.depthWrite; m.side = base.side;
      m.needsUpdate = true;
    }
    m.opacity = base.opacity;
    m.visible = base.visible;
    if (mesh.material !== m) mesh.material = m;
  }

  // a short signature of what a rig wears (caches keyed on a look use it)
  function sigOf(ch) {
    const p = profile(ch);
    return p ? [p.arm[0], p.arm[1], p.hand[0], p.hand[1], p.head].map(function (k) { return k || "-"; }).join(",") : "";
  }
  function census(list) {
    const rows = list || [].concat((CBZ.npcs || []).map(function (n) { return n && n.char; }), (CBZ.cityPeds || []).map(function (p) { return p && (p.char || p.rig); }));
    const out = { rigs: 0, inked: 0, byFam: {}, charts: TEX.size, materials: MATS.size };
    for (let i = 0; i < rows.length; i++) {
      const ch = rows[i];
      if (!ch || !ch.skinSlots) continue;
      out.rigs++;
      const p = ch._inkProfile;
      if (p) { out.inked++; out.byFam[p.fam] = (out.byFam[p.fam] || 0) + 1; }
    }
    return out;
  }

  CBZ.tattoo = Object.assign(CBZ.tattoo || {}, {
    version: 1,
    ARM_SPLIT: ARM_SPLIT, SIZE: SIZE, HAND: HAND, HEAD_COLS: HEAD_COLS,
    paint: paint, parseKey: parseKey, rngOf: rngOf,
    refresh: refresh, profile: profile, assign: assign, build: build, hasInk: hasInk,
    isInk: isInk, skinOf: skinOf, rigSkin: rigSkin, fpSync: fpSync, chartTex: chartTex, census: census, sigOf: sigOf,
    _M: M, _ARM: ARM, _HEAD: HEAD, _HANDS: HANDS, _drain: drain, _queued: function () { return QUEUE.length; },
  });
})();
