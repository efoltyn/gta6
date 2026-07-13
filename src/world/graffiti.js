/* ============================================================
   world/graffiti.js — Wall graffiti & grime.
   At LOAD ONLY (zero per-frame cost): procedurally paints a
   batch of transparent canvas textures — spray-paint tags,
   rust streaks, hairline cracks, and a few tally-mark "day
   counts" — then glues them flush against the existing yard
   and cell-block walls as thin decal planes.

   Walls are 1 unit thick, so their inner faces sit half a unit
   in from the centerline:
     west yard wall   centre x=-30 -> inner face x=-29.5  (faces +x)
     east yard wall   centre x= 30 -> inner face x= 29.5  (faces -x)
     north block wall centre z=-44 -> inner face z=-43.5  (faces +z)
   We park decals a hair (~0.1) off the face so they never z-fight
   the wall, and we keep clear of the south exit gap (not walled
   here anyway). Everything is MeshBasicMaterial (unlit) so the
   paint reads the same day or night and costs nothing to light.

   Pure scenery: like the walls themselves, it persists across
   runs (nothing run-specific is stored), so there is nothing to
   reset. We also never register per-frame work — matches the
   load-time-only world modules (clutter.js, etc.).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // Defensive load guard. Use typeof so a missing THREE global never
  // throws a ReferenceError (the rest of the API is on CBZ). Also make
  // sure the THREE bits we actually use exist before we touch them.
  if (!CBZ || !CBZ.scene) return;
  if (typeof THREE === "undefined" ||
      !THREE.CanvasTexture || !THREE.PlaneGeometry || !THREE.MeshBasicMaterial) return;
  if (typeof document === "undefined" || !document.createElement) return;

  const scene = CBZ.prisonRoot || CBZ.scene;
  const YH = (CBZ.DIM && CBZ.DIM.YH) || 11;   // yard wall height
  const WH = (CBZ.DIM && CBZ.DIM.WH) || 9;    // cell-block wall height
  const rnd = Math.random;
  const rng = (a, b) => a + (b - a) * rnd();
  const pick = (arr) => arr[(rnd() * arr.length) | 0];

  // ---- small helpers ---------------------------------------------------
  // make a canvas + 2d ctx, transparent by default. Returns null if the
  // 2d context can't be acquired (locked-down / context-lost env) so the
  // caller can skip cleanly instead of throwing on a null ctx.
  function makeCtx(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext && c.getContext("2d");
    if (!g) return null;
    return { c: c, g: g };
  }
  // wrap a canvas in an unlit, transparent, double-safe decal material
  function decalMat(canvas, opacity) {
    const t = new THREE.CanvasTexture(canvas);
    t.minFilter = THREE.LinearFilter;          // no mipmap chain (cheaper, npot-safe)
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    return new THREE.MeshBasicMaterial({
      map: t,
      transparent: true,
      opacity: opacity != null ? opacity : 1,
      depthWrite: false,                       // it's a translucent overlay
      side: THREE.FrontSide,
      fog: true,                               // let distance fog swallow it
    });
  }

  // place a plane flush on a wall face.
  //  side: 'west' (+x normal), 'east' (-x normal), 'north' (+z normal)
  //  along = position along the wall (z for E/W, x for north)
  //  y = centre height, w/h = plane size, rotZ = optional in-plane spin
  const OFF = 0.1; // standoff from the wall surface
  function placeDecal(side, along, y, w, h, mat, rotZ) {
    const geo = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(geo, mat);
    if (side === "west") {
      m.position.set(-29.5 + OFF, y, along);
      m.rotation.y = Math.PI / 2;              // face +x
    } else if (side === "east") {
      m.position.set(29.5 - OFF, y, along);
      m.rotation.y = -Math.PI / 2;             // face -x
    } else { // north cell-block wall
      m.position.set(along, y, -43.5 + OFF);
      m.rotation.y = 0;                         // face +z
    }
    if (rotZ) m.rotation.z = rotZ;
    m.castShadow = false;
    m.receiveShadow = false;
    m.renderOrder = 2;                          // draw after opaque walls
    scene.add(m);
    return m;
  }

  // ---- texture painters -------------------------------------------------
  const TAG_COLORS = [
    "#e8413a", "#f2a93b", "#3ad17a", "#3aa0f2", "#c46bff",
    "#ff5fa2", "#ffe24d", "#5ce0d0", "#ffffff", "#9affb0",
  ];
  const WORDS = [
    "Z BLOCK", "FREE", "404", "RUN", "NO HOPE", "DAY 99",
    "RIOT", "C-7", "OUTLAW", "GHOST", "KING", "X", "WHY",
    "BLOCK Z", "TICK TOCK", "SOON",
  ];

  // a chunky bubble-ish tag: stroked word + a couple of drips + an outline
  function paintTag() {
    const cc = makeCtx(256, 128);
    if (!cc) return null;
    const c = cc.c, g = cc.g;
    const col = pick(TAG_COLORS);
    const word = pick(WORDS);
    g.translate(128, 64);
    g.rotate(rng(-0.14, 0.14));

    // soft halo so the paint looks sprayed, not printed
    g.shadowColor = col;
    g.shadowBlur = 14;

    // dark keyline first, then the colored fill on top
    g.font = "bold 64px Fredoka, Arial Black, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.lineWidth = 9;
    g.strokeStyle = "rgba(10,12,16,0.85)";
    g.strokeText(word, 0, 0);
    g.shadowBlur = 6;
    g.fillStyle = col;
    g.fillText(word, 0, 0);

    // a thin highlight pass for that wet-paint glint
    g.shadowBlur = 0;
    g.lineWidth = 1.5;
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.strokeText(word, -1, -2);

    // a few drips running down from the letters
    const w = g.measureText(word).width;
    g.fillStyle = col;
    const drips = 2 + ((rnd() * 3) | 0);
    for (let i = 0; i < drips; i++) {
      const dx = rng(-w / 2, w / 2);
      const len = rng(14, 40);
      g.globalAlpha = 0.8;
      g.fillRect(dx, 18, 2.5, len);
      g.beginPath();
      g.arc(dx + 1.2, 18 + len, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    return c;
  }

  // overlapping spray scribbles — no words, just angry strokes
  function paintScrawl() {
    const cc = makeCtx(256, 128);
    if (!cc) return null;
    const c = cc.c, g = cc.g;
    g.lineCap = "round";
    const passes = 2 + ((rnd() * 2) | 0);
    for (let p = 0; p < passes; p++) {
      const col = pick(TAG_COLORS);
      g.strokeStyle = col;
      g.shadowColor = col;
      g.shadowBlur = 8;
      g.globalAlpha = rng(0.55, 0.9);
      g.lineWidth = rng(4, 11);
      g.beginPath();
      let x = rng(20, 90), y = rng(20, 108);
      g.moveTo(x, y);
      const segs = 4 + ((rnd() * 5) | 0);
      for (let s = 0; s < segs; s++) {
        x += rng(10, 50) * (rnd() < 0.5 ? 1 : 0.6);
        y += rng(-40, 40);
        // clamp control point too (not just the endpoint) so a runaway
        // segment can't draw a wild stroke way off canvas
        const cx = Math.max(0, Math.min(256, x - rng(10, 30)));
        const cy = Math.max(0, Math.min(128, y + rng(-30, 30)));
        g.quadraticCurveTo(cx, cy, Math.min(248, x), Math.max(8, Math.min(120, y)));
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    return c;
  }

  // vertical rust / water streaks weeping down the concrete
  function paintRust() {
    const cc = makeCtx(128, 256);
    if (!cc) return null;
    const c = cc.c, g = cc.g;
    const streaks = 4 + ((rnd() * 5) | 0);
    for (let i = 0; i < streaks; i++) {
      const x = rng(8, 120);
      const top = rng(0, 50);
      const len = rng(120, 250 - top);
      const w = rng(2, 9);
      const grd = g.createLinearGradient(0, top, 0, top + len);
      // tones of oxide brown -> faded
      const r = (120 + rng(-20, 40)) | 0;
      const gr = (60 + rng(-15, 30)) | 0;
      const b = (35 + rng(-10, 20)) | 0;
      grd.addColorStop(0, "rgba(" + r + "," + gr + "," + b + ",0)");
      grd.addColorStop(0.25, "rgba(" + r + "," + gr + "," + b + ",0.5)");
      grd.addColorStop(1, "rgba(" + r + "," + gr + "," + b + ",0.05)");
      g.fillStyle = grd;
      g.fillRect(x - w / 2, top, w, len);
      // a darker source blotch where the stain originates
      g.fillStyle = "rgba(70,40,20,0.4)";
      g.beginPath();
      g.ellipse(x, top + 4, w * 1.4, 5, 0, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  }

  // hairline cracks branching across the wall
  function paintCrack() {
    const cc = makeCtx(256, 256);
    if (!cc) return null;
    const c = cc.c, g = cc.g;
    g.strokeStyle = "rgba(20,22,26,0.7)";
    g.lineCap = "round";
    // cap recursion depth so a long branch chain can't blow the stack
    function branch(x, y, ang, len, w, depth) {
      if (len < 8 || w < 0.4 || depth > 9) return;
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      // slight kink for a natural fracture
      g.quadraticCurveTo(
        (x + nx) / 2 + rng(-8, 8),
        (y + ny) / 2 + rng(-8, 8),
        nx, ny
      );
      g.stroke();
      // a faint light edge so the crack reads as a groove
      g.strokeStyle = "rgba(255,255,255,0.12)";
      g.lineWidth = w * 0.5;
      g.beginPath(); g.moveTo(x + 1, y + 1); g.lineTo(nx + 1, ny + 1); g.stroke();
      g.strokeStyle = "rgba(20,22,26,0.7)";
      if (rnd() < 0.7) branch(nx, ny, ang + rng(-0.5, 0.5), len * rng(0.5, 0.8), w * 0.7, depth + 1);
      if (rnd() < 0.45) branch(nx, ny, ang + rng(-1.1, 1.1), len * rng(0.4, 0.7), w * 0.55, depth + 1);
    }
    branch(rng(40, 216), rng(20, 60), rng(1.0, 2.1), rng(40, 70), rng(2.5, 4), 0);
    return c;
  }

  // tally-mark "day count" — clusters of four-then-slash strokes
  function paintTally() {
    const cc = makeCtx(256, 128);
    if (!cc) return null;
    const c = cc.c, g = cc.g;
    g.strokeStyle = "rgba(20,18,16,0.85)";
    g.lineCap = "round";
    g.lineWidth = 4;
    const groups = 3 + ((rnd() * 4) | 0); // 3..6 groups of five
    let x = 12;
    for (let gi = 0; gi < groups; gi++) {
      const baseY = rng(20, 30);
      const h = rng(60, 78);
      for (let i = 0; i < 4; i++) {
        const jx = x + rng(-1.5, 1.5);
        g.beginPath();
        g.moveTo(jx, baseY + rng(-3, 3));
        g.lineTo(jx + rng(-3, 3), baseY + h + rng(-3, 3));
        g.stroke();
        x += 9;
      }
      // diagonal slash across the four
      g.beginPath();
      g.moveTo(x - 38, baseY + h);
      g.lineTo(x + 2, baseY);
      g.stroke();
      x += 22;
      if (x > 236) break;
    }
    return c;
  }

  // ---- placement plan ---------------------------------------------------
  // Hand-tuned spots that sit on real wall runs, biased low/eye-level.
  // Each: [side, along, y, w, h, kind, opacityRange]
  // We avoid z>=50 on the south (the exit gap region / unwalled south).
  // Yard walls run z roughly [-8, 52]; we stay within [-4, 48].
  // North block wall runs x [-16, 16]; we stay within [-14.5, 14.5]
  // (and dodge the barred windows centred at x=-11,0,11, y~6).
  const TAGS = "tag", SCR = "scrawl", RUST = "rust", CRK = "crack", TAL = "tally";

  const plan = [
    // ---- west yard wall (faces +x) ----
    ["west",  2,  3.0, 5.0, 2.6, TAGS, [0.9, 1.0]],
    ["west", 14,  2.4, 4.2, 2.2, SCR,  [0.7, 0.95]],
    ["west", 28,  4.0, 3.2, 6.4, RUST, [0.85, 1.0]],
    ["west", 40,  3.2, 4.6, 2.4, TAGS, [0.9, 1.0]],
    ["west", 22,  5.6, 4.0, 4.0, CRK,  [0.8, 1.0]],

    // ---- east yard wall (faces -x) ----
    ["east",  6,  2.8, 4.4, 2.3, TAGS, [0.9, 1.0]],
    ["east", 20,  3.6, 3.0, 6.0, RUST, [0.85, 1.0]],
    ["east", 33,  2.6, 4.6, 2.4, SCR,  [0.7, 0.95]],
    ["east", 45,  3.0, 4.0, 2.1, TAL,  [0.85, 1.0]],
    ["east", 12,  5.2, 4.2, 4.2, CRK,  [0.8, 1.0]],

    // ---- north cell-block wall (faces +z) ----  (windows at x=-11,0,11)
    // tags/tally tuck between windows; grime hugs the far corners so it
    // doesn't clip the barred-window recesses (which share this z-depth).
    ["north", -6.5, 2.6, 4.0, 2.1, TAGS, [0.9, 1.0]],
    ["north",  5.5, 2.4, 3.6, 1.9, TAL,  [0.85, 1.0]],
    ["north", -14.5, 3.4, 2.0, 4.8, RUST, [0.85, 1.0]],
    ["north", 14.5,  2.8, 2.0, 3.4, CRK,  [0.8, 1.0]],
  ];

  function paintFor(kind) {
    switch (kind) {
      case TAGS: return paintTag();
      case SCR:  return paintScrawl();
      case RUST: return paintRust();
      case CRK:  return paintCrack();
      case TAL:  return paintTally();
      default:   return paintScrawl();
    }
  }

  // build them all, once, at load. Wrapped so a single canvas/painter
  // hiccup can't abort the module (partial decals are harmless scenery).
  try {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const side = p[0], along = p[1], y = p[2], w = p[3], h = p[4];
      const kind = p[5], opr = p[6];
      // clamp height so a decal never pokes above the (open-topped) wall
      const wallTop = side === "north" ? WH : YH;
      const yc = Math.min(y, wallTop - h / 2 - 0.4);
      const canvas = paintFor(kind);
      if (!canvas) continue;                   // ctx unavailable — skip cleanly
      const op = rng(opr[0], opr[1]);
      // graffiti/scrawl/tally can sit a touch askew; grime stays upright
      const rotZ = (kind === TAGS || kind === SCR || kind === TAL)
        ? rng(-0.08, 0.08) : 0;
      placeDecal(side, along, yc, w, h, decalMat(canvas, op), rotZ);
    }
  } catch (err) {
    if (typeof console !== "undefined" && console.error)
      console.error("[graffiti]", err);
  }
})();
