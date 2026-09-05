/* ============================================================
   city/president_regime.js — THE FALL IS VISIBLE ON THE BUILDING.

   PRESIDENT-PLAN.md §2 item 7, verbatim: "The falls are visible on the
   building. Emergency 100 -> dictatorship: the flags change, the detail's
   org flips to the junta, the press leaves the hall. The crown changes it
   again. The player should see what they became from the motor court."

   Before this file the republic could become a dictatorship (regimes.js,
   emergencyPowers 100), a monarchy (crown.js selfCrown), proclaim fascism
   or communism (regimes.js declareDoctrine), or be taken by a junta
   (civilwar.js applyCoupOutcome stamps a "junta general" onto the seat) —
   and the Executive Mansion did not change one pixel. Every one of those
   was a headline in the feed and a string on a canvas in a locked room.

   WHAT THIS FILE OWNS, AND ONLY THIS: one THREE.Group of dressing hung on
   the compound govcomplex.js already built. It authors no regime state, no
   govType write, no second president, no interior, no ped. It READS
   `CBZ.presidency.status().govType` once a second and, when (and only when)
   that answer changes, tears its group down and hangs a different one.

   WHY IT DOES NOT EDIT govcomplex.js: the compound is BUILD-TIME geometry
   inside a builder that runs once at worldgen, merged by core/batch.js into
   the city-wide static buckets. A regime change happens mid-run, hundreds of
   in-game days after that merge. Dressing that can come down has to be its
   own group, added to the arena root AFTER the batch pass — which is exactly
   what city/presidency.js's buildRoom() already does for the Situation Room,
   so this is that shape, not a new one.

   THE GEOMETRY IS DERIVED, NOT TYPED. Every offset below is solved from the
   two calls govcomplex.js's execmansion builder actually makes:

     civic(root, cx, cz-34, 56, 34, 2, M.marble, 1, {order:"doric",
           crown:"dome", monumental:true, externalPerron:true}, ...)
       -> shell centre (cx, cz-34), 56 m in x, 34 m in z, TWO storeys at
          buildings.js's FH = 3.2, so rTop = 6.4. The door face is +z, hence
          the FACADE PLANE is z = cz-17 and the hall spans x = cx +/- 28.
     perron(root, cx, cz-17, 56, 9, M.stone, 1)
       -> a PERRON_TOP = 0.30 deck from z = cz-17 out to cz-9.2, then 1.2 m
          of treads to cz-8. 0.30 is the ground a banner has to reach; a
          banner that stops at y = 0 floats 30 cm over a stone deck, which is
          the exact class of bug PRESIDENT-PLAN §1a was written about.

   and from bldCivicOrder() in buildings_civic.js, which stands the order on
   that deck: nCol = 10, colStep = (56-1.6)/10 = 5.44, columns at
   t = -27.2 + i*5.44 (the centre one skipped for the 2.6 m doorway),
   R = 0.42, column axis at z = cz-16.52 (front faces at cz-16.10);
   colBase = 0.30, orderH = max(FH*1.1, rTop-colBase-1.9) = 4.2, so
   entY = 0.30+0.40+3.20+0.34 = 4.24 and the ARCHITRAVE UNDERSIDE is at
   4.29. Banners hang from 4.24 down to 0.24 — under the stone, into the
   deck, nothing floating at either end — and they sit in the MIDDLE of each
   intercolumniation (t = column t + 2.72) so no banner ever intersects a
   doric shaft.

   THE FLAGPOLE BANNERS ARE ON THE WALL ON PURPOSE. The plan asked for
   banners at the order's two stylobate flagpoles (x = cx +/- 26.8). A box
   hung in the air beside a 0.3 m pole is a floater; the outermost pair of
   facade banners (t = +/- 24.48) reads as the same gesture and is attached
   to something. Same reasoning for the gatehouse pair: the booth is 3.0 m
   tall, so its banners are 2.6 m, not the facade's 4.0 m.

   LOAD: index.html, after city/presidency.js. Everything is feature-detected
   — without presidency.js this file reads the polity record directly and
   still dresses the house; without govcomplex.js it does nothing at all.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // Self-defaulted at the top of its OWN module, config.js's documented
  // idiom for the realism-pass flag families (`?cfg_PRESIDENT_REGIME_DRESS=0`).
  if (CFG.PRESIDENT_REGIME_DRESS == null) CFG.PRESIDENT_REGIME_DRESS = true;
  function on() { return CFG.PRESIDENT_REGIME_DRESS !== false; }

  function day() { return CBZ.worldDay ? CBZ.worldDay() : 0; }
  function big(t) { if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(t); } catch (e) {} } }
  function feed(t, c) { if (CBZ.cityFeed) { try { CBZ.cityFeed(t, c || "#ffd76a"); } catch (e) {} } }

  // ============================================================
  //  §1  THE PALETTE PER REGIME
  //  One row per thing the compound can become. `hang` is the list of
  //  fittings; the builders below switch on nothing else.
  // ============================================================
  const REGIME = {
    dictatorship: {
      cloth: 0x6e1512, band: 0x16181c, trim: 0xb99347, lamp: 0xffe2a8, sand: 0x9a8a62,
      plate: "portrait",
      hang: { banners: true, gatehouse: true, searchlights: true, barriers: true },
      headline: "THE MANSION HANGS THE BANNERS OF THE ONE STATE",
      note: "The Executive Mansion hangs the banners of the one state.",
    },
    fascism: {
      cloth: 0x17181c, band: 0x7a1a15, trim: 0xc0a24a, lamp: 0xffe2a8, sand: 0x958a6a,
      plate: "portrait",
      hang: { banners: true, gatehouse: true, searchlights: true, barriers: true },
      headline: "THE MANSION HANGS THE BANNERS OF THE PARTY",
      note: "Party colours go up on the Executive Mansion; the gate grows sandbags.",
    },
    communism: {
      cloth: 0xa8201a, band: 0x7d1512, trim: 0xd9b23c, lamp: 0xffe2a8, sand: 0x9a8a62,
      plate: "emblem",
      hang: { banners: true, gatehouse: true, emblem: true, podium: true, redWater: true },
      headline: "THE MANSION HANGS THE RED BANNERS OF THE PEOPLE",
      note: "Red banners on the Mansion, a speaking podium on the fountain axis.",
    },
    monarchy: {
      cloth: 0x4a2b70, band: 0x2e1a47, trim: 0xd2b04a, lamp: 0xffe9b0, sand: 0x9a8a62,
      plate: "crest",
      hang: { banners: true, gatehouse: true, guardposts: true },
      headline: "THE MANSION HANGS THE COLOURS OF THE CROWN",
      note: "Royal purple on the Mansion, ceremonial posts either side of the perron.",
    },
    junta: {
      cloth: 0x4e5330, band: 0x2a2e1b, trim: 0x8b8f6a, lamp: 0xfff0c8, sand: 0x8c8355,
      plate: "martial",
      hang: { banners: true, gatehouse: true, searchlights: true, barriers: true },
      headline: "MARTIAL LAW · THE MANSION BELONGS TO THE JUNTA",
      note: "Olive drab over the state colours. The gate is a checkpoint now.",
    },
  };
  const RESTORED = "THE BANNERS COME DOWN · THE MANSION IS A REPUBLIC AGAIN";

  // ============================================================
  //  §2  READING THE REGIME — presidency.js's status() is the contract;
  //  everything here is a documented fallback to the record it reads from,
  //  so a build without that method still dresses the right house.
  // ============================================================
  function countryRec() {
    const P = CBZ.presidency;
    if (P && typeof P.seat === "function") {
      let h = null; try { h = P.seat(); } catch (e) {}
      if (h && h.rec) return h.rec;
    }
    // presidency.js's own countryRecAny(): the first country with an office
    // that is not already a crown, else whatever the registry has.
    if (!CBZ.polity || !CBZ.polity.list) return null;
    const l = CBZ.polity.list("country") || [];
    for (let i = 0; i < l.length; i++) {
      const r = l[i];
      if (r && r.office && r.govType !== "monarchy") return r;
    }
    return l[0] || null;
  }
  function holderJob(rec) {
    const sid = rec && rec.office ? rec.office.holder : null;
    if (!sid || !CBZ.cityLedgerEntry) return "";
    const e = CBZ.cityLedgerEntry(sid);
    return e ? String(e.job || "") : "";
  }
  function leaderName(rec) {
    const sid = rec && rec.office ? rec.office.holder : null;
    if (!sid) return "THE LEADER";
    if (CBZ.officials && CBZ.officials.identityOf) {
      let id = null; try { id = CBZ.officials.identityOf(sid); } catch (e) {}
      if (id && id.name && id.name !== "Someone") return String(id.name).toUpperCase();
    }
    const e = CBZ.cityLedgerEntry ? CBZ.cityLedgerEntry(sid) : null;
    if (e && e.name) return String(e.name).toUpperCase();
    return "THE LEADER";
  }
  // -> { key, govType, seat, rec }. `key` is a REGIME row id or "none".
  function read() {
    const P = CBZ.presidency;
    let govType = null, seat = null;
    if (P && typeof P.status === "function") {
      let s = null; try { s = P.status(); } catch (e) { s = null; }
      if (s) { govType = s.govType || null; if (s.seat != null) seat = !!s.seat; }
    }
    const rec = countryRec();
    if (!govType && rec) govType = rec.govType || null;
    if (seat == null) {
      let h = null;
      if (P && typeof P.seat === "function") { try { h = P.seat(); } catch (e) {} }
      seat = !!h;
    }
    let key = "none";
    if (govType === "monarchy") key = "monarchy";
    else if (govType === "communism") key = "communism";
    else if (govType === "dictatorship" || govType === "fascism" || govType === "emergencyRule") {
      // THE JUNTA TEST, presidency.js tickFallsDay's verbatim: a coup keeps
      // the authoritarian govType and swaps the HOLDER for a "junta general".
      // If status() cannot tell us the holder's job, an authoritarian seat the
      // player does not hold is the junta — which is the fallback the task
      // contract names.
      const junta = /junta|dictator/i.test(holderJob(rec)) || !seat;
      key = junta ? "junta" : (govType === "fascism" ? "fascism" : "dictatorship");
    }
    return { key: key, govType: govType || "none", seat: seat, rec: rec };
  }

  // ============================================================
  //  §3  DRESSING PRIMITIVES — cached factories only, so core/batch.js can
  //  bucket the group by colour if it ever sweeps it, and NO userData on any
  //  mesh (that field is what tells the batcher a mesh is interactive).
  // ============================================================
  const D = {
    key: null,          // the REGIME row currently hung ("none" = bare republic)
    group: null,
    cols: [],           // colliders WE pushed, spliced back out on teardown
    plats: [],          // platforms WE pushed
    own: [],            // fresh materials/textures WE made (the caches own the rest)
    root: null,         // the arena root we parented to
    builtFor: null,     // the CBZ.govComplexes identity we solved offsets against
    pieces: 0,
    lastChangeDay: -1,
    detailTier: null,   // the detail's gearTier before we touched it
    detailFor: null,    // ...and which detail record that reading belongs to
  };
  function cm(hex, o) { return CBZ.cmat ? CBZ.cmat(hex, o) : new THREE.MeshLambertMaterial({ color: hex }); }
  function bgeo(w, h, d) { return CBZ.boxGeom ? CBZ.boxGeom(w, h, d) : new THREE.BoxGeometry(w, h, d); }
  function box(x, y, z, w, h, d, hex, cast) {
    const m = new THREE.Mesh(bgeo(w, h, d), cm(hex));
    m.position.set(x, y, z);
    m.castShadow = cast !== false; m.receiveShadow = true;
    D.group.add(m);
    return m;
  }
  function cyl(x, y, z, r, h, hex, seg, rotX) {
    const geo = new THREE.CylinderGeometry(r, r, h, seg || 14);
    const m = new THREE.Mesh(geo, cm(hex));
    if (rotX) m.rotation.x = rotX;
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    D.group.add(m);
    D.own.push(geo);
    return m;
  }
  function disc(x, y, z, r, hex, seg) {
    const geo = new THREE.CircleGeometry(r, seg || 24);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, cm(hex));
    m.position.set(x, y, z);
    m.receiveShadow = true; m.castShadow = false;
    m.matrixAutoUpdate = false; m.updateMatrix();
    D.group.add(m);
    D.own.push(geo);
    return m;
  }
  // A textured face, hung flat against the +z facade. Its material is FRESH
  // (a map can never go in CBZ.cmat's colour-keyed pool) and therefore ours
  // to dispose; a faint emissive keeps the leader readable after dark without
  // an unlit MeshBasicMaterial that ignores the compound's own light rig.
  function facePlate(x, y, z, w, h, tex) {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a2a2a });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = false; m.receiveShadow = true;
    D.group.add(m);
    D.own.push(geo, mat);
    return m;
  }
  function col(x, z, w, d, y0, y1) {
    const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, y0: y0 || 0, y1: y1 == null ? 0 : y1, ref: null };
    (CBZ.colliders = CBZ.colliders || []).push(c);
    D.cols.push(c);
    return c;
  }
  function plat(x, z, w, d, top) {
    const p = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: top };
    (CBZ.platforms = CBZ.platforms || []).push(p);
    D.plats.push(p);
    return p;
  }

  // ============================================================
  //  §4  THE PLATE TEXTURES — one canvas per (kind|title|name|palette), cached
  //  for the life of the page. A portrait, a crest, a party star and a
  //  stencilled proclamation are not lettering on a stone strip, so the big
  //  board is drawn here; the small NAME board over the doorway is
  //  civicPlaqueTex (buildings_civic.js) at that helper's own 512x96 aspect.
  // ============================================================
  const plateCache = new Map();
  // `title` is the big mark, `name` the band across the foot. civicPlaqueTex
  // is NOT reused for the big plate: it draws a 512x96 strip, and stretching
  // a 5.3:1 texture onto a 1.2:1 board turns carved capitals into a smear.
  // It IS reused, at its own aspect, for the name board over the doorway.
  function plateTex(kind, title, name, R) {
    const key = kind + "|" + title + "|" + name + "|" + R.cloth + "|" + R.trim;
    let t = plateCache.get(key); if (t) return t;
    const W = 320, H = 270;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d");
    const hex = function (n) { return "#" + ("000000" + (n >>> 0).toString(16)).slice(-6); };
    const CLOTH = hex(R.cloth), BAND = hex(R.band), TRIM = hex(R.trim);
    x.fillStyle = BAND; x.fillRect(0, 0, W, H);
    x.fillStyle = CLOTH; x.fillRect(9, 9, W - 18, H - 18);
    x.strokeStyle = TRIM; x.lineWidth = 5; x.strokeRect(15, 15, W - 30, H - 30);

    if (kind === "portrait") {
      // A bust silhouette. Deliberately a SILHOUETTE: a painted face at this
      // texel budget reads as a smear, a hard shoulders-and-head shape reads
      // as a leader on a wall from the motor court 90 m away.
      x.fillStyle = BAND;
      x.beginPath(); x.arc(W / 2, 104, 44, 0, 7); x.fill();
      x.beginPath(); x.moveTo(W / 2 - 78, 214); x.quadraticCurveTo(W / 2, 128, W / 2 + 78, 214);
      x.lineTo(W / 2 + 78, 220); x.lineTo(W / 2 - 78, 220); x.closePath(); x.fill();
      x.strokeStyle = TRIM; x.lineWidth = 3;
      x.beginPath(); x.arc(W / 2, 104, 44, 0, 7); x.stroke();
    } else if (kind === "crest") {
      // A shield under a crown — the monarchy's one readable mark.
      x.fillStyle = TRIM;
      x.beginPath();
      x.moveTo(W / 2 - 56, 92); x.lineTo(W / 2 + 56, 92);
      x.lineTo(W / 2 + 56, 150); x.quadraticCurveTo(W / 2, 216, W / 2 - 56, 150);
      x.closePath(); x.fill();
      x.fillStyle = BAND;
      x.beginPath();
      x.moveTo(W / 2 - 42, 104); x.lineTo(W / 2 + 42, 104);
      x.lineTo(W / 2 + 42, 148); x.quadraticCurveTo(W / 2, 198, W / 2 - 42, 148);
      x.closePath(); x.fill();
      x.fillStyle = TRIM;
      x.beginPath();
      x.moveTo(W / 2 - 52, 82); x.lineTo(W / 2 - 34, 48); x.lineTo(W / 2 - 16, 76);
      x.lineTo(W / 2, 42); x.lineTo(W / 2 + 16, 76); x.lineTo(W / 2 + 34, 48);
      x.lineTo(W / 2 + 52, 82); x.closePath(); x.fill();
    } else if (kind === "martial") {
      // A stencilled proclamation board. Two lines, because "MARTIAL LAW" set
      // on one line inside a 1.2:1 board is 14 px tall and unreadable at the
      // 90 m the motor court actually views this from.
      const lines = String(title).split(" ");
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillStyle = BAND; x.fillRect(26, 46, W - 52, 130);
      x.fillStyle = TRIM;
      for (let i = 0; i < lines.length; i++) {
        let fs = 54;
        do { x.font = "800 " + fs + "px Impact, Haettenschweiler, Arial Black, sans-serif"; fs -= 2; }
        while (x.measureText(lines[i]).width > W - 78 && fs > 12);
        x.fillText(lines[i], W / 2, 46 + (i + 0.5) * (130 / lines.length));
      }
    } else {
      // emblem: a five-point star in the trim gold on the cloth field.
      x.fillStyle = TRIM;
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 30 : 72, a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const px = W / 2 + Math.cos(a) * r, py = 124 + Math.sin(a) * r;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath(); x.fill();
    }

    // the name band across the foot
    x.fillStyle = BAND; x.fillRect(15, H - 62, W - 30, 44);
    x.fillStyle = TRIM; x.textAlign = "center"; x.textBaseline = "middle";
    let fs = 30;
    do { x.font = "700 " + fs + "px Georgia, Times New Roman, serif"; fs -= 2; }
    while (x.measureText(name).width > W - 46 && fs > 10);
    x.fillText(name, W / 2, H - 40);

    t = new THREE.CanvasTexture(c);
    plateCache.set(key, t);
    return t;
  }

  // ============================================================
  //  §5  THE SOLVED COMPOUND FRAME — every number the builders use, derived
  //  once from the live site rect. See the header for the derivation.
  // ============================================================
  function site() {
    const L = CBZ.govComplexes;
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === "execmansion" && L[i].rect) return L[i];
    // presidency.site() is the contract; the scan above is what it wraps.
    const P = CBZ.presidency;
    if (P && typeof P.site === "function") { try { return P.site() || null; } catch (e) {} }
    return null;
  }
  // `R` in every hang*() below is the REGIME palette row, so the site rect is
  // deliberately NOT called R here.
  function frame(s) {
    const cx = s.cx, cz = s.cz, rect = s.rect;
    return {
      cx: cx, cz: cz, rect: rect,
      FACADE: cz - 17,          // the mansion's front wall plane
      DECK: 0.30,               // PERRON_TOP — the ground a banner must reach
      BAN_TOP: 4.24,            // architrave underside is 4.29
      BAN_Z: cz - 16.80,        // 0.20 proud of the wall, 0.70 clear of the shafts
      PLATE_Z: cz - 16.30,      // clear of the 0.52 cornice, behind the columns
      GX: cx - 8,               // gatehouse booth centre (gatehouse() offsets -8 on x)
      GZ: rect.maxZ - 6,
      GROOF: 3.26,              // booth roof slab top
      BARRIER_Z: cz + 40,       // inside the gate, on the motor-court paving
      FOUNT_Z: cz + 18,
    };
  }
  // the eight mid-intercolumniation tangents (column t + half a colStep)
  const BAN_T = [-24.48, -19.04, -13.60, -8.16, 8.16, 13.60, 19.04, 24.48];

  // ============================================================
  //  §6  THE FITTINGS
  // ============================================================
  function hangBanners(F, R) {
    const H = 4.0, W = 1.2, T = 0.10;
    const cy = F.BAN_TOP - H / 2;
    for (let i = 0; i < BAN_T.length; i++) {
      const x = F.cx + BAN_T[i];
      box(x, cy, F.BAN_Z, W, H, T, R.cloth);
      // a valance at the head and a weighted hem, so the cloth has ends
      box(x, F.BAN_TOP - 0.10, F.BAN_Z - 0.015, W + 0.16, 0.20, T + 0.05, R.band);
      box(x, F.BAN_TOP - H + 0.07, F.BAN_Z - 0.015, W + 0.10, 0.14, T + 0.04, R.trim);
      if (R.hang.emblem) box(x, F.BAN_TOP - 1.35, F.BAN_Z + 0.06, 0.62, 0.62, 0.05, R.trim, false);
    }
  }
  function hangGatehouse(F, R) {
    // The booth is 3.4 x 3.0 x 3.2 at (GX, GZ) with its roof slab topping out
    // at 3.26 — so these are 2.6 m banners, not the facade's 4.0 m ones.
    const H = 2.6, W = 1.0, T = 0.09, top = 2.94;
    for (const s of [-1, 1]) {
      for (const face of [1, -1]) {
        const z = F.GZ + face * 1.66;
        box(F.GX + s * 0.95, top - H / 2, z, W, H, T, R.cloth);
        box(F.GX + s * 0.95, top - 0.09, z - face * 0.015, W + 0.14, 0.18, T + 0.05, R.band);
      }
    }
  }
  function hangSearchlights(F, R) {
    // Two drums on the gatehouse roof, axis along Z so they read as barrels
    // aimed down the access road. Emissive through CBZ.cmat's own emissive
    // key, so the lens still shares the global pool.
    for (const s of [-1, 1]) {
      const x = F.GX + s * 1.15;
      box(x, F.GROOF + 0.17, F.GZ, 0.52, 0.34, 0.52, R.band);
      cyl(x, F.GROOF + 0.82, F.GZ, 0.46, 0.62, R.band, 12, Math.PI / 2);
      const lens = cyl(x, F.GROOF + 0.82, F.GZ + 0.33, 0.40, 0.06, R.lamp, 14, Math.PI / 2);
      lens.material = cm(R.lamp, { emissive: R.lamp, ei: 1.5 });
      lens.castShadow = false;
    }
  }
  function hangBarriers(F, R) {
    // A SANDBAG line across the motor court leaving a 6 m gap on the axis, so
    // the access road govcomplex.js pushed from the gate is still drivable.
    // Two courses of khaki, the upper one half-lapped and short of the lower
    // by 0.3 m: a single 0.85 m slab in the regime's own dark reads as a
    // jersey barrier trucked in, which is a different (and wrong) object.
    const LO = 0.46, HI = 0.36, BW = 1.9, BD = 1.15;
    let outer = 0;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 11; i++) {
        const x = F.cx + s * (3.95 + i * 1.9);
        const jz = F.BARRIER_Z + (i % 2 ? 0.14 : -0.14);
        box(x, LO / 2 - 0.05, jz, BW, LO, BD, R.sand, false);
        box(x + s * 0.48, LO + HI / 2 - 0.05, jz, BW - 0.55, HI, BD - 0.18, R.sand, false);
        // one squad standard every fourth emplacement, so the line is manned
        // by SOMEBODY's colours rather than being anonymous earthworks
        if (i % 4 === 1) {
          cyl(x, 1.28, jz - 0.42, 0.05, 2.3, R.band, 6);
          box(x + 0.42, 2.02, jz - 0.42, 0.80, 0.62, 0.04, R.cloth, false);
        }
        outer = 3.95 + i * 1.9;
      }
      // ONE collider per run, not 22: the boxes are a continuous parapet and
      // the physics grid does not need to know where each sandbag ends.
      col(F.cx + s * ((3.0 + outer + BW / 2) / 2), F.BARRIER_Z, (outer + BW / 2) - 3.0, BD + 0.5, 0, LO + HI);
    }
  }
  function hangPodium(F, R) {
    // A speaking platform ON the arrival axis but at the FOOT OF THE HOUSE,
    // 4 m clear of the perron's last tread (cz-8) — not out at cz+6, which
    // from the ceremonial approach parks it exactly on the fountain and hides
    // both it and the water this regime just turned red. Two 0.42 risers,
    // both under physics' STEP_UP = 0.45, so it is PLATFORMS only and can
    // never seal anyone anywhere; the same contract the monumental stair uses.
    const z = F.cz - 4;
    box(F.cx, 0.21, z, 6.4, 0.42, 4.0, R.band);
    box(F.cx, 0.63, z, 4.8, 0.42, 2.8, R.cloth);
    plat(F.cx, z, 4.8, 2.8, 0.84);
    // The lectern faces the MOTOR COURT (+z), because that is where the crowd
    // and the arrival axis are; the standards stand behind the speaker, on the
    // house side. Getting this round the wrong way puts a head of state with
    // his back to his own square.
    box(F.cx, 1.34, z + 1.1, 0.95, 1.00, 0.42, R.band);
    box(F.cx, 1.10, z + 1.33, 0.80, 0.72, 0.05, R.cloth, false);
    box(F.cx, 1.10, z + 1.36, 0.34, 0.34, 0.04, R.trim, false);
    for (const s of [-1, 1]) {
      cyl(F.cx + s * 2.0, 2.30, z - 1.5, 0.07, 3.4, R.trim, 8);
      box(F.cx + s * 2.0 + s * 0.55, 3.20, z - 1.5, 1.1, 1.5, 0.06, R.cloth, false);
    }
  }
  function tintFountain(F, R) {
    // NOT an edit to govcomplex.js's fountain: a disc 4 cm above each of its
    // two pool surfaces, which is the separation that file's own height ladder
    // documents as the minimum that survives depth quantisation at 200 m.
    //
    // ONE fountain, not two. There is no PRESIDENT_COMPOUND_V2 branch here
    // because the tiered fountain is the only one govcomplex.js builds; the
    // pre-V2 stone stump was behind a flag that defaulted true from the day it
    // shipped, so that branch has never once run in a default build.
    disc(F.cx, 0.63, F.FOUNT_Z, 3.40, R.cloth, 24);   // basin pool sits at 0.59
    disc(F.cx, 1.67, F.FOUNT_Z, 1.12, R.cloth, 20);   // upper dish sits at 1.63
  }
  function hangGuardPosts(F, R) {
    // Either side of the perron flight. The perron cheek walls stand at
    // x = cx +/- 28.45 (0.9 wide), so 30.0 is clear of them by 0.75.
    for (const s of [-1, 1]) {
      const x = F.cx + s * 30.0, z = F.cz - 9.0;
      box(x, 1.25, z, 1.5, 2.5, 1.5, 0xb9bcc0);
      box(x, 2.58, z, 1.76, 0.20, 1.76, R.band);
      box(x, 2.76, z, 0.9, 0.18, 0.9, R.trim);
      box(x, 1.65, z + 0.78, 0.9, 1.5, 0.06, R.cloth, false);
      col(x, z, 1.5, 1.5, 0, 2.5);
    }
  }
  function hangPlate(F, R, name) {
    // Over the door, proud of the entablature and behind the column plane.
    // 3.60 -> 6.30 in y: clear of the 3.6 door head, under the 6.4 roofline,
    // so it is honest whether or not bldCivicOrder's pediment is present.
    const kind = R.plate;
    const title = kind === "martial" ? "MARTIAL LAW"
      : kind === "crest" ? "THE CROWN"
        : kind === "emblem" ? "THE PEOPLE" : name;
    const board = kind === "martial" ? "BY ORDER OF THE JUNTA"
      : kind === "emblem" ? "THE PEOPLE'S STATE" : name;
    box(F.cx, 4.95, F.PLATE_Z - 0.06, 3.56, 3.02, 0.10, R.band);
    facePlate(F.cx, 4.95, F.PLATE_Z + 0.02, 3.2, 2.7, plateTex(kind, title, board, R));
    // and the name board directly over the doorway, between the inner pair of
    // columns (t = +/-5.44, R = 0.42) — 2.4 m spans +/-1.2 and clears both.
    // 2.4 x 0.45 is civicPlaqueTex's own 512x96, so the capitals are not
    // stretched on their way onto the wall.
    if (CBZ.civicPlaqueTex) {
      box(F.cx, 3.98, F.BAN_Z - 0.02, 2.56, 0.58, 0.10, R.band);
      facePlate(F.cx, 3.98, F.BAN_Z + 0.06, 2.4, 0.45, CBZ.civicPlaqueTex(name, R.trim));
    }
  }

  // ============================================================
  //  §7  BUILD / TEARDOWN
  // ============================================================
  function teardown() {
    if (D.group && D.group.parent) D.group.parent.remove(D.group);
    if (CBZ.colliders) for (let i = 0; i < D.cols.length; i++) {
      const k = CBZ.colliders.indexOf(D.cols[i]);
      if (k >= 0) CBZ.colliders.splice(k, 1);
    }
    if (CBZ.platforms) for (let i = 0; i < D.plats.length; i++) {
      const k = CBZ.platforms.indexOf(D.plats[i]);
      if (k >= 0) CBZ.platforms.splice(k, 1);
    }
    if (D.cols.length && CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    // Only what we MADE. cmat/boxGeom hand out shared, cached, _shared-flagged
    // objects that half the city is also drawing with; disposing those would
    // blank the compound.
    for (let i = 0; i < D.own.length; i++) { try { D.own[i].dispose(); } catch (e) {} }
    D.group = null; D.cols = []; D.plats = []; D.own = [];
    D.root = null; D.builtFor = null; D.pieces = 0;
  }
  function build(key, rec) {
    teardown();
    D.key = key;
    if (key === "none") return true;
    const R = REGIME[key];
    const s = site();
    if (!R || !s) { D.key = null; return false; }
    const A = CBZ.city && CBZ.city.arena;
    const root = (A && A.root) || CBZ.scene;
    if (!root) { D.key = null; return false; }

    D.group = new THREE.Group();
    root.add(D.group);
    D.root = root;
    D.builtFor = CBZ.govComplexes;

    const F = frame(s);
    const name = leaderName(rec !== undefined ? rec : countryRec());
    if (R.hang.banners) hangBanners(F, R);
    if (R.hang.gatehouse) hangGatehouse(F, R);
    if (R.hang.searchlights) hangSearchlights(F, R);
    if (R.hang.barriers) hangBarriers(F, R);
    if (R.hang.podium) hangPodium(F, R);
    if (R.hang.redWater) tintFountain(F, R);
    if (R.hang.guardposts) hangGuardPosts(F, R);
    hangPlate(F, R, name);

    D.pieces = D.group.children.length;
    if (D.cols.length && CBZ.markCollidersDirty) { try { CBZ.markCollidersDirty(); } catch (e) {} }
    return true;
  }

  // ============================================================
  //  §8  THE DETAIL CHANGES ORG. protection.js's record is the only public
  //  place a bodyguard's kit lives, and its two public, serialized fields are
  //  `gearTier` (which spawnMembers actually READS — GEAR[tier] is the
  //  weapon/ammo/hp the body comes out with) and `legalStatus`. There is no
  //  public uniform/outfit/tint field on a detail at all: the ped's clothes
  //  come from cityPostNpc's "security" archetype, which protection.js does
  //  not parameterise. So the org flip is a REAL one on the field that is
  //  read (rifles under a junta, the prior tier back when the republic
  //  returns) plus the bookkeeping one — and no reach into private state.
  // ============================================================
  function retintDetail(rec, key) {
    if (!rec || !CBZ.protection || !CBZ.protection.get) return null;
    const det = CBZ.protection.get("off_" + rec.id);
    if (!det) return null;
    const hard = (key === "junta" || key === "dictatorship" || key === "fascism");
    // Remember the pre-regime tier PER DETAIL RECORD. mode.js's fresh-run
    // sweep calls an explicit list of *Reset hooks and this file is not on it,
    // so a new life must heal itself: a different detail id means a different
    // republic, and the tier we memorised belongs to the last one.
    if (D.detailFor !== det.id) { D.detailFor = det.id; D.detailTier = null; }
    if (D.detailTier == null) D.detailTier = det.gearTier | 0;
    const wantTier = hard ? 2 : D.detailTier;
    const wantLegal = key === "junta" ? "junta" : hard ? "emergency" : "state";
    let changed = false;
    if ((det.gearTier | 0) !== wantTier) {
      det.gearTier = wantTier;
      const G = CBZ.protection.GEAR;
      if (G && G[wantTier]) det.wageRate = G[wantTier].wage;
      changed = true;
    }
    if (det.legalStatus !== wantLegal) { det.legalStatus = wantLegal; changed = true; }
    // Bodies already standing carry the OLD loadout. Dropping them makes the
    // next spawnMembers pass re-cut them with the new gear — protection.js's
    // own public despawn, not a poke at memberPedRefs.
    if (changed && CBZ.protection.despawnMembers) { try { CBZ.protection.despawnMembers(det); } catch (e) {} }
    return { id: det.id, gearTier: det.gearTier, legalStatus: det.legalStatus };
  }

  // ============================================================
  //  §9  THE PRESS. presidency's interior press corps is another file's; this
  //  is the one-line oracle it can read instead of duplicating the govType
  //  ladder. A dictatorship, a fascist state and a junta have no press pool
  //  in the hall; a crown and a people's state keep the cameras.
  // ============================================================
  function pressAllowed() {
    const k = D.key || read().key;
    return !(k === "dictatorship" || k === "fascism" || k === "junta");
  }

  // ============================================================
  //  §10 THE TICK. ~1 Hz, and the ONLY thing it does at speed is compare one
  //  string. Order 38.782 — measured by grep: 38.76 cashstore, 38.78
  //  presidency, 38.785 president_agenda, 38.79 construction, 38.8 empire.
  //  So this sits between presidency's own tick and the agenda's, and reads a
  //  status() that is already fresh this frame.
  //
  //  presidency.js also publishes an event bus, and `press("emergency")` /
  //  `press("doctrine")` / `press("crown")` are the exact orders that move
  //  govType. Subscribing does not replace the poll (regimes.js, crown.js and
  //  civilwar.js all flip govType with no order behind it) — it just collapses
  //  the up-to-one-second lag on the player's OWN button to a single frame.
  // ============================================================
  let t = 0, seen = false, lastDetail = null;
  if (CBZ.presidency && typeof CBZ.presidency.on === "function") {
    try {
      CBZ.presidency.on("order", function () { t = 99; });
      CBZ.presidency.on("sworn", function () { t = 99; });
    } catch (e) {}
  }
  if (CBZ.onUpdate) CBZ.onUpdate(38.782, function (dt) {
    if (!on() || !g) return;
    t += dt;
    if (t < 1.0) return;
    t = 0;
    // LEAVING CITY MODE DROPS THE DRESSING. The group is parented to the arena
    // root, which mode.js throws away; holding a reference to it (and to our
    // own geometries) past the exit is a leak, and re-entry rebuilds against
    // the new root anyway.
    if (g.mode !== "city") { if (D.group) { teardown(); D.key = null; } return; }
    if (!site()) return;

    const now = read();
    // A world rebuild replaces CBZ.govComplexes (and with it every offset we
    // solved against) and the arena root; re-hang against the new one.
    const stale = D.group && (D.builtFor !== CBZ.govComplexes ||
      (D.root && D.root !== ((CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene)));
    if (now.key === D.key && !stale) return;

    const from = D.key;
    // A throw here would take the whole updater chain down with it, and this
    // is decoration: the compound must never be able to stop the frame.
    try {
      if (!build(now.key, now.rec)) return;
    } catch (e) {
      try { console.error("[president_regime] dressing failed", e); } catch (e2) {}
      teardown(); D.key = null; return;
    }
    D.lastChangeDay = day();
    try { lastDetail = retintDetail(now.rec, now.key); } catch (e) { lastDetail = null; }
    // the hall's press pool follows the regime (interior_programs.js owns the rows)
    if (CBZ.presidentInteriorPressSet) { try { CBZ.presidentInteriorPressSet(pressAllowed()); } catch (e) {} }

    // ONE headline per real change. Booting straight into a save that is
    // already a dictatorship is not a change and does not get a headline.
    if (seen && from !== now.key && !stale) {
      if (now.key === "none") { big(RESTORED); feed("The banners come down at the Executive Mansion.", "#8fc1ff"); }
      else {
        const R = REGIME[now.key];
        big(R.headline);
        feed(R.note, "#ffd76a");
      }
    }
    seen = true;
  });

  // ============================================================
  //  §11 PUBLIC API + AUDIT
  // ============================================================
  function audit() {
    const now = read();
    return {
      govType: now.govType,
      mode: D.key || "none",
      seat: now.seat,
      pieces: D.pieces,
      colliders: D.cols.length,
      platforms: D.plats.length,
      lastChangeDay: D.lastChangeDay,
      pressAllowed: pressAllowed(),
      detail: lastDetail,
      dressed: !!D.group,
    };
  }
  CBZ.presidentRegime = {
    mode: function () { return D.key || "none"; },
    pressAllowed: pressAllowed,
    audit: audit,
    // harness/test hooks only — not part of the public contract
    _read: read, _build: build, _teardown: teardown, _dress: D,
  };
  CBZ.presidentRegimeAudit = audit;
})();
