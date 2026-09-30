/* ============================================================
   city/fitout.js — THE WALK-IN FIT-OUT.

   OWNER: "building interiors and layouts, and customizability, but mostly
   interiors and layouts ... and really thinking about the LOGIC of Gang Life."

   THE SPLIT. A city this size cannot hold a finished interior behind every
   window: the load-weight wave measured 1.3 GB of geometry and the phone kills
   the tab at half that. So an interior is built in TWO passes that share ONE
   plan:

     EAGER (world build, merged into core/batch.js's buckets, forever):
       the architecture you can see from the street and the anchors the sim
       needs while you are elsewhere. Floor plates, corridor + party walls,
       locked unit doors, a bed a resident sleeps in, desk rows, counters.
       interior_programs.js / buildings.js own this and DECLARE every floor to
       this file (CBZ.fitoutDeclare) so there is one answer to "what is
       floor 3 of this building".

     LAZY (this file, only the building you are in or at the door of):
       the fit-out an architect's drawing implies and a lived-in room adds —
       finished floors (oak, carpet tile, ceramic, vinyl, stained slab),
       bathrooms with walls you walk round, kitchens with a sink under the
       window and a fridge by the door, bedrooms behind a partition, a
       stockroom behind a shop counter, a gang's count room, the clutter of
       who lives there, and ceiling fixtures whose light is BAKED into the
       vertex colours so a room has pools of light without a single extra
       real light (r128 recompiles every material when the light count
       changes). Built a floor per tick as you approach, merged into ~8 draw
       calls a building, freed the moment you walk away.

   WHY ONE FILE AND NOT A PARALLEL SYSTEM. Everything drawn here goes through
   the SAME furniture vocabulary (CBZ.furnish) with a box callback that lands
   in this file's merge buckets instead of b.lbox — so a chair is the same
   chair, it registers the same propuse seat (propuse dedupes by coordinate,
   so a rebuild re-files nothing), and loot goes into the SAME container
   registry interior_programs.js owns (CBZ.interiorLootRegister).

   PLANNERS. A planner is `fn(B, floor)` registered per program name with
   CBZ.fitoutPlan(name, fn); city/fitout_plans.js holds the architecture.
   B is the per-floor builder documented at `makeBuilder` below.

   CUSTOMIZABILITY. CBZ.interiorFurnish (bottom of file) — rooms, slots and a
   catalogue of real pieces for a property the player OWNS; placements are
   drawn by this same builder on the next fit-out of that floor, persist in
   localStorage, and are what realestate / build mode call. See its header.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // ---- tunables ------------------------------------------------------------
  const R_IN = 9;          // m outside the footprint at which a building fits out
  const R_OUT = 20;        // …and at which it is freed again (hysteresis)
  const MAX_SITES = 2;     // buildings fitted out at once
  const TICK = 0.2;        // s between scans; ONE floor is built per scan
  const FLOOR_SPAN = 1;    // floors above/below yours that are kept built

  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : 0.5; }

  /* ========================================================================
     1. THE FLOOR LOG — what each floor of each building IS.
     ======================================================================== */
  const SITES = new Map();           // key -> site
  let SITE_LIST = [];
  function siteKey(b) { return Math.round((b.ox || 0) * 4) + "|" + Math.round((b.oz || 0) * 4); }
  function floorTopOf(b, k) {
    const t = b.floorTops;
    if (Array.isArray(t) && t[k] != null) return t[k];
    return k <= 0 ? 0.14 : k * (b.FH || 3.2);
  }
  function floorIndexOf(b, y) {
    const t = b.floorTops;
    const n = Array.isArray(t) ? t.length - 1 : Math.max(1, b.storeys | 0);
    let best = 0, bd = 1e9;
    for (let k = 0; k < n; k++) { const d = Math.abs(floorTopOf(b, k) - y); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  function siteOf(b) {
    if (!b || b.w == null || b.d == null) return null;
    const key = siteKey(b);
    let s = SITES.get(key);
    if (!s) {
      s = { key: key, b: b, lot: null, floors: Object.create(null), live: Object.create(null),
            wx: null, wz: null, dist: 1e9, building: 0 };
      SITES.set(key, s);
      SITE_LIST = null;
    }
    // the eager `b` carries the whole record (group, lbox, clearFloorPoint);
    // a spread copy handed in later must not replace it.
    if (!s.b.group && b.group) s.b = b;
    return s;
  }
  // DECLARE a floor. `prog` names the planner; `rect` is the host-local usable
  // band; `info` rides along to the planner (units, door, kind, gang…).
  const STICKY = { hideout: 1 };
  CBZ.fitoutDeclare = function (b, y, prog, rect, info) {
    const s = siteOf(b);
    if (!s || !prog) return null;
    const k = floorIndexOf(b, y || 0);
    const prev = s.floors[k];
    // a gang's building stays the gang's: a later generic program declared on
    // the same storey (the office-lobby pass runs over every ground floor)
    // rides along as `extra` instead of turning the hideout into a lobby.
    if (prev && STICKY[prev.prog] && !STICKY[prog]) {
      prev.extra = (prev.extra || []).concat([{ prog: prog, info: info || null, rect: rect || null }]);
      return prev;
    }
    // the trade dresser declares the ground floor first; a program that later
    // dresses the same storey refines it rather than wiping the trade.
    const rec = { k: k, y: floorTopOf(b, k), prog: prog, rect: rect || null, info: info || null,
                  extra: prev ? (prev.extra || []).concat([{ prog: prev.prog, info: prev.info, rect: prev.rect }]) : [] };
    s.floors[k] = rec;
    return rec;
  };
  // the same record for a whole building of one kind (a gang hideout, a
  // warehouse): every floor gets `prog`, the ground floor `groundProg`.
  CBZ.fitoutDeclareBuilding = function (b, prog, info, groundProg) {
    const n = Array.isArray(b.floorTops) ? b.floorTops.length - 1 : Math.max(1, b.storeys | 0);
    for (let k = 0; k < n; k++)
      CBZ.fitoutDeclare(b, floorTopOf(b, k), (k === 0 && groundProg) ? groundProg : prog,
        CBZ.interiorFloorRoom ? CBZ.interiorFloorRoom(b, k) : null, Object.assign({ floor: k, floors: n }, info || {}));
  };
  CBZ.fitoutSiteOf = function (b) { return b ? SITES.get(siteKey(b)) || null : null; };
  CBZ.fitoutReset = function () { disposeAll(); SITES.clear(); SITE_LIST = null; };

  /* ========================================================================
     2. MATERIALS — a handful of canvas textures, built once, never freed.

     REAL SIZES. TEX_SCALE is the metres one texture tile covers, and every
     painter below draws a whole number of its units into that tile, so the
     unit comes out at its real size on any box (UVs are world-scaled):
       wood      16 boards across 2.0 m  = 12.5 cm oak strip, staggered 0.3-2 m boards
       carpet    4 tiles across 2.0 m    = 50 cm carpet tile, quarter-turned
       tile      4 across 1.2 m          = 30 cm ceramic, 5 mm grout
       vinyl     4 across 1.2 m          = 30 cm (12") VCT
       subway    3 x 6 across 0.45 m     = 15 x 7.5 cm subway tile
       brick     3 x 8 across 0.61 m     = 20 x 7.6 cm modular brick + joint
       concrete  one 4.5 m tile          = control joints on a 4.5 m grid
       ceiling   4 across 2.4 m          = 600 x 600 lay-in grid
     Every painter is SEAMLESS (what crosses an edge is drawn again on the
     other side), so no tile boundary shows as a line across the floor.
     ======================================================================== */
  const TEX_SCALE = { wood: 2.0, carpet: 2.0, tile: 1.2, vinyl: 1.2, checker: 1.2, concrete: 4.5,
                      plaster: 2.5, subway: 0.45, brick: 0.61, terrazzo: 2.0, ceiling: 2.4 };
  const TEX_SIZE = { wood: 1024, brick: 512, concrete: 512, carpet: 512, terrazzo: 512 };
  const MATS = {};
  function rnd(seed) { let s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function canvas(n) { const c = document.createElement("canvas"); c.width = c.height = n; return c; }
  function rgb(r, g, b) { return "rgb(" + Math.max(0, Math.min(255, r | 0)) + "," + Math.max(0, Math.min(255, g | 0)) + "," + Math.max(0, Math.min(255, b | 0)) + ")"; }
  function noise(x, n, rgbUnused, amp, count, size, seed) {
    const r = rnd(seed);
    for (let i = 0; i < count; i++) {
      const v = (r() - 0.5) * amp;
      x.fillStyle = "rgba(" + (v > 0 ? "255,255,255" : "0,0,0") + "," + Math.abs(v).toFixed(3) + ")";
      const s = size * (0.4 + r());
      x.fillRect(r() * n, r() * n, s, s);
    }
  }
  // a rect that wraps across the tile edges (seamless)
  function wrapFill(x, n, px, py, w, h) {
    for (let ox = -n; ox <= n; ox += n) for (let oy = -n; oy <= n; oy += n) {
      const a = px + ox, b = py + oy;
      if (a + w < 0 || a > n || b + h < 0 || b > n) continue;
      x.fillRect(a, b, w, h);
    }
  }
  // a soft CONCENTRIC blot, wrapped. (One centre for both circles: a radial
  // gradient whose two circles have different centres draws a cone, and that
  // cone is where the dark TRIANGLES on the old concrete came from.)
  function blot(x, n, cx, cy, rad, rgbS, a) {
    for (let ox = -n; ox <= n; ox += n) for (let oy = -n; oy <= n; oy += n) {
      const X = cx + ox, Y = cy + oy;
      if (X + rad < 0 || X - rad > n || Y + rad < 0 || Y - rad > n) continue;
      const g = x.createRadialGradient(X, Y, 0, X, Y, rad);
      g.addColorStop(0, "rgba(" + rgbS + "," + a.toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + rgbS + ",0)");
      x.fillStyle = g;
      x.fillRect(X - rad, Y - rad, rad * 2, rad * 2);
    }
  }
  const PAINT = {
    wood: function (x, n) {                          // oak strip: 16 boards, each column 1-3 boards long
      const r = rnd(11), cols = 16, pw = n / cols;
      x.fillStyle = "#7c5a3c"; x.fillRect(0, 0, n, n);
      for (let i = 0; i < cols; i++) {
        // 1-3 boards of random length per column, started at a random offset:
        // real staggered end joints, never a line across the floor
        const nb = 1 + ((r() * 3) | 0), lens = [];
        let rem = n;
        for (let k = 0; k < nb - 1; k++) { const L = rem * (0.3 + r() * 0.4) / (nb - 1 - k); lens.push(L); rem -= L; }
        lens.push(rem);
        let y0 = r() * n;
        for (let k = 0; k < lens.length; k++) {
          const L = lens[k], t = 0.9 + r() * 0.18, warm = (r() - 0.5) * 12;
          x.fillStyle = rgb(134 * t + warm, 97 * t + warm * 0.3, 62 * t - warm * 0.4);
          wrapFill(x, n, i * pw, y0, pw, L);
          // grain: long streaks down the board, a few dark, a few pale
          for (let g = 0; g < 11; g++) {
            const gx = i * pw + 1.5 + r() * (pw - 3), al = 0.035 + r() * 0.08;
            x.fillStyle = r() < 0.62 ? "rgba(66,38,18," + al.toFixed(3) + ")" : "rgba(255,232,196," + (al * 0.6).toFixed(3) + ")";
            wrapFill(x, n, gx, y0, 0.8 + r() * 1.6, L);
          }
          // a knot now and then
          if (r() < 0.22) {
            const kx = i * pw + pw * (0.3 + r() * 0.4), ky = ((y0 + L * (0.2 + r() * 0.6)) % n + n) % n;
            x.fillStyle = "rgba(62,36,16,0.38)";
            x.beginPath(); x.ellipse(kx, ky, 2.4 + r() * 1.5, 6 + r() * 5, 0, 0, Math.PI * 2); x.fill();
          }
          x.fillStyle = "rgba(36,20,9,0.62)"; wrapFill(x, n, i * pw, y0 - 1, pw, 2);     // butt joint
          y0 += L;
        }
        x.fillStyle = "rgba(36,20,9,0.55)"; x.fillRect(i * pw, 0, 1.5, n);                // the groove
        x.fillStyle = "rgba(255,238,210,0.10)"; x.fillRect(i * pw + 1.5, 0, 1, n);         // its lit lip
      }
      noise(x, n, 0, 0.05, 5000, 1.2, 12);
    },
    carpet: function (x, n) {                        // loop-pile carpet tile, 50 cm, quarter-turned
      x.fillStyle = "#63686f"; x.fillRect(0, 0, n, n);
      const q = n / 4, r = rnd(21);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const t = (r() - 0.5) * 0.06;
        x.fillStyle = t > 0 ? "rgba(255,255,255," + t.toFixed(3) + ")" : "rgba(0,0,0," + (-t).toFixed(3) + ")";
        x.fillRect(i * q, j * q, q, q);
        // the pile rows run one way on this tile and across on the next —
        // which is exactly how a quarter-turned install reads from standing height
        const turn = (i + j) & 1;
        for (let s = 1; s < q; s += 3) {
          x.fillStyle = "rgba(0,0,0," + (0.05 + r() * 0.05).toFixed(3) + ")";
          if (turn) x.fillRect(i * q, j * q + s, q, 1); else x.fillRect(i * q + s, j * q, 1, q);
        }
      }
      noise(x, n, 0, 0.3, 30000, 1.1, 22);          // heather fleck of the loops
      x.fillStyle = "rgba(0,0,0,0.12)";
      for (let k = 0; k < 4; k++) { x.fillRect(k * q, 0, 1, n); x.fillRect(0, k * q, n, 1); }
    },
    tile: function (x, n) {                          // 30 cm glazed ceramic, 5 mm grout
      x.fillStyle = "#b4b2ab"; x.fillRect(0, 0, n, n);
      const c = 4, q = n / c, r = rnd(31);
      for (let i = 0; i < c; i++) for (let j = 0; j < c; j++) {
        const t = 226 + ((r() * 16) | 0);
        x.fillStyle = rgb(t, t, t - 5);
        x.fillRect(i * q + 1, j * q + 1, q - 2, q - 2);
        const g = x.createLinearGradient(i * q, j * q, i * q + q, j * q + q);
        g.addColorStop(0, "rgba(255,255,255,0.07)"); g.addColorStop(1, "rgba(0,0,0,0.04)");
        x.fillStyle = g; x.fillRect(i * q + 1, j * q + 1, q - 2, q - 2);
      }
      noise(x, n, 0, 0.05, 1600, 1.5, 32);
    },
    vinyl: function (x, n) {                         // speckled commercial VCT, 30 cm
      x.fillStyle = "#d8d5ce"; x.fillRect(0, 0, n, n);
      const q = n / 4, r = rnd(41);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const t = (r() - 0.5) * 0.07;
        x.fillStyle = t > 0 ? "rgba(255,255,255," + t.toFixed(3) + ")" : "rgba(0,0,0," + (-t).toFixed(3) + ")";
        x.fillRect(i * q, j * q, q, q);
      }
      noise(x, n, 0, 0.26, 7000, 1.3, 42);
      x.fillStyle = "rgba(0,0,0,0.13)";
      for (let i = 0; i < 4; i++) { x.fillRect(i * q, 0, 1, n); x.fillRect(0, i * q, n, 1); }
    },
    checker: function (x, n) {                       // black-and-white diner tile
      const c = 4, q = n / c;
      x.fillStyle = "#8a8884"; x.fillRect(0, 0, n, n);
      for (let i = 0; i < c; i++) for (let j = 0; j < c; j++) {
        x.fillStyle = ((i + j) & 1) ? "#1f2023" : "#e8e6e0"; x.fillRect(i * q + 1, j * q + 1, q - 2, q - 2);
      }
      noise(x, n, 0, 0.08, 2000, 2, 51);
    },
    concrete: function (x, n) {                      // sealed slab: cloud, aggregate, trowel, joints
      x.fillStyle = "#8f8d87"; x.fillRect(0, 0, n, n);
      const r = rnd(61);
      for (let i = 0; i < 60; i++) {
        const dark = r() < 0.6;
        blot(x, n, r() * n, r() * n, 60 + r() * 180, dark ? "44,40,34" : "236,232,222", 0.015 + r() * 0.03);
      }
      // (no stroked trowel arcs: at floor distance any drawn arc reads as a
      // hard RING, tiled — the burnish is the soft blots plus the shader mottle)
      noise(x, n, 0, 0.16, 16000, 1.3, 62);            // fine aggregate
      noise(x, n, 0, 0.28, 900, 1.8, 63);              // pits and stones
      // control joints on the 3 m grid (the tile edge), with their lit lip
      x.fillStyle = "rgba(24,22,20,0.42)"; x.fillRect(0, 0, 2, n); x.fillRect(0, 0, n, 2);
      x.fillStyle = "rgba(255,255,255,0.08)"; x.fillRect(2, 0, 1, n); x.fillRect(0, 2, n, 1);
    },
    plaster: function (x, n) {                       // painted plaster: near-white, the tint is the paint
      x.fillStyle = "#f4f4f2"; x.fillRect(0, 0, n, n);
      const r = rnd(70);
      for (let i = 0; i < 14; i++) blot(x, n, r() * n, r() * n, 20 + r() * 60, r() < 0.5 ? "0,0,0" : "255,255,255", 0.012 + r() * 0.014);
      noise(x, n, 0, 0.05, 7000, 2.2, 71);            // roller stipple
    },
    subway: function (x, n) {                        // 15 x 7.5 cm gloss subway tile, 3 mm grout
      x.fillStyle = "#b3b6b5"; x.fillRect(0, 0, n, n);
      const rows = 6, cols = 3, th = n / rows, tw = n / cols, r = rnd(76);
      for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
        const off = (j & 1) ? tw / 2 : 0, t = 238 + ((r() * 12) | 0);
        x.fillStyle = rgb(t, t + 1, t);
        x.fillRect(i * tw + off + 1, j * th + 1, tw - 2, th - 2);
        x.fillStyle = "rgba(255,255,255,0.35)"; x.fillRect(i * tw + off + 2, j * th + 2, tw - 4, 2);   // glaze catch
        x.fillStyle = "rgba(0,0,0,0.06)"; x.fillRect(i * tw + off + 2, j * th + th - 4, tw - 4, 2);
      }
    },
    brick: function (x, n) {                         // modular brick, 10 mm raked joint
      x.fillStyle = "#9b9388"; x.fillRect(0, 0, n, n);
      noise(x, n, 0, 0.18, 5000, 1.6, 80);            // sandy mortar
      const rows = 8, cols = 3, th = n / rows, tw = n / cols, r = rnd(81), m = 4;
      for (let j = 0; j < rows; j++) for (let i = -1; i <= cols; i++) {
        const off = (j & 1) ? tw / 2 : 0, t = 0.72 + r() * 0.34, burnt = r() < 0.12;
        const bx = i * tw + off + m, by = j * th + m, bw = tw - m * 2, bh = th - m * 2;
        x.fillStyle = burnt ? rgb(96 * t, 50 * t, 40 * t) : rgb(158 * t, 82 * t + r() * 10, 62 * t);
        x.fillRect(bx, by, bw, bh);
        x.fillStyle = "rgba(255,220,190,0.14)"; x.fillRect(bx, by, bw, 2);           // top arris catches light
        x.fillStyle = "rgba(0,0,0,0.22)"; x.fillRect(bx, by + bh - 2, bw, 2);         // underside in shadow
        x.fillStyle = "rgba(0,0,0,0.10)"; x.fillRect(bx + bw - 2, by, 2, bh);
        if (r() < 0.3) { x.fillStyle = "rgba(0,0,0,0.12)"; x.fillRect(bx + r() * bw * 0.6, by + r() * bh * 0.5, 6 + r() * 20, 3 + r() * 6); }
      }
      noise(x, n, 0, 0.2, 14000, 1.4, 82);            // the clay's grit
    },
    terrazzo: function (x, n) {                      // lobby / bank floor, zinc divider strips
      x.fillStyle = "#d8d3c8"; x.fillRect(0, 0, n, n);
      const r = rnd(91);
      for (let i = 0; i < 9000; i++) {
        const s = 1 + r() * 4, v = r();
        x.fillStyle = v < 0.4 ? "#8f877a" : v < 0.7 ? "#f3efe6" : v < 0.85 ? "#6f6a62" : "#b39a74";
        x.fillRect(r() * n, r() * n, s, s);
      }
      x.fillStyle = "rgba(120,114,100,0.55)"; x.fillRect(0, 0, n, 1.5); x.fillRect(0, 0, 1.5, n);
    },
    ceiling: function (x, n) {                       // 600 grid, fissured mineral tile, white T-bar
      x.fillStyle = "#e8e8e4"; x.fillRect(0, 0, n, n);
      noise(x, n, 0, 0.035, 2500, 2.0, 101);
      const r = rnd(102);
      x.fillStyle = "rgba(90,90,86,0.08)";
      for (let i = 0; i < 700; i++) x.fillRect(r() * n, r() * n, 2 + r() * 3, 2);     // fissures, soft
      const q = n / 4;
      for (let i = 0; i <= 4; i++) {
        x.fillStyle = "rgba(120,120,116,0.5)"; x.fillRect(i * q - 2.5, 0, 5, n); x.fillRect(0, i * q - 2.5, n, 5);   // reveal shadow
        x.fillStyle = "#f4f4f1"; x.fillRect(i * q - 1.5, 0, 3, n); x.fillRect(0, i * q - 1.5, n, 3);               // the T-bar face
      }
    },
  };
  // THE SURFACE, in the shader (the prisonlook idea): nothing real is one
  // flat colour. A world-space two-octave mottle (about +-5%) over every
  // fit-out surface, so a painted wall, a laminate carcass or a linen sheet
  // has the slight unevenness paint and cloth have. World-space, so it needs
  // no UVs and lands on the flat-colour bucket too. One program for all.
  const FIT_NOISE =
    "float fitH(vec3 p){ p = mod(p, 512.0); p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }\n" +
    "float fitN(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);\n" +
    "  return mix(mix(mix(fitH(i), fitH(i + vec3(1.0,0.0,0.0)), f.x), mix(fitH(i + vec3(0.0,1.0,0.0)), fitH(i + vec3(1.0,1.0,0.0)), f.x), f.y),\n" +
    "             mix(mix(fitH(i + vec3(0.0,0.0,1.0)), fitH(i + vec3(1.0,0.0,1.0)), f.x), mix(fitH(i + vec3(0.0,1.0,1.0)), fitH(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z); }\n" +
    "float fitMottle(vec3 p){ p = mod(p, 1024.0); return 0.955 + 0.06 * fitN(p * 0.9) + 0.03 * fitN(p * 3.1 + 17.0); }\n";
  const FIT_LIT = { value: 0.12 };
  function fitShader(sh) {
    sh.uniforms.uFitLit = FIT_LIT;
    sh.vertexShader = sh.vertexShader
      .replace("void main() {", "varying vec3 vFitW;\nvoid main() {")
      .replace("#include <project_vertex>", "#include <project_vertex>\n\tvFitW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("void main() {", FIT_NOISE + "uniform float uFitLit;\nvarying vec3 vFitW;\nvoid main() {")
      .replace("#include <color_fragment>", "#include <color_fragment>\n\tdiffuseColor.rgb *= fitMottle(vFitW);")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uFitLit;");
  }
  function texMat(key) {
    if (MATS[key]) return MATS[key];
    let m;
    if (key === "flat") m = new THREE.MeshLambertMaterial({ vertexColors: true });
    else if (key === "glow") m = new THREE.MeshBasicMaterial({ vertexColors: true });
    else if (key === "glass") m = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false });
    else {
      const c = canvas(TEX_SIZE[key] || 256);
      const x = c.getContext("2d");
      (PAINT[key] || PAINT.plaster)(x, c.width);
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.encoding = THREE.sRGBEncoding;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      try { const R = CBZ.renderer; if (R && R.capabilities) t.anisotropy = Math.min(8, R.capabilities.getMaxAnisotropy()); } catch (e) {}
      m = new THREE.MeshLambertMaterial({ map: t, vertexColors: true });
    }
    // THE LIGHTS ARE ON AT NIGHT. The baked pools live in the vertex colour,
    // which multiplies the SCENE light — so after dark a room lit by its own
    // lamps would go black with the sky. Every fit-out surface also emits a
    // share of its own lit albedo (diffuse after the vertex colour), scaled by
    // one shared uniform the tick raises with CBZ.nightAmount. Same program
    // for every fit-out material, so it compiles once.
    if (key !== "glow") m.onBeforeCompile = fitShader;
    m.name = "fitout:" + key;
    m._shared = true;
    MATS[key] = m;
    return m;
  }
  /* WARM BEFORE THE FIRST ROOM (core/fxwarm.js, idle after boot): one mesh
     per fit-out program (flat, lit glow, glass, textured) so walking into
     the first fitted room does not stall on its compiles. The textured one
     uses the plaster skin (256 px), the cheapest; every textured key is the
     same program. */
  CBZ.fitoutWarmObjects = function () {
    const g = new THREE.BoxGeometry(0.01, 0.01, 0.01);
    return ["flat", "glow", "glass", "plaster"].map(function (k) { try { return new THREE.Mesh(g, texMat(k)); } catch (e) { return null; } }).filter(Boolean);
  };
  // THE SAME SURFACES ELSEWHERE. The disaster island's walk-in houses and
  // towers (world/disaster_arena.js) finish their floors, walls and ceilings
  // with these exact canvases instead of a second texture library. Texture
  // only: the caller owns its material (the island has no night uniform).
  // UVs are world metres / FITOUT_TEX_SCALE[key].
  CBZ.fitoutTex = function (key) {
    if (!PAINT[key]) return null;
    const m = texMat(key);
    return (m && m.map) || null;
  };
  CBZ.FITOUT_TEX_SCALE = TEX_SCALE;

  /* ========================================================================
     3. THE BUILDER — boxes into merge buckets, baked light, colliders.
     ======================================================================== */
  const HEXC = new THREE.Color();
  function hexRGB(hex) { HEXC.setHex(hex >>> 0); return [HEXC.r, HEXC.g, HEXC.b]; }
  const FACES = [
    // normal, u axis, v axis  (each face spans ±1 in u,v about centre + n)
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];

  function makeBuilder(site, floor) {
    const b = site.b;
    const buckets = Object.create(null);
    const lights = [];
    const cols = [];
    const pieces = [];     // {tag, x, z, w, d} footprint ledger for planners
    const people = [];     // bodies this floor puts in its furniture (see B.person)
    const ox = b.ox || 0, oz = b.oz || 0;
    const FH = b.FH || 3.2;
    const y0 = floor.y;                               // slab top
    const nextTop = floorTopOf(b, floor.k + 1);
    const ceil = (floor.k + 1 < (Array.isArray(b.floorTops) ? b.floorTops.length : (b.storeys | 0) + 1))
      ? nextTop - 0.2 : y0 + FH - 0.2;                // underside of the slab above
    // finished floor top: 4 mm over the eager covering (CBZ.INTERIOR_FINISH,
    // itself 8 mm over the slab), so the floor you see is the floor you stand
    // on (it was 5-6 cm proud of the slab: feet in the oak on every floor)
    const fy = y0 + (CBZ.INTERIOR_FINISH != null ? CBZ.INTERIOR_FINISH : 0.008) + 0.004;
    // THE CORE IS SACRED: the lift chase, the stair core (reserved by every
    // multi-storey shell at birth, whether or not it is built yet) and the
    // landing in front of the stair door (b.keepRects) take nothing a planner
    // draws — no partition, no furniture, no collider — on any floor.
    const SHAFTS = [], MOUTHS = [];
    for (let i = 0, sr = b.shaftRects || []; i < sr.length; i++)
      SHAFTS.push({ x0: sr[i].x0 - 0.1, x1: sr[i].x1 + 0.1, z0: sr[i].z0 - 0.1, z1: sr[i].z1 + 0.1 });
    for (let i = 0, kr = b.keepRects || []; i < kr.length; i++)
      MOUTHS.push({ x0: kr[i].x0 - 0.1, x1: kr[i].x1 + 0.1, z0: kr[i].z0 - 0.1, z1: kr[i].z1 + 0.1 });
    function hits(L, x0, x1, z0, z1) {
      for (let i = 0; i < L.length; i++) {
        const R = L[i];
        if (x1 > R.x0 && x0 < R.x1 && z1 > R.z0 && z0 < R.z1) return true;
      }
      return false;
    }
    function inCore(x0, x1, z0, z1) { return hits(SHAFTS, x0, x1, z0, z1) || hits(MOUTHS, x0, x1, z0, z1); }
    function bucket(key) {
      let k = buckets[key];
      if (!k) k = buckets[key] = { key: key, pos: [], nor: [], col: [], uv: [], idx: [], tex: key !== "flat" && key !== "glow" && key !== "glass" };
      return k;
    }
    // ONE box. (x,y,z) is the CENTRE in building-local space; o.mat picks a
    // texture bucket (else flat colour), o.glow makes it unlit/self-lit,
    // o.solid adds a collider, o.faces is a 6-bit mask (+x,-x,+y,-y,+z,-z).
    function box(x, y, z, w, h, d, color, o) {
      if (!(w > 0.002 && h > 0.002 && d > 0.002)) return null;
      o = o || {};
      // (a flat finish may cover the landing mouth, which is floor — never a shaft, which is a hole)
      if (SHAFTS.length && hits(SHAFTS, x - w / 2, x + w / 2, z - d / 2, z + d / 2)) return null;
      if (MOUTHS.length && h > 0.05 && hits(MOUTHS, x - w / 2, x + w / 2, z - d / 2, z + d / 2)) return null;
      const key = o.glow ? "glow" : o.glass ? "glass" : (o.mat || "flat");
      const bk = bucket(key);
      const c = hexRGB(color == null ? 0xffffff : color);
      const hw = w / 2, hh = h / 2, hd = d / 2;
      const sc = bk.tex ? (o.uv || TEX_SCALE[key] || 2) : 1;
      let mask = o.faces == null ? 63 : o.faces;
      if (o.faces == null && y - hh <= fy + 0.03) mask &= ~8;            // no underside on the floor
      if (o.faces == null && y + hh >= ceil - 0.02) mask &= ~4;           // …or top against the ceiling
      for (let f = 0; f < 6; f++) {
        if (!(mask & (1 << f))) continue;
        const F = FACES[f];
        const ext = [hw, hh, hd];
        const nx = F.n[0], ny = F.n[1], nz = F.n[2];
        const cxp = x + nx * hw, cyp = y + ny * hh, czp = z + nz * hd;
        const ua = F.u, va = F.v;
        const uh = Math.abs(ua[0]) * ext[0] + Math.abs(ua[1]) * ext[1] + Math.abs(ua[2]) * ext[2];
        const vh = Math.abs(va[0]) * ext[0] + Math.abs(va[1]) * ext[1] + Math.abs(va[2]) * ext[2];
        const base = bk.pos.length / 3;
        for (let q = 0; q < 4; q++) {
          const su = (q === 0 || q === 3) ? -1 : 1, sv = (q < 2) ? -1 : 1;
          const px = cxp + ua[0] * su * uh + va[0] * sv * vh;
          const py = cyp + ua[1] * su * uh + va[1] * sv * vh;
          const pz = czp + ua[2] * su * uh + va[2] * sv * vh;
          bk.pos.push(px, py, pz);
          bk.nor.push(nx, ny, nz);
          bk.col.push(c[0], c[1], c[2]);
          if (bk.tex) {
            // world-scaled UVs: the texture keeps its real size on any box
            const wu = (ua[0] ? px + ox : 0) * ua[0] + (ua[1] ? py : 0) * ua[1] + (ua[2] ? pz + oz : 0) * ua[2];
            const wv = (va[0] ? px + ox : 0) * va[0] + (va[1] ? py : 0) * va[1] + (va[2] ? pz + oz : 0) * va[2];
            bk.uv.push(wu / sc, wv / sc);
          }
        }
        bk.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      if (o.solid) solid(x - hw, x + hw, z - hd, z + hd, y - hh, y + hh);
      return true;
    }
    function solid(x0, x1, z0, z1, ya, yb) {
      if (inCore(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1))) return;
      cols.push({ minX: ox + Math.min(x0, x1), maxX: ox + Math.max(x0, x1), minZ: oz + Math.min(z0, z1),
                  maxZ: oz + Math.max(z0, z1), y0: ya, y1: yb, ref: null, _fitout: site.key });
    }
    // a subdivided floor/ceiling plane so baked light can pool on it. `holes`
    // are rects to leave open (stair wells, lift shafts).
    function plane(x0, z0, x1, z1, y, matKey, tint, o) {
      o = o || {};
      const bk = bucket(matKey);
      const c = hexRGB(tint == null ? 0xffffff : tint);
      const cell = o.cell || 1.0;
      const nxc = Math.max(1, Math.ceil((x1 - x0) / cell)), nzc = Math.max(1, Math.ceil((z1 - z0) / cell));
      const dx = (x1 - x0) / nxc, dz = (z1 - z0) / nzc;
      const down = !!o.down, sc = TEX_SCALE[matKey] || 2;
      const holes = o.holes || (down ? CEIL_HOLES : HOLES);
      for (let i = 0; i < nxc; i++) for (let j = 0; j < nzc; j++) {
        const ax = x0 + i * dx, az = z0 + j * dz, bx = ax + dx, bz = az + dz;
        let skip = false;
        for (let h = 0; h < holes.length && !skip; h++) {
          const R = holes[h];
          if (bx > R.x0 && ax < R.x1 && bz > R.z0 && az < R.z1) skip = true;
        }
        if (skip) continue;
        const base = bk.pos.length / 3;
        const P4 = down ? [[ax, bz], [ax, az], [bx, az], [bx, bz]] : [[ax, az], [ax, bz], [bx, bz], [bx, az]];
        for (let q = 0; q < 4; q++) {
          bk.pos.push(P4[q][0], y, P4[q][1]);
          bk.nor.push(0, down ? -1 : 1, 0);
          bk.col.push(c[0], c[1], c[2]);
          if (bk.tex) bk.uv.push((P4[q][0] + ox) / sc, -(P4[q][1] + oz) / sc);
        }
        bk.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    // A PARTITION: axis "x" runs along x at fixed z=at; "z" along z at x=at.
    // gaps: [{c, w, h}] doorways (h default 2.1). Both faces take `mat` with
    // `tint` (paint); lintels close the wall above each gap. Solid.
    function wall(axis, at, from, to, o) {
      o = o || {};
      const t = o.t || 0.12, wh = Math.min(o.h || (ceil - y0), ceil - y0);
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const gaps = (o.gaps || []).slice().sort(function (a, b2) { return a.c - b2.c; });
      let cur = lo;
      const mat = o.mat || "plaster", tint = o.tint == null ? 0xe9e4da : o.tint;
      const seg = function seg(a, c2, ya, yb) {
        if (c2 - a < 0.02 || yb - ya < 0.02) return;
        // a partition that runs into the lift chase / stair core / its landing
        // stops at it (the core's own wall closes the gap) instead of being
        // dropped whole by box()'s core guard
        for (const L of [SHAFTS, MOUTHS]) for (let i = 0; i < L.length; i++) {
          const R = L[i];
          const c0 = axis === "x" ? R.z0 : R.x0, c1 = axis === "x" ? R.z1 : R.x1;
          const r0 = axis === "x" ? R.x0 : R.z0, r1 = axis === "x" ? R.x1 : R.z1;
          if (at + t / 2 <= c0 || at - t / 2 >= c1 || c2 <= r0 || a >= r1) continue;
          seg(a, Math.min(c2, r0), ya, yb);
          seg(Math.max(a, r1), c2, ya, yb);
          return;
        }
        const mid = (a + c2) / 2, cy = (ya + yb) / 2;
        if (axis === "x") box(mid, cy, at, c2 - a, yb - ya, t, tint, { mat: mat, solid: ya < y0 + 1.8 });
        else box(at, cy, mid, t, yb - ya, c2 - a, tint, { mat: mat, solid: ya < y0 + 1.8 });
      };
      for (let i = 0; i < gaps.length; i++) {
        const g = gaps[i], g0 = Math.max(lo, g.c - g.w / 2), g1 = Math.min(hi, g.c + g.w / 2);
        seg(cur, g0, y0, y0 + wh);
        seg(g0, g1, y0 + (g.h || 2.1), y0 + wh);       // lintel / wall over the door
        // a painted door casing, because a hole in plaster reads as damage
        if (!o.noCasing && g1 - g0 > 0.5) {
          const ch = g.h || 2.1, cc = o.casing == null ? 0xf2efe8 : o.casing;
          if (axis === "x") {
            box(g0 - 0.03, y0 + ch / 2, at, 0.06, ch, t + 0.04, cc);
            box(g1 + 0.03, y0 + ch / 2, at, 0.06, ch, t + 0.04, cc);
            box((g0 + g1) / 2, y0 + ch + 0.03, at, g1 - g0 + 0.12, 0.06, t + 0.04, cc);
          } else {
            box(at, y0 + ch / 2, g0 - 0.03, t + 0.04, ch, 0.06, cc);
            box(at, y0 + ch / 2, g1 + 0.03, t + 0.04, ch, 0.06, cc);
            box(at, y0 + ch + 0.03, (g0 + g1) / 2, t + 0.04, 0.06, g1 - g0 + 0.12, cc);
          }
        }
        // THE DOOR ITSELF, standing open against the room (g.leaf = {hinge:
        // -1|+1 which jamb, side: -1|+1 which room it swings into}). A doorway
        // in a home has a door in it; a hole with a casing and no leaf reads
        // as a building site. Not solid: it is open flat to a wall.
        if (g.leaf && g1 - g0 > 0.5) {
          const ch = (g.h || 2.1) - 0.02, lw = g1 - g0 - 0.05, hs = g.leaf.hinge < 0 ? g0 + 0.035 : g1 - 0.035;
          const sd = g.leaf.side < 0 ? -1 : 1, pc = at + sd * (t / 2 + lw / 2 + 0.01);
          const lc = g.leaf.color == null ? 0xf1eee7 : g.leaf.color, kc = 0xb9b4aa;
          if (axis === "x") {
            box(hs, y0 + 0.01 + ch / 2, pc, 0.04, ch, lw, lc);
            for (const e of [-1, 1]) box(hs + e * 0.022, y0 + 0.01 + ch * 0.36, pc, 0.004, ch * 0.5, lw - 0.16, 0xe4e0d7);   // lower panel
            for (const e of [-1, 1]) box(hs + e * 0.03, y0 + 1.0, at + sd * (t / 2 + lw - 0.07), 0.02, 0.03, 0.12, kc);  // lever
          } else {
            box(pc, y0 + 0.01 + ch / 2, hs, lw, ch, 0.04, lc);
            for (const e of [-1, 1]) box(pc, y0 + 0.01 + ch * 0.36, hs + e * 0.022, lw - 0.16, ch * 0.5, 0.004, 0xe4e0d7);
            for (const e of [-1, 1]) box(at + sd * (t / 2 + lw - 0.07), y0 + 1.0, hs + e * 0.03, 0.12, 0.03, 0.02, kc);
          }
        }
        cur = g1;
      }
      seg(cur, hi, y0, y0 + wh);
      // skirting both sides, broken at the gaps
      if (!o.noSkirt) {
        let a = lo;
        const sk = o.skirt == null ? 0xf2efe8 : o.skirt;
        const runs = [];
        for (let i = 0; i < gaps.length; i++) { runs.push([a, gaps[i].c - gaps[i].w / 2]); a = gaps[i].c + gaps[i].w / 2; }
        runs.push([a, hi]);
        for (let i = 0; i < runs.length; i++) {
          const r0 = Math.max(lo, runs[i][0]), r1 = Math.min(hi, runs[i][1]);
          if (r1 - r0 < 0.05) continue;
          if (axis === "x") box((r0 + r1) / 2, fy + 0.05, at, r1 - r0, 0.1, t + 0.03, sk);
          else box(at, fy + 0.05, (r0 + r1) / 2, t + 0.03, 0.1, r1 - r0, sk);
        }
      }
    }
    // A SKIN: paint a thin finish panel over an existing (eager) wall face,
    // offset `off` into the room. side = +1/-1 (which way the room is).
    function skin(axis, at, from, to, side, o) {
      o = o || {};
      const h = Math.min(o.h || (ceil - fy), ceil - fy), cy = fy + h / 2;
      const off = at + side * 0.012;
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const gaps = o.gaps || [];
      let cur = lo;
      const put = function (a, c2, ya, yb) {
        if (c2 - a < 0.02) return;
        const face = axis === "x" ? (side > 0 ? 16 : 32) : (side > 0 ? 1 : 2);
        if (axis === "x") box((a + c2) / 2, (ya + yb) / 2, off, c2 - a, yb - ya, 0.01, o.tint, { mat: o.mat || "plaster", faces: face });
        else box(off, (ya + yb) / 2, (a + c2) / 2, 0.01, yb - ya, c2 - a, o.tint, { mat: o.mat || "plaster", faces: face });
      };
      for (let i = 0; i < gaps.length; i++) {
        const g0 = gaps[i].c - gaps[i].w / 2, g1 = gaps[i].c + gaps[i].w / 2;
        put(cur, g0, fy, fy + h);
        put(g0, g1, y0 + (gaps[i].h || 2.1), fy + h);
        cur = g1;
      }
      put(cur, hi, fy, fy + h);
      if (!o.noSkirt) {
        const sk = o.skirt == null ? 0xf2efe8 : o.skirt;
        let a = lo;
        const runs = [];
        for (let i = 0; i < gaps.length; i++) { runs.push([a, gaps[i].c - gaps[i].w / 2]); a = gaps[i].c + gaps[i].w / 2; }
        runs.push([a, hi]);
        for (let i = 0; i < runs.length; i++) {
          const r0 = runs[i][0], r1 = runs[i][1];
          if (r1 - r0 < 0.05) continue;
          if (axis === "x") box((r0 + r1) / 2, fy + 0.05, at + side * 0.025, r1 - r0, 0.1, 0.03, sk);
          else box(at + side * 0.025, fy + 0.05, (r0 + r1) / 2, 0.03, 0.1, r1 - r0, sk);
        }
      }
    }
    // THE FITTINGS, as the things they are. Each one is a mounting that is
    // NOT lit (a ring, a canopy, a housing) around the part that IS (the
    // diffuser, the underside of a shade, the bulb), because a lamp you can
    // read is a dark or pale object with a bright face, not a glowing cube.
    function fixture(x, z, kind, o, col) {
      o = o || {};
      if (kind === "panel") {                          // 600x600 LED lay-in panel in the T-bar grid
        box(x, ceil - 0.01, z, 0.62, 0.02, 0.62, 0xd2d4d2);
        box(x, ceil - 0.024, z, 0.56, 0.008, 0.56, 0xf8f8f3, { glow: true, faces: 8 });
      } else if (kind === "strip") {                   // surface batten: housing + opal diffuser
        const L = o.len || 1.2, ax = o.axis === "z";
        box(x, ceil - 0.035, z, ax ? 0.12 : L, 0.07, ax ? L : 0.12, 0xdadcdb);
        box(x, ceil - 0.075, z, ax ? 0.07 : L - 0.06, 0.016, ax ? L - 0.06 : 0.07, 0xfdfcf6, { glow: true });
        box(x, ceil - 0.009, z, ax ? 0.14 : L + 0.02, 0.018, ax ? L + 0.02 : 0.14, 0xc9cbca);
      } else if (kind === "pendant") {                 // canopy, cord, a drum shade lit from inside
        const dy = o.drop || 0.7, sh = o.shade == null ? 0x2b2e33 : o.shade;
        box(x, ceil - 0.015, z, 0.12, 0.03, 0.12, 0xe6e4de);                         // canopy
        box(x, ceil - dy / 2, z, 0.012, dy, 0.012, 0x1e1e1e);                         // cord
        box(x, ceil - dy - 0.03, z, 0.05, 0.06, 0.05, 0x3a3a3a);                      // lamp holder
        box(x, ceil - dy - 0.06, z, 0.22, 0.04, 0.22, sh);                            // shade crown
        box(x, ceil - dy - 0.14, z, 0.34, 0.12, 0.34, sh);                            // shade drum
        box(x, ceil - dy - 0.2, z, 0.3, 0.004, 0.3, col, { glow: true, faces: 8 });  // the lit mouth
        box(x, ceil - dy - 0.13, z, 0.07, 0.08, 0.07, 0xfff4dc, { glow: true, faces: 8 });   // bulb in the shade
      } else if (kind === "bulb") {                    // bare lamp on a flex: holder + pear bulb
        const dy = o.drop || 0.45;
        box(x, ceil - dy / 2, z, 0.01, dy, 0.01, 0x151515);
        box(x, ceil - dy - 0.025, z, 0.035, 0.05, 0.035, 0x2a2a2a);
        box(x, ceil - dy - 0.075, z, 0.06, 0.06, 0.06, 0xfff0c0, { glow: true });
        box(x, ceil - dy - 0.115, z, 0.04, 0.02, 0.04, 0xfff0c0, { glow: true });
      } else if (kind === "can") {                     // recessed downlight: a trim ring and its lens
        box(x, ceil - 0.008, z, 0.2, 0.016, 0.2, 0xe6e6e2);
        box(x, ceil - 0.0175, z, 0.13, 0.002, 0.13, 0xfffaf0, { glow: true, faces: 8 });
      } else if (kind === "dome") {                    // flush ceiling dome: ring, stepped opal bowl
        box(x, ceil - 0.01, z, 0.36, 0.02, 0.36, 0xe4e2dc);
        box(x, ceil - 0.04, z, 0.3, 0.04, 0.3, 0xf6f2e8, { glow: true });
        box(x, ceil - 0.07, z, 0.2, 0.025, 0.2, 0xfbf8f0, { glow: true });
        box(x, ceil - 0.086, z, 0.03, 0.008, 0.03, 0xb9b6ae);                         // finial
      }
    }
    // A LIGHT: a fixture you can see + a baked light source. kind:
    //   "panel" 600×600 office troffer · "strip" batten · "pendant" drop shade
    //   "bulb" bare bulb on a cord (hideouts) · "dome" flush ceiling dome
    //   "none" source only (a lamp drew its own shade)
    function light(x, z, o) {
      o = o || {};
      const kind = o.kind || "dome", col = o.color == null ? 0xfff1d6 : o.color;
      const ly = o.y != null ? o.y : ceil - 0.05;
      fixture(x, z, kind, o, col);
      const src = { x: x, y: kind === "pendant" ? ceil - (o.drop || 0.7) - 0.2 : ly - 0.1, z: z,
                    r: o.r || 5.5, i: o.i == null ? 0.75 : o.i, rect: o.rect || null,
                    c: hexRGB(col) };
      lights.push(src);
      return src;
    }
    function lamp(x, z, yTop, o) {                     // a table/floor lamp's glow (the stand is the caller's)
      o = o || {};
      const src = { x: x, y: yTop, z: z, r: o.r || 3.2, i: o.i == null ? 0.45 : o.i, rect: o.rect || null,
                    c: hexRGB(o.color == null ? 0xffd9a0 : o.color) };
      lights.push(src);
      return src;
    }
    // THE KIT BRIDGE — CBZ.furnish through this builder's buckets.
    // An emissive kit part is self-lit here only when it is a LIGHT or a
    // SCREEN (ei >= 0.34: glass, a lamp's open mouth). A lampshade's fabric
    // (ei ~0.3) is lit by the lamp's baked source like any other surface, so
    // it reads as cloth with light behind it and not as a glowing block.
    function kitBox(lx, ly, lz, w, h, d, color, o) {
      box(lx, ly, lz, w, h, d, color, o && o.emissive != null && (o.ei == null || o.ei >= 0.34) ? { glow: true } : null);
      return true;
    }
    function furn(name, x, z, yaw, o) {
      const F = CBZ.furnish;
      if (!F || typeof F[name] !== "function") return null;
      const oo = { box: kitBox, ox: ox, oz: oz, lot: site.lot || null };
      if (o) for (const k in o) if (oo[k] === undefined) oo[k] = o[k];
      let r = null;
      const yy = o && o.atY != null ? o.atY : fy;           // a piece on a sill or a worktop
      try { r = name === "lamp" ? F.lamp(x, yy, z, oo) : F[name](x, yy, z, yaw || 0, oo); } catch (e) { r = null; }
      if (r) pieces.push({ tag: name, x: x, z: z, w: r.w, d: r.d, yaw: yaw || 0 });
      return r;
    }
    // world <-> local helpers the planners need
    const B = {
      site: site, b: b, floor: floor, lot: site.lot, k: floor.k, y0: y0, fy: fy, ceil: ceil, FH: FH,
      ox: ox, oz: oz, rect: floor.rect, info: floor.info || {},
      box: box, plane: plane, wall: wall, skin: skin, light: light, lamp: lamp, furn: furn, solid: solid,
      fixture: function (x, z, o) { o = o || {}; fixture(x, z, o.kind || "panel", o, o.color == null ? 0xfff1d6 : o.color); },
      pieces: pieces,
      // SOMEBODY IN THE ROOM. spec {x, z (local), face, job, seat|bed (a propuse
      // record, e.g. B.furn("sofa").seats[0].rec), when: "day"|"night"|null,
      // opts}. Declared through citystaff.js (a real ped minted only while you
      // are near, reaped when you leave), capped per floor; dies with the floor.
      person: function (spec) {
        if (!spec || people.length >= 3) return false;
        people.push(spec);
        return true;
      },
      h: function (a, b2, s) { return h01(ox + a * 1.37 + floor.k * 3.1, oz + b2 * 2.11, s | 0); },
      clear: function (x, z, pad) { return !b.clearFloorPoint || b.clearFloorPoint(x, z, pad == null ? 0.4 : pad); },
      loot: function (x, z, kind, o) {
        return CBZ.interiorLootRegister ? CBZ.interiorLootRegister(ox + x, y0, oz + z, kind, o || null) : null;
      },
      windows: function () { return windowsOn(b, y0, ceil); },
      holes: function () { return HOLES; },
    };
    // lift shafts / stair wells punched through this floor: never floored over
    let HOLES = [];
    const CEIL_HOLES = [];     // the ceiling is the slab ABOVE: a hole there only if that slab is opened
    const sr = b.shaftRects || [];
    // (a hole that opens only some slabs, a grand stair's, is a hole in this
    // floor's plate when it opens this slab, and in its ceiling when it opens
    // the one above)
    for (let i = 0; i < sr.length; i++) {
      const lv = sr[i].levels;
      const q = { x0: sr[i].x0 - 0.05, x1: sr[i].x1 + 0.05, z0: sr[i].z0 - 0.05, z1: sr[i].z1 + 0.05 };
      if (!lv || lv.indexOf(floor.k) >= 0) HOLES.push(q);
      if (!lv || lv.indexOf(floor.k + 1) >= 0) CEIL_HOLES.push(q);
    }
    B.addHole = function (r) { HOLES.push(r); CEIL_HOLES.push(r); };

    // ---- FINISH: arrays -> meshes, light baked into the vertex colours ----
    B.finish = function (parent) {
      const g = new THREE.Group();
      g.name = "fitout:" + site.key + ":" + floor.k;
      g.userData.dynamic = true;                        // never folded by core/batch.js
      g.userData.fitout = true;
      const meshes = [];
      for (const key in buckets) {
        const bk = buckets[key];
        if (!bk.idx.length) continue;
        const n = bk.pos.length / 3;
        const pos = new Float32Array(bk.pos), nor = new Float32Array(bk.nor), col = new Float32Array(bk.col);
        if (key !== "glow") bake(pos, nor, col, n, lights, fy, ceil);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        if (bk.tex) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(bk.uv), 2));
        geo.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(bk.idx), 1) : new THREE.BufferAttribute(new Uint16Array(bk.idx), 1));
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, texMat(key));
        m.castShadow = false; m.receiveShadow = key !== "glow" && key !== "glass";
        m.matrixAutoUpdate = false;
        if (key === "glass") m.renderOrder = 2;
        g.add(m);
        meshes.push(m);
      }
      g.updateMatrixWorld(true);
      if (parent) parent.add(g);
      if (cols.length && CBZ.colliders) {
        for (let i = 0; i < cols.length; i++) { cols[i].ref = g; CBZ.colliders.push(cols[i]); }
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
      }
      const out = { group: g, meshes: meshes, cols: cols, lights: lights.length, pieces: pieces.length, live: true, people: people.length };
      postPeople(site, floor.k, people, out);
      return out;
    };
    return B;
  }

  // ---- THE BAKE: vertex colour *= light at that vertex -----------------------
  // amb: what the room gets from the sky through the glass and the hemisphere
  // light; fixtures add a soft pool (quadratic falloff, lambert-ish on the
  // surface normal, confined to the fixture's room rect so light does not walk
  // through a wall). A crude contact shadow darkens the foot of every vertical
  // face and the ceiling corners — the cheap half of ambient occlusion.
  const AMB = 0.62;
  // Lights are binned into a 2 m grid once per floor (each light into every
  // cell its radius touches), so a vertex tests the handful of fixtures that
  // can reach it instead of every lamp on the storey.
  const BIN = 2.0;
  function bake(pos, nor, col, n, lights, fy, ceil) {
    const grid = new Map();
    for (let l = 0; l < lights.length; l++) {
      const L = lights[l];
      L.r2 = L.r * L.r;
      let x0 = L.x - L.r, x1 = L.x + L.r, z0 = L.z - L.r, z1 = L.z + L.r;
      if (L.rect) { x0 = Math.max(x0, L.rect.x0 - 0.25); x1 = Math.min(x1, L.rect.x1 + 0.25); z0 = Math.max(z0, L.rect.z0 - 0.25); z1 = Math.min(z1, L.rect.z1 + 0.25); }
      if (x1 < x0 || z1 < z0) continue;
      for (let gx = Math.floor(x0 / BIN); gx <= Math.floor(x1 / BIN); gx++)
        for (let gz = Math.floor(z0 / BIN); gz <= Math.floor(z1 / BIN); gz++) {
          const k = gx * 65536 + gz;
          const a = grid.get(k);
          if (a) a.push(L); else grid.set(k, [L]);
        }
    }
    const NONE = [];
    for (let v = 0; v < n; v++) {
      const i3 = v * 3;
      const px = pos[i3], py = pos[i3 + 1], pz = pos[i3 + 2];
      const nx = nor[i3], ny = nor[i3 + 1], nz = nor[i3 + 2];
      let lr = AMB, lg = AMB, lb = AMB;
      const list = grid.get(Math.floor(px / BIN) * 65536 + Math.floor(pz / BIN)) || NONE;
      for (let l = 0; l < list.length; l++) {
        const L = list[l];
        if (L.rect && (px < L.rect.x0 - 0.25 || px > L.rect.x1 + 0.25 || pz < L.rect.z0 - 0.25 || pz > L.rect.z1 + 0.25)) continue;
        const dx = L.x - px, dy = L.y - py, dz = L.z - pz;
        const q = dx * dx + dy * dy + dz * dz;
        if (q >= L.r2) continue;
        const d = Math.sqrt(q) + 1e-4;
        const f = 1 - d / L.r;
        const lam = Math.max(0, (dx * nx + dy * ny + dz * nz) / d) * 0.7 + 0.3;
        const e = L.i * f * f * lam;
        lr += e * L.c[0]; lg += e * L.c[1]; lb += e * L.c[2];
      }
      let ao = 1;
      if (ny < 0.5 && ny > -0.5) {
        const up = py - fy;
        if (up < 0.35) ao *= 0.72 + 0.28 * (up / 0.35);
        const dn = ceil - py;
        if (dn < 0.3) ao *= 0.85 + 0.15 * (dn / 0.3);
      }
      const cap = 1.55;
      col[i3] *= (lr < cap ? lr : cap) * ao;
      col[i3 + 1] *= (lg < cap ? lg : cap) * ao;
      col[i3 + 2] *= (lb < cap ? lb : cap) * ao;
    }
  }

  // facade windows on one storey, building-local
  function windowsOn(b, y0, ceil) {
    const out = [];
    const W = b.windows || [];
    const ox = b.ox || 0, oz = b.oz || 0;
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      if (!w || w.y == null || w.y < y0 || w.y > ceil) continue;
      const lx = w.x - ox, lz = w.z - oz;
      // which facade: thin axis is the wall normal
      const onX = (w.hw || 0) < (w.hd || 0);          // thin in x → pane on a ±x wall
      out.push({ x: lx, z: lz, y: w.y, hw: onX ? w.hd : w.hw, hh: w.hh || 0.8, axis: onX ? "z" : "x",
                 side: onX ? (lx < 0 ? -1 : 1) : (lz < 0 ? -1 : 1), shattered: !!w.shattered });
    }
    return out;
  }

  /* ========================================================================
     4. PLANNERS — registry. city/fitout_plans.js fills it.
     ======================================================================== */
  const PLANS = Object.create(null);
  CBZ.fitoutPlan = function (name, fn) { if (name && typeof fn === "function") PLANS[name] = fn; };
  CBZ.fitoutPlans = function () { return Object.keys(PLANS); };
  // the finish every declared floor gets when no planner claims it: a real
  // floor and a real light. Nothing else; the eager program is the room.
  function basePlan(B) {
    const r = B.rect; if (!r) return;
    B.plane(r.x0, r.z0, r.x1, r.z1, B.fy, "vinyl", 0xffffff);
    B.plane(r.x0, r.z0, r.x1, r.z1, B.ceil - 0.012, "ceiling", 0xffffff, { down: true, cell: 1.2 });
    const nx = Math.max(1, Math.round((r.x1 - r.x0) / 4.5)), nz = Math.max(1, Math.round((r.z1 - r.z0) / 4.5));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
      B.light(r.x0 + (i + 0.5) * (r.x1 - r.x0) / nx, r.z0 + (j + 0.5) * (r.z1 - r.z0) / nz, { kind: "panel", r: 5.5, i: 0.55 });
  }

  /* ========================================================================
     5. THE LIFECYCLE — build what you walk into, free what you leave.
     ======================================================================== */
  const LIVE = [];                   // sites with anything built
  const STATS = { built: 0, freed: 0, floorsLive: 0, lastMs: 0, maxMs: 0, errors: 0, lastError: null };
  const V3 = new THREE.Vector3();
  function siteWorld(s) {
    if (s.wx != null) return true;
    const g = s.b.group;
    if (!g) return false;
    try { if (g.updateWorldMatrix) g.updateWorldMatrix(true, false); V3.set(0, 0, 0).applyMatrix4(g.matrixWorld); }
    catch (e) { V3.set(s.b.ox || 0, 0, s.b.oz || 0); }
    s.wx = V3.x; s.wy = V3.y; s.wz = V3.z;
    return true;
  }
  function footDist(s, px, pz) {
    const dx = Math.max(0, Math.abs(px - s.wx) - s.b.w / 2);
    const dz = Math.max(0, Math.abs(pz - s.wz) - s.b.d / 2);
    return Math.sqrt(dx * dx + dz * dz);
  }
  function buildFloor(s, k) {
    const f = s.floors[k];
    if (!f || s.live[k]) return false;
    if (!f.rect && CBZ.interiorFloorRoom) f.rect = CBZ.interiorFloorRoom(s.b, k);
    if (!f.rect) { s.live[k] = { empty: true }; return false; }
    const t0 = performance.now();
    const B = makeBuilder(s, f);
    try {
      // only a program somebody wrote a fit-out for is fitted out: a state
      // room, a checkpoint or a vault keeps exactly what its owner drew.
      const fn = PLANS[f.prog] || (f.prog === "base" ? basePlan : null);
      if (!fn) { s.live[k] = { empty: true }; return false; }
      fn(B, f);
      drawPlacements(B, s, k);
    } catch (e) {
      STATS.errors++; STATS.lastError = String(e && e.stack || e);
      if (window.console) console.warn("[fitout] plan " + f.prog + " failed", e);
    }
    const parent = s.b.group || (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    s.live[k] = B.finish(parent);
    // THE REAL ROOM IS BEHIND THE GLASS NOW: city/interiorlight.js stops
    // hanging its painted room-gradient in this storey's windows (it restores
    // them when the floor is freed), so from the street you see into THIS.
    if (CBZ.cityInteriorGlowHideBox && s.wx != null) {
      const hb = { x0: s.wx - s.b.w / 2 - 1, x1: s.wx + s.b.w / 2 + 1, z0: s.wz - s.b.d / 2 - 1, z1: s.wz + s.b.d / 2 + 1,
                   y0: (s.wy || 0) + floorTopOf(s.b, k) + 0.05, y1: (s.wy || 0) + floorTopOf(s.b, k + 1) - 0.05 };
      s.live[k].glowBox = hb;
      try { CBZ.cityInteriorGlowHideBox(hb.x0, hb.x1, hb.y0, hb.y1, hb.z0, hb.z1, true); } catch (e) {}
    }
    STATS.built++;
    const ms = performance.now() - t0;
    STATS.lastMs = ms; STATS.maxMs = Math.max(STATS.maxMs, ms);
    return true;
  }
  // ---- THE PEOPLE (citystaff.js posts, one venue for the whole fit-out) ----
  const PEOPLE = { opened: false, serial: 0, live: 0 };
  const PEOPLE_MAX = 6;
  function postPeople(site, k, list, rec) {
    if (!list.length || !CBZ.cityStaffPost || CFG.INTERIOR_LIFE_V1 === false) return;
    if (!PEOPLE.opened) { PEOPLE.opened = true; if (CBZ.cityStaffVenue) CBZ.cityStaffVenue("fitout", { stations: 0, note: "people at home and at work" }); }
    const wx = site.wx != null ? site.wx : (site.b.ox || 0), wz = site.wz != null ? site.wz : (site.b.oz || 0);
    for (let i = 0; i < list.length; i++) {
      if (PEOPLE.live >= PEOPLE_MAX) break;
      const sp = list[i];
      const when = sp.when || null;
      PEOPLE.live++;
      rec.posted = (rec.posted | 0) + 1;
      CBZ.cityStaffPost({
        venue: "fitout", id: "fit:" + site.key + ":" + k + ":" + i + ":" + (++PEOPLE.serial),
        x: wx + sp.x, z: wz + sp.z, face: sp.face || 0, job: sp.job || null,
        seat: sp.seat || null, bed: sp.bed || null, pose: sp.pose || null,
        opts: Object.assign({ floorY: floorTopOf(site.b, k) }, sp.opts || {}),
        near: 34, far: 48,
        // the post lives exactly as long as the floor it was drawn on (and only
        // at the hour it belongs to): a freed floor's body is reaped next tick.
        alive: function () {
          if (!rec.live) return false;
          const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
          if (when === "night") return n > 0.45;
          if (when === "day") return n <= 0.45;
          return true;
        },
      });
    }
    if (CBZ.cityStaffStations) CBZ.cityStaffStations("fitout", PEOPLE.live);
  }
  function freeFloor(s, k) {
    const L = s.live[k];
    if (!L) return;
    delete s.live[k];
    if (L.empty) return;
    L.live = false;
    if (L.glowBox && CBZ.cityInteriorGlowHideBox) {
      const hb = L.glowBox;
      try { CBZ.cityInteriorGlowHideBox(hb.x0, hb.x1, hb.y0, hb.y1, hb.z0, hb.z1, false); } catch (e) {}
    }
    if (L.posted) PEOPLE.live = Math.max(0, PEOPLE.live - L.posted);
    if (L.group && L.group.parent) L.group.parent.remove(L.group);
    for (let i = 0; i < L.meshes.length; i++) { try { L.meshes[i].geometry.dispose(); } catch (e) {} }
    if (L.cols.length && CBZ.colliders) {
      const set = new Set(L.cols);
      const C = CBZ.colliders;
      let w = 0;
      for (let i = 0; i < C.length; i++) if (!set.has(C[i])) C[w++] = C[i];
      C.length = w;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    STATS.freed++;
  }
  function freeSite(s) { for (const k in s.live) freeFloor(s, +k); const i = LIVE.indexOf(s); if (i >= 0) LIVE.splice(i, 1); }
  function disposeAll() {
    for (let i = LIVE.length - 1; i >= 0; i--) freeSite(LIVE[i]);
    LIVE.length = 0;
    // nothing is fitted out: the venue's dead posts go too (re-opened on demand)
    if (PEOPLE.opened && CBZ.cityStaffVenue) { try { CBZ.cityStaffVenue("fitout", { stations: 0 }); } catch (e) {} }
    PEOPLE.opened = false; PEOPLE.live = 0;
  }
  CBZ.fitoutRebuild = function (b, k) {
    const s = b && SITES.get(siteKey(b));
    if (!s) return false;
    if (k == null) { for (const kk in s.live) freeFloor(s, +kk); }
    else freeFloor(s, k);
    return true;
  };

  let scanT = 0;
  let GRID = null;
  function gridBuild() {
    GRID = new Map();
    SITE_LIST = Array.from(SITES.values());
    for (let i = 0; i < SITE_LIST.length; i++) {
      const s = SITE_LIST[i];
      if (!siteWorld(s)) continue;
      const k = Math.floor(s.wx / 48) + "," + Math.floor(s.wz / 48);
      let a = GRID.get(k); if (!a) GRID.set(k, a = []); a.push(s);
    }
  }
  CBZ.onUpdate(37.7, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "city" || CFG.FITOUT === false) { if (LIVE.length) disposeAll(); return; }
    if (LIVE.length) {
      const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
      FIT_LIT.value = 0.12 + 0.42 * Math.max(0, Math.min(1, night));
    }
    scanT -= dt;
    if (scanT > 0) return;
    scanT = TICK;
    const P = CBZ.player;
    if (!P || !P.pos || !SITES.size) return;
    if (!SITE_LIST || !GRID) gridBuild();
    const px = P.pos.x, pz = P.pos.z, py = P.pos.y;
    // candidates: the 3×3 grid cells round you
    const gx = Math.floor(px / 48), gz = Math.floor(pz / 48);
    const cand = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = GRID.get((gx + i) + "," + (gz + j));
      if (!a) continue;
      for (let q = 0; q < a.length; q++) {
        const s = a[q];
        if (s.lot && s.lot.demolished) continue;
        s.dist = footDist(s, px, pz);
        if (s.dist < (s.live && LIVE.indexOf(s) >= 0 ? R_OUT : R_IN)) cand.push(s);
      }
    }
    cand.sort(function (a, b2) { return a.dist - b2.dist; });
    if (cand.length > MAX_SITES) cand.length = MAX_SITES;
    for (let i = LIVE.length - 1; i >= 0; i--) if (cand.indexOf(LIVE[i]) < 0) freeSite(LIVE[i]);
    if (!LIVE.length && PEOPLE.opened) disposeAll();
    let budget = 1;                                   // one floor built per scan
    for (let i = 0; i < cand.length; i++) {
      const s = cand[i];
      if (LIVE.indexOf(s) < 0) LIVE.push(s);
      const inside = s.dist <= 0.01;
      const kp = inside ? floorIndexOf(s.b, py - (s.wy || 0)) : 0;
      // floors to hold: yours ± FLOOR_SPAN (from the street: the ground and first)
      for (const kk in s.live) if (Math.abs(+kk - kp) > FLOOR_SPAN + 1) freeFloor(s, +kk);
      const order = [kp];
      for (let d = 1; d <= FLOOR_SPAN; d++) { order.push(kp + d); order.push(kp - d); }
      for (let q = 0; q < order.length && budget > 0; q++) {
        const k = order[q];
        if (k < 0 || !s.floors[k] || s.live[k]) continue;
        if (buildFloor(s, k)) budget--;
      }
    }
    let n = 0; for (let i = 0; i < LIVE.length; i++) for (const kk in LIVE[i].live) n++;
    STATS.floorsLive = n;
  });

  // a rebuilt city: every plan from the last arena is void
  // …and every declared site learns its LOT (ownership, loot, furnishing ask
  // the lot; the eager programs only ever saw the shell).
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    disposeAll(); GRID = null; SITE_LIST = null;
    const A = city || (CBZ.city && CBZ.city.arena) || null;
    const lots = (A && A.lots) || [];
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (!lot || !lot.building) continue;
      const s = SITES.get(siteKey(lot.building));
      if (s) s.lot = lot;
    }
  }, 90.4);

  CBZ.fitoutAudit = function () {
    const progs = Object.create(null);
    SITES.forEach(function (s) { for (const k in s.floors) { const p = s.floors[k].prog; progs[p] = (progs[p] | 0) + 1; } });
    return { sites: SITES.size, live: LIVE.map(function (s) { return { key: s.key, dist: +s.dist.toFixed(1), floors: Object.keys(s.live) }; }),
             progs: progs, plans: Object.keys(PLANS), stats: Object.assign({}, STATS), placements: PLACE.count() };
  };
  // the site the player is standing in (or nearest to), for tools and presets
  CBZ.fitoutSiteAt = function (x, z) {
    if (!GRID) gridBuild();
    let best = null, bd = 1e9;
    SITES.forEach(function (s) { if (!siteWorld(s)) return; const d = footDist(s, x, z); if (d < bd) { bd = d; best = s; } });
    return best;
  };
  CBZ.fitoutSites = function (prog) {
    const out = [];
    SITES.forEach(function (s) {
      for (const k in s.floors) if (!prog || s.floors[k].prog === prog) { out.push({ site: s, k: +k, floor: s.floors[k] }); if (!prog) break; }
    });
    return out;
  };

  /* ========================================================================
     6. CBZ.interiorFurnish — REFURNISH WHAT YOU OWN.

     The PROPERTY / build-mode side calls this; it never draws anything itself.
     A placement is DATA ({item, x, z, yaw} in building-local metres on one
     floor of one site); the fit-out draws it with the same builder, so an
     owned sofa is the same sofa as a planned one, it has a real seat, and it
     is freed with the rest of the floor when you walk away.

       CBZ.interiorFurnish.catalog()                 -> [{id,name,price,w,d}]
       CBZ.interiorFurnish.rooms(lot)                -> [{id,name,k,x0,x1,z0,z1,y}]
            the rooms of an owned property (a flat's unit, a floor, a hideout
            floor), building-local, from the same plan that drew them.
       CBZ.interiorFurnish.slots(lot, roomId)        -> [{x,z,yaw,wall}]
            suggested spots: against each wall (facing in) and the centre.
       CBZ.interiorFurnish.canPlace(lot, spec)       -> {ok, why}
       CBZ.interiorFurnish.place(lot, spec)          -> id | null
            spec {room, item, x, z, yaw}; x/z building-local. Rebuilds the
            floor live if you are standing in it.
       CBZ.interiorFurnish.remove(lot, id)           -> bool
       CBZ.interiorFurnish.list(lot)                 -> [placement]
       CBZ.interiorFurnish.clearDefault(lot, roomId, on)
            true = this room drops its planned furniture and shows only yours.
       CBZ.interiorFurnish.owns(lot)                 -> bool (the gate)
       CBZ.interiorFurnish.save() / load(obj)        persistence (localStorage
            'cbz.furnish.v1' by default; hand load() your own save blob).
     ======================================================================== */
  const CATALOG = [
    { id: "bed",       name: "Double bed",        price: 900,  w: 1.6, d: 2.2, furn: "bed",      o: { len: 2.1, wide: 1.5 } },
    { id: "sofa",      name: "Sofa",              price: 1200, w: 2.4, d: 0.95, furn: "sofa",    o: { len: 2.3 } },
    { id: "armchair",  name: "Armchair",          price: 450,  w: 0.9, d: 0.9, furn: "armchair" },
    { id: "table",     name: "Dining table",      price: 700,  w: 1.9, d: 1.9, furn: "table",    o: { len: 1.6, deep: 0.9, seats: 4 } },
    { id: "desk",      name: "Desk",              price: 500,  w: 1.4, d: 1.3, furn: "desk" },
    { id: "coffee",    name: "Coffee table",      price: 240,  w: 1.2, d: 0.7, furn: "coffee",   o: { len: 1.1, deep: 0.6 } },
    { id: "shelf",     name: "Bookshelf",         price: 320,  w: 1.2, d: 0.4, furn: "shelf" },
    { id: "locker",    name: "Wardrobe",          price: 380,  w: 1.4, d: 0.6, furn: "locker",   o: { n: 3, h: 2.0 } },
    { id: "lamp",      name: "Floor lamp",        price: 90,   w: 0.4, d: 0.4, furn: "lamp",     glow: 1.5 },
    { id: "tv",        name: "Television",        price: 800,  w: 1.6, d: 0.45, draw: "tv" },
    { id: "plant",     name: "Potted plant",      price: 60,   w: 0.5, d: 0.5, draw: "plant" },
    { id: "rug",       name: "Rug",               price: 220,  w: 2.4, d: 1.7, draw: "rug", flat: true },
    { id: "safe",      name: "Floor safe",        price: 2500, w: 0.7, d: 0.7, draw: "safe" },
    { id: "gunrack",   name: "Gun rack",          price: 1600, w: 1.4, d: 0.35, draw: "gunrack" },
    { id: "counttable",name: "Count table",       price: 1100, w: 2.0, d: 1.0, draw: "counttable" },
    { id: "bar",       name: "Home bar",          price: 1400, w: 2.0, d: 0.7, draw: "bar" },
    { id: "pooltable", name: "Pool table",        price: 2200, w: 2.6, d: 1.5, draw: "pooltable" },
  ];
  const CAT = Object.create(null);
  for (let i = 0; i < CATALOG.length; i++) CAT[CATALOG[i].id] = CATALOG[i];
  const PLACE = (function () {
    let DATA = { v: 1, sites: {} };          // siteKey -> { items: [...], cleared: {roomId:true}, serial }
    const listeners = [];
    function persist() { try { if (window.localStorage) localStorage.setItem("cbz.furnish.v1", JSON.stringify(DATA)); } catch (e) {} }
    try { const raw = window.localStorage && localStorage.getItem("cbz.furnish.v1"); if (raw) { const o = JSON.parse(raw); if (o && o.sites) DATA = o; } } catch (e) {}
    return {
      data: function () { return DATA; },
      rec: function (key, make) { let r = DATA.sites[key]; if (!r && make) r = DATA.sites[key] = { items: [], cleared: {}, serial: 0 }; return r || null; },
      save: persist,
      load: function (o) { if (o && o.sites) { DATA = o; persist(); } },
      count: function () { let n = 0; for (const k in DATA.sites) n += DATA.sites[k].items.length; return n; },
      emit: function (ev) { for (let i = 0; i < listeners.length; i++) try { listeners[i](ev); } catch (e) {} },
      on: function (fn) { if (typeof fn === "function") listeners.push(fn); },
    };
  })();
  // extra draw verbs for catalogue pieces the furniture kit has no word for;
  // fitout_plans.js registers the same names for its own rooms.
  const DRAW = Object.create(null);
  CBZ.fitoutDraw = function (name, fn) { if (name && typeof fn === "function") DRAW[name] = fn; };
  CBZ.fitoutDrawVerb = function (name) { return DRAW[name] || null; };
  function drawPlacements(B, s, k) {
    const r = PLACE.rec(s.key, false);
    if (!r) return;
    for (let i = 0; i < r.items.length; i++) {
      const it = r.items[i];
      if (it.k !== k) continue;
      const c = CAT[it.item]; if (!c) continue;
      if (c.furn) {
        const res = B.furn(c.furn, it.x, it.z, it.yaw || 0, c.o || null);
        if (res && c.glow) B.lamp(it.x, B.fy + c.glow, it.z, {});
      } else if (DRAW[c.draw]) {
        try { DRAW[c.draw](B, it.x, it.z, it.yaw || 0, it); } catch (e) {}
      }
    }
  }
  // "is this room one of the ones the plan cleared for the owner?" — planners ask
  CBZ.fitoutRoomCleared = function (B, roomId) { const r = PLACE.rec(B.site.key, false); return !!(r && r.cleared && r.cleared[roomId]); };

  function bOf(lot) { return lot && (lot.building || lot.b || lot); }
  function siteForLot(lot) { const b = bOf(lot); return b ? SITES.get(siteKey(b)) || null : null; }
  function owns(lot) {
    if (!lot) return false;
    if (CFG.FURNISH_ANY === true) return true;        // tools / presets
    if (CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot)) return true;
    if (CBZ.propertyVault && CBZ.propertyVault.has && lot.id != null) { try { if (CBZ.propertyVault.has(lot.id)) return true; } catch (e) {} }
    // a flat you hold the key to is yours to furnish (housing.js leases)
    const s = siteForLot(lot);
    if (s && CBZ.cityKeys && CBZ.cityKeys.has) {
      for (const k in s.floors) {
        const u = s.floors[k].info && s.floors[k].info.units;
        if (u) for (let i = 0; i < u.length; i++) if (u[i].id && CBZ.cityKeys.has(u[i].id)) return true;
      }
    }
    return false;
  }
  function rooms(lot) {
    const s = siteForLot(lot);
    if (!s) return [];
    const out = [];
    for (const k in s.floors) {
      const f = s.floors[k];
      if (!f.rect && CBZ.interiorFloorRoom) f.rect = CBZ.interiorFloorRoom(s.b, +k);
      const units = f.info && f.info.units;
      if (units && units.length) {
        for (let i = 0; i < units.length; i++) {
          const u = units[i];
          const mine = CFG.FURNISH_ANY === true || (CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot)) || (CBZ.cityKeys && CBZ.cityKeys.has && CBZ.cityKeys.has(u.id));
          if (!mine) continue;
          out.push({ id: "u:" + u.id, name: u.label || ("Unit " + (i + 1)), k: +k, y: f.y,
                     x0: u.x0, x1: u.x1, z0: u.z0, z1: u.z1, unit: u.id });
        }
      } else if (f.rect) {
        out.push({ id: "f:" + k, name: k == 0 ? "Ground floor" : "Floor " + (+k + 1), k: +k, y: f.y,
                   x0: f.rect.x0, x1: f.rect.x1, z0: f.rect.z0, z1: f.rect.z1 });
      }
    }
    return out;
  }
  function roomById(lot, id) { const R = rooms(lot); for (let i = 0; i < R.length; i++) if (R[i].id === id) return R[i]; return null; }
  function canPlace(lot, spec) {
    if (!owns(lot)) return { ok: false, why: "not yours" };
    const c = spec && CAT[spec.item]; if (!c) return { ok: false, why: "unknown item" };
    const R = roomById(lot, spec.room); if (!R) return { ok: false, why: "no such room" };
    const sw = Math.abs(Math.sin(spec.yaw || 0)) > 0.7;
    const hw = (sw ? c.d : c.w) / 2, hd = (sw ? c.w : c.d) / 2;
    if (spec.x - hw < R.x0 - 0.01 || spec.x + hw > R.x1 + 0.01 || spec.z - hd < R.z0 - 0.01 || spec.z + hd > R.z1 + 0.01) return { ok: false, why: "does not fit the room" };
    const b = bOf(lot);
    if (!c.flat && b && b.clearFloorPoint && !b.clearFloorPoint(spec.x, spec.z, 0.2)) return { ok: false, why: "blocks the door or the stairs" };
    const s = siteForLot(lot), r = s && PLACE.rec(s.key, false);
    if (r && !c.flat) for (let i = 0; i < r.items.length; i++) {
      const it = r.items[i]; if (it.k !== R.k) continue;
      const o = CAT[it.item]; if (!o || o.flat) continue;
      const s2 = Math.abs(Math.sin(it.yaw || 0)) > 0.7;
      const ow = (s2 ? o.d : o.w) / 2, od = (s2 ? o.w : o.d) / 2;
      if (Math.abs(it.x - spec.x) < ow + hw - 0.02 && Math.abs(it.z - spec.z) < od + hd - 0.02) return { ok: false, why: "something is already there" };
    }
    return { ok: true, why: null };
  }
  CBZ.interiorFurnish = {
    catalog: function () { return CATALOG.map(function (c) { return { id: c.id, name: c.name, price: c.price, w: c.w, d: c.d }; }); },
    owns: owns,
    rooms: rooms,
    slots: function (lot, roomId) {
      const R = roomById(lot, roomId); if (!R) return [];
      const out = [], cxm = (R.x0 + R.x1) / 2, czm = (R.z0 + R.z1) / 2;
      out.push({ x: cxm, z: czm, yaw: 0, wall: null });
      const inset = 0.55;
      out.push({ x: cxm, z: R.z0 + inset, yaw: 0, wall: "z0" }, { x: cxm, z: R.z1 - inset, yaw: Math.PI, wall: "z1" },
               { x: R.x0 + inset, z: czm, yaw: Math.PI / 2, wall: "x0" }, { x: R.x1 - inset, z: czm, yaw: -Math.PI / 2, wall: "x1" });
      return out;
    },
    canPlace: canPlace,
    place: function (lot, spec) {
      const ok = canPlace(lot, spec);
      if (!ok.ok) return null;
      const s = siteForLot(lot); if (!s) return null;
      const R = roomById(lot, spec.room);
      const r = PLACE.rec(s.key, true);
      const id = "p" + (++r.serial);
      r.items.push({ id: id, item: spec.item, room: spec.room, k: R.k, x: +spec.x, z: +spec.z, yaw: +spec.yaw || 0 });
      PLACE.save();
      freeFloor(s, R.k);                              // the next scan rebuilds it with the piece in it
      PLACE.emit({ type: "place", lot: lot, id: id });
      return id;
    },
    remove: function (lot, id) {
      const s = siteForLot(lot); const r = s && PLACE.rec(s.key, false);
      if (!r) return false;
      for (let i = 0; i < r.items.length; i++) if (r.items[i].id === id) {
        const k = r.items[i].k; r.items.splice(i, 1); PLACE.save(); freeFloor(s, k);
        PLACE.emit({ type: "remove", lot: lot, id: id }); return true;
      }
      return false;
    },
    list: function (lot) { const s = siteForLot(lot); const r = s && PLACE.rec(s.key, false); return r ? r.items.slice() : []; },
    clearDefault: function (lot, roomId, on) {
      if (!owns(lot)) return false;
      const s = siteForLot(lot); if (!s) return false;
      const r = PLACE.rec(s.key, true); const R = roomById(lot, roomId); if (!R) return false;
      if (on === false) delete r.cleared[roomId]; else r.cleared[roomId] = true;
      PLACE.save(); freeFloor(s, R.k); return true;
    },
    onChange: PLACE.on,
    save: function () { PLACE.save(); return PLACE.data(); },
    load: function (o) { PLACE.load(o); disposeAll(); },
  };
})();
