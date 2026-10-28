/* ============================================================
   president/mapdraw.js — THE MAP, PAINTED: WHO HOLDS WHAT, WHERE THEY ARE
   FIGHTING, AND HOW FAR YOUR COLOUR HAS SPREAD.

   OWNER (2026-10-28): "it is possible to conquer everyone and map shows your
   country growing".

   One painter for every map in the game: the world page of the briefing
   book (president/papers.js), the full-screen map on a phone
   (city/president_dock.js) and the lobby's preview (president/game.js). A
   tile is one pixel; the caller scales it up, crisp.
     a country       its colour, over every tile it holds
     your country    your colour, brighter, ringed in gold where your realm
                     ends; your puppets in your colour, paler
     occupied land   the holder's colour, flecked with the owner's
     a front         red where two countries at war meet; a city being taken
                     striped in the attacker's colour as the fight goes on
     cities          a faint line between the provinces of one country
     not in play     grey land; the sea
   Canvas only (no THREE, no DOM beyond the canvases it makes).

   PUBLIC  CBZ.presMap = { image(S, me, o) -> {cv, x, y, w, h}, frame(S, full),
     tileAt(S, fx, fy, fr) -> tile index, pick(S, fx, fy, fr) -> country id|null,
     labels(S, me, fr) -> [{x, y, name, cid, size}] }
     o: { sel, full (the whole world, not the scenario's frame), theme ("paper" | "night") }
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};
  function W() { return CBZ.presWorld; }

  const THEMES = {
    paper: { sea: [196, 211, 214], grey: [214, 208, 192], line: 0.72, prov: 0.94 },
    night: { sea: [20, 38, 60], grey: [62, 66, 74], line: 0.6, prov: 0.9 },
  };
  const GOLD = [242, 201, 76], RED = [214, 52, 44];
  function rgb(h) { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  // your colour, a little louder than anyone else's
  function loud(c) { const m = (c[0] + c[1] + c[2]) / 3; return [Math.min(255, m + (c[0] - m) * 1.35 + 18), Math.min(255, m + (c[1] - m) * 1.35 + 18), Math.min(255, m + (c[2] - m) * 1.35 + 18)]; }

  // what the map shows: the scenario's frame, or the whole world
  function frame(S, full) {
    const M = W().geo(S);
    return full ? { x: 0, y: 0, w: M.W, h: M.H } : M.frame;
  }
  function tileAt(S, fx, fy, fr) {
    const M = W().geo(S);
    const x = Math.floor(fr.x + fx * fr.w), y = Math.floor(fr.y + fy * fr.h);
    if (y < 0 || y >= M.H) return -1;
    return y * M.W + (((x % M.W) + M.W) % M.W);
  }
  // the country under a point of the map (0..1 across the frame), with a little forgiveness round small ones
  function pick(S, fx, fy, fr) {
    const M = W().geo(S);
    const t = tileAt(S, fx, fy, fr);
    if (t < 0) return null;
    const tx = t % M.W, ty = (t / M.W) | 0;
    for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const Y = ty + dy; if (Y < 0 || Y >= M.H) continue;
      const pv = M.cell[Y * M.W + ((tx + dx + M.W) % M.W)];
      if (pv >= 0) return S.p[pv].ctl;
    }
    return null;
  }

  let cache = null;
  function image(S, me, o) {
    o = o || {};
    const PW = W(), M = PW.geo(S), fr = frame(S, o.full), th = THEMES[o.theme] || THEMES.paper;
    let front = 0;
    for (const p of S.p) if (p.prog > 0) front += Math.floor(p.prog / 8) + p.id;
    let wars = 0;
    for (const c of S.c) for (const e of c.war) wars = (wars * 31 + c.id * 977 + e) % 1000000007;
    const key = [S.scen, S.tv, S.day >> 2, front, wars, me, o.sel, o.full ? 1 : 0, o.theme, S.c.map(function (c) { return c.lord; }).join(",")].join("|");
    if (cache && cache.key === key) return cache.out;
    const Wd = M.W, fw = fr.w, fh = fr.h;
    const cv = (cache && cache.out.cv) || (typeof document !== "undefined" ? document.createElement("canvas") : null);
    if (!cv) return null;
    cv.width = fw; cv.height = fh;
    const ctx = cv.getContext("2d"), id = ctx.createImageData(fw, fh), D = id.data;
    const col = S.c.map(function (c) { return rgb(c.color); });
    const mine = function (cid) { return cid === me || (cid >= 0 && S.c[cid].lord === me && me >= 0); };
    // the colour each controller is painted in: a puppet in its master's, paler
    const paint = S.c.map(function (c, k) {
      if (k === me) return loud(col[k]);
      if (c.lord >= 0) { const L = c.lord === me ? loud(col[c.lord]) : col[c.lord]; return mix(L, [255, 255, 255], 0.32); }
      return col[k];
    });
    const atWar = function (a, b) { return a >= 0 && b >= 0 && a !== b && S.c[a].war.indexOf(b) >= 0; };
    const ctlOf = function (t) { const pv = M.cell[t]; return pv >= 0 ? S.p[pv].ctl : -2 - M.land[t]; };
    for (let py = 0; py < fh; py++) {
      const y = fr.y + py;
      for (let px = 0; px < fw; px++) {
        const x = (((fr.x + px) % Wd) + Wd) % Wd, i = y * Wd + x, o4 = (py * fw + px) * 4;
        const pv = M.cell[i], e = M.land[i];
        let c;
        if (pv < 0) c = e < 0 ? th.sea : th.grey;
        else {
          const p = S.p[pv], k = p.ctl;
          c = paint[k];
          // occupied: the holder's colour, flecked with the owner's
          if (p.owner !== k && ((x + y) % 3 === 0)) c = paint[p.owner];
          // being taken: the attacker's stripes thicken as the fight goes on
          if (p.prog > 0 && p.by >= 0 && ((x - y + 64) % 4 === 0) && p.prog > 12) c = mix(c, paint[p.by], Math.min(1, p.prog / 50));
          if (o.sel != null && k === o.sel) c = mix(c, [255, 255, 255], 0.28);
        }
        let k2 = 1, edge = null;
        if (pv >= 0) {
          const a = S.p[pv].ctl;
          const nb = [x < Wd - 1 ? i + 1 : i - Wd + 1, x > 0 ? i - 1 : i + Wd - 1, y < M.H - 1 ? i + Wd : -1, y > 0 ? i - Wd : -1];
          for (const t of nb) {
            if (t < 0) continue;
            const b = ctlOf(t);
            if (b === a) { if (M.cell[t] >= 0 && M.cell[t] !== pv && k2 > th.prov) k2 = th.prov; continue; }
            if (atWar(a, b)) { edge = RED; break; }
            if (me >= 0 && mine(a) && !mine(b)) edge = GOLD;
            else if (!edge) k2 = Math.min(k2, th.line);
          }
        } else if (e >= 0) {
          const nb = [x < Wd - 1 ? i + 1 : i - Wd + 1, y < M.H - 1 ? i + Wd : -1];
          for (const t of nb) if (t >= 0 && ctlOf(t) !== ctlOf(i)) { k2 = th.line; break; }
        }
        if (edge) c = edge;
        D[o4] = c[0] * k2; D[o4 + 1] = c[1] * k2; D[o4 + 2] = c[2] * k2; D[o4 + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    const out = { cv: cv, x: fr.x, y: fr.y, w: fw, h: fh, frame: fr };
    cache = { key: key, out: out };
    return out;
  }

  // where to write each country's name: its capital, biggest first
  function labels(S, me, fr) {
    const PW = W(), M = PW.geo(S), I = PW.idx(S), out = [];
    S.c.forEach(function (c) {
      if (!c.alive || c.cap < 0) return;
      let tiles = 0;
      for (const k of I.ctl[c.id]) tiles += M.provs[k].n;
      const g = M.provs[c.cap];
      let dx = g.lx - fr.x; dx = ((dx % M.W) + M.W) % M.W;
      const fx = (dx + 0.5) / fr.w, fy = (g.ly - fr.y + 0.5) / fr.h;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
      out.push({ x: fx, y: fy, name: c.short, cid: c.id, size: tiles, me: c.id === me });
    });
    return out.sort(function (a, b) { return (b.me ? 1e9 : 0) + b.size - (a.me ? 1e9 : 0) - a.size; });
  }

  CBZ.presMap = { image: image, frame: frame, tileAt: tileAt, pick: pick, labels: labels };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.presMap;
})(typeof globalThis !== "undefined" ? globalThis : this);
