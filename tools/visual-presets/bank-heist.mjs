/* Bank-vault comparison studio — the strongroom, the door and physical money.

   THE CHANGE BEING PHOTOGRAPHED. The deployed page's bank has a teller counter
   and, at the back, THREE BOXES that city/bank.js's own comment calls "set
   dressing": a 2.0x2.4x0.5 slab, a 1.5x1.8x0.14 "door" that has never moved in
   its life, and a 0.3 brass hub. There is nothing behind them — no room, no
   shelves, no money — and the only way the game acknowledged the vault at all
   was heists.js's nine-second drill bar. Money in that build is a number: the
   armoured truck's spill is the one physical cash mesh in the game and it
   converts to wallet cash the instant you walk over it.

   The local page has CBZ.cityVaultRoom (a partition, a strongroom, a 0.42 m
   leaf on a hinge column with boltwork and a handwheel), CBZ.cashBags
   (duffels you pick up, carry, throw and drop) and the moneybag item asset.

   HOW BOTH SIDES ARE STAGED HONESTLY. This is the interiors.mjs studio
   pattern: one renderer per page, our own group, and — critically — the
   AFTER side calls THE REAL BUILDER. `cityVaultRoom` only wants a `building`
   record with an `lbox` sink, so we hand it a synthetic shell whose lbox draws
   into this studio. Nothing is re-drawn by the storyboard; if the shipped
   builder is wrong, the plate is wrong, which is the only useful kind of
   screenshot. The BEFORE side has no such function, so it stages the deployed
   set-dressing prop from that build's own numbers — and every subject
   FEATURE-DETECTS by measuring rather than by trusting a version string.

   The colliders and the arena-root parenting the real builder performs are
   captured and undone per subject, so a studio page never accumulates them. */

const subjects = [
  {
    id: "teller-lobby",
    label: "The Banking Hall",
    kind: "lobby",
    focus: "Real tellers behind the glass with a real drawer balance, and the staff gap in the counter that makes the vault reachable at all.",
  },
  {
    id: "vault-door-closed",
    label: "The Vault Door — Shut",
    kind: "vault",
    focus: "BEFORE: three boxes the file itself calls set dressing. AFTER: a 0.42 m leaf, hinge column, boltwork and handwheel, with a collider that is what 'locked' means.",
  },
  {
    id: "vault-room-open",
    label: "The Strongroom — Open",
    kind: "vault",
    focus: "THE MONEY SHOT. The door has swung and there is a REAL ROOM behind it: shelving, banded bricks, a trolley, a strip light — and duffels on the floor you carry out one at a time.",
  },
  {
    id: "cash-bag",
    label: "The Money Bag",
    kind: "asset",
    focus: "The asset up close. Two webbing handles standing off the top, an unzipped mouth with banded notes showing, a shoulder strap — readable as a bag of money from across a dark room.",
  },
  {
    id: "bag-carried",
    label: "Hauling It Out",
    kind: "carry",
    focus: "The rig with the duffel on its shoulder and the haul pose driving the arms. The deployed build has no bag, no pose, and no way to hold one.",
  },
  {
    id: "casino-count-room",
    label: "The Casino Count Room",
    kind: "vault",
    focus: "The same builder, one spec object, behind the cashier cage — the owner's 'these real full vaults should be in casinos too', at zero new geometry.",
  },
];

function stageVault(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  if (!T || !CBZ) return { ok: false, missing: "no-three-or-cbz" };
  const S = input.subject;
  const HALF_PI = Math.PI / 2;
  const round = function (v, n) {
    const k = Math.pow(10, n == null ? 3 : n);
    return Number.isFinite(v) ? Math.round(v * k) / k : 0;
  };
  const money = function (n) { return "$" + Math.round(n || 0).toLocaleString("en-US"); };

  // ---- the studio: one renderer + overlay per page, reused by every subject
  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#0b0e13";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#0b0e13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    renderer.domElement.style.cssText = "display:block;width:" + input.width + "px;height:" + input.height + "px";
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f4f1ea;text-shadow:0 2px 9px #000;z-index:5";
    overlay.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-state></div><div data-detail></div><div data-source></div>";
    document.body.appendChild(overlay);
    studio = window.__cbzVisualCompare = { renderer, overlay, scene: null, camera: null, mats: null, features: null };
    studio.render = function () {
      if (studio.scene && studio.camera) studio.renderer.render(studio.scene, studio.camera);
    };
  }
  if (!studio.mats) studio.mats = new Map();

  const material = function (color, o) {
    const c = Number(color == null ? 0x8a8f96 : color);
    const em = (o && o.emissive != null) ? Number(o.emissive) : -1;
    const ei = (o && o.ei != null) ? Number(o.ei) : 0;
    // THE TELLER GLASS HAS TO BE GLASS. In the live game this box goes to
    // CBZ.cityRegisterGlass, which owns the transparency; in a studio it is a
    // plain lbox, and drawing it opaque hid every teller behind their own
    // window on the first plate — a picture of the room without the people in
    // it, which is the exact opposite of what this subject is about.
    const glass = !!(o && o.glass);
    const key = c + "|" + em + "|" + ei + "|" + (glass ? 1 : 0);
    if (!studio.mats.has(key)) {
      const spec = { color: c, roughness: 0.78, metalness: 0.12, flatShading: false };
      if (em >= 0) { spec.emissive = em; spec.emissiveIntensity = ei; }
      if (glass) { spec.transparent = true; spec.opacity = 0.22; spec.roughness = 0.12; spec.metalness = 0.0; }
      studio.mats.set(key, new T.MeshStandardMaterial(spec));
    }
    return studio.mats.get(key);
  };

  const stagegroup = new T.Group();
  let boxes = 0;
  const drawBox = function (x, y, z, w, h, d, color, o) {
    const mesh = new T.Mesh(
      new T.BoxGeometry(Math.abs(w) || 0.01, Math.abs(h) || 0.01, Math.abs(d) || 0.01),
      material(color, o)
    );
    mesh.position.set(x, y, z);
    stagegroup.add(mesh);
    boxes++;
    return mesh;
  };

  /* ---- FEATURE DETECTION, MEASURED ----------------------------------------
     Every claim is tested by BUILDING the thing and looking at what came back,
     never by reading a version. `moneybag` is proved by asking the item-asset
     registry for that kind and checking the object it hands back is not the
     generic parcel fallback; `vaultRoom` by the function's existence AND by a
     later staging actually producing a swinging pivot; `haulPose` by ticking
     two identical rigs one pose apart and diffing their joints. */
  const person = function (tint) {
    if (!CBZ.makeCharacter) return null;
    return CBZ.makeCharacter({
      skin: 0xc08a63, torso: tint, collar: tint, arms: tint,
      legs: 0x232833, shoes: 0x1a1714, hair: 0x2b1d12,
    });
  };
  const tick = function (ch, n) {
    if (!ch || !CBZ.animChar) return;
    const count = n == null ? 90 : n;
    for (let i = 0; i < count; i++) CBZ.animChar(ch, 0, 1 / 60);
  };
  if (!studio.features) {
    const sig = function (ch) {
      const j = ch.low || {}, p = ch.parts || {};
      return [
        p.la ? p.la.rotation.x : 0, p.la ? p.la.rotation.z : 0,
        p.ra ? p.ra.rotation.x : 0, p.ra ? p.ra.rotation.z : 0,
        j.la ? j.la.rotation.x : 0, j.ra ? j.ra.rotation.x : 0,
      ];
    };
    const spread = function (a, b) {
      let m = 0;
      for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
      return m;
    };
    /* TWO OF THESE PROBES WERE WRONG ON THE FIRST PAIRED RUN AND BOTH FAILED
       THE SAME WAY — they measured a SIDE EFFECT of asking for something that
       does not exist, and read the side effect as the thing existing.

       (1) `itemAsset(null,null,{kind:"moneybag"})` stamps
           `userData.itemAsset = kind` whatever happens, and silently falls back
           to the `parcel` builder for an unknown kind. So the deployed build
           cheerfully reported "moneybag". The honest test asks for a kind that
           CANNOT exist as well, and compares: if a money bag and a nonsense
           string build the same object, neither is a money bag.
       (2) Setting `ch.pose = "haul"` on a build with no such pose makes
           animChar skip its arm pass entirely, which moves the joints A LOT —
           1.55 rad of "difference" that is the absence of the feature, not the
           feature. The registry is unambiguous, so it is the primary test and
           the joint delta is only reported beside it. */
    const shapeOf = function (o) {
      if (!o) return "";
      let n = 0;
      o.traverse(function (m) { if (m.isMesh) n++; });
      o.updateMatrixWorld(true);
      const bb = new T.Box3().setFromObject(o);
      return n + ":" + round(bb.max.x - bb.min.x, 2) + "," + round(bb.max.y - bb.min.y, 2) + "," + round(bb.max.z - bb.min.z, 2);
    };
    let bagShape = "", nullShape = "";
    if (CBZ.itemAsset) {
      try { bagShape = shapeOf(CBZ.itemAsset(null, null, { kind: "moneybag" })); } catch (e) { bagShape = ""; }
      try { nullShape = shapeOf(CBZ.itemAsset(null, null, { kind: "__no_such_kind__" })); } catch (e) { nullShape = ""; }
    }
    const hasMoneybag = !!bagShape && bagShape !== nullShape;
    const hasHaul = !!(CBZ.charPoses && typeof CBZ.charPoses.haul === "function");
    let haulDelta = 0;
    if (hasHaul && CBZ.makeCharacter && CBZ.animChar) {
      const plain = person(0x3d6ea8); tick(plain, 60);
      const hauling = person(0x3d6ea8);
      if (CBZ.setCharPose) { try { CBZ.setCharPose(hauling, "haul"); } catch (e) {} }
      tick(hauling, 60);
      haulDelta = spread(sig(plain), sig(hauling));
    }
    studio.features = {
      vaultRoom: typeof CBZ.cityVaultRoom === "function",
      cashBags: !!(CBZ.cashBags && CBZ.cashBags.spawn),
      moneybag: hasMoneybag,
      haulPose: hasHaul,
      haulDelta: round(haulDelta, 4),
      tellerTrade: !!(CBZ.cityStaffTrades && CBZ.cityStaffTrades["bank teller"]),
      vaultTier: !!(CBZ.cityTill && CBZ.cityTill.vaultTier),
      bagAsset: hasMoneybag ? "moneybag" : (bagShape ? "parcel-fallback" : "none"),
    };
  }
  const feat = studio.features;

  /* ---- THE SYNTHETIC SHELL --------------------------------------------------
     cityVaultRoom asks a building for six things: w, d, wt, ox, oz, door and an
     `lbox(lx,ly,lz,w,h,d,color,opts)` sink. That is the whole contract, so a
     studio can satisfy it honestly and get the REAL room back. `ox/oz = 0`
     keeps everything in studio coordinates. We also snapshot CBZ.colliders and
     the arena root so the builder's real side effects can be undone. */
  const SHELL = { w: 15, d: 13, wt: 0.3 };
  const takenColliders = [];
  const adopted = [];
  const makeShell = function (name) {
    return {
      name: name, w: SHELL.w, d: SHELL.d, wt: SHELL.wt,
      ox: 0, oz: 0, floorTops: [0], storeys: 2,
      door: { nx: 0, nz: -1, x: 0, z: -SHELL.d / 2 },
      lbox: function (lx, ly, lz, bw, bh, bd, col, o) {
        return drawBox(lx, ly, lz, bw, bh, bd, col, o);
      },
    };
  };
  const buildVault = function (spec) {
    if (!feat.vaultRoom) return null;
    const lot = { cx: 0, cz: 0, w: SHELL.w, d: SHELL.d, kind: spec.kind === "casino" ? "casino" : "bank",
                  building: makeShell(spec.name) };
    const colBefore = (CBZ.colliders && CBZ.colliders.length) || 0;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    const kidsBefore = root ? root.children.length : 0;
    let v = null;
    try { v = CBZ.cityVaultRoom(lot, spec); } catch (e) { v = null; }
    // reclaim the builder's real side effects into the studio
    if (CBZ.colliders && CBZ.colliders.length > colBefore) {
      for (let i = CBZ.colliders.length - 1; i >= colBefore; i--) takenColliders.push(CBZ.colliders.splice(i, 1)[0]);
    }
    if (root && root.children.length > kidsBefore) {
      for (let i = root.children.length - 1; i >= kidsBefore; i--) {
        const kid = root.children[i];
        root.remove(kid);
        stagegroup.add(kid);
        adopted.push(kid);
      }
    }
    return v;
  };

  /* THE DEPLOYED VAULT, drawn from city/bank.js's own shipped numbers. This is
     the honest BEFORE and it is deliberately exactly three boxes plus the hub —
     if it looks thin, that is the finding, not the staging. */
  const buildSetDressing = function () {
    drawBox(0, 1.2, 0, 2.0, 2.4, 0.5, 0x39414d);          // vbody
    drawBox(0, 1.1, -0.22, 1.5, 1.8, 0.14, 0x6a7480);     // vdoor
    drawBox(0, 1.1, -0.28, 0.3, 0.3, 0.14, 0xcaa64a);     // hub
    return null;
  };

  // a plain teller counter, identical on both sides except for the staff gap
  const counterRun = function (z, len, gapLat, gapW) {
    const runs = (gapLat == null)
      ? [{ lat: 0, len: len }]
      : [{ lat: (-len / 2 + (gapLat - gapW / 2)) / 2, len: Math.max(0, (gapLat - gapW / 2) + len / 2) },
         { lat: ((gapLat + gapW / 2) + len / 2) / 2, len: Math.max(0, len / 2 - (gapLat + gapW / 2)) }];
    let drawn = 0;
    for (const r of runs) {
      if (r.len < 0.35) continue;
      drawBox(r.lat, 0.55, z, r.len, 1.1, 0.7, 0x394250);
      drawBox(r.lat, 1.13, z, r.len + 0.08, 0.06, 0.78, 0xcaa64a);
      drawBox(r.lat, 1.75, z, r.len - 0.1, 1.1, 0.06, 0xbfe9f7, { emissive: 0x3f8aa6, ei: 0.18, glass: true });
      drawn++;
    }
    return drawn;
  };

  // ---- SUBJECT STAGING ------------------------------------------------------
  const actors = [];
  let stateText = "";
  const info = {};
  let vault = null;
  let bagObjects = 0;

  const spawnBagMesh = function (x, y, z, yaw, dyed) {
    // ask the LIVE registry for the asset; a build that has never heard of a
    // money bag gets the closest thing it does own, which is the honest before.
    let o = null;
    if (CBZ.itemAsset) {
      try {
        o = feat.moneybag
          ? CBZ.itemAsset(null, null, { kind: "moneybag", canvas: dyed ? 0x7a2a26 : 0x2f3a2c, note: dyed ? 0x8c4a44 : 0x6fae5a })
          : CBZ.itemAsset("Briefcase of Cash", null, { kind: "briefcase" });
      } catch (e) { o = null; }
    }
    if (!o) {
      // last resort is city/armored.js's shipped spill prop, to the millimetre
      o = new T.Group();
      const bag = new T.Mesh(new T.BoxGeometry(0.7, 0.32, 0.42), material(0x2b2f36));
      bag.position.y = 0.18; o.add(bag);
      for (let k = 0; k < 3; k++) {
        const n = new T.Mesh(new T.BoxGeometry(0.4, 0.16, 0.26), material(0x6fae5a));
        n.position.set((k - 1) * 0.2, 0.1 + k * 0.05, (k - 1) * 0.16);
        o.add(n);
      }
    }
    o.position.set(x, y, z);
    o.rotation.y = yaw || 0;
    stagegroup.add(o);
    bagObjects++;
    return o;
  };

  if (S.id === "teller-lobby") {
    // the hall: a back partition line, the counter, and the people behind it.
    // The gap sits INSIDE the run (at 1.4 of a 6 m line) so the plate shows a
    // real hole in the counter rather than a shortened one.
    // the staff gap goes at the END of the run (which is where a bank puts the
    // swing gate), so every teller still stands behind their own window.
    const gap = feat.vaultRoom ? -2.4 : null;
    const runs = counterRun(1.4, 8.0, gap, 1.7);
    drawBox(0, 1.5, 2.9, 11.0, 3.0, 0.30, 0x4a5058);        // the wall behind the line
    drawBox(0, 0.02, 0.4, 11.0, 0.04, 5.6, 0x2e343c);       // floor plate
    // three windows' worth of screens
    for (let i = 0; i < 3; i++) drawBox(-0.4 + i * 1.7, 1.28, 1.05, 0.34, 0.24, 0.05, 0x5b8bff, { emissive: 0x5b8bff, ei: 0.7 });
    // THE PEOPLE. Deployed declares no bank staff at all — aigoals.js casts
    // "office worker" into a bank lot and nothing has ever stood at a window.
    let bodies = 0;
    if (feat.tellerTrade && CBZ.makeCharacter) {
      for (let i = 0; i < 3; i++) {
        const ch = person(i === 1 ? 0x2b3140 : 0x333b4c);
        if (!ch) break;
        ch.group.position.set(-0.4 + i * 1.7, 0, 2.15);
        ch.group.rotation.y = Math.PI;
        if (CBZ.setCharPose) { try { CBZ.setCharPose(ch, "table"); } catch (e) {} }
        tick(ch, 80);
        stagegroup.add(ch.group);
        actors.push(ch); bodies++;
      }
    }
    info.tellers = bodies;
    info.counterRuns = runs;
    info.staffGap = gap != null;
    stateText = bodies
      ? bodies + " TELLERS · " + runs + "-RUN COUNTER WITH A STAFF GAP"
      : "NO BANK STAFF ROLE EXISTS · ONE UNBROKEN COUNTER";

  } else if (S.id === "vault-door-closed" || S.id === "vault-room-open") {
    const open = S.id === "vault-room-open";
    vault = buildVault({
      tier: "reserve", kind: "bank", name: "Meridian Trust",
      lat: 0, till: null,
    });
    if (!vault) {
      buildSetDressing();
      stateText = "SET DRESSING · 3 BOXES · NOTHING BEHIND IT";
      info.setDressing = true;
    } else {
      info.roomW = round(vault.rw); info.roomD = round(vault.rd);
      info.doorW = round(vault.dw); info.doorH = round(vault.dh);
      info.armour = vault.hp0;
      info.shelfBricks = vault.bricks || 0;
      if (open) {
        // Swing it by hand: the tick that normally eases the leaf belongs to
        // the live game loop, and a storyboard must not depend on one running.
        // 1.15 rad (66°) rather than the full 1.72 — at 99° the leaf stands
        // square across the opening and the plate becomes a photograph of the
        // BACK of a door. Two-thirds open still says "this moved" and leaves
        // the room readable, which is what the subject is for.
        if (vault.pivot) vault.pivot.rotation.y = -vault.hingeSign * 1.15;
        if (vault.lugs) for (let i = 0; i < vault.lugs.length; i++) vault.lugs[i].scale.x = 0.3;
        // ...and the money on the floor, from the REAL bag asset.
        // ON THE STRONGROOM FLOOR, not in the lobby. `vault.rz` is the room's
        // own world centre (the builder publishes it precisely so a caller
        // never has to re-derive the partition offset); the first pass used
        // rd*0.5 and put the whole haul outside the door it just opened.
        const N = 7;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2 + 0.4;
          const r = 0.55 + (i % 3) * 0.5;
          spawnBagMesh(vault.rx + Math.cos(a) * r, 0, vault.rz + Math.sin(a) * r * 0.8, a * 1.7, false);
        }
        info.bagsShown = N;
      }
      stateText = (open ? "OPEN · " : "SEALED · ") +
        info.roomW + "×" + info.roomD + "m STRONGROOM · " +
        info.shelfBricks + " BRICKS ON THE SHELVES · " + info.armour + " ARMOUR";
    }
    if (!vault && open) {
      // the deployed build cannot open anything, so the honest "open" plate is
      // its spill prop lying in front of a door that does not move.
      for (let i = 0; i < 4; i++) spawnBagMesh((i - 1.5) * 0.9, 0, -1.6 - (i % 2) * 0.7, i * 1.3, false);
      stateText = "SET DRESSING · THE DOOR CANNOT OPEN · SPILL PROPS ONLY";
    }

  } else if (S.id === "cash-bag") {
    const o = spawnBagMesh(0, 0, 0, 0.55, false);
    o.updateMatrixWorld(true);
    const bb = new T.Box3().setFromObject(o);
    info.bagLen = round(bb.max.z - bb.min.z);
    info.bagTall = round(bb.max.y - bb.min.y);
    let parts = 0;
    o.traverse(function (m) { if (m.isMesh) parts++; });
    info.bagParts = parts;
    stateText = (feat.moneybag ? "moneybag ASSET · " : "NO MONEY-BAG ASSET (" + feat.bagAsset + ") · ") +
      parts + " PARTS · " + info.bagLen + "m LONG";

  } else if (S.id === "bag-carried") {
    const ch = person(0x2f3a4d);
    if (!ch) return { ok: false, missing: "no-character-rig" };
    if (feat.haulPose && CBZ.setCharPose) { try { CBZ.setCharPose(ch, "haul"); } catch (e) {} }
    tick(ch, 110);
    stagegroup.add(ch.group);
    actors.push(ch);
    /* RUN THE REAL CARRY, don't re-stage it. The first pass hand-placed the
       bag at the offset mountOnBody used to use and photographed it at the
       model's ANKLES — which is exactly the bug that offset had, and a
       storyboard that re-types a position can never catch that. So we lend the
       live block our rig as CBZ.playerChar, spawn a bag through CBZ.cashBags
       and call pickup(): whatever the shipped mount solve does is what the
       plate shows. playerChar is restored immediately afterwards. */
    if (feat.cashBags) {
      const prevChar = CBZ.playerChar;
      const prevCarried = CBZ.cashBags.carried();
      try {
        if (prevCarried) CBZ.cashBags.take(prevCarried);
        CBZ.playerChar = ch;
        const bag = CBZ.cashBags.spawn(0, 0, 0, 780000, { src: "studio" });
        if (bag && CBZ.cashBags.pickup(bag)) { bagObjects++; info.carriedValue = bag.amount; }
      } catch (e) { info.carryError = String(e && e.message || e); }
      CBZ.playerChar = prevChar;
    } else if (feat.moneybag) {
      const host = ch.body || ch.group;
      const o = CBZ.itemAsset(null, null, { kind: "moneybag" });
      if (o) { o.position.set(0.30, 0.95, -0.10); o.rotation.set(0.10, -0.24, -0.52); host.add(o); bagObjects++; }
    }
    ch.group.updateMatrixWorld(true);
    const bb = new T.Box3().setFromObject(ch.group);
    info.rigHeight = round(bb.max.y - bb.min.y);
    info.haulDelta = feat.haulDelta;
    stateText = feat.haulPose
      ? "CARRYING · charPoses.haul · Δjoint " + feat.haulDelta + " rad"
      : "NOTHING TO CARRY AND NO POSE TO CARRY IT IN";

  } else if (S.id === "casino-count-room") {
    // the cage counter you stand at, and the room the money is actually in
    drawBox(0, 0.70, -2.6, 3.2, 1.4, 0.7, 0x2a2620);
    drawBox(0, 1.50, -2.6, 3.2, 0.10, 0.7, 0xc9a227, { emissive: 0xc9a227, ei: 0.5 });
    vault = buildVault({ tier: "count", kind: "casino", name: "the house count room", lat: 0, till: null });
    if (!vault) {
      buildSetDressing();
      stateText = "NO COUNT ROOM EXISTS · A CAGE WITH A WALL BEHIND IT";
      info.setDressing = true;
    } else {
      if (vault.pivot) vault.pivot.rotation.y = -vault.hingeSign * 1.15;
      if (vault.lugs) for (let i = 0; i < vault.lugs.length; i++) vault.lugs[i].scale.x = 0.3;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.9;
        spawnBagMesh(vault.rx + Math.cos(a) * 0.85, 0, vault.rz + Math.sin(a) * 0.7, a, false);
      }
      info.roomW = round(vault.rw); info.roomD = round(vault.rd);
      info.armour = vault.hp0; info.shelfBricks = vault.bricks || 0;
      stateText = "COUNT ROOM · " + info.roomW + "×" + info.roomD + "m · " +
        info.shelfBricks + " BRICKS · " + info.armour + " ARMOUR";
    }

  } else {
    return { ok: false, missing: "unknown-subject:" + S.id };
  }

  // ---- scene ----------------------------------------------------------------
  const scene = new T.Scene();
  scene.background = new T.Color(0x101419);
  scene.add(new T.HemisphereLight(0xdfe8ff, 0x1d1a16, 0.85));
  const key = new T.DirectionalLight(0xffe9c8, 1.60);
  key.position.set(6.0, 10.0, 7.5); scene.add(key);
  const rim = new T.DirectionalLight(0x8fc0ff, 0.70);
  rim.position.set(-7.5, 5.0, -6.0); scene.add(rim);
  const fill = new T.DirectionalLight(0xffffff, 0.26);
  fill.position.set(3.0, 2.5, -8.0); scene.add(fill);
  // a warm bounce from inside the strongroom so an open door reads as a PLACE
  if (S.kind === "vault") {
    const inner = new T.PointLight(0xffd9a0, 1.5, 14, 2);
    inner.position.set(0, 2.2, vault ? vault.rd * 0.55 : 2.0);
    scene.add(inner);
  }
  scene.add(stagegroup);

  stagegroup.updateMatrixWorld(true);
  const contents = new T.Box3().setFromObject(stagegroup);
  const size = contents.getSize(new T.Vector3());
  const center = contents.getCenter(new T.Vector3());

  /* ---- FRAMING, PER SUBJECT ------------------------------------------------
     A single bounding-box fit is wrong here and the first run proved it three
     different ways: the shut door was photographed as a cutaway from ABOVE a
     6 m room (the subject is the door, and you meet a door at eye level), the
     0.85 m bag was framed against a 2.4 m floor and fell out of the bottom of
     the plate, and the carried bag was lost against a full-height rig.

     So each subject names WHAT IT IS ABOUT and the camera frames THAT — a
     rectangle of interest, not the union of everything staged. The `after`
     side still inherits the `before` side's solved camera verbatim (that is
     what makes the pair honest); this only changes how the FIRST side of a
     pair chooses. */
  /* THE VAULT SUBJECTS DELIBERATELY DO NOT INHERIT THE BEFORE CAMERA, and
     that is the honest choice rather than the lazy one. Everywhere else in
     this repo's storyboards the two sides hold one camera because they stage
     the SAME object; here the before side contains three boxes 2.4 m tall and
     the after side contains a 6 m room, so a shared frame either photographs
     the strongroom from across the street or crops the prop out entirely.
     Framing each side on its own subject is what lets a reader see both, and
     the comparison is carried by the METRICS, which are measured, not framed. */
  const aspect = input.width / input.height;
  const inheritCamera = S.kind !== "vault";
  const referenceCamera = inheritCamera ? (input.referenceStage && input.referenceStage.camera) : null;
  let focusCenter = [center.x, Math.max(0.55, center.y * 0.92), center.z];
  let focusHeight = Math.max(
    size.y * 1.28 + (size.x + size.z) * 0.16,
    ((0.80 * size.x + 0.62 * size.z + 0.55) * 1.12) / aspect,
    2.4
  );
  let dir = [0.78, 0.50, -1.0];
  if (S.id === "vault-door-closed") {
    // stand in the banking hall and look at the door, low and square-on.
    focusCenter = [0, 1.55, vault ? (vault.plz != null ? vault.plz : 2.6) : 0.4];
    focusHeight = vault ? 5.3 : 4.2;
    dir = [0.42, 0.22, -1.0];
  } else if (S.id === "vault-room-open" || S.id === "casino-count-room") {
    // a three-quarter cutaway that has BOTH the swung leaf and the room's
    // contents in frame — the whole claim of the wave in one rectangle.
    //
    // STAND ON THE SIDE THE DOOR IS NOT. The leaf swings out into the lobby on
    // the HINGE side, so a camera parked there photographs the back of a slab.
    // The builder publishes `hingeSign`, so the azimuth is derived from the
    // door itself and stays right for a left- or right-hung vault alike.
    const rz = vault ? vault.rz : 2.5;
    const openSide = vault ? -vault.hingeSign : 1;
    focusCenter = [vault ? (vault.rx + openSide * 0.35) : 0, 1.55,
                   vault ? (vault.plz + (rz - vault.plz) * (S.id === "casino-count-room" ? 0.15 : 0.55)) : 1.4];
    focusHeight = vault ? Math.max(S.id === "casino-count-room" ? 6.6 : 5.6, vault.rw * 1.10) : 5.4;
    dir = [0.66 * openSide, 0.46, -1.0];
  } else if (S.kind === "asset") {
    // a product shot: the bag fills the frame and nothing else is in it.
    focusCenter = [center.x, center.y, center.z];
    focusHeight = Math.max(0.62, size.y * 1.9, (size.x + size.z) * 0.52 / aspect);
    dir = [0.72, 0.46, -1.0];
  } else if (S.kind === "carry") {
    // torso-up: the shoulder, the strap and the arm that is holding it.
    // shoot the CARRYING shoulder from behind-quarter: the bag, the strap and
    // the arm that came up to grip it are the whole subject, and a front
    // three-quarter puts the body between the camera and all three.
    focusCenter = [center.x, Math.max(1.05, center.y + 0.18), center.z];
    focusHeight = 2.15;
    dir = [-1.0, 0.34, 0.72];
  } else if (S.kind === "lobby") {
    focusCenter = [0.2, 1.30, 1.7];
    focusHeight = 5.9;
    dir = [0.52, 0.34, -1.0];
  }
  const dirLen = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
  const framedHeight = referenceCamera ? referenceCamera.framedHeight : focusHeight;
  const cameraTarget = referenceCamera ? referenceCamera.target : focusCenter;
  const cameraPosition = referenceCamera ? referenceCamera.position : [
    cameraTarget[0] + (dir[0] / dirLen) * 40,
    cameraTarget[1] + (dir[1] / dirLen) * 40,
    cameraTarget[2] + (dir[2] / dirLen) * 40,
  ];
  const cameraUp = referenceCamera ? referenceCamera.up : [0, 1, 0];

  const floor = new T.Mesh(
    new T.PlaneGeometry(60, 60),
    new T.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.95 })
  );
  floor.rotation.x = -HALF_PI;
  floor.position.set(center.x, -0.01, center.z);
  scene.add(floor);

  const camera = new T.OrthographicCamera(
    -framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, 300
  );
  camera.position.fromArray(cameraPosition);
  camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget));
  camera.updateProjectionMatrix();
  studio.scene = scene;
  studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  // ---- honest numbers -------------------------------------------------------
  const metrics = { boxesDrawn: boxes };
  if (info.roomW) { metrics.roomArea = round(info.roomW * info.roomD, 1); }
  if (info.armour) metrics.doorArmour = info.armour;
  if (info.shelfBricks != null && info.shelfBricks > 0) metrics.shelfBricks = info.shelfBricks;
  if (bagObjects) metrics.bagsShown = bagObjects;
  if (info.bagParts) metrics.bagParts = info.bagParts;
  if (info.tellers != null) metrics.tellers = info.tellers;
  metrics.meshCount = (function () { let n = 0; stagegroup.traverse(function (m) { if (m.isMesh) n++; }); return n; })();

  // ---- overlay --------------------------------------------------------------
  const before = input.side === "before";
  const q = function (sel) { return studio.overlay.querySelector(sel); };
  const sideEl = q("[data-side]"), nameEl = q("[data-name]"), focusEl = q("[data-focus]");
  const stateEl = q("[data-state]"), detailEl = q("[data-detail]"), sourceEl = q("[data-source]");
  sideEl.textContent = before ? input.beforeLabel : input.afterLabel;
  sideEl.style.cssText = "position:absolute;top:24px;left:28px;padding:7px 11px;border-radius:7px;background:" +
    (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em";
  nameEl.textContent = S.label;
  nameEl.style.cssText = "position:absolute;top:69px;left:28px;font-size:29px;font-weight:800;letter-spacing:-.02em";
  focusEl.textContent = S.focus;
  focusEl.style.cssText = "position:absolute;top:106px;left:30px;color:#cdbfae;font-size:13px;font-weight:550;max-width:760px";
  stateEl.textContent = stateText;
  stateEl.style.cssText = "position:absolute;right:26px;top:25px;color:" +
    (before ? "#ff9c9c" : "#80e4b4") + ";font-size:11px;font-weight:850;letter-spacing:.11em;text-align:right;max-width:440px";
  detailEl.textContent = "vaultRoom " + (feat.vaultRoom ? "yes" : "no") +
    " · cashBags " + (feat.cashBags ? "yes" : "no") +
    " · bagAsset " + feat.bagAsset +
    " · haulPose " + (feat.haulPose ? "yes" : "no") +
    " · tellerRole " + (feat.tellerTrade ? "yes" : "no") +
    " · meshes " + metrics.meshCount;
  detailEl.style.cssText = "position:absolute;right:26px;bottom:20px;color:#a79a8b;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:560px";
  sourceEl.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  sourceEl.style.cssText = "position:absolute;bottom:20px;left:28px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    subject: S.id,
    features: feat,
    info: info,
    bounds: [round(size.x), round(size.y), round(size.z)],
    metrics: metrics,
    reclaimedColliders: takenColliders.length,
    adoptedGroups: adopted.length,
    camera: {
      framedHeight: framedHeight,
      position: cameraPosition.slice(),
      target: cameraTarget.slice(),
      up: cameraUp.slice(),
    },
  };
}

export default {
  id: "bank-heist",
  title: "Banks: A Real Vault, A Real Room, Money You Carry",
  description: "Six studio plates from the bank-vault wave. The deployed build's vault is three boxes its own source comments call set dressing, with a nine-second drill bar standing in for a door; money anywhere in that build is a number that appears in your wallet. The local build calls CBZ.cityVaultRoom inside the page being photographed — a partition, a strongroom you can stand in, and a 0.42 m leaf on a hinge column that only explosives or a bank officer at gunpoint will move — and fills it with CBZ.cashBags duffels you pick up, carry, throw and walk out with. Every plate stages both sides with the SAME code and feature-detects the new capability by measuring it.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1180, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.itemAsset && CBZ.makeCharacter && CBZ.animChar",
  metricsNote: "Measured inside each build while the plate was staged: what the real vault builder actually drew, how big a room it produced, how much blast the door absorbs, and how many separate parts the money bag resolves into.",
  metrics: {
    boxesDrawn: { label: "Boxes drawn by the builder" },
    meshCount: { label: "Meshes in the plate" },
    roomArea: { label: "Strongroom floor", unit: "m²" },
    doorArmour: { label: "Door armour pool" },
    shelfBricks: { label: "Banded bricks on the shelves" },
    bagsShown: { label: "Carryable money bags" },
    bagParts: { label: "Parts in the bag asset" },
    tellers: { label: "Tellers at the windows" },
  },
  subjects,
  stage: stageVault,
};
