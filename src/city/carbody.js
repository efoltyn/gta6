/* ============================================================
   city/carbody.js — a car body is a LOFTED SHELL, not a stack of boxes.

   OWNER: "completely improving car ... it's going to look freaking car."

   WHAT WAS WRONG. Every road car was a side profile extruded straight
   across the width (a flat-sided prism), a trapezoid glass tub on top of
   it, and a pile of slabs for the hood, roof, pillars, rockers and wings,
   all flat-shaded. From a street three-quarter view that reads as a
   low-poly box stack: no curved hood, no crowned roof, no tumblehome,
   and wheels parked BESIDE the flanks instead of sitting in arches.

   WHAT THIS IS. One generator, driven by a per-class spec table:
     CBZ.carBody.loft(spec) -> {
       geos:  { paint, paintU, glass, trim, under }  BufferGeometry each
       doors: [{ spec, geos: { paint, dark, glass } }]  door leaves
       section(z), ctx samplers for the brand face / accessories
     }
   The body is a SECTIONAL LOFT: N stations along z (nose +z, tail -z),
   each a cross-section polyline with a FIXED point topology, mirrored:

      idx  point  what it is                  band above it (idx -> idx+1)
       0   C0     underbody centre             0 underbody
       1   A      wheel-well inner, floor      1 well inner wall (arches only)
       2   Wi     wheel-well inner, top        2 well ceiling / underbody
       3   Lip    rocker bottom / arch lip     3 rocker (black) / arch lip
       4   R      rocker top = DOOR SILL       4 lower flank (valance at ends)
       5   F      lower flank, widest          5 flank
       6   M      upper flank                  6 flank
       7   S      SHOULDER crease              7 shoulder top  (crease at S)
       8   G0     glass base / hood edge       8 DLO strip (black) / hood
       9   G0b    DLO top                      9 SIDE GLASS / pillars / hood
      10   G1     glass top = roof rail        10 rail, A/C pillars / hood
      11   R1     roof rail inboard            11 roof / WINDSHIELD / BACKLIGHT
      12   R2     roof crown                   12 roof ...
      13   RC     roof centre

   The GREENHOUSE is a blend: g(z) is 0 over the hood and the deck and 1
   under the roof; points 9..13 are lerp(hood/deck surface, roof, g). So
   the band between the cowl station and the roof-front station IS the
   raked windshield, the band between the roof-rear station and the deck
   IS the backlight, and the side-glass band grows out of the belt — no
   lid anywhere: the shell is open glass between the belt and the roof.

   WHEEL ARCHES are real openings: stations are placed on the arch circle
   and the lower-chain points (Wi, Lip, R, F, M) ride up around it, so the
   flank has a round hole with a black liner ceiling and an inner wall —
   the tyre sits IN the arch. DOORS are the shell cells inside the door
   rectangle, removed from the body and re-sampled from the SAME section
   function (so the skin is flush, 4 mm shut line) with thickness, an
   inner card and the pane; the hole gets painted jamb walls.

   Normals are smooth inside a panel group and CREASED at the shoulder,
   the hood/deck edges, the cowl and the deck line. Everything returned is
   plain non-indexed geometry (position + normal) so city/vehicles.js
   merges it into its per-material buckets like any other part.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  const NP = 14;                       // points per half section
  const P = { C0: 0, A: 1, Wi: 2, Lip: 3, R: 4, F: 5, M: 6, S: 7, G0: 8, G0b: 9, G1: 10, R1: 11, R2: 12, RC: 13 };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  // monotone cubic (Fritsch-Carlson) through [[z, v], ...] sorted by z:
  // smooth curves (a hood that bows, a roof that peaks) with no overshoot
  function mono(keys) {
    const k = keys.slice().sort((a, b) => a[0] - b[0]);
    const n = k.length;
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((k[i + 1][1] - k[i][1]) / Math.max(1e-6, k[i + 1][0] - k[i][0]));
    m[0] = d[0] || 0; m[n - 1] = d[n - 2] || 0;
    for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
      if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return function (z) {
      if (z <= k[0][0]) return k[0][1];
      if (z >= k[n - 1][0]) return k[n - 1][1];
      let i = 0;
      while (i < n - 2 && z > k[i + 1][0]) i++;
      const hh = k[i + 1][0] - k[i][0], t = (z - k[i][0]) / hh;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * k[i][1] + (t3 - 2 * t2 + t) * hh * m[i] +
        (-2 * t3 + 3 * t2) * k[i + 1][1] + (t3 - t2) * hh * m[i + 1];
    };
  }

  /* ---- the SHAPE: spec -> section(z) --------------------------------------
     spec (metres, car frame: +z nose, y up from the ground, +x = left):
       L, W                 overall length, body width at the fenders
       axles [zF, zR]       wheel centres; wheelR, wheelW, archGap
       yB                   rocker bottom (ride), noseLift/tailLift (overhang rise)
       zCowl zRoofF zRoofR zDeck   greenhouse hardpoints
       yNose yCowl yDeck yTail     hood/deck EDGE heights at those points
       hoodKeys/deckKeys    optional extra [z, y] edge keys (hood bow, deck kick)
       yRoof, roofKeys      roof centre height (+ optional [z,y] keys)
       hoodCrown roofCrown  centre rise over the edge / over the rail
       tumble               roof-rail x / glass-base x
       rcNose rcTail        plan corner radius of the bumpers
       endTaperN/T          plan narrowing of the overhangs (fraction)
       bulge tuck           fender flare / waist tuck (m)
       beltIn shoulderIn shoulderDrop    shoulder geometry
       winF (0..1) winR     windshield / backlight curvature
       sideGlassR sideGlassF   z-limits of the side glass (outside: paint)
       pillars [z,...]      black pillar strips in the side glass (B/D)
       archTrim             black arch lips (crossovers, trucks)
       blackPillars         A/C pillars in black (EV "floating roof")
       glassRoof            the roof crown is glass
       bed {z0, z1, floorY} pickup bed (open top, walls, floor)
       openTail {floorY}    van: no tail cap (the tailgate closes it)
       doors [{id, side, row, z0, z1}]
       floorY               cabin floor (door sill drop)             */
  function makeShape(S) {
    const L = S.L, halfL = L / 2, W2 = S.W / 2;
    const zN = halfL, zT = -halfL;
    const zF = S.axles[0], zR = S.axles[1];
    const Ra = S.wheelR + (S.archGap != null ? S.archGap : 0.05);
    const wy = S.wheelR;
    const rcN = S.rcNose, rcT = S.rcTail;
    const midZ = (zF + zR) / 2, wb = zF - zR;
    // hood/deck EDGE height along z
    const edgeKeys = [[zT, S.yTail], [S.zDeck, S.yDeck], [S.zCowl, S.yCowl], [zN, S.yNose]]
      .concat(S.hoodKeys || [], S.deckKeys || [], S.beltKeys || []);
    const yEdge = mono(edgeKeys);
    const roofKeys = S.roofKeys && S.roofKeys.length
      ? S.roofKeys : [[S.zRoofR, S.yRoof - 0.02], [(S.zRoofR + S.zRoofF) / 2, S.yRoof], [S.zRoofF, S.yRoof - 0.02]];
    const yRoofFn = mono(roofKeys);
    const yBfn = function (z) {
      let y = S.yB;
      const fe = zF + Ra, re = zR - Ra;
      if (z > fe) y += (S.noseLift || 0) * sstep((z - fe) / Math.max(0.1, zN - fe));
      if (z < re) y += (S.tailLift || 0) * sstep((re - z) / Math.max(0.1, re - zT));
      return y;
    };
    // plan half-width with circular bumper corners and a gentle overhang taper
    function planHalf(z) {
      let hw = W2;
      const fe = zF + Ra * 0.6, re = zR - Ra * 0.6;
      if (z > fe) hw -= W2 * (S.endTaperN || 0.03) * sstep((z - fe) / Math.max(0.1, zN - fe));
      if (z < re) hw -= W2 * (S.endTaperT || 0.02) * sstep((re - z) / Math.max(0.1, re - zT));
      const dN = zN - z, dT = z - zT;
      if (dN < rcN) { const u = (rcN - dN) / rcN; hw -= rcN * (1 - Math.sqrt(Math.max(0, 1 - u * u))); }
      if (dT < rcT) { const u = (rcT - dT) / rcT; hw -= rcT * (1 - Math.sqrt(Math.max(0, 1 - u * u))); }
      return hw;
    }
    function bump(z) {
      const s = Ra * 1.35;
      return Math.exp(-Math.pow((z - zF) / s, 2)) + Math.exp(-Math.pow((z - zR) / s, 2));
    }
    function waist(z) { return Math.exp(-Math.pow((z - midZ) / (wb * 0.32), 2)); }
    // greenhouse blend
    function gFn(z) {
      if (S.zRoofF >= zN - 1e-6 && z >= S.zRoofR) return 1;
      if (z >= S.zCowl || z <= S.zDeck) return 0;
      if (z >= S.zRoofF) {                       // windshield: cowl (0) -> roof front (1)
        const u = (S.zCowl - z) / Math.max(1e-3, S.zCowl - S.zRoofF);
        const c = S.winF != null ? S.winF : 0.35;
        return clamp(1 - Math.pow(1 - u, 1 + c), 0, 1);
      }
      if (z <= S.zRoofR) {                       // backlight: deck (0) -> roof rear (1)
        const u = (z - S.zDeck) / Math.max(1e-3, S.zRoofR - S.zDeck);
        const c = S.winR != null ? S.winR : 0.5;
        return clamp(1 - Math.pow(1 - u, 1 + c), 0, 1);
      }
      return 1;
    }
    function archY(z) {
      let best = -1;
      for (const wz of [zF, zR]) {
        const dz = z - wz;
        if (Math.abs(dz) < Ra) best = Math.max(best, wy + Math.sqrt(Ra * Ra - dz * dz));
      }
      return best;
    }
    const trackHalf = S.trackHalf;
    const xInBase = trackHalf - S.wheelW / 2 - 0.05;
    const crownH = S.hoodCrown != null ? S.hoodCrown : 0.05, crownD = S.deckCrown != null ? S.deckCrown : 0.035;
    const rC = S.roofCrown != null ? S.roofCrown : 0.05;

    function section(z) {
      const hwP = planHalf(z);
      const bm = bump(z), ws = waist(z);
      const hwLow = hwP + (S.bulge || 0) * bm - (S.tuck || 0) * ws * (1 - Math.min(1, bm));
      const hwS = hwP - (S.beltIn != null ? S.beltIn : 0.03) + (S.bulge || 0) * 0.45 * bm - (S.tuck || 0) * 0.4 * ws;
      const ye = yEdge(z);
      const yS = ye - (S.shoulderDrop != null ? S.shoulderDrop : 0.035);
      const yb = yBfn(z);
      const xG0 = Math.max(0.2, hwS - (S.shoulderIn != null ? S.shoulderIn : 0.035));
      // crown over the hood ahead of the cowl, over the deck behind the deck line
      const tC = sstep((z - S.zDeck) / Math.max(0.1, S.zCowl - S.zDeck));
      const crown = lerp(crownD, crownH, tC);
      const top = (x) => ye + crown * (1 - Math.pow(Math.min(1, x / xG0), 2));
      const g = gFn(z);
      const yR0 = yRoofFn(z);
      const xRail = xG0 * (S.tumble != null ? S.tumble : 0.82);
      const ay = archY(z);
      const inArch = ay > yb + 1e-4;
      const aAmt = inArch ? clamp((ay - yb) / 0.08, 0, 1) : 0;
      const base = inArch ? ay : yb;
      const xIn = Math.min(xInBase, hwLow - 0.12);
      const pts = new Array(NP);
      pts[P.C0] = [0, yb];
      pts[P.A] = [xIn, yb];
      pts[P.Wi] = [xIn, inArch ? ay : yb];
      pts[P.Lip] = [hwLow - lerp(0.06, 0.018, aAmt), base];
      pts[P.R] = [hwLow - lerp(0.024, 0.0, aAmt), base + lerp(0.10, 0.045, aAmt)];
      const span = Math.max(0.05, yS - yb);
      const yFr = yb + 0.40 * span, yMr = yb + 0.74 * span;
      const remap = (y) => inArch ? base + (y - yb) / span * (yS - base) : y;
      pts[P.F] = [hwLow, Math.max(remap(yFr), pts[P.R][1] + 0.02)];
      pts[P.M] = [hwLow - 0.012 - Math.max(0, hwLow - hwS) * 0.4, Math.max(remap(yMr), pts[P.F][1] + 0.02)];
      pts[P.S] = [hwS, yS];
      pts[P.G0] = [xG0, ye];
      // greenhouse: lerp(surface under it, roof), per point
      const xb = xG0 - 0.012;
      pts[P.G0b] = [xG0 - 0.012 * g, top(xb) + 0.028 * g];
      const roofPts = [
        [xRail, yR0 - rC - 0.045],
        [xRail - 0.05, yR0 - rC - 0.004],
        [xRail * 0.52, yR0 - rC * 0.27],
        [0, yR0],
      ];
      for (let i = 0; i < 4; i++) {
        const rp = roofPts[i];
        const by = top(rp[0]);
        pts[P.G1 + i] = [rp[0], by + (rp[1] - by) * g];
      }
      return { pts: pts, g: g, z: z, hwLow: hwLow, hwS: hwS, yEdge: ye, yB: yb, xG0: xG0, inArch: inArch };
    }
    return {
      section: section, yEdge: yEdge, planHalf: planHalf, archY: archY, gFn: gFn,
      Ra: Ra, zN: zN, zT: zT, zF: zF, zR: zR, W2: W2,
    };
  }

  // ---- STATIONS ------------------------------------------------------------
  function stationsFor(S, SH) {
    const zN = SH.zN, zT = SH.zT;
    const hard = [], soft = [];
    hard.push(zN, zT);
    // bumper corners on the circle (dense at the tip where the curve turns)
    [0.04, 0.14, 0.3, 0.52, 0.78, 1.0].forEach((f) => {
      const a = f * Math.PI / 2;
      soft.push(zN - S.rcNose * (1 - Math.cos(a)), zT + S.rcTail * (1 - Math.cos(a)));
    });
    // arches: stations ON the circle, so the opening is round
    for (const wz of [SH.zF, SH.zR]) {
      const yb = S.yB;
      const s0 = clamp((yb - S.wheelR) / SH.Ra, -0.99, 0.99);
      const th0 = Math.asin(s0);
      const n = 10;
      for (let i = 0; i <= n; i++) {
        const th = th0 + (Math.PI - 2 * th0) * i / n;
        hard.push(wz + SH.Ra * Math.cos(th));
      }
      hard.push(wz + SH.Ra + 0.03, wz - SH.Ra - 0.03);
    }
    // greenhouse hardpoints + interior samples of the rakes
    [S.zCowl, S.zRoofF, S.zRoofR, S.zDeck].forEach((z) => { if (z > zT && z < zN) hard.push(z); });
    for (let i = 1; i < 4; i++) {
      soft.push(lerp(S.zCowl, S.zRoofF, i / 4));
      soft.push(lerp(S.zDeck, S.zRoofR, i / 4));
    }
    (S.doors || []).forEach((d) => { hard.push(d.z0, d.z1); });
    (S.pillars || []).forEach((z) => { hard.push(z - 0.045, z + 0.045); });
    if (S.sideGlassR != null) hard.push(S.sideGlassR);
    if (S.bed) hard.push(S.bed.z0, S.bed.z1);
    (S.extraStations || []).forEach((z) => soft.push(z));
    let all = hard.map((z) => ({ z: z, h: true })).concat(soft.map((z) => ({ z: z, h: false })));
    all = all.filter((s) => s.z >= zT - 1e-6 && s.z <= zN + 1e-6).sort((a, b) => a.z - b.z);
    const out = [];
    for (const s of all) {
      const last = out[out.length - 1];
      if (last && s.z - last.z < 0.018) { if (s.h && !last.h) out[out.length - 1] = s; continue; }
      out.push(s);
    }
    // fill long gaps (max 0.32 m) so curvature reads
    const z = [];
    for (let i = 0; i < out.length; i++) {
      if (i > 0) {
        const gap = out[i].z - out[i - 1].z, n = Math.ceil(gap / 0.32);
        for (let k = 1; k < n; k++) z.push(out[i - 1].z + gap * k / n);
      }
      z.push(out[i].z);
    }
    return z;
  }

  // ---- geometry accumulators ----------------------------------------------
  function Acc() { this.p = []; this.n = []; }
  Acc.prototype.tri = function (a, b, c, na, nb, nc) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    if (na) this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
    else {
      const f = faceN(a, b, c);
      this.n.push(f[0], f[1], f[2], f[0], f[1], f[2], f[0], f[1], f[2]);
    }
  };
  Acc.prototype.geo = function () {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.computeBoundingSphere();
    return g;
  };
  function faceN(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  }
  function triArea2(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  // quad a,b,c,d (in order around) wound to face `toward` (a point)
  function quadToward(acc, a, b, c, d, toward) {
    const n = faceN(a, b, c);
    const dot = n[0] * (toward[0] - a[0]) + n[1] * (toward[1] - a[1]) + n[2] * (toward[2] - a[2]);
    if (dot >= 0) { acc.tri(a, b, c); acc.tri(a, c, d); } else { acc.tri(a, c, b); acc.tri(a, d, c); }
  }
  function quadDir(acc, a, b, c, d, dir) {
    const n = faceN(a, b, c);
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= 0) { acc.tri(a, b, c); acc.tri(a, c, d); }
    else { acc.tri(a, c, b); acc.tri(a, d, c); }
  }

  // ---- THE LOFT --------------------------------------------------------------
  function loft(S) {
    const SH = makeShape(S);
    const zs = stationsFor(S, SH);
    const NS = zs.length;
    const secs = zs.map((z) => SH.section(z));
    const zDeck = S.zDeck, zCowl = S.zCowl, zRoofF = S.zRoofF, zRoofR = S.zRoofR;
    const pillars = S.pillars || [];
    const doors = S.doors || [];
    const bed = S.bed || null;
    // black lower valance reach at each end: trucks and crossovers wear plastic
    // bumpers, a car wears painted ones (its black is the rocker lip only)
    const Tend = S.valance != null ? S.valance : (S.archTrim ? 0.30 : 0);

    function sideGlassMat(zc) {
      for (let i = 0; i < pillars.length; i++) if (Math.abs(zc - pillars[i]) < 0.045) return "trim";
      if (S.sideGlassR != null && zc < S.sideGlassR) return "paint";
      if (S.sideGlassF != null && zc > S.sideGlassF) return "paint";
      return "glass";
    }
    // material of cell (interval s -> s+1, band b)
    function cellMat(s, b) {
      const zc = (zs[s] + zs[s + 1]) / 2;
      const gg = Math.max(secs[s].g, secs[s + 1].g), gmin = Math.min(secs[s].g, secs[s + 1].g);
      const inArch = secs[s].inArch && secs[s + 1].inArch;
      if (b <= 2) return "under";
      if (b === 3) return (inArch && !S.archTrim) ? "paint" : "trim";
      if (b === 4) return (zc > SH.zN - Tend || zc < SH.zT + Tend) ? "trim" : (inArch && S.archTrim ? "trim" : "paint");
      if (b <= 7) return "paint";
      if (gg < 0.02) return "paint";
      if (b === 8) return "trim";
      if (b === 9) return sideGlassMat(zc);
      if (b === 10) return S.blackPillars && gmin < 0.999 ? "trim" : "paintU";
      // 11, 12: roof / windshield / backlight
      if (gmin >= 0.999) return (S.glassRoof && b === 12) ? "glass" : "paintU";
      if (zc > zRoofF) return "glass";
      if (zc < zRoofR) return (S.backGlassR != null && zc < S.backGlassR) ? "paintU" : "glass";
      return "paintU";
    }
    // smoothing group: creases at the rocker, shoulder, hood edge, cowl, deck
    function cellGroup(s, b) {
      const zc = (zs[s] + zs[s + 1]) / 2;
      if (b <= 3) return b;
      if (b <= 6) return 4;
      if (b === 7) return 5;
      const reg = zc < zDeck ? 0 : zc < zCowl ? 1 : 2;
      return 6 + reg;
    }
    // which cells belong to a door (removed from the body)
    function cellDoor(s, b, side) {
      if (b < 4 || b > 9) return -1;
      const zc = (zs[s] + zs[s + 1]) / 2;
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        if (d.side === side && zc > d.z0 && zc < d.z1) return i;
      }
      return -1;
    }
    function cellBed(s, b) {
      if (!bed || b < 8) return false;
      const zc = (zs[s] + zs[s + 1]) / 2;
      return zc > bed.z0 && zc < bed.z1;
    }
    const V = (s, p, side) => { const q = secs[s].pts[p]; return [side * q[0], q[1], zs[s]]; };

    // pass 1: area-weighted smooth normals per (station, point, group, side)
    const nAcc = new Map();
    const key = (s, p, gid, side) => ((s * NP + p) * 16 + gid) * 2 + (side > 0 ? 1 : 0);
    function addN(k, n, w) {
      let a = nAcc.get(k);
      if (!a) { a = [0, 0, 0]; nAcc.set(k, a); }
      a[0] += n[0] * w; a[1] += n[1] * w; a[2] += n[2] * w;
    }
    // cell corner order such that (a, b, c) is outward: a=(s,p) b=(s,p+1) c=(s+1,p+1) d=(s+1,p) for side +1
    function cellQuad(s, b, side) {
      const a = V(s, b, side), bb = V(s, b + 1, side), c = V(s + 1, b + 1, side), d = V(s + 1, b, side);
      return side > 0 ? [a, bb, c, d, [s, b], [s, b + 1], [s + 1, b + 1], [s + 1, b]]
                      : [a, d, c, bb, [s, b], [s + 1, b], [s + 1, b + 1], [s, b + 1]];
    }
    for (let side = -1; side <= 1; side += 2) {
      for (let s = 0; s < NS - 1; s++) {
        for (let b = 0; b < NP - 1; b++) {
          const q = cellQuad(s, b, side), gid = cellGroup(s, b);
          const t1 = [q[0], q[1], q[2]], t2 = [q[0], q[2], q[3]];
          const i1 = [q[4], q[5], q[6]], i2 = [q[4], q[6], q[7]];
          [[t1, i1], [t2, i2]].forEach(function (T) {
            const ar = triArea2(T[0][0], T[0][1], T[0][2]);
            if (ar < 1e-9) return;
            const n = faceN(T[0][0], T[0][1], T[0][2]);
            for (let k = 0; k < 3; k++) addN(key(T[1][k][0], T[1][k][1], gid, side), n, ar);
          });
        }
      }
    }
    function normalAt(s, p, gid, side) {
      const a = nAcc.get(key(s, p, gid, side));
      if (!a) return [side, 0, 0];
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    }

    // pass 2: emit body cells by material (door + bed cells skipped)
    const acc = { paint: new Acc(), paintU: new Acc(), glass: new Acc(), trim: new Acc(), under: new Acc() };
    for (let side = -1; side <= 1; side += 2) {
      for (let s = 0; s < NS - 1; s++) {
        for (let b = 0; b < NP - 1; b++) {
          if (cellDoor(s, b, side) >= 0 || cellBed(s, b)) continue;
          const m = cellMat(s, b), gid = cellGroup(s, b), q = cellQuad(s, b, side);
          // S.flat: faceted on purpose (the stainless wedge truck) — face normals
          const n = S.flat ? [null, null, null, null] : [q[4], q[5], q[6], q[7]].map((ix) => normalAt(ix[0], ix[1], gid, side));
          if (triArea2(q[0], q[1], q[2]) > 1e-9) acc[m].tri(q[0], q[1], q[2], n[0], n[1], n[2]);
          if (triArea2(q[0], q[2], q[3]) > 1e-9) acc[m].tri(q[0], q[2], q[3], n[0], n[2], n[3]);
        }
      }
    }

    // pass 3: END CAPS — the flat fascia (nose) and tail face
    function capPoly(s) {
      const pts = secs[s].pts, ring = [];
      for (let i = 0; i < NP; i++) ring.push([pts[i][0], pts[i][1]]);
      for (let i = NP - 2; i >= 1; i--) ring.push([-pts[i][0], pts[i][1]]);
      const out = [];
      for (let i = 0; i < ring.length; i++) {
        const q = ring[i], l = out[out.length - 1];
        if (l && Math.hypot(q[0] - l[0], q[1] - l[1]) < 1e-4) continue;
        out.push(q);
      }
      if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-4) out.pop();
      return out;
    }
    function cap(s, dirZ, matFn) {
      const poly = capPoly(s);
      const tris = THREE.ShapeUtils.triangulateShape(poly.map((q) => new THREE.Vector2(q[0], q[1])), []);
      const z = zs[s], n = [0, 0, dirZ];
      for (const t of tris) {
        const a = [poly[t[0]][0], poly[t[0]][1], z], b = [poly[t[1]][0], poly[t[1]][1], z], c = [poly[t[2]][0], poly[t[2]][1], z];
        const cy = (a[1] + b[1] + c[1]) / 3;
        const target = acc[matFn(cy)];
        const f = faceN(a, b, c);
        if (f[2] * dirZ >= 0) target.tri(a, b, c, n, n, n); else target.tri(a, c, b, n, n, n);
      }
    }
    const lowY = (s) => secs[s].pts[P.R][1];
    cap(NS - 1, 1, (cy) => cy < lowY(NS - 1) ? "trim" : "paint");
    if (!S.openTail) cap(0, -1, (cy) => cy < lowY(0) ? "trim" : "paint");

    // pass 4: DOORS — leaves re-sampled from the same section, and jambs on the hole
    const doorOut = [];
    const SHUT = 0.004, T = S.doorThick || 0.07, J = S.jamb || 0.09;
    const floorY = S.floorY != null ? S.floorY : S.yB + 0.15;
    for (let di = 0; di < doors.length; di++) {
      const d = doors[di], side = d.side;
      // stations of the hole (body) and of the leaf (inset by the shut line)
      const sIdx = [];
      for (let s = 0; s < NS; s++) if (zs[s] >= d.z0 - 1e-6 && zs[s] <= d.z1 + 1e-6) sIdx.push(s);
      // -- body jambs around the hole
      const J1 = acc.paint;
      const zc = (d.z0 + d.z1) / 2;
      const cs = SH.section(zc);
      const hc = [side * (cs.pts[P.S][0] - J * 0.5), (cs.pts[P.R][1] + cs.pts[P.G1][1]) / 2, zc];
      const inw = (v) => [v[0] - side * J, v[1], v[2]];
      // leading/trailing edges: the section polyline R..G1 at z0 and z1
      [sIdx[0], sIdx[sIdx.length - 1]].forEach(function (s) {
        for (let p = P.R; p < P.G1; p++) {
          const a = V(s, p, side), b = V(s, p + 1, side);
          quadToward(J1, a, b, inw(b), inw(a), hc);
        }
      });
      // sill (bottom, R) and header (top, G1) along the stations
      for (let k = 0; k + 1 < sIdx.length; k++) {
        const s0 = sIdx[k], s1 = sIdx[k + 1];
        const a = V(s0, P.R, side), b = V(s1, P.R, side);
        quadToward(J1, a, b, inw(b), inw(a), [a[0], a[1] + 1, a[2]]);
        // inner sill wall down to the cabin floor, facing out through the opening
        const e = inw(a), f = inw(b);
        if (floorY < e[1] - 0.02) quadDir(acc.under, e, f, [f[0], floorY, f[2]], [e[0], floorY, e[2]], [side, 0, 0]);
        const c = V(s0, P.G1, side), dd = V(s1, P.G1, side);
        quadToward(J1, c, dd, inw(dd), inw(c), [c[0], c[1] - 1, c[2]]);
      }
      // -- the leaf
      const lz = [d.z0 + SHUT];
      for (const s of sIdx) if (zs[s] > d.z0 + SHUT + 0.01 && zs[s] < d.z1 - SHUT - 0.01) lz.push(zs[s]);
      lz.push(d.z1 - SHUT);
      const lsec = lz.map((z) => SH.section(z));
      const inset = function (pts) {
        const out = pts.map((q) => q.slice());
        const r = out[P.R], f = out[P.F];
        const lr = Math.hypot(f[0] - r[0], f[1] - r[1]) || 1;
        out[P.R] = [r[0] + (f[0] - r[0]) * SHUT / lr, r[1] + (f[1] - r[1]) * SHUT / lr];
        const g1 = out[P.G1], gb = out[P.G0b];
        const lg = Math.hypot(gb[0] - g1[0], gb[1] - g1[1]) || 1;
        out[P.G1] = [g1[0] + (gb[0] - g1[0]) * SHUT / lg, g1[1] + (gb[1] - g1[1]) * SHUT / lg];
        return out;
      };
      const lp = lsec.map((sc) => inset(sc.pts));
      const LV = (k, p, off) => [side * (lp[k][p][0] - (off || 0)), lp[k][p][1], lz[k]];
      const la = { paint: new Acc(), dark: new Acc(), glass: new Acc() };
      // outer skin, smooth within the door (normals from the body's own groups)
      const lN = new Map();
      const lkey = (k, p, gid) => (k * NP + p) * 16 + gid;
      const lgid = (b) => (b <= 6 ? 4 : b === 7 ? 5 : 6);
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 0; k + 1 < lz.length; k++) {
          for (let b = P.R; b < P.G1; b++) {
            const gid = lgid(b);
            const a = LV(k, b), bb = LV(k, b + 1), c = LV(k + 1, b + 1), dd = LV(k + 1, b);
            const q = side > 0 ? [a, bb, c, dd, [k, b], [k, b + 1], [k + 1, b + 1], [k + 1, b]]
                               : [a, dd, c, bb, [k, b], [k + 1, b], [k + 1, b + 1], [k, b + 1]];
            if (pass === 0) {
              [[0, 1, 2], [0, 2, 3]].forEach(function (t) {
                const ar = triArea2(q[t[0]], q[t[1]], q[t[2]]);
                if (ar < 1e-9) return;
                const n = faceN(q[t[0]], q[t[1]], q[t[2]]);
                t.forEach(function (ti) {
                  const ix = q[4 + ti], kk = lkey(ix[0], ix[1], gid);
                  const v = lN.get(kk) || [0, 0, 0];
                  v[0] += n[0] * ar; v[1] += n[1] * ar; v[2] += n[2] * ar; lN.set(kk, v);
                });
              });
              continue;
            }
            // material from the body cell this leaf cell sits in
            const zc2 = (lz[k] + lz[k + 1]) / 2;
            let s = 0; while (s < NS - 2 && zs[s + 1] < zc2) s++;
            let m = cellMat(s, b);
            const tgt = m === "glass" ? la.glass : (m === "trim" ? la.dark : la.paint);
            const nn = [4, 5, 6, 7].map(function (ti) {
              const ix = q[ti], v = lN.get(lkey(ix[0], ix[1], gid)) || [side, 0, 0];
              const l = Math.hypot(v[0], v[1], v[2]) || 1;
              return [v[0] / l, v[1] / l, v[2] / l];
            });
            if (S.flat) nn[0] = nn[1] = nn[2] = nn[3] = null;
            if (triArea2(q[0], q[1], q[2]) > 1e-9) tgt.tri(q[0], q[1], q[2], nn[0], nn[1], nn[2]);
            if (triArea2(q[0], q[2], q[3]) > 1e-9) tgt.tri(q[0], q[2], q[3], nn[0], nn[2], nn[3]);
            // inner card behind every opaque cell
            if (m !== "glass") {
              const t = b <= P.G0 ? T : 0.022;
              const ia = LV(k, b, t), ib = LV(k, b + 1, t), ic = LV(k + 1, b + 1, t), id = LV(k + 1, b, t);
              quadDir(la.dark, ia, ib, ic, id, [-side, 0, 0]);
            }
          }
        }
      }
      // rims of the thick lower door: front, rear, bottom, belt ledge
      const kL = lz.length - 1;
      [[0, [0, 0, -1]], [kL, [0, 0, 1]]].forEach(function (e) {
        for (let p = P.R; p < P.G0b; p++) {
          const a = LV(e[0], p), b = LV(e[0], p + 1);
          const t = p < P.G0 ? T : 0.022;
          quadDir(la.paint, a, b, LV(e[0], p + 1, t), LV(e[0], p, t), e[1]);
        }
      });
      for (let k = 0; k < kL; k++) {
        const a = LV(k, P.R), b = LV(k + 1, P.R);
        quadDir(la.paint, a, b, LV(k + 1, P.R, T), LV(k, P.R, T), [0, -1, 0]);
        const c = LV(k, P.G0b), dd = LV(k + 1, P.G0b);
        quadDir(la.dark, c, dd, LV(k + 1, P.G0b, 0.022), LV(k, P.G0b, 0.022), [0, 1, 0]);
      }
      const mid = lsec[Math.floor(lsec.length / 2)].pts;
      doorOut.push({
        spec: d,
        geos: { paint: la.paint.geo(), dark: la.dark.geo(), glass: la.glass.geo() },
        y0: mid[P.R][1], belt: mid[P.G0][1], y1: mid[P.G1][1],
        hx: side * lsec[kL].pts[P.S][0],
        skinX: function (z, y) { return SH.section(z).pts[P.S][0]; },
        shoulderY: mid[P.S][1],
        handle: (function () {
          const z = d.z0 + Math.min(0.2, (d.z1 - d.z0) * 0.22);
          const sc = SH.section(z);
          const y = sc.pts[P.S][1] - 0.075;
          // skin x at that height: between M and S
          const M = sc.pts[P.M], Sx = sc.pts[P.S];
          const u = clamp((y - M[1]) / Math.max(1e-3, Sx[1] - M[1]), 0, 1);
          return { x: side * lerp(M[0], Sx[0], u), y: y, z: z };
        })(),
      });
    }

    // pass 5: PICKUP BED — inner walls, floor, front bulkhead, tailgate inner
    if (bed) {
      const bf = bed.floorY;
      const inner = [];
      for (let s = 0; s < NS; s++) if (zs[s] >= bed.z0 - 1e-6 && zs[s] <= bed.z1 + 1e-6) inner.push(s);
      for (let side = -1; side <= 1; side += 2) {
        for (let k = 0; k + 1 < inner.length; k++) {
          const a = V(inner[k], P.G0, side), b = V(inner[k + 1], P.G0, side);
          quadDir(acc.paint, a, b, [b[0], bf, b[2]], [a[0], bf, a[2]], [-side, 0, 0]);
        }
      }
      for (let k = 0; k + 1 < inner.length; k++) {
        const a = V(inner[k], P.G0, 1), b = V(inner[k + 1], P.G0, 1);
        quadDir(acc.trim, [a[0], bf, a[2]], [b[0], bf, b[2]], [-b[0], bf, b[2]], [-a[0], bf, a[2]], [0, 1, 0]);
      }
      [[inner[inner.length - 1], -1], [inner[0], 1]].forEach(function (e) {
        const s = e[0], pts = secs[s].pts, z = zs[s];
        const ring = [[pts[P.G0][0], bf]];
        for (let p = P.G0; p <= P.RC; p++) ring.push([pts[p][0], pts[p][1]]);
        for (let p = P.R2; p >= P.G0; p--) ring.push([-pts[p][0], pts[p][1]]);
        ring.push([-pts[P.G0][0], bf]);
        const tris = THREE.ShapeUtils.triangulateShape(ring.map((q) => new THREE.Vector2(q[0], q[1])), []);
        for (const t of tris) {
          const a = [ring[t[0]][0], ring[t[0]][1], z], b = [ring[t[1]][0], ring[t[1]][1], z], c = [ring[t[2]][0], ring[t[2]][1], z];
          const f = faceN(a, b, c);
          if (f[2] * e[1] >= 0) acc.paint.tri(a, b, c); else acc.paint.tri(a, c, b);
        }
      });
    }

    const geos = {};
    for (const k in acc) geos[k] = acc[k].geo();
    const out = { geos: geos, doors: doorOut, section: SH.section, shape: SH, stations: zs, secs: secs };
    CBZ.carBody.last = out;          // the most recent loft (node checks / debugging)
    return out;
  }

  // ---- SAMPLERS the brand face / accessories read (JSON-safe tables) -------
  // front/rear surface z at (x, y): bisect along z for where the point leaves
  // the section. Returned as a grid so carparts can place lamps ON the skin.
  function inSection(pts, x, y) {
    // outer x at height y (max over the right-half polyline's crossings)
    let xo = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xo = Math.max(xo, a[0] + (b[0] - a[0]) * t);
      }
    }
    return Math.abs(x) <= xo;
  }
  function faceGrid(B, end, nx, ny) {
    const SH = B.shape, sec = B.section;
    const zTip = end > 0 ? SH.zN : SH.zT;
    const probe = sec(zTip - end * 0.6);
    const yLo = probe.yB + 0.02, yHi = probe.pts[P.RC][1] - 0.01;
    const xHi = SH.W2 - 0.01;
    const xs = [], ys = [], z = [];
    for (let i = 0; i < nx; i++) xs.push(xHi * i / (nx - 1));
    for (let j = 0; j < ny; j++) ys.push(lerp(yLo, yHi, j / (ny - 1)));
    for (let j = 0; j < ny; j++) {
      const row = [];
      for (let i = 0; i < nx; i++) {
        if (inSection(sec(zTip).pts, xs[i], ys[j])) { row.push(+zTip.toFixed(4)); continue; }
        // MARCH in from the tip, then bisect the step: the section is not
        // monotone along z (a point level with the wheel sits inside the
        // bumper corner, outside the arch, inside the door), so a plain
        // bisection over the whole overhang lands in the wrong crossing
        let lo = -1, hi = -1;
        for (let t = 0.03; t <= 0.55; t += 0.03) {         // a face part is never deeper than a bumper corner
          if (inSection(sec(zTip - end * t).pts, xs[i], ys[j])) { lo = t - 0.03; hi = t; break; }
        }
        if (hi < 0) { row.push(null); continue; }
        for (let it = 0; it < 18; it++) {
          const m = (lo + hi) / 2;
          if (inSection(sec(zTip - end * m).pts, xs[i], ys[j])) hi = m; else lo = m;
        }
        row.push(+(zTip - end * hi).toFixed(4));
      }
      z.push(row);
    }
    return { xs: xs, ys: ys, z: z };
  }
  function lines(B, n) {
    const SH = B.shape, out = { top: [], belt: [], rock: [] };
    for (let i = 0; i <= n; i++) {
      const z = lerp(SH.zT + 0.02, SH.zN - 0.02, i / n);
      const s = B.section(z);
      out.top.push([+z.toFixed(3), +s.pts[P.RC][1].toFixed(3), +s.xG0.toFixed(3), +s.yEdge.toFixed(3), +s.g.toFixed(3)]);
      out.belt.push([+z.toFixed(3), +s.pts[P.S][0].toFixed(3), +s.pts[P.S][1].toFixed(3)]);
      out.rock.push([+z.toFixed(3), +s.pts[P.R][0].toFixed(3), +s.pts[P.R][1].toFixed(3), +s.pts[P.F][0].toFixed(3)]);
    }
    return out;
  }

  CBZ.carBody = { loft: loft, faceGrid: faceGrid, lines: lines, P: P, makeShape: makeShape };
})();
