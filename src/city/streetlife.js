/* ============================================================
   city/streetlife.js — THE PEOPLE ON THE PAVEMENT.

   OWNER (iPad, 2026-10-09): "In a big city there are not enough people
   around me. It's too sparse and unrealistic. And everybody's alone, which
   is also unrealistic. Do what you have to do."

   WHAT THIS REPLACED. city/crowd.js was the ambient street: 48 analytical
   rows, every one of them a pooled full rig, strolling between random
   sidewalk points (a 48-person city), ~35% loosely "grouped" by copying a
   leader's waypoint. It is deleted. Its rows now live in the one crowd store
   (entities/crowdstore.js) and draw through entities/crowdgpu.js: the real
   CBZ.human, GPU-instanced, with its LOD chain. Only the nearest few become
   full rigs with the peds.js brain (promotion, below). One street system.

   1. WHERE PEOPLE ARE: the density rule. Every footway in a city is a side
      of a BLOCK RING (the pavement round a downtown lot, the pavement round a
      metro block, city/metroplan.js blocks with their own footway width).
      Each side carries people per metre:
         base(land use) x (0.3 + 0.7 x zoning intensity) x hour(land use mix)
      base: core 0.30, commercial 0.22, projects 0.09, residential 0.07,
      industrial 0.04 (a mall 0.20, a campus 0.12). The zoning field
      (city/zoning.js intensityAt, or a metro block's land value) is the
      urban gradient. The LAND USE MIX (office / shop / home / night / leisure)
      comes from the district, the shop in the lot (a bar, a casino, a diner),
      the office towers (world.js officeLot) and the parks a block faces, and
      each use has its own day: offices peak at 8, at lunch and at 5; shops
      10-19; homes morning and evening; night spots 20-02. So downtown at
      noon is packed, a residential street is quiet, and after midnight the
      city is thin except where the bars are. Bus stops add the waiting.
      The street population is the integral of that field over the streamed
      ring round the player (distance falloff past 45% of the radius),
      clipped to the device budget.

   2. WHO THEY ARE: groups. Real streets are pairs and small groups. A group
      has an id, a LEADER (its first living member), FORMATION SLOTS (lateral
      + forward offsets: a couple shoulder to shoulder at 0.84 m, a family
      with the kids out in front, three abreast or two and one behind on a
      narrow pavement, a 2x2 of coworkers) and ONE SHARED GOAL (a door, a
      food place, a bus stop, a bench, a far street). Kinds: solo, couple,
      friends, family (two adults and their kids, the kids real child rigs
      when promoted), coworkers in suits (office districts, lunch), teens
      (afternoons), and the standing ones: a chat circle outside a shop, a
      queue along the wall of a food place, smokers outside an office (bars
      at night), people at a bus stop, people on a bench, someone browsing a
      window. About 40% of people walk alone; the rest are in groups of 2-5.
      Members keep formation, close up into single file round a lamp post,
      a tree pit or an oncoming group and open out again after, and the group
      slows and stops for whoever falls behind. At a crossing the group waits
      together at the kerb and crosses together.

   3. HOW THEY MOVE: flow. The walk network is the block rings plus the
      CROSSINGS between ring corners across a street (built once per city
      from plan data: no meshes, works on a streamed slice). Lanes keep
      right: a group hugs the right of its direction of travel, so opposite
      flows pass on opposite sides. Routes follow FLOW FIELDS: one Dijkstra
      field per destination node (420 m reach, crossings cost extra, kept in
      a small LRU per city), shared by every group going there, so walkers go
      round a river or a cut block exactly. Avoidance is cheap: every edge
      keeps a list of the groups on it (a 1-D spatial hash), so a group only
      ever looks at the few people on its own pavement; static obstacles are
      pre-binned per edge as lateral bands and the group takes the free lane
      (abreast if it fits, single file through the gap if not).
      Crossings follow the signal clock traffic.js already syncs
      (CBZ.cityPhase): walk only while the crossed traffic is red, start only
      in the first seconds of the walk phase; drivers brake for anyone still
      in the road (CBZ.crowds.ahead, read by vehicles.js). Near groups
      update every frame, mid every 0.1 s, far every 0.3 s; the GPU walks
      every body on its own velocity between updates.

   4. THE NEAREST FEW ARE REAL. Promotion: the nearest living rows (not the
      seated) inside the promote radius become pooled full rigs (prewarmed,
      half men, half women, plus a few real child rigs), painted with the
      row's exact look and walked to the row's formation slot through the
      move-order seam; past the release radius (+10 m hysteresis) they hand
      back. A whole group is promoted together. A promoted rig keeps its
      group: it carries the group as a CLIQUE (cliqueId/friends), so the
      shared brain (city/brain_city.js retaliate) decides who of the friends
      fights you, who shoves, who backs off; the rest gather round the one on
      the floor (one on the phone) or run if you are armed or he is dead.

   5. BUDGET (rows in the street group / full rigs / stream radius):
        desktop 1600 / 40 / 240 m,  tablet 700 / 32 / 170 m,  phone 260 / 14 / 120 m
      (CONFIG.STREET_ROWS, STREET_RIGS, STREET_RADIUS, STREET_DENSITY
      override). Instancing only: the whole street is one crowdgpu layer
      (2 bodies x 2 mesh LODs + 1 impostor = 5 draw calls).

   DAMAGE is the store's: a bomb, a round, a car, a collapse hits a row
   through CBZ.crowds; the dead are counted for the news there. A child row
   is protected (the store's prot flag): it runs, it is never hurt.

   PUBLIC  CBZ.streetLife = { reset(), audit(), budget(), inspect(),
     sites(), _step(dt) (tests) }
============================================================ */
(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const CBZ = W.CBZ;
  if (!CBZ || CBZ.streetLife || !CBZ.crowds) return;
  const ST = CBZ.crowds, S = ST.S;
  const CFG = CBZ.CONFIG || (CBZ.CONFIG = {});
  const TAU = Math.PI * 2;
  const DEVICE = CBZ.deviceClass || "desktop";

  // ================================================================ budget
  const BUDGETS = {
    desktop: { rows: 1600, rigs: 40, kids: 6, radius: 240, promoIn: 24 },
    tablet: { rows: 700, rigs: 32, kids: 4, radius: 170, promoIn: 21 },
    phone: { rows: 260, rigs: 14, kids: 2, radius: 120, promoIn: 16 },
  };
  const BUD = Object.assign({}, BUDGETS[DEVICE] || BUDGETS.desktop);
  if (CFG.STREET_ROWS > 0) BUD.rows = CFG.STREET_ROWS | 0;
  if (CFG.STREET_RIGS >= 0 && CFG.STREET_RIGS != null) BUD.rigs = CFG.STREET_RIGS | 0;
  if (CFG.STREET_RADIUS > 0) BUD.radius = +CFG.STREET_RADIUS;
  BUD.rows = Math.min(BUD.rows, Math.floor(ST.cap() * 0.4));
  BUD.promoOut = BUD.promoIn + 10;
  const R = BUD.radius, R2 = R * R;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  let SEED = 0x51eec5;
  function rnd() { SEED = (Math.imul(SEED, 1664525) + 1013904223) >>> 0; return SEED / 4294967296; }
  function pick(L) { return L[(rnd() * L.length) | 0]; }
  function G_() { return CBZ.game || (CBZ.game = {}); }
  function arena() { return CBZ.city && CBZ.city.arena; }
  function playerPos() { const P = CBZ.player; return P && P.pos ? P.pos : null; }
  function hourNow() {
    if (CBZ.cityHour) { try { const h = +CBZ.cityHour(); if (isFinite(h)) return h; } catch (e) {} }
    if (CBZ.citySunHour) { try { const h = +CBZ.citySunHour(); if (isFinite(h)) return h; } catch (e) {} }
    return 12;
  }

  // ================================================================ land use and the day
  // mix: o office, s shop, h home, n night, l leisure. base = people per metre
  // of footway at the use's busiest hour, at full urban intensity.
  const USE = {
    core: { o: 0.45, s: 0.35, h: 0.10, n: 0.35, l: 0.10, base: 0.30 },
    commercial: { o: 0.30, s: 0.50, h: 0.15, n: 0.15, l: 0.10, base: 0.22 },
    residential: { o: 0.03, s: 0.10, h: 0.85, n: 0.04, l: 0.25, base: 0.07 },
    projects: { o: 0.03, s: 0.10, h: 0.80, n: 0.12, l: 0.10, base: 0.09 },
    industrial: { o: 0.70, s: 0.05, h: 0.05, n: 0.02, l: 0.00, base: 0.04 },
    mall: { o: 0.10, s: 0.90, h: 0.00, n: 0.05, l: 0.20, base: 0.20 },
    campus: { o: 0.40, s: 0.10, h: 0.20, n: 0.05, l: 0.50, base: 0.12 },
  };
  const METRO_USE = { cbd: "core", midtown: "commercial", industrial: "industrial", mall: "mall", campus: "campus" };
  // each use's day (0..23 h, linear between)
  const CURVE = {
    o: [.03, .02, .02, .02, .03, .06, .18, .55, 1.0, .8, .55, .65, 1.25, 1.1, .6, .55, .7, 1.1, .75, .4, .25, .15, .08, .05],
    s: [.03, .02, .02, .02, .02, .03, .06, .15, .3, .55, .8, .95, 1.1, 1.1, 1.0, 1.0, 1.05, 1.1, 1.0, .8, .55, .35, .18, .08],
    h: [.05, .03, .02, .02, .03, .08, .3, .55, .55, .4, .35, .4, .5, .45, .4, .45, .6, .75, .7, .55, .4, .25, .12, .07],
    n: [.85, .7, .5, .25, .08, .03, .03, .04, .05, .05, .06, .1, .15, .15, .12, .12, .18, .3, .45, .6, .8, .95, 1.1, 1.0],
    l: [.03, .02, .01, .01, .02, .05, .15, .3, .45, .6, .75, .85, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, .9, .7, .45, .25, .12, .06],
  };
  function curve(c, h) { h = ((h % 24) + 24) % 24; const i = Math.floor(h), f = h - i; return c[i] * (1 - f) + c[(i + 1) % 24] * f; }
  function hourFactor(m, h) {
    const t = (m.o + m.s + m.h + m.n + m.l) || 1;
    return (m.o * curve(CURVE.o, h) + m.s * curve(CURVE.s, h) + m.h * curve(CURVE.h, h) + m.n * curve(CURVE.n, h) + m.l * curve(CURVE.l, h)) / t;
  }
  function inH(h, a, b) { return a <= b ? h >= a && h < b : h >= a || h < b; }

  // ================================================================ THE WALK NETWORK
  // A ring = the centreline of the footway round one block: a rectangle
  // x0..x1 / z0..z1 with half width hw. Corners c0 (x0,z0) c1 (x1,z0)
  // c2 (x1,z1) c3 (x0,z1); side c -> c+1 has the building on its RIGHT
  // (+v), the road on its left (-v). (Right of a heading (fx,fz) is (-fz, fx).)
  const SITES = [];
  function zoningOf(A) {
    if (CBZ.zoningFor && A) { try { const Z = CBZ.zoningFor(A); if (Z) return Z; } catch (e) {} }
    return CBZ.zoning || null;
  }
  function arenaRings(A) {
    const out = [];
    const lots = (A.lots || []).slice();
    if (A.annex && A.annex.lots) for (const l of A.annex.lots) lots.push(l);
    const Z = zoningOf(A);
    for (const lot of lots) {
      if (!lot || !(lot.w > 4) || !isFinite(lot.cx) || !isFinite(lot.cz)) continue;
      // the footway is the 2 m between the lot pad and the kerb (world.js):
      // its centreline is 1 m outside the pad
      const hx = lot.w / 2 + 1.0, hz = (lot.d > 4 ? lot.d : lot.w) / 2 + 1.0;
      const D = A.districts && typeof lot.district === "number" ? A.districts[lot.district] : null;
      const kind = D && USE[D.kind] ? D.kind : (D && D.kind === "docks" ? "industrial" : "commercial");
      const m = Object.assign({}, USE[kind]);
      const b = lot.building, sk = b && b.shop && b.shop.kind;
      if (sk === "bar" || sk === "casino" || sk === "arena") m.n += 0.6;
      else if (sk === "food") m.s += 0.35;
      else if (sk) m.s += 0.25;
      let office = false;
      if (A.officeLot) { try { office = !!A.officeLot(lot); } catch (e) {} }
      if (office) m.o += 0.35;
      out.push({ x0: lot.cx - hx, x1: lot.cx + hx, z0: lot.cz - hz, z1: lot.cz + hz, hw: 0.85, mix: m, base: m.base,
        I: Z && Z.intensityAt ? clamp(Z.intensityAt(lot.cx, lot.cz), 0, 1) : 1, lot: lot, office: office, kind: kind });
    }
    return out;
  }
  function metroRings(mc) {
    const P = mc.plan, out = [], Z = CBZ.zoning || null;
    for (const b of P.blocks || []) {
      if (!b || ![b.x0, b.x1, b.z0, b.z1].every(isFinite)) continue;
      const sw = b.sw > 0 ? b.sw : 3;
      if (b.x1 - b.x0 < 2 * sw + 4 || b.z1 - b.z0 < 2 * sw + 4) continue;
      const kind = METRO_USE[b.use] || "residential";
      const m = Object.assign({}, USE[kind]);
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      let I = b.L != null && isFinite(b.L) ? b.L : 0.6;
      if (Z && Z.intensityAt) { try { I = Math.max(I * 0.8, Z.intensityAt(cx, cz)); } catch (e) {} }
      out.push({ x0: b.x0 + sw / 2, x1: b.x1 - sw / 2, z0: b.z0 + sw / 2, z1: b.z1 - sw / 2, hw: Math.max(0.6, sw / 2 - 0.2),
        mix: m, base: m.base, I: clamp(I, 0, 1), blk: b, office: kind === "core" || kind === "industrial", kind: kind });
    }
    // a block facing a park: the leisure walk
    for (const k of P.parks || []) {
      if (![k.x0, k.x1, k.z0, k.z1].every(isFinite)) continue;
      for (const g of out) {
        if (g.x1 < k.x0 - 14 || g.x0 > k.x1 + 14 || g.z1 < k.z0 - 14 || g.z0 > k.z1 + 14) continue;
        g.mix.l += 0.7; g.base = Math.max(g.base, 0.1);
      }
    }
    return out;
  }

  // a coarse grid of items by bounding box (number keys; works at any world offset)
  function gkey(i, j) { return (i + 32768) * 65536 + (j + 32768); }
  function fileBox(map, C, x0, x1, z0, z1, id) {
    const i0 = Math.floor(x0 / C), i1 = Math.floor(x1 / C), j0 = Math.floor(z0 / C), j1 = Math.floor(z1 / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = gkey(i, j); let l = map.get(k); if (!l) map.set(k, l = []); l.push(id);
    }
  }

  const MAXCROSS = 36;
  function buildSite(key, src, rings, opts) {
    const nR = rings.length, nN = nR * 4;
    const nx = new Float32Array(nN), nz = new Float32Array(nN), nadj = new Int32Array(nN * 4).fill(-1);
    let minX = 1e18, maxX = -1e18, minZ = 1e18, maxZ = -1e18;
    const rgrid = new Map(), RC = 32;
    for (let r = 0; r < nR; r++) {
      const g = rings[r];
      nx[r * 4] = g.x0; nz[r * 4] = g.z0; nx[r * 4 + 1] = g.x1; nz[r * 4 + 1] = g.z0;
      nx[r * 4 + 2] = g.x1; nz[r * 4 + 2] = g.z1; nx[r * 4 + 3] = g.x0; nz[r * 4 + 3] = g.z1;
      if (g.x0 < minX) minX = g.x0; if (g.x1 > maxX) maxX = g.x1; if (g.z0 < minZ) minZ = g.z0; if (g.z1 > maxZ) maxZ = g.z1;
      fileBox(rgrid, RC, g.x0, g.x1, g.z0, g.z1, r);
    }
    const EA = [], EB = [], EK = [], EX = [], ER = [];
    function slot(n) { for (let k = 0; k < 4; k++) if (nadj[n * 4 + k] < 0) return k; return -1; }
    function addEdge(a, b, kind, axis, ring) {
      const sa = slot(a), sb = slot(b);
      if (sa < 0 || sb < 0) return -1;
      const e = EA.length;
      EA.push(a); EB.push(b); EK.push(kind); EX.push(axis); ER.push(ring);
      nadj[a * 4 + sa] = e; nadj[b * 4 + sb] = e;
      return e;
    }
    for (let r = 0; r < nR; r++) for (let c = 0; c < 4; c++) addEdge(r * 4 + c, r * 4 + ((c + 1) & 3), 0, 0, r);
    // CROSSINGS: an east corner to the nearest west corner across the street
    // (same z), a z1 corner to the nearest z0 corner (same x), never through
    // another block
    const ngrid = new Map(), NC = 8;
    for (let n = 0; n < nN; n++) fileBox(ngrid, NC, nx[n], nx[n], nz[n], nz[n], n);
    function clearLine(ax, az, bx, bz, ra, rb) {
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
      let ok = true;
      const i0 = Math.floor(x0 / RC), i1 = Math.floor(x1 / RC), j0 = Math.floor(z0 / RC), j1 = Math.floor(z1 / RC);
      for (let i = i0; i <= i1 && ok; i++) for (let j = j0; j <= j1 && ok; j++) {
        const l = rgrid.get(gkey(i, j)); if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const r = l[k]; if (r === ra || r === rb) continue;
          const g = rings[r];
          if (x1 > g.x0 + 0.5 && x0 < g.x1 - 0.5 && z1 > g.z0 + 0.5 && z0 < g.z1 - 0.5) { ok = false; break; }
        }
      }
      return ok;
    }
    function crossFrom(i, alongX) {
      const r = i >> 2;
      let best = -1, bd = 1e9;
      const i0 = alongX ? Math.floor((nx[i] + 3) / NC) : Math.floor((nx[i] - 2) / NC);
      const i1 = alongX ? Math.floor((nx[i] + MAXCROSS) / NC) : Math.floor((nx[i] + 2) / NC);
      const j0 = alongX ? Math.floor((nz[i] - 2) / NC) : Math.floor((nz[i] + 3) / NC);
      const j1 = alongX ? Math.floor((nz[i] + 2) / NC) : Math.floor((nz[i] + MAXCROSS) / NC);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) {
        const l = ngrid.get(gkey(a, b)); if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const j = l[k]; if ((j >> 2) === r) continue;
          const cj = j & 3;
          if (alongX ? (cj !== 0 && cj !== 3) : (cj !== 0 && cj !== 1)) continue;
          const off = alongX ? Math.abs(nz[j] - nz[i]) : Math.abs(nx[j] - nx[i]);
          const d = alongX ? nx[j] - nx[i] : nz[j] - nz[i];
          if (off > 2 || d < 3 || d > MAXCROSS) continue;
          if (d < bd) { bd = d; best = j; }
        }
      }
      if (best >= 0 && clearLine(nx[i], nz[i], nx[best], nz[best], r, best >> 2)) addEdge(i, best, 1, alongX ? 1 : 2, -1);
    }
    for (let i = 0; i < nN; i++) {
      const c = i & 3;
      if (c === 1 || c === 2) crossFrom(i, true);
      if (c === 2 || c === 3) crossFrom(i, false);
    }
    const nE = EA.length;
    const site = {
      key: key, src: src, rings: rings, nN: nN, nE: nE, nx: nx, nz: nz, nadj: nadj,
      ea: Int32Array.from(EA), eb: Int32Array.from(EB), ek: Uint8Array.from(EK), eaxis: Uint8Array.from(EX), ering: Int32Array.from(ER),
      elen: new Float32Array(nE), etx: new Float32Array(nE), etz: new Float32Array(nE), ehw: new Float32Array(nE),
      edens: new Float32Array(nE), eyS: new Array(nE),
      eHead: new Int32Array(nE).fill(-1), nwait: new Uint8Array(nN),
      obsS: new Int32Array(nE), obsN: new Uint16Array(nE), obsU: null, obsV: null, obsR: null,
      egrid: new Map(), EC: 48, rgrid: rgrid, RC: RC,
      spots: [], sgrid: new Map(), fields: new Map(),
      minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, densH: -99, crossings: 0, metro: !!(opts && opts.metro),
    };
    for (let e = 0; e < nE; e++) {
      const a = site.ea[e], b = site.eb[e];
      const dx = nx[b] - nx[a], dz = nz[b] - nz[a], L = Math.hypot(dx, dz) || 1;
      site.elen[e] = L; site.etx[e] = dx / L; site.etz[e] = dz / L;
      site.ehw[e] = site.ek[e] === 1 ? 1.4 : rings[site.ering[e]].hw;
      if (site.ek[e] === 1) site.crossings++;
      fileBox(site.egrid, site.EC, Math.min(nx[a], nx[b]), Math.max(nx[a], nx[b]), Math.min(nz[a], nz[b]), Math.max(nz[a], nz[b]), e);
    }
    return site;
  }
  function other(site, e, n) { return site.ea[e] === n ? site.eb[e] : site.ea[e]; }
  // edge point at distance u from its start, v metres to its right
  function eX(site, e, u, v) { return site.nx[site.ea[e]] + site.etx[e] * u - site.etz[e] * v; }
  function eZ(site, e, u, v) { return site.nz[site.ea[e]] + site.etz[e] * u + site.etx[e] * v; }
  function groundY(x, z) {
    const A = arena();
    if (A && A.groundHeightAt) { try { const y = +A.groundHeightAt(x, z); if (isFinite(y)) return y; } catch (e) {} }
    if (CBZ.floorAt) { try { const y = +CBZ.floorAt(x, z); if (isFinite(y)) return y; } catch (e) {} }
    return 0;
  }
  // the ground along a pavement, sampled every ~12 m the first time anyone
  // walks it (a long metro block on a hill is not a straight line)
  function edgeY(site, e, u) {
    let s = site.eyS[e];
    const L = site.elen[e];
    if (!s) {
      const n = Math.max(1, Math.ceil(L / 12));
      s = site.eyS[e] = new Float32Array(n + 1);
      for (let k = 0; k <= n; k++) { const uu = L * k / n; s[k] = groundY(eX(site, e, uu, 0), eZ(site, e, uu, 0)); }
    }
    const t = clamp(u / L, 0, 1) * (s.length - 1), i = Math.min(s.length - 2, Math.floor(t));
    if (i < 0) return s[0];
    const f = t - i;
    return s[i] * (1 - f) + s[i + 1] * f;
  }
  // project (x,z) on edge e: {u, v}
  const _pr = { u: 0, v: 0 };
  function project(site, e, x, z) {
    const a = site.ea[e], dx = x - site.nx[a], dz = z - site.nz[a];
    _pr.u = dx * site.etx[e] + dz * site.etz[e];
    _pr.v = -dx * site.etz[e] + dz * site.etx[e];
    return _pr;
  }
  // the nearest SIDE edge to (x,z) within maxD: {e, u, v} or null
  function nearestSide(site, x, z, maxD) {
    const C = site.EC;
    let best = -1, bd = maxD, bu = 0, bv = 0;
    for (let i = Math.floor((x - maxD) / C); i <= Math.floor((x + maxD) / C); i++) for (let j = Math.floor((z - maxD) / C); j <= Math.floor((z + maxD) / C); j++) {
      const l = site.egrid.get(gkey(i, j)); if (!l) continue;
      for (let k = 0; k < l.length; k++) {
        const e = l[k]; if (site.ek[e] !== 0) continue;
        const p = project(site, e, x, z);
        const u = clamp(p.u, 0, site.elen[e]);
        const d = Math.hypot(p.u - u, p.v);
        if (d < bd) { bd = d; best = e; bu = u; bv = p.v; }
      }
    }
    return best >= 0 ? { e: best, u: bu, v: bv, d: bd } : null;
  }

  // ---- the obstacles on each pavement, binned per edge (lamps, trees, bins...)
  const PROP_R = { lamp: 0.25, tree: 0.55, hydrant: 0.25, mailbox: 0.35, bin: 0.35, newsbox: 0.35, meter: 0.15, bench: 0.95,
    busstop: 0.35, bikerack: 0.65, patio: 1.0, propane: 0.4, cart: 0.55, sign: 0.15 };
  function binObstacles(site, props) {
    const per = [];
    for (let e = 0; e < site.nE; e++) per.push(null);
    for (const p of props) {
      if (!p || !isFinite(p.x) || !isFinite(p.z)) continue;
      const r = PROP_R[p.type]; if (r == null) continue;
      const q = nearestSide(site, p.x, p.z, 3);
      if (!q) continue;
      if (Math.abs(q.v) > site.ehw[q.e] + r) continue;
      (per[q.e] || (per[q.e] = [])).push(q.u, q.v, r);
    }
    let n = 0;
    for (let e = 0; e < site.nE; e++) if (per[e]) n += per[e].length / 3;
    site.obsU = new Float32Array(n); site.obsV = new Float32Array(n); site.obsR = new Float32Array(n);
    let k = 0;
    for (let e = 0; e < site.nE; e++) {
      site.obsS[e] = k;
      const L = per[e]; if (!L) continue;
      for (let i = 0; i < L.length; i += 3) { site.obsU[k] = L[i]; site.obsV[k] = L[i + 1]; site.obsR[k] = L[i + 2]; k++; }
      site.obsN[e] = L.length / 3;
    }
  }

  // ---- ACTIVITY SPOTS: doors, shop fronts, bus stops, benches
  // spot: {type, e, u, x, z, ex, ez (out of the building), tx, tz (along the
  // facade), shop, office, cap, occ}
  function addSpot(site, s) {
    s.occ = 0; s.id = site.spots.length;
    site.spots.push(s);
    fileBox(site.sgrid, 48, s.x, s.x, s.z, s.z, s.id);
  }
  function arenaSpots(site, A) {
    // doors (world.js lots carry the building's door: {x, z, nx, nz}, n into the room)
    const lots = (A.lots || []).slice();
    if (A.annex && A.annex.lots) for (const l of A.annex.lots) lots.push(l);
    for (const lot of lots) {
      const b = lot && lot.building, d = b && b.door;
      if (!d || !isFinite(d.x) || !isFinite(d.nx)) continue;
      const ex = -d.nx, ez = -d.nz;
      const q = nearestSide(site, d.x + ex * 3, d.z + ez * 3, 12);
      if (!q) continue;
      // the side must face the door: its road side (-v) points along the door's outside
      const rx = -site.etz[q.e], rz = site.etx[q.e];
      if (-(rx * ex + rz * ez) < 0.6) continue;
      const p = project(site, q.e, d.x, d.z);
      const kd = p.v;
      if (kd < 0.3 || kd > 11) continue;
      const sk = b.shop && b.shop.kind || null;
      let office = false;
      if (A.officeLot) { try { office = !!A.officeLot(lot); } catch (e) {} }
      addSpot(site, { type: "door", e: q.e, u: clamp(p.u, 0.5, site.elen[q.e] - 0.5), x: d.x + ex * 0.35, z: d.z + ez * 0.35,
        ex: ex, ez: ez, tx: -ez, tz: ex, kd: kd, shop: sk, office: office, home: !sk && !office, cap: 1 });
    }
    // bus stops and benches on the pavement (props.js streetProps / propuse.js seats)
    for (const p of A.streetProps || []) {
      if (!p || p.type !== "busstop" || !isFinite(p.x)) continue;
      const q = nearestSide(site, p.x, p.z, 4);
      if (!q) continue;
      addSpot(site, { type: "bus", e: q.e, u: clamp(q.u, 1, site.elen[q.e] - 1), x: p.x, z: p.z, cap: 3 });
    }
    benchSpots(site);
  }
  function benchSpots(site) {
    const seats = CBZ.propSeats || [];
    for (const s of seats) {
      if (!s || s.kind !== "bench" || !isFinite(s.x)) continue;
      if (s.x < site.minX - 6 || s.x > site.maxX + 6 || s.z < site.minZ - 6 || s.z > site.maxZ + 6) continue;
      const q = nearestSide(site, s.x, s.z, 2.6);
      if (!q) continue;
      addSpot(site, { type: "bench", e: q.e, u: clamp(q.u, 0.5, site.elen[q.e] - 0.5), x: s.x, z: s.z, seat: s, cap: 1 });
    }
  }
  // shop fronts (no door record: a metro facade, or a long downtown side):
  // every ~24 m of a busy pavement, at the building edge of the footway
  function frontSpots(site) {
    for (let e = 0; e < site.nE; e++) {
      if (site.ek[e] !== 0) continue;
      const g = site.rings[site.ering[e]], m = g.mix;
      if (m.s + m.n + m.o < 0.45 || g.base < 0.09) continue;
      const L = site.elen[e], hw = site.ehw[e];
      for (let u = 8; u < L - 6; u += 24) {
        const v = hw - 0.3;
        addSpot(site, { type: "front", e: e, u: u, x: eX(site, e, u, v), z: eZ(site, e, u, v),
          ex: site.etz[e], ez: -site.etx[e], tx: site.etx[e], tz: site.etz[e], room: hw, shop: m.s > 0.3 ? "shop" : null,
          office: m.o > 0.4, night: m.n > 0.3, cap: 1 });
      }
    }
  }

  function siteForArena(A) {
    const rings = arenaRings(A);
    if (!rings.length) return null;
    const s = buildSite("arena", A, rings, null);
    binObstacles(s, A.streetProps || []);
    arenaSpots(s, A);
    frontSpots(s);
    return s;
  }
  function siteForMetro(mc) {
    const rings = metroRings(mc);
    if (!rings.length) return null;
    const s = buildSite("metro:" + (mc.id || mc.name), mc.plan, rings, { metro: true });
    const props = [];
    for (const t of mc.plan.trees || []) if (t && isFinite(t.x)) props.push({ x: t.x, z: t.z, type: "tree" });
    binObstacles(s, props);
    benchSpots(s);
    frontSpots(s);
    return s;
  }

  // ---- the hour on every pavement
  function refreshDensity(site, h) {
    const mul = CFG.STREET_DENSITY > 0 ? +CFG.STREET_DENSITY : 1;
    for (let e = 0; e < site.nE; e++) {
      if (site.ek[e] !== 0) { site.edens[e] = 0; continue; }
      const g = site.rings[site.ering[e]];
      site.edens[e] = clamp(g.base * (0.3 + 0.7 * g.I) * hourFactor(g.mix, h) * mul, 0, 0.8);
    }
    // the people waiting add to the pavement they wait on
    for (const s of site.spots) if (s.type === "bus") site.edens[s.e] += 0.04 * curve(CURVE.s, h);
    site.densH = h;
  }

  // ================================================================ the store group
  let GS = null;
  function storeGroup() {
    if (GS && !GS.gone) return GS;
    GS = ST.group({ name: "street", kind: "street", who: "pedestrians", mode: "city", cap: BUD.rows + 260,
      maxDraw: R + 20, own: true, moving: true, cutDt: 0.1, aff: "public", onLife: onLife,
      // the store's hand-over (a round, a blast, a car near the lens): the
      // struck person becomes a real body on that call
      promote: function (r) { return promoteNow(r); } });
    return GS;
  }
  function stamp() { return ST.clock() + 1 / 60; }

  // ================================================================ groups
  const KIND = { SOLO: 0, COUPLE: 1, FRIENDS: 2, FAMILY: 3, WORK: 4, TEENS: 5, CHAT: 6, QUEUE: 7, SMOKE: 8, BUS: 9, BENCH: 10, BROWSE: 11 };
  const KIND_NAMES = ["solo", "couple", "friends", "family", "coworkers", "teens", "chat", "queue", "smokers", "busstop", "bench", "browse"];
  const MODE = { WALK: 0, WAIT: 1, CROSS: 2, STAND: 3, DOOR_IN: 4, DOOR_OUT: 5, FLEE: 6, HELP: 7 };
  const GM = 6;
  const GMAX = BUD.rows + 64;
  const gUsed = new Uint8Array(GMAX), gKind = new Uint8Array(GMAX), gMode = new Uint8Array(GMAX), gN = new Uint8Array(GMAX), gKind0 = new Int8Array(GMAX).fill(-1);
  const gMem = new Int32Array(GMAX * GM).fill(-1), gSer = new Uint32Array(GMAX);
  const gSite = new Int16Array(GMAX), gE = new Int32Array(GMAX).fill(-1), gDir = new Int8Array(GMAX), gS = new Float32Array(GMAX);
  const gSpd = new Float32Array(GMAX), gCur = new Float32Array(GMAX), gT = new Float32Array(GMAX), gT2 = new Float32Array(GMAX);
  const gGX = new Float32Array(GMAX), gGZ = new Float32Array(GMAX), gSpot = new Int32Array(GMAX).fill(-1), gStall = new Uint8Array(GMAX);
  const gGoalN = new Int32Array(GMAX).fill(-1);      // the destination node (its flow field)
  const gX = new Float32Array(GMAX), gZ = new Float32Array(GMAX), gY = new Float32Array(GMAX), gFX = new Float32Array(GMAX), gFZ = new Float32Array(GMAX);
  // gF = the formation's heading (eased round corners), gT = where it is turning to
  const gTX = new Float32Array(GMAX), gTZ = new Float32Array(GMAX);
  const gLat = new Float32Array(GMAX), gFileT = new Float32Array(GMAX), gNext = new Float32Array(GMAX), gLast = new Float32Array(GMAX);
  const gNxE = new Int32Array(GMAX).fill(-1), gPvE = new Int32Array(GMAX).fill(-1), gOnE = new Int32Array(GMAX).fill(-1);
  const gNextE = new Int32Array(GMAX).fill(-1), gWaitN = new Int32Array(GMAX).fill(-1);
  const gPX = new Float32Array(GMAX), gPZ = new Float32Array(GMAX), gTalk = new Uint8Array(GMAX), gTalkT = new Float32Array(GMAX);
  const gHurtT = new Float32Array(GMAX), gHX = new Float32Array(GMAX), gHZ = new Float32Array(GMAX), gWide = new Float32Array(GMAX);
  let gHi = 0, gCount = 0, SER = 1;
  const gFree = [];

  // members, by store row
  const CAP = ST.cap();
  const mG = new Int32Array(CAP).fill(-1), mK = new Uint8Array(CAP), mKid = new Uint8Array(CAP);
  const mLat = new Float32Array(CAP), mFwd = new Float32Array(CAP), mSLat = new Float32Array(CAP), mSFwd = new Float32Array(CAP);
  const mTX = new Float32Array(CAP), mTZ = new Float32Array(CAP), mTY = new Float32Array(CAP), mFace = new Float32Array(CAP);
  const mStand = new Uint8Array(CAP), mWalkClip = new Uint8Array(CAP), mRig = new Int16Array(CAP).fill(-1), mPhone = new Uint8Array(CAP);
  const mPace = new Float32Array(CAP);

  function allocGroup() {
    let g = gFree.length ? gFree.pop() : (gHi < GMAX ? gHi++ : -1);
    if (g < 0) return -1;
    gUsed[g] = 1; gN[g] = 0; gSer[g] = SER++; gE[g] = -1; gOnE[g] = -1; gSpot[g] = -1; gStall[g] = 0; gFileT[g] = 0;
    gT[g] = 0; gT2[g] = 0; gTalk[g] = 0; gTalkT[g] = 0; gKind0[g] = -1; gHurtT[g] = -99; gWaitN[g] = -1; gNext[g] = 0; gLast[g] = CLOCK; gWide[g] = 0;
    for (let k = 0; k < GM; k++) gMem[g * GM + k] = -1;
    gCount++;
    return g;
  }
  function freeGroup(g) {
    if (!gUsed[g]) return;
    leaveEdge(g);
    unwait(g);
    if (gSpot[g] >= 0) { const s = SITES[gSite[g]] && SITES[gSite[g]].spots[gSpot[g]]; if (s) s.occ = Math.max(0, s.occ - 1); gSpot[g] = -1; }
    gUsed[g] = 0; gN[g] = 0; gCount--;
    gFree.push(g);
  }
  // the 1-D spatial hash: groups on each edge (a doubly linked list)
  function enterEdge(g, e) {
    if (gOnE[g] === e) return;
    leaveEdge(g);
    const site = SITES[gSite[g]]; if (!site || e < 0) return;
    gOnE[g] = e; gPvE[g] = -1; gNxE[g] = site.eHead[e];
    if (site.eHead[e] >= 0) gPvE[site.eHead[e]] = g;
    site.eHead[e] = g;
  }
  function leaveEdge(g) {
    const e = gOnE[g]; if (e < 0) return;
    const site = SITES[gSite[g]];
    if (site) {
      if (gPvE[g] >= 0) gNxE[gPvE[g]] = gNxE[g]; else if (site.eHead[e] === g) site.eHead[e] = gNxE[g];
      if (gNxE[g] >= 0) gPvE[gNxE[g]] = gPvE[g];
    }
    gOnE[g] = -1; gNxE[g] = -1; gPvE[g] = -1;
  }
  function unwait(g) {
    const n = gWaitN[g]; if (n < 0) return;
    const site = SITES[gSite[g]]; if (site && site.nwait[n] > 0) site.nwait[n]--;
    gWaitN[g] = -1;
  }
  function members(g, out) {
    out.length = 0;
    for (let k = 0; k < GM; k++) { const r = gMem[g * GM + k]; if (r >= 0) out.push(r); }
    return out;
  }
  function addMember(g, r) {
    for (let k = 0; k < GM; k++) if (gMem[g * GM + k] < 0) { gMem[g * GM + k] = r; mG[r] = g; mK[r] = k; gN[g]++; return true; }
    return false;
  }
  function dropMember(r) {
    const g = mG[r]; if (g < 0) return;
    mG[r] = -1;
    for (let k = 0; k < GM; k++) if (gMem[g * GM + k] === r) { gMem[g * GM + k] = -1; gN[g]--; break; }
    if (gN[g] <= 0) freeGroup(g);
  }
  // the store tells us when one of ours is hurt or killed: they leave the group
  function onLife(r, to) {
    if (mRig[r] >= 0) return;            // a promoted body: the rig pass owns it
    if (to === ST.DEAD && CBZ.cityPopulationDie) { try { CBZ.cityPopulationDie(1); } catch (e) {} }   // the city's headcount
    if (mG[r] >= 0) dropMember(r);
  }

  // ================================================================ looks
  const SKINS = [0xf1c9a5, 0xe0a878, 0xc68642, 0x8d5524, 0xffdbac, 0xa66a3c];
  const HAIRS = [0x1a1410, 0x2a2018, 0x3b2a1a, 0x6b4a2a, 0x8a6a3a, 0x101010, 0x55524e, 0x4a3520];
  const CASUAL = [0x2c3e5c, 0x6e2b33, 0x33573b, 0xc9a23a, 0x444a52, 0x23262b, 0x8a939c, 0x3a5a7c, 0xe8e6e0, 0x356b9a];
  const BRIGHT = [0xe8e4da, 0xe2574c, 0x4fa3e0, 0xe8c84a, 0xd96bb0];
  const WORKGEAR = [0xe8821a, 0xc6d435, 0x4e453a, 0x5a5e52];
  const PARTY = [0xff2e7a, 0xa44dff, 0x22d4c8, 0xf5e9da, 0x16161a];
  const SUITS = [0x1d2333, 0x2a2d33, 0x16181c, 0x3a3f48, 0x2b3346];
  const PANTS = [0x2a3446, 0x3b3f47, 0x1f2226, 0x4a4036, 0x5a6270, 0x6b6150];
  const JEANS = [0x2d3a52, 0x3a4a66, 0x22293a];
  const TEENS = [0xe2574c, 0x4fa3e0, 0xe8c84a, 0x7a3fb0, 0x33a37a, 0xe8e6e0, 0x16161a];
  const KIDS = [0xe2574c, 0x4fa3e0, 0xe8c84a, 0xd96bb0, 0x33a37a, 0xf08c2c];
  function lookId(o) {
    const C = CBZ.crowdGPU;
    if (!C || !C.look) return 0;
    try { return C.look(o); } catch (e) { return 0; }
  }
  // what this person wears: who they are (the group's kind), where (the
  // pavement's use), when (the hour)
  function dress(kind, fem, kid, mix, h) {
    const skin = pick(SKINS), hair = pick(HAIRS);
    let shirt, pants, shoes = rnd() < 0.3 ? 0xd8d8d8 : 0x2b2b2b, sleeve;
    const night = inH(h, 20, 5);
    if (kid) { shirt = pick(KIDS); pants = pick(JEANS); shoes = 0xd8d8d8; sleeve = rnd() < 0.6 ? skin : shirt; }
    else if (kind === KIND.WORK || (kind === KIND.SOLO && mix.o > 0.5 && inH(h, 7, 19) && rnd() < 0.55)) {
      const s = pick(SUITS); shirt = s; pants = rnd() < 0.8 ? s : pick(PANTS); sleeve = s; shoes = rnd() < 0.7 ? 0x16120e : 0x4a2e1c;
      if (fem && rnd() < 0.4) { shirt = pick([0xe8e6e0, 0x8a939c, 0x6e2b33]); sleeve = shirt; }
    } else if (kind === KIND.TEENS) { shirt = pick(TEENS); pants = pick(JEANS); sleeve = rnd() < 0.5 ? skin : shirt; shoes = 0xd8d8d8; }
    else if (night && mix.n > 0.3) { shirt = pick(PARTY); pants = rnd() < 0.5 ? 0x16161a : pick(JEANS); sleeve = rnd() < 0.5 ? skin : shirt; }
    else if (mix.o > 0.6 && mix.s < 0.2) { shirt = rnd() < 0.5 ? pick(WORKGEAR) : pick(CASUAL); pants = pick(PANTS); sleeve = shirt; }
    else { shirt = rnd() < 0.25 && mix.s > 0.3 ? pick(BRIGHT) : pick(CASUAL); pants = rnd() < 0.5 ? pick(JEANS) : pick(PANTS); sleeve = rnd() < 0.45 ? skin : shirt; }
    return lookId({ build: fem ? "f" : "m", skin: skin, shirt: shirt, pants: pants, hair: hair, shoes: shoes, sleeve: sleeve });
  }

  // ================================================================ clips
  let CL = null;
  function clips() {
    if (CL) return CL;
    const C = CBZ.crowdGPU;
    const rpm = function (id, d) { const c = C && C.clip ? C.clip(id) : null; return (c && c.radPerM) || d; };
    CL = {
      idle: ST.clip("idle"), walk: ST.clip("walk"), run: ST.clip("run"), sit: ST.clip("sit"),
      talk: ST.clip("talk"), talkWalk: ST.clip("talkWalk"), phone: ST.clip("phone"), phoneWalk: ST.clip("phoneWalk"), smoke: ST.clip("smoke"),
      rpm: {},
    };
    CL.rpm[CL.walk] = rpm("walk", 4.4); CL.rpm[CL.run] = rpm("run", 2.3);
    CL.rpm[CL.talkWalk] = rpm("talkWalk", CL.rpm[CL.walk]); CL.rpm[CL.phoneWalk] = rpm("phoneWalk", CL.rpm[CL.walk]);
    CL.period = {};
    CL.period[CL.idle] = 4; CL.period[CL.sit] = 4; CL.period[CL.talk] = 5.6; CL.period[CL.phone] = 4; CL.period[CL.smoke] = 5.2;
    return CL;
  }
  // standing clips: 0 idle, 1 talk, 2 phone, 3 smoke, 4 sit
  const STAND_CLIP = ["idle", "talk", "phone", "smoke", "sit"];

  // ================================================================ formations
  // slot (lateral, forward) in the travel frame, lateral + = right
  function formation(g) {
    const n = gN[g], kind = gKind[g], hw = curHw(g);
    const ms = members(g, _ms);
    const file = gFileT[g] > 0;
    for (let i = 0; i < ms.length; i++) {
      const r = ms[i];
      let lat = 0, fwd = 0;
      if (file) { lat = 0; fwd = -i * 0.95; }
      else if (n === 2) { lat = i ? 0.42 : -0.42; fwd = i ? -0.08 : 0; }
      else if (n === 3) {
        if (kind === KIND.FAMILY) { if (i < 2) { lat = i ? 0.4 : -0.4; } else { lat = 0; fwd = 0.95; } }
        else if (hw >= 1.2) { lat = (i - 1) * 0.78; fwd = i === 1 ? 0.06 : 0; }
        else { if (i < 2) lat = i ? 0.42 : -0.42; else { lat = 0; fwd = -1.05; } }
      } else if (n >= 4) {
        if (kind === KIND.FAMILY) { if (i < 2) lat = i ? 0.4 : -0.4; else { lat = i === 2 ? -0.38 : 0.38; fwd = 0.95; } }
        else { lat = (i & 1) ? 0.42 : -0.42; fwd = i >= 2 ? -1.1 * ((i / 2) | 0) : 0; }
      }
      mSLat[r] = lat; mSFwd[r] = fwd;
    }
    let w = 0;
    for (let i = 0; i < ms.length; i++) w = Math.max(w, Math.abs(mSLat[ms[i]]));
    return w + 0.3;
  }
  const _ms = [], _ms2 = [];
  function curHw(g) {
    const site = SITES[gSite[g]], e = gE[g];
    return site && e >= 0 ? site.ehw[e] : 1;
  }

  // ================================================================ spawning
  const act = { e: [], s: [], cum: new Float64Array(0), n: 0, total: 0 };
  let liveRows = 0, target = 0, spawnedOnce = false;
  function refreshActive(px, pz) {
    act.e.length = 0; act.s.length = 0;
    let tot = 0;
    if (act.cum.length < 4096) act.cum = new Float64Array(4096);
    for (let si = 0; si < SITES.length; si++) {
      const site = SITES[si];
      if (!site || px < site.minX - R || px > site.maxX + R || pz < site.minZ - R || pz > site.maxZ + R) continue;
      const C = site.EC, seen = _seen;
      seen.clear();
      for (let i = Math.floor((px - R) / C); i <= Math.floor((px + R) / C); i++) for (let j = Math.floor((pz - R) / C); j <= Math.floor((pz + R) / C); j++) {
        const l = site.egrid.get(gkey(i, j)); if (!l) continue;
        for (let k = 0; k < l.length; k++) {
          const e = l[k];
          if (site.ek[e] !== 0 || seen.has(e)) continue;
          seen.add(e);
          const mx = (site.nx[site.ea[e]] + site.nx[site.eb[e]]) / 2, mz = (site.nz[site.ea[e]] + site.nz[site.eb[e]]) / 2;
          const d = Math.hypot(mx - px, mz - pz);
          if (d > R) continue;
          const fall = d < 0.45 * R ? 1 : 1 - 0.65 * (d - 0.45 * R) / (0.55 * R);
          const w = site.edens[e] * site.elen[e] * fall;
          if (!(w > 0)) continue;
          if (act.e.length >= act.cum.length) { const c2 = new Float64Array(act.cum.length * 2); c2.set(act.cum); act.cum = c2; }
          tot += w;
          act.cum[act.e.length] = tot;
          act.e.push(e); act.s.push(si);
        }
      }
    }
    act.n = act.e.length; act.total = tot;
    // a massacre thins the street for good: the finite headcount (peds.js)
    let alive = 1;
    if (CBZ.cityPopulation) { try { const P = CBZ.cityPopulation(); if (P && P.total > 0) alive = clamp(P.alive / P.total, 0.15, 1); } catch (e) {} }
    target = Math.round(Math.min(BUD.rows, tot) * alive);
  }
  const _seen = new Set();
  function sampleEdge() {
    if (!act.n) return -1;
    const x = rnd() * act.total;
    let lo = 0, hi = act.n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (act.cum[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }
  // may a body appear at (x,z) without anyone seeing it appear? (config.js's
  // shared spawn guard: never on screen inside 55% of the street radius; past
  // that a person is an impostor a few pixels tall behind a block of
  // buildings, and the street ahead of a moving car has to fill somehow)
  function hidden(x, z) {
    const P = playerPos();
    if (!P) return true;
    const d = Math.hypot(x - P.x, z - P.z);
    if (d < 30) return false;
    if (CBZ.npcTransitionSafe) { try { return !!CBZ.npcTransitionSafe(x, z, { minDistance: 30, maxDistance: R * 0.55 }); } catch (e) { return true; } }
    return d > 60;
  }

  // what kind of group, at this pavement at this hour
  function rollGroup(mix, h) {
    const u = rnd();
    let n = u < 0.62 ? 1 : u < 0.87 ? 2 : u < 0.96 ? 3 : 4;
    if (n === 1) return { kind: KIND.SOLO, n: 1 };
    const day = inH(h, 7, 20.5);
    const wWork = day ? mix.o * (inH(h, 11.5, 14) ? 3 : inH(h, 8, 9.5) || inH(h, 17, 18.5) ? 1.2 : 0.35) : 0;
    const wFam = inH(h, 8.5, 19.5) ? (mix.h + mix.l + mix.s * 0.5) * 0.9 : 0.02;
    const wTeen = inH(h, 14.5, 22.5) ? (mix.s + mix.l + mix.n * 0.5) * 0.8 : 0.05;
    const wCouple = n === 2 ? 1.2 + mix.n * (day ? 0.2 : 1.5) : 0;
    const wFriends = 0.9 + (day ? 0 : mix.n * 1.5);
    const W = [wCouple, wFriends, wFam, wWork, n >= 3 || n === 2 ? wTeen : 0];
    const K = [KIND.COUPLE, KIND.FRIENDS, KIND.FAMILY, KIND.WORK, KIND.TEENS];
    let t = 0; for (const w of W) t += w;
    let x = rnd() * t, kind = KIND.FRIENDS;
    for (let i = 0; i < W.length; i++) { x -= W[i]; if (x <= 0) { kind = K[i]; break; } }
    return { kind: kind, n: n };
  }
  // who is in it: genders, kids, pace
  function cast(kind, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      let fem = rnd() < 0.5, kid = false;
      if (kind === KIND.COUPLE) fem = i === 0 ? rnd() < 0.5 : !out[0].fem || rnd() < 0.08;
      if (kind === KIND.FAMILY) {
        if (n === 2) kid = i === 1;
        else kid = i >= 2;
        if (!kid && n >= 3) fem = i === 0;
      }
      out.push({ fem: fem, kid: kid });
    }
    let pace = kind === KIND.SOLO ? 1.25 + rnd() * 0.32 : kind === KIND.FAMILY ? 0.95 + rnd() * 0.14 : kind === KIND.WORK ? 1.2 + rnd() * 0.2
      : kind === KIND.TEENS ? 1.18 + rnd() * 0.25 : 1.08 + rnd() * 0.22;
    return { who: out, pace: pace };
  }

  function makeRow(g, x, y, z, yaw, look, kid) {
    const G = storeGroup(); if (!G) return -1;
    const C = clips();
    const r = G.add(x, y, z, yaw, look, C.idle, rnd(), 0.25, kid ? { scale: 0.64 + rnd() * 0.08, prot: true } : (gKind[g] === KIND.TEENS ? { scale: 0.93 + rnd() * 0.04 } : null));
    if (r < 0) return -1;
    S.pnow[r] = 1; S.posT[r] = stamp();
    mKid[r] = kid ? 1 : 0; mRig[r] = -1; mStand[r] = 0; mPhone[r] = 0; mLat[r] = 0; mFwd[r] = 0;
    if (!addMember(g, r)) { G.remove(r); return -1; }
    return r;
  }

  // a walking group on edge e of site si
  function spawnWalker(si, e, initial) {
    const site = SITES[si], ring = site.rings[site.ering[e]], h = HOUR;
    const L = site.elen[e]; if (L < 3) return 0;
    const s0 = 1 + rnd() * (L - 2), dir = rnd() < 0.5 ? 1 : -1;
    const u = dir > 0 ? s0 : L - s0;
    const x = eX(site, e, u, 0), z = eZ(site, e, u, 0);
    if (!initial && !hidden(x, z)) return 0;
    const gr = rollGroup(ring.mix, h), cs = cast(gr.kind, gr.n);
    const g = allocGroup(); if (g < 0) return 0;
    gKind[g] = gr.kind; gSite[g] = si; gMode[g] = MODE.WALK; gE[g] = e; gDir[g] = dir; gS[g] = s0;
    gSpd[g] = cs.pace; gCur[g] = cs.pace;
    const y = edgeY(site, e, u);
    for (const p of cs.who) {
      const r = makeRow(g, x, y, z, 0, dress(gr.kind, p.fem, p.kid, ring.mix, h), p.kid);
      if (r >= 0) mPhone[r] = gr.kind === KIND.SOLO && rnd() < 0.18 ? 1 : 0;
    }
    if (!gN[g]) { freeGroup(g); return 0; }
    enterEdge(g, e);
    pickGoal(g);
    anchorOnEdge(g);
    gFX[g] = gTX[g]; gFZ[g] = gTZ[g];
    const w = formation(g);
    gLat[g] = keepRight(g, w);
    const ms = members(g, _ms);
    for (const r of ms) {
      mLat[r] = mSLat[r]; mFwd[r] = mSFwd[r];
      slotTarget(g, r);
      S.x[r] = mTX[r]; S.z[r] = mTZ[r]; S.y[r] = gY[g];
      S.yaw[r] = Math.atan2(gFX[g], gFZ[g]);
    }
    return ms.length;
  }

  // a standing group at an activity spot (a chat outside a shop, a queue, smokers, the bus stop, a bench)
  function spotKind(s, h, mix) {
    if (s.type === "bus") return KIND.BUS;
    if (s.type === "bench") return KIND.BENCH;
    const lunch = inH(h, 11.3, 14.2), eve = inH(h, 18, 21);
    if (s.type === "door") {
      if (s.shop === "food" && (lunch || eve)) return rnd() < 0.7 ? KIND.QUEUE : KIND.CHAT;
      if ((s.office && inH(h, 8.5, 18.5)) || ((s.shop === "bar" || s.shop === "casino") && inH(h, 19, 3))) return rnd() < 0.6 ? KIND.SMOKE : KIND.CHAT;
      if (s.shop && inH(h, 9, 21)) return rnd() < 0.55 ? KIND.BROWSE : KIND.CHAT;
      return rnd() < 0.5 ? KIND.CHAT : -1;
    }
    // a shop front
    if (s.night && inH(h, 20, 3)) return rnd() < 0.5 ? KIND.SMOKE : KIND.CHAT;
    if (s.office && inH(h, 9, 18) && rnd() < 0.4) return KIND.SMOKE;
    if (s.shop && inH(h, 9, 21)) return rnd() < 0.6 ? KIND.BROWSE : KIND.CHAT;
    return rnd() < 0.35 ? KIND.CHAT : -1;
  }
  function spawnStander(si, e, initial) {
    const site = SITES[si];
    const x0 = eX(site, e, site.elen[e] / 2, 0), z0 = eZ(site, e, site.elen[e] / 2, 0);
    // a free spot near this pavement
    let best = null, bd = 1e9;
    const C = 48;
    for (let i = Math.floor((x0 - 60) / C); i <= Math.floor((x0 + 60) / C); i++) for (let j = Math.floor((z0 - 60) / C); j <= Math.floor((z0 + 60) / C); j++) {
      const l = site.sgrid.get(gkey(i, j)); if (!l) continue;
      for (let k = 0; k < l.length; k++) {
        const s = site.spots[l[k]];
        if (s.occ >= s.cap) continue;
        const d = Math.hypot(s.x - x0, s.z - z0) + rnd() * 25;
        if (d < bd) { bd = d; best = s; }
      }
    }
    if (!best) return 0;
    if (!initial && !hidden(best.x, best.z)) return 0;
    const ring = site.rings[site.ering[best.e]], h = HOUR;
    const kind = spotKind(best, h, ring.mix);
    if (kind < 0) return 0;
    let n = 1;
    if (kind === KIND.CHAT) n = 3 + ((rnd() * 3) | 0);
    else if (kind === KIND.QUEUE) n = 3 + ((rnd() * 4) | 0);
    else if (kind === KIND.SMOKE) n = 2 + ((rnd() * 2) | 0);
    else if (kind === KIND.BUS) n = 1 + ((rnd() * 3) | 0);
    else if (kind === KIND.BENCH) n = rnd() < 0.45 && pairSeat(site, best) ? 2 : 1;
    else if (kind === KIND.BROWSE) n = rnd() < 0.35 ? 2 : 1;
    if (kind === KIND.CHAT && best.type === "front" && best.room < 1.25) n = Math.min(n, 3);
    const g = allocGroup(); if (g < 0) return 0;
    gKind[g] = kind; gSite[g] = si; gSpot[g] = best.id; best.occ++;
    gE[g] = best.e; gDir[g] = 1; gS[g] = best.u; gSpd[g] = 1.1 + rnd() * 0.25; gCur[g] = gSpd[g];
    const y = edgeY(site, best.e, best.u);
    const fem0 = rnd() < 0.5;
    for (let i = 0; i < n; i++) {
      const fem = kind === KIND.BENCH && n === 2 ? (i ? !fem0 : fem0) : rnd() < 0.5;
      makeRow(g, best.x, y, best.z, 0, dress(kind === KIND.SMOKE && best.office ? KIND.WORK : kind, fem, false, ring.mix, h), false);
    }
    if (!gN[g]) { freeGroup(g); return 0; }
    enterEdge(g, best.e);
    startStand(g, true);
    return gN[g];
  }
  function pairSeat(site, s) {
    if (!s.seat) return null;
    for (const t of site.spots) if (t !== s && t.type === "bench" && t.occ < t.cap && Math.hypot(t.x - s.x, t.z - s.z) < 0.75) return t;
    return null;
  }
  // people coming OUT of a door: what fills a street in view without a pop
  function spawnFromDoor(si) {
    const site = SITES[si], P = playerPos();
    if (!P) return 0;
    let best = null, bd = 1e9;
    const C = 48;
    for (let i = Math.floor((P.x - 70) / C); i <= Math.floor((P.x + 70) / C); i++) for (let j = Math.floor((P.z - 70) / C); j <= Math.floor((P.z + 70) / C); j++) {
      const l = site.sgrid.get(gkey(i, j)); if (!l) continue;
      for (let k = 0; k < l.length; k++) {
        const s = site.spots[l[k]];
        if (s.type !== "door" || s.occ >= s.cap) continue;
        const d = Math.hypot(s.x - P.x, s.z - P.z);
        if (d < 14 || d > 70) continue;
        const sc = rnd() * 60 + (site.edens[s.e] > 0 ? 0 : 40);
        if (sc < bd) { bd = sc; best = s; }
      }
    }
    if (!best) return 0;
    const ring = site.rings[site.ering[best.e]];
    const gr = rollGroup(ring.mix, HOUR), cs = cast(gr.kind, gr.n);
    const g = allocGroup(); if (g < 0) return 0;
    gKind[g] = gr.kind; gSite[g] = si; gMode[g] = MODE.DOOR_OUT; gE[g] = best.e; gSpot[g] = best.id; best.occ++;
    gSpd[g] = cs.pace; gCur[g] = cs.pace; gT[g] = 0;
    gDir[g] = rnd() < 0.5 ? 1 : -1;
    gS[g] = gDir[g] > 0 ? best.u : site.elen[best.e] - best.u;
    const y = edgeY(site, best.e, best.u);
    // they came out a moment ago: the last one is just through the door
    const fx = eX(site, best.e, best.u, site.ehw[best.e] * 0.5), fz = eZ(site, best.e, best.u, site.ehw[best.e] * 0.5);
    const L = Math.hypot(fx - best.x, fz - best.z) || 0.01, px = (fx - best.x) / L, pz = (fz - best.z) / L;
    gT[g] = Math.min(L, 0.9 * (cs.who.length - 1) + 0.15);
    gX[g] = best.x + px * gT[g]; gZ[g] = best.z + pz * gT[g]; gY[g] = y;
    gFX[g] = gTX[g] = px; gFZ[g] = gTZ[g] = pz;
    let i = 0;
    for (const p of cs.who) {
      const back = Math.max(0, gT[g] - 0.9 * i);
      makeRow(g, best.x + px * back, y, best.z + pz * back, Math.atan2(px, pz), dress(gr.kind, p.fem, p.kid, ring.mix, HOUR), p.kid);
      i++;
    }
    if (!gN[g]) { freeGroup(g); return 0; }
    const ms = members(g, _ms);
    for (let k = 0; k < ms.length; k++) { mLat[ms[k]] = 0; mFwd[ms[k]] = -k * 0.9; mSLat[ms[k]] = 0; mSFwd[ms[k]] = -k * 0.9; }
    pickGoal(g);
    return gN[g];
  }

  function spawnTick(initial) {
    if (!act.n) return;
    let budget = initial ? 4000 : 8, guard = initial ? 6000 : 40;
    while (liveRows < target && budget > 0 && guard-- > 0) {
      const k = sampleEdge(); if (k < 0) break;
      const si = act.s[k], e = act.e[k];
      const site = SITES[si], ring = site.rings[site.ering[e]];
      // the share of people standing: busier in the evening and round night spots
      const pStand = 0.18 + (inH(HOUR, 19, 2) ? 0.1 * (1 + ring.mix.n) : 0) + (inH(HOUR, 11.5, 14) ? 0.06 : 0);
      let n = rnd() < pStand ? spawnStander(si, e, initial) : spawnWalker(si, e, initial);
      if (!n && !initial && rnd() < 0.3) n = spawnFromDoor(si);
      if (n) { liveRows += n; budget--; }
    }
  }

  // ================================================================ goals and routes
  function pickGoal(g) {
    const site = SITES[gSite[g]];
    if (gSpot[g] >= 0 && gMode[g] !== MODE.DOOR_OUT) {
      const old = site.spots[gSpot[g]]; if (old) old.occ = Math.max(0, old.occ - 1);
      gSpot[g] = -1;
    }
    // somewhere busy: an active pavement drawn by its people (so the crowd
    // concentrates where the field says it should)
    for (let t = 0; t < 6; t++) {
      const k = sampleEdge();
      if (k < 0) break;
      if (act.s[k] !== gSite[g]) continue;
      const e = act.e[k];
      // a corner of that pavement (a node: reached exactly on the grid)
      const end = rnd() < 0.5 ? site.ea[e] : site.eb[e];
      const mx = site.nx[end], mz = site.nz[end];
      const d = Math.hypot(mx - gX[g], mz - gZ[g]);
      if ((d < 20 || d > 100) && t < 5) continue;
      gGX[g] = mx; gGZ[g] = mz; gGoalN[g] = end;
      // where the trip ends: a door (going in), a window, a bench, the bus
      // stop, a word with each other outside a shop; else just a street
      if (gMode[g] !== MODE.DOOR_OUT) {
        const u = rnd();
        // (the share that stops tracks the share standing: a street keeps its
        // people at the windows, the benches and the stop at about a fifth)
        const pStop = clamp(0.4 + (0.2 - standShare) * 3, 0.2, 0.75);
        const s = u < 0.22 ? spotNear(site, mx, mz, "door", g) : u < 0.22 + pStop ? spotNear(site, mx, mz, null, g) : null;
        if (s) { gSpot[g] = s.id; s.occ++; gGX[g] = eX(site, s.e, s.u, 0); gGZ[g] = eZ(site, s.e, s.u, 0); gGoalN[g] = site.ea[s.e]; }
      }
      gStall[g] = 0;
      return;
    }
    const n = site.ea[(rnd() * site.nE) | 0];
    gGX[g] = site.nx[n]; gGZ[g] = site.nz[n]; gGoalN[g] = n; gStall[g] = 0;
  }
  // a free spot near (x,z) this group can use: a door, or (type null) a
  // shop front, a bench (one or two of them), the bus stop
  function spotNear(site, x, z, type, g) {
    const C = 48, i0 = Math.floor(x / C), j0 = Math.floor(z / C);
    const n = gN[g], o = (rnd() * 9) | 0;
    for (let c = 0; c < 9; c++) {
      const cc = (o + c) % 9;
      const l = site.sgrid.get(gkey(i0 + (cc % 3) - 1, j0 + ((cc / 3) | 0) - 1)); if (!l) continue;
      const k0 = (rnd() * l.length) | 0;
      for (let t = 0; t < l.length; t++) {
        const s = site.spots[l[(k0 + t) % l.length]];
        if (!s || s.occ >= s.cap) continue;
        if (type) { if (s.type === type) return s; continue; }
        if (s.type === "door") continue;
        if (s.type === "bench" && (n > 2 || (n === 2 && !pairSeat(site, s)) || hasKid(g))) continue;
        if (s.type === "front" && !inH(HOUR, 8, 23)) continue;
        return s;
      }
    }
    return null;
  }
  function hasKid(g) { for (let k = 0; k < GM; k++) { const r = gMem[g * GM + k]; if (r >= 0 && mKid[r]) return true; } return false; }
  /* FLOW FIELDS. Every destination node gets one field: the walking distance
     to it from every node within 420 m (Dijkstra over the pavements and
     crossings, a crossing costing 8 m extra: people prefer staying on their
     side). Every group heading there reads the same field, a few lookups per
     corner, so the city's walkers route round a river, a park or a cut block
     exactly, and the field is shared by everyone with that goal. Kept per
     site in a small LRU (fields are sparse Maps of the few hundred nodes in
     reach). */
  const FIELD_R = 420, FIELD_LRU = 160;
  const _hN = [], _hK = [];
  function heapPush(n, k) {
    let i = _hN.length; _hN.push(n); _hK.push(k);
    while (i > 0) { const p = (i - 1) >> 1; if (_hK[p] <= k) break; _hN[i] = _hN[p]; _hK[i] = _hK[p]; i = p; }
    _hN[i] = n; _hK[i] = k;
  }
  function heapPop() {
    const n = _hN[0], last = _hN.length - 1, ln = _hN[last], lk = _hK[last];
    _hN.pop(); _hK.pop();
    if (last > 0) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        if (a >= last) break;
        const c = b < last && _hK[b] < _hK[a] ? b : a;
        if (_hK[c] >= lk) break;
        _hN[i] = _hN[c]; _hK[i] = _hK[c]; i = c;
      }
      _hN[i] = ln; _hK[i] = lk;
    }
    return n;
  }
  function fieldTo(site, goal) {
    let F = site.fields.get(goal);
    if (F) { site.fields.delete(goal); site.fields.set(goal, F); return F; }
    F = new Map();
    _hN.length = 0; _hK.length = 0;
    F.set(goal, 0); heapPush(goal, 0);
    while (_hN.length) {
      const k0 = _hK[0], n = heapPop();
      if (k0 > F.get(n)) continue;
      if (k0 > FIELD_R) break;
      for (let j = 0; j < 4; j++) {
        const e = site.nadj[n * 4 + j]; if (e < 0) continue;
        const o = other(site, e, n), k = k0 + site.elen[e] + (site.ek[e] === 1 ? 8 : 0);
        const cur = F.get(o);
        if (cur === undefined || k < cur) { F.set(o, k); heapPush(o, k); }
      }
    }
    site.fields.set(goal, F);
    if (site.fields.size > FIELD_LRU) site.fields.delete(site.fields.keys().next().value);
    return F;
  }
  // at node n having arrived by edge eIn: the next edge toward the goal
  function chooseNext(g, n, eIn) {
    const site = SITES[gSite[g]];
    const fleeing = gMode[g] === MODE.FLEE;
    // the pavement with the spot on it, when we are at one of its ends
    if (!fleeing && gSpot[g] >= 0) {
      const sp = site.spots[gSpot[g]];
      if (sp) for (let k = 0; k < 4; k++) if (site.nadj[n * 4 + k] === sp.e) return sp.e;
    }
    const F = !fleeing && gGoalN[g] >= 0 ? fieldTo(site, gGoalN[g]) : null;
    const here = fleeing ? 0 : Math.hypot(site.nx[n] - gGX[g], site.nz[n] - gGZ[g]);
    let best = -1, bs = 1e18, alt = -1, viaField = false;
    for (let k = 0; k < 4; k++) {
      const e = site.nadj[n * 4 + k];
      if (e < 0) continue;
      if (e === eIn) { alt = e; continue; }
      const o = other(site, e, n);
      let sc;
      if (fleeing) sc = -Math.hypot(site.nx[o] - gPX[g], site.nz[o] - gPZ[g]) + rnd() * 4;
      else {
        const f = F ? F.get(o) : undefined;
        if (f !== undefined) { sc = f + site.elen[e] + (site.ek[e] === 1 ? 8 : 0) + rnd() * 3; viaField = true; }
        else sc = 1e6 + Math.hypot(site.nx[o] - gGX[g], site.nz[o] - gGZ[g]) + (site.ek[e] === 1 ? 9 : 0) + rnd() * 5;
      }
      if (sc < bs) { bs = sc; best = e; }
    }
    if (best < 0) best = alt;
    if (!fleeing && !viaField && best >= 0) {
      // out of every field's reach (a far goal): the straight-line fallback, and
      // a new goal if it stops getting closer
      const o = other(site, best, n);
      const d = Math.hypot(site.nx[o] - gGX[g], site.nz[o] - gGZ[g]);
      if (d >= here - 0.5) { if (++gStall[g] > 5) pickGoal(g); } else if (gStall[g] > 0) gStall[g]--;
    }
    return best;
  }

  // ================================================================ the walk signal (traffic.js's clock)
  let xOpen = true, zOpen = true, xSince = -99, zSince = -99, sigOk = false;
  function signalTick() {
    const ph = CBZ.cityPhase ? (function () { try { return CBZ.cityPhase(); } catch (e) { return null; } })() : null;
    if (!ph) { sigOk = false; xOpen = zOpen = true; return; }
    sigOk = true;
    // walking along x crosses the N-S street: walk while N-S is red and E-W green
    const ox = ph.ns === "red" && ph.ew === "green", oz = ph.ew === "red" && ph.ns === "green";
    if (ox && !xOpen) xSince = CLOCK;
    if (oz && !zOpen) zSince = CLOCK;
    xOpen = ox; zOpen = oz;
  }
  function mayCross(axis, waited) {
    if (!sigOk) return waited > 1.2;
    return axis === 1 ? (xOpen && CLOCK - xSince < 2.6) : (zOpen && CLOCK - zSince < 2.6);
  }

  // ================================================================ moving a group
  function anchorOnEdge(g) {
    const site = SITES[gSite[g]], e = gE[g], d = gDir[g];
    // (s < 0: a group that queued back from the kerb starts the crossing from there)
    const L = site.elen[e], s = Math.min(gS[g], L), u = d > 0 ? s : L - s;
    gX[g] = eX(site, e, u, 0); gZ[g] = eZ(site, e, u, 0); gY[g] = edgeY(site, e, clamp(u, 0, L));
    gTX[g] = site.etx[e] * d; gTZ[g] = site.etz[e] * d;
  }
  // the lateral centre that keeps right with this width
  function keepRight(g, w) {
    const hw = curHw(g);
    if (w >= hw) return 0;
    return Math.min(0.45, hw - w);
  }
  function slotTarget(g, r) {
    const fx = gFX[g], fz = gFZ[g], rx = -fz, rz = fx;
    const lat = gLat[g] + mLat[r], fwd = mFwd[r];
    mTX[r] = gX[g] + fx * fwd + rx * lat;
    mTZ[r] = gZ[g] + fz * fwd + rz * lat;
    mTY[r] = gY[g];
  }

  // obstacles and oncoming people on this pavement: the free lane for a group of width w
  const _blk = [];
  function laneFor(g, w, want) {
    const site = SITES[gSite[g]], e = gE[g], d = gDir[g];
    if (!site || e < 0) return want;
    const hw = site.ehw[e], L = site.elen[e];
    const s = gS[g];
    _blk.length = 0;
    // static: lamps, trees, bins, benches (travel frame: v_t = d * v)
    const o0 = site.obsS[e], on = site.obsN[e];
    for (let k = 0; k < on; k++) {
      const su = d > 0 ? site.obsU[o0 + k] : L - site.obsU[o0 + k];
      const ah = su - s;
      if (ah < -1.2 || ah > 3.2) continue;
      const v = d * site.obsV[o0 + k], rr = site.obsR[o0 + k] + 0.32;
      _blk.push(v - rr, v + rr);
    }
    // people standing on it (a chat circle, a queue), and oncoming groups
    let h = site.eHead[e];
    let oncoming = false, slowTo = 1e9;
    while (h >= 0) {
      if (h !== g) {
        const hs = gDir[h] === d ? gS[h] : L - gS[h];
        const ah = hs - s;
        if (gMode[h] === MODE.STAND && gWide[h] > 0) {
          if (ah > -1.5 && ah < 3.5) { const v = gLat[h] * d; _blk.push(v - gWide[h], v + gWide[h]); }
        } else if (gMode[h] === MODE.WALK || gMode[h] === MODE.CROSS) {
          if (gDir[h] !== d) { if (ah > 0 && ah < 7) { oncoming = true; gFileT[h] = Math.max(gFileT[h], 1.2); } }
          else if (ah > 0.3 && ah < 2.6 && gCur[h] < gCur[g]) slowTo = Math.min(slowTo, gCur[h]);
        }
      }
      h = gNxE[h];
    }
    if (oncoming) gFileT[g] = Math.max(gFileT[g], 1.2);
    if (slowTo < 1e9) gCur[g] = Math.min(gCur[g], slowTo + 0.05);
    if (!_blk.length) return want;
    // the free intervals of [-hw, hw] and the nearest one to `want` that fits
    const lo0 = -hw + 0.12, hi0 = hw - 0.12;
    let bestC = want, bestD = 1e9, fits = false, wide = -1, wideC = want;
    // sweep: candidate interval edges
    const cuts = [lo0, hi0];
    for (let i = 0; i < _blk.length; i++) cuts.push(clamp(_blk[i], lo0, hi0));
    cuts.sort(function (a, b) { return a - b; });
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a < 0.05) continue;
      const m = (a + b) / 2;
      let free = true;
      for (let k = 0; k < _blk.length; k += 2) if (m > _blk[k] && m < _blk[k + 1]) { free = false; break; }
      if (!free) continue;
      // grow to the full free run
      let A = a, B = b;
      for (let j = i + 1; j + 1 < cuts.length; j++) { const mm = (cuts[j] + cuts[j + 1]) / 2; let f2 = true; for (let k = 0; k < _blk.length; k += 2) if (mm > _blk[k] && mm < _blk[k + 1]) { f2 = false; break; } if (!f2) break; B = cuts[j + 1]; }
      if (B - A > wide) { wide = B - A; wideC = (A + B) / 2; }
      if (B - A >= 2 * w) {
        const c = clamp(want, A + w, B - w), dd = Math.abs(c - want);
        if (dd < bestD) { bestD = dd; bestC = c; fits = true; }
      }
    }
    if (fits) return bestC;
    gFileT[g] = Math.max(gFileT[g], 0.8);          // no room abreast: single file through the gap
    return wide > 0 ? wideC : want;
  }

  function stepAnchor(g, dt) {
    const site = SITES[gSite[g]];
    let left = gCur[g] * dt;
    let guard = 4;
    while (left > 0 && guard-- > 0) {
      const e = gE[g], L = site.elen[e];
      // the goal spot is on this pavement: stop there
      if (gSpot[g] >= 0 && gMode[g] === MODE.WALK) {
        const sp = site.spots[gSpot[g]];
        if (sp && sp.e === e) {
          const su = gDir[g] > 0 ? sp.u : L - sp.u;
          if (gS[g] <= su && gS[g] + left >= su) { gS[g] = su; anchorOnEdge(g); arriveSpot(g, sp); return; }
        }
      }
      const room = L - gS[g];
      if (left < room) { gS[g] += left; left = 0; break; }
      left -= room; gS[g] = L;
      const n = gDir[g] > 0 ? site.eb[e] : site.ea[e];
      if (gMode[g] === MODE.CROSS) gMode[g] = MODE.WALK;   // over the road: back on the pavement
      // a far-off goal reached: the next one
      if (gSpot[g] < 0 && gMode[g] !== MODE.FLEE && Math.hypot(site.nx[n] - gGX[g], site.nz[n] - gGZ[g]) < 6) pickGoal(g);
      const next = chooseNext(g, n, e);
      if (next < 0) { gDir[g] = -gDir[g]; gS[g] = 0; break; }
      if (site.ek[next] === 1 && gMode[g] !== MODE.FLEE) {
        // the kerb: wait for the walk signal, together
        gMode[g] = MODE.WAIT; gT[g] = 0; gNextE[g] = next;
        gWaitN[g] = n; const q = site.nwait[n]; site.nwait[n] = Math.min(255, q + 1);
        anchorOnEdge(g);
        // queue back from the kerb by the groups already there: back along the
        // crossing's own line, which is the pavement this corner continues
        const back = 0.4 + q * 1.15;
        const o = other(site, next, n);
        const cx = site.nx[o] - site.nx[n], cz = site.nz[o] - site.nz[n], cl = Math.hypot(cx, cz) || 1;
        gTX[g] = cx / cl; gTZ[g] = cz / cl;
        gX[g] = site.nx[n] - gTX[g] * back; gZ[g] = site.nz[n] - gTZ[g] * back;
        gT2[g] = back;
        return;
      }
      gDir[g] = site.ea[next] === n ? 1 : -1;
      gE[g] = next; gS[g] = 0;
      if (site.ek[next] === 1 && gMode[g] !== MODE.FLEE) gMode[g] = MODE.CROSS;   // (fleeing: straight over, still fleeing)
      enterEdge(g, next);
    }
    anchorOnEdge(g);
  }

  // ================================================================ activities
  function arriveSpot(g, sp) {
    if (sp.type === "door" && gKind[g] <= KIND.TEENS) {
      // going in
      gMode[g] = MODE.DOOR_IN; gT[g] = 0;
      return;
    }
    // a walking group stops for a while: what it does there, and who it
    // goes back to being when it walks on
    gKind0[g] = gKind[g] <= KIND.TEENS ? gKind[g] : gKind0[g];
    if (sp.type === "bench") gKind[g] = KIND.BENCH;
    else if (sp.type === "bus") gKind[g] = KIND.BUS;
    else gKind[g] = gN[g] >= 2 && rnd() < 0.7 ? KIND.CHAT : KIND.BROWSE;
    startStand(g, false);
  }
  function startStand(g, spawned) {
    const site = SITES[gSite[g]], sp = site.spots[gSpot[g]];
    gMode[g] = MODE.STAND; gT[g] = 0; gT2[g] = 0;
    const kind = gKind[g];
    // passers-by stop for less time than the people who were there first
    const k = spawned ? 1 : 1.15;
    const dur = k * (kind === KIND.CHAT ? 25 + rnd() * 95 : kind === KIND.QUEUE ? 40 + rnd() * 60 : kind === KIND.SMOKE ? 40 + rnd() * 110
      : kind === KIND.BUS ? 30 + rnd() * 90 : kind === KIND.BENCH ? 40 + rnd() * 160 : 8 + rnd() * 16);
    gT2[g] = dur;
    standLayout(g, sp);
    if (spawned) {
      const ms = members(g, _ms);
      for (const r of ms) { S.x[r] = mTX[r]; S.z[r] = mTZ[r]; S.y[r] = mTY[r]; S.yaw[r] = mFace[r]; }
    }
  }
  // where each member stands for this activity, which way they face, what they do
  function standLayout(g, sp) {
    const site = SITES[gSite[g]], ms = members(g, _ms), n = ms.length, kind = gKind[g];
    const e = sp.e, hw = site.ehw[e];
    const y = edgeY(site, e, sp.u);
    const side = (sp.id & 1) ? 1 : -1;
    gWide[g] = 0; gLat[g] = 0;
    for (let i = 0; i < n; i++) {
      const r = ms[i];
      let x = sp.x, z = sp.z, face = 0, clip = 0, yy = y;
      if (kind === KIND.BENCH && sp.seat) {
        let seat = sp.seat;
        if (i === 1) { const t = pairSeat(site, sp); if (t) seat = t.seat; }
        x = seat.x; z = seat.z; yy = (seat.y || y) + 0.45; face = seat.face || 0; clip = 4;
      } else if (kind === KIND.BUS) {
        const u = clamp(sp.u + (i - (n - 1) / 2) * 1.1 + (rnd() - 0.5) * 0.4, 0.3, site.elen[e] - 0.3), v = -hw * 0.45;
        x = eX(site, e, u, v); z = eZ(site, e, u, v);
        face = Math.atan2(site.etz[e], -site.etx[e]);          // toward the road (-v)
        clip = rnd() < 0.3 ? 2 : 0;
        gWide[g] = 0.45; gLat[g] = v;
      } else if (sp.type === "door") {
        const ex = sp.ex, ez = sp.ez, tx = sp.tx * side, tz = sp.tz * side;
        if (kind === KIND.CHAT) {
          const out = clamp(sp.kd * 0.45, 1.2, 1.8), cx = sp.x + ex * out + tx * 1.7, cz = sp.z + ez * out + tz * 1.7;
          const rr = Math.min(0.5 + 0.07 * n, out - 0.4), th = (rnd() * TAU) + i * TAU / n;
          x = cx + Math.cos(th) * rr; z = cz + Math.sin(th) * rr; face = Math.atan2(cx - x, cz - z); clip = 1;
        } else if (kind === KIND.QUEUE) {
          x = sp.x + ex * 0.75 + tx * (1.0 + i * 0.78); z = sp.z + ez * 0.75 + tz * (1.0 + i * 0.78);
          face = Math.atan2(-tx, -tz); clip = rnd() < 0.3 ? 2 : 0;
        } else if (kind === KIND.SMOKE) {
          x = sp.x + ex * 0.55 + tx * (1.9 + i * 0.75); z = sp.z + ez * 0.55 + tz * (1.9 + i * 0.75);
          face = Math.atan2(ex + tx * (i & 1 ? 0.8 : -0.8), ez + tz * (i & 1 ? 0.8 : -0.8)); clip = i === 1 ? 1 : 3;
        } else {
          x = sp.x + ex * 0.6 + tx * (2.4 + i * 0.6); z = sp.z + ez * 0.6 + tz * (2.4 + i * 0.6);
          face = Math.atan2(-ex, -ez); clip = 0;
        }
      } else {
        // a shop front on the pavement: building at +v
        const room = hw;
        if (kind === KIND.CHAT) {
          const rr = Math.min(0.5 + 0.07 * n, Math.max(0.42, room - 0.45)), vc = hw - rr - 0.25;
          const cx = eX(site, e, sp.u, vc), cz = eZ(site, e, sp.u, vc), th = (rnd() * TAU) + i * TAU / n;
          x = cx + Math.cos(th) * rr; z = cz + Math.sin(th) * rr; face = Math.atan2(cx - x, cz - z); clip = 1;
          gWide[g] = rr + 0.35; gLat[g] = vc;
        } else if (kind === KIND.SMOKE) {
          const v = hw - 0.3, u = clamp(sp.u + i * 0.8, 0.3, site.elen[e] - 0.3);
          x = eX(site, e, u, v); z = eZ(site, e, u, v); face = Math.atan2(site.etz[e], -site.etx[e]) + (i ? 0.9 : -0.9); clip = i === 1 ? 1 : 3;
          gWide[g] = 0.4; gLat[g] = v;
        } else {
          const v = hw - 0.28, u = clamp(sp.u + i * 0.62, 0.3, site.elen[e] - 0.3);
          x = eX(site, e, u, v); z = eZ(site, e, u, v); face = Math.atan2(-site.etz[e], site.etx[e]); clip = 0;
          gWide[g] = 0.35; gLat[g] = v;
        }
      }
      mTX[r] = x; mTZ[r] = z; mTY[r] = yy; mFace[r] = face; mStand[r] = clip;
    }
    gX[g] = sp.x; gZ[g] = sp.z; gY[g] = y;
  }
  // done standing: walk on together from the spot's pavement
  function rejoin(g) {
    const site = SITES[gSite[g]];
    let e = gE[g], u = 0;
    if (gSpot[g] >= 0) {
      const sp = site.spots[gSpot[g]];
      if (sp) { e = sp.e; u = sp.u; sp.occ = Math.max(0, sp.occ - 1); }
      gSpot[g] = -1;
    } else if (e >= 0) {
      const q = project(site, e, gX[g], gZ[g]); u = clamp(q.u, 0, site.elen[e]);
    }
    if (e < 0) { const q = nearestSide(site, gX[g], gZ[g], 30); if (!q) return false; e = q.e; u = q.u; }
    if (site.ek[e] === 1) { const q = nearestSide(site, gX[g], gZ[g], 30); if (q) { e = q.e; u = q.u; } }
    gE[g] = e; gDir[g] = rnd() < 0.5 ? 1 : -1; gS[g] = gDir[g] > 0 ? u : site.elen[e] - u;
    gMode[g] = MODE.WALK; gWide[g] = 0;
    if (gKind[g] > KIND.TEENS) gKind[g] = gKind0[g] >= 0 && gKind0[g] <= KIND.TEENS && (gN[g] > 1 || gKind0[g] === KIND.SOLO) ? gKind0[g] : (gN[g] > 1 ? KIND.FRIENDS : KIND.SOLO);
    gKind0[g] = -1; gGoalN[g] = -1;
    enterEdge(g, e);
    anchorOnEdge(g);
    pickGoal(g);
    const w = formation(g);
    gLat[g] = keepRight(g, w);
    gFX[g] = gTX[g]; gFZ[g] = gTZ[g];
    // the slots start where each one is standing and ease into the walking
    // formation: they gather as they set off, nobody is teleported to a slot
    const ms = members(g, _ms), fx = gFX[g], fz = gFZ[g];
    for (const r of ms) {
      mStand[r] = 0;
      const dx = S.x[r] - gX[g], dz = S.z[r] - gZ[g];
      mFwd[r] = dx * fx + dz * fz; mLat[r] = dx * -fz + dz * fx - gLat[g];
    }
    return true;
  }

  // ================================================================ despawn
  function removeRow(r) {
    if (mRig[r] >= 0) unpromote(r, true);
    if (mG[r] >= 0) dropMember(r);
    const G = storeGroup();
    if (G && S.life[r] === ST.ALIVE && S.grp[r] === G.ix) G.remove(r);
  }
  function removeGroup(g) {
    const ms = members(g, _ms2);
    for (const r of ms) removeRow(r);
    if (gUsed[g]) freeGroup(g);
  }

  // ================================================================ the group step
  function tickGroup(g, dt) {
    const site = SITES[gSite[g]];
    if (!site) { removeGroup(g); return; }
    const ms = members(g, _ms);
    // panic: a member the store set running (a shot, a blast, a car) runs the group
    let panicR = -1;
    for (const r of ms) if (S.panicT[r] > 0 && S.life[r] === ST.ALIVE) { panicR = r; break; }
    if (panicR >= 0 && gMode[g] !== MODE.FLEE) startFlee(g, S.fleeX[panicR], S.fleeZ[panicR]);
    if (gFileT[g] > 0) gFileT[g] -= dt;
    gCur[g] += (gSpd[g] - gCur[g]) * Math.min(1, dt * 1.5);
    const mode = gMode[g];
    if (mode === MODE.WALK || mode === MODE.CROSS || mode === MODE.FLEE) {
      if (mode === MODE.FLEE) {
        let any = false;
        for (const r of ms) if (S.panicT[r] > 0) { any = true; break; }
        if (!any) { gMode[g] = MODE.WALK; gSpd[g] = gT2[g] || gSpd[g]; pickGoal(g); }
        gCur[g] = 3.7;
      } else if (mode === MODE.CROSS) gCur[g] = Math.max(gCur[g], Math.max(gSpd[g] * 1.25, 1.6));
      // wait for whoever is behind (members far from their slots)
      let lag = 0;
      lag = lagOf(ms);
      const w = formation(g);
      const want = keepRight(g, w);
      const lane = gE[g] >= 0 && site.ek[gE[g]] === 0 ? laneFor(g, w, want) : want;
      if (mode !== MODE.FLEE) {
        if (lag > 1.1) gCur[g] = 0; else if (lag > 0.7) gCur[g] *= 0.4;
      }
      gLat[g] += clamp(lane - gLat[g], -1.2 * dt, 1.2 * dt);
      stepAnchor(g, dt);
    } else if (mode === MODE.WAIT) {
      gT[g] += dt;
      const e2 = gNextE[g];
      // stragglers first, then the signal
      let lag = 0;
      lag = lagOf(ms);
      if (lag < 1.2 && mayCross(site.eaxis[e2], gT[g])) {
        const from = gWaitN[g] >= 0 ? gWaitN[g] : nodeAt(g);
        unwait(g);
        gDir[g] = site.ea[e2] === from ? 1 : -1;
        gE[g] = e2; gS[g] = -(gT2[g] || 0); gMode[g] = MODE.CROSS;
        enterEdge(g, e2);
        anchorOnEdge(g);
      } else if (gT[g] > 40) {
        // given up on this corner: go round the block instead
        unwait(g);
        gMode[g] = MODE.WALK; gDir[g] = -gDir[g]; gS[g] = 0; anchorOnEdge(g); pickGoal(g);
      }
      formation(g);
    } else if (mode === MODE.STAND || mode === MODE.HELP) {
      gT[g] += dt;
      if (gKind[g] === KIND.QUEUE && mode === MODE.STAND) {
        // the front of the line goes in every so often; the rest shuffle up
        if (gT[g] > 9 + (gSer[g] % 7)) {
          gT[g] = 0;
          const front = ms[0];
          if (front >= 0 && ms.length > 1 && mRig[front] < 0) { removeRow(front); if (!gUsed[g]) return; standLayout(g, site.spots[gSpot[g]]); return; }
        }
      }
      if (mode === MODE.STAND && gKind[g] === KIND.CHAT) {
        // one speaks at a time
        gTalkT[g] -= dt;
        if (gTalkT[g] <= 0) { gTalkT[g] = 2.5 + rnd() * 4; gTalk[g] = (gTalk[g] + 1 + ((rnd() * 2) | 0)) % Math.max(1, ms.length); }
        for (let i = 0; i < ms.length; i++) mStand[ms[i]] = i === gTalk[g] ? 1 : 0;
      }
      if (mode === MODE.STAND && gT[g] > gT2[g]) {
        const sp = gSpot[g] >= 0 ? site.spots[gSpot[g]] : null;
        const kind = gKind[g];
        if (kind === KIND.SMOKE && sp && sp.type === "door") { gMode[g] = MODE.DOOR_IN; gT[g] = 1e3; }   // break over: back inside
        else if (kind === KIND.BUS && sp && ms.every(function (r) { return mRig[r] < 0 && hidden(S.x[r], S.z[r]); })) { removeGroup(g); return; }
        else if (!rejoin(g)) { removeGroup(g); return; }
      }
      if (mode === MODE.HELP && gT[g] > gT2[g]) { if (!rejoin(g)) { removeGroup(g); return; } }
    } else if (mode === MODE.DOOR_IN || mode === MODE.DOOR_OUT) {
      const sp = site.spots[gSpot[g]];
      if (!sp) { removeGroup(g); return; }
      gT[g] += dt * gCur[g];
      const fx = eX(site, sp.e, sp.u, site.ehw[sp.e] * 0.5), fz = eZ(site, sp.e, sp.u, site.ehw[sp.e] * 0.5);
      const L = Math.hypot(sp.x - fx, sp.z - fz) || 0.01;
      const t = clamp(gT[g] / L, 0, 1);
      const px = (sp.x - fx) / L, pz = (sp.z - fz) / L;
      if (mode === MODE.DOOR_IN) {
        gX[g] = fx + (sp.x - fx) * t; gZ[g] = fz + (sp.z - fz) * t; gTX[g] = px; gTZ[g] = pz;
        // each one goes in at the door
        for (const r of ms) if (Math.hypot(S.x[r] - sp.x, S.z[r] - sp.z) < 0.4) removeRow(r);
        if (!gUsed[g]) return;
      } else {
        gX[g] = sp.x + (fx - sp.x) * t; gZ[g] = sp.z + (fz - sp.z) * t; gTX[g] = -px; gTZ[g] = -pz;
        if (t >= 1) {
          sp.occ = Math.max(0, sp.occ - 1);
          gSpot[g] = -1;
          const L2 = site.elen[sp.e];
          gE[g] = sp.e; gS[g] = gDir[g] > 0 ? sp.u : L2 - sp.u; gMode[g] = MODE.WALK;
          enterEdge(g, sp.e); anchorOnEdge(g);
        }
      }
      gY[g] = edgeY(site, sp.e, sp.u);
      gLat[g] = 0;
      for (let i = 0; i < ms.length; i++) { mSLat[ms[i]] = 0; mSFwd[ms[i]] = -i * 0.9; }
    }
    moveMembers(g, ms, dt);
  }
  // how far behind its slot the slowest member is (a real body held up by
  // the world past 4 m is left to catch up on its own: never a stuck group)
  function lagOf(ms) {
    let lag = 0;
    for (const r of ms) {
      const d = Math.hypot(S.x[r] - mTX[r], S.z[r] - mTZ[r]);
      if (mRig[r] >= 0 && d > 4) continue;
      if (d > lag) lag = d;
    }
    return lag;
  }
  function nodeAt(g) {
    const site = SITES[gSite[g]], e = gE[g];
    return gDir[g] > 0 ? site.eb[e] : site.ea[e];
  }
  function startFlee(g, fx, fz) {
    unwait(g);
    if (gMode[g] === MODE.STAND || gMode[g] === MODE.HELP || gMode[g] === MODE.DOOR_IN || gMode[g] === MODE.DOOR_OUT) {
      const keep = gSpd[g];
      if (!rejoin(g)) return;
      gSpd[g] = keep;
    }
    gT2[g] = gSpd[g];
    gMode[g] = MODE.FLEE; gPX[g] = fx; gPZ[g] = fz;
    const site = SITES[gSite[g]], e = gE[g];
    if (e >= 0) {
      // run the way that leads away
      const a = site.ea[e], b = site.eb[e];
      const da = Math.hypot(site.nx[a] - fx, site.nz[a] - fz), db = Math.hypot(site.nx[b] - fx, site.nz[b] - fz);
      const want = db >= da ? 1 : -1;
      if (want !== gDir[g]) { gS[g] = site.elen[e] - gS[g]; gDir[g] = want; }
    }
    const ms = members(g, _ms);
    for (const r of ms) mStand[r] = 0;
  }

  // the formation turns a corner over a moment (2.4 rad/s), not in a frame:
  // the outside of a row of four swings round instead of jumping
  function turnFormation(g, dt) {
    const a = Math.atan2(gFX[g], gFZ[g]), b = Math.atan2(gTX[g], gTZ[g]);
    let d = b - a;
    d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const k = a + clamp(d, -2.0 * dt, 2.0 * dt);
    gFX[g] = Math.sin(k); gFZ[g] = Math.cos(k);
  }
  // every member toward its slot (walking) or its spot (standing)
  function moveMembers(g, ms, dt) {
    const C = clips(), mode = gMode[g];
    turnFormation(g, dt);
    const standing = mode === MODE.STAND || mode === MODE.HELP || mode === MODE.WAIT;
    const flee = mode === MODE.FLEE;
    const tnow = stamp();
    // the talker in a walking group changes every few seconds
    if (!standing && ms.length > 1) { gTalkT[g] -= dt; if (gTalkT[g] <= 0) { gTalkT[g] = 4 + rnd() * 6; gTalk[g] = rnd() < 0.3 ? 255 : (rnd() * ms.length) | 0; } }
    for (let i = 0; i < ms.length; i++) {
      const r = ms[i];
      if (S.life[r] !== ST.ALIVE) continue;
      if (!(mode === MODE.STAND || mode === MODE.HELP)) {
        // formation slots ease (a file opening out after a lamp post)
        const k = 1.4 * dt;
        mLat[r] += clamp(mSLat[r] - mLat[r], -k, k);
        mFwd[r] += clamp(mSFwd[r] - mFwd[r], -k, k);
        slotTarget(g, r);
        if (mode === MODE.WAIT) mFace[r] = Math.atan2(gFX[g], gFZ[g]);
      }
      if (mRig[r] >= 0) { rigFollow(r, g, dt); continue; }
      let tx = mTX[r], tz = mTZ[r];
      const dx = tx - S.x[r], dz = tz - S.z[r], d = Math.hypot(dx, dz);
      const vmax = flee ? 4.4 : (standing ? 1.3 : Math.max(gCur[g], gSpd[g]) * 1.7 + 0.5);
      let vx = 0, vz = 0;
      if (d > 0.02) {
        const step = Math.min(d, vmax * dt);
        vx = dx / d * step / Math.max(dt, 1e-3); vz = dz / d * step / Math.max(dt, 1e-3);
        S.x[r] += dx / d * step; S.z[r] += dz / d * step;
      }
      S.y[r] += (mTY[r] - S.y[r]) * Math.min(1, dt * 6);
      const sp = Math.hypot(vx, vz);
      // a body ahead of its slot still walks: carry the group's pace
      let moving = sp > 0.25 || (!standing && gCur[g] > 0.2 && d < 0.5);
      let speed = moving ? Math.max(sp, standing ? 0 : gCur[g]) : 0;
      if (moving && sp < 0.25) { vx = gFX[g] * gCur[g]; vz = gFZ[g] * gCur[g]; }
      S.vx[r] = moving ? vx : 0; S.vz[r] = moving ? vz : 0;
      // heading: the way the body moves, else the way it was told to face
      let yawT;
      if (moving && speed > 0.3) yawT = Math.atan2(vx, vz);
      else yawT = standing ? mFace[r] : Math.atan2(gFX[g], gFZ[g]);
      let dy = yawT - S.yaw[r];
      dy = ((dy + Math.PI) % TAU + TAU) % TAU - Math.PI;
      S.yaw[r] += clamp(dy, -6 * dt, 6 * dt);
      // the clip
      const scale = S.scale[r] || 1;
      if (moving && speed > 0.25) {
        let clip = flee ? C.run : C.walk;
        if (!flee) {
          if (mPhone[r]) clip = C.phoneWalk;
          else if (ms.length > 1 && gTalk[g] === i && !mKid[r]) clip = C.talkWalk;
        }
        const rate = speed * (C.rpm[clip] || 4.4) / (TAU * scale);
        if (S.clip[r] !== clip) S.clip[r] = clip;
        S.rate[r] = rate;
        S.phase[r] = ((S.phase[r] + rate * dt) % 1 + 1) % 1;
      } else {
        const want = STAND_CLIP[mStand[r]] || "idle";
        let clip = C[want] != null ? C[want] : C.idle;
        if (mode === MODE.WAIT && mPhone[r]) clip = C.phone;
        const per = C.period[clip] || 4;
        S.clip[r] = clip; S.rate[r] = 1 / per;
        S.phase[r] = ((S.phase[r] + dt / per) % 1 + 1) % 1;
      }
      S.pnow[r] = 1; S.posT[r] = tnow;
    }

  }

  // ================================================================ PROMOTION: the nearest few are real
  const PARK = -4000;
  const POOL = [];          // {ped, build: "m"|"f"|"kid", row, g, gs, hp0, ko0, dead0}
  let prewarm = 0, poolReady = false;
  function wantPool() {
    let m = 0, f = 0, k = 0;
    for (const e of POOL) if (e.ped) { if (e.build === "kid") k++; else if (e.build === "f") f++; else m++; }
    if (m < Math.ceil(BUD.rigs / 2)) return "m";
    if (f < Math.floor(BUD.rigs / 2)) return "f";
    if (k < BUD.kids) return "kid";
    return null;
  }
  function makePooled(build) {
    const A = arena();
    if (!A || !A.root || !CBZ.cityMakePed || !CBZ.cityPeds) return null;
    let ped = null;
    try {
      const opts = { kind: "civilian", gender: build === "f" ? "f" : build === "kid" ? (rnd() < 0.5 ? "f" : "m") : "m" };
      if (build === "kid") opts.age = 6 + ((rnd() * 6) | 0);
      ped = CBZ.cityMakePed(PARK, PARK, rnd, opts);
    } catch (e) { ped = null; }
    if (!ped) return null;
    ped._crowd = true; ped._parked = true; ped._street = true; ped.group.visible = false;
    ped.pos.set(PARK, 0, PARK); if (ped.target) ped.target.set(PARK, 0, PARK);
    A.root.add(ped.group);
    CBZ.cityPeds.push(ped);
    return ped;
  }
  function prewarmTick() {
    if (poolReady) return;
    if (CBZ.net && CBZ.net.noSim && CBZ.net.noSim()) return;
    let made = 0;
    while (made < 2) {
      const want = wantPool();
      if (!want) { poolReady = true; return; }
      const ped = makePooled(want);
      if (!ped) return;
      let slot = -1;
      for (let i = 0; i < POOL.length; i++) if (!POOL[i].ped) { slot = i; break; }
      const ent = { ped: ped, build: want, row: -1, g: -1, gs: 0, hp0: null, ko0: false, dead0: false };
      if (slot >= 0) POOL[slot] = ent; else POOL.push(ent);
      made++;
    }
  }
  function busy(ped) {
    if (!ped || ped.dead || (ped.ko || 0) > 0) return true;
    const s = ped.state;
    if (s && s !== "walk" && s !== "idle" && s !== "chat") return true;
    return !!(ped.rage || ped.controlled || ped.companion || ped.recruited || ped.restraint || ped.inCar || ped.enterT > 0 ||
      ped._clubLine || ped._clubGoingIn || (ped.poseCower || 0) > 0 || ped.surrender || (ped.alarmed || 0) > 3.5 || ped.vendor);
  }
  function paintRig(ped, look) {
    const ch = ped.char; if (!ch) return;
    const C = CBZ.crowdGPU, L = C && C.lookOf ? C.lookOf(look) : null;
    if (!L) return;
    if (ch._clothesKey != null && CBZ.cityApplyClothes) { try { CBZ.cityApplyClothes(ch, null); } catch (e) {} }
    if (ch._bandana && CBZ.cityAttachBandana) { try { CBZ.cityAttachBandana(ch, null); } catch (e) {} }
    const Rg = CBZ.human && CBZ.human.regions ? CBZ.human.regions(ch) : null;
    if (Rg && CBZ.paintMesh) {
      for (const m of Rg.head || []) CBZ.paintMesh(m, L.skin);
      for (const m of Rg.hands || []) CBZ.paintMesh(m, L.skin);
    }
    C.dressRig(ch, look);
    ped.outfit = L.shirt;
  }
  function assign(ent, r) {
    const ped = ent.ped, g = mG[r];
    ent.row = r; ent.g = g; ent.gs = g >= 0 ? gSer[g] : 0;
    mRig[r] = POOL.indexOf(ent);
    ped._parked = false; ped.dead = false; ped.deadT = 0; ped.ko = 0; ped.culled = false; ped.collected = false; ped.needsPickup = false;
    if (ped.maxHp) ped.hp = ped.maxHp;
    if (CBZ.vitals && CBZ.vitals.reset) { try { CBZ.vitals.reset(ped); } catch (e) {} }
    if (CBZ.woundsForget) { try { CBZ.woundsForget(ped); } catch (e) {} }
    ped.pos.set(S.x[r], S.y[r], S.z[r]);
    ped.group.rotation.y = S.yaw[r];
    // a new ordinary person (no role from the rig's last life; level.js deals one)
    ped.archetype = "resident"; ped.job = null; ped.gang = null; ped.vendor = null; ped.vagrant = false;
    ped.bounty = 0; ped.bountyTag = null; ped._castFit = null; ped._wornOutfit = null; ped._dayCast = null; ped._role = null; ped._work = null;
    ped.rage = null; ped.mem = null; ped.alarmed = 0; ped.fear = 0; ped.surrender = false;
    ped.state = "walk"; ped.path = null; ped.finalGoal = null; ped.pause = 0;
    if (ped.target) ped.target.set(S.x[r] + Math.sin(S.yaw[r]) * 4, 0, S.z[r] + Math.cos(S.yaw[r]) * 4);
    const sp = Math.hypot(S.vx[r], S.vz[r]);
    if (CBZ.moves && CBZ.moves.motor) {
      try { const mv = CBZ.moves.motor(ped); CBZ.moves.reset(mv, ped.pos); mv.vx = S.vx[r]; mv.vz = S.vz[r]; mv.speed = sp; mv.yaw = S.yaw[r]; } catch (e) {}
    }
    paintRig(ped, S.look[r]);
    if (CBZ.setCharPose && ped.char) CBZ.setCharPose(ped.char, "stand");
    ped._streetRow = r;
    ent.hp0 = ped.hp; ent.ko0 = false; ent.dead0 = false;
    ped.group.visible = true;
    S.hide[r] = 1;
    clique(g);
  }
  // the group IS a clique: the shared brain reads friends by it
  function clique(g) {
    if (g < 0 || !gUsed[g]) return;
    const ms = members(g, _ms2), peds = [];
    for (const r of ms) if (mRig[r] >= 0 && POOL[mRig[r]] && POOL[mRig[r]].ped) peds.push(POOL[mRig[r]].ped);
    for (const p of peds) {
      if (peds.length > 1) { p.cliqueId = "street" + gSer[g]; p.friends = peds.filter(function (q) { return q !== p; }); }
      else { p.cliqueId = null; p.friends = null; }
    }
  }
  function unpromote(r, keepRow) {
    const k = mRig[r]; if (k < 0) return;
    mRig[r] = -1;
    const ent = POOL[k];
    const g = ent ? ent.g : -1;
    if (ent) {
      const ped = ent.ped;
      ent.row = -1; ent.g = -1;
      if (ped && !ped.dead) {
        if (keepRow && S.life[r] === ST.ALIVE) {
          S.x[r] = ped.pos.x; S.z[r] = ped.pos.z; S.yaw[r] = ped.group.rotation.y;
          S.vx[r] = 0; S.vz[r] = 0; S.posT[r] = stamp();
        }
        if (CBZ.cityPedStash) { try { CBZ.cityPedStash(ped); } catch (e) {} }
        ped._parked = true; ped.group.visible = false; ped.moveOrder = null;
        ped.pos.set(PARK, 0, PARK); if (ped.target) ped.target.set(PARK, 0, PARK);
        ped.rage = null; ped.mem = null; ped.state = "walk"; ped.path = null; ped.finalGoal = null;
        ped.cliqueId = null; ped.friends = null; ped._streetRow = -1;
        if (CBZ.setCharPose && ped.char) CBZ.setCharPose(ped.char, "stand");
      } else if (ped) {
        // a body is the world's (the corpse law): the slot gets a new rig later
        ent.ped = null; poolReady = false;
      }
    }
    if (S.life[r] === ST.ALIVE) S.hide[r] = 0;
    if (g >= 0) clique(g);
  }
  // a promoted member: the rig walks to the row's slot (CBZ.moves through peds.js)
  function rigFollow(r, g, dt) {
    const ent = POOL[mRig[r]], ped = ent && ent.ped;
    if (!ped) { mRig[r] = -1; S.hide[r] = 0; return; }
    S.x[r] = ped.pos.x; S.z[r] = ped.pos.z; S.y[r] = ped.pos.y || S.y[r];
    S.yaw[r] = ped.group.rotation.y; S.vx[r] = 0; S.vz[r] = 0; S.posT[r] = stamp();
    if (busy(ped)) { detach(r); return; }
    const standing = gMode[g] === MODE.STAND || gMode[g] === MODE.HELP || gMode[g] === MODE.WAIT;
    const dx = mTX[r] - ped.pos.x, dz = mTZ[r] - ped.pos.z, d = Math.hypot(dx, dz);
    let ox = mTX[r], oz = mTZ[r], speed = 0;
    if (standing) {
      speed = d > 0.35 ? 1.3 : 0;
      if (d <= 0.35) { ox = ped.pos.x; oz = ped.pos.z; }
    } else {
      // aim a stride ahead along the way so the body carries on walking, at
      // the group's pace plus what closes the gap to its slot (behind: a
      // little faster; ahead: a little slower)
      const along = dx * gFX[g] + dz * gFZ[g];
      if (gMode[g] === MODE.FLEE) { ox += gFX[g] * 1.5; oz += gFZ[g] * 1.5; speed = 4; }
      else if (gCur[g] < 0.25 || along < -0.3 || d > 1.5) speed = clamp(0.9 + d * 0.5, 0.6, 2.4);   // to the slot itself
      else { ox += gFX[g] * 1.2; oz += gFZ[g] * 1.2; speed = clamp(gCur[g] + along * 0.9, 0.3, 2.4); }
    }
    const now = CBZ.now || 0;
    let o = ped.moveOrder;
    if (!o || !o._street) o = ped.moveOrder = { _street: true, x: 0, z: 0, speed: 0, stop: 0.3, face: undefined, t: 0 };
    o.x = ox; o.z = oz; o.speed = speed; o.stop = standing ? 0.25 : 0.2; o.t = now;
    o.face = standing && d <= 0.35 ? mFace[r] : undefined;
    // the activity's gesture on the real body
    if (CBZ.setCharPose && ped.char) {
      const want = standing && d <= 0.5 ? (mStand[r] === 1 ? "talk" : mStand[r] === 2 ? "phone" : mStand[r] === 3 ? "smoke" : "stand") : "stand";
      if (ped._streetPose !== want) { ped._streetPose = want; CBZ.setCharPose(ped.char, want); }
    }
  }
  // a promoted body the brain has taken (it fled, it fights, it was hit):
  // it leaves the group (still its friends' clique) and is its own person
  function detach(r) {
    const k = mRig[r], ent = POOL[k];
    if (ent && ent.ped && ent.ped.moveOrder && ent.ped.moveOrder._street) ent.ped.moveOrder = null;
    if (ent && ent.ped && CBZ.setCharPose && ent.ped.char && ent.ped._streetPose && ent.ped._streetPose !== "stand") { ent.ped._streetPose = "stand"; CBZ.setCharPose(ent.ped.char, "stand"); }
    if (mG[r] >= 0) { mG[r] = -1; const g = ent ? ent.g : -1; if (g >= 0 && gUsed[g]) { for (let i = 0; i < GM; i++) if (gMem[g * GM + i] === r) { gMem[g * GM + i] = -1; gN[g]--; } if (gN[g] <= 0) freeGroup(g); } }
  }
  let promoT = 0;
  function promoteTick() {
    if (CBZ.net && CBZ.net.noSim && CBZ.net.noSim()) return;
    const P = playerPos(); if (!P) return;
    const driving = !!(CBZ.player && CBZ.player.driving);
    const rin = driving ? 9 : BUD.promoIn, rout = driving ? 16 : BUD.promoOut;
    // reconcile + release
    for (let k = 0; k < POOL.length; k++) {
      const ent = POOL[k];
      if (!ent || ent.row < 0) continue;
      const r = ent.row, ped = ent.ped;
      if (!ped) { mRig[r] = -1; ent.row = -1; continue; }
      harmCheck(ent);
      if (ped.dead) {
        // the count is the crowd's, the body is the rig's
        // (noted while still marked promoted: cityKillPed already counted him)
        S.x[r] = ped.pos.x; S.z[r] = ped.pos.z;
        if (S.life[r] === ST.ALIVE) { try { ST.noteDead(r, null, {}); } catch (e) {} }
        if (mG[r] >= 0) dropMember(r);
        mRig[r] = -1; ent.row = -1;
        S.hide[r] = 1;
        ent.ped = null; poolReady = false;
        continue;
      }
      const d = Math.hypot(ped.pos.x - P.x, ped.pos.z - P.z);
      if (mG[r] < 0) {
        // detached: back in the street when calm and out of the ring
        if (!busy(ped) && d > rout) reattach(r, ent);
        else if (d > R * 0.7 && !inCustody(ped)) removeRow(r);   // ran off for good: the rig goes back to the pool
        continue;
      }
      if (d > rout && G_()._citySpecTarget !== ped) unpromote(r, true);   // (your killer stays real for the kill-cam)
    }
    if (G_().mode !== "city") return;
    // promote: the nearest, a whole group at a time
    const G = GS; if (!G || !poolReady && !freeAny()) return;
    let made = 0;
    const cand = _cand; cand.length = 0;
    const L = G.rows;
    for (let k = 0; k < L.length; k++) {
      const r = L[k];
      if (mG[r] < 0 || mRig[r] >= 0 || S.life[r] !== ST.ALIVE || S.hide[r]) continue;
      if (mStand[r] === 4) continue;                      // the seated stay seated
      const dx = S.x[r] - P.x, dz = S.z[r] - P.z, d2 = dx * dx + dz * dz;
      if (d2 < rin * rin) cand.push(r, d2);
    }
    if (!cand.length) return;
    const idx = _idx; idx.length = 0;
    for (let i = 0; i < cand.length; i += 2) idx.push(i);
    idx.sort(function (a, b) { return cand[a + 1] - cand[b + 1]; });
    for (let q = 0; q < idx.length && made < 4; q++) {
      const r0 = cand[idx[q]];
      if (mRig[r0] >= 0 || mG[r0] < 0) continue;
      const ms = members(mG[r0], _ms2).slice();
      for (const r of ms) {
        if (mRig[r] >= 0 || S.life[r] !== ST.ALIVE || mStand[r] === 4) continue;
        const ent = freeEntry(mKid[r] ? "kid" : bodyOf(r));
        if (!ent) continue;
        assign(ent, r); made++;
      }
    }
  }
  const _cand = [], _idx = [];
  function inCustody(ped) { return !!(ped && (ped.restraint || (ped._custody && !ped._custodyExit))); }
  // a row made real at once (crowds.realize): its own rig if it has one, else
  // the first free one of its build
  function promoteNow(r) {
    if (mRig[r] >= 0) { const e = POOL[mRig[r]]; return e && e.ped && !e.ped.dead ? e.ped : null; }
    if (S.life[r] !== ST.ALIVE || mStand[r] === 4 || (CBZ.net && CBZ.net.noSim && CBZ.net.noSim())) return null;
    const ent = freeEntry(mKid[r] ? "kid" : bodyOf(r));
    if (!ent) return null;
    assign(ent, r);
    return ent.ped;
  }
  // TAKEN INTO CUSTODY (city/custody.js): his street row is consumed and the
  // pool slot gets a new rig later; the old rig is the caller's to take away
  function retire(ped) {
    for (const ent of POOL) {
      if (!ent || ent.ped !== ped) continue;
      const r = ent.row;
      if (r >= 0) {
        mRig[r] = -1;
        if (mG[r] >= 0) dropMember(r);
        if (GS && S.grp[r] === GS.ix && S.life[r] === ST.ALIVE) GS.remove(r);
      }
      ent.row = -1; ent.g = -1; ent.ped = null; poolReady = false;
      return true;
    }
    return false;
  }
  function freeAny() { for (const e of POOL) if (e.ped && e.row < 0) return true; return false; }
  function bodyOf(r) {
    const C = CBZ.crowdGPU, L = C && C.lookOf ? C.lookOf(S.look[r]) : null;
    return L && L.build === "f" ? "f" : "m";
  }
  function freeEntry(build) {
    for (const e of POOL) if (e.ped && e.row < 0 && e.build === build) return e;
    return null;
  }
  // a detached rig hands back to the street: a solo walker on the nearest pavement
  function reattach(r, ent) {
    const ped = ent.ped;
    let si = -1, q = null;
    for (let i = 0; i < SITES.length && !q; i++) { if (!SITES[i]) continue; q = nearestSide(SITES[i], ped.pos.x, ped.pos.z, 14); if (q) si = i; }
    if (!q || S.life[r] !== ST.ALIVE) return;
    const g = allocGroup(); if (g < 0) return;
    gKind[g] = KIND.SOLO; gSite[g] = si; gMode[g] = MODE.WALK; gE[g] = q.e; gDir[g] = rnd() < 0.5 ? 1 : -1;
    gS[g] = gDir[g] > 0 ? q.u : SITES[si].elen[q.e] - q.u; gSpd[g] = 1.25; gCur[g] = 1.25;
    addMember(g, r);
    enterEdge(g, q.e); anchorOnEdge(g); pickGoal(g);
    gFX[g] = gTX[g]; gFZ[g] = gTZ[g];
    gLat[g] = keepRight(g, formation(g)); mLat[r] = 0; mFwd[r] = 0;
    ent.g = g; ent.gs = gSer[g];
    unpromote(r, true);
  }

  // ---- YOU HIT ONE: their friends react, through the shared brain
  function harmCheck(ent) {
    const ped = ent.ped;
    const hp = ped.hp, ko = (ped.ko || 0) > 0, dead = !!ped.dead;
    if (ent.hp0 != null && ((hp != null && hp < ent.hp0 - 0.5) || (ko && !ent.ko0) || (dead && !ent.dead0))) incident(ent, ped, ko || dead);
    ent.hp0 = hp; ent.ko0 = ko; ent.dead0 = dead;
  }
  function incident(ent, ped, down) {
    const g = ent.g;
    if (g < 0 || !gUsed[g] || gSer[g] !== ent.gs) return;
    if (CLOCK - gHurtT[g] < 4) return;
    gHurtT[g] = CLOCK;
    const PA = CBZ.city && CBZ.city.playerActor;
    let ag = ped.mem && ped.mem.pos ? ped.mem : null;
    if (!ag && PA && PA.pos && Math.hypot(PA.pos.x - ped.pos.x, PA.pos.z - ped.pos.z) < 9) ag = PA;
    const armed = !!ag && (ag === PA ? !!(CBZ.cityHasGun && CBZ.cityHasGun()) : !!ag.armed);
    // the friends who are real bodies: the brain decides who answers and how hard
    const ms = members(g, _ms2);
    let living = null;
    for (const r of ms) { const e2 = POOL[mRig[r]]; if (mRig[r] >= 0 && e2 && e2.ped && !e2.ped.dead && e2.ped !== ped) { living = e2.ped; break; } }
    if (ag && CBZ.cityBrain && CBZ.cityBrain.retaliate && !ped.child) {
      const v = ped.dead ? living : ped;
      if (v) { try { CBZ.cityBrain.retaliate(v, ag, ped.dead ? 1 : null); } catch (e) {} }
    }
    // everyone else in the group: a gun or a killing, they run; otherwise
    // they gather round the one on the floor (one of them on the phone)
    if (armed || ped.dead) {
      const G = storeGroup();
      if (G) ST.panic(ped.pos.x, ped.pos.z, 9, { only: G, secs: 9 });
      return;
    }
    if (!down || gMode[g] === MODE.FLEE) return;
    unwait(g);
    leaveEdge(g);
    gMode[g] = MODE.HELP; gT[g] = 0; gT2[g] = 22 + rnd() * 12;
    gHX[g] = ped.pos.x; gHZ[g] = ped.pos.z;
    gX[g] = ped.pos.x; gZ[g] = ped.pos.z;
    let i = 0;
    for (const r of ms) {
      const th = i * 2.1 + 0.6, rr = 1.0;
      mTX[r] = ped.pos.x + Math.cos(th) * rr; mTZ[r] = ped.pos.z + Math.sin(th) * rr; mTY[r] = ped.pos.y || gY[g];
      mFace[r] = Math.atan2(ped.pos.x - mTX[r], ped.pos.z - mTZ[r]);
      mStand[r] = i === 0 ? 2 : 1;
      i++;
    }
  }

  // ================================================================ the panic bus: a gunshot on the street
  function wrapPanic() {
    if (!CBZ.cityPanic || CBZ.cityPanic._streetWrap) return;
    const orig = CBZ.cityPanic;
    const w = function (x, z, power, offender, blast) {
      const out = orig.apply(this, arguments);
      try {
        const G = GS;
        if (G && !G.gone && isFinite(x) && isFinite(z)) ST.panic(x, z, (16 + (power || 1) * 10) * 1.3, { only: G, secs: 7 + (power || 1) * 2 });
      } catch (e) {}
      return out;
    };
    w._streetWrap = true;
    CBZ.cityPanic = w;
  }

  // ================================================================ sites: build what is near
  let siteT = 99;
  function ensureSites(px, pz) {
    const A = arena();
    // the downtown grid (and its annex)
    let si = -1;
    for (let i = 0; i < SITES.length; i++) if (SITES[i] && SITES[i].key === "arena") si = i;
    if (A && A.lots && A.lots.length) {
      if (si >= 0 && SITES[si].src !== A) { dropSite(si); si = -1; }
      if (si < 0) { const s = siteForArena(A); if (s) addSite(s); }
    } else if (si >= 0) dropSite(si);
    // the planned cities near the player
    const L = CBZ.metroCities || [];
    for (const mc of L) {
      const P = mc && mc.plan, B = P && P.bounds;
      if (!P || !B || !P.blocks || !P.blocks.length) continue;
      const near = px > B.minX - R - 200 && px < B.maxX + R + 200 && pz > B.minZ - R - 200 && pz < B.maxZ + R + 200;
      let k = -1;
      for (let i = 0; i < SITES.length; i++) if (SITES[i] && SITES[i].src === P) k = i;
      if (near && k < 0) { const s = siteForMetro(mc); if (s) addSite(s); }
    }
  }
  function addSite(s) {
    let i = SITES.indexOf(null);
    if (i < 0) { i = SITES.length; SITES.push(null); }
    SITES[i] = s;
    HOUR = hourNow(); refreshDensity(s, HOUR);
  }
  function dropSite(i) {
    for (let g = 0; g < gHi; g++) if (gUsed[g] && gSite[g] === i) removeGroup(g);
    SITES[i] = null;
  }

  // ================================================================ the frame
  let CLOCK = 0, HOUR = 12, popT = 99, densT = 99, cleanT = 0, observedWas = true, standShare = 0.2;
  const STATS = { ms: 0 };
  function observed() {
    if (!CBZ.cityCampaignObservationGate) return true;
    try { return CBZ.cityCampaignObservationGate("crowd") !== false; } catch (e) { return true; }
  }
  function clearAll() {
    for (let g = 0; g < gHi; g++) if (gUsed[g]) removeGroup(g);
    liveRows = 0;
  }
  function frame(dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
    CLOCK += dt;
    const P = playerPos();
    if (G_().mode && G_().mode !== "city") { if (gCount) clearAll(); return; }
    if (!observed()) { if (gCount) clearAll(); observedWas = false; return; }
    if (!P) return;
    wrapPanic();
    signalTick();
    siteT += dt;
    if (siteT > 1.5) { siteT = 0; ensureSites(P.x, P.z); }
    // the hour
    densT += dt;
    if (densT > 4) {
      densT = 0;
      const h = hourNow();
      HOUR = h;
      for (const s of SITES) if (s) refreshDensity(s, h);
    }
    if (!CBZ.cityMakePed || (CBZ.net && CBZ.net.noSim && CBZ.net.noSim())) poolReady = true;
    else prewarmTick();
    // population: the target over the streamed ring, spawn and despawn
    popT += dt;
    if (popT > 0.5) {
      popT = 0;
      refreshActive(P.x, P.z);
      let n = 0, far = -1, farD = 0, st = 0;
      for (let g = 0; g < gHi; g++) {
        if (!gUsed[g]) continue;
        const d = Math.hypot(gX[g] - P.x, gZ[g] - P.z);
        let rig = false;
        for (let k = 0; k < GM; k++) { const r = gMem[g * GM + k]; if (r >= 0 && mRig[r] >= 0) rig = true; }
        if (d > R + 25 && !rig) { removeGroup(g); continue; }
        n += gN[g]; if (gMode[g] === MODE.STAND) st += gN[g];
        if (d > farD && !rig && d > 45) { farD = d; far = g; }
      }
      liveRows = n; standShare = n ? st / n : 0.2;
      // too many for the hour or the place: the farthest unseen group goes home
      if (liveRows > target * 1.12 + 4 && far >= 0 && hidden(gX[far], gZ[far])) { liveRows -= gN[far]; removeGroup(far); }
      const initial = !spawnedOnce || liveRows < target * 0.45;
      if (target > 0) { spawnTick(initial); spawnedOnce = true; }
    }
    // the groups: near every frame, mid at 10 Hz, far at ~3 Hz
    for (let g = 0; g < gHi; g++) {
      if (!gUsed[g] || CLOCK < gNext[g]) continue;
      const gdt = Math.min(0.5, CLOCK - gLast[g]);
      gLast[g] = CLOCK;
      const d = Math.hypot(gX[g] - P.x, gZ[g] - P.z);
      gNext[g] = CLOCK + (d < 55 ? 0 : d < 110 ? 0.1 : 0.3);
      if (gdt > 0) tickGroup(g, gdt);
    }
    // the near ring: real bodies
    promoT += dt;
    if (promoT > 0.25) { promoT = 0; promoteTick(); }
    // the hurt who crawled off and the dead the store keeps: out of our count;
    // a hurt body far off and unseen is taken away
    cleanT += dt;
    if (cleanT > 3 && GS) {
      cleanT = 0;
      const L = GS.rows;
      for (let k = L.length - 1; k >= 0; k--) {
        const r = L[k];
        if (S.life[r] === ST.HURT && mG[r] < 0 && mRig[r] < 0 && Math.hypot(S.x[r] - P.x, S.z[r] - P.z) > 70 && hidden(S.x[r], S.z[r])) GS.remove(r);
        else if (S.life[r] === ST.ALIVE && mG[r] < 0 && mRig[r] < 0 && !S.hide[r]) GS.remove(r);      // an orphan
      }
    }
    if (t0) STATS.ms = STATS.ms * 0.95 + ((performance.now() - t0)) * 0.05;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(38.5, frame);

  // a city teardown drops every rig in CBZ.cityPeds: the pool goes with them
  function wrapClear() {
    if (!CBZ.clearCityPeds || CBZ.clearCityPeds._streetWrap) return;
    const orig = CBZ.clearCityPeds;
    const w = function () {
      for (let r = 0; r < CAP; r++) if (mRig[r] >= 0) { mRig[r] = -1; if (S.life[r] === ST.ALIVE) S.hide[r] = 0; }
      POOL.length = 0; poolReady = false;
      return orig.apply(this, arguments);
    };
    w._streetWrap = true;
    CBZ.clearCityPeds = w;
  }
  wrapClear();

  function reset() {
    wrapClear();
    clearAll();
    for (let i = 0; i < SITES.length; i++) SITES[i] = null;
    SITES.length = 0;
    spawnedOnce = false; popT = 99; siteT = 99; densT = 99;
  }

  // ================================================================ public
  function audit() {
    let rows = 0, grouped = 0, solo = 0, rigs = 0, standing = 0, waiting = 0, crossing = 0, kids = 0, fleeing = 0;
    const kinds = {};
    for (let g = 0; g < gHi; g++) {
      if (!gUsed[g]) continue;
      const n = gN[g];
      rows += n;
      if (n > 1) grouped += n; else solo += n;
      const k = KIND_NAMES[gKind[g]] || "?";
      kinds[k] = (kinds[k] | 0) + 1;
      if (gMode[g] === MODE.STAND) standing += n;
      if (gMode[g] === MODE.WAIT) waiting += n;
      if (gMode[g] === MODE.CROSS) crossing += n;
      if (gMode[g] === MODE.FLEE) fleeing += n;
      for (let i = 0; i < GM; i++) { const r = gMem[g * GM + i]; if (r >= 0) { if (mRig[r] >= 0) rigs++; if (mKid[r]) kids++; } }
    }
    let edges = 0, cross = 0;
    for (const s of SITES) if (s) { edges += s.nE; cross += s.crossings; }
    return {
      device: DEVICE, budget: Object.assign({}, BUD), hour: +HOUR.toFixed(2), target: target, rows: rows, groups: gCount,
      grouped: rows ? +(grouped / rows).toFixed(3) : 0, solo: rows ? +(solo / rows).toFixed(3) : 0, kinds: kinds,
      standing: standing, waiting: waiting, crossing: crossing, fleeing: fleeing, kids: kids, rigs: rigs,
      pool: POOL.filter(function (e) { return e.ped; }).length, sites: SITES.filter(Boolean).length, edges: edges, crossings: cross,
      stepMs: +STATS.ms.toFixed(3), drawn: GS && GS.layer ? GS.layer.drawn.slice(1) : null,
    };
  }
  // every walking member against its slot, every body's position (tools/streetlife-check.mjs)
  function inspect() {
    const out = [];
    for (let g = 0; g < gHi; g++) {
      if (!gUsed[g]) continue;
      for (let i = 0; i < GM; i++) {
        const r = gMem[g * GM + i]; if (r < 0) continue;
        out.push({ r: r, g: g, n: gN[g], kind: KIND_NAMES[gKind[g]], mode: gMode[g], x: S.x[r], z: S.z[r], sx: mTX[r], sz: mTZ[r],
          kid: !!mKid[r], rig: mRig[r] >= 0, life: S.life[r] });
      }
    }
    return out;
  }
  CBZ.streetLife = {
    reset: reset, audit: audit, inspect: inspect, budget: function () { return Object.assign({ device: DEVICE }, BUD); },
    sites: function () { return SITES.filter(Boolean).map(function (s) { return { key: s.key, rings: s.rings.length, edges: s.nE, crossings: s.crossings, spots: s.spots.length }; }); },
    // a scare on the street (a gunshot, a scene): the pavement runs, not the rallies
    retire: retire,
    panic: function (x, z, r, secs) { const G = GS; if (!G || G.gone) return 0; return ST.panic(x, z, r || 30, { only: G, secs: secs || 8 }); },
    MODE: MODE, _step: frame,
  };
})();
