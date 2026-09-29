/* ============================================================
   systems/touch_layout.js — WHERE A FLOATING BUTTON MAY GO.

   Pure rectangle math, no DOM and no THREE, so the page and plain node run
   the same code (tools/verb-cluster-layout-check.mjs proves it on iPad and
   phone sizes). Two callers:

     CBZ.touchLayout.verbColumn(o)   the verbs you get when you tap a person
                                     (city/verbwheel.js). OWNER 2026-09-29:
                                     "look how stupid the buttons look when
                                     you press someone": eight pills on a
                                     circle overlapped each other and sat on
                                     the man's face. Now: one tidy column of
                                     real, measured pills BESIDE him, never
                                     over his head or body, never off screen,
                                     never on another control.
     CBZ.touchLayout.exitSlot(o)     the one way out of a seat (systems/
                                     seat_exit.js #tExit). OWNER: "the button
                                     to get out of chairs or to exit cars is
                                     really high on the screen and weirdly
                                     placed". It now stands on top of the
                                     right-thumb cluster (or beside it when a
                                     short screen has no room above), measured
                                     against whatever cluster is live.

   A rect is { x, y, w, h } in CSS px, y down.
============================================================ */
(function (root) {
  "use strict";

  function overlaps(a, b, pad) {
    pad = pad || 0;
    return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
  }
  function inside(r, W, H, m) {
    return r.x >= m.left - 0.5 && r.y >= m.top - 0.5 && r.x + r.w <= W - m.right + 0.5 && r.y + r.h <= H - m.bottom + 0.5;
  }
  function margins(m) {
    m = m || {};
    return { top: m.top != null ? m.top : 12, right: m.right != null ? m.right : 12, bottom: m.bottom != null ? m.bottom : 12, left: m.left != null ? m.left : 12 };
  }
  function clamp(v, lo, hi) { return hi < lo ? lo : Math.max(lo, Math.min(hi, v)); }
  function hits(r, avoid, pad) {
    let n = 0;
    for (let i = 0; i < avoid.length; i++) if (avoid[i] && overlaps(r, avoid[i], pad)) n++;
    return n;
  }

  /* ---- THE VERB COLUMN ------------------------------------------------------
     o.W, o.H        viewport
     o.sizes         [{w,h}] in reading order: the likely verb first, "More" last
     o.body          the person's rect on screen (head to hips); nothing covers it
     o.anchor        {x,y} the point the column is beside (his chest)
     o.avoid         [rect] other controls on the glass (stick, buttons, radar)
     o.gap           px between pills (8)
     o.margin        screen margins (safe areas included by the caller)
     o.prefer        "right" | "left": the side it was on last frame (no flip-flop)
   -> { side, rects:[{x,y,w,h}], cols, score }
     Pills stack top-down in one column; a column taller than the screen
     wraps into a second column further out. The column is centred on the
     anchor's height and slid (never shrunk) to stay on screen and off other
     controls. Places are tried in order (the preferred side, the other side,
     under him, over him, each sliding away from its natural spot) and the
     first that is on screen, clear of his body and clear of every control
     wins. If none is clean the cheapest does, and the costs are ordered:
     off screen > on his face > on another control > on his legs. */
  function verbColumn(o) {
    // one column; if that cannot be placed clean (a tall list on a small
    // phone), the same pills in two, then three, shorter columns
    const n = (o.sizes || []).length;
    let best = null;
    const splits = [Infinity, Math.ceil(n / 2), Math.ceil(n / 3)];
    for (let k = 0; k < splits.length; k++) {
      if (k && splits[k] >= splits[k - 1]) continue;
      const r = solveColumn(o, splits[k]);
      if (r && r.score === 0) return r;
      if (r && (!best || r.score < best.score)) best = r;
    }
    return best;
  }
  function solveColumn(o, perCol) {
    const W = o.W, H = o.H, gap = o.gap != null ? o.gap : 8, m = margins(o.margin);
    const sizes = o.sizes || [];
    const avoid = o.avoid || [];
    const body = o.body || { x: o.anchor.x - 20, y: o.anchor.y - 40, w: 40, h: 80 };
    const ax = o.anchor ? o.anchor.x : body.x + body.w / 2;
    const ay = o.anchor ? o.anchor.y : body.y + body.h / 2;
    const clear = o.clear != null ? o.clear : 14;      // air between his body and the column
    const availH = H - m.top - m.bottom;

    // split into columns that each fit the screen height (and perCol pills)
    const cols = [];
    let cur = [], curH = 0;
    for (let i = 0; i < sizes.length; i++) {
      const h = sizes[i].h;
      const add = cur.length ? gap + h : h;
      if (cur.length && (curH + add > availH || cur.length >= perCol)) { cols.push(cur); cur = []; curH = 0; }
      cur.push(i); curH += cur.length > 1 ? gap + h : h;
    }
    if (cur.length) cols.push(cur);
    const colW = cols.map(function (c) { let w = 0; for (const i of c) w = Math.max(w, sizes[i].w); return w; });
    const colH = cols.map(function (c) { let h = 0; for (let k = 0; k < c.length; k++) h += sizes[c[k]].h + (k ? gap : 0); return h; });
    const blockW = colW.reduce(function (a, b) { return a + b; }, 0) + gap * (cols.length - 1);
    const blockH = Math.max.apply(null, colH.concat([0]));

    function build(x0, y0, outward) {
      // outward: +1 columns grow to the right, -1 to the left
      const rects = new Array(sizes.length);
      let cx = outward > 0 ? x0 : x0 + blockW;
      for (let c = 0; c < cols.length; c++) {
        const w = colW[c];
        const left = outward > 0 ? cx : cx - w;
        let y = y0;
        for (const i of cols[c]) {
          const s = sizes[i];
          // pills hug the person's side: left-aligned on his right, right-aligned on his left
          const x = outward > 0 ? left : left + w - s.w;
          rects[i] = { x: x, y: y, w: s.w, h: s.h };
          y += s.h + gap;
        }
        cx = outward > 0 ? cx + w + gap : cx - w - gap;
      }
      return rects;
    }
    const yLo = m.top, yHi = H - m.bottom - blockH;
    const xLo = m.left, xHi = W - m.right - blockW;
    const yMid = clamp(ay - blockH / 2, yLo, yHi);
    // his face is the top third of his body: nothing ever covers it. The rest
    // of him is avoided too, but a phone held upright with a man filling it
    // has no clean side; then the pills may cross his legs, never his head.
    const face = { x: body.x, y: body.y, w: body.w, h: Math.max(20, body.h * 0.34) };
    function score(rects) {
      let sc = 0;
      for (const r of rects) {
        if (!inside(r, W, H, m)) sc += 1000;
        if (overlaps(r, face, 2)) sc += 500;
        if (overlaps(r, body, 2)) sc += 20;
        sc += hits(r, avoid, 4) * 40;
      }
      return sc;
    }
    // y (or x) positions to try: the natural one first, then sliding away from it
    function slides(v0, lo, hi) {
      const out = [clamp(v0, lo, hi)];
      for (let d = 24; d <= Math.max(hi - lo, 0) + 24; d += 24) {
        if (v0 - d >= lo - 23) out.push(clamp(v0 - d, lo, hi));
        if (v0 + d <= hi + 23) out.push(clamp(v0 + d, lo, hi));
      }
      return out;
    }
    const tries = [];
    const sideRight = function () {
      const x0 = clamp(body.x + body.w + clear, xLo, xHi);
      for (const y of slides(yMid, yLo, yHi)) tries.push({ side: "right", rects: build(x0, y, 1) });
    };
    const sideLeft = function () {
      const x0 = clamp(body.x - clear - blockW, xLo, xHi);
      for (const y of slides(yMid, yLo, yHi)) tries.push({ side: "left", rects: build(x0, y, -1) });
    };
    const under = function () {
      const y0 = clamp(body.y + body.h + clear, yLo, yHi);
      for (const x of slides(ax - blockW / 2, xLo, xHi)) tries.push({ side: "below", rects: build(x, y0, 1) });
    };
    const over = function () {
      const y0 = clamp(body.y - clear - blockH, yLo, yHi);
      for (const x of slides(ax - blockW / 2, xLo, xHi)) tries.push({ side: "above", rects: build(x, y0, 1) });
    };
    // across his chest, under the face: the last resort before his face
    const chest = function () {
      const y0 = clamp(face.y + face.h + clear, yLo, yHi);
      for (const x of slides(ax - blockW / 2, xLo, xHi)) tries.push({ side: "chest", rects: build(x, y0, 1) });
    };
    if (o.prefer === "left") { sideLeft(); sideRight(); } else { sideRight(); sideLeft(); }
    under(); over(); chest();
    let best = null;
    for (let k = 0; k < tries.length; k++) {
      const c = tries[k];
      c.score = score(c.rects);
      c.cols = cols.length;
      if (c.score === 0) return c;
      if (!best || c.score < best.score) best = c;
    }
    return best;
  }

  /* ---- THE WAY OUT ------------------------------------------------------------
     o.W, o.H        viewport
     o.size          {w,h} of the exit button
     o.cluster       [rect] the live right-thumb controls (buttons, pedals, dial)
     o.avoid         [rect] everything else it must not sit on (stick, hotbar,
                     radar, pause, money)
     o.gap           px between it and the cluster (12)
     o.margin        screen margins (safe areas included by the caller)
   -> { x, y, w, h, where, score }
     1. on top of the right-edge column, right-aligned with it: where the
        thumb already is, the way every console game stacks its buttons
        (only while that is below the top 30% of the screen)
     2. beside the cluster at thumb height, just left of it
     3. anywhere down the left edge of the cluster
     With no cluster at all it sits in the bottom-right corner itself. */
  function exitSlot(o) {
    const W = o.W, H = o.H, gap = o.gap != null ? o.gap : 12, m = margins(o.margin);
    const w = o.size.w, h = o.size.h;
    const cl = (o.cluster || []).filter(function (r) { return r && r.w > 0 && r.h > 0; });
    const all = cl.concat((o.avoid || []).filter(Boolean));
    const cands = [];
    if (!cl.length) {
      cands.push({ x: W - m.right - w, y: H - m.bottom - h, where: "corner" });
    } else {
      let R = -1e9, L = 1e9, B = -1e9;
      for (const r of cl) { R = Math.max(R, r.x + r.w); L = Math.min(L, r.x); B = Math.max(B, r.y + r.h); }
      // the right-edge column: controls whose right side is near the cluster's
      let colTop = 1e9;
      for (const r of cl) if (r.x + r.w >= R - 40) colTop = Math.min(colTop, r.y);
      // not up in the top of the screen: that is where it was, and it was wrong
      if (colTop - gap - h >= H * 0.3) cands.push({ x: R - w, y: colTop - gap - h, where: "above" });
      // left of the cluster: at the thumb (bottom), then stepping up its side
      for (let y = B - h; y >= m.top; y -= h + gap) {
        let left = 1e9;
        for (const r of cl) if (r.y < y + h + gap && r.y + r.h > y - gap) left = Math.min(left, r.x);
        if (left > 1e8) left = L;
        cands.push({ x: left - gap - w, y: y, where: "beside" });
      }
    }
    let best = null;
    for (const c of cands) {
      const r = { x: c.x, y: c.y, w: w, h: h };
      let score = inside(r, W, H, m) ? 0 : 100;
      score += hits(r, all, 6);
      const out = { x: Math.round(c.x), y: Math.round(c.y), w: w, h: h, where: c.where, score: score };
      if (score === 0) return out;
      if (!best || score < best.score) best = out;
    }
    return best;
  }

  const api = { verbColumn: verbColumn, exitSlot: exitSlot, overlaps: overlaps, inside: inside };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) {
    const CBZ = root.CBZ || (root.CBZ = {});
    CBZ.touchLayout = api;
  }
})(typeof window !== "undefined" ? window : null);
