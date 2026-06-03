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
      x.font = "bold 30px Fredoka, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = 6; x.strokeStyle = "rgba(0,0,0,.75)";
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
  // Billboards + bus-shelter ad panels + A-frame signs read from a tiny pool of
  // generated poster textures. One CanvasTexture per slogan, reused everywhere.
  const adCache = new Map();
  const AD_SLOGANS = [
    ["FLEECA", "your money, our problem", "#0a3d2c", "#37d39a"],
    ["SPRUNK", "drink the difference", "#0b2d6b", "#ffd23a"],
    ["eCola", "taste the corp", "#7a0d14", "#ffe9e9"],
    ["PISWASSER", "a real man's beer", "#5a3a12", "#f0c060"],
    ["VINEWOOD", "now casting nobodies", "#2a1133", "#ff7ad9"],
    ["LIFEINVADER", "stalk your friends", "#10202c", "#3fd0ff"],
    ["AMMU-NATION", "rights, ammo, more", "#1c1c1c", "#ff5a2c"],
    ["BIGNESS", "supersize your debt", "#3a0f0f", "#ffcf3a"],
    ["TINKLE", "smart-ish phones", "#062a2a", "#7affd0"],
    ["LOST MC", "ride or rot", "#101010", "#c0c0c0"],
  ];
  function adTexture(idx) {
    let t = adCache.get(idx);
    if (t) return t;
    const s = AD_SLOGANS[idx % AD_SLOGANS.length];
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = s[2]; x.fillRect(0, 0, 256, 128);
    // a stylised colour band + headline + small print
    x.fillStyle = "rgba(255,255,255,.08)"; x.fillRect(0, 14, 256, 4); x.fillRect(0, 110, 256, 4);
    x.fillStyle = s[3];
    x.font = "bold 40px Fredoka, Arial, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(s[0], 128, 52);
    x.fillStyle = "rgba(255,255,255,.85)";
    x.font = "16px Fredoka, Arial, sans-serif";
    x.fillText(s[1], 128, 90);
    t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    adCache.set(idx, t);
    return t;
  }
  // a board material per ad (so the poster glows a touch at night)
  const adMatCache = new Map();
  function adMat(idx) {
    let m = adMatCache.get(idx);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ map: adTexture(idx), emissive: 0xffffff, emissiveMap: adTexture(idx), emissiveIntensity: 0 });
      m._ad = true;
      adMatCache.set(idx, m);
    }
    return m;
  }

  CBZ.cityProps = function (city) {
    const root = city.root, rng = city.rng;
    city.streetProps = city.streetProps || [];
    // collected emissive props that should glow after dark (lamp heads, billboard
    // panels, shelter ad-lights, neon shop signs). Driven once/frame in city mode.
    const nightLamps = city._nightLamps = city._nightLamps || [];
    const nightAds = city._nightAds = city._nightAds || [];

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

    // ----- A-FRAME SIDEWALK SHOP SIGN (sandwich board) ---------------------
    function aFrameSign(x, z, yaw, adIdx) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const panelG = geo("aframePanel", () => new THREE.PlaneGeometry(0.7, 0.9));
      const front = new THREE.Mesh(panelG, adMat(adIdx));
      front.position.set(0, 0.55, 0.12); front.rotation.x = 0.18; g.add(front);
      const back = new THREE.Mesh(panelG, adMat((adIdx + 3) % AD_SLOGANS.length));
      back.position.set(0, 0.55, -0.12); back.rotation.x = -0.18; back.rotation.y = Math.PI; g.add(back);
      const footG = geo("aframeFoot", () => new THREE.BoxGeometry(0.74, 0.04, 0.5));
      const foot = new THREE.Mesh(footG, smat(0x2a2a2a)); foot.position.y = 0.02; g.add(foot);
      root.add(g);
      city.streetProps.push({ x, z, type: "sign" });  // light, no collider
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
      // lit advertising panel on one end (glows at night)
      const adIdx = (rng() * AD_SLOGANS.length) | 0;
      const ad = new THREE.Mesh(geo("shelterAd", () => new THREE.PlaneGeometry(1.0, 1.7)), adMat(adIdx));
      ad.position.set(1.74, 1.2, 0); ad.rotation.y = -Math.PI / 2; g.add(ad);
      nightAds.push(adMat(adIdx));
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
      const adIdx = (rng() * AD_SLOGANS.length) | 0;
      const boardG = geo("billBoard" + (big ? "B" : "S"), () => new THREE.PlaneGeometry(W, H));
      const front = new THREE.Mesh(boardG, adMat(adIdx)); front.position.set(0, post + H / 2, 0.18); g.add(front);
      const back = new THREE.Mesh(boardG, adMat((adIdx + 5) % AD_SLOGANS.length)); back.position.set(0, post + H / 2, -0.18); back.rotation.y = Math.PI; g.add(back);
      nightAds.push(adMat(adIdx), adMat((adIdx + 5) % AD_SLOGANS.length));
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
      // 6) an A-frame shop sign near a shop door
      if (lot.building && lot.building.shop && rng() < 0.7) {
        const d = lot.building.door;
        if (d) {
          const sx = d.x - d.nx * 3.2 + d.nz * 1.4, sz = d.z - d.nz * 3.2 - d.nx * 1.4;
          aFrameSign(sx, sz, Math.atan2(d.nx, d.nz) + Math.PI, (lotIdx * 3) % AD_SLOGANS.length);
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

    // ----- ROOFTOP AC UNITS, VENTS, water tanks ----------------------------
    // Building lots get a cluster of mechanical gear on the roof — pure silhouette
    // detail, no colliders. Read the building's footprint + height if present.
    const acM = smat(0x9aa0a8), ventM = smat(0x6a7079), tankM = smat(0x7a5a3a), pipeM = smat(0x4a4f57);
    for (const lot of lots) {
      const b = lot.building; if (!b) continue;
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
        if (t < 0.55) {
          const ac = new THREE.Mesh(geo("acUnit", () => new THREE.BoxGeometry(1.3, 0.7, 1.0)), acM);
          ac.position.set(ux, h + 0.35, uz); ac.castShadow = true; root.add(ac);
          const fan = new THREE.Mesh(geo("acFan", () => new THREE.CylinderGeometry(0.32, 0.32, 0.06, 8)), ventM);
          fan.position.set(ux, h + 0.72, uz); root.add(fan);
        } else if (t < 0.8) {
          const v = new THREE.Mesh(geo("roofVent", () => new THREE.CylinderGeometry(0.22, 0.26, 0.6, 7)), ventM);
          v.position.set(ux, h + 0.3, uz); root.add(v);
          const cap = new THREE.Mesh(geo("roofVentCap", () => new THREE.CylinderGeometry(0.3, 0.3, 0.12, 7)), pipeM);
          cap.position.set(ux, h + 0.62, uz); root.add(cap);
        } else {
          const tank = new THREE.Mesh(geo("roofTank", () => new THREE.CylinderGeometry(0.6, 0.6, 1.4, 9)), tankM);
          tank.position.set(ux, h + 0.9, uz); tank.castShadow = true; root.add(tank);
          for (let lg = 0; lg < 3; lg++) {
            const a = lg / 3 * 6.28;
            const leg = new THREE.Mesh(geo("tankLeg", () => new THREE.CylinderGeometry(0.05, 0.05, 0.5, 4)), pipeM);
            leg.position.set(ux + Math.cos(a) * 0.5, h + 0.25, uz + Math.sin(a) * 0.5); root.add(leg);
          }
        }
      }
      // a long roof-edge parapet vent pipe for taller buildings
      if (h > 14 && rng() < 0.5) {
        const pipe = new THREE.Mesh(geo("roofPipe", () => new THREE.CylinderGeometry(0.12, 0.12, 1.8, 6)), pipeM);
        pipe.position.set(rcx + halfW * 0.8, h + 0.9, rcz - halfD * 0.8); root.add(pipe);
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
  };
})();
