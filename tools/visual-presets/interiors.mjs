/* Interiors comparison studio — furniture kit + posture-aware bodies.

   The deployed page shows the interiors BEFORE this wave: the old CBZ.furnish
   pieces, no F.coffee / F.armchair vocabulary, one generic seated pose for
   every kind of seat, and a "sleeper" that is the standing rig rolled 90°.
   The local page consumes the rebuilt pieces, the seat-kind postures
   (ch.seatRef.kind) and the real sleep pose (ch.lying).

   Both sides run the SAME stage code. Everything new is feature-detected —
   the two furniture functions by name, the two POSE features by measuring a
   throwaway rig (build two identical characters, give one the new flag, tick
   both, and compare the joints). That is the only honest test: a pose flag an
   old build ignores leaves an identical rig behind.

   Furniture staging: every CBZ.furnish piece takes `opts.box`, a host draw
   function (x,y,z,w,h,d,color,o). The default sink is CBZ.addBox, which
   parents into CBZ.prisonRoot || CBZ.scene — so instead we hand the kit our
   OWN box function and every mesh lands in this studio's group. propuse's
   seat/bed registries are muted for the duration of a piece call (the kit
   feature-detects them), so a storyboard never pollutes the live anchor
   registry; the returned `seats` array carries the numbers we need anyway. */

const subjects = [
  {
    id: "bed",
    label: "Bed",
    kind: "piece",
    focus: "Frame, mattress, folded blanket, pillow, headboard — read the bedding as layers, not as one painted slab.",
  },
  {
    id: "sofa",
    label: "Sofa",
    kind: "piece",
    focus: "Plinth, body, seat cushion at 0.40 and the 0.85 back — the cushion should oversail the frame and cast its own line.",
  },
  {
    id: "armchair-coffee",
    label: "Armchair + Coffee Table",
    kind: "piece",
    focus: "The vocabulary gap: the deployed build has no armchair and no coffee table, so it falls back to a dining chair beside a seat-less dining table.",
  },
  {
    id: "desk",
    label: "Desk Cluster",
    kind: "piece",
    focus: "One call draws pedestal, modesty panel, worktop at 0.74, monitor proud of its bezel, and the chair behind it.",
  },
  {
    id: "dining",
    label: "Dining Table + Ring",
    kind: "piece",
    focus: "Four chairs ringed around one table, every one facing the centre and every one standing on its own legs.",
  },
  {
    id: "sitting-chair",
    label: "Seated — Dining Chair",
    kind: "sit",
    focus: "Baseline seat solve both builds share: butt on the 0.45 cushion, soles on the floor, thigh line clear of the seat.",
  },
  {
    id: "lounging-sofa",
    label: "Seated — Sofa Lounge",
    kind: "sit",
    focus: "Same body, same cushion: the deployed build sits bolt upright on a sofa, the rebuild leans into the back cushion.",
  },
  {
    id: "sitting-stool",
    label: "Seated — Bar Stool",
    kind: "sit",
    focus: "A 0.68 perch with nothing under the feet — watch the shins hang instead of stretching for a floor that isn't there.",
  },
  {
    id: "typing-desk",
    label: "Seated — Working at the Desk",
    kind: "sit",
    focus: "Sitting plus the typing flag: forearms toward the worktop, head tipped to the screen, hips still on the chair.",
  },
  {
    id: "sleeping",
    label: "Asleep in Bed",
    kind: "sleep",
    focus: "THE MONEY SHOT. Deployed: the standing rig tipped 90° onto the mattress. Rebuild: an actual sleeping body.",
  },
  {
    id: "bedroom-vignette",
    label: "Bedroom Program",
    kind: "vignette",
    focus: "Bed headboard to the wall, wardrobe on the next wall, lamp at the head end — the roombuild bedroom grammar, composed by hand.",
  },
  {
    id: "lounge-vignette",
    label: "Lounge Program",
    kind: "vignette",
    focus: "Sofa on its wall, coffee table one shin-gap forward, armchair at 90° in the conversational L, lamp in the corner.",
  },
];

function stageInterior(input) {
  const T = window.THREE;
  const CBZ = window.CBZ;
  const F = CBZ && CBZ.furnish;
  if (!T || !CBZ || !F || typeof F.chair !== "function" || !CBZ.makeCharacter || !CBZ.animChar) {
    return { ok: false, missing: "furnish-kit-or-character-rig" };
  }
  const S = input.subject;
  const HALF_PI = Math.PI / 2;
  const round = function (v, n) {
    const k = Math.pow(10, n == null ? 3 : n);
    return Number.isFinite(v) ? Math.round(v * k) / k : 0;
  };

  // ---- the studio: one renderer + overlay per page, reused by every subject
  let studio = window.__cbzVisualCompare;
  if (!studio) {
    document.documentElement.style.cssText = "margin:0;width:100%;height:100%;background:#0c1016";
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;width:100%;height:100%;overflow:hidden;background:#0c1016;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(input.width, input.height, false);
    renderer.domElement.style.cssText = "display:block;width:" + input.width + "px;height:" + input.height + "px";
    document.body.appendChild(renderer.domElement);
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f6f2ec;text-shadow:0 2px 9px #000;z-index:5";
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
    const key = c + "|" + em + "|" + ei;
    if (!studio.mats.has(key)) {
      const spec = { color: c, roughness: 0.82, metalness: 0.03, flatShading: false };
      if (em >= 0) { spec.emissive = em; spec.emissiveIntensity = ei; }
      studio.mats.set(key, new T.MeshStandardMaterial(spec));
    }
    return studio.mats.get(key);
  };

  // ---- one group holds everything staged for THIS subject -------------------
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

  // Call one CBZ.furnish piece into THIS studio. `opts.box` is the kit's own
  // host-draw seam (furniture.js pen(): draw = opts.box || CBZ.addBox), so the
  // meshes never touch CBZ.scene. ox/oz stay 0 → seat anchors come back in
  // studio coordinates. propuse registration is muted and restored.
  const placed = [];
  const failures = [];
  const piece = function (name, x, y, z, yaw, opts) {
    const fn = F[name];
    if (typeof fn !== "function") { failures.push(name); return null; }
    const o = {};
    if (opts) for (const k in opts) o[k] = opts[k];
    o.box = drawBox; o.ox = 0; o.oz = 0; o.oy = 0; o.lot = null; o.solid = false;
    const seatReg = CBZ.propRegisterSeat, bedReg = CBZ.propRegisterBed;
    let res = null;
    try {
      CBZ.propRegisterSeat = null;
      CBZ.propRegisterBed = null;
      res = (name === "lamp") ? fn(x, y, z, o) : fn(x, y, z, yaw, o);
    } catch (err) {
      failures.push(name + ":" + (err && err.message ? err.message : String(err)));
      res = null;
    } finally {
      CBZ.propRegisterSeat = seatReg;
      CBZ.propRegisterBed = bedReg;
    }
    if (res) {
      res.piece = name; res.x = x; res.y = y; res.z = z; res.yaw = yaw;
      placed.push(res);
    }
    return res;
  };

  // ---- bodies ---------------------------------------------------------------
  const person = function (tint) {
    return CBZ.makeCharacter({
      skin: 0xc08a63, torso: tint, collar: tint, arms: tint,
      legs: 0x2b3140, shoes: 0x1c1815, hair: 0x2b1d12,
    });
  };
  const tick = function (ch, n) {
    const count = n == null ? 90 : n;
    for (let i = 0; i < count; i++) CBZ.animChar(ch, 0, 1 / 60);
  };

  // ---- FEATURE DETECTION (measured, once per page) --------------------------
  // Two rigs, one flag apart, same tick budget. If the build ignores the flag
  // the joints come back bit-identical and the feature is reported absent.
  if (!studio.features) {
    const signature = function (ch) {
      const j = ch.low || {}, p = ch.parts || {};
      return [
        ch.model ? ch.model.position.y : 0,
        ch.body ? ch.body.position.y : 0,
        ch.body ? ch.body.rotation.x : 0,
        ch.body ? ch.body.rotation.z : 0,
        p.ll ? p.ll.rotation.x : 0, p.ll ? p.ll.rotation.z : 0,
        p.rl ? p.rl.rotation.x : 0, p.rl ? p.rl.rotation.z : 0,
        p.la ? p.la.rotation.x : 0, p.la ? p.la.rotation.z : 0,
        p.ra ? p.ra.rotation.x : 0,
        j.ll ? j.ll.rotation.x : 0, j.ll ? j.ll.scale.y : 1,
        j.la ? j.la.rotation.x : 0,
        ch.neck ? ch.neck.rotation.x : 0,
        ch.group.rotation.x, ch.group.rotation.z,
      ];
    };
    const probe = function (apply) {
      const ch = person(0x3d6ea8);
      try { apply(ch); } catch (err) { /* an ignored flag is the "before" answer */ }
      tick(ch, 70);
      return signature(ch);
    };
    const spread = function (a, b) {
      let m = 0;
      for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
      return m;
    };
    const plainSit = probe(function (ch) { ch.sitting = true; ch.seatRef = { cushion: 0.40, floorBelow: 0 }; });
    const kindSit = probe(function (ch) { ch.sitting = true; ch.seatRef = { cushion: 0.40, floorBelow: 0, kind: "sofa" }; });
    const stand = probe(function () {});
    const lie = probe(function (ch) { ch.lying = { back: true, phase: 0.4 }; });
    studio.features = {
      // measured first (a flag an old build ignores leaves the rig identical);
      // the published API is the corroborating second opinion.
      seatKind: spread(plainSit, kindSit) > 1e-4 || typeof CBZ.charSeatPosture === "function",
      lyingPose: spread(stand, lie) > 1e-4 || !!CBZ.charLieRoll,
      armchair: typeof F.armchair === "function",
      coffee: typeof F.coffee === "function",
      seatKindDelta: Math.round(spread(plainSit, kindSit) * 10000) / 10000,
      lyingDelta: Math.round(spread(stand, lie) * 10000) / 10000,
    };
  }
  const feat = studio.features;

  // Seat a body exactly the way city/propuse.js's CBZ.propSit does — group at
  // the anchor (its y IS the floor the soles rest on), rotation.y = face — and
  // hand the rig the declared cushion. `kind` is the new field; a build that
  // has never heard of it simply reads the two numbers it always read.
  const seatOn = function (ch, anchor, kind) {
    if (!anchor) return null;
    ch.sitting = true;
    ch.seatRef = { cushion: anchor.cushion, floorBelow: 0, kind: kind || anchor.kind || "chair" };
    ch.group.position.set(anchor.x, anchor.y, anchor.z);
    ch.group.rotation.set(0, anchor.yaw != null ? anchor.yaw : anchor.face, 0);
    return ch.seatRef;
  };
  // What the build says it will DO with that kind. "chair" is deliberately
  // upright even in the rebuild (SEAT_POSTURE maps it to null), so naming the
  // posture family is the only honest state line for a seated plate.
  const postureOf = function (kind) {
    if (typeof CBZ.charSeatPosture === "function") {
      const p = CBZ.charSeatPosture(kind);
      return p ? String(p).toUpperCase() : "UPRIGHT (BY DESIGN)";
    }
    return feat.seatKind ? String(kind).toUpperCase() : "ONE GENERIC SIT";
  };

  // ---- SUBJECT STAGING ------------------------------------------------------
  const actors = [];
  let stateText = "";
  let detailText = "";
  const info = {};

  const coffeeTable = function (x, z, yaw) {
    // AFTER: the kit owns a coffee table. BEFORE: the closest legacy staging a
    // room could actually express — a seat-less dining table cut to 1.1 m
    // (world/roombuild.js's lounge program does exactly this).
    if (feat.coffee) return piece("coffee", x, 0, z, yaw, { len: 1.1 });
    return piece("table", x, 0, z, yaw, { seats: 0, len: 1.1, deep: 0.6 });
  };
  const loungeChair = function (x, z, yaw) {
    if (feat.armchair) return piece("armchair", x, 0, z, yaw, { len: 0.94 });
    return piece("chair", x, 0, z, yaw, {});
  };

  if (S.id === "bed") {
    const bed = piece("bed", 0, 0, 0, -HALF_PI, { len: 2.1, wide: 1.4, tone: "warm" });
    info.mattressTop = bed ? round(bed.top) : 0;
    stateText = boxes + " BOXES · MATTRESS " + info.mattressTop + "m";

  } else if (S.id === "sofa") {
    const sofa = piece("sofa", 0, 0, 0, 0.35, { len: 2.4, tone: "warm" });
    info.cushion = sofa && sofa.seats[0] ? round(sofa.seats[0].cushion) : 0;
    info.seats = sofa ? sofa.seats.length : 0;
    stateText = boxes + " BOXES · " + info.seats + " SEATS";

  } else if (S.id === "armchair-coffee") {
    const chair = loungeChair(-0.78, 0.06, 0.42);
    const table = coffeeTable(0.72, 0.10, 0);
    info.armchairCushion = chair && chair.seats[0] ? round(chair.seats[0].cushion) : 0;
    info.tableTop = table ? round(table.top) : 0;
    stateText = (feat.armchair ? "F.armchair" : "F.chair FALLBACK") + " + " +
      (feat.coffee ? "F.coffee" : "F.table(seats:0) FALLBACK");

  } else if (S.id === "desk") {
    const desk = piece("desk", 0, 0, 0, HALF_PI * 0.55, { len: 1.5, deep: 0.75, tone: "cool" });
    info.worktop = desk ? round(desk.top) : 0;
    stateText = boxes + " BOXES · WORKTOP " + info.worktop + "m";

  } else if (S.id === "dining") {
    const table = piece("table", 0, 0, 0, 0.28, { len: 1.6, deep: 0.9, seats: 4, tone: "warm" });
    info.worktop = table ? round(table.top) : 0;
    info.seats = table ? table.seats.length : 0;
    stateText = boxes + " BOXES · " + info.seats + " CHAIRS";

  } else if (S.id === "sitting-chair") {
    const chair = piece("chair", 0, 0, 0, 0.35, { tone: "warm" });
    const ch = person(0x3d6ea8);
    const ref = seatOn(ch, chair && chair.seats[0], "chair");
    tick(ch, 90);
    actors.push(ch);
    stagegroup.add(ch.group);
    info.cushion = ref ? round(ref.cushion) : 0;
    info.posture = postureOf("chair");
    stateText = "CHAIR · " + info.posture;

  } else if (S.id === "lounging-sofa") {
    const sofa = piece("sofa", 0, 0, 0, 0.35, { len: 2.4, tone: "warm" });
    const seats = sofa ? sofa.seats : [];
    const middle = seats.length ? seats[Math.floor(seats.length / 2)] : null;
    const ch = person(0x7d4a63);
    const ref = seatOn(ch, middle, "sofa");
    tick(ch, 90);
    actors.push(ch);
    stagegroup.add(ch.group);
    info.cushion = ref ? round(ref.cushion) : 0;
    info.posture = postureOf("sofa");
    stateText = "SOFA · " + info.posture;

  } else if (S.id === "sitting-stool") {
    const stool = piece("stool", 0, 0, 0, 0.35, { tone: "cool" });
    const ch = person(0x4a6f4d);
    const ref = seatOn(ch, stool && stool.seats[0], "stool");
    tick(ch, 90);
    actors.push(ch);
    stagegroup.add(ch.group);
    info.cushion = ref ? round(ref.cushion) : 0;
    info.posture = postureOf("stool");
    stateText = "STOOL · " + info.posture;

  } else if (S.id === "typing-desk") {
    const desk = piece("desk", 0, 0, 0, HALF_PI * 0.55, { len: 1.5, deep: 0.75, tone: "cool" });
    const ch = person(0x3d6ea8);
    const ref = seatOn(ch, desk && desk.seats[0], "chair");
    ch.typing = true;
    tick(ch, 90);
    actors.push(ch);
    stagegroup.add(ch.group);
    info.cushion = ref ? round(ref.cushion) : 0;
    info.posture = postureOf("chair");
    stateText = "DESK CHAIR · " + info.posture + " · TYPING";

  } else if (S.id === "sleeping") {
    const yaw = -HALF_PI;                       // head toward -x, along the frame
    const bed = piece("bed", 0, 0, 0, yaw, { len: 2.1, wide: 1.4, tone: "warm" });
    const top = bed ? bed.top : 0.55;
    const ch = person(0x8a5f8f);
    if (feat.lyingPose) ch.lying = { back: true, vary: 0.5, fold: false, phase: 0.35 };
    tick(ch, 90);
    // The bed record propuse would have registered (registration is muted here).
    const rec = {
      x: 0, y: 0, z: 0,
      hx: Math.sin(yaw), hz: Math.cos(yaw),
      len: (bed ? bed.d : 2.2) - 0.12, top: top, lieY: top + 0.3, kind: "bed",
    };
    let lie = null;
    if (typeof CBZ.propLiePlace === "function") {
      try { lie = CBZ.propLiePlace({ char: ch, group: ch.group }, rec, {}); } catch (err) { lie = null; }
    }
    if (!lie || !Number.isFinite(lie.x)) {
      // same solve, replicated: the rig ORIGIN is the FEET, so back it off the
      // head end by the body's own stature and clear the mattress by half a
      // shoulder (propuse.js CBZ.propLiePlace).
      const metric = ch.metric || {};
      const pf = ch.profile || {};
      const hs = (ch.group.userData && ch.group.userData.humanScale) || 1;
      const len = metric.height > 0.6 ? metric.height : 1.8;
      const rise = pf.torsoW > 0 ? Math.max(0.14, pf.torsoW * 0.5 * hs - 0.04) : 0.3;
      const s = Math.max(rec.len * 0.5 - 0.06 - len, -len * 0.5);
      lie = { x: rec.x + rec.hx * s, y: top + rise, z: rec.z + rec.hz * s };
    }
    ch.group.position.set(lie.x, lie.y, lie.z);
    ch.group.rotation.set(0, Math.atan2(rec.hz, -rec.hx), 0);
    // WHICH WAY DOES THIS BUILD LAY A BODY DOWN? The legacy answer is the whole
    // group rolled 90° about Z; a rig that poses its own sleep may not want it.
    // Measure both and keep whichever is actually flat on the mattress.
    const heightWith = function (roll) {
      ch.group.rotation.z = roll;
      ch.group.updateMatrixWorld(true);
      const b = new T.Box3().setFromObject(ch.group);
      return { h: b.max.y - b.min.y, box: b };
    };
    const flat = heightWith(HALF_PI);
    const upright = heightWith(0);
    const rolled = flat.h <= upright.h;
    const chosen = rolled ? heightWith(HALF_PI) : heightWith(0);
    // Last-resort honesty guard: if the body ends up floating off the mattress
    // or sunk through it, sit it back on the surface and say so.
    let lieFit = "anchor";
    const drop = (top + 0.02) - chosen.box.min.y;
    if (Math.abs(drop) > 0.14) {
      ch.group.position.y += drop;
      ch.group.updateMatrixWorld(true);
      lieFit = "re-seated";
    }
    const finalBox = new T.Box3().setFromObject(ch.group);
    actors.push(ch);
    stagegroup.add(ch.group);
    info.mattressTop = round(top);
    info.sleeperRise = round(finalBox.max.y - top);
    info.rolled = rolled;
    info.lieFit = lieFit;
    stateText = feat.lyingPose ? "SLEEP POSE · ch.lying" : "STANDING RIG ROLLED 90°";

  } else if (S.id === "bedroom-vignette") {
    // world/roombuild.js bedroom program: headboard to a wall, wardrobe on the
    // next wall along, lamp at the head end of the bed. Placed by hand here —
    // roomPlan needs a lot rect and a live world, neither of which a studio has.
    piece("bed", -0.85, 0, 0.15, -HALF_PI, { len: 2.1, wide: 1.4, tone: "warm" });
    piece("locker", 0.45, 0, -1.10, 0, { n: 3, tone: "warm" });
    piece("lamp", -1.85, 0, -0.80, 0, { h: 1.35, ei: 0.75 });
    info.pieces = placed.length;
    stateText = placed.length + " PIECES · " + boxes + " BOXES";

  } else if (S.id === "lounge-vignette") {
    const sofa = piece("sofa", 0, 0, -0.95, 0, { len: 2.4, tone: "warm" });
    const front = sofa ? (sofa.d * 0.5) : 0.43;
    coffeeTable(0, -0.95 + front + 0.42 + 0.30, 0);
    loungeChair(1.62, 0.10, -HALF_PI);
    piece("lamp", -1.62, 0, -0.85, 0, { h: 1.55, ei: 0.7 });
    info.pieces = placed.length;
    stateText = placed.length + " PIECES · " +
      (feat.armchair ? "F.armchair" : "F.chair") + " + " +
      (feat.coffee ? "F.coffee" : "F.table");

  } else {
    return { ok: false, missing: "unknown-subject:" + S.id };
  }

  // ---- scene: interior light + a corner of a neutral room -------------------
  const scene = new T.Scene();
  scene.background = new T.Color(0x141920);
  scene.add(new T.HemisphereLight(0xe6ecff, 0x2b2118, 0.95));
  const key = new T.DirectionalLight(0xffe4bd, 1.55);
  key.position.set(6.5, 9.5, 6.0); scene.add(key);
  const rim = new T.DirectionalLight(0x86b4ff, 0.62);
  rim.position.set(-7.0, 4.5, -6.5); scene.add(rim);
  const fill = new T.DirectionalLight(0xffffff, 0.24);
  fill.position.set(2.0, 3.0, -8.0); scene.add(fill);
  scene.add(stagegroup);

  stagegroup.updateMatrixWorld(true);
  const contents = new T.Box3().setFromObject(stagegroup);
  const size = contents.getSize(new T.Vector3());
  const center = contents.getCenter(new T.Vector3());

  const aspect = input.width / input.height;
  const referenceCamera = input.referenceStage && input.referenceStage.camera;
  const framedHeight = referenceCamera
    ? referenceCamera.framedHeight
    : Math.max(
        size.y * 1.30 + (size.x + size.z) * 0.20,
        ((0.82 * size.x + 0.66 * size.z + 0.55) * 1.14) / aspect,
        1.9
      );
  const dir = [0.78, 0.52, 1.0];
  const dirLen = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
  const cameraTarget = referenceCamera ? referenceCamera.target : [center.x, center.y * 0.94, center.z];
  const cameraPosition = referenceCamera ? referenceCamera.position : [
    cameraTarget[0] + (dir[0] / dirLen) * 26,
    cameraTarget[1] + (dir[1] / dirLen) * 26,
    cameraTarget[2] + (dir[2] / dirLen) * 26,
  ];
  const cameraUp = referenceCamera ? referenceCamera.up : [0, 1, 0];

  // The room shell is framing furniture, not part of it: sized off the SAME
  // camera the before side chose, so both plates get the same backdrop.
  const room = input.referenceStage && input.referenceStage.room ? input.referenceStage.room : {
    wide: Math.max(6.0, framedHeight * aspect * 1.7),
    tall: Math.max(2.75, framedHeight * 1.25),
    backZ: Math.min(contents.min.z - 0.30, center.z - 1.35),
    leftX: Math.min(contents.min.x - 0.30, center.x - 1.65),
  };
  const floor = new T.Mesh(
    new T.PlaneGeometry(room.wide, room.wide),
    new T.MeshStandardMaterial({ color: 0x6a5a49, roughness: 0.94 })
  );
  floor.rotation.x = -HALF_PI;
  floor.position.set(center.x, -0.005, center.z);
  scene.add(floor);
  const wallMat = new T.MeshStandardMaterial({ color: 0x9a938a, roughness: 0.97 });
  const backWall = new T.Mesh(new T.PlaneGeometry(room.wide, room.tall), wallMat);
  backWall.position.set(center.x, room.tall / 2, room.backZ);
  scene.add(backWall);
  const leftWall = new T.Mesh(new T.PlaneGeometry(room.wide, room.tall), wallMat);
  leftWall.rotation.y = HALF_PI;
  leftWall.position.set(room.leftX, room.tall / 2, center.z);
  scene.add(leftWall);
  const skirt = new T.Mesh(
    new T.BoxGeometry(room.wide, 0.11, 0.05),
    new T.MeshStandardMaterial({ color: 0xd6cfc4, roughness: 0.9 })
  );
  skirt.position.set(center.x, 0.055, room.backZ + 0.03);
  scene.add(skirt);

  const camera = new T.OrthographicCamera(
    -framedHeight * aspect / 2, framedHeight * aspect / 2,
    framedHeight / 2, -framedHeight / 2, 0.01, 260
  );
  camera.position.fromArray(cameraPosition);
  camera.up.fromArray(cameraUp);
  camera.lookAt(new T.Vector3().fromArray(cameraTarget));
  camera.updateProjectionMatrix();
  studio.scene = scene;
  studio.camera = camera;
  studio.renderer.setSize(input.width, input.height, false);
  studio.renderer.render(scene, camera);

  // ---- honest numbers off the staged rig ------------------------------------
  const metrics = { boxesDrawn: boxes };
  if (info.cushion) metrics.cushionH = info.cushion;
  if (info.mattressTop) metrics.surfaceH = info.mattressTop;
  else if (info.worktop) metrics.surfaceH = info.worktop;
  if (info.sleeperRise != null) metrics.sleeperRise = info.sleeperRise;
  if (actors.length && S.kind === "sit") {
    const ch = actors[0];
    ch.group.updateMatrixWorld(true);
    const bodyBox = new T.Box3().setFromObject(ch.group);
    metrics.soleY = round(bodyBox.min.y);
    metrics.torsoPitch = round(ch.body ? ch.body.rotation.x : 0);
    info.seatSink = round(ch.model ? ch.model.position.y : 0);
  }

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
  focusEl.style.cssText = "position:absolute;top:106px;left:30px;color:#cdbfae;font-size:13px;font-weight:550;max-width:720px";
  stateEl.textContent = stateText;
  stateEl.style.cssText = "position:absolute;right:26px;top:25px;color:" +
    (before ? "#ff9c9c" : "#80e4b4") + ";font-size:11px;font-weight:850;letter-spacing:.11em;text-align:right;max-width:420px";
  detailText = "pieces " + placed.map(function (p) { return p.piece; }).join(" + ") +
    " · boxes " + boxes +
    " · seatKind " + (feat.seatKind ? "yes" : "no") +
    " · lying " + (feat.lyingPose ? "yes" : "no") +
    (failures.length ? " · MISSING " + failures.join(",") : "");
  detailEl.textContent = detailText;
  detailEl.style.cssText = "position:absolute;right:26px;bottom:20px;color:#a79a8b;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;max-width:520px";
  sourceEl.textContent = new URL(input.sourceUrl).host + new URL(input.sourceUrl).pathname;
  sourceEl.style.cssText = "position:absolute;bottom:20px;left:28px;color:#9cb0bf;font:11px ui-monospace,SFMono-Regular,Menlo,monospace";

  return {
    ok: true,
    subject: S.id,
    features: feat,
    pieces: placed.map(function (p) {
      return {
        piece: p.piece,
        w: round(p.w), d: round(p.d), h: round(p.h), top: round(p.top),
        seats: p.seats ? p.seats.length : 0,
        cushions: p.seats ? p.seats.map(function (s) { return round(s.cushion); }) : [],
      };
    }),
    missingPieces: failures,
    info: info,
    bounds: [round(size.x), round(size.y), round(size.z)],
    metrics: metrics,
    room: room,
    camera: {
      framedHeight: framedHeight,
      position: cameraPosition.slice(),
      target: cameraTarget.slice(),
      up: cameraUp.slice(),
    },
  };
}

export default {
  id: "interiors",
  title: "Interiors: Furniture You Can Read, Bodies That Use It",
  description: "Twelve studio plates from the interiors wave. Every piece is drawn by the live CBZ.furnish kit inside the page being photographed, and every body is the real character rig posed by CBZ.animChar. The deployed baseline has the old pieces, no armchair or coffee table, one generic seated pose for every seat, and a sleeper that is the standing rig tipped 90° onto the mattress; the local build rebuilds the pieces, drives posture from the seat's kind, and gives the sleeper a real lying pose.",
  beforeLabel: "BEFORE · DEPLOYED",
  afterLabel: "AFTER · LOCAL",
  viewport: { width: 1100, height: 680 },
  readyExpression: "window.THREE && window.CBZ && CBZ.furnish && CBZ.furnish.chair && CBZ.makeCharacter && CBZ.animChar",
  metricsNote: "Measured inside each build while the plate was staged: boxes the furnish kit actually drew, the cushion/surface heights it declared, where the sitter's soles and torso ended up, and how high the sleeper stands above the mattress.",
  metrics: {
    boxesDrawn: { label: "Boxes drawn" },
    cushionH: { label: "Declared cushion", unit: "m" },
    surfaceH: { label: "Usable surface", unit: "m" },
    soleY: { label: "Sole height off floor", unit: "m" },
    torsoPitch: { label: "Torso pitch", unit: "rad" },
    sleeperRise: { label: "Sleeper above mattress", unit: "m", better: "lower" },
  },
  subjects,
  stage: stageInterior,
};
