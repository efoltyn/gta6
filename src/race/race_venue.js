/* ============================================================
   race/race_venue.js — THE COLOSSEUM round the bullring.

   Everything off race_core's frame in (s,u), outside the SAFER wall:
     - the bowl: stands on EVERY side, 38 rows at a 33 deg rake in two
       tiers (a cross-aisle and vom wall between), seat rows with backs,
       aisles every 24 m, vomitories, the fascia sponsor band over the
       fence, a concourse and parapet on top, the outer wall to grade
     - the main grandstand carries two storeys of lit glass suites; the
       rest of the rim carries roof canopies between the light towers
     - the crowd: ~40k instanced people (13k on low), one quad each out
       of a painted atlas, bobbing and standing up with their arms in the
       air in the vertex shader on state.excite; camera flashes
     - light towers with lamp banks + additive halos (no real lights:
       race_game owns the lighting; the pools are baked vertex brightness)
     - the S/F gantry (truss, 5-column start lights, flag stand + flagman,
       sponsor board), the scoring pylon, a four-sided infield video
       board, pit garages, war wagons, the hauler row, care + media
       buildings, flag poles, the main gate in the back of the main stand
     - `surroundings` (a child group the city embed can drop): the lot
       ring with parked cars and lamp posts, the far skyline + hills.

   API: CBZ.race.venue.build(THREE, core, {quality}) →
     { group, surroundings, update(dt, state), setLights(n, green), setPylon(numbers),
       setJumbo(text | canvas), anchors, outerU(s), mainEntrance, spec, dispose }
   CBZ.race.venue.spec(core) → { outerU(s), mainEntrance:{s,u}, height, mastHeight } (pure)
============================================================ */
(function (root) {
  "use strict";

  const TR = (typeof module !== "undefined" && module.exports && typeof require === "function")
    ? require("./race_track.js") : root.CBZ.race.track;
  const K = TR.kit;
  const { rng, canvas, tex, rgb, Mesher, Buckets, chunk, STAND, standSection, SUITES, inSuites, towerSpots, lightField, arcAt, signAtlas } = K;

  const CANOPY = { back: 8.0, front: 6.2, reach: 9.0 };           // heights above the concourse; reach inward of uTop
  const SUITE_H = 0.9 + 3.2 + 0.6 + 3.2 + 0.8;                     // fascia, glass, slab, glass, roof fascia
  const MAST = { stand: 20, suite: 12 };                           // mast height above the deck it stands on
  const GATE = { hw: 6, h: 6.2 };                                  // the main gate opening in the back of the main stand

  /* spec: the building's outside, a pure function of core (no THREE, no DOM).
     build() draws from the same numbers. */
  function spec(core) {
    const outerU = (s) => inSuites(core, s) ? STAND.uBack + SUITES.depth : STAND.uBack;
    let height = 0, mastHeight = 0; const o = {};
    for (let s = 0; s < core.DIMS.L; s += 2) {
      standSection(core, s, o);
      const top = inSuites(core, s) ? o.yConc + SUITES.lift + SUITE_H : o.yConc + CANOPY.back + 0.4;
      const mast = inSuites(core, s) ? o.yConc + SUITES.lift + SUITE_H + MAST.suite : o.yConc + MAST.stand;
      if (top > height) height = top; if (mast > mastHeight) mastHeight = mast;
    }
    return { outerU, mainEntrance: { s: 0, u: outerU(0) }, height: +height.toFixed(2), mastHeight: +(mastHeight + 2.5).toFixed(2) };
  }

  const TEAM = [0xd4202b, 0xf2b705, 0x1b4fd8, 0x111111, 0xf26a1b, 0x0f8a4a, 0xe8e8e8, 0x6a2bbd, 0x14b3c8, 0xa81b5c, 0x5a6470, 0x8bc21f].map(rgb);

  // ---- canvases ---------------------------------------------------------------------
  function crowdAtlas(THREE) {
    const W = 1024, H = 512, cv = canvas(W, H); if (!cv) return null;
    const g = cv.getContext("2d"), R = rng(4242);
    g.clearRect(0, 0, W, H);
    const shirts = ["#d42a2a", "#f5c518", "#2456d6", "#ffffff", "#111111", "#f07a1a", "#1e9e4a", "#8a8f96", "#e05aa0", "#1b2a55", "#b8e0ff", "#7a1f1f", "#f2f2f2", "#3a3a3a", "#ffda4a", "#00a0b0"];
    const skins = ["#f1c9a5", "#e0ac84", "#c68a60", "#a0663e", "#7a4a2a", "#5a3620"];
    const hairs = ["#1a1410", "#3b2616", "#6b4a2a", "#b08850", "#d8c8a0", "#777777"];
    for (let v = 0; v < 32; v++) {
      const shirt = shirts[(R() * shirts.length) | 0], skin = skins[(R() * skins.length) | 0], hair = hairs[(R() * hairs.length) | 0];
      const cap = R() < 0.4 ? shirts[(R() * shirts.length) | 0] : null, wide = 38 + R() * 12, head = 10 + R() * 2.5;
      for (let pose = 0; pose < 2; pose++) {
        const col = v % 16, row = (v >> 4) + pose * 2, x0 = col * 64, y0 = row * 128, cx = x0 + 32;
        // torso
        g.fillStyle = shirt; g.beginPath();
        g.moveTo(cx - wide / 2, y0 + 128); g.lineTo(cx - wide / 2, y0 + 66); g.quadraticCurveTo(cx - wide / 2, y0 + 58, cx - wide / 2 + 8, y0 + 57);
        g.lineTo(cx + wide / 2 - 8, y0 + 57); g.quadraticCurveTo(cx + wide / 2, y0 + 58, cx + wide / 2, y0 + 66); g.lineTo(cx + wide / 2, y0 + 128); g.closePath(); g.fill();
        if (R() < 0.35) { g.fillStyle = "rgba(255,255,255,0.8)"; g.fillRect(cx - wide / 2, y0 + 78, wide, 4); }
        // neck + head
        g.fillStyle = skin; g.fillRect(cx - 4, y0 + 48, 8, 10);
        g.beginPath(); g.arc(cx, y0 + 42, head, 0, Math.PI * 2); g.fill();
        g.fillStyle = hair; g.beginPath(); g.arc(cx, y0 + 40, head, Math.PI, Math.PI * 2); g.fill();
        if (cap) { g.fillStyle = cap; g.beginPath(); g.arc(cx, y0 + 39, head + 0.5, Math.PI, Math.PI * 2); g.fill(); g.fillRect(cx - head - 1, y0 + 38, head * 2 + 7, 3); }
        // arms
        g.fillStyle = shirt;
        if (pose === 0) {
          g.fillRect(cx - wide / 2 - 5, y0 + 62, 7, 40); g.fillRect(cx + wide / 2 - 2, y0 + 62, 7, 40);
          g.fillStyle = skin; g.fillRect(cx - wide / 2 - 5, y0 + 100, 7, 8); g.fillRect(cx + wide / 2 - 2, y0 + 100, 7, 8);
        } else {
          const lean = (R() - 0.5) * 10;
          g.save(); g.translate(cx - wide / 2 + 3, y0 + 62); g.rotate(-0.35 + lean * 0.01); g.fillRect(-4, -46, 8, 48); g.fillStyle = skin; g.beginPath(); g.arc(0, -48, 5, 0, 7); g.fill(); g.restore();
          g.fillStyle = shirt;
          g.save(); g.translate(cx + wide / 2 - 3, y0 + 62); g.rotate(0.35 + lean * 0.01); g.fillRect(-4, -46, 8, 48); g.fillStyle = skin; g.beginPath(); g.arc(0, -48, 5, 0, 7); g.fill(); g.restore();
        }
      }
    }
    const t = tex(THREE, cv, false);
    t.generateMipmaps = true;
    return t;
  }
  function haloTex(THREE) {
    const S = 128, cv = canvas(S, S); if (!cv) return null;
    const g = cv.getContext("2d"), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, "rgba(255,250,235,1)"); gr.addColorStop(0.18, "rgba(255,240,210,0.55)"); gr.addColorStop(0.5, "rgba(255,225,180,0.12)"); gr.addColorStop(1, "rgba(255,220,170,0)");
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    return tex(THREE, cv, false);
  }
  function flagTex(THREE) {
    const cv = canvas(256, 64); if (!cv) return null;
    const g = cv.getContext("2d");
    const cols = ["#16b23c", "#f4d31c", "#f4f4f0"];
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(i * 64, 0, 64, 64); });
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { g.fillStyle = (i + j) & 1 ? "#111" : "#f4f4f0"; g.fillRect(192 + i * 8, j * 8, 8, 8); }
    const t = tex(THREE, cv, false); t.repeat.set(0.25, 1); return t;
  }
  function skylineTex(THREE) {
    const W = 1024, H = 256, cv = canvas(W, H); if (!cv) return null;
    const g = cv.getContext("2d"), R = rng(909);
    g.clearRect(0, 0, W, H);
    // far hills
    g.fillStyle = "#0f1420"; g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) g.lineTo(x, H * 0.52 - Math.sin(x * 0.006) * 26 - Math.sin(x * 0.021 + 1.3) * 12 - R() * 4);
    g.lineTo(W, H); g.closePath(); g.fill();
    // the town: low blocks, a few towers, lit windows
    let x = 0;
    while (x < W) {
      const w = 14 + R() * 40, tall = R() < 0.08, h = tall ? 70 + R() * 90 : 14 + R() * 40;
      g.fillStyle = R() < 0.5 ? "#0b0f18" : "#0d121c"; g.fillRect(x, H - 40 - h, w, h + 40);
      for (let wy = H - 40 - h + 5; wy < H - 30; wy += 6) for (let wx = x + 3; wx < x + w - 3; wx += 5) if (R() < 0.18) {
        g.fillStyle = R() < 0.7 ? "rgba(255,210,140,0.9)" : "rgba(190,215,255,0.8)"; g.fillRect(wx, wy, 2, 2);
      }
      x += w + (R() < 0.3 ? R() * 30 : 0);
    }
    // the glow of the stadium lights on the haze
    const gr = g.createLinearGradient(0, H * 0.3, 0, H);
    gr.addColorStop(0, "rgba(40,50,70,0)"); gr.addColorStop(1, "rgba(40,50,70,0.35)"); g.fillStyle = gr; g.fillRect(0, H * 0.3, W, H * 0.7);
    const t = tex(THREE, cv, true); t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(4, 1); return t;
  }
  function screenCanvas(w, h) { const cv = canvas(w, h); return cv; }

  // =====================================================================
  function build(THREE, core, opts) {
    opts = opts || {};
    const hi = opts.quality !== "low";
    const D = core.DIMS, L = D.L, PIT = core.PIT;
    const SP = spec(core);
    const group = new THREE.Group(); group.name = "race_venue";
    const surroundings = new THREE.Group(); surroundings.name = "surroundings"; group.add(surroundings);
    const spots = towerSpots(core, hi ? 18 : 12);
    const lit = lightField(core, spots);
    const B = new Buckets({ lit }), BO = new Buckets({ lit });       // BO: surroundings
    const F = {}, F2 = {}, SEC = {};
    const up = [0, 1, 0], white = [1, 1, 1];
    const W3 = (s, u, y) => { core.toWorld(s, u, y, F); return [F.x, F.y, F.z]; };
    const nrm = (s) => { core.frame(s, F2); return [F2.nx, 0, F2.nz]; };
    const inw = (s) => { core.frame(s, F2); return [-F2.nx, 0, -F2.nz]; };
    const tan = (s) => { core.frame(s, F2); return [F2.tx, 0, F2.tz]; };
    B.get("glow", { lit: null }); B.get("halo", { lit: null }); BO.get("glow", { lit: null });
    const S = (x, z) => B.get("struct#" + chunk(x, z));
    const Sat = (s, u) => { core.toWorld(s, u, 0, F); return S(F.x, F.z); };

    // ---- materials ------------------------------------------------------------------
    const signs = signAtlas(THREE);
    const T = { noise: null, crowd: crowdAtlas(THREE), halo: haloTex(THREE), flag: flagTex(THREE), sky: skylineTex(THREE) };
    {
      const cv = canvas(256, 256);
      if (cv) {
        const g = cv.getContext("2d"), R = rng(31); g.fillStyle = "#e6e6e6"; g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 8000; i++) { const v = 185 + R() * 70 | 0; g.fillStyle = "rgba(" + v + "," + v + "," + v + ",0.55)"; g.fillRect(R() * 256, R() * 256, 1 + R() * 2.5, 1 + R() * 2.5); }
        T.noise = tex(THREE, cv, true);
      }
    }
    const pylonCv = screenCanvas(128, 1024), jumboCv = screenCanvas(512, 288);
    T.pylon = tex(THREE, pylonCv, false); T.jumbo = tex(THREE, jumboCv, false);
    const M = {
      struct: new THREE.MeshLambertMaterial({ map: T.noise, vertexColors: true }),
      signs: new THREE.MeshLambertMaterial({ map: signs.tex, vertexColors: true }),
      glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      halo: new THREE.MeshBasicMaterial({ map: T.halo, color: 0xfff0d8, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      lamps: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      flag: new THREE.MeshBasicMaterial({ map: T.flag, side: THREE.DoubleSide }),
      pylon: new THREE.MeshBasicMaterial({ map: T.pylon, toneMapped: false }),
      jumbo: new THREE.MeshBasicMaterial({ map: T.jumbo, toneMapped: false }),
      sky: new THREE.MeshBasicMaterial({ map: T.sky, alphaTest: 0.4, side: THREE.BackSide, fog: false }),
      crowd: new THREE.MeshBasicMaterial({ map: T.crowd, alphaTest: 0.5 }),
    };
    M.lot = M.struct;

    // ---- stand samples: regular steps + aisle bands every 24 m of mid-bowl arc ------------------
    const UMID = 28, aisles = [];
    { let arc = 0, next = 12; for (let s = 0; s < L; s += 0.5) { arc += 0.5 * (1 + UMID * core.frame(s, F).k); if (arc >= next) { aisles.push(s); next += 24; } } }
    const aisleHalf = (s) => 0.65 / (1 + UMID * core.frame(s, F).k);
    const pts = [];
    {
      const base = hi ? 5 : 10;
      for (let s = 0; s < L;) { pts.push({ s, a: 0 }); s += base / (1 + 30 * Math.abs(core.frame(s, F).k)); }
      for (const a of aisles) { const h = aisleHalf(a); pts.push({ s: a - h, a: 1 }, { s: a + h, a: 2 }); }
      for (const e of [SUITES.s0, SUITES.s1, -GATE.hw, GATE.hw]) pts.push({ s: core.wrapS(e), a: 3 });
      pts.sort((p, q) => p.s - q.s);
    }
    const bands = aisles.map((a) => [a - aisleHalf(a), a + aisleHalf(a)]);
    const inAisle = (s) => { for (const b of bands) if (s > b[0] && s < b[1]) return true; return false; };
    const sam = [];
    for (const p of pts) {
      if (p.a === 0) { if (inAisle(p.s)) continue; if (bands.some((b) => Math.abs(p.s - b[0]) < 0.6 || Math.abs(p.s - b[1]) < 0.6)) continue; }
      if (sam.length && p.s - sam[sam.length - 1] < 0.05) continue;
      sam.push(p.s);
    }
    sam.push(L + sam[0]);

    // seat colours by stand
    const NAVY = [0.13, 0.2, 0.44], RED = [0.52, 0.09, 0.09], SLATE = [0.24, 0.27, 0.32], CONC = [0.66, 0.66, 0.63], FASCIA = [0.16, 0.19, 0.25], DARK = [0.035, 0.035, 0.04];
    const seatCol = (s, tier) => {
      const f = core.wrapS(s) / L;
      if (f < 0.12 || f > 0.88) return NAVY;
      if (f > 0.38 && f < 0.62) return tier ? NAVY : SLATE;
      return tier ? NAVY : RED;
    };

    // ---- the bowl ------------------------------------------------------------------------
    const T1 = STAND.T1, T2 = STAND.T2, TRD = STAND.TREAD, RS = STAND.RISER;
    const crowd = { x: [], y: [], z: [], yaw: [], v: [], ph: [], rate: [], lit: [], ch: [] };
    const RC = rng(2025);
    const secA = {}, secB = {};
    for (let i = 0; i < sam.length - 1; i++) {
      const s0 = sam[i], s1 = sam[i + 1], sm = (s0 + s1) / 2, aisle = inAisle(sm);
      standSection(core, s0, secA); standSection(core, s1, secB);
      const cm = W3(sm, 30, 0), me = S(cm[0], cm[2]);
      const iw = inw(sm), ow = nrm(sm);
      // a quad between u0..u1 at heights ya(s0)/yb(s1) (horizontal) or a vertical face at u from y0 to y1
      const flat = (u0, u1, fa, col) => me.quad(W3(s0, u0, fa(secA)), W3(s1, u0, fa(secB)), W3(s1, u1, fa(secB)), W3(s0, u1, fa(secA)), col, up);
      const wall = (u, f0, f1, col, face) => me.quad(W3(s0, u, f0(secA)), W3(s1, u, f0(secB)), W3(s1, u, f1(secB)), W3(s0, u, f1(secA)), col, face);
      const suite = inSuites(core, sm);
      // walkway, the fascia (retaining) wall and its parapet
      flat(STAND.WALK, STAND.U0 - 0.25, (c) => c.wallTop, CONC);
      wall(STAND.U0 - 0.25, (c) => c.wallTop, (c) => c.y0 + 0.95, FASCIA, iw);
      flat(STAND.U0 - 0.25, STAND.U0, (c) => c.y0 + 0.95, CONC);
      // rows
      const rows = (tier, uStart, yOf) => {
        const n = tier ? T2 : T1;
        for (let r = 0; r < n; r++) {
          const ua = uStart + r * TRD, yf = (c) => yOf(c) + r * RS;
          if (aisle) flat(ua, ua + TRD, yf, CONC);
          else {
            flat(ua, ua + 0.3, yf, CONC);
            flat(ua + 0.3, ua + TRD, yf, seatCol(sm, tier));
            if (hi) {
              const sc = seatCol(sm, tier), dk = [sc[0] * 0.8, sc[1] * 0.8, sc[2] * 0.8];
              me.quad(W3(s0, ua + TRD - 0.12, yf(secA)), W3(s1, ua + TRD - 0.12, yf(secB)), W3(s1, ua + TRD - 0.04, yf(secB) + 0.44), W3(s0, ua + TRD - 0.04, yf(secA) + 0.44), dk, iw);
            }
          }
          wall(ua + TRD, yf, (c) => yf(c) + RS, CONC, iw);
          // the crowd on this row
          if (!aisle) {
            const us = ua + 0.55, len = arcAt(core, s1, us, F2) - arcAt(core, s0, us, F2);
            const n2 = Math.floor(len / 0.56);
            const f = core.wrapS(sm) / L, front = f < 0.13 || f > 0.87;
            const occ = (hi ? 1 : 0.34) * (front ? 0.9 : 0.66) * (tier ? 0.92 : 1);
            for (let k = 0; k < n2; k++) {
              if (RC() > occ) continue;
              const ss = s0 + (k + 0.5) / n2 * (s1 - s0);
              core.frame(ss, F2);
              const ys = yOf(standSection(core, ss, SEC)) + r * RS;
              const stand = RC() < 0.22 ? 0.42 : 0;
              core.toWorld(ss, us + (RC() - 0.5) * 0.1, ys + 0.38 + stand, F);
              crowd.x.push(F.x); crowd.y.push(F.y); crowd.z.push(F.z);
              crowd.yaw.push(Math.atan2(-F2.nx, -F2.nz) + (RC() - 0.5) * 0.3);
              crowd.v.push((RC() * 32) | 0); crowd.ph.push(RC()); crowd.rate.push(RC());
              crowd.lit.push(Math.min(1.25, lit(F.x, F.y, F.z) * (0.85 + RC() * 0.25)));
              crowd.ch.push(chunk(F.x, F.z));
            }
          }
        }
      };
      rows(0, STAND.U0, (c) => c.y0);
      flat(STAND.uC0, STAND.uC1, (c) => c.yX, CONC);                                   // cross-aisle
      wall(STAND.uC1, (c) => c.yX, (c) => c.y2, FASCIA, iw);                             // vom wall
      rows(1, STAND.uC1, (c) => c.y2);
      if (hi && !aisle) me.beam(W3(s0, STAND.uC0 + 0.12, secA.yX + 1.0), W3(s1, STAND.uC0 + 0.12, secB.yX + 1.0), 0.03, [0.5, 0.52, 0.55], 3);
      // top: concourse, parapet / suites, the outer wall
      if (!suite) {
        flat(STAND.uTop, STAND.uBack - 0.25, (c) => c.yConc, CONC);
        wall(STAND.uBack - 0.25, (c) => c.yConc, (c) => c.yConc + STAND.PARA, CONC, iw);
        flat(STAND.uBack - 0.25, STAND.uBack, (c) => c.yConc + STAND.PARA, CONC);
        wall(STAND.uBack, () => 0, (c) => c.yConc + STAND.PARA, [0.55, 0.55, 0.53], ow);
      } else {
        const uB = STAND.uBack + SUITES.depth, uF = STAND.uTop - SUITES.overhang;
        const yF = (c) => c.yConc + SUITES.lift;
        flat(STAND.uTop, uB - 0.2, (c) => c.yConc, CONC);
        me.quad(W3(s0, uF, yF(secA)), W3(s1, uF, yF(secB)), W3(s1, uB, yF(secB)), W3(s0, uB, yF(secA)), [0.4, 0.4, 0.42], [0, -1, 0]);   // soffit
        // glass storeys (lit rooms) with the slab between and the roof fascia
        const gl = B.get("glow"), sg = B.get("signs");
        let y = 0; const lean = 0.6;
        const band = (h, kind) => {
          const ya = (c) => yF(c) + y, yb = (c) => yF(c) + y + h, la = lean * y / SUITE_H, lb = lean * (y + h) / SUITE_H;
          const a = W3(s0, uF - la, ya(secA)), b = W3(s1, uF - la, ya(secB)), c = W3(s1, uF - lb, yb(secB)), d = W3(s0, uF - lb, yb(secA));
          if (kind === "glass") gl.quad(a, b, c, d, y < 3 ? [0.7, 0.57, 0.38] : [0.62, 0.54, 0.41], iw);
          else if (kind === "sign") { const r = signs.sponsorsWide[(Math.floor(core.wrapS(sm + 400) / 26)) % 4], f0 = ((core.wrapS(s0 + 400)) % 26) / 26, f1 = f0 + (s1 - s0) / 26; sg.quad(a, b, c, d, white, iw, signs.uvBL(r, 1 - f0, Math.max(0, 1 - f1))); }
          else me.quad(a, b, c, d, [0.86, 0.86, 0.84], iw);
          y += h;
        };
        band(0.9, "sign"); band(3.2, "glass"); band(0.6, "slab"); band(3.2, "glass"); band(0.8, "slab");
        const yR = (c) => yF(c) + SUITE_H;
        me.quad(W3(s0, uF - lean, yR(secA)), W3(s1, uF - lean, yR(secB)), W3(s1, uB, yR(secB)), W3(s0, uB, yR(secA)), [0.5, 0.5, 0.5], up);
        wall(uB, Math.abs(core.ds(0, sm)) < GATE.hw ? () => GATE.h : () => 0, yR, [0.55, 0.55, 0.53], ow);
        // mullions at the segment edges
        if (hi) me.beam(W3(s0, uF - 0.05, yF(secA) + 0.9), W3(s0, uF - lean - 0.05, yR(secA) - 0.8), 0.06, [0.2, 0.21, 0.23]);
      }
    }
    // suite block ends
    for (const se of [SUITES.s0, SUITES.s1]) {
      standSection(core, se, SEC); const t = tan(se), sg = se < 0 ? -1 : 1, me = Sat(se, 40);
      const face = [t[0] * sg, 0, t[2] * sg], uB = STAND.uBack + SUITES.depth, uF = STAND.uTop - SUITES.overhang;
      const yF = SEC.yConc + SUITES.lift, yR = yF + SUITE_H;
      me.quad(W3(se, uF, yF), W3(se, uB, yF), W3(se, uB, yR), W3(se, uF - 0.6, yR), [0.8, 0.8, 0.78], face);
      me.quad(W3(se, STAND.uBack, 0), W3(se, uB, 0), W3(se, uB, SEC.yConc), W3(se, STAND.uBack, SEC.yConc), [0.55, 0.55, 0.53], face);
    }

    // ---- fascia sponsor band over the fence, vomitories -------------------------------------------
    {
      const sg = B.get("signs"), n = Math.floor((L + STAND.U0 * Math.PI * 2) / 13.5);
      const th0 = core.T.H[0];
      let k = 0;
      for (let s = 3; s < L - 6; s += 0.5) {
        const arc = s + STAND.U0 * (core.frame(s, F).heading - th0);
        if (arc < k * ((L + STAND.U0 * Math.PI * 2) / n) + 3) continue;
        // a 9.2 m board starting at s, in 3 pieces so it follows the curve
        const k1 = 1 + STAND.U0 * Math.abs(core.frame(s, F).k), len = 9.2 / k1, r = signs.sponsors[k % 8];
        for (let j = 0; j < 3; j++) {
          const a = s + len * j / 3, b = s + len * (j + 1) / 3;
          standSection(core, a, secA); standSection(core, b, secB);
          const u = STAND.U0 - 0.27;
          sg.quad(W3(a, u, secA.wallTop + 0.7), W3(b, u, secB.wallTop + 0.7), W3(b, u, secB.wallTop + 3.0), W3(a, u, secA.wallTop + 3.0), white, inw((a + b) / 2), signs.uvBL(r, 1 - j / 3, 1 - (j + 1) / 3));
        }
        k++;
      }
      // voms: dark portals in the vom wall, midway between every other pair of aisles
      for (let i = 0; i < aisles.length; i += 2) {
        const a = aisles[i], b = aisles[(i + 1) % aisles.length] + (i + 1 >= aisles.length ? L : 0), m = (a + b) / 2;
        const hw = 1.4 / (1 + STAND.uC1 * core.frame(m, F).k);
        standSection(core, m, SEC);
        const me = Sat(m, 30), u = STAND.uC1 - 0.03;
        me.quad(W3(m - hw, u, SEC.yX), W3(m + hw, u, SEC.yX), W3(m + hw, u, SEC.yX + 2.1), W3(m - hw, u, SEC.yX + 2.1), DARK, inw(m));
      }
    }

    // ---- canopies between the towers (not over the suites) --------------------------------------
    {
      const sorted = spots.map((p) => p.s).sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i], b = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + L;
        const gapA = 3 / (1 + STAND.uBack * core.frame(a, F).k), gapB = 3 / (1 + STAND.uBack * core.frame(b, F).k);
        const s0 = a + gapA, s1 = b - gapB;
        if (inSuites(core, s0) || inSuites(core, s1) || inSuites(core, (s0 + s1) / 2)) continue;
        const n = Math.max(2, Math.ceil((s1 - s0) / (hi ? 4 : 8)));
        const uB = STAND.uBack - 0.1, uF = STAND.uTop - CANOPY.reach;
        for (let j = 0; j < n; j++) {
          const sa = s0 + (s1 - s0) * j / n, sb = s0 + (s1 - s0) * (j + 1) / n;
          standSection(core, sa, secA); standSection(core, sb, secB);
          const me = Sat((sa + sb) / 2, 30);
          const bA = secA.yConc + CANOPY.back, bB = secB.yConc + CANOPY.back, fA = secA.yConc + CANOPY.front, fB = secB.yConc + CANOPY.front;
          me.quad(W3(sa, uF, fA + 0.35), W3(sb, uF, fB + 0.35), W3(sb, uB, bB + 0.35), W3(sa, uB, bA + 0.35), [0.62, 0.63, 0.65], up);
          me.quad(W3(sa, uF, fA), W3(sb, uF, fB), W3(sb, uB, bB), W3(sa, uB, bA), [0.3, 0.31, 0.33], [0, -1, 0]);
          me.quad(W3(sa, uF, fA), W3(sb, uF, fB), W3(sb, uF, fB + 0.35), W3(sa, uF, fA + 0.35), [0.85, 0.85, 0.84], inw(sa));
          me.quad(W3(sa, uB, bA), W3(sb, uB, bB), W3(sb, uB, bB + 0.35), W3(sa, uB, bA + 0.35), [0.5, 0.5, 0.5], nrm(sa));
          // a rear column + a cantilever rafter every other piece
          if (j % 2 === 0) {
            me.beam(W3(sa, STAND.uBack - 0.5, secA.yConc + STAND.PARA), W3(sa, STAND.uBack - 0.5, bA), 0.18, [0.45, 0.47, 0.5]);
            me.beam(W3(sa, STAND.uBack - 0.5, bA - 0.05), W3(sa, uF + 0.3, fA - 0.05), 0.12, [0.42, 0.44, 0.47]);
          }
        }
      }
    }

    // ---- light towers: masts, lamp banks, halos --------------------------------------------------
    const gl = B.get("glow"), halo = B.get("halo");
    for (const sp of spots) {
      standSection(core, sp.s, SEC);
      const suite = inSuites(core, sp.s);
      const base = suite ? SEC.yConc + SUITES.lift + SUITE_H : SEC.yConc + STAND.PARA;
      const top = suite ? base + MAST.suite : SEC.yConc + MAST.stand;
      const p0 = W3(sp.s, sp.u, base), p1 = W3(sp.s, sp.u, top), me = S(p0[0], p0[2]);
      me.beam(p0, p1, 0.42, [0.5, 0.52, 0.55]);
      if (hi) { const q = W3(sp.s, sp.u - 1.4, base); me.beam(q, W3(sp.s, sp.u, base + (top - base) * 0.45), 0.12, [0.5, 0.52, 0.55]); }
      // the bank: faces the aim point on the track
      const aim = W3(sp.s, -1, core.surfaceY(sp.s, -1));
      const c = W3(sp.s, sp.u - 2.2, top + 1.2);
      me.beam(p1, W3(sp.s, sp.u - 2.2, top + 0.2), 0.2, [0.5, 0.52, 0.55]);
      let zx = aim[0] - c[0], zy = aim[1] - c[1], zz = aim[2] - c[2]; const zl = Math.hypot(zx, zy, zz); zx /= zl; zy /= zl; zz /= zl;
      const t = tan(sp.s); let xx = t[0], xz = t[2];
      // Y = Z x X
      let yx = zy * xz - zz * 0, yy = zz * xx - zx * xz, yz = zx * 0 - zy * xx; const yl = Math.hypot(yx, yy, yz); yx /= yl; yy /= yl; yz /= yl;
      const HW = 3.6, HH = 1.9;
      me.boxv(c, [xx * HW, 0, xz * HW], [yx * HH, yy * HH, yz * HH], [zx * 0.3, zy * 0.3, zz * 0.3], [0.16, 0.17, 0.19]);
      const fc = [c[0] + zx * 0.32, c[1] + zy * 0.32, c[2] + zz * 0.32];
      const face = [zx, zy, zz];
      for (let a = 0; a < 6; a++) for (let b = 0; b < 3; b++) {
        const ox = -HW + 0.5 + a * (2 * HW - 1) / 5, oy = -HH + 0.45 + b * (2 * HH - 0.9) / 2, r = 0.42;
        const P = (dx, dy) => [fc[0] + xx * (ox + dx) + yx * (oy + dy), fc[1] + yy * (oy + dy), fc[2] + xz * (ox + dx) + yz * (oy + dy)];
        gl.quad(P(-r, -r), P(r, -r), P(r, r), P(-r, r), [1, 0.97, 0.9], face);
      }
      const hc = [fc[0] + zx * 0.6, fc[1] + zy * 0.6, fc[2] + zz * 0.6], HX = 8, HY = 4.5;
      const Q = (dx, dy) => [hc[0] + xx * dx + yx * dy, hc[1] + yy * dy, hc[2] + xz * dx + yz * dy];
      halo.quad(Q(-HX, -HY), Q(HX, -HY), Q(HX, HY), Q(-HX, HY), white, face, [0, 0, 1, 0, 1, 1, 0, 1]);
    }

    // ---- main gate: a lit portal in the back of the main grandstand --------------------------------
    {
      const s = 0, uO = SP.outerU(0), me = Sat(0, uO), ow = nrm(0), t = tan(0);
      const Wd = GATE.hw * 2, Hd = GATE.h, off = (ds, du, y) => { core.frame(s, F2); return [F2.x + F2.tx * ds + F2.nx * du, y, F2.z + F2.tz * ds + F2.nz * du]; };
      // recess back (warm light) + side jambs + lintel
      gl.quad(off(-Wd / 2, uO - 1.5, 0.02), off(Wd / 2, uO - 1.5, 0.02), off(Wd / 2, uO - 1.5, Hd), off(-Wd / 2, uO - 1.5, Hd), [0.95, 0.8, 0.55], ow);
      for (const sg of [-1, 1]) {
        me.quad(off(sg * Wd / 2, uO - 1.5, 0), off(sg * Wd / 2, uO + 0.05, 0), off(sg * Wd / 2, uO + 0.05, Hd), off(sg * Wd / 2, uO - 1.5, Hd), [0.3, 0.3, 0.32], [-t[0] * sg, 0, -t[2] * sg]);
        me.box(...off(sg * (Wd / 2 + 0.7), uO + 0.5, 0), 1.4, Hd + 2.4, 1.2, core.frame(0, F2).yaw, [0.82, 0.82, 0.8]);
      }
      me.quad(off(-Wd / 2, uO - 1.5, Hd), off(Wd / 2, uO - 1.5, Hd), off(Wd / 2, uO + 0.05, Hd), off(-Wd / 2, uO + 0.05, Hd), [0.3, 0.3, 0.32], [0, -1, 0]);
      // a canopy slab out over the plaza with a light strip under it
      me.box(...off(0, uO + 3.2, Hd + 0.3), 6.4, 0.6, Wd + 5, core.frame(0, F2).yaw, [0.85, 0.85, 0.83]);
      gl.quad(off(-Wd / 2, uO + 0.6, Hd + 0.28), off(Wd / 2, uO + 0.6, Hd + 0.28), off(Wd / 2, uO + 5.8, Hd + 0.28), off(-Wd / 2, uO + 5.8, Hd + 0.28), [1, 0.93, 0.8], [0, -1, 0]);
      // turnstile posts
      for (let i = 0; i < 8; i++) me.box(...off(-Wd / 2 + 1 + i * (Wd - 2) / 7, uO - 0.4, 0), 0.4, 1.05, 0.7, core.frame(0, F2).yaw, [0.55, 0.57, 0.6]);
      // the plaza
      const pz = BO.get("lot");
      pz.quad(off(-22, uO, 0.03), off(22, uO, 0.03), off(22, uO + 24, 0.03), off(-22, uO + 24, 0.03), [0.62, 0.61, 0.58], up);
    }

    // ---- start/finish gantry + start lights + flag stand ----------------------------------------------
    const lampQuads = [];
    const lampMe = new Mesher({});
    let flagMesh = null; const FLAGSTAND = { y: 7.7 };
    {
      const s = 0, me = Sat(0, 0), steel = [0.78, 0.79, 0.8], t = tan(0);
      standSection(core, 0, SEC);
      const YB = SEC.wallTop + D.FENCE_H + 2.0, HB = 0.7, SW = 0.7, uI = -17.5, uO = 11.65;
      const P = (ds, u, y) => W3(s + ds, u, y);
      // legs: 4-post towers
      for (const [u, y0] of [[uI, 0], [uO, SEC.wallTop]]) {
        for (const ds of [-SW, SW]) for (const du of [-0.5, 0.5]) me.beam(P(ds, u + du, y0), P(ds, u + du, YB + HB), 0.1, steel);
        for (let y = y0 + 1.2; y < YB; y += 1.6) { me.beam(P(-SW, u - 0.5, y), P(SW, u + 0.5, y + 1.2), 0.05, steel); me.beam(P(SW, u - 0.5, y), P(-SW, u + 0.5, y + 1.2), 0.05, steel); }
        me.box(...P(0, u, y0), 2.4, 0.4, 2.2, core.frame(0, F2).yaw, [0.6, 0.6, 0.58]);
      }
      // truss: 4 chords + diagonals on the two faces
      for (const ds of [-SW, SW]) for (const dy of [-HB, HB]) me.beam(P(ds, uI, YB + dy), P(ds, uO, YB + dy), 0.09, steel);
      const n = Math.round((uO - uI) / 1.45);
      for (let i = 0; i < n; i++) {
        const ua = uI + (uO - uI) * i / n, ub = uI + (uO - uI) * (i + 1) / n;
        for (const ds of [-SW, SW]) me.beam(P(ds, ua, YB - HB), P(ds, ub, YB + HB), 0.045, steel);
        me.beam(P(-SW, ub, YB - HB), P(SW, ub, YB - HB), 0.04, steel);
      }
      // sponsor boards on both faces of the truss
      const sg = B.get("signs"), r = signs.sponsorsWide[0];
      const bh = 1.5, bu0 = -16, bu1 = 10;
      sg.quad(P(-SW - 0.12, bu0, YB - bh / 2), P(-SW - 0.12, bu1, YB - bh / 2), P(-SW - 0.12, bu1, YB + bh / 2), P(-SW - 0.12, bu0, YB + bh / 2), white, [-t[0], 0, -t[2]], signs.uvBL(r));
      sg.quad(P(SW + 0.12, bu0, YB - bh / 2), P(SW + 0.12, bu1, YB - bh / 2), P(SW + 0.12, bu1, YB + bh / 2), P(SW + 0.12, bu0, YB + bh / 2), white, [t[0], 0, t[2]], signs.uvBL(signs.sponsorsWide[1], 1, 0));
      // light housing hanging under the truss over the centre of the surface
      { const n0 = nrm(0); me.boxv(P(-SW - 0.1, 0, YB - HB - 1.1), [n0[0] * 3.5, 0, n0[2] * 3.5], [0, 1.0, 0], [t[0] * 0.25, 0, t[2] * 0.25], [0.05, 0.05, 0.055]); }
      for (const du of [-3.2, 3.2]) me.beam(P(-SW, du, YB - HB), P(-SW - 0.1, du, YB - HB - 0.3), 0.05, steel);
      // 5 columns x 2 lamps, facing the grid (cars arrive from -s)
      for (let c = 0; c < 5; c++) for (let rr = 0; rr < 2; rr++) {
        const u = -2.4 + c * 1.2, y = YB - HB - 1.1 + (rr ? -0.42 : 0.42), sz = 0.34, ds = -SW - 0.37;
        lampQuads.push(lampMe.nv);
        lampMe.quad(P(ds, u - sz, y - sz), P(ds, u + sz, y - sz), P(ds, u + sz, y + sz), P(ds, u - sz, y + sz), [0.08, 0.02, 0.02], [-t[0], 0, -t[2]]);
      }
      // flag stand: a platform off the gantry front over the outside of the surface
      const fy = YB - 5.2, fs = -SW - 1.9; FLAGSTAND.y = fy;
      me.box(...P(fs, 8.7, fy - 0.25), 3.6, 0.25, 2.4, core.frame(0, F2).yaw, [0.25, 0.26, 0.28]);
      for (const du of [7.0, 10.3]) me.beam(P(fs - 1.1, du, fy), P(fs + 1.1, du, fy), 0.04, steel);
      me.beam(P(fs - 1.1, 7.0, fy + 1.05), P(fs + 1.1, 7.0, fy + 1.05), 0.04, steel);
      me.beam(P(fs - 1.1, 7.0, fy + 1.05), P(fs - 1.1, 10.3, fy + 1.05), 0.04, steel);
      me.beam(P(fs + 1.1, 7.0, fy + 1.05), P(fs + 1.1, 10.3, fy + 1.05), 0.04, steel);
      for (const du of [7.0, 10.3]) me.beam(P(fs, du, fy), P(-SW, du, YB - HB), 0.06, steel);
      // the flagman
      const man = P(fs, 8.6, fy);
      me.box(man[0], fy, man[2], 0.34, 0.85, 0.22, core.frame(0, F2).yaw, [0.1, 0.1, 0.12]);
      me.box(man[0], fy + 0.85, man[2], 0.42, 0.62, 0.26, core.frame(0, F2).yaw, [0.92, 0.92, 0.9]);
      me.box(man[0], fy + 1.5, man[2], 0.22, 0.26, 0.22, core.frame(0, F2).yaw, [0.78, 0.6, 0.45]);
      const fg = new THREE.PlaneGeometry(1.3, 0.85); fg.translate(0.65, 0, 0);
      flagMesh = new THREE.Mesh(fg, M.flag); flagMesh.name = "flag";
      const hand = P(fs, 8.2, fy + 1.55);
      flagMesh.position.set(hand[0], hand[1], hand[2]);
      flagMesh.rotation.y = core.frame(0, F2).yaw;           // flies out over the track, toward -n
      group.add(flagMesh);
    }

    // ---- infield: garages, war wagons, haulers, pylon, video board, care + media, flag poles --------------
    const infield = []; let bays = 0;                                          // footprints for the check: [s, u, halfLenS, halfW]
    {
      const g0 = PIT.boxS(0) - PIT.boxLen / 2 - 3, g1 = PIT.boxS(PIT.boxes - 1) + PIT.boxLen / 2 + 3;
      const uF = PIT.u - PIT.w / 2 - 0.6, uB = uF - 9, H = 5.2;
      infield.push([(g0 + g1) / 2, (uF + uB) / 2, (g1 - g0) / 2, (uF - uB) / 2]);
      const step = 3;
      for (let s = g0; s < g1 - 0.01; s += step) {
        const s1 = Math.min(g1, s + step), me = Sat(s, uF);
        me.quad(W3(s, uB, H), W3(s1, uB, H), W3(s1, uF, H), W3(s, uF, H), [0.55, 0.56, 0.58], up);
        me.quad(W3(s, uB, 0), W3(s1, uB, 0), W3(s1, uB, H), W3(s, uB, H), [0.7, 0.7, 0.68], inw(s));
        me.quad(W3(s, uF, H - 1.2), W3(s1, uF, H - 1.2), W3(s1, uF, H), W3(s, uF, H), [0.88, 0.88, 0.86], nrm(s));
        // the pit-side canopy
        me.quad(W3(s, uF, H - 0.9), W3(s1, uF, H - 0.9), W3(s1, uF + 2.6, H - 0.7), W3(s, uF + 2.6, H - 0.7), [0.8, 0.8, 0.8], up);
        me.quad(W3(s, uF, H - 0.95), W3(s1, uF, H - 0.95), W3(s1, uF + 2.6, H - 0.75), W3(s, uF + 2.6, H - 0.75), [0.35, 0.35, 0.36], [0, -1, 0]);
      }
      for (const se of [g0, g1]) { const sg = se < 0 ? -1 : 1, t = tan(se); Sat(se, uF).quad(W3(se, uB, 0), W3(se, uF, 0), W3(se, uF, H), W3(se, uB, H), [0.7, 0.7, 0.68], [t[0] * sg, 0, t[2] * sg]); }
      for (const [a, b] of [[g0, PIT.boxS(0) - PIT.boxLen / 2], [PIT.boxS(PIT.boxes - 1) + PIT.boxLen / 2, g1]]) Sat(a, uF).quad(W3(a, uF, 0), W3(b, uF, 0), W3(b, uF, 4.0), W3(a, uF, 4.0), [0.84, 0.84, 0.82], nrm(a));
      // bays: an open roller door per pit box (team stripe over it), pillars between
      for (let b = 0; b < PIT.boxes; b++) {
        const s = PIT.boxS(b), hw = 3.4, me = Sat(s, uF), tc = TEAM[b % TEAM.length], ow = nrm(s);
        me.quad(W3(s - hw, uF + 0.01, 0), W3(s + hw, uF + 0.01, 0), W3(s + hw, uF + 0.01, 3.8), W3(s - hw, uF + 0.01, 3.8), [0.06, 0.06, 0.07], ow);
        me.quad(W3(s - hw, uF + 0.02, 3.8), W3(s + hw, uF + 0.02, 3.8), W3(s + hw, uF + 0.02, 4.0), W3(s - hw, uF + 0.02, 4.0), tc, ow);
        gl.quad(W3(s - hw + 0.3, uF + 0.03, 3.45), W3(s + hw - 0.3, uF + 0.03, 3.45), W3(s + hw - 0.3, uF + 0.03, 3.62), W3(s - hw + 0.3, uF + 0.03, 3.62), [1, 0.96, 0.88], ow);
        // wall between doors
        for (const e of [-1, 1]) { const a = s + e * hw, c = s + e * PIT.boxLen / 2; me.quad(W3(Math.min(a, c), uF, 0), W3(Math.max(a, c), uF, 0), W3(Math.max(a, c), uF, 4.0), W3(Math.min(a, c), uF, 4.0), [0.84, 0.84, 0.82], ow); }
        // war wagon on the grass strip, level with the box
        const wu = PIT.wallU + 1.75, wy = 0, yaw = core.frame(s, F2).yaw;
        const wp = W3(s, wu, wy), wm = S(wp[0], wp[2]);
        wm.box(wp[0], 0.35, wp[2], 1.6, 1.25, 2.9, yaw, tc);
        wm.box(wp[0], 0.05, wp[2], 1.5, 0.3, 2.6, yaw, [0.08, 0.08, 0.08]);
        for (const e of [-1.2, 1.2]) { const q = W3(s + e, wu, 0); wm.beam([q[0], 1.6, q[2]], [q[0], 3.3, q[2]], 0.05, [0.3, 0.3, 0.32]); }
        wm.box(wp[0], 3.3, wp[2], 2.0, 0.12, 3.2, yaw, tc);
        const tv = W3(s, wu + 0.55, 2.6); gl.quad(W3(s - 0.5, wu + 0.56, 2.35), W3(s + 0.5, wu + 0.56, 2.35), W3(s + 0.5, wu + 0.56, 2.95), W3(s - 0.5, wu + 0.56, 2.95), [0.25, 0.45, 0.8], nrm(s));
        void tv; bays++;
      }
      // haulers: 12 transporters nose-in behind the garages, two groups either side of the pylon
      const hs = []; for (let i = 0; i < 6; i++) { hs.push(-72 + i * 8.5); hs.push(18 + i * 8.5); }
      hs.forEach((s, i) => {
        const tc = TEAM[i % TEAM.length], yaw = core.frame(s, F2).yaw, n = [F2.nx, 0, F2.nz];
        const cab = W3(s, uB - 4.8, 0), tr = W3(s, uB - 14.5, 0), me = S(tr[0], tr[2]);
        me.box(cab[0], 0.55, cab[2], 3.1, 3.0, 2.5, yaw, tc);
        me.box(cab[0], 0.0, cab[2], 3.0, 0.6, 2.2, yaw, [0.08, 0.08, 0.08]);
        me.box(tr[0], 1.1, tr[2], 16, 3.0, 2.6, yaw, [0.94, 0.94, 0.92], { cols: [null, null, null, null, tc, tc] });
        me.box(tr[0], 0.0, tr[2], 15, 1.1, 2.3, yaw, [0.08, 0.08, 0.08]);
        // livery panels on both trailer sides
        const sg = B.get("signs"), r = signs.sponsors[i % 8];
        for (const e of [-1, 1]) {
          const t = tan(s), side = [t[0] * e, 0, t[2] * e], ctr = W3(s + e * 1.32, uB - 15.0, 2.55);
          const P = (du, dy) => [ctr[0] - n[0] * du, ctr[1] + dy, ctr[2] - n[2] * du];
          const uvs = e > 0 ? signs.uvBL(r) : signs.uvBL(r, 1, 0);
          sg.quad(P(-5.8, -1.2), P(5.8, -1.2), P(5.8, 1.2), P(-5.8, 1.2), white, side, uvs);
        }
        infield.push([s, uB - 12, 1.5, 9]);
      });
      // scoring pylon
      {
        const s = -3, u = uB - 3.2, p = W3(s, u, 0), me = S(p[0], p[2]), yaw = core.frame(s, F2).yaw, n = nrm(s), t = tan(s);
        me.box(p[0], 0, p[2], 2.0, 7.5, 3.2, yaw, [0.28, 0.29, 0.31]);
        me.box(p[0], 7.5, p[2], 1.4, 25, 4.2, yaw, [0.08, 0.08, 0.09]);
        me.box(p[0], 32.5, p[2], 1.8, 0.6, 4.6, yaw, [0.85, 0.12, 0.12]);
        const pm = new Mesher({});
        for (const e of [1, -1]) {
          const c = [p[0] + n[0] * 0.72 * e, 20, p[2] + n[2] * 0.72 * e], r = [t[0] * e, 0, t[2] * e];
          const Q = (dx, dy) => [c[0] + r[0] * dx, c[1] + dy, c[2] + r[2] * dx];
          pm.quad(Q(-1.8, -12), Q(1.8, -12), Q(1.8, 12), Q(-1.8, 12), white, [n[0] * e, 0, n[2] * e], [0, 0, 1, 0, 1, 1, 0, 1]);
        }
        const pym = new THREE.Mesh(pm.geometry(THREE), M.pylon); pym.name = "pylon"; pym.matrixAutoUpdate = false; pym.updateMatrix(); group.add(pym);
        infield.push([s, u, 2.2, 1.2]);
      }
      // the video board: four-sided, hung high on a mast at the infield centre
      {
        const me = S(0, 0), jm = new Mesher({}), Y = 27, Hh = 4.6, Ww = 8.2;
        me.beam([0, 0, 0], [0, Y - Hh, 0], 0.9, [0.3, 0.31, 0.33]);
        me.box(0, 0, 0, 3.4, 0.6, 3.4, 0, [0.5, 0.5, 0.5]);
        me.box(0, Y - Hh - 0.3, 0, 2 * Ww + 0.6, 2 * Hh + 1.1, 2 * Ww + 0.6, 0, [0.07, 0.07, 0.08]);
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = [d[0] * (Ww + 0.32), Y, d[1] * (Ww + 0.32)], r = [-d[1], 0, d[0]];
          const rr = [-r[0], 0, -r[2]];                             // right as seen by the viewer = up x d
          const Q = (dx, dy) => [c[0] + rr[0] * dx, c[1] + dy, c[2] + rr[2] * dx];
          jm.quad(Q(-Ww + 0.3, -Hh + 0.3), Q(Ww - 0.3, -Hh + 0.3), Q(Ww - 0.3, Hh - 0.3), Q(-Ww + 0.3, Hh - 0.3), white, [d[0], 0, d[1]], [0, 0, 1, 0, 1, 1, 0, 1]);
        }
        const jmm = new THREE.Mesh(jm.geometry(THREE), M.jumbo); jmm.name = "jumbo"; jmm.matrixAutoUpdate = false; jmm.updateMatrix(); group.add(jmm);
      }
      // care center (white, red band) + ambulance; media center (two storeys, glass band) + dishes
      {
        const s = -118, u = -40, p = W3(s, u, 0), me = S(p[0], p[2]), yaw = core.frame(s, F2).yaw;
        me.box(p[0], 0, p[2], 10, 4.2, 20, yaw, [0.9, 0.9, 0.88]);
        me.box(p[0], 3.2, p[2], 10.1, 0.5, 20.1, yaw, [0.75, 0.1, 0.1]);
        const a = W3(s + 4, u + 8, 0); me.box(a[0], 0.3, a[2], 2.2, 2.4, 6, yaw, [0.95, 0.95, 0.93]); me.box(a[0], 1.4, a[2], 2.25, 0.3, 6.05, yaw, [0.8, 0.12, 0.1]);
        infield.push([s, u, 10, 6]);
      }
      {
        const s = 120, u = -42, p = W3(s, u, 0), me = S(p[0], p[2]), yaw = core.frame(s, F2).yaw, n = nrm(s), t = tan(s);
        me.box(p[0], 0, p[2], 11, 7.6, 26, yaw, [0.62, 0.64, 0.68]);
        const c = [p[0] + n[0] * 5.53, 0, p[2] + n[2] * 5.53];
        const Q = (dx, y) => [c[0] + t[0] * dx, y, c[2] + t[2] * dx];
        gl.quad(Q(-12.5, 4.4), Q(12.5, 4.4), Q(12.5, 6.8), Q(-12.5, 6.8), [0.55, 0.62, 0.72], n);
        gl.quad(Q(-12.5, 1.0), Q(12.5, 1.0), Q(12.5, 2.8), Q(-12.5, 2.8), [0.7, 0.62, 0.48], n);
        for (const e of [-8, -3]) { const d = W3(s + e, u - 2, 7.6); me.beam(d, [d[0], 8.6, d[2]], 0.08, [0.6, 0.6, 0.6]); me.box(d[0], 8.6, d[2], 1.8, 0.2, 1.8, yaw, [0.92, 0.92, 0.92]); }
        infield.push([s, u, 13, 6]);
        // flag poles in front of it: the national flag between two checkered ones
        const sg = B.get("signs");
        [[-6, 14, signs.checker], [0, 17, signs.flag], [6, 14, signs.checker]].forEach(([e, h, r]) => {
          const b = W3(s + e, u + 11, 0); me.beam(b, [b[0], h, b[2]], 0.09, [0.85, 0.85, 0.85], 6);
          const tt = tan(s + e), fw = 2.8, fh = 1.6;
          const Q2 = (dx, dy) => [b[0] + tt[0] * dx, h - 0.2 - fh + dy, b[2] + tt[2] * dx];
          sg.quad(Q2(0.1, 0), Q2(0.1 + fw, 0), Q2(0.1 + fw, fh), Q2(0.1, fh), white, nrm(s), signs.uvBL(r));
          sg.quad(Q2(0.1, 0), Q2(0.1 + fw, 0), Q2(0.1 + fw, fh), Q2(0.1, fh), white, inw(s), signs.uvBL(r, 1, 0));
        });
      }
    }

    // ---- surroundings: the lot ring, parked cars, lamp posts, the far skyline ------------------------
    let bbox = null;
    {
      const lot = BO.get("lot"), n = hi ? 180 : 90, XR = 205, ZR = 182;
      const ring = [], asph = [0.19, 0.19, 0.2];
      for (let i = 0; i < n; i++) {
        const s = i / n * L; core.toWorld(s, STAND.uBack - 1, 0, F);
        const a = Math.atan2(F.z, F.x), cx = Math.cos(a), cz = Math.sin(a);
        const k = Math.min(XR / Math.max(1e-6, Math.abs(cx)), ZR / Math.max(1e-6, Math.abs(cz)));
        ring.push([[F.x, -0.01, F.z], [cx * k, -0.01, cz * k]]);
      }
      for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; lot.quad(a[0], b[0], b[1], a[1], asph, up); }
      // corners of the rectangle the radial ring leaves out
      const R = rng(5150), yawOf = () => (R() < 0.5 ? 0 : Math.PI);
      // parked cars: rows on the long sides
      for (const sgn of [1, -1]) {
        const z0 = sgn > 0 ? 69.7 + SP.outerU(0) + 10 : -(69.7 + STAND.uBack + 8);
        for (let row = 0; row < 8; row++) {
          const z = z0 + sgn * row * 6.2; if (Math.abs(z) > ZR - 4) break;
          for (let x = -165; x <= 165; x += 2.9) {
            if (R() > (hi ? 0.62 : 0.4)) continue;
            if (sgn > 0 && Math.abs(x) < 26 && row < 5) continue;            // the gate plaza
            const col = TEAM[(R() * TEAM.length) | 0], dim = [col[0] * 0.7 + 0.1, col[1] * 0.7 + 0.1, col[2] * 0.7 + 0.1], y = yawOf();
            lot.box(x, 0.18, z, 1.85, 0.75, 4.5, y, dim);
            lot.box(x, 0.93, z + (y ? 0.3 : -0.3), 1.6, 0.5, 2.3, y, [0.1, 0.11, 0.13]);
          }
        }
      }
      // lamp posts
      const lg = BO.get("glow");
      for (const sgn of [1, -1]) for (let x = -150; x <= 150; x += 50) {
        const z = sgn * (ZR - 26); lot.beam([x, 0, z], [x, 11, z], 0.12, [0.4, 0.4, 0.42]);
        lg.box(x, 11, z, 1.6, 0.3, 0.6, 0, [1, 0.88, 0.62]);
      }
      // the far skyline and hills: one open band, unfogged, round the whole horizon
      const sky = new THREE.Mesh(new THREE.CylinderGeometry(820, 820, 110, 48, 1, true), M.sky);
      sky.position.y = 38; sky.name = "horizon"; sky.frustumCulled = false;
      surroundings.add(sky);
    }

    // ---- the crowd: 4 instanced quadrants, animated in the vertex shader -----------------------------
    const U = { uT: { value: 0 }, uEx: { value: 0 } };
    M.crowd.onBeforeCompile = function (sh) {
      sh.uniforms.uT = U.uT; sh.uniforms.uEx = U.uEx;
      sh.vertexShader = "attribute vec4 aP;\nuniform float uT;\nuniform float uEx;\nvarying float vFlash;\n" + sh.vertexShader
        .replace("#include <uv_vertex>", [
          "float cheer = step(fract(aP.y * 7.13 + 0.37), uEx * 0.9 + 0.03);",
          "#ifdef USE_UV",
          "  vUv = vec2((uv.x + mod(aP.x, 16.0)) / 16.0, (uv.y + 3.0 - floor(aP.x / 16.0) - 2.0 * cheer) / 4.0);",
          "#endif"].join("\n"))
        .replace("#include <begin_vertex>", [
          "vec3 transformed = vec3(position);",
          "float bob = max(sin(uT * (3.5 + aP.z * 5.0) + aP.y * 6.2831), 0.0);",
          "transformed.y += bob * (0.015 + 0.14 * uEx * (0.35 + cheer)) + cheer * 0.34 * min(1.0, uEx * 3.0);",
          "vFlash = uEx * step(0.9965, fract(sin(aP.y * 91.7 + floor(uT * 9.0) * 1.37) * 43758.5453));"].join("\n"));
      sh.fragmentShader = "varying float vFlash;\n" + sh.fragmentShader.replace("#include <tonemapping_fragment>", "gl_FragColor.rgb += vec3(vFlash * 6.0);\n#include <tonemapping_fragment>");
    };
    const crowdMeshes = [];
    let crowdCount = 0;
    {
      const byChunk = [[], [], [], []];
      for (let i = 0; i < crowd.x.length; i++) byChunk[crowd.ch[i]].push(i);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
      byChunk.forEach((ids, c) => {
        if (!ids.length) return;
        const geo = new THREE.PlaneGeometry(0.56, 1.15); geo.translate(0, 0.575, 0);
        const aP = new Float32Array(ids.length * 4), col = new Float32Array(ids.length * 3);
        const im = new THREE.InstancedMesh(geo, M.crowd, ids.length);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        ids.forEach((i, k) => {
          p.set(crowd.x[i], crowd.y[i], crowd.z[i]); e.set(0, crowd.yaw[i], 0); q.setFromEuler(e); m4.compose(p, q, sc);
          im.setMatrixAt(k, m4);
          aP[k * 4] = crowd.v[i]; aP[k * 4 + 1] = crowd.ph[i]; aP[k * 4 + 2] = crowd.rate[i]; aP[k * 4 + 3] = 0;
          col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = crowd.lit[i];
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
        });
        geo.setAttribute("aP", new THREE.InstancedBufferAttribute(aP, 4));
        im.instanceColor = new THREE.InstancedBufferAttribute(col, 3);
        const ctr = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        geo.boundingSphere = new THREE.Sphere(ctr, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 2);
        im.userData.box = [x0 - 0.3, y0, z0 - 0.3, x1 + 0.3, y1 + 1.6, z1 + 0.3];
        im.name = "crowd#" + c; im.matrixAutoUpdate = false; im.updateMatrix();
        crowdMeshes.push(im); group.add(im); crowdCount += ids.length;
      });
    }

    // ---- emit the merged meshes ------------------------------------------------------------------
    B.emit(THREE, group, M);
    BO.emit(THREE, surroundings, M);
    const lampGeo = lampMe.geometry(THREE);
    lampGeo.attributes.color.setUsage(THREE.DynamicDrawUsage);
    const lampMesh = new THREE.Mesh(lampGeo, M.lamps); lampMesh.name = "startlights"; lampMesh.matrixAutoUpdate = false; lampMesh.updateMatrix();
    group.add(lampMesh);
    group.traverse((o) => { if (o.name === "halo") o.renderOrder = 3; });

    // ---- the live bits ---------------------------------------------------------------------------
    const L_OFF = [0.07, 0.015, 0.015], L_RED = [1.0, 0.07, 0.04], L_GREEN = [0.12, 1.0, 0.25];
    function setLights(n, green) {
      const ca = lampGeo.attributes.color;
      for (let q = 0; q < lampQuads.length; q++) {
        const col = green ? L_GREEN : ((q >> 1) < n ? L_RED : L_OFF);
        for (let k = 0; k < 4; k++) ca.setXYZ(lampQuads[q] + k, col[0], col[1], col[2]);
      }
      ca.needsUpdate = true;
    }
    setLights(0, false);

    const pylonLast = []; let pylonN = -1;
    function setPylon(order) {
      const n0 = order ? order.length : 0;
      let same = n0 === pylonN; for (let i = 0; same && i < n0; i++) same = order[i] === pylonLast[i];
      if (same) return;
      pylonN = n0; for (let i = 0; i < n0; i++) pylonLast[i] = order[i];
      if (!pylonCv) return;
      const g = pylonCv.getContext("2d"), W = 128, H = 1024;
      g.fillStyle = "#050506"; g.fillRect(0, 0, W, H);
      g.fillStyle = "#c01818"; g.fillRect(0, 0, W, 34);
      const n = Math.max(1, Math.min(12, order ? order.length : 0)), rh = (H - 40) / Math.max(10, n);
      g.textAlign = "center"; g.textBaseline = "middle";
      for (let i = 0; i < n; i++) {
        const y = 40 + i * rh;
        g.fillStyle = i & 1 ? "#0b0c0e" : "#111316"; g.fillRect(4, y + 2, W - 8, rh - 4);
        g.fillStyle = i === 0 ? "#ffd22e" : "#f4f4f0";
        g.font = "900 " + Math.floor(rh * 0.72) + "px Impact, 'Arial Black', 'Oswald', sans-serif";
        g.fillText(String(order[i]), W / 2, y + rh / 2 + 2);
      }
      if (T.pylon) T.pylon.needsUpdate = true;
    }
    setPylon([]);

    let jumboManual = false, jumboKey = null;
    function drawJumbo(x) {
      if (!jumboCv) return;
      const g = jumboCv.getContext("2d"), W = 512, H = 288;
      if (x && typeof x === "object" && (x.getContext || x.width)) { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.drawImage(x, 0, 0, W, H); }
      else {
        const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#0b1a33"); gr.addColorStop(1, "#050a14");
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        g.fillStyle = "#f4f4f0"; g.textAlign = "center"; g.textBaseline = "middle";
        const s = String(x == null ? "" : x);
        g.font = "900 " + (s.length <= 3 ? 200 : s.length <= 8 ? 96 : 56) + "px Impact, 'Arial Black', 'Oswald', sans-serif";
        g.fillText(s, W / 2, H / 2 + 6);
      }
      if (T.jumbo) T.jumbo.needsUpdate = true;
    }
    function setJumbo(x) { jumboManual = x != null; jumboKey = x; drawJumbo(x); }
    drawJumbo("");

    const FLAGS = { green: 0, yellow: 1, white: 2, checker: 3 };
    let t = 0, flagKey = null, leaderKey = null;
    const flagYaw = flagMesh.rotation.y;
    function update(dt, state) {
      t += dt || 0;
      state = state || {};
      const ex = Math.max(0, Math.min(1, state.excite || 0));
      U.uT.value = t; U.uEx.value += (ex - U.uEx.value) * Math.min(1, (dt || 0) * 4);
      const fk = state.flag || "green";
      if (fk !== flagKey) { flagKey = fk; if (T.flag) T.flag.offset.x = (FLAGS[fk] || 0) * 0.25; flagMesh.visible = fk in FLAGS; }
      flagMesh.rotation.y = flagYaw + Math.sin(t * 5.5) * 0.55;
      flagMesh.rotation.x = Math.sin(t * 11) * 0.12;
      if (!jumboManual && state.leaderNumber != null && state.leaderNumber !== leaderKey) { leaderKey = state.leaderNumber; drawJumbo(state.leaderNumber ? String(state.leaderNumber) : ""); }
    }

    // ---- anchors (camera spots) ------------------------------------------------------------------
    const anchors = [];
    const A = (name, s, u, y, ls, lu, ly) => { const p = W3(s, u, y), q = W3(ls, lu, ly); anchors.push({ name, x: p[0], y: p[1], z: p[2], lookAt: { x: q[0], y: q[1], z: q[2] } }); };
    {
      const sec = (s) => standSection(core, s, SEC);
      const q = L / 4;
      A("tv_turn1", q * 0.72, STAND.uTop - 3, sec(q * 0.72).yTop + 3, q * 0.35, 0, 1.5);
      A("tv_turn2", q * 1.3, STAND.uTop - 3, sec(q * 1.3).yTop + 3, q * 1.7, 0, 1.5);
      A("tv_turn3", q * 2.7, STAND.uTop - 3, sec(q * 2.7).yTop + 3, q * 2.35, 0, 1.5);
      A("tv_turn4", q * 3.3, STAND.uTop - 3, sec(q * 3.3).yTop + 3, q * 3.7, 0, 1.5);
      A("tv_backstretch", L / 2, STAND.uTop - 2, sec(L / 2).yTop + 3.5, L / 2, 0, 1);
      const yR = sec(0).yConc + SUITES.lift + SUITE_H;
      A("tv_frontstretch", 0, STAND.uTop - SUITES.overhang - 0.5, yR + 2.5, 0, 0, 1);
      A("flagstand", -2.6, 8.6, FLAGSTAND.y + 1.7, -90, 0, 1);
      A("pit", 40, PIT.u, 3.2, -30, PIT.u, 0.5);
      A("infield", L / 2, -60, 6, L / 2 - 60, 0, 1);
      anchors.push({ name: "blimp", x: 0, y: 190, z: 250, lookAt: { x: 0, y: 0, z: -10 } });
    }

    // ---- bbox (without the horizon band) ------------------------------------------------------------
    {
      const b = new THREE.Box3(), tmp = new THREE.Box3();
      group.traverse((o) => {
        if (!o.isMesh || o.name === "horizon") return;
        if (o.isInstancedMesh) { const q = o.userData.box; tmp.min.set(q[0], q[1], q[2]); tmp.max.set(q[3], q[4], q[5]); }
        else { o.updateMatrixWorld(true); o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); }
        b.union(tmp);
      });
      bbox = { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z };
    }

    function dispose() {
      group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      for (const k in M) if (M[k] && M[k].dispose) M[k].dispose();
      for (const k in T) if (T[k]) T[k].dispose();
      if (signs.tex) signs.tex.dispose();
      if (group.parent) group.parent.remove(group);
    }

    return {
      group, surroundings, update, setLights, setPylon, setJumbo, dispose, anchors,
      outerU: SP.outerU, mainEntrance: SP.mainEntrance, spec: SP,
      stats: { crowd: crowdCount, aisles: aisles.length, towers: spots.length, pitBoxes: PIT.boxes, bays, bbox, infield, standSamples: sam.length - 1 },
    };
  }

  const api = { build, spec, CANOPY, SUITE_H };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    const CBZ = root.CBZ = root.CBZ || {};
    CBZ.race = CBZ.race || {};
    CBZ.race.venue = api;
  }
})(typeof window !== "undefined" ? window : null);
