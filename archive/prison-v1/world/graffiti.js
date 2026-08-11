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

   ------------------------------------------------------------
   2026-07-30 — DETERMINISM, DERIVED WALLS, AND SCRATCH MARKS.
   ------------------------------------------------------------
   THREE CHANGES, IN ORDER OF HOW MUCH THEY MATTER.

   (1) IT USED Math.random AT LOAD TIME. This is a world-build path —
   CLAUDE.md's first hard rule — so the wall art reshuffled on every
   reload and differed between clients. It now runs on the named
   stream `seedStream("prison-graffiti")`, isolated by construction,
   exactly the fix world/clutter.js already made for the yard props.
   Same look, same statistics, reproducible.

   (2) THE WALL COORDINATES WERE LITERALS. -29.5 / 29.5 / -43.5 were
   typed in, so moving a wall in CBZ.WORLD left the paint floating in
   mid-air. Every face is now DERIVED from CBZ.WORLD (the rect the
   perimeter, the towers, the razorwire, the clamp and the minimap all
   already read), with the old literals kept as the degrade fallback.
   That is also what let the vocabulary reach three more surfaces
   without typing a single new number: the cell block's INTERIOR side
   walls and the south block's perimeter.

   (3) THE VOCABULARY WAS ALL PAINT. Every mark was sprayed — but the
   marks a cell actually carries are SCRATCHED: a day count, a name, a
   date, a crown for whoever runs the tier. Three monochrome scratch
   painters (crown, scratched notes, a multi-block cell count) join the
   sprayed ones, and they are the only kind placed inside the cells —
   nobody smuggles a can of paint into a cell, and that difference is
   the whole reason the inside should not look like the yard.
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
  // DETERMINISM: load-time world geometry must be byte-identical per seed on
  // every client. One named stream replaces ~30 Math.random() calls; being
  // named makes it isolated, so adding a painter here can never shift another
  // module's layout (the whole point of the seedStream API).
  const rnd = CBZ.seedStream ? CBZ.seedStream("prison-graffiti") : Math.random;
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

  // ---- the surfaces we can paint on, DERIVED from CBZ.WORLD --------------
  // Every wall in the compound is 1 unit thick and centred on its rect edge,
  // so an inner face is edge +/- 0.5. Deriving instead of typing is what stops
  // the art floating the next time a wall moves — and it is what let the three
  // new surfaces below be added without a single new literal.
  const W = CBZ.WORLD || {};
  const NY = W.northYard || { x0: -30, x1: 30, z0: -8, z1: 52 };
  const CB = W.cellBlock || { x0: -16, x1: 16, z0: -44, z1: -8 };
  const SB = W.southBlock || { x0: -44, x1: 44, z0: 52, z1: 128 };
  //  nx/nz = the face's outward normal (which way the paint looks)
  //  top   = the open wall top, so a decal can never poke over it
  const WALLS = {
    west: { x: NY.x0 + 0.5, nx: 1, nz: 0, top: YH },     // west yard wall
    east: { x: NY.x1 - 0.5, nx: -1, nz: 0, top: YH },    // east yard wall
    north: { z: CB.z0 + 0.5, nx: 0, nz: 1, top: WH },    // north cell-block wall
    cellW: { x: CB.x0 + 0.5, nx: 1, nz: 0, top: WH },    // INSIDE the cell block, west
    cellE: { x: CB.x1 - 0.5, nx: -1, nz: 0, top: WH },   // INSIDE the cell block, east
    southW: { x: SB.x0 + 0.5, nx: 1, nz: 0, top: YH },   // south-block perimeter, west
    southE: { x: SB.x1 - 0.5, nx: -1, nz: 0, top: YH },  // south-block perimeter, east
    southS: { z: SB.z1 - 0.5, nx: 0, nz: -1, top: YH },  // the far south wall (the gate wall)
  };

  // place a plane flush on a wall face.
  //  side  = a key of WALLS
  //  along = position along the wall (z on an x-facing wall, x on a z-facing one)
  //  y = centre height, w/h = plane size, rotZ = optional in-plane spin
  const OFF = 0.1; // standoff from the wall surface
  function placeDecal(side, along, y, w, h, mat, rotZ) {
    const F = WALLS[side] || WALLS.west;
    const geo = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(geo, mat);
    if (F.nx) m.position.set(F.x + F.nx * OFF, y, along);
    else m.position.set(along, y, F.z + F.nz * OFF);
    m.rotation.y = Math.atan2(F.nx, F.nz);      // +x face -> PI/2, +z face -> 0
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

  // ========================================================================
  //  SCRATCH VOCABULARY — what a CELL wall carries
  // ========================================================================
  // Paint is a yard thing. Inside, the marks are cut into the render with
  // whatever somebody had: a spoon handle, a zip, a filed spork. So these
  // three are strictly MONOCHROME and strictly incised — the shared `scored`
  // helper draws every stroke twice, a dark groove with a bright lip one pixel
  // up-left, which is the whole trick that makes a line read as cut into
  // concrete instead of drawn onto it.
  function scored(g, draw, w) {
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "rgba(28,26,24,0.72)";      // the groove
    g.lineWidth = w;
    draw();
    g.strokeStyle = "rgba(232,228,216,0.55)";   // the fresh lip of the cut
    g.lineWidth = Math.max(0.8, w * 0.55);
    g.save(); g.translate(-1, -1); draw(); g.restore();
  }

  // A CROWN. Whoever runs the tier scratches one, and everybody knows whose
  // it is. Deliberately crude: five points off one baseline, uneven, with a
  // couple of stray reinforcing strokes where the hand went over it again.
  function paintCrown() {
    const cc = makeCtx(256, 256);
    if (!cc) return null;
    const c = cc.c, g = cc.g;
    const cx = 128, base = 178, halfW = rng(62, 86), peak = rng(52, 80);
    const pts = [];
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const x = cx - halfW + t * halfW * 2;
      // outer points ride lower than the centre spike — a crown, not a comb
      const dip = i % 2 ? 0.34 : 1.0;
      const lean = (i - 2) * rng(-3, 3);
      pts.push([x + lean, base - peak * dip * rng(0.86, 1.12)]);
    }
    // Freeze the jitter BEFORE `scored` runs, because scored() draws the same
    // path twice (groove + lip) and a fresh rng() inside the callback would
    // make the two passes different shapes — a blurred smear, not a cut.
    const valleys = [], skirtL = rng(2, 9), skirtR = rng(2, 9);
    for (let i = 1; i < pts.length; i++) valleys.push(base - rng(2, 12));
    scored(g, function () {
      g.beginPath();
      g.moveTo(cx - halfW - skirtL, base);
      for (let i = 0; i < pts.length; i++) {
        if (i) g.lineTo((pts[i - 1][0] + pts[i][0]) / 2, valleys[i - 1]);
        g.lineTo(pts[i][0], pts[i][1]);
      }
      g.lineTo(cx + halfW + skirtR, base);
      g.stroke();
    }, rng(3.5, 5.5));
    // the band across the bottom, gone over twice like a real scratch
    for (let i = 0; i < 2; i++) {
      const y = base + 6 + i * rng(7, 12);
      const j0 = rng(-2, 2), j1 = rng(-2, 2), e0 = rng(0, 6), e1 = rng(0, 6);
      scored(g, function () {
        g.beginPath();
        g.moveTo(cx - halfW - e0, y + j0);
        g.lineTo(cx + halfW + e1, y + j1);
        g.stroke();
      }, rng(2.5, 4));
    }
    return c;
  }

  // SCRATCHED NOTES — a name, a cell, a date, a sentence length. Short lines
  // in a thin hand, each on its own slight angle, some underscored. This is
  // the mark that makes a blank wall read as somewhere people were KEPT.
  const NOTES = [
    "C-7", "D BLOCK", "37 DAYS", "8 MORE", "M.R.", "J+A", "1994",
    "DAY 214", "NOT ME", "SOON", "COUNT", "LIFER", "K.O.", "RIP DOC",
  ];
  function paintNotes() {
    const cc = makeCtx(256, 128);
    if (!cc) return null;
    const c = cc.c, g = cc.g;
    const lines = 2 + ((rnd() * 3) | 0);
    for (let i = 0; i < lines; i++) {
      const txt = pick(NOTES);
      const size = rng(19, 30) | 0;
      const x = rng(18, 70), y = 26 + i * (rng(26, 34));
      if (y > 116) break;
      g.save();
      g.translate(x, y);
      g.rotate(rng(-0.12, 0.12));
      g.font = "600 " + size + "px Consolas, Courier New, monospace";
      g.textBaseline = "middle";
      // the same two-pass cut, as fill rather than stroke
      g.fillStyle = "rgba(28,26,24,0.66)";
      g.fillText(txt, 0, 0);
      g.fillStyle = "rgba(232,228,216,0.5)";
      g.fillText(txt, -1, -1);
      if (rnd() < 0.45) {
        // jitter frozen before the callback — see the note in paintCrown
        const w = g.measureText(txt).width + rng(-4, 8), dy = rng(-3, 3);
        scored(g, function () {
          g.beginPath();
          g.moveTo(-2, size * 0.62);
          g.lineTo(w, size * 0.62 + dy);
          g.stroke();
        }, 2);
      }
      g.restore();
    }
    return c;
  }

  // A CELL COUNT — not one tally row but a WALL of them, in blocks, at
  // different scales and pressures, the way a count kept for months actually
  // accumulates. Blocks are boxed off in fives-of-fives (a month a block).
  function paintCount() {
    const cc = makeCtx(256, 256);
    if (!cc) return null;
    const c = cc.c, g = cc.g;
    const cols = 2 + ((rnd() * 2) | 0), rows = 2 + ((rnd() * 3) | 0);
    for (let bx = 0; bx < cols; bx++) {
      for (let bz = 0; bz < rows; bz++) {
        const ox = 16 + bx * (232 / cols), oy = 22 + bz * (224 / rows);
        const hgt = Math.min(40, (224 / rows) - 12) * rng(0.7, 1.0);
        const groups = 1 + ((rnd() * 3) | 0);
        let x = ox;
        for (let gi = 0; gi < groups; gi++) {
          const w = rng(1.8, 3.2);
          for (let i = 0; i < 4; i++) {
            // jitter frozen before the callback — see the note in paintCrown
            const jx = x + rng(-1.2, 1.2), y0 = oy + rng(-2, 2);
            const jx2 = jx + rng(-2.5, 2.5), y1 = oy + hgt + rng(-2, 2);
            scored(g, function () {
              g.beginPath();
              g.moveTo(jx, y0);
              g.lineTo(jx2, y1);
              g.stroke();
            }, w);
            x += 5.5;
          }
          scored(g, function () {                      // the fifth, struck across
            g.beginPath();
            g.moveTo(x - 23, oy + hgt);
            g.lineTo(x + 2, oy);
            g.stroke();
          }, w);
          x += 12;
          if (x > ox + (232 / cols) - 24) break;
        }
      }
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
  const CRWN = "crown", NOTE = "notes", CNT = "count";   // the scratch vocabulary

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

  // ---- everything below is PRISON_DRESS_V2 (flag home: world/southblock.js).
  // The determinism and derived-wall fixes above are unconditional (they are
  // doctrine, and the derived numbers equal the old literals exactly); the new
  // SURFACES are the part a revert should take back, so they live behind the
  // one switch the rest of the prison dressing uses.
  if (CBZ.CONFIG.PRISON_DRESS_V2 == null) CBZ.CONFIG.PRISON_DRESS_V2 = true;
  if (CBZ.CONFIG.PRISON_DRESS_V2) plan.push.apply(plan, [
    // ---- INSIDE the cell block (faces +x / -x) ----
    // SCRATCH ONLY. Nobody paints a cell — they cut it, at arm's reach from a
    // bunk, which is why every y here is 1.5-2.3 and every kind is incised.
    // Kept clear of the bunks (x +/-12.5, z=-41), the toilet block (-14.4,-34)
    // and the cell bars (x -7..-4, z=-37.5) — all of which stand off these
    // walls, so nothing here is buried behind furniture.
    ["cellW", -41.0, 1.75, 1.7, 1.7, CNT,  [0.85, 1.0]],
    ["cellW", -34.0, 1.65, 1.5, 0.9, NOTE, [0.9, 1.0]],
    ["cellW", -25.5, 2.05, 1.4, 1.4, CRWN, [0.85, 1.0]],
    ["cellE", -41.0, 1.7,  1.5, 0.9, NOTE, [0.9, 1.0]],
    ["cellE", -33.0, 1.8,  1.8, 1.8, CNT,  [0.85, 1.0]],
    ["cellE", -22.0, 2.1,  1.3, 1.3, CRWN, [0.8, 0.95]],

    // ---- south block perimeter (the long walk to the gate) ----
    // The yard side of the newest, biggest, emptiest walls in the compound.
    // Sprayed again out here, plus one count where people wait.
    ["southW", 62,  3.0, 4.8, 2.5, TAGS, [0.9, 1.0]],
    ["southW", 84,  4.2, 3.2, 6.4, RUST, [0.85, 1.0]],
    ["southW", 120, 2.2, 2.0, 2.0, CNT,  [0.85, 1.0]],
    ["southE", 58,  2.8, 4.2, 2.2, SCR,  [0.7, 0.95]],
    ["southE", 76,  5.4, 4.2, 4.2, CRK,  [0.8, 1.0]],
    ["southE", 98,  3.1, 4.6, 2.4, TAGS, [0.9, 1.0]],
    ["southE", 118, 2.4, 1.9, 1.1, NOTE, [0.9, 1.0]],
    // the gate wall itself — the last thing you read on the way out, and the
    // one place a crown belongs in the open
    ["southS", -14, 2.7, 4.4, 2.3, TAGS, [0.9, 1.0]],
    ["southS", -25, 3.6, 2.4, 5.0, RUST, [0.85, 1.0]],
    ["southS", 13,  2.4, 1.9, 1.9, CRWN, [0.85, 1.0]],
  ]);

  function paintFor(kind) {
    switch (kind) {
      case TAGS: return paintTag();
      case SCR:  return paintScrawl();
      case RUST: return paintRust();
      case CRK:  return paintCrack();
      case TAL:  return paintTally();
      case CRWN: return paintCrown();
      case NOTE: return paintNotes();
      case CNT:  return paintCount();
      default:   return paintScrawl();
    }
  }
  const ASKEW = { tag: 1, scrawl: 1, tally: 1, crown: 1, notes: 1, count: 1 };

  // build them all, once, at load. Wrapped so a single canvas/painter
  // hiccup can't abort the module (partial decals are harmless scenery).
  try {
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i];
      const side = p[0], along = p[1], y = p[2], w = p[3], h = p[4];
      const kind = p[5], opr = p[6];
      // clamp height so a decal never pokes above the (open-topped) wall —
      // the top now comes from the WALL, not from a side-name test, so the
      // five surfaces added in 2026-07 are clamped correctly too
      const wallTop = ((WALLS[side] || WALLS.west).top) || YH;
      const yc = Math.min(y, wallTop - h / 2 - 0.4);
      const canvas = paintFor(kind);
      if (!canvas) continue;                   // ctx unavailable — skip cleanly
      const op = rng(opr[0], opr[1]);
      // hand-made marks sit a touch askew; weathering stays upright
      const rotZ = ASKEW[kind] ? rng(-0.08, 0.08) : 0;
      placeDecal(side, along, yc, w, h, decalMat(canvas, op), rotZ);
    }
  } catch (err) {
    if (typeof console !== "undefined" && console.error)
      console.error("[graffiti]", err);
  }
})();
