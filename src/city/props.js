/* ============================================================
   city/props.js — street furniture + traffic-light poles + a shared
   billboard-label helper. Hooked by world.js via CBZ.cityProps(city).

   Traffic lights are built here (one signal head per intersection
   approach) and attached to the intersection record; city/traffic.js
   drives their colour each frame and reads them for red-light tickets.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  // ---- shared cached label sprite (storefront signs, ped names, markers) ----
  const labelCache = new Map();
  CBZ.makeLabelSprite = function (text, opts) {
    opts = opts || {};
    const key = text + "|" + (opts.color || "#eef4ff");
    let m = labelCache.get(key);
    if (!m) {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 64;
      const x = c.getContext("2d");
      // auto-fit: long labels ("MOB BOSS · 24", storefront names) shrink to the
      // canvas instead of clipping at the edges. Cached per text, so it's free.
      let fs = 30;
      x.font = "bold 30px Fredoka, sans-serif";
      const tw = x.measureText(text).width;
      if (tw > 242) { fs = Math.max(16, Math.floor(30 * 242 / tw)); x.font = "bold " + fs + "px Fredoka, sans-serif"; }
      x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = Math.max(4, fs * 0.2); x.strokeStyle = "rgba(0,0,0,.75)";
      x.strokeText(text, 128, 34);
      x.fillStyle = opts.color || "#eef4ff";
      x.fillText(text, 128, 34);
      const tex = new THREE.CanvasTexture(c);
      m = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
      m._shared = true;
      labelCache.set(key, m);
    }
    const s = new THREE.Sprite(m);
    s.scale.set(4, 1, 1);
    return s;
  };

  // lamp emissive material factory
  function lampMat(color) { return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.2 }); }

  // ---- shared geometry / material caches ----------------------------------
  // Hundreds of props get placed, so EVERY repeated mesh must share one geometry
  // and one material instance. Build them lazily, key by a descriptive string,
  // and never dispose (they live for the whole run).
  const GEO = new Map();
  function geo(key, make) { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; }
  const MAT = new Map();
  function smat(color, opts) {
    opts = opts || {};
    const key = color + "|" + (opts.emissive || 0) + "|" + (opts.ei || 0) + "|" + (opts.rough || 0);
    let m = MAT.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      if (opts.emissive != null) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei || 0; }
      m._shared = true;
      MAT.set(key, m);
    }
    return m;
  }

  // ---- shared advertising / poster canvas textures ------------------------
  // Billboards + bus-shelter ad panels read from a pool of generated poster
  // textures. Content is RELEVANT to OUR city — the real gangs that hold turf,
  // the real shops you can walk into, mock local brands, our own radio stations,
  // and the occasional WANTED poster keyed to YOUR notoriety. One CanvasTexture
  // per ad, reused everywhere.
  //
  // Each ad entry: [HEADLINE, tagline, bgHex, fgHex, opts?]
  //   opts.kind  — "ad" (default) | "radio" | "gang" | "wanted" | "shop"
  //   opts.tag   — tiny corner label ("AD","FM","TURF","WANTED","NOW OPEN")
  // The gang ads pull their colours straight from CBZ.CITY.gangs so a Vipers
  // board is always Vipers-green; if the player founds/owns a gang we surface
  // that too. WANTED boards read the live wanted star count.

  function gangDefs() { return (CBZ.CITY && CBZ.CITY.gangs) || []; }
  function hex(n) { return "#" + ("000000" + ((n | 0) & 0xffffff).toString(16)).slice(-6); }
  // a darkened version of a colour for poster backgrounds (so the headline pops)
  function darken(n, f) {
    const r = ((n >> 16) & 255) * f, gg = ((n >> 8) & 255) * f, b = (n & 255) * f;
    return "#" + ("000000" + (((r << 16) | (gg << 8) | b) | 0).toString(16)).slice(-6);
  }

  // ---- STATIC pool: local brands, our shops, radio stations, gang slogans ----
  // Mock local brands + funny in-world ads (kept ours, not a clone — these tie
  // into things you actually do in the city: cash, guns, cars, drip, casino).
  const BRAND_ADS = [
    ["SPRUNK", "carbonated with regret", 0x0b2d6b, 0xffd23a],
    ["CLUCKIN' DINER", "27 herbs, 0 questions", 0x7a3a0d, 0xffce7a, { tag: "EAT" }],
    ["PISSWASSER", "the beer you've earned", 0x5a3a12, 0xf0c060],
    ["eCOLA", "now 30% more cola", 0x7a0d14, 0xffe9e9],
    ["VOLT ELECTRONICS", "phones smarter than you", 0x062a2a, 0x39d0c0],
    ["KEYSTONE REALTY", "own the block — press Z", 0x0d3a2c, 0x4fd0a0, { tag: "Z" }],
    ["GRAND CASINO", "the house misses you", 0x2a1a05, 0xc9a227],
    ["BIGNESS BURGER", "supersize your debt", 0x3a0f0f, 0xffcf3a],
    ["BENNY'S CHOP SHOP", "no plate? no problem", 0x2a2308, 0xd0a23c],
    ["IRON GYM", "lift heavy, hit harder", 0x0d2a26, 0x66d9c0],
    ["VINEWOOD", "now casting nobodies", 0x2a1133, 0xff7ad9],
    ["LIFEINVADER", "we already read this", 0x10202c, 0x3fd0ff],
  ];
  // Our shops you can literally walk into — "advertised" so the city points at them.
  const SHOP_ADS = [
    ["AMMU-NATION", "rights. ammo. respect.", 0x1c2414, 0xff5a2c, { tag: "GUNS" }],
    ["BLING JEWELERS", "drip = respect", 0x2a2205, 0xffe08a, { tag: "DRIP" }],
    ["THREADS & DRIP", "look like money", 0x2a113a, 0xc792ea, { tag: "FITS" }],
    ["PREMIUM AUTOS", "test drive forever", 0x2a1805, 0xe88a3c, { tag: "CARS" }],
    ["PAWN & LOAN", "we buy hot junk", 0x2a1c0d, 0xc89a5a, { tag: "FENCE" }],
    ["VELVET CLUB", "after dark, anything", 0x2a0d1a, 0xe85d8a, { tag: "OPEN" }],
    ["THE TRAP HOUSE", "ask for the special", 0x0d2a18, 0x4caf6e, { tag: "??" }],
    ["FRESH CUTS", "lineup of your life", 0x0d1f2a, 0x6bb6ff, { tag: "STYLE" }],
  ];
  // OUR radio dial — invented stations with our own DJ/flavour (in-world humour).
  const RADIO_ADS = [
    ["98.4 BLOK FM", "all trap, all turf", 0x140c2a, 0xb079ea, { kind: "radio", tag: "FM" }],
    ["K-RAGE 101.1", "drive angry", 0x2a0c0c, 0xff6a4a, { kind: "radio", tag: "FM" }],
    ["SIREN AM 88", "police scanner & jazz", 0x0c1a2a, 0x5b8bff, { kind: "radio", tag: "AM" }],
    ["LOWRIDE 96.9", "bounce all night", 0x0c2a1a, 0x49c46e, { kind: "radio", tag: "FM" }],
    ["GHOST CITY RADIO", "nobody's listening", 0x14171d, 0x9fb0c6, { kind: "radio", tag: "FM" }],
    ["VINEWOOD GOLD", "songs your boss likes", 0x2a2205, 0xf2c43d, { kind: "radio", tag: "AM" }],
  ];

  // a board material per ad-record (so each poster can glow a touch at night).
  // adMat now takes an ad ARRAY (not an index) and caches by a content key so
  // dynamic gang/wanted boards rebuild only when their text changes.
  const adCache = new Map();      // key -> CanvasTexture
  const adMatCache = new Map();   // key -> MeshLambertMaterial
  function adKey(ad) { return ad[0] + "|" + ad[1] + "|" + ((ad[4] && ad[4].kind) || "ad"); }

  function adTextureFor(ad) {
    const key = adKey(ad);
    let t = adCache.get(key);
    if (t) return t;
    const head = ad[0], tag = ad[1], bg = ad[2], fg = ad[3], opt = ad[4] || {};
    const kind = opt.kind || "ad";
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const x = c.getContext("2d");
    // background — a flat fill plus a subtle top/bottom gradient band so it
    // doesn't read as a single dead rectangle.
    const bgCss = typeof bg === "number" ? hex(bg) : bg;
    x.fillStyle = bgCss; x.fillRect(0, 0, 256, 128);
    x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(0, 0, 256, 26);
    x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(0, 104, 256, 24);
    const fgCss = typeof fg === "number" ? hex(fg) : fg;

    if (kind === "wanted") {
      // a mock police WANTED poster — big WANTED banner, the player's "name",
      // a star row for the live wanted level and a bounty.
      x.fillStyle = fgCss;
      x.font = "bold 30px Fredoka, Arial, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("✦ WANTED ✦", 128, 26);
      x.font = "bold 22px Fredoka, Arial, sans-serif";
      x.fillText(head, 128, 64);                 // headline = the perp line
      x.font = "16px Fredoka, Arial, sans-serif";
      x.fillStyle = "rgba(255,255,255,.92)";
      x.fillText(tag, 128, 96);                   // tagline = bounty line
    } else if (kind === "yours") {
      // the OWNER creative — gold double frame + a stylized mug (head, shades,
      // chain). city/adboard.js puts these up when YOU rent the board: the whole
      // money loop ends with the skyline wearing your name, so it must read as
      // YOURS from a block away, not as one more brand poster.
      x.strokeStyle = fgCss; x.lineWidth = 5; x.strokeRect(6, 6, 244, 116);
      x.lineWidth = 2; x.strokeRect(13, 13, 230, 102);
      x.fillStyle = fgCss;
      x.beginPath(); x.arc(44, 54, 18, 0, 6.3); x.fill();                 // head
      x.fillStyle = bgCss; x.fillRect(28, 45, 32, 8);                     // shades
      x.fillStyle = fgCss;
      for (let ci = 0; ci < 5; ci++) { x.beginPath(); x.arc(34 + ci * 5, 80 - Math.abs(ci - 2) * 2, 2.2, 0, 6.3); x.fill(); }  // chain
      // headline + tagline to the right of the face (shrink-to-fit)
      x.textAlign = "center"; x.textBaseline = "middle";
      let yfs = 26; x.font = "bold " + yfs + "px Fredoka, Arial, sans-serif";
      while (x.measureText(head).width > 158 && yfs > 13) { yfs -= 2; x.font = "bold " + yfs + "px Fredoka, Arial, sans-serif"; }
      x.fillText(head, 158, 50);
      x.font = "13px Fredoka, Arial, sans-serif";
      x.fillStyle = "rgba(255,255,255,.85)";
      x.fillText(tag, 158, 86);
      const yCorner = opt.tag || "YOURS";
      x.font = "bold 12px Fredoka, Arial, sans-serif";
      const ycw = x.measureText(yCorner).width + 12;
      x.fillStyle = fgCss; x.fillRect(256 - ycw - 10, 10, ycw, 16);
      x.fillStyle = bgCss; x.fillText(yCorner, 256 - ycw / 2 - 10, 18);
    } else {
      // accent rules + corner tag
      x.fillStyle = fgCss;
      x.fillRect(0, 14, 256, 3); x.fillRect(0, 110, 256, 3);
      // big headline
      x.font = "bold 38px Fredoka, Arial, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      // shrink long headlines to fit the board
      let fs = 38; x.font = "bold " + fs + "px Fredoka, Arial, sans-serif";
      while (x.measureText(head).width > 238 && fs > 18) { fs -= 2; x.font = "bold " + fs + "px Fredoka, Arial, sans-serif"; }
      x.fillText(head, 128, 52);
      x.fillStyle = "rgba(255,255,255,.88)";
      x.font = "16px Fredoka, Arial, sans-serif";
      x.fillText(tag, 128, 90);
      // corner tag chip (AD / FM / GUNS / TURF ...)
      const corner = opt.tag || (kind === "radio" ? "FM" : (kind === "gang" ? "TURF" : (kind === "shop" ? "OPEN" : "AD")));
      x.font = "bold 12px Fredoka, Arial, sans-serif";
      const cw = x.measureText(corner).width + 12;
      x.fillStyle = fgCss; x.fillRect(256 - cw - 6, 6, cw, 18);
      x.fillStyle = bgCss; x.textBaseline = "middle"; x.textAlign = "center";
      x.fillText(corner, 256 - cw / 2 - 6, 16);
    }
    t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    adCache.set(key, t);
    return t;
  }
  function adMatFor(ad) {
    const key = adKey(ad);
    let m = adMatCache.get(key);
    if (!m) {
      const tex = adTextureFor(ad);
      m = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
      m._ad = true;
      adMatCache.set(key, m);
    }
    return m;
  }
  // SHARED with city/adboard.js (the rentable-board market): the SAME cached
  // generator renders the player's own creatives, so a rented board looks
  // native to the city and costs zero extra materials when reused.
  CBZ.cityAdMatFor = adMatFor;
  CBZ.cityAdKey = adKey;

  // ---- a per-gang TURF board, coloured straight from the gang definition ----
  // Built on demand so the board always matches CBZ.CITY.gangs (and any gang
  // the player founds/recolours). Slogans are ours, not a clone.
  function gangAd(d) {
    const slogans = {
      vipers: "green means GO",
      kings: "ice in our veins",
      reapers: "steel never sleeps",
      saints: "pray we don't find you",
    };
    return [d.name.toUpperCase(), slogans[d.id] || "this block is ours", darken(d.color, 0.16), hex(d.color), { kind: "gang", tag: "TURF" }];
  }

  CBZ.cityProps = function (city) {
    const root = city.root, rng = city.rng;
    city.streetProps = city.streetProps || [];
    // collected emissive props that should glow after dark (lamp heads, billboard
    // panels, shelter ad-lights, neon shop signs). Driven once/frame in city mode.
    const nightLamps = city._nightLamps = city._nightLamps || [];
    const nightAds = city._nightAds = city._nightAds || [];
    // boards whose ad CONTENT is live (e.g. the player WANTED poster). Each
    // entry is { mesh, dyn, lastKey } so the driver re-skins only the few that
    // actually change, never every frame.
    const dynAds = city._dynAds = city._dynAds || [];
    // RENTABLE AD SURFACES — every billboard face / shelter panel / rooftop
    // board placed below registers here so city/adboard.js can put it on the
    // market (money → skyline visibility → show-off). Each record carries the
    // mesh(es) to re-skin, the walk-up point, the surface class for pricing,
    // and the original material(s) to restore when a lease lapses.
    const adBoards = CBZ.cityAdBoards = [];

    // ---- ad picker: bias gang/wanted boards where they belong --------------
    const gangAdRecords = gangDefs().map(gangAd);
    function gangNear(x, z) {
      // closest gang turf centre, if any registered (gangs.js sets gang.center)
      const list = CBZ.cityGangs || [];
      let best = null, bd = 70 * 70;
      for (const gg of list) {
        if (!gg.center) continue;
        const dx = gg.center.x - x, dz = gg.center.z - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = gg; }
      }
      return best;
    }
    // the live WANTED poster — reads the player's notoriety so the city literally
    // puts your face up as the heat climbs. Returns null when you're clean.
    const WANTED_NAMES = ["THE KINGPIN", "PUBLIC ENEMY", "THE GHOST", "THAT GUY", "THE MENACE"];
    function wantedAd() {
      const gm = CBZ.game; if (!gm) return null;
      const wl = (gm.wanted | 0);
      if (wl <= 0) return null;
      const stars = "★".repeat(Math.min(5, wl)) + "☆".repeat(Math.max(0, 5 - wl));
      const who = gm.playerGang && gm.playerGang.name ? gm.playerGang.name.toUpperCase() + " BOSS" : WANTED_NAMES[Math.min(WANTED_NAMES.length - 1, wl - 1)];
      const bounty = "BOUNTY $" + (wl * 2500 + (gm.cityKills | 0) * 250).toLocaleString() + "   " + stars;
      return [who, bounty, 0x1a0d0d, 0xffe2a0, { kind: "wanted", tag: "WANTED" }];
    }
    // returns an ad record for a board at (x,z): mostly static brand/shop/radio,
    // but a roadside board near a gang's turf shows THAT gang, and a fraction of
    // boards become live WANTED posters once you have heat. `register` lets the
    // caller flag a board as dynamic (gets re-skinned later).
    function pickAd(x, z, opts) {
      opts = opts || {};
      const r = rng();
      // 1 in ~7 big boards is a (potential) live WANTED poster
      if (opts.allowWanted && r < 0.14) {
        return { ad: wantedAd() || BRAND_ADS[(rng() * BRAND_ADS.length) | 0], dyn: "wanted" };
      }
      // near gang turf, prefer that gang's board
      const ng = gangNear(x, z);
      if (ng && rng() < 0.5) {
        const def = gangDefs().find((d) => d.id === ng.id);
        if (def) return { ad: gangAd(def), dyn: null };
      }
      // otherwise a weighted mix of our own world content
      const roll = rng();
      let pool;
      if (roll < 0.42) pool = BRAND_ADS;
      else if (roll < 0.72) pool = SHOP_ADS;
      else if (roll < 0.9) pool = RADIO_ADS;
      else pool = gangAdRecords.length ? gangAdRecords : BRAND_ADS;
      return { ad: pool[(rng() * pool.length) | 0] || BRAND_ADS[0], dyn: null };
    }

    // a tidy collider for solid props (cars crash, peds can't pass). noCam so the
    // chase camera never snaps in on a thin pole.
    function solidCollider(x, z, r, ref, noCam) {
      if (!CBZ.colliders) return;
      CBZ.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, ref, noCam: noCam !== false });
    }

    function doorLots() {
      const out = (city.lots || []).slice();
      if (city.annex && city.annex.lots) out.push.apply(out, city.annex.lots);
      return out;
    }
    function pointSegmentD2(px, pz, ax, az, bx, bz) {
      const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
      const den = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / den));
      const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
      return dx * dx + dz * dz;
    }
    // Door points sit just inside the room. Reserve the complete threshold and
    // exterior approach so a pole, bin or bench cannot visually block entry.
    function nearDoor(x, z, radius) {
      const r2 = radius * radius;
      for (const lot of doorLots()) {
        const d = lot.building && lot.building.door;
        if (!d) continue;
        const ex = d.x - d.nx * 4.8, ez = d.z - d.nz * 4.8;
        if (pointSegmentD2(x, z, d.x, d.z, ex, ez) < r2) return true;
      }
      return false;
    }

    // ---- traffic-light heads at every intersection ----
    // Each intersection gets one signal head on a pole; ns=true means the
    // head currently governs the north–south flow when green. We build a 3-lamp
    // head and stash the lamp meshes so traffic.js can recolour them.
    // A proper 4-way: each intersection gets a signal head for EACH axis,
    // placed on opposite corners and turned to face oncoming traffic, so the
    // cross street correctly shows RED while the main runs GREEN.
    function makeHead(px, pz, rotY) {
      const head = new THREE.Group();
      head.position.set(px, 0, pz); head.rotation.y = rotY;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 5.2, 8), mat(0x2c2f35));
      pole.position.y = 2.6; pole.castShadow = true; head.add(pole);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.6, 0.5), mat(0x1c1f24));
      box.position.set(0, 4.6, 0); head.add(box);
      const red = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampMat(0xff3b3b));
      const yel = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampMat(0xffcf3b));
      const grn = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), lampMat(0x39ff66));
      red.position.set(0, 5.1, 0.28); yel.position.set(0, 4.6, 0.28); grn.position.set(0, 4.1, 0.28);
      head.add(red, yel, grn);
      root.add(head);
      return { red, yel, grn };
    }
    const off = city.ROAD / 2 + 0.6;
    for (const it of city.intersections) {
      // head governing N–S travel (faces along z), on the +x/+z corner
      const ns = makeHead(it.x + off, it.z + off, 0);
      // head governing E–W travel (faces along x), on the -x/-z corner
      const ew = makeHead(it.x - off, it.z - off, Math.PI / 2);
      it.light = { ns, ew, head: ns, red: ns.red, yel: ns.yel, grn: ns.grn };
    }

    // ---- street lamps along the avenues ----
    // Roads span the whole map, so a lamp marched down a road's length will,
    // wherever it crosses a perpendicular street, land in the MIDDLE of that
    // cross-road. Skip any position that falls inside an intersection box
    // (within ROAD/2 + margin of a perpendicular road centre-line) so lamps
    // only ever stand on real sidewalk, never out in the traffic.
    const crossClear = city.ROAD / 2 + 1.6;
    const crossLines = (vertical) => (vertical ? (city.allZLines || city.zLines) : (city.allXLines || city.xLines));
    function inCrossRoad(t, vertical, road) {
      const lines = crossLines(vertical);
      const center = vertical ? road.z : road.x;
      const coord = center + t;            // t is measured from road centre
      for (const c of lines) if (Math.abs(coord - c) < crossClear) return true;
      return false;
    }
    // shared lamp-post geometry/material — a tall pole, a curved arm reaching out
    // over the road, and a cobra-head lamp facing DOWN (real LA streetlamp shape).
    const lampPoleG = geo("lampPole", () => new THREE.CylinderGeometry(0.11, 0.15, 5.6, 6));
    const lampArmG = geo("lampArm", () => new THREE.CylinderGeometry(0.07, 0.07, 1.6, 5));
    const lampHeadG = geo("lampHead", () => new THREE.BoxGeometry(0.34, 0.2, 0.7));
    const lampGlowG = geo("lampGlow", () => new THREE.PlaneGeometry(0.5, 0.5));
    const lampBaseG = geo("lampBase", () => new THREE.CylinderGeometry(0.26, 0.32, 0.5, 6));
    const poleM = smat(0x33373e), darkM = smat(0x1d2026);
    const headLampM = lampMat(0xffe9a8);          // shared, glow driven by night
    headLampM.emissiveIntensity = 0.0;
    const glowM = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    function makeLampPost(x, z, faceX, faceZ) {
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const ang = Math.atan2(faceX, faceZ);       // arm reaches toward road centre
      g.rotation.y = ang;
      const pole = new THREE.Mesh(lampPoleG, poleM); pole.position.y = 2.8; pole.castShadow = true; g.add(pole);
      const base = new THREE.Mesh(lampBaseG, darkM); base.position.y = 0.25; g.add(base);
      const arm = new THREE.Mesh(lampArmG, poleM); arm.rotation.z = Math.PI / 2; arm.position.set(0, 5.5, 0.7); g.add(arm);
      const head = new THREE.Mesh(lampHeadG, darkM); head.position.set(0, 5.45, 1.45); g.add(head);
      const bulb = new THREE.Mesh(geo("lampBulb", () => new THREE.BoxGeometry(0.22, 0.06, 0.5)), headLampM);
      bulb.position.set(0, 5.33, 1.45); g.add(bulb);
      const glow = new THREE.Mesh(lampGlowG, glowM); glow.rotation.x = -Math.PI / 2; glow.position.set(0, 5.27, 1.45); g.add(glow);
      root.add(g);
      solidCollider(x, z, 0.3, pole);
      nightLamps.push(glow);
      city.streetProps.push({ x, z, type: "lamp" });
      return g;
    }
    for (const r of city.roads) {
      const n = Math.max(2, Math.floor(r.len / 26));
      for (let i = 0; i <= n; i++) {
        const t = -r.len / 2 + i * (r.len / n);
        if (inCrossRoad(t, r.vertical, r)) continue;     // would sit in a cross-street
        const sgn = (i % 2 === 0 ? 1 : -1);
        const side = sgn * (city.ROAD / 2 + 1.0);
        const x = r.vertical ? r.x + side : r.x + t;
        const z = r.vertical ? r.z + t : r.z + side;
        if (Math.abs(x) > 9999) continue;
        if (nearDoor(x, z, 1.8)) continue;
        // arm reaches toward the road centre (opposite the sidewalk side)
        const fx = r.vertical ? -sgn : 0, fz = r.vertical ? 0 : -sgn;
        makeLampPost(x, z, fx, fz);
      }
    }

    // =====================================================================
    //  GTA-style street furniture. Real props that BELONG on a sidewalk and
    //  serve a function. Big ones (hydrants, mailboxes, bus shelters, billboards)
    //  get colliders; small decor (cones, meters, papers) does not so it never
    //  blocks pedestrians. Everything shares geometry + material.
    // =====================================================================

    // small helper: where a sidewalk edge sits, with a yaw facing the building
    // (so signs/meters face the street). edge 0..3 = N,S,W,E of a lot.
    function edgePoint(lot, edge, t, outBand) {
      const off = lot.w / 2 + (outBand == null ? 1.4 : outBand);
      if (edge === 0) return { x: lot.cx + t, z: lot.cz - off, yaw: 0 };
      if (edge === 1) return { x: lot.cx + t, z: lot.cz + off, yaw: Math.PI };
      if (edge === 2) return { x: lot.cx - off, z: lot.cz + t, yaw: Math.PI / 2 };
      return { x: lot.cx + off, z: lot.cz + t, yaw: -Math.PI / 2 };
    }

    // ----- FIRE HYDRANT: squat body, dome cap, two side outlets ------------
    const hydM = smat(0xd23b30), hydCapM = smat(0xf2c83a);
    function fireHydrant(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const body = new THREE.Mesh(geo("hydBody", () => new THREE.CylinderGeometry(0.17, 0.2, 0.62, 8)), hydM);
      body.position.y = 0.31; body.castShadow = true; g.add(body);
      const cap = new THREE.Mesh(geo("hydCap", () => new THREE.SphereGeometry(0.18, 8, 5, 0, 6.3, 0, 1.3)), hydCapM);
      cap.position.y = 0.62; g.add(cap);
      const noz = geo("hydNoz", () => new THREE.CylinderGeometry(0.07, 0.07, 0.2, 6));
      const n1 = new THREE.Mesh(noz, hydCapM); n1.rotation.z = Math.PI / 2; n1.position.set(0.2, 0.4, 0); g.add(n1);
      const n2 = new THREE.Mesh(noz, hydCapM); n2.rotation.x = Math.PI / 2; n2.position.set(0, 0.4, 0.2); g.add(n2);
      root.add(g);
      solidCollider(x, z, 0.26, body);
      city.streetProps.push({ x, z, type: "hydrant" });
    }

    // ----- MAILBOX: USPS-style blue drum letterbox on a foot ---------------
    const mailM = smat(0x2f6bd6), mailLegM = smat(0x21304a);
    function mailbox(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const drum = new THREE.Mesh(geo("mailDrum", () => {
        const gg = new THREE.CylinderGeometry(0.34, 0.34, 0.62, 10, 1, false, 0, Math.PI);
        gg.rotateZ(Math.PI / 2); return gg;
      }), mailM);
      drum.position.y = 1.05; drum.castShadow = true; g.add(drum);
      const front = new THREE.Mesh(geo("mailFront", () => new THREE.BoxGeometry(0.62, 0.7, 0.04)), mailM);
      front.position.set(0, 0.95, 0.34); g.add(front);
      const leg = geo("mailLeg", () => new THREE.BoxGeometry(0.08, 0.78, 0.08));
      for (const sx of [-0.22, 0.22]) { const l = new THREE.Mesh(leg, mailLegM); l.position.set(sx, 0.4, 0); g.add(l); }
      root.add(g);
      solidCollider(x, z, 0.36, drum);
      city.streetProps.push({ x, z, type: "mailbox" });
    }

    // ----- PUBLIC TRASH CAN: green mesh barrel + dome lid ------------------
    const canM = smat(0x356b3e), lidM = smat(0x223f28);
    function trashCan(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const barrel = new THREE.Mesh(geo("canBarrel", () => new THREE.CylinderGeometry(0.27, 0.23, 0.78, 8)), canM);
      barrel.position.y = 0.39; barrel.castShadow = true; g.add(barrel);
      const lid = new THREE.Mesh(geo("canLid", () => new THREE.CylinderGeometry(0.3, 0.27, 0.12, 8)), lidM);
      lid.position.y = 0.82; g.add(lid);
      root.add(g);
      city.streetProps.push({ x, z, type: "bin" });   // small, no collider
    }

    // ----- PARKING METER: post + head + tiny display -----------------------
    const meterPostM = smat(0x6a6f78), meterHeadM = smat(0x2a2d33), meterFaceM = smat(0x101216, { emissive: 0x39ff88, ei: 0.5 });
    function parkingMeter(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const post = new THREE.Mesh(geo("meterPost", () => new THREE.CylinderGeometry(0.05, 0.06, 1.2, 6)), meterPostM);
      post.position.y = 0.6; g.add(post);
      const head = new THREE.Mesh(geo("meterHead", () => new THREE.BoxGeometry(0.22, 0.34, 0.16)), meterHeadM);
      head.position.y = 1.32; g.add(head);
      const face = new THREE.Mesh(geo("meterFace", () => new THREE.PlaneGeometry(0.14, 0.1)), meterFaceM);
      face.position.set(0, 1.36, 0.085); g.add(face);
      root.add(g);
      city.streetProps.push({ x, z, type: "meter" });  // thin, no collider
    }

    // ----- NEWSPAPER / NEWS BOX: little coin-op vending box ----------------
    const NEWS_COLORS = [0xc23a3a, 0x2f78d6, 0xe0a020, 0x3a3f47, 0x2f9d5a];
    function newsBox(x, z, yaw, ci) {
      const m = smat(NEWS_COLORS[ci % NEWS_COLORS.length]);
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const body = new THREE.Mesh(geo("newsBody", () => new THREE.BoxGeometry(0.42, 0.78, 0.4)), m);
      body.position.y = 0.55; body.castShadow = true; g.add(body);
      const legG = geo("newsLeg", () => new THREE.BoxGeometry(0.05, 0.32, 0.05));
      for (const sx of [-0.16, 0.16]) for (const sz of [-0.13, 0.13]) { const l = new THREE.Mesh(legG, smat(0x202327)); l.position.set(sx, 0.16, sz); g.add(l); }
      const win = new THREE.Mesh(geo("newsWin", () => new THREE.PlaneGeometry(0.3, 0.4)), smat(0xdfe6ee));
      win.position.set(0, 0.62, 0.205); g.add(win);
      root.add(g);
      city.streetProps.push({ x, z, type: "newsbox" });
    }

    // ----- TRAFFIC CONE: orange cone + reflective collar -------------------
    const coneM = smat(0xff6a1a), coneBandM = smat(0xf0f0f0), coneBaseM = smat(0x2a1608);
    function trafficCone(x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const cone = new THREE.Mesh(geo("coneBody", () => new THREE.ConeGeometry(0.16, 0.5, 7)), coneM);
      cone.position.y = 0.27; cone.castShadow = true; g.add(cone);
      const band = new THREE.Mesh(geo("coneBand", () => new THREE.CylinderGeometry(0.13, 0.15, 0.07, 7)), coneBandM);
      band.position.y = 0.2; g.add(band);
      const base = new THREE.Mesh(geo("coneBase", () => new THREE.BoxGeometry(0.32, 0.04, 0.32)), coneBaseM);
      base.position.y = 0.02; g.add(base);
      root.add(g);   // decor, no collider
    }

    // ----- PLANTER + low-poly TREE -----------------------------------------
    const planterM = smat(0x8a7a64), soilM = smat(0x3a2a1c);
    const trunkM = smat(0x6e4a2c);
    const FOLIAGE = [smat(0x3f7d3a), smat(0x4f9942), smat(0x356e34), smat(0x5aa84c)];
    function planterTree(x, z, withTree) {
      const g = new THREE.Group(); g.position.set(x, 0, z);
      const box = new THREE.Mesh(geo("planterBox", () => new THREE.BoxGeometry(1.0, 0.42, 1.0)), planterM);
      box.position.y = 0.21; box.castShadow = true; g.add(box);
      const soil = new THREE.Mesh(geo("planterSoil", () => new THREE.BoxGeometry(0.86, 0.06, 0.86)), soilM);
      soil.position.y = 0.42; g.add(soil);
      if (withTree) {
        const trunk = new THREE.Mesh(geo("treeTrunk", () => new THREE.CylinderGeometry(0.1, 0.14, 1.5, 6)), trunkM);
        trunk.position.y = 1.15; trunk.castShadow = true; g.add(trunk);
        const fm = FOLIAGE[(rng() * FOLIAGE.length) | 0];
        // two stacked low-poly blobs for a stylised canopy
        const c1 = new THREE.Mesh(geo("treeCanopy1", () => new THREE.IcosahedronGeometry(0.82, 0)), fm);
        c1.position.y = 2.0; c1.castShadow = true; c1.scale.set(1, 0.85, 1); g.add(c1);
        const c2 = new THREE.Mesh(geo("treeCanopy2", () => new THREE.IcosahedronGeometry(0.55, 0)), fm);
        c2.position.set(0.25, 2.55, 0.1); g.add(c2);
        solidCollider(x, z, 0.5, trunk);
        city.streetProps.push({ x, z, type: "tree" });
      } else {
        // shrub planter: a couple of small bushes
        const sm = FOLIAGE[(rng() * FOLIAGE.length) | 0];
        const b1 = new THREE.Mesh(geo("shrub1", () => new THREE.IcosahedronGeometry(0.34, 0)), sm);
        b1.position.set(-0.18, 0.62, 0.1); b1.scale.y = 0.8; g.add(b1);
        const b2 = new THREE.Mesh(geo("shrub2", () => new THREE.IcosahedronGeometry(0.3, 0)), sm);
        b2.position.set(0.2, 0.6, -0.12); g.add(b2);
        solidCollider(x, z, 0.55, box);
        city.streetProps.push({ x, z, type: "planter" });
      }
    }

    // ----- A-FRAME SANDWICH BOARD (sparse generic only) --------------------
    // NOTE: per-shop sidewalk signs were REMOVED — the store's name now lives ON
    // the building facade (buildings agent), not on a board out on the kerb. We
    // keep a *sparse* sandwich board as generic street decor carrying a city
    // brand/radio ad, never a "this is shop X" sign in front of a door.
    function aFrameSign(x, z, yaw, ad) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const panelG = geo("aframePanel", () => new THREE.PlaneGeometry(0.7, 0.9));
      const front = new THREE.Mesh(panelG, adMatFor(ad));
      front.position.set(0, 0.55, 0.12); front.rotation.x = 0.18; g.add(front);
      const back = new THREE.Mesh(panelG, adMatFor(ad));
      back.position.set(0, 0.55, -0.12); back.rotation.x = -0.18; back.rotation.y = Math.PI; g.add(back);
      const footG = geo("aframeFoot", () => new THREE.BoxGeometry(0.74, 0.04, 0.5));
      const foot = new THREE.Mesh(footG, smat(0x2a2a2a)); foot.position.y = 0.02; g.add(foot);
      root.add(g);
      city.streetProps.push({ x, z, type: "sign" });  // light, no collider
    }

    // =====================================================================
    //  PER-SHOP SIDEWALK DRESSING — props that match the storefront's KIND.
    //  All share the geo()/smat() caches; small enough to skip colliders so
    //  they never trap a ped, and always placed off the door (caller guards
    //  with nearDoor). Branch picks one of these by lot.building.shop.kind.
    // =====================================================================

    // ----- PATIO SET: a round table, a tilted parasol + a couple of chairs --
    // (food / bar lots — a little outdoor seating spilling onto the kerb).
    const patioTopM = smat(0xb9c0c8), patioLegM = smat(0x55606b), chairM = smat(0x6a7280);
    const UMBRELLA = [smat(0xe05d5d), smat(0x4f9942), smat(0x2f78d6), smat(0xe0a020)];
    function patioSet(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const top = new THREE.Mesh(geo("patioTop", () => new THREE.CylinderGeometry(0.55, 0.55, 0.06, 12)), patioTopM);
      top.position.y = 0.74; top.castShadow = true; g.add(top);
      const stem = new THREE.Mesh(geo("patioStem", () => new THREE.CylinderGeometry(0.05, 0.05, 0.74, 6)), patioLegM);
      stem.position.y = 0.37; g.add(stem);
      // parasol pole + canopy (a shallow cone)
      const pole = new THREE.Mesh(geo("umbPole", () => new THREE.CylinderGeometry(0.035, 0.035, 2.0, 5)), patioLegM);
      pole.position.y = 1.0; g.add(pole);
      const canopy = new THREE.Mesh(geo("umbTop", () => new THREE.ConeGeometry(1.05, 0.5, 8)), UMBRELLA[(rng() * UMBRELLA.length) | 0]);
      canopy.position.y = 2.05; canopy.castShadow = true; g.add(canopy);
      const chairSeatG = geo("chairSeat", () => new THREE.BoxGeometry(0.4, 0.06, 0.4));
      const chairBackG = geo("chairBack", () => new THREE.BoxGeometry(0.4, 0.4, 0.05));
      for (const a of [0.6, 3.74]) {
        const cx = Math.cos(a) * 0.95, cz = Math.sin(a) * 0.95;
        const seat = new THREE.Mesh(chairSeatG, chairM); seat.position.set(cx, 0.42, cz); g.add(seat);
        const back = new THREE.Mesh(chairBackG, chairM); back.position.set(cx - Math.cos(a) * 0.2, 0.62, cz - Math.sin(a) * 0.2); back.rotation.y = a; g.add(back);
      }
      root.add(g);
      city.streetProps.push({ x, z, type: "patio" });   // soft furniture, no collider
    }

    // ----- BIKE RACK: a low U-loop rail (gym — somewhere to chain a bike) ----
    const bikeM = smat(0x8a9099);
    function bikeRack(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const railG = geo("bikeRail", () => new THREE.BoxGeometry(2.2, 0.07, 0.07));
      const legG = geo("bikeLeg", () => new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5));
      const rail = new THREE.Mesh(railG, bikeM); rail.position.y = 0.62; g.add(rail);
      for (const lx of [-1.0, -0.33, 0.33, 1.0]) { const l = new THREE.Mesh(legG, bikeM); l.position.set(lx, 0.31, 0); g.add(l); }
      // a couple of upright loops so it reads as a real rack
      const loopG = geo("bikeLoop", () => new THREE.TorusGeometry(0.28, 0.04, 5, 9, Math.PI));
      for (const lx of [-0.66, 0.66]) { const lp = new THREE.Mesh(loopG, bikeM); lp.position.set(lx, 0.62, 0); g.add(lp); }
      root.add(g);
      solidCollider(x, z, 0.4, rail);
      city.streetProps.push({ x, z, type: "bikerack" });
    }

    // ----- PROPANE CAGE: a steel cage of swap-out tanks (hardware lot) ------
    const cageM = smat(0x9a6a2a), tankPropM = smat(0xc23a3a), cageBarM = smat(0x4a4f57);
    function propaneCage(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const base = new THREE.Mesh(geo("cageBase", () => new THREE.BoxGeometry(1.4, 0.12, 0.8)), cageM);
      base.position.y = 0.06; base.castShadow = true; g.add(base);
      // a couple of propane bottles inside
      const tankG = geo("propaneTank", () => new THREE.CylinderGeometry(0.16, 0.16, 0.6, 8));
      for (const px of [-0.45, 0, 0.45]) { const tk = new THREE.Mesh(tankG, tankPropM); tk.position.set(px, 0.42, rng() < 0.5 ? -0.15 : 0.15); g.add(tk); }
      // cage bars (a top frame + corner posts) — reads as a locked rack
      const postG = geo("cagePost", () => new THREE.BoxGeometry(0.05, 0.95, 0.05));
      for (const px of [-0.68, 0.68]) for (const pz of [-0.36, 0.36]) { const p = new THREE.Mesh(postG, cageBarM); p.position.set(px, 0.5, pz); g.add(p); }
      const topG = geo("cageTop", () => new THREE.BoxGeometry(1.4, 0.05, 0.8));
      const topf = new THREE.Mesh(topG, cageBarM); topf.position.y = 0.96; g.add(topf);
      root.add(g);
      solidCollider(x, z, 0.55, base);
      city.streetProps.push({ x, z, type: "propane" });
    }

    // ----- PER-SHOP SANDWICH BOARD: an A-frame whose panel reflects the shop --
    // Unlike the sparse generic board, this one is keyed to the storefront's
    // kind so a diner shows a diner promo, a gym a gym promo, etc. It reuses the
    // cached adTextureFor() pipeline by composing a small per-kind ad record
    // (cached by content) — no per-frame work, no new canvas churn after first build.
    const SHOP_BOARD_AD = {
      food:     ["TODAY'S SPECIAL", "2-for-1 wings til 6", 0x7a3a0d, 0xffce7a, { tag: "EAT" }],
      bar:      ["HAPPY HOUR", "half off, all night", 0x2a0d1a, 0xe85d8a, { tag: "OPEN" }],
      gym:      ["FREE TRIAL WEEK", "lift heavy, hit harder", 0x0d2a26, 0x66d9c0, { tag: "GYM" }],
      hardware: ["TOOL SALE", "everything must go", 0x3a2a08, 0xffd166, { tag: "SALE" }],
      barber:   ["WALK-INS WELCOME", "lineup of your life", 0x0d1f2a, 0x6bb6ff, { tag: "STYLE" }],
      clothing: ["NEW DROP", "look like money", 0x2a113a, 0xc792ea, { tag: "FITS" }],
      jewelry:  ["BLOWOUT", "drip = respect", 0x2a2205, 0xffe08a, { tag: "DRIP" }],
      electronics: ["TRADE-IN", "phones smarter than you", 0x062a2a, 0x39d0c0, { tag: "TECH" }],
      guns:     ["RANGE OPEN", "rights. ammo. respect.", 0x1c2414, 0xff5a2c, { tag: "GUNS" }],
      pawn:     ["WE BUY GOLD", "we buy hot junk", 0x2a1c0d, 0xc89a5a, { tag: "CASH" }],
    };
    function shopBoard(x, z, yaw, kind) {
      const ad = SHOP_BOARD_AD[kind];
      if (!ad) return false;
      aFrameSign(x, z, yaw, ad);    // reuses the cached adMatFor()/adTextureFor()
      return true;
    }

    // ----- BUS-STOP SHELTER: posts, flat roof, bench, glass ad panel -------
    const shelterPostM = smat(0x3a3f47), shelterRoofM = smat(0x202327), glassM = new THREE.MeshLambertMaterial({ color: 0x9fc6e0, transparent: true, opacity: 0.28 });
    function busShelter(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const postG = geo("shelterPost", () => new THREE.BoxGeometry(0.1, 2.3, 0.1));
      for (const px of [-1.7, 1.7]) for (const pz of [-0.6, 0.6]) { const p = new THREE.Mesh(postG, shelterPostM); p.position.set(px, 1.15, pz); g.add(p); }
      const roof = new THREE.Mesh(geo("shelterRoof", () => new THREE.BoxGeometry(3.8, 0.12, 1.5)), shelterRoofM);
      roof.position.y = 2.35; roof.castShadow = true; g.add(roof);
      // back glass wall
      const back = new THREE.Mesh(geo("shelterGlass", () => new THREE.PlaneGeometry(3.4, 1.9)), glassM);
      back.position.set(0, 1.2, -0.6); g.add(back);
      // bench
      const bench = new THREE.Mesh(geo("shelterBench", () => new THREE.BoxGeometry(2.6, 0.1, 0.5)), smat(0x55606b));
      bench.position.set(0, 0.55, -0.35); bench.castShadow = true; g.add(bench);
      const legG = geo("shelterBenchLeg", () => new THREE.BoxGeometry(0.1, 0.5, 0.4));
      for (const lx of [-1.1, 1.1]) { const l = new THREE.Mesh(legG, shelterPostM); l.position.set(lx, 0.25, -0.35); g.add(l); }
      // lit advertising panel on one end (glows at night). Bus shelters carry
      // our brand/shop/radio + gang ads (no wanted posters at street level).
      const pick = pickAd(x, z, { allowWanted: false });
      const adM = adMatFor(pick.ad);
      const ad = new THREE.Mesh(geo("shelterAd", () => new THREE.PlaneGeometry(1.0, 1.7)), adM);
      ad.position.set(1.74, 1.2, 0); ad.rotation.y = -Math.PI / 2; g.add(ad);
      nightAds.push(adM);
      // rentable: walk-up point is the PANEL end of the shelter (world coords)
      adBoards.push({ mesh: ad, x: x + Math.cos(yaw) * 1.74, z: z - Math.sin(yaw) * 1.74, y: 0, kind: "shelter", mat0: adM });
      // bus-stop sign pole at the end
      const sp = new THREE.Mesh(geo("shelterSignPole", () => new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6)), shelterPostM);
      sp.position.set(2.1, 1.3, 0); g.add(sp);
      const sign = new THREE.Mesh(geo("shelterSign", () => new THREE.BoxGeometry(0.5, 0.5, 0.06)), smat(0x2f6bd6, { emissive: 0x2f6bd6, ei: 0.15 }));
      sign.position.set(2.1, 2.5, 0); g.add(sign);
      root.add(g);
      // colliders on the posts only (you can walk in, sit, take cover; cars crash the frame)
      solidCollider(x - Math.cos(yaw) * 1.7, z + Math.sin(yaw) * 1.7, 0.5, roof, false);
      solidCollider(x + Math.cos(yaw) * 1.7, z - Math.sin(yaw) * 1.7, 0.5, roof, false);
      city.streetProps.push({ x, z, type: "busstop" });
    }

    // ----- BILLBOARD: tall steel legs + a big lit ad board -----------------
    const billLegM = smat(0x4a4f57), billFrameM = smat(0x2a2d33);
    function billboard(x, z, yaw, big) {
      const W = big ? 8.5 : 6.0, H = big ? 4.2 : 3.0, post = big ? 8.0 : 6.5;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const legG = geo("billLeg" + (big ? "B" : "S"), () => new THREE.CylinderGeometry(0.22, 0.28, post, 7));
      for (const lx of [-W * 0.3, W * 0.3]) { const l = new THREE.Mesh(legG, billLegM); l.position.set(lx, post / 2, 0); l.castShadow = true; g.add(l); }
      // cross brace
      const brace = new THREE.Mesh(geo("billBrace" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W * 0.7, 0.16, 0.16)), billLegM);
      brace.position.set(0, post * 0.55, 0); g.add(brace);
      const frame = new THREE.Mesh(geo("billFrame" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W + 0.4, H + 0.4, 0.3)), billFrameM);
      frame.position.set(0, post + H / 2, 0); g.add(frame);
      // each face gets its OWN ad record. Big roadside boards may show a live
      // WANTED poster (your face goes up with your heat); both faces glow at night.
      const pickF = pickAd(x, z, { allowWanted: big });
      const pickB = pickAd(x, z, { allowWanted: false });
      const boardG = geo("billBoard" + (big ? "B" : "S"), () => new THREE.PlaneGeometry(W, H));
      const front = new THREE.Mesh(boardG, adMatFor(pickF.ad)); front.position.set(0, post + H / 2, 0.18); g.add(front);
      const back = new THREE.Mesh(boardG, adMatFor(pickB.ad)); back.position.set(0, post + H / 2, -0.18); back.rotation.y = Math.PI; g.add(back);
      nightAds.push(adMatFor(pickF.ad), adMatFor(pickB.ad));
      // register the front face if it's a live WANTED poster so the driver can
      // re-skin its material when the player's wanted level changes.
      if (pickF.dyn === "wanted") dynAds.push({ mesh: front, dyn: "wanted", lastKey: adKey(pickF.ad) });
      // rentable: a lease takes BOTH faces (the flex reads from either direction)
      adBoards.push({ mesh: front, mesh2: back, x, z, y: 0, kind: big ? "bill" : "small", mat0: adMatFor(pickF.ad), mat0b: adMatFor(pickB.ad) });
      // walkway light bar under the board
      const bar = new THREE.Mesh(geo("billBar" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W, 0.1, 0.4)), smat(0xfff4d0, { emissive: 0xfff4d0, ei: 0 }));
      bar.position.set(0, post - 0.1, 0.4); g.add(bar);
      nightLamps.push(bar);
      root.add(g);
      // two leg colliders so a car can smash into the billboard base
      solidCollider(x - Math.cos(yaw) * W * 0.3, z + Math.sin(yaw) * W * 0.3, 0.35, g, false);
      solidCollider(x + Math.cos(yaw) * W * 0.3, z - Math.sin(yaw) * W * 0.3, 0.35, g, false);
      city.streetProps.push({ x, z, type: "billboard" });
    }

    // =====================================================================
    //  PLACEMENT — march props around every block's sidewalk; bias the corners
    //  for hydrants/meters and put the bigger landmark props (shelters, big
    //  billboards) only where there's room (corner lots / wide frontage).
    // =====================================================================
    const lots = city.lots;
    let lotIdx = 0;
    for (const lot of lots) {
      lotIdx++;
      // 1) parking meters in a short row along ONE street-facing edge
      if (rng() < 0.6) {
        const edge = (rng() * 4) | 0;
        const meters = 2 + ((rng() * 3) | 0);
        const start = -(meters - 1) * 1.1;
        for (let m = 0; m < meters; m++) {
          const p = edgePoint(lot, edge, start + m * 2.2, 1.0);
          if (nearDoor(p.x, p.z, 1.8)) continue;
          parkingMeter(p.x, p.z, p.yaw);
        }
      }
      // 2) a hydrant near one corner
      if (rng() < 0.5) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.8, 1.2);
        if (!nearDoor(p.x, p.z, 2.0)) fireHydrant(p.x, p.z);
      }
      // 3) trash + news boxes near a corner (decor, no collide)
      if (rng() < 0.7) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.7, 1.1);
        if (!nearDoor(p.x, p.z, 1.6)) {
          if (rng() < 0.5) trashCan(p.x, p.z);
          else newsBox(p.x, p.z, p.yaw, (rng() * NEWS_COLORS.length) | 0);
        }
      }
      // 4) a mailbox
      if (rng() < 0.35) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.6, 1.3);
        if (!nearDoor(p.x, p.z, 2.2)) mailbox(p.x, p.z, p.yaw + Math.PI);
      }
      // 5) planters / street trees spaced along an edge
      if (rng() < 0.75) {
        const edge = (rng() * 4) | 0;
        const trees = 1 + ((rng() * 3) | 0);
        const start = -(trees - 1) * 2.2;
        for (let m = 0; m < trees; m++) {
          const p = edgePoint(lot, edge, start + m * 4.4 + (rng() - 0.5), 1.6);
          if (nearDoor(p.x, p.z, 2.4)) continue;
          planterTree(p.x, p.z, rng() < 0.65);
        }
      }
      // 6) RARELY a generic sandwich board out on the sidewalk (NOT a per-shop
      //    door sign — those are gone; the store name lives on the facade now).
      //    Carries a city brand/radio ad, placed on a clear kerb away from doors.
      if (rng() < 0.06) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.5, 1.2);
        if (!nearDoor(p.x, p.z, 2.6)) {
          const mix = rng() < 0.5 ? BRAND_ADS : RADIO_ADS;
          aFrameSign(p.x, p.z, p.yaw, mix[(rng() * mix.length) | 0]);
        }
      }
      // 7) a bus shelter occasionally, on a long clear edge
      if (rng() < 0.12) {
        const edge = (rng() * 4) | 0;
        const p = edgePoint(lot, edge, 0, 2.2);
        if (!nearDoor(p.x, p.z, 3.0) && Math.abs(p.x) < 9990) {
          const yaw = edge < 2 ? 0 : Math.PI / 2;
          busShelter(p.x, p.z, yaw + (edge === 0 || edge === 2 ? 0 : Math.PI));
        }
      }
      // 8) a few traffic cones in a little cluster (roadwork feel)
      if (rng() < 0.18) {
        const edge = (rng() * 4) | 0;
        const p0 = edgePoint(lot, edge, (rng() - 0.5) * lot.w * 0.6, 0.7);
        for (let c = 0; c < 3; c++) trafficCone(p0.x + (rng() - 0.5) * 1.2, p0.z + (rng() - 0.5) * 1.2);
      }
      // 9) PER-SHOP sidewalk dressing keyed to the storefront kind. Placed on the
      //    door-facing edge but OFFSET to the side of the door (so it dresses the
      //    frontage without ever blocking entry); nearDoor() is the final guard.
      const shop = lot.building && lot.building.shop;
      if (shop) {
        const kind = shop.kind;
        // the storefront edge (door side); offset the prop along it, away from centre.
        const sEdge = lot.building.side != null ? lot.building.side : (rng() * 4) | 0;
        const t = (rng() < 0.5 ? -1 : 1) * (lot.w * 0.26 + 1.0);   // off to one side of the door
        const place = (band, fn, prob) => {
          if (rng() >= prob) return;
          const p = edgePoint(lot, sEdge, t, band);
          if (Math.abs(p.x) > 9990 || nearDoor(p.x, p.z, 2.6)) return;
          fn(p.x, p.z, p.yaw);
        };
        if (kind === "food" || kind === "bar") {
          // a patio table out front + a matching sandwich board
          place(2.0, (x, z, yaw) => patioSet(x, z, yaw), 0.7);
          place(1.2, (x, z, yaw) => shopBoard(x, z, yaw, kind), 0.45);
        } else if (kind === "gym") {
          place(1.4, (x, z, yaw) => bikeRack(x, z, yaw), 0.7);
          place(1.2, (x, z, yaw) => shopBoard(x, z, yaw, kind), 0.4);
        } else if (kind === "hardware") {
          place(1.4, (x, z, yaw) => propaneCage(x, z, yaw), 0.7);
          place(1.2, (x, z, yaw) => shopBoard(x, z, yaw, kind), 0.4);
        } else {
          // every other storefront just gets the occasional per-shop board
          place(1.2, (x, z, yaw) => shopBoard(x, z, yaw, kind), 0.35);
        }
      }
    }

    // ----- BILLBOARDS on the perimeter wall + a few rooftops ---------------
    // Big roadside billboards face inward along the outer walls (you see them as
    // you drive the ring road); their legs sit just inside the sidewalk band.
    const mnX = city.minX, mxX = city.maxX, mnZ = city.minZ, mxZ = city.maxZ;
    const bbStepX = (mxX - mnX) / 4, bbStepZ = (mxZ - mnZ) / 4;
    for (let k = 1; k <= 3; k++) {
      // north & south walls
      billboard(mnX + bbStepX * k, mnZ + 6, 0, true);
      billboard(mnX + bbStepX * k, mxZ - 6, Math.PI, true);
      // west & east walls
      billboard(mnX + 6, mnZ + bbStepZ * k, Math.PI / 2, true);
      billboard(mxX - 6, mnZ + bbStepZ * k, -Math.PI / 2, k === 2 ? false : true);
    }

    // ----- CORE-AVENUE BILLBOARDS: the priciest faces in the city ----------
    // Perimeter boards only catch the ring road; the REAL eyeballs are on the
    // two central avenues. Stand a big board on each side of both, turned
    // square at oncoming traffic — these are the district-core surfaces
    // adboard.js prices at multiples of the docks (busyness = rent).
    const cAvX = (mnX + mxX) / 2, cAvZ = (mnZ + mxZ) / 2;
    let vAve = null, hAve = null, bvd = 1e9, bhd = 1e9;
    for (const r of city.roads) {
      if (r.vertical) { const d = Math.abs(r.x - cAvX); if (d < bvd) { bvd = d; vAve = r; } }
      else { const d = Math.abs(r.z - cAvZ); if (d < bhd) { bhd = d; hAve = r; } }
    }
    // a board may not stand inside a lot footprint (it would clip the facade)
    function insideLot(x, z) {
      for (const lot of doorLots()) {
        const hw = lot.w / 2 + 1.0, hd = (lot.d != null ? lot.d : lot.w) / 2 + 1.0;
        if (Math.abs(x - lot.cx) < hw && Math.abs(z - lot.cz) < hd) return true;
      }
      return false;
    }
    const coreBand = city.ROAD / 2 + 2.6;     // sidewalk stand-off from the kerb
    function coreBoard(road, s) {
      if (!road) return;
      // try a few stand-offs from the centre; take the first spot that's on
      // real sidewalk (not a cross-street, not a lot, not blocking a door).
      for (const t of [30, 44, 58]) {
        if (inCrossRoad(s * t, road.vertical, road)) continue;
        const bx = road.vertical ? road.x + s * coreBand : road.x + s * t;
        const bz = road.vertical ? road.z + s * t : road.z + s * coreBand;
        if (insideLot(bx, bz) || nearDoor(bx, bz, 4)) continue;
        const yaw = road.vertical ? (s > 0 ? -Math.PI / 2 : Math.PI / 2) : (s > 0 ? Math.PI : 0);
        billboard(bx, bz, yaw, true);
        return;
      }
    }
    for (const s of [-1, 1]) { coreBoard(vAve, s); coreBoard(hAve, s); }

    // ----- ROOFTOP DETAIL: AC, vents, tanks, dishes, stair-hut, skylights,
    //       antenna masts, parapet rails + a RARE rooftop billboard -----------
    // Building lots get a cluster of mechanical gear on the roof — pure silhouette
    // detail, no colliders. Everything reuses the shared geo()/smat() caches, so
    // a hundred roofs add geometry/material instances but stay draw-call cheap.
    // Budget stays a modest 2..5 units/roof; the bigger landmark pieces (stair
    // hut, billboard) are gated behind size/height + low odds so counts don't balloon.
    const acM = smat(0x9aa0a8), ventM = smat(0x6a7079), tankM = smat(0x7a5a3a), pipeM = smat(0x4a4f57);
    const dishM = smat(0xd7dade), hutM = smat(0x6b6f77), hutRoofM = smat(0x33373e);
    const railM = smat(0x42474f), mastM = smat(0x2c2f35), beaconM = lampMat(0xff3b3b);
    // skylight glass: a faint emissive pane so lit interiors read at night.
    const skyGlassM = smat(0x9fb6cc, { emissive: 0xbfe0ff, ei: 0.18 });
    skyGlassM._sky = true;
    nightAds.push(skyGlassM);   // ride the night driver's glow ramp (treated like an ad panel)

    // a satellite dish: a small mast, a shallow parabolic-ish bowl + feed arm.
    function roofDish(ux, uz, h) {
      const post = new THREE.Mesh(geo("dishPost", () => new THREE.CylinderGeometry(0.06, 0.06, 0.5, 5)), pipeM);
      post.position.set(ux, h + 0.25, uz); root.add(post);
      const bowl = new THREE.Mesh(geo("dishBowl", () => new THREE.SphereGeometry(0.42, 9, 6, 0, 6.3, 0, 0.9)), dishM);
      bowl.position.set(ux, h + 0.6, uz); bowl.rotation.x = -1.0; bowl.rotation.y = rng() * 6.28; root.add(bowl);
      const arm = new THREE.Mesh(geo("dishArm", () => new THREE.CylinderGeometry(0.025, 0.025, 0.4, 4)), pipeM);
      arm.position.set(ux, h + 0.7, uz); arm.rotation.x = 0.6; root.add(arm);
    }
    // a skylight: a low frame + an emissive glass quad facing up.
    function roofSkylight(ux, uz, h) {
      const frame = new THREE.Mesh(geo("skyFrame", () => new THREE.BoxGeometry(1.2, 0.14, 0.9)), hutRoofM);
      frame.position.set(ux, h + 0.07, uz); root.add(frame);
      const glass = new THREE.Mesh(geo("skyGlass", () => new THREE.PlaneGeometry(1.04, 0.74)), skyGlassM);
      glass.rotation.x = -Math.PI / 2; glass.position.set(ux, h + 0.15, uz); root.add(glass);
    }
    // an antenna mast: thin pole + a couple of cross arms (+ a red beacon up top).
    function roofMast(ux, uz, h) {
      const tall = 2.2 + rng() * 2.6;
      const pole = new THREE.Mesh(geo("mastPole", () => new THREE.CylinderGeometry(0.05, 0.07, 1, 5)), mastM);
      pole.scale.y = tall; pole.position.set(ux, h + tall / 2, uz); root.add(pole);
      const armG = geo("mastArm", () => new THREE.BoxGeometry(0.9, 0.04, 0.04));
      for (const fy of [0.55, 0.78]) {
        const arm = new THREE.Mesh(armG, mastM); arm.position.set(ux, h + tall * fy, uz); arm.rotation.y = rng() * 6.28; root.add(arm);
      }
      const beacon = new THREE.Mesh(geo("mastBeacon", () => new THREE.SphereGeometry(0.08, 6, 5)), beaconM);
      beacon.position.set(ux, h + tall + 0.06, uz); root.add(beacon);
      nightLamps.push(beacon);   // night driver pulses its emissive
    }
    for (const lot of lots) {
      const b = lot.building; if (!b || b.park) continue;   // parks carry a stub building (owner only) but have NO structure — no roof gear floats over them
      // roof height + extent + the gear-clear roof centre (away from the stairwell)
      const h = (b.h || b.height || (8 + (rng() * 14))) + 0.1;
      const rcx = b.roofCx != null ? b.roofCx : lot.cx;
      const rcz = b.roofCz != null ? b.roofCz : lot.cz;
      const halfW = (b.w ? b.w / 2 : lot.w / 2) - 1.5;
      const halfD = (b.d ? b.d / 2 : lot.d / 2) - 1.5;
      if (halfW < 1.5 || halfD < 1.5) continue;
      const units = 2 + ((rng() * 4) | 0);
      for (let u = 0; u < units; u++) {
        const ux = rcx + (rng() - 0.5) * halfW * 1.4;
        const uz = rcz + (rng() - 0.5) * halfD * 1.4;
        const t = rng();
        if (t < 0.40) {
          const ac = new THREE.Mesh(geo("acUnit", () => new THREE.BoxGeometry(1.3, 0.7, 1.0)), acM);
          ac.position.set(ux, h + 0.35, uz); ac.castShadow = true; root.add(ac);
          const fan = new THREE.Mesh(geo("acFan", () => new THREE.CylinderGeometry(0.32, 0.32, 0.06, 8)), ventM);
          fan.position.set(ux, h + 0.72, uz); root.add(fan);
        } else if (t < 0.58) {
          const v = new THREE.Mesh(geo("roofVent", () => new THREE.CylinderGeometry(0.22, 0.26, 0.6, 7)), ventM);
          v.position.set(ux, h + 0.3, uz); root.add(v);
          const cap = new THREE.Mesh(geo("roofVentCap", () => new THREE.CylinderGeometry(0.3, 0.3, 0.12, 7)), pipeM);
          cap.position.set(ux, h + 0.62, uz); root.add(cap);
        } else if (t < 0.72) {
          const tank = new THREE.Mesh(geo("roofTank", () => new THREE.CylinderGeometry(0.6, 0.6, 1.4, 9)), tankM);
          tank.position.set(ux, h + 0.9, uz); tank.castShadow = true; root.add(tank);
          for (let lg = 0; lg < 3; lg++) {
            const a = lg / 3 * 6.28;
            const leg = new THREE.Mesh(geo("tankLeg", () => new THREE.CylinderGeometry(0.05, 0.05, 0.5, 4)), pipeM);
            leg.position.set(ux + Math.cos(a) * 0.5, h + 0.25, uz + Math.sin(a) * 0.5); root.add(leg);
          }
        } else if (t < 0.85) {
          roofDish(ux, uz, h);
        } else if (t < 0.95) {
          roofSkylight(ux, uz, h);
        } else {
          roofMast(ux, uz, h);
        }
      }
      // a long roof-edge parapet vent pipe for taller buildings
      if (h > 14 && rng() < 0.5) {
        const pipe = new THREE.Mesh(geo("roofPipe", () => new THREE.CylinderGeometry(0.12, 0.12, 1.8, 6)), pipeM);
        pipe.position.set(rcx + halfW * 0.8, h + 0.9, rcz - halfD * 0.8); root.add(pipe);
      }
      // a roof-ACCESS STAIR HUT on bigger roofs (the bulkhead over the stairwell).
      // Sits toward a back corner so it never blocks the centre gear cluster.
      if (halfW > 3 && halfD > 3 && rng() < 0.45) {
        const hut = new THREE.Group();
        hut.position.set(rcx - halfW * 0.55, h, rcz - halfD * 0.55);
        const box = new THREE.Mesh(geo("roofHut", () => new THREE.BoxGeometry(2.2, 1.9, 1.8)), hutM);
        box.position.y = 0.95; box.castShadow = true; hut.add(box);
        const cap = new THREE.Mesh(geo("roofHutRoof", () => new THREE.BoxGeometry(2.5, 0.16, 2.1)), hutRoofM);
        cap.position.y = 1.95; hut.add(cap);
        const door = new THREE.Mesh(geo("roofHutDoor", () => new THREE.PlaneGeometry(0.7, 1.4)), smat(0x23262b));
        door.position.set(0, 0.72, 0.91); hut.add(door);
        root.add(hut);
      }
      // PARAPET-RAILING SLATS — a top rail + vertical slats around the roof rim,
      // built as ONE merged-look run per edge using shared slat geometry. Modest
      // slat spacing keeps the count sane; only on roomy roofs.
      if (halfW > 2.5 && halfD > 2.5 && rng() < 0.6) {
        const railTopG = geo("railTopX", () => new THREE.BoxGeometry(1, 0.06, 0.06));
        const railTopZG = geo("railTopZ", () => new THREE.BoxGeometry(0.06, 0.06, 1));
        const slatG = geo("railSlat", () => new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4));
        const railY = h + 0.55;
        // top rails (scaled to each side's span)
        const rN = new THREE.Mesh(railTopG, railM); rN.scale.x = halfW * 2; rN.position.set(rcx, railY, rcz - halfD); root.add(rN);
        const rS = new THREE.Mesh(railTopG, railM); rS.scale.x = halfW * 2; rS.position.set(rcx, railY, rcz + halfD); root.add(rS);
        const rW = new THREE.Mesh(railTopZG, railM); rW.scale.z = halfD * 2; rW.position.set(rcx - halfW, railY, rcz); root.add(rW);
        const rE = new THREE.Mesh(railTopZG, railM); rE.scale.z = halfD * 2; rE.position.set(rcx + halfW, railY, rcz); root.add(rE);
        // vertical slats along N & S edges (spaced ~1.4u, capped at a handful)
        const nSlat = Math.min(10, Math.max(2, Math.floor(halfW * 2 / 1.4)));
        for (let s = 0; s <= nSlat; s++) {
          const sx = rcx - halfW + (s / nSlat) * halfW * 2;
          const a = new THREE.Mesh(slatG, railM); a.position.set(sx, h + 0.3, rcz - halfD); root.add(a);
          const c = new THREE.Mesh(slatG, railM); c.position.set(sx, h + 0.3, rcz + halfD); root.add(c);
        }
      }
      // a RARE rooftop BILLBOARD on tall buildings — a small framed lit ad board
      // standing on the roof, angled to face the street. Big landmark, low odds.
      if (h > 18 && halfW > 3.5 && halfD > 3.5 && rng() < 0.12) {
        const bg = new THREE.Group();
        bg.position.set(rcx, h, rcz + halfD * 0.4);
        bg.rotation.y = rng() < 0.5 ? 0 : Math.PI;
        const legG = geo("roofBillLeg", () => new THREE.CylinderGeometry(0.12, 0.15, 2.4, 6));
        for (const lx of [-2.4, 2.4]) { const l = new THREE.Mesh(legG, billLegM); l.position.set(lx, 1.2, 0); l.castShadow = true; bg.add(l); }
        const frame = new THREE.Mesh(geo("roofBillFrame", () => new THREE.BoxGeometry(6.4, 2.8, 0.25)), billFrameM);
        frame.position.set(0, 3.4, 0); bg.add(frame);
        const pick = pickAd(rcx, rcz, { allowWanted: true });
        const adM = adMatFor(pick.ad);
        const board = new THREE.Mesh(geo("roofBillBoard", () => new THREE.PlaneGeometry(6.0, 2.4)), adM);
        board.position.set(0, 3.4, 0.14); bg.add(board);
        nightAds.push(adM);
        if (pick.dyn === "wanted") dynAds.push({ mesh: board, dyn: "wanted", lastKey: adKey(pick.ad) });
        // rentable from THIS roof (y gates the walk-up): the apex flex — your
        // name over the skyline, reachable via the building's elevator.
        adBoards.push({ mesh: board, x: bg.position.x, z: bg.position.z, y: h, kind: "roof", mat0: adM });
        root.add(bg);
      }
    }

    // =====================================================================
    //  NIGHT DRIVER — lamp heads glow + billboards/ad panels self-illuminate
    //  after dark. Reads CBZ.nightAmount (0 day .. 1 deep night) set by
    //  core/daynight.js. City mode only; cheap (a handful of material writes
    //  ramped over a couple seconds, not per-prop work every frame).
    // =====================================================================
    if (CBZ.onAlways && !city._propNightHooked) {
      city._propNightHooked = true;
      let lastN = -1;
      CBZ.onAlways(7, function () {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
        if (Math.abs(n - lastN) < 0.02) return;     // only touch materials on real change
        lastN = n;
        const on = n;                               // 0..1
        headLampM.emissiveIntensity = 0.05 + on * 0.95;
        glowM.opacity = on * 0.55;
        for (const glow of nightLamps) { if (glow.material === glowM) continue; if (glow.material.emissive) glow.material.emissiveIntensity = on * 0.9; }
        for (const am of nightAds) { am.emissiveIntensity = 0.06 + on * 0.6; }
      });
    }

    // =====================================================================
    //  LIVE WANTED-POSTER DRIVER — re-skins the handful of billboards that
    //  carry a WANTED poster whenever your wanted level (or kill count) shifts.
    //  Runs at ~1 Hz, only swaps a material map on the rare boards that change,
    //  so it costs nothing the rest of the time. City mode only.
    // =====================================================================
    if (CBZ.onAlways && dynAds.length && !city._propWantedHooked) {
      city._propWantedHooked = true;
      let acc = 0, lastSig = "";
      CBZ.onAlways(8, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        acc += (dt || 0.016);
        if (acc < 1.0) return; acc = 0;
        const sig = (g.wanted | 0) + ":" + (g.cityKills | 0) + ":" + (g.playerGang && g.playerGang.name || "");
        if (sig === lastSig) return;                // nothing the posters care about changed
        lastSig = sig;
        const wAd = wantedAd();
        const fallback = BRAND_ADS[0];
        const ad = wAd || fallback;                 // clean record → generic brand
        const mat2 = adMatFor(ad);
        const lit = (CBZ.nightAmount == null ? 0 : CBZ.nightAmount);
        for (const e of dynAds) {
          if (e.dyn !== "wanted") continue;
          if (e.mesh.userData.adLease) continue;    // the player RENTS this face (adboard.js) — their creative outranks the precinct's poster
          const key = adKey(ad);
          if (key === e.lastKey) continue;          // this board already shows it
          e.lastKey = key;
          e.mesh.material = mat2;                   // swap to the live poster material
          mat2.emissiveIntensity = 0.06 + lit * 0.6;
          if (nightAds.indexOf(mat2) < 0) nightAds.push(mat2);
        }
      });
    }
  };
})();
