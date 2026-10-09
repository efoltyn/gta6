/* ============================================================
   city/flags.js — ONE FLAG SYSTEM. Every nation's flag, everywhere.

   OWNER (2026-09-30): "FLAGS IN THE PRESIDENTIAL MODE: MAKE FLAGS WAY
   BETTER BECAUSE THEY SHOW OFTEN AND ARE NOT THE SAME EACH PLACE AND LOOK
   ULTRA FAKE. MAKE THEM REAL AF AND ALLOW CUSTOM FLAGS ETC."

   What was here before: nine separate flags, each its own idea of the
   country. govcomplex.js hung three coloured strips (white/blue/red) off a
   pole; buildings_civic.js a blue box with a white box on it; motorcade.js
   a white box over a blue box; island_military.js three overlapping boxes;
   president_public.js a navy canvas with a white band; interior_programs.js
   flat blue / red / green boxes on four different stand builders; the
   regime dressing flat-coloured boxes; towngen.js a bare pole with nothing
   on it. Same nation, nine designs, none of them a flag.

   NOW ONE SOURCE:
     §1  DESIGNS     real flag grammar per nation (tricolours, cantons,
                     Nordic crosses, serrated hoists, hoist triangles,
                     fimbriation, emblems) at real proportions (10:19, 8:11,
                     3:5, 1:2, 2:3), plus factions (rebels, juntas, terror
                     cells, gangs), regimes, the head-of-state standard and
                     generated flags for anything registered later.
     §2  RESOLVE     designFor(id): custom > regime > authored > by govType
                     > generated. Every id resolves to exactly one design.
     §3  PAINT       one canvas painter. Every design is painted once per
                     nation (512 px, sRGB, a sewn heading strip with brass
                     grommets on the hoist, stitched hems, a dye grain), and
                     REPAINTED IN PLACE when the design changes, so a new
                     flag reaches every pole, desk and car in the same frame.
     §4  CLOTH       one material per design (MeshPhong, soft specular, a
                     plain weave that only appears when the threads resolve),
                     one shared shader program for every flag in the game:
                     a GPU travelling wave from hoist to fly driven by the
                     weather's wind (CBZ.weatherWind), more at the free end,
                     a fluttering fly edge, pole flags swivel downwind and
                     droop in light air. Far flags keep the big wave and drop
                     the fine ripples (shader-side, nothing to swap). No CPU
                     cloth sim. Indoors: flex 0, the drape is baked folds.
     §5  HARDWARE    tapered pole, truck, ball or eagle finial, halyard and
                     cleat; indoor staffs with a bell base, eagle finial,
                     gold fringe and a tassel cord; hanging banners with a
                     rod and a weighted hem.
     §6  PLACEMENT   pole() / staff() / banner() / hand() / car() — the only
                     ways a flag enters the world. Pole flags in one build
                     are INSTANCED per (root, design, size, 300 m cell).
     §7  CUSTOM      the President redesigns the flag at the national
                     standard behind the desk: pattern / colours / emblem,
                     live on that cloth, hold E to adopt. Persists in the
                     save (g.cityWorld.flags), emits "flag-changed" {text}.
     §8  REGIME      president_regime.js calls setRegime(nation, key): the
                     junta, the crown, the party bring their own flag.

   PUBLIC: CBZ.flags = { designFor, resolveId, nationAt, home, ids, paint,
     material, texture, pole, staff, banner, hand, car, flush, setCustom,
     setRegime, custom, designer, dataURL, audit, LAYOUTS, EMBLEMS, PALETTES }
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE || null;

  // ============================================================
  //  §1  DESIGNS — data only, no THREE (a headless check reads this)
  // ============================================================
  const C = {
    navy: "#1b2a5a", royal: "#1f4fa3", sky: "#6aa6da", azure: "#1466b0", teal: "#0f7f86",
    crimson: "#b1202f", scarlet: "#d1291f", maroon: "#6e1a2c", wine: "#6e1512",
    forest: "#1d6b3a", emerald: "#14955a", olive: "#4e5330", khaki: "#a99c6a",
    gold: "#e2b22f", ochre: "#d39a1c", orange: "#e8721c", saffron: "#f2a516",
    white: "#f4f1e8", black: "#16181c", purple: "#4a2b70", sand: "#d9c38f",
  };

  // ratio = [hoist, fly]. Layout + colours + emblem, and nothing else: the
  // painter turns any combination into a flag.
  const NATIONS = {
    // Thirteen stars round one, on a navy canton over nine crimson and white
    // stripes. The country's own stripes-and-canton, at the 10:19 of its era.
    republic: {
      name: "Republic of Liberty", ratio: [10, 19], layout: "stripes-canton",
      colors: [C.crimson, C.white, C.navy], stripes: 9, cantonStripes: 5, cantonW: 0.4,
      emblem: { kind: "star-ring", color: C.white, n: 13 },
    },
    // A Nordic cross: the white-fimbriated royal cross on Veridian green, 8:11.
    veridia: {
      name: "Republic of Veridia", ratio: [8, 11], layout: "nordic",
      colors: [C.forest, C.white, C.royal], emblem: { kind: "none" },
    },
    // The Gulf grammar: a white serrated hoist of nine points on maroon,
    // the crown of the house in the field. 3:5.
    kesh: {
      name: "Kingdom of Kesh", ratio: [3, 5], layout: "serrated-hoist",
      colors: [C.maroon, C.white], points: 9, emblem: { kind: "crown", color: C.gold, color2: C.maroon },
    },
    // Sunset over the sea: orange over azure, a white hoist triangle with a
    // gold sun of sixteen rays. 1:2.
    solara: {
      name: "Solara", ratio: [1, 2], layout: "hoist-triangle",
      colors: [C.orange, C.azure, C.white], emblem: { kind: "sun", color: C.gold, color2: C.orange },
    },
    // Green, black and ochre with white fimbriation, the federal shield and
    // crossed spears over the centre. 2:3.
    mbeya: {
      name: "Mbeya Federation", ratio: [2, 3], layout: "triband-fimbriated",
      colors: [C.forest, C.black, C.ochre, C.white],
      emblem: { kind: "shield-spears", color: C.crimson, color2: C.white, color3: C.black },
    },
  };

  const FACTIONS = {
    // the insurgency: red over black on the diagonal, a white star at the hoist
    rebels: { name: "Liberation Front", ratio: [2, 3], layout: "diagonal", colors: [C.scarlet, C.black], emblem: { kind: "star", color: C.white } },
    // a coup's council: olive drab, a thin gold border, the winged sword
    junta: { name: "National Salvation Council", ratio: [2, 3], layout: "border", colors: [C.olive, C.gold], emblem: { kind: "winged-sword", color: C.gold } },
    // a cell: black over red, crossed rifles under a star at the hoist
    terror: { name: "the cell", ratio: [2, 3], layout: "bicolour-h", colors: [C.black, C.crimson], emblem: { kind: "crossed-rifles", color: C.white, pos: "hoist" } },
  };

  // A regime brings its own flag (president_regime.js's palette rows, the
  // same cloth/band/trim the banners on the Mansion are dyed in).
  const REGIMES = {
    dictatorship: { name: "the State", layout: "centred-disc", colors: [C.wine, C.black, C.black], emblem: { kind: "laurel-star", color: C.gold } },
    fascism: { name: "the Party", layout: "tricolour-h", colors: [C.black, C.crimson, C.black], bands: [1, 2, 1], emblem: { kind: "torch", color: C.gold } },
    communism: { name: "the People's State", layout: "plain", colors: ["#a8201a"], emblem: { kind: "gear-star", color: C.gold, pos: "canton" } },
    monarchy: { name: "the Crown", layout: "border", colors: [C.purple, C.gold], emblem: { kind: "crown", color: C.gold, color2: C.purple } },
    junta: FACTIONS.junta,
  };

  // what the President's designer offers: a few real templates, curated
  // colour sets that read as real national flags, and the emblems
  const LAYOUTS = ["tricolour-v", "tricolour-h", "stripes-canton", "nordic", "hoist-triangle", "serrated-hoist", "diagonal", "centred-disc", "triband-fimbriated", "border"];
  const PALETTES = [
    [C.crimson, C.white, C.navy], [C.forest, C.white, C.scarlet], [C.black, C.scarlet, C.gold],
    [C.sky, C.white, C.gold], [C.emerald, C.gold, C.scarlet], [C.navy, C.gold, C.white],
    [C.maroon, C.white, C.gold], [C.orange, C.white, C.forest], [C.royal, C.gold, C.crimson], [C.purple, C.gold, C.white],
  ];
  const EMBLEMS = ["none", "star", "star-ring", "sun", "eagle", "crown", "laurel-star", "shield-spears", "tree", "crescent-star", "gear-star"];

  // ============================================================
  //  §2  RESOLVE
  // ============================================================
  const CUSTOM = Object.create(null);   // nation id -> design the President adopted
  const REGIME = Object.create(null);   // nation id -> REGIMES key
  function h32(s) { s = String(s || ""); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function clone(d) { return JSON.parse(JSON.stringify(d)); }
  function hexStr(n) { return "#" + ("000000" + ((n >>> 0) & 0xffffff).toString(16)).slice(-6); }
  function polRec(id) { try { return CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; } catch (e) { return null; } }

  // A flag for anything nobody authored: a partitioned country, a city, a
  // gang. Same grammar, chosen off the id, so it is stable across sessions.
  function generated(id, style, base) {
    const h = h32(id);
    const pal = PALETTES[h % PALETTES.length].slice();
    if (base != null) pal[0] = typeof base === "number" ? hexStr(base) : base;
    if (style === "civic") return { name: id, ratio: [2, 3], layout: (h >>> 4) & 1 ? "bicolour-h" : "tricolour-v", colors: [pal[0], C.white, pal[0]], emblem: { kind: "star-ring", color: C.gold, n: 8 + (h >>> 8) % 6 } };
    if (style === "gang") {
      const em = ["crown", "star", "diamond", "crescent-star"][(h >>> 6) % 4];
      return { name: id, ratio: [2, 3], layout: "diagonal", colors: [pal[0], C.black], emblem: { kind: em, color: C.white } };
    }
    const lay = ["tricolour-v", "tricolour-h", "nordic", "diagonal", "centred-disc", "hoist-triangle", "triband-fimbriated"][(h >>> 3) % 7];
    const em = ["none", "star", "sun", "laurel-star", "crescent-star", "tree"][(h >>> 9) % 6];
    return { name: id, ratio: lay === "nordic" ? [8, 11] : [2, 3], layout: lay, colors: [pal[0], pal[1], pal[2], C.white], emblem: { kind: em, color: pal[1] === C.white ? C.gold : C.white } };
  }
  // the head of state's standard: the nation's darkest colour as a field,
  // the eagle in gold inside a ring of white stars
  function standardOf(nation) {
    const d = designFor(nation);
    let dark = C.navy, best = 9;
    for (let i = 0; i < (d.colors || []).length; i++) { const l = lum(d.colors[i]); if (l < best) { best = l; dark = d.colors[i]; } }
    if (best > 0.35) dark = C.navy;
    return { name: (d.name || nation) + " standard", ratio: [4, 5], layout: "plain", colors: [dark], emblem: { kind: "eagle-ring", color: C.gold, color2: C.white } };
  }

  // id grammar: "<nation>" | "standard:<nation>" | "faction:<rebels|junta|terror>"
  //             | "gang:<id>" | "city:<id>" | "regime:<key>"
  function designFor(id) {
    id = String(id || "republic");
    const ci = id.indexOf(":");
    if (ci > 0) {
      const kind = id.slice(0, ci), rest = id.slice(ci + 1);
      if (kind === "standard") return standardOf(rest);
      if (kind === "faction") return clone(FACTIONS[rest] || FACTIONS.rebels);
      if (kind === "regime") return Object.assign({ ratio: [2, 3] }, clone(REGIMES[rest] || REGIMES.dictatorship));
      if (kind === "city") return generated(id, "civic");
      if (kind === "gang") {
        let col = null;
        const G = CBZ.CITY && CBZ.CITY.gangs;
        if (Array.isArray(G)) for (let i = 0; i < G.length; i++) if (G[i] && G[i].id === rest) col = G[i].color;
        return generated(id, "gang", col);
      }
      return generated(id);
    }
    const base = NATIONS[id];
    if (CUSTOM[id]) return Object.assign(clone(CUSTOM[id]), { ratio: ratioOf(id), custom: true });
    if (REGIME[id] && REGIMES[REGIME[id]]) return Object.assign(clone(REGIMES[REGIME[id]]), { ratio: ratioOf(id), regime: REGIME[id] });
    if (base) return clone(base);
    const rec = polRec(id);
    const gt = rec && rec.govType;
    if (gt === "insurgency") return Object.assign(clone(FACTIONS.rebels), { name: rec.name || "Liberation Front" });
    if (gt === "juntaRebel") return Object.assign(clone(FACTIONS.junta), { name: rec.name || "the junta" });
    const gd = generated(id);
    if (rec && rec.name) gd.name = rec.name;
    return gd;
  }
  // a nation's proportions belong to the nation (the poles were cut for
  // them): a regime or a redesign paints into the same 10:19
  function ratioOf(id) {
    if (NATIONS[id]) return NATIONS[id].ratio.slice();
    return [2, 3];
  }
  function ids() {
    const out = Object.keys(NATIONS);
    try {
      const L = CBZ.polity && CBZ.polity.list ? CBZ.polity.list("country") || [] : [];
      for (let i = 0; i < L.length; i++) if (L[i] && L[i].id && out.indexOf(L[i].id) < 0) out.push(L[i].id);
    } catch (e) {}
    return out;
  }
  // which nation stands at a world point (the polity's own map), the
  // Republic when nobody claims it
  function nationAt(x, z) {
    const P = CBZ.polity;
    if (P && P.of && P.countryOf) {
      try {
        const r = P.of(x, z);
        const c = r ? P.countryOf(r.id) : null;
        if (c && c.id) return c.id;
      } catch (e) {}
    }
    return "republic";
  }
  // the President's country
  function home() {
    const P = CBZ.presidency;
    if (P && typeof P.seat === "function") {
      try { const h = P.seat(); if (h && h.kind === "country" && h.id) return h.id; } catch (e) {}
    }
    return "republic";
  }

  // ============================================================
  //  §3  PAINT — one painter for every design, any aspect
  // ============================================================
  function rgb(c) {
    const s = String(c).replace("#", "");
    const n = parseInt(s.length === 3 ? s.replace(/(.)/g, "$1$1") : s, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lum(c) { const q = rgb(c); return (0.2126 * q[0] + 0.7152 * q[1] + 0.0722 * q[2]) / 255; }
  function contrast(a, b) { return Math.abs(lum(a) - lum(b)); }
  function shade(c, f) { const q = rgb(c); return "rgb(" + Math.round(q[0] * f) + "," + Math.round(q[1] * f) + "," + Math.round(q[2] * f) + ")"; }

  // ---- emblems: centred at (x, y), s = the height of the emblem's box ------
  function starPath(x, y, R, r, rot) {
    const P = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (rot || 0) + i * Math.PI / 5, rr = i % 2 ? (r != null ? r : R * 0.382) : R;
      P.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    return P;
  }
  function poly(g, P, fill) { g.beginPath(); g.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) g.lineTo(P[i][0], P[i][1]); g.closePath(); g.fillStyle = fill; g.fill(); }
  function star(g, x, y, R, col, rot) { poly(g, starPath(x, y, R, null, rot), col); }
  function starRing(g, x, y, s, col, n, centre) {
    n = n || 13;
    const rr = s * 0.40, sr = s * 0.075;
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; star(g, x + Math.cos(a) * rr, y + Math.sin(a) * rr, sr, col); }
    if (centre !== false) star(g, x, y, s * 0.23, col);
  }
  function sun(g, x, y, s, col, col2) {
    const R = s * 0.48, r = s * 0.2;
    g.fillStyle = col;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, w = Math.PI / 22, L = i % 2 ? R * 0.78 : R;
      g.beginPath();
      g.moveTo(x + Math.cos(a - w) * r * 1.08, y + Math.sin(a - w) * r * 1.08);
      g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
      g.lineTo(x + Math.cos(a + w) * r * 1.08, y + Math.sin(a + w) * r * 1.08);
      g.closePath(); g.fill();
    }
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    if (col2) { g.strokeStyle = col2; g.lineWidth = Math.max(1, s * 0.022); g.beginPath(); g.arc(x, y, r * 0.78, 0, Math.PI * 2); g.stroke(); }
  }
  function crown(g, x, y, s, col, col2) {
    const w = s * 0.82, h = s * 0.6, by = y + h * 0.42, ty = y - h * 0.5;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x - w / 2, by);
    g.lineTo(x - w / 2, y - h * 0.05);
    const pts = 5;
    for (let i = 0; i <= pts * 2; i++) {
      const t = i / (pts * 2), px = x - w / 2 + t * w;
      const top = i % 2 === 0 ? (i === pts ? ty - h * 0.08 : ty + (i === 0 || i === pts * 2 ? h * 0.2 : 0)) : y + h * 0.08;
      g.lineTo(px, top);
    }
    g.lineTo(x + w / 2, by);
    g.closePath(); g.fill();
    // the band and the pearls on the points
    g.fillRect(x - w / 2 - s * 0.03, by - s * 0.02, w + s * 0.06, s * 0.13);
    for (let i = 0; i <= pts; i++) {
      const px = x - w / 2 + (i / pts) * w;
      const top = i === pts / 2 ? ty - h * 0.08 : (i === 0 || i === pts ? ty + h * 0.2 : ty);
      g.beginPath(); g.arc(px, top - s * 0.04, s * 0.045, 0, Math.PI * 2); g.fill();
    }
    if (col2) {
      g.fillStyle = col2;
      for (let i = -1; i <= 1; i++) { g.beginPath(); g.arc(x + i * w * 0.3, by + s * 0.045, s * 0.03, 0, Math.PI * 2); g.fill(); }
    }
  }
  // the eagle displayed: wings up and spread, fingered primaries, tail fanned
  const EAGLE_R = [
    [0.0, -0.36], [0.07, -0.30], [0.13, -0.24], [0.30, -0.36], [0.52, -0.58], [0.78, -0.80], [0.96, -0.86],
    [0.90, -0.66], [0.98, -0.58], [0.86, -0.46], [0.94, -0.36], [0.80, -0.26], [0.86, -0.14], [0.66, -0.08],
    [0.70, 0.02], [0.46, 0.04], [0.20, 0.10], [0.16, 0.30], [0.30, 0.52], [0.24, 0.56], [0.20, 0.80],
    [0.10, 0.70], [0.0, 0.86],
  ];
  function eagle(g, x, y, s, col) {
    const k = s * 0.5, P = [];
    for (let i = 0; i < EAGLE_R.length; i++) P.push([x + EAGLE_R[i][0] * k, y + EAGLE_R[i][1] * k]);
    for (let i = EAGLE_R.length - 2; i >= 1; i--) P.push([x - EAGLE_R[i][0] * k, y + EAGLE_R[i][1] * k]);
    poly(g, P, col);
    // head turned to the hoist, the beak hooked
    g.beginPath(); g.arc(x - 0.03 * k, y - 0.46 * k, 0.12 * k, 0, Math.PI * 2); g.fill();
    poly(g, [[x - 0.12 * k, y - 0.50 * k], [x - 0.26 * k, y - 0.44 * k], [x - 0.13 * k, y - 0.39 * k]], col);
  }
  function laurel(g, x, y, s, col) {
    g.fillStyle = col;
    const R = s * 0.42;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 9; i++) {
        const a = Math.PI / 2 + side * (0.30 + i * 0.27);
        const lx = x + Math.cos(a) * R, ly = y + Math.sin(a) * R;
        g.beginPath(); g.ellipse(lx, ly, s * 0.065, s * 0.028, a + side * 0.9, 0, Math.PI * 2); g.fill();
      }
    }
    g.strokeStyle = col; g.lineWidth = Math.max(1, s * 0.018);
    g.beginPath(); g.arc(x, y, R * 0.93, Math.PI / 2 + 0.3, Math.PI / 2 + 0.3 + 8 * 0.27); g.stroke();
    g.beginPath(); g.arc(x, y, R * 0.93, Math.PI / 2 - 0.3 - 8 * 0.27, Math.PI / 2 - 0.3); g.stroke();
  }
  function shieldSpears(g, x, y, s, c1, c2, c3) {
    g.strokeStyle = c2 || C.white; g.lineWidth = Math.max(1.5, s * 0.03);
    for (let sd = -1; sd <= 1; sd += 2) {
      g.beginPath(); g.moveTo(x - sd * s * 0.36, y + s * 0.46); g.lineTo(x + sd * s * 0.30, y - s * 0.38); g.stroke();
      const tx = x + sd * s * 0.30, ty = y - s * 0.38, a = Math.atan2(-s * 0.84, sd * s * 0.66);
      g.save(); g.translate(tx, ty); g.rotate(a + Math.PI / 2);
      g.fillStyle = c2 || C.white; g.beginPath(); g.ellipse(0, -s * 0.05, s * 0.035, s * 0.09, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.fillStyle = c2 || C.white; g.beginPath(); g.ellipse(x, y, s * 0.24, s * 0.42, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = c1; g.beginPath(); g.ellipse(x, y, s * 0.20, s * 0.38, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = c3 || C.black; g.beginPath(); g.ellipse(x, y, s * 0.06, s * 0.30, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = c2 || C.white;
    for (let sd = -1; sd <= 1; sd += 2) { g.beginPath(); g.ellipse(x + sd * s * 0.12, y, s * 0.025, s * 0.16, 0, 0, Math.PI * 2); g.fill(); }
  }
  function tree(g, x, y, s, col) {
    g.fillStyle = col;
    g.fillRect(x - s * 0.04, y + s * 0.18, s * 0.08, s * 0.28);
    for (let i = 0; i < 4; i++) {
      const ty = y - s * 0.42 + i * s * 0.16, w = s * (0.18 + i * 0.1);
      poly(g, [[x, ty], [x + w, ty + s * 0.2], [x - w, ty + s * 0.2]], col);
    }
  }
  function crescentStar(g, x, y, s, col, bg) {
    g.fillStyle = col; g.beginPath(); g.arc(x - s * 0.06, y, s * 0.36, 0, Math.PI * 2); g.fill();
    g.fillStyle = bg; g.beginPath(); g.arc(x + s * 0.04, y, s * 0.30, 0, Math.PI * 2); g.fill();
    star(g, x + s * 0.22, y, s * 0.14, col, -0.3);
  }
  function gearStar(g, x, y, s, col) {
    const R = s * 0.42, r = s * 0.34, n = 14;
    const P = [];
    for (let i = 0; i < n * 4; i++) {
      const a = i * Math.PI * 2 / (n * 4), tooth = (i % 4) < 2;
      P.push([x + Math.cos(a) * (tooth ? R : r), y + Math.sin(a) * (tooth ? R : r)]);
    }
    poly(g, P, col);
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.arc(x, y, s * 0.27, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over";
    star(g, x, y, s * 0.22, col);
  }
  function torch(g, x, y, s, col) {
    poly(g, [[x - s * 0.08, y - s * 0.05], [x + s * 0.08, y - s * 0.05], [x + s * 0.04, y + s * 0.46], [x - s * 0.04, y + s * 0.46]], col);
    g.fillRect(x - s * 0.12, y - s * 0.1, s * 0.24, s * 0.06);
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x - s * 0.12, y - s * 0.12);
    g.bezierCurveTo(x - s * 0.2, y - s * 0.3, x - s * 0.02, y - s * 0.34, x, y - s * 0.5);
    g.bezierCurveTo(x + s * 0.08, y - s * 0.32, x + s * 0.22, y - s * 0.28, x + s * 0.12, y - s * 0.12);
    g.closePath(); g.fill();
  }
  function wingedSword(g, x, y, s, col) {
    poly(g, [[x - s * 0.03, y - s * 0.46], [x, y - s * 0.52], [x + s * 0.03, y - s * 0.46], [x + s * 0.03, y + s * 0.18], [x - s * 0.03, y + s * 0.18]], col);
    g.fillStyle = col;
    g.fillRect(x - s * 0.14, y + s * 0.16, s * 0.28, s * 0.05);
    g.fillRect(x - s * 0.025, y + s * 0.2, s * 0.05, s * 0.18);
    g.beginPath(); g.arc(x, y + s * 0.42, s * 0.045, 0, Math.PI * 2); g.fill();
    for (let sd = -1; sd <= 1; sd += 2) {
      const P = [[x + sd * s * 0.05, y + s * 0.08]];
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        P.push([x + sd * s * (0.12 + t * 0.36), y - s * (0.02 + t * 0.30)]);
        P.push([x + sd * s * (0.10 + t * 0.30), y - s * (-0.06 + t * 0.22)]);
      }
      P.push([x + sd * s * 0.08, y + s * 0.14]);
      poly(g, P, col);
    }
  }
  function crossedRifles(g, x, y, s, col) {
    for (let sd = -1; sd <= 1; sd += 2) {
      g.save(); g.translate(x, y + s * 0.08); g.rotate(sd * 0.62);
      poly(g, [[-s * 0.02, -s * 0.48], [s * 0.02, -s * 0.48], [s * 0.03, s * 0.16], [s * 0.08, s * 0.40], [-s * 0.05, s * 0.42], [-s * 0.03, s * 0.16]], col);
      g.fillStyle = col; g.fillRect(s * 0.02, -s * 0.02, s * 0.05, s * 0.12);
      g.restore();
    }
    star(g, x, y - s * 0.36, s * 0.12, col);
  }
  function diamond(g, x, y, s, col) { poly(g, [[x, y - s * 0.44], [x + s * 0.3, y], [x, y + s * 0.44], [x - s * 0.3, y]], col); }
  function drawEmblem(g, e, x, y, s, bg) {
    if (!e || !e.kind || e.kind === "none" || !(s > 1)) return;
    const col = e.color || C.gold;
    switch (e.kind) {
      case "star": star(g, x, y, s * 0.46, col); break;
      case "star-ring": starRing(g, x, y, s, col, e.n || 13); break;
      case "sun": sun(g, x, y, s, col, e.color2); break;
      case "crown": crown(g, x, y, s, col, e.color2); break;
      case "eagle": eagle(g, x, y, s, col); break;
      case "eagle-ring": starRing(g, x, y, s, e.color2 || C.white, e.n || 13, false); eagle(g, x, y + s * 0.03, s * 0.62, col); break;
      case "laurel": laurel(g, x, y, s, col); break;
      case "laurel-star": laurel(g, x, y, s, col); star(g, x, y - s * 0.02, s * 0.24, col); break;
      case "shield-spears": shieldSpears(g, x, y, s, col, e.color2, e.color3); break;
      case "tree": tree(g, x, y, s, col); break;
      case "crescent-star": crescentStar(g, x, y, s, col, bg || C.black); break;
      case "gear-star": gearStar(g, x, y, s, col); break;
      case "torch": torch(g, x, y, s, col); break;
      case "winged-sword": wingedSword(g, x, y, s, col); break;
      case "crossed-rifles": crossedRifles(g, x, y, s, col); break;
      case "diamond": diamond(g, x, y, s, col); break;
      default: star(g, x, y, s * 0.46, col);
    }
  }

  // ---- layouts: flag coords (0,0)-(W,H), hoist at x = 0. Each returns the
  // emblem's spot {x, y, s, bg}. `seam` is a sewn join between two cloths.
  function seam(g, x0, y0, x1, y1) {
    g.strokeStyle = "rgba(0,0,0,0.13)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  function bandsH(g, cols, rat, W, H) {
    let tot = 0; for (let i = 0; i < cols.length; i++) tot += rat ? rat[i] : 1;
    let y = 0;
    for (let i = 0; i < cols.length; i++) {
      const h = H * (rat ? rat[i] : 1) / tot;
      g.fillStyle = cols[i]; g.fillRect(0, y, W, h + 0.5);
      if (i) seam(g, 0, y, W, y);
      y += h;
    }
  }
  const LAY = {
    plain: function (g, d, W, H) {
      g.fillStyle = d.colors[0]; g.fillRect(0, 0, W, H);
      const e = d.emblem || {};
      if (e.pos === "canton") return { x: H * 0.32, y: H * 0.3, s: H * 0.42, bg: d.colors[0] };
      return { x: W / 2, y: H / 2, s: H * 0.62, bg: d.colors[0] };
    },
    "stripes-canton": function (g, d, W, H) {
      const n = d.stripes || 9, sh = H / n;
      for (let i = 0; i < n; i++) {
        g.fillStyle = d.colors[i % 2]; g.fillRect(0, i * sh, W, sh + 0.5);
        if (i) seam(g, 0, i * sh, W, i * sh);
      }
      const ch = sh * (d.cantonStripes || 5), cw = W * (d.cantonW || 0.4);
      g.fillStyle = d.colors[2] || C.navy; g.fillRect(0, 0, cw, ch);
      seam(g, cw, 0, cw, ch); seam(g, 0, ch, cw, ch);
      return { x: cw / 2, y: ch / 2, s: ch * 0.84, bg: d.colors[2] || C.navy };
    },
    nordic: function (g, d, W, H) {
      // Norway's 6-1-2-1-12 x 6-1-2-1-6 (22 x 16); without an inner colour the
      // cross is the full 4 units, as on the single-cross flags
      const u = H / 16, cx = W * 8 / 22;
      g.fillStyle = d.colors[0]; g.fillRect(0, 0, W, H);
      g.fillStyle = d.colors[1]; g.fillRect(cx - 2 * u, 0, 4 * u, H); g.fillRect(0, H / 2 - 2 * u, W, 4 * u);
      if (d.colors[2]) { g.fillStyle = d.colors[2]; g.fillRect(cx - u, 0, 2 * u, H); g.fillRect(0, H / 2 - u, W, 2 * u); }
      seam(g, cx - 2 * u, 0, cx - 2 * u, H); seam(g, cx + 2 * u, 0, cx + 2 * u, H);
      seam(g, 0, H / 2 - 2 * u, W, H / 2 - 2 * u); seam(g, 0, H / 2 + 2 * u, W, H / 2 + 2 * u);
      return { x: cx / 2 - u, y: H / 4 - u / 2, s: H * 0.26, bg: d.colors[0] };
    },
    "tricolour-v": function (g, d, W, H) {
      for (let i = 0; i < 3; i++) { g.fillStyle = d.colors[i] || d.colors[0]; g.fillRect(i * W / 3, 0, W / 3 + 0.5, H); if (i) seam(g, i * W / 3, 0, i * W / 3, H); }
      return { x: W / 2, y: H / 2, s: Math.min(H * 0.5, W / 3 * 0.86), bg: d.colors[1] };
    },
    "tricolour-h": function (g, d, W, H) {
      bandsH(g, [d.colors[0], d.colors[1] || d.colors[0], d.colors[2] || d.colors[0]], d.bands, W, H);
      return { x: W / 2, y: H / 2, s: H * (d.bands ? 0.48 : 0.3), bg: d.colors[1] };
    },
    "bicolour-h": function (g, d, W, H) {
      bandsH(g, [d.colors[0], d.colors[1] || d.colors[0]], null, W, H);
      const e = d.emblem || {};
      if (e.pos === "hoist") return { x: H * 0.42, y: H / 2, s: H * 0.56, bg: d.colors[0] };
      return { x: W / 2, y: H / 2, s: H * 0.5, bg: d.colors[0] };
    },
    "triband-fimbriated": function (g, d, W, H) {
      bandsH(g, [d.colors[0], d.colors[1], d.colors[2]], null, W, H);
      g.fillStyle = d.colors[3] || C.white;
      const f = H * 0.045;
      g.fillRect(0, H / 3 - f / 2, W, f); g.fillRect(0, 2 * H / 3 - f / 2, W, f);
      return { x: W / 2, y: H / 2, s: H * 0.66, bg: d.colors[1] };
    },
    "hoist-triangle": function (g, d, W, H) {
      bandsH(g, [d.colors[0], d.colors[1] || d.colors[0]], null, W, H);
      const tw = W * 0.42;
      g.fillStyle = d.colors[2] || C.white;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(tw, H / 2); g.lineTo(0, H); g.closePath(); g.fill();
      seam(g, 0, 0, tw, H / 2); seam(g, tw, H / 2, 0, H);
      return { x: tw * 0.36, y: H / 2, s: H * 0.42, bg: d.colors[2] || C.white };
    },
    "serrated-hoist": function (g, d, W, H) {
      g.fillStyle = d.colors[0]; g.fillRect(0, 0, W, H);
      const bw = W * 0.25, dep = W * 0.065, n = d.points || 9;
      g.fillStyle = d.colors[1] || C.white;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(bw, 0);
      for (let i = 0; i < n; i++) { g.lineTo(bw + dep, (i + 0.5) * H / n); g.lineTo(bw, (i + 1) * H / n); }
      g.lineTo(0, H); g.closePath(); g.fill();
      return { x: bw + dep + (W - bw - dep) / 2, y: H / 2, s: H * 0.5, bg: d.colors[0] };
    },
    diagonal: function (g, d, W, H) {
      g.fillStyle = d.colors[1] || C.black; g.fillRect(0, 0, W, H);
      g.fillStyle = d.colors[0];
      g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(0, H); g.closePath(); g.fill();
      if (d.colors[2]) {
        const t = H * 0.12;
        g.strokeStyle = d.colors[3] || C.gold; g.lineWidth = t * 1.5; g.beginPath(); g.moveTo(W + t, -t); g.lineTo(-t, H + t); g.stroke();
        g.strokeStyle = d.colors[2]; g.lineWidth = t; g.beginPath(); g.moveTo(W + t, -t); g.lineTo(-t, H + t); g.stroke();
      } else seam(g, W, 0, 0, H);
      return { x: W * 0.2, y: H * 0.28, s: H * 0.36, bg: d.colors[0] };
    },
    "centred-disc": function (g, d, W, H) {
      g.fillStyle = d.colors[0]; g.fillRect(0, 0, W, H);
      const r = H * 0.3, x = W * 0.45;
      g.fillStyle = d.colors[1] || C.white; g.beginPath(); g.arc(x, H / 2, r, 0, Math.PI * 2); g.fill();
      return { x: x, y: H / 2, s: r * 1.5, bg: d.colors[1] || C.white };
    },
    border: function (g, d, W, H) {
      g.fillStyle = d.colors[1] || C.gold; g.fillRect(0, 0, W, H);
      const b = H * 0.06;
      g.fillStyle = d.colors[0]; g.fillRect(b, b, W - 2 * b, H - 2 * b);
      return { x: W / 2, y: H / 2, s: H * 0.56, bg: d.colors[0] };
    },
  };

  // the emblem's colour: what the design says, unless the spot it lands on
  // would swallow it (a custom combination), then the palette's best contrast
  function emblemColour(d, bg) {
    const e = d.emblem;
    if (!e || !bg) return e;
    if (contrast(e.color || C.gold, bg) > 0.22) return e;
    const cand = (d.colors || []).concat([C.gold, C.white, C.black]);
    let best = e.color, bc = -1;
    for (let i = 0; i < cand.length; i++) { const q = contrast(cand[i], bg); if (q > bc) { bc = q; best = cand[i]; } }
    return Object.assign({}, e, { color: best });
  }

  const HEAD_PX = 12, HEAD_GAP = 2, TEX_W = 512;    // the sewn heading on every flag canvas
  const U0 = (HEAD_PX + HEAD_GAP) / TEX_W, UH = HEAD_PX / TEX_W;
  // Paint design `d` into a 2D context. `vertical` paints the transposed flag
  // a vertical banner wears (union to the observer's upper left), emblems
  // upright. Returns nothing; pure drawing.
  function paint(g, d, Wpx, Hpx, opts) {
    opts = opts || {};
    const lay = LAY[d.layout] || LAY.plain;
    d.colors = d.colors && d.colors.length ? d.colors : [C.navy];
    g.save();
    let FW, FH, ox = 0;
    if (opts.vertical) { g.setTransform(0, 1, 1, 0, 0, 0); FW = Hpx; FH = Wpx; }
    else {
      if (opts.heading) {
        // the heading: a strip of white canvas duck sewn to the hoist, two
        // brass grommets the halyard clips into
        g.fillStyle = "#e7e1d1"; g.fillRect(0, 0, HEAD_PX + HEAD_GAP, Hpx);
        g.strokeStyle = "rgba(0,0,0,0.12)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(3.5, 0); g.lineTo(3.5, Hpx); g.moveTo(HEAD_PX - 2.5, 0); g.lineTo(HEAD_PX - 2.5, Hpx); g.stroke();
        for (const fy of [0.07, 0.93]) {
          g.fillStyle = "#b8963e"; g.beginPath(); g.arc(HEAD_PX / 2, Hpx * fy, 3.8, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#3a3a3a"; g.beginPath(); g.arc(HEAD_PX / 2, Hpx * fy, 1.8, 0, Math.PI * 2); g.fill();
        }
        ox = HEAD_PX + HEAD_GAP;
      }
      FW = Wpx - ox; FH = Hpx;
      g.translate(ox, 0);
    }
    const spot = lay(g, d, FW, FH) || { x: FW / 2, y: FH / 2, s: FH * 0.5 };
    // hems: the fly hem doubled, top and bottom single, stitched
    g.strokeStyle = "rgba(0,0,0,0.10)"; g.lineWidth = 1; g.setLineDash([3, 2]);
    g.beginPath();
    g.moveTo(0, 3.5); g.lineTo(FW, 3.5); g.moveTo(0, FH - 3.5); g.lineTo(FW, FH - 3.5);
    g.moveTo(FW - 4.5, 0); g.lineTo(FW - 4.5, FH); g.moveTo(FW - 8.5, 0); g.lineTo(FW - 8.5, FH);
    g.stroke(); g.setLineDash([]);
    g.restore();
    // the emblem, upright in canvas space whatever the cloth's orientation
    const e = emblemColour(d, spot.bg);
    if (e && e.kind && e.kind !== "none") {
      g.save();
      const cx = opts.vertical ? spot.y : spot.x + ox, cy = opts.vertical ? spot.x : spot.y;
      drawEmblem(g, e, cx, cy, spot.s, spot.bg);
      g.restore();
    }
    // the dye: a faint grain so a field is cloth, not a fill
    if (opts.grain !== false && g.getImageData) {
      try {
        const im = g.getImageData(0, 0, Wpx, Hpx), a = im.data;
        let s = 0x9e3779b9 ^ (Wpx * 131 + Hpx);
        for (let i = 0; i < a.length; i += 4) {
          s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
          const n = ((s & 255) - 128) * 0.035;
          a[i] = Math.max(0, Math.min(255, a[i] + n)); a[i + 1] = Math.max(0, Math.min(255, a[i + 1] + n)); a[i + 2] = Math.max(0, Math.min(255, a[i + 2] + n));
        }
        g.putImageData(im, 0, 0);
      } catch (e2) {}
    }
  }
  function makeCanvas(w, h) {
    if (typeof document === "undefined" || !document.createElement) return null;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    return c.getContext ? c : null;
  }
  // a data URL of a design, for a UI that wants to show the flag
  function dataURL(id, w) {
    const d = designFor(id), r = d.ratio || [2, 3];
    w = w || 96;
    const c = makeCanvas(w, Math.round(w * r[0] / r[1]));
    const g = c && c.getContext("2d");
    if (!g) return null;
    paint(g, d, c.width, c.height, { grain: false });
    try { return c.toDataURL(); } catch (e) { return null; }
  }

  // ============================================================
  //  §4  CLOTH — textures and the one material family
  // ============================================================
  const U = {                                // shared by every flag material
    t: { value: 0 },
    wind: { value: THREE ? new THREE.Vector4(1, 0, 0.5, 0) : null },  // x,y = world wind dir (x,z); z = strength
  };
  const VERT_HEAD = [
    "attribute vec4 aCloth;   // x: u hoist->fly 0..1, y: flex, z: mode (0 fixed, 1 pole, 2 banner), w: length m",
    "uniform float uFlagT;",
    "uniform vec4 uFlagWind;",
  ].join("\n");
  const VERT_BODY = [
    "vec3 objectNormal = vec3( normal );",
    "#ifdef USE_TANGENT",
    "  vec3 objectTangent = vec3( tangent.xyz );",
    "#endif",
    "vec3 cbzP = position;",
    "float cU = aCloth.x, cFlex = aCloth.y, cMode = aCloth.z, cL = max( aCloth.w, 0.05 );",
    "if ( cFlex > 0.0 ) {",
    "  mat4 cM = modelMatrix;",
    "  #ifdef USE_INSTANCING",
    "    cM = cM * instanceMatrix;",
    "  #endif",
    "  vec3 anc = ( cM * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;",
    "  float ph = fract( sin( dot( anc.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831;",
    "  float w = uFlagWind.z;",
    "  float farF = smoothstep( 70.0, 260.0, distance( anc, cameraPosition ) );",
    "  bool ban = cMode > 1.5;",
    "  float along = cU * cL;",
    "  float across = ban ? cbzP.x : cbzP.y;",
    "  float env = pow( cU, 1.35 );",
    "  float om = ( 2.2 + 3.4 * w ) * ( 0.85 + 0.3 * fract( ph * 1.7 ) );",
    "  float k1 = 6.2831 / ( cL * 0.9 );",
    "  float a1 = cL * ( 0.03 + 0.05 * w ) * env * cFlex;",
    "  float t1 = k1 * along - om * uFlagT + ph + 0.9 * across / cL;",
    "  float k2 = k1 * 2.6;",
    "  float a2 = cL * 0.016 * env * cFlex * ( 1.0 - farF ) * ( 0.6 + w );",
    "  float t2 = k2 * along - om * 1.9 * uFlagT + ph * 1.7 - 2.3 * across / cL;",
    "  float k3 = 6.2831 * 3.0 / cL;",
    "  float a3 = cL * 0.02 * smoothstep( 0.7, 1.0, cU ) * cFlex * ( 0.4 + w ) * ( 1.0 - farF );",
    "  float t3 = k3 * across - om * 2.7 * uFlagT + ph * 2.3;",
    "  float dz = a1 * sin( t1 ) + a2 * sin( t2 ) + a3 * sin( t3 );",
    "  float dA = a1 * cos( t1 ) * k1 + a2 * cos( t2 ) * k2;",
    "  float dC = a1 * cos( t1 ) * 0.9 / cL - a2 * cos( t2 ) * 2.3 / cL + a3 * cos( t3 ) * k3;",
    "  cbzP.z += dz;",
    "  vec2 grad = ban ? vec2( dC, -dA ) : vec2( dA, dC );",
    "  objectNormal = normalize( normal - vec3( grad, 0.0 ) * ( normal.z < 0.0 ? -1.0 : 1.0 ) );",
    "  if ( cMode > 0.5 && cMode < 1.5 ) {",
    "    // a flag on a pole: the fly pulls in as the cloth waves, droops in",
    "    // light air, and the whole flag swings round the pole downwind",
    "    cbzP.x -= cL * cU * cU * ( 0.03 + 0.03 * w ) * cFlex;",
    "    cbzP.y -= cL * cU * cU * 0.2 * max( 0.0, 1.15 - w );",
    "    vec3 wv = vec3( uFlagWind.x, 0.0, uFlagWind.y );",
    "    vec3 wl = vec3( dot( cM[0].xyz, wv ), dot( cM[1].xyz, wv ), dot( cM[2].xyz, wv ) );",
    "    float g0 = 0.22 * sin( uFlagT * 0.37 + ph ) * ( 1.3 - w );",
    "    vec2 dd = normalize( wl.xz + vec2( 1e-4, 0.0 ) );",
    "    vec2 dg = vec2( dd.x * cos( g0 ) - dd.y * sin( g0 ), dd.x * sin( g0 ) + dd.y * cos( g0 ) );",
    "    cbzP.xz = vec2( cbzP.x * dg.x - cbzP.z * dg.y, cbzP.x * dg.y + cbzP.z * dg.x );",
    "    objectNormal.xz = vec2( objectNormal.x * dg.x - objectNormal.z * dg.y, objectNormal.x * dg.y + objectNormal.z * dg.x );",
    "  }",
    "}",
  ].join("\n");
  const FRAG_WEAVE = [
    "#include <map_fragment>",
    "#if defined( USE_MAP ) && __VERSION__ >= 300",
    "{",
    "  // a plain weave: warp over weft, then weft over warp. Only where a",
    "  // thread is bigger than a pixel; otherwise it would only be noise.",
    "  vec2 q = vUv * vec2( 640.0, 400.0 );",
    "  vec2 f = fract( q );",
    "  float warp = smoothstep( 0.0, 0.3, f.x ) * smoothstep( 1.0, 0.7, f.x );",
    "  float weft = smoothstep( 0.0, 0.3, f.y ) * smoothstep( 1.0, 0.7, f.y );",
    "  float top = mod( floor( q.x ) + floor( q.y ), 2.0 );",
    "  float th = mix( weft, warp, top );",
    "  float aa = 1.0 - smoothstep( 0.22, 0.55, max( fwidth( q.x ), fwidth( q.y ) ) );",
    "  diffuseColor.rgb *= 1.0 + ( th - 0.6 ) * 0.18 * aa;",
    "}",
    "#endif",
  ].join("\n");
  function onCompile(shader) {
    shader.uniforms.uFlagT = U.t;
    shader.uniforms.uFlagWind = U.wind;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + VERT_HEAD)
      .replace("#include <beginnormal_vertex>", VERT_BODY)
      .replace("#include <begin_vertex>", "vec3 transformed = cbzP;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", FRAG_WEAVE);
  }
  function clothMaterial(tex) {
    const m = new THREE.MeshPhongMaterial({
      map: tex, side: THREE.DoubleSide, specular: 0x1e1e1e, shininess: 9,
    });
    m.onBeforeCompile = onCompile;
    m.customProgramCacheKey = function () { return "cbz-flag-cloth-1"; };   // ONE program for every flag
    m._shared = true;
    m.name = "flag-cloth";
    return m;
  }

  // per resolved key: the flag canvas + texture + material, and any banner
  // textures, all repainted in place when the design changes
  const T = Object.create(null);
  const A = { textures: 0, repaints: 0, poles: 0, staffs: 0, banners: 0, hands: 0, cars: 0, instanced: 0, buckets: 0, events: 0 };
  function sig(d) { return JSON.stringify([d.layout, d.colors, d.emblem, d.stripes, d.cantonStripes, d.cantonW, d.points, d.bands]); }
  function texH(ratio) { return Math.max(64, Math.round(TEX_W * ratio[0] / ratio[1])); }
  function newTex(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    if (THREE.sRGBEncoding) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    t.name = "flag";
    return t;
  }
  function repaintFlag(e) {
    const c = makeCanvas(TEX_W, texH(e.ratio));
    const g = c && c.getContext("2d");
    if (!g) return;
    paint(g, e.design, c.width, c.height, { heading: true });
    if (e.tex) { e.tex.image = c; e.tex._cbzFreed = false; e.tex.needsUpdate = true; }
    else e.tex = newTex(c);
  }
  function repaintBanner(e, key) {
    const b = e.banners[key];
    const c = makeCanvas(b.w, b.h);
    const g = c && c.getContext("2d");
    if (!g) return;
    paint(g, e.design, c.width, c.height, { vertical: true });
    if (b.tex) { b.tex.image = c; b.tex._cbzFreed = false; b.tex.needsUpdate = true; }
    else b.tex = newTex(c);
  }
  function entry(id) {
    id = String(id || "republic");
    let e = T[id];
    if (e) return e;
    const d = designFor(id);
    e = T[id] = { id: id, design: d, sig: sig(d), ratio: (d.ratio || [2, 3]).slice(), tex: null, mat: null, banners: Object.create(null) };
    if (THREE) {
      repaintFlag(e);
      e.mat = clothMaterial(e.tex);
      A.textures++;
    }
    return e;
  }
  // re-resolve a key and its dependents (the standard follows its nation);
  // a changed design is repainted into the SAME textures
  function refresh(id) {
    for (const k in T) {
      if (k !== id && k !== "standard:" + id) continue;
      const e = T[k], d = designFor(k), s = sig(d);
      if (s === e.sig) continue;
      e.design = d; e.sig = s;
      if (THREE) {
        repaintFlag(e);
        for (const bk in e.banners) repaintBanner(e, bk);
      }
      A.repaints++;
    }
  }
  function material(id) { return entry(id).mat; }
  function texture(id) { return entry(id).tex; }
  function bannerMaterial(id, w, h) {
    const e = entry(id);
    const ar = Math.max(0.2, Math.min(5, h / w));
    const key = ar.toFixed(1);
    let b = e.banners[key];
    if (!b) {
      const bw = 192, bh = Math.min(960, Math.round(bw * +key));
      b = e.banners[key] = { w: bw, h: bh, tex: null, mat: null };
      if (THREE) { repaintBanner(e, key); b.mat = clothMaterial(b.tex); A.textures++; }
    }
    return b.mat;
  }

  // ============================================================
  //  §5  GEOMETRY + HARDWARE
  // ============================================================
  const GEO = new Map();
  function shared(g) { g._shared = true; if (g.userData) g.userData._shared = true; return g; }
  // a grid of cloth: columns xs (metres from the hoist), rows over [-h/2, h/2]
  function gridInto(B, xs, us, ny, h, L, flex, mode, uvx) {
    const base = B.pos.length / 3;
    for (let j = 0; j <= ny; j++) {
      const v = j / ny, y = -h / 2 + v * h;
      for (let i = 0; i < xs.length; i++) {
        B.pos.push(xs[i], y, 0); B.nor.push(0, 0, 1); B.uv.push(uvx[i], v);
        B.cloth.push(us[i], flex, mode, L);
      }
    }
    const nx = xs.length;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) {
      const a = base + j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      B.idx.push(a, b, d, a, d, c);
    }
  }
  function buildGeo(B) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(B.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute("aCloth", new THREE.Float32BufferAttribute(B.cloth, 4));
    g.setIndex(B.idx);
    return g;
  }
  // a flat flag: hoist at x = off (the pole's surface), fly toward +x.
  // heading: a separate strip of the canvas's sewn heading on the hoist.
  function flatGeo(L, H, nx, ny, flex, mode, off, heading) {
    const key = ["flat", L.toFixed(3), H.toFixed(3), nx, ny, flex, mode, off.toFixed(3), heading ? 1 : 0].join("|");
    if (GEO.has(key)) return GEO.get(key);
    const B = { pos: [], nor: [], uv: [], cloth: [], idx: [] };
    const hd = heading ? Math.min(0.08, L * 0.035) : 0;
    if (heading) gridInto(B, [off, off + hd], [0, hd / L], ny, H, L, flex, mode, [0, UH]);
    const xs = [], us = [], ux = [];
    for (let i = 0; i <= nx; i++) {
      const t = i / nx, x = hd + t * (L - hd);
      xs.push(off + x); us.push(x / L); ux.push(U0 + t * (1 - U0));
    }
    gridInto(B, xs, us, ny, H, L, flex, mode, ux);
    const g = buildGeo(B);
    // a pole flag swings round the pole: bound the whole circle it can sweep
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(mode === 1 ? 0 : off + L / 2, 0, 0), (mode === 1 ? off + L : L * 0.6) + H * 0.6);
    GEO.set(key, shared(g));
    return g;
  }
  // THE DRAPE: a staff flag hanging off its pole with nobody to fly it. Its
  // top-hoist corner is at the origin, the hoist runs down the pole (-y), and
  // the cloth falls in folds that radiate from that corner: the quarter
  // circle it would fill if flown is gathered into the narrower fan gravity
  // leaves it, and the length it loses there is taken up by the folds.
  const DRAPE_T0 = 1.05;
  function drapePoint(s, t, L, H, out) {
    const r = Math.hypot(s, t), th = Math.atan2(t, s);
    const th2 = DRAPE_T0 + th * (Math.PI / 2 - DRAPE_T0) / (Math.PI / 2);
    const fold = r * 0.075 * Math.sin(th * 7.0 + 0.4) * Math.min(1, r / 0.25) + r * 0.025;
    out[0] = r * Math.cos(th2); out[1] = -r * Math.sin(th2); out[2] = fold;
    return out;
  }
  function drapeGeo(L, H, flex, off) {
    const key = ["drape", L.toFixed(3), H.toFixed(3), flex, off.toFixed(3)].join("|");
    if (GEO.has(key)) return GEO.get(key);
    const ns = 26, nt = 12, B = { pos: [], nor: [], uv: [], cloth: [], idx: [] }, p = [0, 0, 0];
    for (let j = 0; j <= nt; j++) for (let i = 0; i <= ns; i++) {
      const s = i / ns * L, t = j / nt * H;
      drapePoint(s, t, L, H, p);
      B.pos.push(off + p[0], p[1], p[2]); B.nor.push(0, 0, 1);
      B.uv.push(U0 + (i / ns) * (1 - U0), 1 - j / nt);
      B.cloth.push(i / ns, flex, 0, L);
    }
    for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) {
      const a = j * (ns + 1) + i, b = a + 1, c = a + ns + 1, d = c + 1;
      B.idx.push(a, c, d, a, d, b);
    }
    const g = buildGeo(B);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    GEO.set(key, shared(g));
    return g;
  }
  // the gold fringe on a drape's three free edges: strands hanging under
  // each edge point, one strip, an alpha-tested strand texture
  let _fringeMat = null;
  function fringeMat() {
    if (_fringeMat) return _fringeMat;
    const c = makeCanvas(32, 16), g = c && c.getContext("2d");
    let tex = null;
    if (g) {
      g.clearRect(0, 0, 32, 16);
      g.fillStyle = "#fff"; g.fillRect(0, 0, 32, 4);
      for (let x = 0; x < 32; x += 2) { g.fillStyle = x % 4 ? "#e8e0c8" : "#fff"; g.fillRect(x, 4, 1, 11 + (x % 6 === 0 ? 1 : 0)); }
      tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
    }
    _fringeMat = new THREE.MeshLambertMaterial({ color: 0xcaa24a, map: tex, alphaTest: 0.45, side: THREE.DoubleSide, transparent: false });
    _fringeMat._shared = true;
    return _fringeMat;
  }
  function fringeGeo(L, H, off) {
    const key = ["fringe", L.toFixed(3), H.toFixed(3), off.toFixed(3)].join("|");
    if (GEO.has(key)) return GEO.get(key);
    const pts = [], N = 18;
    for (let i = 1; i <= N; i++) pts.push(drapePoint(i / N * L, 0, L, H, [0, 0, 0]));            // top
    for (let i = 1; i <= N; i++) pts.push(drapePoint(L, i / N * H, L, H, [0, 0, 0]));            // fly
    for (let i = N - 1; i >= 0; i--) pts.push(drapePoint(i / N * L, H, L, H, [0, 0, 0]));        // foot
    const pos = [], nor = [], uv = [], idx = [];
    const FL = 0.07;
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
      const q = pts[i];
      pos.push(off + q[0], q[1] + 0.006, q[2], off + q[0], q[1] - FL, q[2]);
      nor.push(0, 0, 1, 0, 0, 1);
      uv.push(acc / 0.03, 1, acc / 0.03, 0);
      if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    GEO.set(key, shared(g));
    return g;
  }

  // merge (geometry, colour) pairs into one vertex-coloured geometry
  function mergeColoured(list) {
    const pos = [], nor = [], col = [], cc = new THREE.Color();
    for (let k = 0; k < list.length; k++) {
      let g = list[k][0];
      if (g.index) g = g.toNonIndexed();
      if (!g.attributes.normal) g.computeVertexNormals();
      cc.setHex(list[k][1]);
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        col.push(cc.r, cc.g, cc.b);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }
  let _hwMat = null;
  function hwMat() {
    if (_hwMat) return _hwMat;
    _hwMat = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0x5a5040, shininess: 42 });
    _hwMat._shared = true; _hwMat.name = "flag-hardware";
    return _hwMat;
  }
  function cm(hex) { return CBZ.cmat ? CBZ.cmat(hex) : new THREE.MeshLambertMaterial({ color: hex }); }

  const GOLD = 0xc9a24a, BRASS = 0xb08d3c, ALU = 0xc9cdd2, ROPE = 0xe6e0cf, OAK = 0x5b3a22, CLEAT = 0x8d9196;
  // the eagle finial: wings up and spread over a ball, s = its height (m)
  function eagleParts(s, y0) {
    const P = [];
    const ball = new THREE.SphereGeometry(s * 0.16, 12, 8); ball.translate(0, y0 + s * 0.14, 0); P.push(ball);
    const body = new THREE.SphereGeometry(s * 0.2, 10, 8); body.scale(0.75, 1.3, 0.9); body.translate(0, y0 + s * 0.48, 0); P.push(body);
    const head = new THREE.SphereGeometry(s * 0.1, 10, 8); head.translate(0, y0 + s * 0.8, s * 0.05); P.push(head);
    const beak = new THREE.ConeGeometry(s * 0.04, s * 0.1, 6); beak.rotateX(Math.PI / 2); beak.translate(0, y0 + s * 0.78, s * 0.16); P.push(beak);
    for (let sd = -1; sd <= 1; sd += 2) {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(s * 0.18, s * 0.22); sh.lineTo(s * 0.42, s * 0.5); sh.lineTo(s * 0.52, s * 0.62);
      sh.lineTo(s * 0.48, s * 0.44); sh.lineTo(s * 0.54, s * 0.38); sh.lineTo(s * 0.46, s * 0.28); sh.lineTo(s * 0.5, s * 0.2);
      sh.lineTo(s * 0.38, s * 0.12); sh.lineTo(s * 0.36, s * 0.02); sh.lineTo(s * 0.16, -s * 0.08); sh.lineTo(0, 0);
      const wing = new THREE.ExtrudeGeometry(sh, { depth: s * 0.03, bevelEnabled: false });
      wing.translate(0, 0, -s * 0.015);
      if (sd < 0) wing.scale(-1, 1, 1);
      wing.rotateY(sd * 0.28);
      wing.translate(sd * s * 0.08, y0 + s * 0.46, -s * 0.03);
      P.push(wing);
    }
    const tail = new THREE.BoxGeometry(s * 0.16, s * 0.18, s * 0.03); tail.rotateX(0.5); tail.translate(0, y0 + s * 0.24, -s * 0.12); P.push(tail);
    return P;
  }
  // AN OUTDOOR POLE: tapered satin aluminium, a flash collar, the truck, a
  // gilt ball (or eagle) finial, the halyard down the flag side to a cleat
  function poleHardware(h, finial) {
    const key = ["polehw", h.toFixed(2), finial].join("|");
    if (GEO.has(key)) return GEO.get(key);
    const r1 = Math.max(0.045, Math.min(0.13, 0.03 + h * 0.0055)), r0 = r1 * 0.5;
    const P = [];
    const shaft = new THREE.CylinderGeometry(r0, r1, h, 14); shaft.translate(0, h / 2, 0); P.push([shaft, ALU]);
    const collar = new THREE.CylinderGeometry(r1 * 1.9, r1 * 2.3, 0.14, 16); collar.translate(0, 0.07, 0); P.push([collar, ALU]);
    const truck = new THREE.CylinderGeometry(r0 * 1.7, r0 * 1.7, 0.08, 12); truck.translate(0, h + 0.04, 0); P.push([truck, ALU]);
    if (finial === "eagle") for (const g of eagleParts(Math.max(0.32, h * 0.03), h + 0.08)) P.push([g, GOLD]);
    else { const ball = new THREE.SphereGeometry(r0 * 2.3, 14, 10); ball.translate(0, h + 0.08 + r0 * 2.2, 0); P.push([ball, GOLD]); }
    // the halyard: two lines from the truck's sheave down to the cleat
    const cy = 1.25, rc = r1 - (r1 - r0) * cy / h;
    for (const dz of [-0.014, 0.014]) {
      const len = h - cy;
      const rope = new THREE.CylinderGeometry(0.0045, 0.0045, len, 4);
      const xr = (r0 + rc) / 2 + 0.016;
      rope.translate(xr, cy + len / 2, dz);
      P.push([rope, ROPE]);
    }
    const cleat = new THREE.BoxGeometry(0.028, 0.03, 0.17); cleat.translate(rc + 0.03, cy, 0); P.push([cleat, CLEAT]);
    const stem = new THREE.BoxGeometry(0.03, 0.06, 0.04); stem.translate(rc + 0.012, cy, 0); P.push([stem, CLEAT]);
    const g = shared(mergeColoured(P));
    g.userData.r0 = r0; g.userData.r1 = r1;
    GEO.set(key, g);
    return g;
  }
  // AN INDOOR STAFF: a weighted brass bell base, an oak pole with brass
  // ferrules, the eagle, and a gold cord with two tassels from under it
  function staffHardware(h, finial, cord) {
    const key = ["staffhw", h.toFixed(2), finial, cord ? 1 : 0].join("|");
    if (GEO.has(key)) return GEO.get(key);
    const P = [];
    const prof = [[0.001, 0], [0.19, 0], [0.19, 0.022], [0.16, 0.045], [0.09, 0.075], [0.05, 0.12], [0.035, 0.165], [0.001, 0.17]]
      .map(function (q) { return new THREE.Vector2(q[0], q[1]); });
    P.push([new THREE.LatheGeometry(prof, 20), BRASS]);
    const pole = new THREE.CylinderGeometry(0.0155, 0.019, h - 0.17, 10); pole.translate(0, 0.17 + (h - 0.17) / 2, 0); P.push([pole, OAK]);
    for (const fy of [0.2, h - 0.04]) { const f = new THREE.CylinderGeometry(0.022, 0.022, 0.06, 10); f.translate(0, fy, 0); P.push([f, BRASS]); }
    if (finial === "spear") {
      const sp = new THREE.ConeGeometry(0.03, 0.16, 8); sp.translate(0, h + 0.1, 0); P.push([sp, GOLD]);
      const b = new THREE.SphereGeometry(0.03, 10, 8); b.translate(0, h + 0.02, 0); P.push([b, GOLD]);
    } else for (const g of eagleParts(0.2, h - 0.01)) P.push([g, GOLD]);
    if (cord) {
      for (const end of [[0.07, h - 0.78, 0.035], [0.025, h - 0.9, -0.03]]) {
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.018, h - 0.05, 0), new THREE.Vector3(0.05, h - 0.3, end[2] * 0.6),
          new THREE.Vector3(end[0] * 0.9, h - 0.6, end[2]), new THREE.Vector3(end[0], end[1], end[2]),
        ]);
        P.push([new THREE.TubeGeometry(curve, 18, 0.0055, 5, false), GOLD]);
        const knot = new THREE.SphereGeometry(0.022, 10, 8); knot.scale(1, 1.3, 1); knot.translate(end[0], end[1] - 0.02, end[2]); P.push([knot, GOLD]);
        const tas = new THREE.CylinderGeometry(0.012, 0.03, 0.12, 12, 1, true); tas.translate(end[0], end[1] - 0.1, end[2]); P.push([tas, GOLD]);
      }
    }
    const g = shared(mergeColoured(P));
    GEO.set(key, g);
    return g;
  }
  // a banner's rod (head) and weighted hem bar (foot)
  function bannerHardware(w, L) {
    const key = ["banhw", w.toFixed(2), L.toFixed(2)].join("|");
    if (GEO.has(key)) return GEO.get(key);
    const P = [];
    const rod = new THREE.CylinderGeometry(0.028, 0.028, w + 0.2, 10); rod.rotateZ(Math.PI / 2); rod.translate(0, 0.02, 0.01); P.push([rod, BRASS]);
    for (const s of [-1, 1]) { const k = new THREE.SphereGeometry(0.045, 10, 8); k.translate(s * (w / 2 + 0.12), 0.02, 0.01); P.push([k, GOLD]); }
    const hem = new THREE.CylinderGeometry(0.016, 0.016, w * 0.98, 8); hem.rotateZ(Math.PI / 2); hem.translate(0, -L + 0.012, 0.004); P.push([hem, BRASS]);
    const g = shared(mergeColoured(P));
    GEO.set(key, g);
    return g;
  }
  function hwMesh(geo) {
    const m = new THREE.Mesh(geo, hwMat());
    m.castShadow = true; m.receiveShadow = true;
    m.userData.cbzFlagHw = true;           // vertex-coloured: kept out of the colour buckets
    return m;
  }
  function tagCloth(m, id, kind) {
    m.castShadow = false; m.receiveShadow = true;
    // userData: the batcher and the static freezer never touch a flag
    // (its vertices move in the shader; merged into a city bucket the hoist
    // would no longer be at its own origin)
    m.userData.cbzFlag = { id: id, kind: kind };
    return m;
  }

  // ============================================================
  //  §6  PLACEMENT
  // ============================================================
  // Pole flags waiting for flush(): instanced per (root, design, size, cell)
  const PEND = new Map();
  let pendN = 0;
  // A FLAG POLE at (x, y, z) in `root`'s space. opts: height (m, default 10),
  // nation|id (a design id; default the nation at the point), finial
  // ("ball" | "eagle"), fly (flag length m; default a quarter of the pole),
  // base (true: a stepped concrete footing), instance (default true).
  function pole(root, opts) {
    if (!THREE || !root) return null;
    opts = opts || {};
    const x = +opts.x || 0, y = +opts.y || 0, z = +opts.z || 0;
    const h = opts.height > 2 ? +opts.height : 10;
    const id = opts.id || opts.nation || nationAt(opts.wx != null ? opts.wx : x, opts.wz != null ? opts.wz : z);
    const e = entry(id);
    const hw = poleHardware(h, opts.finial || "ball");
    const grp = new THREE.Group();
    grp.name = "flagpole";
    grp.position.set(x, y, z);
    if (opts.yaw) grp.rotation.y = opts.yaw;
    if (opts.instance === false) grp.add(hwMesh(hw));
    if (opts.base) {
      const b1 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.24, 16), cm(0xa9a49a)); b1.position.y = 0.12; grp.add(b1);
    }
    root.add(grp);
    // the cloth: hoist a quarter of the pole long, top 12 cm under the truck
    const L = opts.fly > 0.3 ? +opts.fly : Math.max(1.1, Math.min(4.2, h * 0.24));
    const H = L * e.ratio[0] / e.ratio[1];
    const off = hw.userData.r0 + 0.015;
    const geo = flatGeo(L, H, 24, 8, 1, 1, off, true);
    const cy = y + h - 0.12 - H / 2;
    A.poles++;
    if (opts.instance === false) {
      const m = tagCloth(new THREE.Mesh(geo, e.mat), id, "pole");
      m.position.set(0, h - 0.12 - H / 2, 0);
      grp.add(m);
      return { group: grp, cloth: m, id: id };
    }
    const cell = Math.floor(x / 300) + "," + Math.floor(z / 300);
    const key = (root.uuid || "r") + "|" + id + "|" + L.toFixed(2) + "|" + h.toFixed(2) + "|" + (opts.finial || "ball") + "|" + cell;
    let b = PEND.get(key);
    if (!b) PEND.set(key, b = { root: root, id: id, geo: geo, hw: hw, hwDy: -(h - 0.12 - H / 2), at: [] });
    b.at.push([x, cy, z, opts.yaw || 0]);
    pendN++;
    return { group: grp, cloth: null, id: id };
  }
  const _m4 = THREE ? new THREE.Matrix4() : null, _q = THREE ? new THREE.Quaternion() : null;
  const _v = THREE ? new THREE.Vector3() : null, _s = THREE ? new THREE.Vector3(1, 1, 1) : null, _yAx = THREE ? new THREE.Vector3(0, 1, 0) : null;
  function flush() {
    if (!pendN) return 0;
    let made = 0;
    PEND.forEach(function (b) {
      const n = b.at.length;
      const geo = b.geo.clone();                    // own bounds (the pool's), own arrays
      const em = entry(b.id);
      const im = new THREE.InstancedMesh(geo, em.mat, n);
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < n; i++) { cx += b.at[i][0]; cy += b.at[i][1]; cz += b.at[i][2]; }
      cx /= n; cy /= n; cz /= n;
      let R = 0;
      const r0 = b.geo.boundingSphere ? b.geo.boundingSphere.radius : 4;
      for (let i = 0; i < n; i++) {
        const a = b.at[i];
        _q.setFromAxisAngle(_yAx, a[3]);
        _v.set(a[0] - cx, a[1] - cy, a[2] - cz);
        _m4.compose(_v, _q, _s);
        im.setMatrixAt(i, _m4);
        R = Math.max(R, Math.hypot(a[0] - cx, a[1] - cy, a[2] - cz));
      }
      im.instanceMatrix.needsUpdate = true;
      im.position.set(cx, cy, cz);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R + r0);
      im.frustumCulled = true;
      tagCloth(im, b.id, "pole-pool");
      im.updateMatrix(); im.matrixAutoUpdate = false;
      b.root.add(im);
      // the poles themselves: one more pool, same matrices, dropped to the foot
      const hg = b.hw.clone();
      const hm = new THREE.InstancedMesh(hg, hwMat(), n);
      for (let i = 0; i < n; i++) {
        const a = b.at[i];
        _q.setFromAxisAngle(_yAx, a[3]);
        _v.set(a[0] - cx, a[1] - cy + b.hwDy, a[2] - cz);
        _m4.compose(_v, _q, _s);
        hm.setMatrixAt(i, _m4);
      }
      hm.instanceMatrix.needsUpdate = true;
      hm.position.set(cx, cy, cz);
      hg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), R + Math.abs(b.hwDy) * 2 + 2);
      hm.castShadow = true; hm.receiveShadow = true;
      hm.userData.cbzFlagHw = true;
      hm.updateMatrix(); hm.matrixAutoUpdate = false;
      b.root.add(hm);
      made++; A.instanced += n; A.buckets++;
    });
    PEND.clear(); pendN = 0;
    return made;
  }
  // AN INDOOR (or ceremonial) STAFF FLAG standing on a floor at (x, y, z):
  // flyX/flyZ = the world direction the cloth falls toward; outdoor: a
  // stirring breeze on the drape. Returns { group, cloth }.
  const TAGS = Object.create(null);
  function staff(root, opts) {
    if (!THREE || !root) return null;
    opts = opts || {};
    const id = opts.id || opts.nation || "republic";
    const e = entry(id);
    const h = opts.height > 1 ? +opts.height : 2.45;
    const grp = new THREE.Group();
    grp.name = "flagstaff";
    grp.position.set(+opts.x || 0, +opts.y || 0, +opts.z || 0);
    const fx = opts.flyX != null ? +opts.flyX : 1, fz = opts.flyZ != null ? +opts.flyZ : 0;
    grp.rotation.y = Math.atan2(-fz, fx);           // local +x -> (flyX, flyZ)
    grp.add(hwMesh(staffHardware(h, opts.finial || (/^standard:/.test(id) || NATIONS[id] ? "eagle" : "spear"), opts.cord !== false)));
    const Hf = opts.hoist > 0.3 ? +opts.hoist : 0.86;
    const L = Hf * e.ratio[1] / e.ratio[0];
    const off = 0.02, top = h - 0.1;
    const cloth = tagCloth(new THREE.Mesh(drapeGeo(L, Hf, opts.outdoor ? 0.3 : 0, off), e.mat), id, "staff");
    cloth.position.y = top;
    grp.add(cloth);
    const fr = new THREE.Mesh(fringeGeo(L, Hf, off), fringeMat());
    fr.position.y = top; fr.castShadow = false;
    fr.userData.cbzFlag = { id: id, kind: "fringe" };
    grp.add(fr);
    root.add(grp);
    A.staffs++;
    const out = { group: grp, cloth: cloth, id: id };
    if (opts.tag) (TAGS[opts.tag] = TAGS[opts.tag] || []).push(out);
    return out;
  }
  // A HANGING BANNER: the flag hung vertically from a rod, union to the
  // observer's upper left. (x, top, z) is the middle of the rod; it faces
  // along +z rotated by yaw. width x length metres.
  function banner(root, opts) {
    if (!THREE || !root) return null;
    opts = opts || {};
    const id = opts.id || opts.nation || "republic";
    const w = opts.width > 0.2 ? +opts.width : 1.2, L = opts.length > 0.4 ? +opts.length : 3.6;
    const key = ["banner", w.toFixed(2), L.toFixed(2), opts.outdoor === false ? 0 : 1].join("|");
    let geo = GEO.get(key);
    if (!geo) {
      const B = { pos: [], nor: [], uv: [], cloth: [], idx: [] }, nx = 6, ny = 18;
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const u = i / nx, v = j / ny;
        B.pos.push(-w / 2 + u * w, -v * L, 0); B.nor.push(0, 0, 1); B.uv.push(u, 1 - v);
        B.cloth.push(v, opts.outdoor === false ? 0 : 0.14, 2, L);
      }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        B.idx.push(a, c, d, a, d, b);
      }
      geo = buildGeo(B); geo.computeBoundingSphere();
      GEO.set(key, shared(geo));
    }
    const grp = new THREE.Group();
    grp.name = "flagbanner";
    grp.position.set(+opts.x || 0, +opts.y || 0, +opts.z || 0);
    grp.rotation.y = opts.yaw || 0;
    const cloth = tagCloth(new THREE.Mesh(geo, bannerMaterial(id, w, L)), id, "banner");
    grp.add(cloth);
    grp.add(hwMesh(bannerHardware(w, L)));
    root.add(grp);
    A.banners++;
    return { group: grp, cloth: cloth, id: id };
  }
  // A HAND FLAG on a stick (a supporter in the crowd). Parent it to the
  // hand group; the hoist is the stick at the origin, the fly toward +x.
  function hand(parent, opts) {
    if (!THREE || !parent) return null;
    opts = opts || {};
    const id = opts.id || opts.nation || home();
    const e = entry(id);
    const L = opts.fly > 0.1 ? +opts.fly : 0.45, H = L * e.ratio[0] / e.ratio[1];
    const m = tagCloth(new THREE.Mesh(flatGeo(L, H, 8, 3, 1.25, 0, 0.01, false), e.mat), id, "hand");
    m.position.set(opts.x || 0, opts.top != null ? opts.top - H / 2 : (opts.y || 0), opts.z || 0);
    if (opts.yaw) m.rotation.y = opts.yaw;
    parent.add(m);
    A.hands++;
    return m;
  }
  // A FENDER FLAG: a chrome staff on the wing, the flag streaming aft (-z).
  function car(parent, opts) {
    if (!THREE || !parent) return null;
    opts = opts || {};
    const id = opts.id || opts.nation || home();
    const e = entry(id);
    const grp = new THREE.Group();
    grp.position.set(opts.x || 0, opts.y || 0, opts.z || 0);
    const k = "carhw";
    let hw = GEO.get(k);
    if (!hw) {
      const st = new THREE.CylinderGeometry(0.007, 0.009, 0.5, 8); st.translate(0, 0.25, 0);
      const base = new THREE.CylinderGeometry(0.022, 0.026, 0.035, 10); base.translate(0, 0.017, 0);
      const tip = new THREE.SphereGeometry(0.014, 10, 8); tip.translate(0, 0.51, 0);
      hw = shared(mergeColoured([[st, 0xe4e7ea], [base, 0xe4e7ea], [tip, 0xe4e7ea]]));
      GEO.set(k, hw);
    }
    grp.add(hwMesh(hw));
    const L = 0.42, H = L * e.ratio[0] / e.ratio[1];
    const cloth = tagCloth(new THREE.Mesh(flatGeo(L, H, 10, 3, 1.6, 0, 0.009, false), e.mat), id, "car");
    cloth.position.y = 0.48 - H / 2;
    cloth.rotation.y = Math.PI / 2;                  // local +x (the fly) -> -z, aft
    grp.add(cloth);
    parent.add(grp);
    A.cars++;
    return grp;
  }

  // ============================================================
  //  §7  CUSTOM FLAGS — the President's own, and the save
  // ============================================================
  const g = CBZ.game || (CBZ.game = {});
  function emit(evt, payload) { const P = CBZ.presidency; if (P && P.emit) { try { P.emit(evt, payload); } catch (e) {} } A.events++; }
  function nameOf(id) { const r = polRec(id); return (r && r.name) || (NATIONS[id] && NATIONS[id].name) || id; }
  function setCustom(id, design, quiet) {
    id = String(id || "republic");
    if (design) {
      const d = {
        layout: LAY[design.layout] ? design.layout : "tricolour-v",
        colors: (design.colors || []).slice(0, 4).map(String),
        emblem: design.emblem && design.emblem.kind ? { kind: String(design.emblem.kind), color: design.emblem.color || C.gold, color2: design.emblem.color2, color3: design.emblem.color3, n: design.emblem.n } : { kind: "none" },
      };
      if (design.stripes) d.stripes = design.stripes | 0;
      if (design.cantonStripes) d.cantonStripes = design.cantonStripes | 0;
      if (design.cantonW) d.cantonW = +design.cantonW;
      if (design.points) d.points = design.points | 0;
      if (design.bands) d.bands = design.bands.slice(0, 3);
      CUSTOM[id] = d;
    } else delete CUSTOM[id];
    refresh(id);
    stamp();
    if (!quiet) {
      const text = "President unveils new national flag";
      // THE ACT (city/politics.js): a new flag is a move on the nation itself
      if (CBZ.politics && CBZ.politics.act && CBZ.politics.owns && CBZ.politics.owns(id)) { try { CBZ.politics.act("flag", { by: "self" }); } catch (e) {} }
      emit("flag-changed", { nation: id, nationName: nameOf(id), text: text, headline: text, cat: "NATION", breaking: true, custom: !!design, design: designFor(id) });
    }
    return designFor(id);
  }
  function setRegime(id, key, quiet) {
    id = String(id || "republic");
    const k = key && key !== "none" && REGIMES[key] ? key : null;
    if ((REGIME[id] || null) === k) return false;
    if (k) REGIME[id] = k; else delete REGIME[id];
    if (CUSTOM[id] && k && !quiet) delete CUSTOM[id];   // a new order does not fly the old President's design
    refresh(id);
    stamp();
    if (quiet) return true;
    const text = k ? "A new flag goes up over " + nameOf(id) : "The old flag flies again over " + nameOf(id);
    emit("flag-changed", { nation: id, nationName: nameOf(id), text: text, headline: text, cat: "NATION", regime: k, design: designFor(id) });
    return true;
  }

  // persist: stamped onto the city ledger before every commit/collect (the
  // polity's own pattern), hydrated back whenever that ledger changes
  function stamp() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.flags = { v: 1, custom: clone(CUSTOM) };
  }
  let _wrapped = false, _ledger = null;
  function ensureSaveWraps() {
    if (_wrapped) return;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit !== "function") return;
    _wrapped = true;
    if (!commit._flagWrap) {
      const w = function () { stamp(); return commit.apply(this, arguments); };
      w._flagWrap = true; CBZ.cityWorldCommit = w;
    }
    const col = CBZ.cityWorldCollect;
    if (typeof col === "function" && !col._flagWrap) {
      const wc = function () { stamp(); return col.apply(this, arguments); };
      wc._flagWrap = true; CBZ.cityWorldCollect = wc;
    }
  }
  function hydrate() {
    const led = g.cityWorld;
    if (!led || led === _ledger) return;
    _ledger = led;
    const had = Object.keys(CUSTOM);
    for (const k in CUSTOM) delete CUSTOM[k];
    const src = led.flags && led.flags.custom;
    if (src && typeof src === "object") for (const k in src) if (src[k] && src[k].layout) CUSTOM[k] = src[k];
    const all = had.concat(Object.keys(CUSTOM));
    for (let i = 0; i < all.length; i++) refresh(all[i]);
  }

  // THE DESIGNER. At the national standard behind the President's desk
  // (interior_programs.js tags it "oval"): E changes the pattern, the wheel
  // changes the colours or the emblem or puts it back, hold E adopts it.
  // The draft is painted on THAT cloth only until it is adopted.
  const DZ = { draft: null, staff: null, nation: null, mat: null, tex: null, li: 0, pi: 0, ei: 0, wired: false };
  function draftPaint() {
    if (!THREE || !DZ.draft) return;
    const e = entry(DZ.nation);
    const c = makeCanvas(TEX_W, texH(e.ratio)), gg = c && c.getContext("2d");
    if (!gg) return;
    const d = Object.assign({}, DZ.draft, { colors: DZ.draft.colors.slice() });
    paint(gg, d, c.width, c.height, { heading: true });
    if (!DZ.tex) { DZ.tex = newTex(c); DZ.mat = clothMaterial(DZ.tex); DZ.mat._shared = false; }
    else { DZ.tex.image = c; DZ.tex.needsUpdate = true; }
    if (DZ.staff && DZ.staff.cloth) DZ.staff.cloth.material = DZ.mat;
  }
  function draftBegin(st, nation) {
    const cur = designFor(nation);
    DZ.staff = st; DZ.nation = nation;
    DZ.li = Math.max(0, LAYOUTS.indexOf(cur.layout));
    DZ.pi = 0; DZ.ei = Math.max(0, EMBLEMS.indexOf(cur.emblem && cur.emblem.kind));
    DZ.draft = { layout: cur.layout, colors: (cur.colors || []).slice(), emblem: Object.assign({}, cur.emblem || { kind: "none" }) };
  }
  function draftPalette() {
    const p = PALETTES[DZ.pi % PALETTES.length];
    const lay = DZ.draft.layout;
    // a four-colour layout gets white fimbriation; stripes alternate the
    // first two and put the third in the canton
    DZ.draft.colors = lay === "triband-fimbriated" ? [p[0], p[2] === C.white ? C.black : p[2], p[1] === C.white ? p[0] : p[1], C.white].slice(0, 4) : p.slice();
    if (lay === "stripes-canton") { DZ.draft.stripes = 9; DZ.draft.cantonStripes = 5; DZ.draft.cantonW = 0.4; }
  }
  const designer = {
    active: function () { return !!DZ.draft; },
    begin: function (st, nation) { draftBegin(st, nation || home()); draftPaint(); return clone(DZ.draft); },
    pattern: function () {
      if (!DZ.draft) return null;
      DZ.li = (DZ.li + 1) % LAYOUTS.length; DZ.draft.layout = LAYOUTS[DZ.li];
      if (DZ.draft.layout === "nordic" && DZ.draft.colors.length < 3) draftPalette();
      if (DZ.draft.layout === "triband-fimbriated" || DZ.draft.layout === "stripes-canton") draftPalette();
      draftPaint(); return clone(DZ.draft);
    },
    colours: function () { if (!DZ.draft) return null; DZ.pi = (DZ.pi + 1) % PALETTES.length; draftPalette(); draftPaint(); return clone(DZ.draft); },
    emblem: function () {
      if (!DZ.draft) return null;
      DZ.ei = (DZ.ei + 1) % EMBLEMS.length;
      const k = EMBLEMS[DZ.ei];
      const p = PALETTES[DZ.pi % PALETTES.length];
      DZ.draft.emblem = k === "none" ? { kind: "none" } : { kind: k, color: k === "shield-spears" ? p[0] : C.gold, color2: C.white, color3: C.black };
      draftPaint(); return clone(DZ.draft);
    },
    adopt: function () {
      if (!DZ.draft) return null;
      const nation = DZ.nation, d = DZ.draft;
      designer.cancel();
      return setCustom(nation, d);
    },
    cancel: function () {
      if (DZ.staff && DZ.staff.cloth) DZ.staff.cloth.material = entry(DZ.nation || DZ.staff.id).mat;
      DZ.draft = null; DZ.staff = null;
      return true;
    },
    draft: function () { return DZ.draft ? clone(DZ.draft) : null; },
  };
  function presSeated() {
    const P = CBZ.presidency;
    if (!P || typeof P.status !== "function") return false;
    try { const s = P.status(); return !!(s && s.seat); } catch (e) { return false; }
  }
  function ovalStaff(px, pz, r) {
    const L = TAGS.oval;
    if (!L) return null;
    let best = null, bd = r * r;
    for (let i = L.length - 1; i >= 0; i--) {
      const s = L[i];
      if (!s.group || !s.group.parent) { L.splice(i, 1); continue; }
      const w = s.group.getWorldPosition(new THREE.Vector3());
      const P = CBZ.player;
      if (P && P.pos && Math.abs(P.pos.y - w.y) > 2.2) continue;
      const d2 = (w.x - px) * (w.x - px) + (w.z - pz) * (w.z - pz);
      if (d2 < bd) { bd = d2; best = { s: s, w: w }; }
    }
    return best;
  }
  function wireDesigner() {
    if (DZ.wired || !CBZ.interactions || !CBZ.interactions.registerZone || !THREE) return;
    DZ.wired = true;
    CBZ.interactions.registerZone({
      id: "flag-designer", kind: "flagstand", radius: 1.9, prio: 13,
      find: function (px, pz) {
        if (!presSeated()) return null;
        const b = ovalStaff(px, pz, 1.9);
        if (!b || b.s.id !== home()) return null;
        return { x: b.w.x, y: b.w.y + 1.4, z: b.w.z, kind: "flagstand", staff: b.s };
      },
      options: [{
        id: "flag-pattern", slot: "e", prio: 20, campaignSafe: true,
        label: function () { return DZ.draft ? "Change pattern" : "Redesign"; },
        canShow: function () { return true; },
        onSelect: function (t) {
          if (!DZ.draft) { const b = t && t.staff ? t.staff : (TAGS.oval || [])[0]; if (b) designer.begin(b, home()); }
          else designer.pattern();
        },
      }, {
        id: "flag-adopt", hold: true, prio: 18, campaignSafe: true,
        label: "Adopt",
        canShow: function () { return !!DZ.draft; },
        onSelect: function () { designer.adopt(); },
      }, {
        id: "flag-colours", prio: 12, campaignSafe: true, label: "Change colors",
        canShow: function () { return !!DZ.draft; },
        onSelect: function () { designer.colours(); },
      }, {
        id: "flag-emblem", prio: 11, campaignSafe: true, label: "Change emblem",
        canShow: function () { return !!DZ.draft; },
        onSelect: function () { designer.emblem(); },
      }, {
        id: "flag-putback", prio: 10, campaignSafe: true, label: "Put it back",
        canShow: function () { return !!DZ.draft; },
        onSelect: function () { designer.cancel(); },
      }],
    });
    if (CBZ.interactions.describe) { try { CBZ.interactions.describe("flagstand", function () { return { label: "", note: "" }; }); } catch (e) {} }
  }

  // ============================================================
  //  §9  THE TICK — the clock and the wind every flag reads
  // ============================================================
  let wx = 1, wz = 0, ws = 0.5, acc = 0;
  function tick(dt) {
    dt = Math.min(0.1, dt || 0);
    U.t.value = (U.t.value + dt) % 10000;
    let tx = 1, tz = 0, tsp = 3;
    if (CBZ.weatherWind) { try { const w = CBZ.weatherWind(); if (w) { tx = w.x; tz = w.z; tsp = w.speed; } } catch (e) {} }
    // a flag never hangs dead outside: a 0.35 floor of breeze, full at ~10 m/s
    const target = Math.max(0.35, Math.min(1.3, 0.35 + (+tsp || 0) / 12));
    const k = Math.min(1, dt * 0.6);
    wx += (tx - wx) * k; wz += (tz - wz) * k; ws += (target - ws) * k;
    const m = Math.hypot(wx, wz) || 1;
    if (U.wind.value) U.wind.value.set(wx / m, wz / m, ws, 0);
    if (pendN) flush();
    acc += dt;
    if (acc > 1) {
      acc = 0;
      ensureSaveWraps(); hydrate(); wireDesigner();
      // a draft left behind is put back
      if (DZ.draft && CBZ.player && CBZ.player.pos) {
        const b = ovalStaff(CBZ.player.pos.x, CBZ.player.pos.z, 7);
        if (!b) designer.cancel();
      }
    }
  }
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(38.9, function (dt) { try { tick(dt); } catch (e) {} });

  function audit() {
    const out = { nations: {}, keys: Object.keys(T), custom: Object.keys(CUSTOM), regime: Object.assign({}, REGIME), counts: Object.assign({}, A), pending: pendN, drafting: !!DZ.draft };
    const L = ids();
    for (let i = 0; i < L.length; i++) { const d = designFor(L[i]); out.nations[L[i]] = { layout: d.layout, ratio: d.ratio, colors: d.colors, emblem: d.emblem && d.emblem.kind }; }
    return out;
  }

  CBZ.flags = {
    designFor: designFor, nationAt: nationAt, home: home, ids: ids,
    paint: paint, dataURL: dataURL, material: material, texture: texture, bannerMaterial: bannerMaterial,
    pole: pole, staff: staff, banner: banner, hand: hand, car: car, flush: flush,
    setCustom: setCustom, setRegime: setRegime, custom: function (id) { return CUSTOM[id] ? clone(CUSTOM[id]) : null; },
    regime: function (id) { return REGIME[id] || null; },
    designer: designer, tagged: function (t) { return (TAGS[t] || []).slice(); },
    audit: audit, tick: tick,
    LAYOUTS: LAYOUTS.slice(), EMBLEMS: EMBLEMS.slice(), PALETTES: PALETTES.map(function (p) { return p.slice(); }),
    NATIONS: NATIONS, FACTIONS: FACTIONS, REGIMES: REGIMES,
    _uniforms: U, _drape: drapePoint,
  };
})();
