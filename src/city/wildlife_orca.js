/* ============================================================
   city/wildlife_orca.js — THE ORCA: markings, the pod, and the blow.

   WHAT THIS FILE IS NOT: a fourth marine AI loop. That is the specific sin
   wildlife_shark.js's header exists to prevent, and by the time this file was
   written the sea already had three owners doing the work properly:

     systems/predator.js      the ONE stalking FSM (predatorHunt/predatorSeize/
                              predatorPack/predatorStagger) — medium-agnostic.
     city/creature_combat.js  the ONE animal-vs-animal strike driver, and the
                              tonic roll-over pose (CBZ.creatureTonicRoll).
     city/marine_predation.js the predation GRAPH — who preys on whom, who MOBS
                              whom, how many it takes (CBZ.marinePodNeeded),
                              the flank ram, and the roll-over finisher.
     city/wildlife_shark.js   the ONE water mover (a._shark.opts.move), which
                              swims through CBZ.waterField and honours the
                              shoreline-clearance law.

   So the megalodon takedown the owner asked for is NOT re-implemented here.
   It is CONSUMED: §7 asks marine_predation what the numbers say and contributes
   the two things that file cannot know — what an orca LOOKS like doing it, and
   a degrade path if that file is ever flagged off or absent. Everything this
   file owns is orca-specific and exists nowhere else:

     §1  THE MODEL. A re-registration of `id:"orca"` (CBZ.defineSpecies is
         last-write-wins, wildlife_species.js:43-51), which takes ownership of
         the animal from city/wildlife/aquatic.js with ZERO edits to that file.
         The old build was a hull with two painted rectangles on it. An orca is
         defined by its MARKINGS and by a dorsal fin that is different on a bull
         and a cow, and neither of those existed.
     §2  THE INDIVIDUAL. Sex, dorsal shape and marking variation, from
         CBZ.hash01 on the spawn point — order-independent, so tomorrow's
         species cannot resize yesterday's pod.
     §3  THE SURFACE READ. A tall black blade, a WHITE SPOUT, and a
         black-and-white body under the water. The most recognisable thing on a
         sea surface, and it draws independently of the body's LOD.
     §4  THE POD. Formation travel, a matriarch, and a calf glued into its
         mother's slipstream. marine_predation owns pod TACTICS (bearings, the
         ram); nobody owned pod TRAVEL, which is what you actually watch.
     §5  THE SURFACE ACTS. The blow, the spy-hop, the breach, the tail-lob and
         porpoising — every one of them visible from a boat, and none of them
         possible for a shark.
     §6  THE GRAB-AND-DRAG. From the owner's photographs: an orca that takes
         something does not bite and let go like a shark. It HOLDS, drags it
         under, thrashes it, and surfaces with it still in its mouth. That is
         predatorSeize's "drag" style plus a depth track this file drives.

   ORCAS ARE NOT SHARKS AND MUST NOT READ LIKE ONE. A shark is a lone stalker
   that commits. A pod is a hunting party that INVESTIGATES: it circles a boat
   and looks at it, it spy-hops to get an eye above water, it coordinates, and
   it breaks off DELIBERATELY rather than losing interest. §6's commit gate is
   the whole of that difference in one expression — an orca will look at you all
   day and only very rarely decide you are food.

   THE SEAM. This file capture-and-wraps CBZ.sharkBrain, the same pattern
   marine_predation.js uses on it one tag later (so the chain that actually
   runs is marine -> orca -> shark, which is the right priority order: a fight
   already in progress outranks pod travel, which outranks the shark's lone
   player hunt). Orcas never fall through to the shark's brain with dt > 0,
   which is deliberate: that is what stops a second, shark-shaped dorsal proxy
   being drawn on top of this file's own.

   ALLOCATION-FREE PER FRAME, distance-gated hard (a pod 8 km away costs two
   Math.hypot calls), and nothing in the world build or the model touches
   Math.random — CBZ.hash01 on the spawn point does every per-individual draw.

   FLAGS (one-line reverts, all default on):
     CBZ.CONFIG.ORCA_V1       the model. off -> aquatic.js's original build.
     CBZ.CONFIG.ORCA_POD      the pod. SHARED WITH marine_predation.js, which
                              declares the same switch for its tactical layer,
                              so one revert takes the whole pod concept out.
     CBZ.CONFIG.ORCA_SURFACE  the fin/spout/silhouette proxy.
     CBZ.CONFIG.ORCA_ACTS     spy-hop, breach, tail-lob, porpoising, the blow.
     CBZ.CONFIG.ORCA_DRAG     the grab-and-drag (off -> an ordinary seize).
     CBZ.CONFIG.ORCA_HUNT     the investigate/commit brain.

   PUBLIC API
     CBZ.orcaBrain(a, dt, P)        the tick (installed on CBZ.sharkBrain)
     CBZ.orcaIdentity(a)            {sex, bull, cow, calf, dorsalSpan, ...}
     CBZ.orcaSurfaceRead(a)         what is above the water, in metres
     CBZ.orcaPodRead(a)             formation, station, matriarch, calf
     CBZ.orcaTakedown(orca, quarry) {needed, have, verdict}
     CBZ.orcaStage(a, act, arg)     force an act (staging/tests only)
     CBZ.orcaAudit()                counters (no gameplay reads it)
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const T = window.THREE;
  if (!T) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  if (CFG.ORCA_V1 == null) CFG.ORCA_V1 = true;
  if (CFG.ORCA_POD == null) CFG.ORCA_POD = true;
  if (CFG.ORCA_SURFACE == null) CFG.ORCA_SURFACE = true;
  if (CFG.ORCA_ACTS == null) CFG.ORCA_ACTS = true;
  if (CFG.ORCA_DRAG == null) CFG.ORCA_DRAG = true;
  if (CFG.ORCA_HUNT == null) CFG.ORCA_HUNT = true;
  function MODEL() { return CFG.ORCA_V1 !== false; }
  function POD() { return CFG.ORCA_POD !== false; }
  function SURF() { return CFG.ORCA_SURFACE !== false; }
  function ACTS() { return CFG.ORCA_ACTS !== false; }
  function DRAG() { return CFG.ORCA_DRAG !== false; }
  function HUNT() { return CFG.ORCA_HUNT !== false; }

  const AUDIT = {
    blows: 0, spyhops: 0, breaches: 0, tailLobs: 0, porpoises: 0,
    grabs: 0, drags: 0, breakoffs: 0, commits: 0, formations: 0, calves: 0,
  };

  // ---- tiny maths (module scope: nothing below allocates per frame) --------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sample(arr, t) {
    if (!arr.length) return 0;
    if (arr.length === 1) return arr[0];
    const f = clamp(t, 0, 1) * (arr.length - 1);
    const i = Math.min(arr.length - 2, Math.floor(f));
    return lerp(arr[i], arr[i + 1], f - i);
  }
  function shortest(a) {
    while (a > Math.PI) a -= 6.283185307;
    while (a < -Math.PI) a += 6.283185307;
    return a;
  }
  function h01(x, z, salt) {
    if (typeof CBZ.hash01 === "function") { try { return CBZ.hash01(x, z, salt | 0); } catch (e) {} }
    let h = (Math.imul((x * 8192) | 0, 2654435761) ^ Math.imul((z * 8192) | 0, 2246822519) ^ ((salt | 0) * 374761393)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  function clock() {
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001;
    return t % 3600;
  }
  function norm3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }

  // ============================================================
  //  §0. THE GEOMETRY KIT.
  //
  //  city/wildlife/aquatic.js has an excellent shell/blade kit and publishes
  //  exactly ONE of it (CBZ.aquaticFin). Everything else — the ring hull, the
  //  MERGED multi-blade mesh a cetacean fluke has to be, the on-skin plate — is
  //  module-private in that file, and this file may not edit it (five agents
  //  are in it). So the kit below is deliberately NOT a copy of that one: it
  //  adds the thing an orca needs and a shark does not, which is CONFORMING
  //  MARKING PATCHES — a crisp oval laid on the curved skin at any hull
  //  resolution. A marking painted into hull faces is as coarse as the hull;
  //  the eye patch is the identifying mark of the animal and cannot be a
  //  five-quad staircase.
  //
  //  If aquatic.js ever publishes its own hull/merged-blade builders, the two
  //  probes below pick them up at RUNTIME and this kit becomes the fallback.
  //  Checked, never assumed — that file is being edited concurrently.
  // ============================================================
  const GEOM = new Map();
  function cached(key, make) {
    let g = GEOM.get(key);
    if (!g) { g = make(); g._shared = true; GEOM.set(key, g); }
    return g;
  }

  function Shell() { this.p = []; this.k = new Map(); this.g = []; }
  Shell.prototype.v = function (x, y, z) {
    const key = ((x * 8192) | 0) + "," + ((y * 8192) | 0) + "," + ((z * 8192) | 0);
    let i = this.k.get(key);
    if (i === undefined) { i = this.p.length / 3; this.p.push(x, y, z); this.k.set(key, i); }
    return i;
  };
  Shell.prototype.tri = function (g, a, b, c) {
    if (a === b || b === c || a === c) return;
    (this.g[g] || (this.g[g] = [])).push(a, b, c);
  };
  Shell.prototype.quad = function (g, a, b, c, d) { this.tri(g, a, b, c); this.tri(g, a, c, d); };
  Shell.prototype.geom = function () {
    const idx = [], groups = [];
    let start = 0;
    for (let i = 0; i < this.g.length; i++) {
      const arr = this.g[i];
      if (!arr || !arr.length) continue;
      for (let j = 0; j < arr.length; j++) idx.push(arr[j]);
      groups.push([start, arr.length, i]);
      start += arr.length;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(this.p, 3));
    geo.setIndex(idx);
    for (let i = 0; i < groups.length; i++) geo.addGroup(groups[i][0], groups[i][1], groups[i][2]);
    geo.computeVertexNormals(); geo.computeBoundingBox(); geo.computeBoundingSphere();
    return geo;
  };
  // one slot used => hand the mesh a single material so r128 issues ONE draw
  // call and never looks at the groups.
  function meshOf(geo, mats) {
    let used = 0;
    for (let i = 0; i < geo.groups.length; i++) used = Math.max(used, geo.groups[i].materialIndex + 1);
    return new T.Mesh(geo, used > 1 ? mats : mats[0]);
  }

  function ringsOf(x0, x1, y, hProf, wProf, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      out.push({ x: lerp(x0, x1, t), y: y, ry: sample(hProf, t), rz: sample(wProf, t) });
    }
    return out;
  }
  function ringAt(rings, x) {
    let i = 0;
    while (i < rings.length - 2 && rings[i + 1].x < x) i++;
    const a = rings[i], b = rings[i + 1];
    const t = b.x === a.x ? 0 : clamp((x - a.x) / (b.x - a.x), 0, 1);
    return { y: lerp(a.y, b.y, t), ry: lerp(a.ry, b.ry, t), rz: lerp(a.rz, b.rz, t) };
  }

  /* THE HULL. Elliptical cross-sections; every face is assigned a material slot
     by `paint`, which is handed the ring index, the normalised station u (0 =
     tail, 1 = nose), the column, the ring angle, and the FOLDED angle af — the
     angle mirrored onto one flank, so a marking written once appears on both
     sides and cannot drift apart. That fold is the whole reason this is not
     aquatic.js's bellyCut number. */
  function hullGeom(o) {
    const rings = o.rings, n = rings.length, sides = Math.max(8, o.sides || 20);
    const paint = o.paint;
    const sh = new Shell(), id = [];
    for (let i = 0; i < n; i++) {
      const r = rings[i], row = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        row.push(sh.v(r.x, r.y + Math.sin(a) * r.ry, Math.cos(a) * r.rz));
      }
      id.push(row);
    }
    function slot(i, j) {
      const a0 = (j / sides) * Math.PI * 2, a1 = ((j + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;
      const s = Math.sin(am);
      const af = Math.atan2(s, Math.abs(Math.cos(am)));      // folded onto one flank
      const u = n > 1 ? i / (n - 1) : 0;
      return paint ? paint(i, u, j, am, af, s) : 0;
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const nj = (j + 1) % sides;
        sh.quad(slot(i, j), id[i][j], id[i + 1][j], id[i + 1][nj], id[i][nj]);
      }
    }
    const rear = sh.v(rings[0].x, rings[0].y, 0);
    const fr = rings[n - 1], front = sh.v(fr.x, fr.y, 0);
    for (let j = 0; j < sides; j++) {
      const nj = (j + 1) % sides;
      sh.tri(slot(0, j), rear, id[0][j], id[0][nj]);
      sh.tri(slot(n - 1, j), front, id[n - 1][nj], id[n - 1][j]);
    }
    return sh.geom();
  }

  /* THE BLADE. Chord along +x, span root->apex along +y, thickness along ±z,
     baked into whatever basis the caller asks for. Four corners (root-leading,
     apex, free rear tip, root-trailing), a bowed leading edge and a CONCAVE
     trailing edge — the grammar aquatic.js established, kept identical on
     purpose so an orca's fins and a shark's read as the same ocean.

     What is added: `underSlot`. A horizontal fluke's "underside" is a face
     normal direction, not a name, so the caller says which local-z sign gets
     the white — which is how the flukes get WHITE UNDERSIDES and the pectorals
     stay black on both faces. */
  function emitBlade(sh, o) {
    const span = o.span, cr = o.chordRoot;
    const xL0 = cr * 0.5, xT0 = -cr * 0.5;
    const xA = xL0 - span * Math.tan(o.sweep || 0);
    const ct = o.chordTip == null ? cr * 0.16 : o.chordTip;
    const hR = o.rearTipH == null ? 0.14 : o.rearTipH;
    const xR = xT0 - (o.rearTipBack == null ? span * 0.12 : o.rearTipBack);
    const con = o.concavity == null ? 0.20 : o.concavity;
    const bow = o.leadBow == null ? 0.05 : o.leadBow;
    const ar = o.apexRound == null ? 0.16 : o.apexRound;
    const th0 = o.thick == null ? cr * 0.14 : o.thick;
    const nS = o.spanSteps || 6, nC = o.chordSteps || 4;
    const top = o.slot == null ? 0 : o.slot;
    const bot = o.underSlot == null ? top : o.underSlot;

    const u = norm3(o.chordDir || [1, 0, 0]);
    let v = o.spanDir || [0, 1, 0];
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    v = norm3([v[0] - u[0] * d, v[1] - u[1] * d, v[2] - u[2] * d]);
    const w = norm3(cross3(u, v));
    const og = o.origin || [0, 0, 0];
    function pt(x, y, z) {
      return [og[0] + u[0] * x + v[0] * y + w[0] * z,
        og[1] + u[1] * x + v[1] * y + w[1] * z,
        og[2] + u[2] * x + v[2] * y + w[2] * z];
    }
    function lead(h) { return xL0 + (xA - xL0) * h + bow * span * Math.sin(Math.PI * h); }
    function trail(h) {
      if (h <= hR) return xT0 + (xR - xT0) * (hR > 0 ? h / hR : 1);
      const t = (h - hR) / (1 - hR || 1);
      return xR + ((xA - ct) - xR) * t + con * span * Math.sin(Math.PI * t);
    }
    function wide(h) {
      if (ar <= 0 || h <= 1 - ar) return 1;
      const t = (h - (1 - ar)) / ar;
      return Math.sqrt(Math.max(0, 1 - t * t));
    }
    const rows = [];
    for (let i = 0; i <= nS; i++) {
      const h = i / nS;
      const xl = lead(h), xt = trail(h);
      const mid = (xl + xt) * 0.5;
      const half = Math.max(0.0008, (xl - xt) * 0.5) * wide(h);
      const tk = th0 * Math.pow(1 - h, 1.25) + th0 * 0.04;
      const tp = [], bt = [];
      for (let j = 0; j <= nC; j++) {
        const s = j / nC;
        const x = mid + half * (2 * s - 1);
        const prof = Math.pow(Math.max(0, 4 * s * (1 - s)), 0.55);
        const z = tk * 0.5 * prof;
        tp.push(sh.v.apply(sh, pt(x, span * h, z)));
        bt.push(sh.v.apply(sh, pt(x, span * h, -z)));
      }
      rows.push([tp, bt]);
    }
    for (let i = 0; i < nS; i++) {
      for (let j = 0; j < nC; j++) {
        sh.quad(top, rows[i][0][j], rows[i][0][j + 1], rows[i + 1][0][j + 1], rows[i + 1][0][j]);
        sh.quad(bot, rows[i][1][j], rows[i + 1][1][j], rows[i + 1][1][j + 1], rows[i][1][j + 1]);
      }
    }
    for (let j = 0; j < nC; j++) sh.quad(top, rows[0][0][j], rows[0][1][j], rows[0][1][j + 1], rows[0][0][j + 1]);
  }
  // One or MORE blades in ONE mesh. A cetacean fluke has to be a single object:
  // wildlife_rig.js decides fish-vs-whale from the proportions of the rear-most
  // child, and two separate lobes each read as a tall narrow caudal fin — the
  // orca would then swim like a shark. aquatic.js documents the same trap.
  function bladeMesh(mats, at, shapes, key) {
    const list = Array.isArray(shapes) ? shapes : [shapes];
    const geo = cached("orcaBlade|" + (key || JSON.stringify(list)), function () {
      const sh = new Shell();
      for (let i = 0; i < list.length; i++) emitBlade(sh, list[i]);
      return sh.geom();
    });
    const m = meshOf(geo, mats);
    if (at) m.position.set(at[0], at[1], at[2]);
    return m;
  }

  /* THE CONFORMING MARKING PATCH. A disc in (station, angle) space whose every
     vertex is placed ON the hull surface and pushed out along the local normal
     by `lift`, so the mark curves over the flank instead of hovering in front
     of it. `radius(th)` lets a round eye patch and a crescent saddle be the
     same eighty triangles. Emitted on BOTH flanks from one description, which
     is what guarantees the two sides of the animal cannot disagree. */
  function patchGeom(o) {
    const rings = o.rings, seg = o.seg || 18, rad = o.rad || 3;
    const ca = Math.cos(o.tilt || 0), sa = Math.sin(o.tilt || 0);
    const rr = o.radius || function () { return 1; };
    const sh = new Shell();
    for (let side = 0; side < 2; side++) {
      const flip = side ? -1 : 1;
      const grid = [];
      for (let r = 0; r <= rad; r++) {
        const fr = r / rad, row = [];
        for (let j = 0; j < seg; j++) {
          const th = (j / seg) * Math.PI * 2;
          const k = fr * rr(th);
          const a = o.rx * k * Math.cos(th), b = o.rArc * k * Math.sin(th);
          const x = o.x + (a * ca - b * sa);
          const ang = o.ang + (a * sa + b * ca) / Math.max(0.05, o.arcR || 0.8);
          const rg = ringAt(rings, x);
          const sn = Math.sin(ang), cs = Math.cos(ang) * flip;
          const nx = 0, ny = sn / Math.max(0.02, rg.ry), nz = cs / Math.max(0.02, rg.rz);
          const nl = Math.hypot(nx, ny, nz) || 1;
          row.push(sh.v(x + nx / nl * o.lift,
            rg.y + sn * rg.ry + ny / nl * o.lift,
            cs * rg.rz + nz / nl * o.lift));
        }
        grid.push(row);
      }
      for (let r = 0; r < rad; r++) {
        for (let j = 0; j < seg; j++) {
          const nj = (j + 1) % seg;
          if (flip > 0) sh.quad(0, grid[r][j], grid[r][nj], grid[r + 1][nj], grid[r + 1][j]);
          else sh.quad(0, grid[r][j], grid[r + 1][j], grid[r + 1][nj], grid[r][nj]);
        }
      }
    }
    return sh.geom();
  }

  // ============================================================
  //  §1. THE ORCA. Every number below is read off the owner's reference
  //  photographs, and every one of them is something the previous build did
  //  not have.
  //
  //  Model frame: nose toward +X, the animal riding at y = HY, length HLEN.
  //  The dimensions match the build this replaces to within a few centimetres
  //  ON PURPOSE — clearance, swim depth, the jaw socket, marine_predation's
  //  measured body length and the pod-size threshold it solves are all read
  //  off the model, and a hero-model pass is not the place to silently move a
  //  balance number.
  // ============================================================
  const HX0 = -2.35, HX1 = 3.25, HY = 1.05, HLEN = HX1 - HX0;   // 5.60 model units
  const RY = [0.18, 0.44, 0.68, 0.85, 0.92, 0.92, 0.86, 0.72, 0.34];
  const RZ = [0.14, 0.38, 0.60, 0.75, 0.82, 0.82, 0.78, 0.66, 0.30];
  const HULL_RINGS = 34, HULL_SIDES = 24;
  /* THE COUNTERSHADING LINE, as the sine of the ring angle below which a face
     is WHITE. Tail -> nose. The nose end goes POSITIVE: an orca's white chin
     and throat climb well up the lower head, which is why the animal reads
     white-faced from below and from the front. */
  const CUT = [-0.28, -0.58, -0.70, -0.70, -0.66, -0.58, -0.46, -0.12, 0.26];
  const EYE_X = 2.45, EYE_AF = -0.10;
  const PATCH_X = 2.30, PATCH_AF = 0.31;      // above AND behind the eye
  const SADDLE_X = 0.05, SADDLE_AF = 1.17;    // behind and below the dorsal
  const DORSAL_X = 0.35, DORSAL_Y = 1.90;
  const BLOW_X = 2.05, BLOW_Y = 1.86;
  const JAW_X = 1.52, JAW_Y = 0.60;

  const BULL_DORSAL = {
    span: 1.62, chordRoot: 1.06, chordTip: 0.09, sweep: 0.09, concavity: 0.035,
    leadBow: 0.020, rearTipH: 0.07, rearTipBack: 0.24, apexRound: 0.09,
    thick: 0.19, spanSteps: 7, chordSteps: 4, spanDir: [0, 1, 0], chordDir: [1, 0, 0],
  };
  const COW_DORSAL = {
    span: 0.94, chordRoot: 0.88, chordTip: 0.06, sweep: 0.66, concavity: 0.38,
    leadBow: 0.065, rearTipH: 0.08, rearTipBack: 0.20, apexRound: 0.17,
    thick: 0.14, spanSteps: 6, chordSteps: 4, spanDir: [0, 1, 0], chordDir: [1, 0, 0],
  };

  /* WHAT COLOUR IS THIS FACE. The four facts the reference sheet is really
     asking for, in one function:
       1. jet black over crisp white with a HARD, slightly ragged boundary —
          a gradient here is the single thing that makes an orca look fake;
       2. THE FLANK FLARE — the belly white sweeps UP the flank in a lobe
          behind the pectoral and flares BACK toward the tail. That is a skewed
          gaussian on the cut line, wider on the tail side, and it is the one
          marking people never remember and always notice missing;
       3. white chin and throat (the nose end of CUT);
       4. the eye patch and the saddle are NOT painted here — they are their own
          conforming meshes, because at 24 columns a painted oval is a
          staircase, and the eye patch is the identifying mark of the animal. */
  function orcaPaint(i, u, j, ang, af, s) {
    const jit = (h01(j * 7 + 1, 0, 0x0C1) - 0.5) * 0.055
      + (h01(j * 7 + 1, i * 13 + 3, 0x0C2) - 0.5) * 0.030;
    let cut = sample(CUT, u) + jit;
    const d = u - 0.255;
    const w = d < 0 ? 0.185 : 0.135;                 // skewed: it flares TAILWARD
    cut += 0.92 * Math.exp(-(d * d) / (w * w));
    return s < cut ? 1 : 0;
  }

  const HULL_KEY = "orcaHull|v1|" + HULL_RINGS + "x" + HULL_SIDES;

  function build(ctx) {
    const m = ctx.mat, g = new T.Group();
    // GLOSSY JET BLACK against CRISP BRIGHT WHITE. This is the
    // highest-contrast animal in the game and the contrast is the whole read,
    // so the black goes darker than any other hide in the bestiary and the
    // white goes brighter than the great white's belly.
    const black = m(0x0a0c10), white = m(0xf7faf8), saddle = m(0x93a0a8);
    const eyeM = m(0x04050a), pink = m(0x7a3a40), gum = m(0x8e4a50), tooth = m(0xf2ead6);

    const rings = ringsOf(HX0, HX1, HY, RY, RZ, HULL_RINGS);
    const hull = meshOf(cached(HULL_KEY, function () {
      return hullGeom({ rings: rings, sides: HULL_SIDES, paint: orcaPaint });
    }), [black, white]);
    hull.name = "cetaceanHull";            // the name aquatic.js's cetaceans use
    g.add(hull);

    /* THE WHITE POST-OCULAR EYE PATCH. An oval of white set ABOVE and BEHIND
       the eye, its long axis angled BACK along the body. Its absence is the
       entire reason the old model read as a generic dolphin, and a photograph
       of an orca is unmistakable at 200 m because of this one mark. */
    const patch = new T.Mesh(cached("orcaEyePatch|v1", function () {
      return patchGeom({
        rings: rings, x: PATCH_X, ang: PATCH_AF, rx: 0.34, rArc: 0.145,
        tilt: 0.36, arcR: 0.74, lift: 0.012, seg: 22, rad: 3,
      });
    }), white);
    patch.name = "orcaEyePatch"; g.add(patch);

    /* THE GREY SADDLE. A lighter grey-white blaze behind AND BELOW the dorsal
       fin, crescent-shaped because it wraps the fin's base rather than sitting
       square behind it. `radius(th)` is what makes it a cape and not a blob. */
    const sad = new T.Mesh(cached("orcaSaddle|v1", function () {
      return patchGeom({
        rings: rings, x: SADDLE_X, ang: SADDLE_AF, rx: 0.62, rArc: 0.34,
        tilt: -0.10, arcR: 0.80, lift: 0.010, seg: 24, rad: 3,
        radius: function (th) { return 1 - 0.42 * Math.max(0, Math.cos(th)); },
      });
    }), saddle);
    sad.name = "orcaSaddle"; g.add(sad);

    // eyes — small, black, no sclera, sitting low and forward of the patch
    const eyeG = cached("orcaEye|0.075", function () { return new T.SphereGeometry(0.075, 8, 6); });
    [1, -1].forEach(function (side) {
      const rg = ringAt(rings, EYE_X);
      const e = new T.Mesh(eyeG, eyeM);
      e.name = "orcaEye";
      e.position.set(EYE_X, rg.y + Math.sin(EYE_AF) * rg.ry * 0.98,
        side * Math.cos(EYE_AF) * rg.rz * 0.98);
      e.scale.set(0.8, 1, 0.62);
      g.add(e);
    });

    /* THE BLOWHOLE. On TOP of the head, behind the melon — a dark crescent set
       into the skin, and the anchor §5's spout is fired from. A pod that never
       breaks the surface to blow is missing its most legible behaviour, so this
       is not decoration: it is where the white column comes out of. */
    const blow = new T.Mesh(cached("orcaBlowhole|v1", function () {
      return patchGeom({
        rings: rings, x: BLOW_X, ang: Math.PI * 0.5, rx: 0.16, rArc: 0.11,
        tilt: 0, arcR: 0.80, lift: 0.006, seg: 14, rad: 2,
        radius: function (th) { return 0.72 + 0.28 * Math.abs(Math.sin(th)); },
      });
    }), eyeM);
    blow.name = "orcaBlowhole"; g.add(blow);

    /* THE DORSAL FIN, AND IT IS SEXUALLY DIMORPHIC. A bull's is enormous,
       nearly straight and vertical; a cow's or a juvenile's is shorter and
       clearly FALCATE. This is the single most recognisable silhouette in the
       ocean, and one shape for both sexes is a bug — so BOTH are built and §2
       hides one per individual. Two meshes, one shared geometry each, and the
       cost of the hidden one is zero draw calls. */
    const bull = bladeMesh([black], [DORSAL_X, DORSAL_Y, 0], BULL_DORSAL, "bullDorsal|v1");
    bull.name = "orcaDorsalBull"; g.add(bull);
    const cow = bladeMesh([black], [DORSAL_X, DORSAL_Y, 0], COW_DORSAL, "cowDorsal|v1");
    cow.name = "orcaDorsalCow"; cow.visible = false; g.add(cow);

    /* PECTORALS — broad ROUNDED PADDLES, much larger and blunter than a
       shark's swept blade. chordTip is over half the root chord and apexRound
       is 0.55: that is the difference between a paddle and a knife. */
    [1, -1].forEach(function (s2) {
      const f = bladeMesh([black], [1.30, 0.66, s2 * 0.52], {
        span: 1.12, chordRoot: 1.00, chordTip: 0.60, sweep: 0.24, concavity: 0.02,
        leadBow: 0.11, rearTipH: 0.20, rearTipBack: 0.12, apexRound: 0.55,
        thick: 0.16, spanSteps: 5, chordSteps: 5,
        spanDir: [-0.28, -0.30, s2 * 0.91], chordDir: [1, 0, s2 * 0.08],
      }, "orcaPec|" + s2);
      f.name = "orcaPectoral";
      g.add(f);
    });

    // the tailstock — flattened side to side, which is why an orca's peduncle
    // reads as a blade and a shark's as a cylinder
    const ped = meshOf(cached("orcaPeduncle|v1", function () {
      return hullGeom({
        rings: ringsOf(-0.78, 0.34, 0, [0.17, 0.42], [0.10, 0.30], 6),
        sides: 14,
        paint: function (i, u, j, ang, af, s) { return s < -0.34 ? 1 : 0; },
      });
    }), [black, white]);
    ped.name = "orcaPeduncle"; ped.position.set(-2.64, HY, 0); g.add(ped);

    /* TAIL FLUKES — HORIZONTAL (a shark's are vertical), with a NOTCH at the
       midline, and WHITE UNDERSIDES. `underSlot` is what paints the underside:
       spanDir is ±z, so the blade's local +z maps to world -y and the DOWN face
       is the one that must go white. The two lobes are one merged mesh — see
       bladeMesh's note; two meshes and the animal swims like a shark. */
    const fluke = bladeMesh([black, white], [-3.16, HY, 0], [1, -1].map(function (s2) {
      return {
        span: 1.34, chordRoot: 0.92, chordTip: 0.05, sweep: 0.60, concavity: 0.30,
        rearTipH: 0.10, rearTipBack: 0.24, apexRound: 0.05, thick: 0.12,
        spanSteps: 5, chordSteps: 4,
        // WHICH FACE IS THE UNDERSIDE is a basis fact, not a name: spanDir is
        // ±z, so w = chord x span puts the blade's local +z on world -s2·y.
        // The lobe on the +z side therefore has its DOWN face in `slot` and the
        // -z lobe has it in `underSlot`. Getting this backwards paints the
        // flukes white side up, which is the one mistake nobody would miss.
        slot: s2 > 0 ? 1 : 0, underSlot: s2 > 0 ? 0 : 1,
        spanDir: [0, 0, s2], chordDir: [1, 0, 0], origin: [0, 0, s2 * 0.085],
      };
    }), "orcaFluke|v1");
    fluke.name = "orcaFluke"; g.add(fluke);

    /* THE MOUTH. An orca's is a long straight line of conical interlocking
       teeth running back past the eye, and it must ARTICULATE: §6's
       grab-and-drag is "it surfaces with the thing still in its mouth", which
       is unreadable if the mouth cannot open. wildlife_rig.js's authored-mouth
       contract wants a named lower group whose ORIGIN IS THE HINGE, so that is
       exactly what this is — and no upper jaw, because unlike a shark an orca
       does not protrude one. */
    const cavity = new T.Mesh(
      cached("orcaCavity", function () { return new T.SphereGeometry(1, 12, 8); }), pink);
    cavity.name = "orcaMouthCavity";
    cavity.position.set(JAW_X + 0.82, JAW_Y + 0.10, 0);
    cavity.scale.set(0.86, 0.035, 0.34);
    g.add(cavity);

    const lower = new T.Group();
    lower.name = "orcaLowerJaw";
    lower.position.set(JAW_X, JAW_Y, 0);
    g.add(lower);
    const mand = meshOf(cached("orcaMandible|v1", function () {
      return hullGeom({
        rings: ringsOf(0.02, 1.72, 0, [0.20, 0.085], [0.30, 0.115], 7),
        sides: 12,
        // white chin: the underside of the mandible is the front of the white
        // throat, so it has to carry the same paint the hull does
        paint: function (i, u, j, ang, af, s) { return s < -0.08 ? 1 : 0; },
      });
    }), [black, white]);
    mand.name = "orcaMandible"; lower.add(mand);

    function toothRow(up) {
      return meshOf(cached("orcaTeeth|" + (up ? "u" : "l"), function () {
        const sh = new Shell();
        const N = 11;
        for (let side = -1; side <= 1; side += 2) {
          for (let i = 0; i < N; i++) {
            const t = i / (N - 1);
            const x = lerp(0.20, 1.62, t);
            const z = side * lerp(0.26, 0.075, t);
            const hgt = lerp(0.13, 0.075, t) * (up ? -1 : 1);
            const w = lerp(0.055, 0.032, t);
            const y0 = up ? 0 : 0;
            const a = sh.v(x - w, y0, z - w), b = sh.v(x + w, y0, z - w);
            const c = sh.v(x + w, y0, z + w), d = sh.v(x - w, y0, z + w);
            const tip = sh.v(x + w * 0.25, y0 + hgt, z);
            sh.tri(0, a, b, tip); sh.tri(0, b, c, tip);
            sh.tri(0, c, d, tip); sh.tri(0, d, a, tip);
          }
        }
        return sh.geom();
      }), [tooth]);
    }
    const lt = toothRow(false); lt.name = "orcaLowerTeeth";
    lt.position.set(0, 0.055, 0); lower.add(lt);
    const ut = toothRow(true); ut.name = "orcaUpperTeeth";
    ut.position.set(JAW_X, JAW_Y + 0.26, 0); g.add(ut);
    const gumRail = meshOf(cached("orcaGum|v1", function () {
      return hullGeom({
        rings: ringsOf(0.20, 1.66, 0, [0.035, 0.022], [0.30, 0.10], 6),
        sides: 8, paint: function () { return 0; },
      });
    }), [gum]);
    gumRail.name = "orcaGum"; gumRail.position.set(JAW_X, JAW_Y + 0.245, 0); g.add(gumRail);

    const REST_CLOSE = 0.03, MAX_OPEN = 0.52;
    lower.rotation.z = REST_CLOSE;
    const contract = {
      version: 1, shape: "conical-straight",
      hinge: { x: JAW_X, y: JAW_Y, z: 0 },
      bite: { x: JAW_X + 1.30, y: JAW_Y + 0.16, z: 0 },
      maxOpen: MAX_OPEN, travel: MAX_OPEN + REST_CLOSE, restClose: REST_CLOSE,
      protrude: 0, upperDrop: 0,                        // an orca protrudes nothing
      upperTeeth: 22, lowerTeeth: 22, toothRows: 1,
    };
    g.userData.aquaticMouth = contract;
    g._aquaticMouth = { lower: lower, upper: null, cavity: cavity, contract: contract };

    /* WHAT THIS ANIMAL PUBLISHES ABOUT ITSELF. wildlife_shark.js's proxy
       measures any species it is handed and honours a declared descriptor if it
       finds one; this file draws its OWN surface read (§3) and never lets the
       shark's run for an orca, but the descriptor is published anyway so that
       anything else in the repo that measures a dorsal — now or later — gets
       the bull's blade rather than a guess off the tallest child. */
    g.userData.sharkFin = {
      height: BULL_DORSAL.span, base: BULL_DORSAL.chordRoot,
      x: DORSAL_X, backY: DORSAL_Y, color: 0x0a0c10, thickness: 0.18,
      planLength: HX1 - (-3.60), planBeam: 2.85,
    };
    g.userData.orca = {
      len: HLEN, y: HY, x0: HX0, x1: HX1,
      blow: { x: BLOW_X, y: BLOW_Y, z: 0 },
      dorsal: { x: DORSAL_X, y: DORSAL_Y },
      bullSpan: BULL_DORSAL.span, cowSpan: COW_DORSAL.span,
      marks: { eyePatch: true, saddle: true, flankFlare: true, whiteChin: true, flukeUnder: true },
      dimorphic: true, blowhole: true, horizontalFlukes: true,
    };
    return g;
  }

  /* THE RE-REGISTRATION. CBZ.defineSpecies is SPECIES[sp.id] = sp — last write
     wins — and this file loads after city/wildlife/aquatic.js, so re-declaring
     id:"orca" takes ownership of the animal, model and all, with zero edits to
     a file five other agents are inside.

     THE NUMBERS ARE DELIBERATELY UNCHANGED. hp 620 / bite 42 / scale 1.55 are
     what city/marine_predation.js's podNeeded() solves the megalodon threshold
     against; the owner asked for "one loses, two or three stalemate, enough of
     them kills it" and those numbers already produce exactly that (§7 measures
     it rather than asserting it). A model pass is not the place to move a
     balance number by accident. What DID change: packs 2 -> 3, because a pod
     you never meet cannot be frightening. */
  if (MODEL() && typeof CBZ.defineSpecies === "function") {
    CBZ.defineSpecies({
      id: "orca", name: "Orca", biome: "water", rarity: "rare",
      hp: 620, fur: "Orca Hide", furValue: 520, meat: "Whale Meat", meatValue: 44,
      herd: [3, 6], packs: 3, spd: 3.4, danger: 0.5, bite: 42, aquatic: true,
      scale: 1.55, color: 0x0a0c10, clearance: 110, swimDepth: 2.6,
      build: build,
    });
  }

  // ============================================================
  //  §2. THE INDIVIDUAL. Sex, dorsal shape, and how big this one is, drawn
  //  from CBZ.hash01 ON THE SPAWN POINT — order-independent, so adding a
  //  species tomorrow cannot re-sex the pod that spawned today, and the same
  //  world seed grows the same pod forever. No Math.random anywhere near it.
  //
  //  A pod is a matriline: one big bull, several cows, and calves. The draw is
  //  weighted to that, not to a coin flip, because a sea full of bulls is
  //  exactly as wrong as a sea full of cows.
  // ============================================================
  function homeOf(a) {
    const h = a.home;
    if (h && isFinite(h.x)) return h;
    const p = a.pos || (a.group && a.group.position);
    return p ? { x: p.x, z: p.z } : { x: 0, z: 0 };
  }
  function sizeOf(a) {
    if (typeof CBZ.wildlifeSize === "function") {
      try { const s = +CBZ.wildlifeSize(a); if (s > 0 && isFinite(s)) return s; } catch (e) {}
    }
    const s = +(a && a._sizeMul);
    if (s > 0 && isFinite(s)) return s;
    return 1;
  }
  function scaleOf(a) {
    if (typeof CBZ.wildlifeScale === "function") {
      try { const s = +CBZ.wildlifeScale(a); if (s > 0 && isFinite(s)) return s; } catch (e) {}
    }
    const g = a && a.group;
    if (g && g.scale && g.scale.x > 0) return g.scale.x;
    return ((a && a.species && a.species.scale) || 1) * sizeOf(a);
  }

  function identify(a, s) {
    const h = homeOf(a);
    const r = h01(h.x, h.z, 0x0C4A);
    const k = sizeOf(a);
    // A RUNT IS A CALF. wildlife_traits already draws a per-individual size
    // multiplier off the same spawn point, so "which of these is the baby" is
    // a question the world has ALREADY answered — reading its answer instead of
    // drawing a second one is what keeps the calf small in every other system
    // (hp, speed, clearance, ragdoll mass) as well as in this one.
    s.calf = k < 0.80;
    s.bull = !s.calf && r > 0.74;                 // ~26% of adults are bulls
    s.cow = !s.calf && !s.bull;
    s.sex = s.bull ? "bull" : (s.calf ? "calf" : "cow");
    s.dorsalSpan = (s.bull ? BULL_DORSAL.span : COW_DORSAL.span) * (s.calf ? 0.72 : 1);
    // marking variation: a real pod is told apart by saddle shape. One
    // deterministic draw scales the saddle mesh a few percent per animal.
    s.markVar = 0.92 + h01(h.x, h.z, 0x0C4B) * 0.16;
    s.breathT = 6 + h01(h.x, h.z, 0x0C4C) * 34;   // spread the pod's breaths out
    s.actT = 8 + h01(h.x, h.z, 0x0C4D) * 26;
    return s;
  }

  // Pick the right dorsal on this individual's model, ONCE. Both were built.
  function applyIdentity(a, s) {
    const g = a.group;
    if (!g || s.applied) return;
    s.applied = true;
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i];
      if (!c || !c.name) continue;
      if (c.name === "orcaDorsalBull") { c.visible = !!s.bull; s.dorsalMesh = s.bull ? c : s.dorsalMesh; }
      else if (c.name === "orcaDorsalCow") { c.visible = !s.bull; if (!s.bull) s.dorsalMesh = c; }
      else if (c.name === "orcaSaddle") { c.scale.set(s.markVar, s.markVar, s.markVar); }
      else if (c.name === "orcaBlowhole") { s.blowMesh = c; }
    }
    if (s.calf) AUDIT.calves++;
  }

  // ============================================================
  //  §3. THE SURFACE READ. "A tall black blade of a dorsal fin, and a white
  //  spout." Four objects in the animal's PARENT (never inside its group, so
  //  the body's LOD cannot take them with it):
  //
  //    1. THE BLADE   — the individual's OWN dorsal shape, bull or cow, in
  //                     black with a paler trailing margin, standing on the
  //                     animal's real back and cut per-pixel by the real swell
  //                     (the sea is opaque and depth-writes, so how much blade
  //                     shows is decided by the animal's live depth — the same
  //                     law wildlife_shark.js established).
  //    2. THE SPOUT   — the thing no shark has. A white column fired from the
  //                     blowhole when the animal vents, rising and spreading
  //                     over ~1.6 s. Visible from far outside the radius at
  //                     which the body draws, which is the point of it.
  //    3. THE BODY    — an orca seen THROUGH the water from a deck. Drawn from
  //                     a plan-view texture that carries the WHITE PATCHES, so
  //                     it is far more legible than a shark's flat grey smudge.
  //    4. THE SHADOW  — the darker mass under it, offset away from the sun by
  //                     depth. The double read is what sells depth from a boat.
  //
  //  Reverts with ORCA_SURFACE=false, which leaves the animal drawing nothing
  //  above the water at all (its authored dorsal still shows when the body is
  //  on screen — that lane is wildlife.js's LOD, not this file's).
  // ============================================================
  let proxAssets = null;
  const SHADOW_DEPTH = 11, SHADOW_ALPHA = 0.36;

  function tintBlade(geo, spanH) {
    // a dorsal goes thin and translucent along its trailing margin and picks
    // up sky at the apex. Vertex colours, computed from the built outline, so
    // there is no texture and no second material.
    const pos = geo.getAttribute("position");
    if (!pos) return geo;
    const col = new Float32Array(pos.count * 3);
    let minX = 1e9, maxX = -1e9;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i); if (x < minX) minX = x; if (x > maxX) maxX = x; }
    const span = Math.max(0.001, maxX - minX);
    for (let i = 0; i < pos.count; i++) {
      const hgt = clamp(pos.getY(i) / Math.max(0.001, spanH), 0, 1);
      const chord = clamp((pos.getX(i) - minX) / span, 0, 1);
      let k = 0.62 + 0.46 * hgt;
      k *= 1 + 0.55 * Math.pow(1 - chord, 2.2);        // pale trailing margin
      k *= 0.94 + 0.12 * h01(i, 0, 0x0C55);            // deterministic mottle
      col[i * 3] = k; col[i * 3 + 1] = k * 1.01; col[i * 3 + 2] = k * 1.05;
    }
    geo.setAttribute("color", new T.BufferAttribute(col, 3));
    return geo;
  }

  /* THE PLAN VIEW. What an orca looks like from a boat deck: a black torpedo
     with two broad ROUND paddles, a wide notched fluke, and — the whole reason
     this is not the shark's texture — the white eye patches and the grey
     saddle, which are still visible through a metre or two of water and are
     what let you name the animal from the rail. Drawn twice: once as an alpha
     mask (the shadow) and once in colour (the body). */
  function drawOrcaPlan(ctx, W, H, k, colour) {
    const cx = W * 0.5, cy = H * 0.5, L = W * 0.92 * k, hw = H * 0.44 * k;
    const X = function (f) { return cx + f * L * 0.5; };
    const Y = function (f) { return cy + f * hw; };
    ctx.fillStyle = colour ? "#0a0c10" : "#ffffff";
    ctx.beginPath();
    ctx.moveTo(X(1.00), Y(0));
    ctx.bezierCurveTo(X(0.94), Y(0.16), X(0.80), Y(0.26), X(0.56), Y(0.30));
    ctx.lineTo(X(0.40), Y(0.30));
    // pectoral: a BROAD ROUNDED PADDLE, not a shark's swept blade
    ctx.bezierCurveTo(X(0.36), Y(0.62), X(0.24), Y(0.94), X(0.06), Y(0.96));
    ctx.bezierCurveTo(X(0.10), Y(0.62), X(0.20), Y(0.40), X(0.22), Y(0.31));
    ctx.bezierCurveTo(X(0.02), Y(0.30), X(-0.34), Y(0.26), X(-0.56), Y(0.15));
    ctx.lineTo(X(-0.72), Y(0.07));
    // flukes: wide, horizontal, swept, notched at the midline
    ctx.lineTo(X(-0.80), Y(0.30));
    ctx.quadraticCurveTo(X(-0.96), Y(0.78), X(-1.00), Y(0.96));
    ctx.quadraticCurveTo(X(-0.84), Y(0.44), X(-0.78), Y(0.04));
    ctx.quadraticCurveTo(X(-0.84), Y(-0.44), X(-1.00), Y(-0.96));
    ctx.quadraticCurveTo(X(-0.96), Y(-0.78), X(-0.80), Y(-0.30));
    ctx.lineTo(X(-0.72), Y(-0.07));
    ctx.lineTo(X(-0.56), Y(-0.15));
    ctx.bezierCurveTo(X(-0.34), Y(-0.26), X(0.02), Y(-0.30), X(0.22), Y(-0.31));
    ctx.bezierCurveTo(X(0.20), Y(-0.40), X(0.10), Y(-0.62), X(0.06), Y(-0.96));
    ctx.bezierCurveTo(X(0.24), Y(-0.94), X(0.36), Y(-0.62), X(0.40), Y(-0.30));
    ctx.lineTo(X(0.56), Y(-0.30));
    ctx.bezierCurveTo(X(0.80), Y(-0.26), X(0.94), Y(-0.16), X(1.00), Y(0));
    ctx.closePath();
    ctx.fill();
    if (!colour) return;
    // THE MARKINGS, from above. Eye patches first (they sit on the head, one
    // per flank, angled back) then the saddle behind the dorsal sliver.
    ctx.fillStyle = "#f4f7f5";
    [1, -1].forEach(function (s2) {
      ctx.save();
      ctx.translate(X(0.60), Y(s2 * 0.19));
      ctx.rotate(s2 * -0.30);
      ctx.beginPath(); ctx.ellipse(0, 0, L * 0.075, hw * 0.085, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    ctx.fillStyle = "#93a0a8";
    ctx.beginPath();
    ctx.ellipse(X(-0.06), cy, L * 0.10, hw * 0.30, 0, 0, Math.PI * 2);
    ctx.fill();
    // the dorsal from directly overhead is a sliver of almost nothing
    ctx.fillStyle = "#05070a";
    ctx.beginPath();
    ctx.ellipse(X(0.04), cy, L * 0.055, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function makePlanTexture(colour) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const ctx = c.getContext("2d");
    if (!colour) {
      for (let i = 5; i >= 1; i--) { ctx.globalAlpha = 0.13; drawOrcaPlan(ctx, 256, 128, 1 + i * 0.030, false); }
      ctx.globalAlpha = 1;
    }
    drawOrcaPlan(ctx, 256, 128, 1, colour);
    return c;
  }
  function makeSpoutTexture() {
    const S = 96;
    const c = document.createElement("canvas");
    c.width = S; c.height = S * 2;
    const ctx = c.getContext("2d");
    // a bushy column: dense and narrow at the base, spreading and fraying at
    // the top, which is what an orca's blow actually looks like against a sky
    for (let i = 0; i < 42; i++) {
      const t = h01(i, 0, 0x0C61);
      const y = S * 2 * (0.06 + t * 0.92);
      const spread = 0.10 + 0.42 * t;
      const x = S * 0.5 + (h01(i, 1, 0x0C62) - 0.5) * S * spread * 2;
      const r = S * (0.16 - 0.09 * t) * (0.5 + h01(i, 2, 0x0C63));
      const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(2, r));
      const al = (0.34 - 0.26 * t).toFixed(3);
      g.addColorStop(0, "rgba(255,255,255," + al + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, r), 0, Math.PI * 2); ctx.fill();
    }
    return c;
  }
  function makeWakeTexture() {
    const W = 192, H = 96;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    const apex = [W - 6, H * 0.5];
    for (let arm = -1; arm <= 1; arm += 2) {
      for (let pass = 0; pass < 4; pass++) {
        const spread = 0.28 + pass * 0.06;
        const g = ctx.createLinearGradient(apex[0], 0, 0, 0);
        g.addColorStop(0, "rgba(255,255,255," + (0.40 - pass * 0.08).toFixed(3) + ")");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.4 + pass * 2.8;
        ctx.beginPath();
        ctx.moveTo(apex[0], apex[1]);
        ctx.quadraticCurveTo(W * 0.45, apex[1] + arm * H * spread * 0.55, 0, apex[1] + arm * H * spread);
        ctx.stroke();
      }
    }
    return c;
  }
  function canvasTex(c) {
    const t = new T.CanvasTexture(c);
    if (T.sRGBEncoding != null) t.encoding = T.sRGBEncoding;      // r128 spelling
    t.needsUpdate = true;
    t._shared = true;
    return t;
  }
  function assets() {
    if (proxAssets) return proxAssets;
    const quad = new T.PlaneGeometry(1, 1);
    const bullG = tintBlade(cached("proxBull|v1", function () {
      const sh = new Shell(); emitBlade(sh, BULL_DORSAL); return sh.geom();
    }).clone(), BULL_DORSAL.span);
    const cowG = tintBlade(cached("proxCow|v1", function () {
      const sh = new Shell(); emitBlade(sh, COW_DORSAL); return sh.geom();
    }).clone(), COW_DORSAL.span);
    const bladeMat = new T.MeshLambertMaterial({ color: 0x0a0c10, vertexColors: true });
    const spoutTex = canvasTex(makeSpoutTexture());
    const spoutMat = new T.MeshBasicMaterial({
      map: spoutTex, color: 0xffffff, transparent: true, opacity: 0.9,
      depthWrite: false, side: T.DoubleSide,
    });
    const wakeMat = new T.MeshBasicMaterial({
      map: canvasTex(makeWakeTexture()), color: 0xe6f1f5, transparent: true,
      opacity: 0.42, depthWrite: false, side: T.DoubleSide,
    });
    const planTex = canvasTex(makePlanTexture(true));
    const maskTex = canvasTex(makePlanTexture(false));
    // EVERY ORCA SHARES THESE. gore.js's rm(), the rig teardowns and every
    // per-group cleaner in the repo skip anything tagged _shared and dispose
    // the rest, so the first sweep that reached one of these would otherwise
    // blank every other orca in the world.
    quad._shared = bullG._shared = cowG._shared = true;
    bladeMat._shared = spoutMat._shared = wakeMat._shared = true;
    proxAssets = {
      quad: quad, bull: bullG, cow: cowG, bladeMat: bladeMat,
      spoutMat: spoutMat, wakeMat: wakeMat, planTex: planTex, maskTex: maskTex,
    };
    return proxAssets;
  }

  function surfaceAt(x, z, t) {
    const wf = CBZ.waterField;
    if (wf && wf.surfaceY) { const s = wf.surfaceY(x, z, t); if (isFinite(s)) return s; }
    if (CBZ.citySeaHeightAt) { const s = CBZ.citySeaHeightAt(x, z); if (isFinite(s)) return s; }
    return CBZ.waterSeaY ? CBZ.waterSeaY() : (CBZ.SEA_Y != null ? CBZ.SEA_Y : 0);
  }
  // where a shadow falls: away from the sun, further the deeper the body.
  // Cached for the whole frame — every orca in the world shares one sun.
  let _sunT = -1, _sunX = 1, _sunZ = 0, _sunLean = 0.35;
  function sunGround(t) {
    if (Math.abs(t - _sunT) < 0.004) return;
    _sunT = t;
    const s = CBZ.sun, tg = CBZ.sunTarget;
    if (!s || !s.position) return;
    const vx = s.position.x - (tg && tg.position ? tg.position.x : 0);
    const vy = s.position.y - (tg && tg.position ? tg.position.y : 0);
    const vz = s.position.z - (tg && tg.position ? tg.position.z : 0);
    const h = Math.hypot(vx, vz);
    if (h < 1e-4) { _sunX = 1; _sunZ = 0; _sunLean = 0; return; }
    _sunX = -vx / h; _sunZ = -vz / h;
    _sunLean = clamp(h / Math.max(0.5, Math.abs(vy)), 0, 1.5);
  }

  function makeProxy(a, s) {
    const A = assets();
    const parent = (a.group && a.group.parent) || CBZ.scene;
    if (!parent) return null;
    const root = new T.Group();
    root.userData.dynamic = true;                    // batcher/freezer: hands off
    const blade = new T.Mesh(s.bull ? A.bull : A.cow, A.bladeMat);
    blade.castShadow = false;
    root.add(blade);

    const wake = new T.Mesh(A.quad, A.wakeMat);
    wake.rotation.x = -Math.PI / 2; wake.renderOrder = 4; wake.castShadow = false;
    root.add(wake);

    s.shadowMat = new T.MeshBasicMaterial({
      color: 0x04101a, map: A.maskTex, transparent: true,
      opacity: SHADOW_ALPHA, depthWrite: false,
    });
    const shadow = new T.Mesh(A.quad, s.shadowMat);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015;
    shadow.renderOrder = 2; shadow.castShadow = false;
    root.add(shadow);

    // THE BLACK-AND-WHITE BODY. Lifted toward the water the way a mass under a
    // metre of sea actually looks — but only a little, because the whole point
    // of an orca is that its patches survive the wash-out.
    s.bodyMat = new T.MeshBasicMaterial({
      color: 0xc8d8d6, map: A.planTex, transparent: true,
      opacity: SHADOW_ALPHA, depthWrite: false,
    });
    const body = new T.Mesh(A.quad, s.bodyMat);
    body.rotation.x = -Math.PI / 2; body.position.y = 0.024;
    body.renderOrder = 3; body.castShadow = false;
    root.add(body);

    parent.add(root);
    s.root = root; s.blade = blade; s.wake = wake; s.shadow = shadow; s.body = body;
    return root;
  }

  // THE SPOUT lives in its own root at the blowhole's world position, because
  // it must survive the animal diving out from under it — a blow hangs in the
  // air for a second after the whale has gone.
  function fireSpout(a, s) {
    const A = assets();
    if (!s.spout) {
      const parent = (a.group && a.group.parent) || CBZ.scene;
      if (!parent) return;
      const g = new T.Group();
      g.userData.dynamic = true;
      for (let i = 0; i < 3; i++) {
        const q = new T.Mesh(A.quad, A.spoutMat);
        q.castShadow = false;
        q.renderOrder = 6;
        g.add(q);
      }
      parent.add(g);
      s.spout = g;
    }
    s.spoutT = 1.7;
    s.spout.visible = true;
    const g = a.group;
    const sc = scaleOf(a);
    const ud = g && g.userData && g.userData.orca;
    const bx = ud ? ud.blow.x : BLOW_X, by = ud ? ud.blow.y : BLOW_Y;
    const c = Math.cos(a.heading), sn = Math.sin(a.heading);
    s.spout.position.set(g.position.x + c * bx * sc, g.position.y + by * sc, g.position.z + sn * bx * sc);
    AUDIT.blows++;
    if (CBZ.waterSplashAt) {
      try { CBZ.waterSplashAt(s.spout.position.x, surfaceAt(s.spout.position.x, s.spout.position.z, clock()), s.spout.position.z, 0.8 * sc); } catch (e) {}
    }
  }
  function stepSpout(s, dt) {
    if (!s.spout || !(s.spoutT > 0)) {
      if (s.spout && s.spout.visible) s.spout.visible = false;
      return;
    }
    s.spoutT -= dt;
    const k = clamp(1 - s.spoutT / 1.7, 0, 1);        // 0 at the puff, 1 at the end
    const cam = CBZ.camera;
    const h = (1.2 + k * 2.6) * s.sz;
    const w = (0.55 + k * 1.5) * s.sz;
    for (let i = 0; i < s.spout.children.length; i++) {
      const q = s.spout.children[i];
      const off = i * 0.22;
      q.scale.set(w * (1 - off * 0.3), h * (1 - off * 0.35), 1);
      q.position.set((i - 1) * 0.18 * w, h * 0.5 * (1 - off * 0.2), 0);
      if (cam && cam.quaternion) q.quaternion.copy(cam.quaternion);
      q.visible = true;
    }
    s.spout.visible = true;
    // the column is opaque for the first third and then blows away
    const A = assets();
    A.spoutMat.opacity = 0.92 * Math.pow(1 - k, 0.75);
    if (s.spoutT <= 0) s.spout.visible = false;
  }

  function dropProxy(a) {
    const s = a && a._orca;
    if (!s) return;
    if (s.root && s.root.parent) s.root.parent.remove(s.root);
    if (s.spout && s.spout.parent) s.spout.parent.remove(s.spout);
    if (s.shadowMat && s.shadowMat.dispose) { try { s.shadowMat.dispose(); } catch (e) {} }
    if (s.bodyMat && s.bodyMat.dispose) { try { s.bodyMat.dispose(); } catch (e) {} }
    s.root = null; s.blade = null; s.wake = null; s.shadow = null; s.body = null;
    s.shadowMat = null; s.bodyMat = null; s.spout = null; s.spoutT = 0; s.finK = 0; s.shK = 0;
  }

  const PLAN_LEN = 6.85, PLAN_BEAM = 2.85;        // model units, matching the texture

  function proxy(a, s, dist, dt) {
    const grp = a.group;
    if (!grp) return;
    if (!SURF()) {
      if (s.root && s.root.visible) s.root.visible = false;
      return;
    }
    const t = clock();
    const surf = surfaceAt(grp.position.x, grp.position.z, t);
    const dep = surf - grp.position.y;
    const sz = scaleOf(a);
    s.sz = sz;

    const dx = s.px == null ? 0 : grp.position.x - s.px;
    const dz = s.pz == null ? 0 : grp.position.z - s.pz;
    s.px = grp.position.x; s.pz = grp.position.z;
    const spd = dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : 0;
    s.spd += (spd - s.spd) * Math.min(1, dt * 4);

    const backY = grp.position.y + DORSAL_Y * sz;
    const finH = s.dorsalSpan * sz;
    const exposed = backY + finH - surf;
    // ONE DORSAL, ALWAYS: the stand-in draws only while the real one is not
    // being drawn. wildlife_shark.js learned this the hard way (a fin above the
    // fin); asking the one question that matters cannot disagree with itself.
    const finWant = (!a.dead && dist < PROXY_R && grp.visible === false && exposed > 0.02) ? 1 : 0;
    // The submerged mass has a WIDER envelope than the blade: an orca two
    // metres down shows no fin at all and is still perfectly readable, because
    // of the white.
    let reach = SHADOW_DEPTH * Math.max(1, sz * 0.7);
    const cam = CBZ.camera;
    if (cam && cam.position) {
      const cy = cam.position.y - surf;
      const cd = Math.hypot(cam.position.x - grp.position.x, cam.position.z - grp.position.z);
      reach *= 0.95 + 1.15 * clamp(cy / Math.max(0.5, Math.hypot(cy, cd)), 0, 1);
    }
    const shWant = (!a.dead && dist < PROXY_R * 1.15 && dep > 0.25)
      ? clamp(1 - dep / reach, 0, 1) : 0;

    if (!finWant && (s.finK || 0) <= 0.02 && !shWant && (s.shK || 0) <= 0.02 && !(s.spoutT > 0)) {
      if (s.root && s.root.visible) s.root.visible = false;
      if (s.spout && s.spout.visible) s.spout.visible = false;
      s.finK = 0; s.shK = 0;
      return;
    }
    if (!s.root && !makeProxy(a, s)) return;
    s.finK = (s.finK || 0) + (finWant - (s.finK || 0)) * Math.min(1, dt * (finWant ? 2.2 : 3.4));
    s.shK = (s.shK || 0) + (shWant - (s.shK || 0)) * Math.min(1, dt * 3);
    s.root.visible = s.finK > 0.02 || s.shK > 0.02;
    stepSpout(s, dt);
    if (!s.root.visible) return;

    // the flat pieces ride the HIGHEST swell they span, so a ten-metre
    // silhouette on a half-metre sea does not spend half its length inside the
    // water it is drawn on and flicker
    const len = PLAN_LEN * sz;
    const hx = Math.cos(a.heading) * len * 0.5, hz = Math.sin(a.heading) * len * 0.5;
    const top = Math.max(surf,
      surfaceAt(grp.position.x + hx, grp.position.z + hz, t),
      surfaceAt(grp.position.x - hx, grp.position.z - hz, t));
    s.root.position.set(grp.position.x, top + 0.04, grp.position.z);
    s.root.rotation.y = -a.heading;

    const wid = PLAN_BEAM * sz;
    s.shadow.visible = s.shK > 0.02;
    if (s.shadow.visible) {
      sunGround(t);
      const spread = 1 + dep * 0.08;
      s.shadow.scale.set(len * 1.06 * spread, wid * 1.06 * spread, 1);
      const oX = _sunX * _sunLean * dep, oZ = _sunZ * _sunLean * dep;
      const cs = Math.cos(a.heading), sn2 = Math.sin(a.heading);
      s.shadow.position.x = -0.18 * sz + oX * cs + oZ * sn2;
      s.shadow.position.z = -oX * sn2 + oZ * cs;
      s.shadowMat.opacity = SHADOW_ALPHA * s.shK * 0.9;
      const bk = clamp((s.shK - 0.24) / 0.76, 0, 1);
      s.body.visible = bk > 0.02;
      s.body.scale.set(len * 1.06, wid * 1.06, 1);
      s.body.position.x = -0.18 * sz;
      // THE PATCHES SURVIVE THE WASH-OUT. A shark fades to one grey smudge;
      // an orca keeps reading black-and-white right down to the fade floor,
      // which is why a pod is visible from a boat and a shark is not.
      s.bodyMat.opacity = 0.72 * bk;
    } else if (s.body) s.body.visible = false;

    s.blade.visible = s.finK > 0.02;
    if (s.blade.visible) {
      s.blade.position.set(DORSAL_X * sz, backY - s.root.position.y - finH * (1 - s.finK) * 0.85, 0);
      const k = finH / (s.bull ? BULL_DORSAL.span : COW_DORSAL.span);
      s.blade.scale.set(k, k, k);
      s.blade.rotation.z = 0.025 * Math.sin(t * 1.6 + DORSAL_X * 3.1);
    }
    s.finExposed = Math.max(0, exposed);

    // THE WAKE. A travelling pod pushes real water; a hanging one pushes none.
    const surfaced = exposed > -0.2 * finH;
    s.wake.visible = surfaced && s.spd > 0.7;
    if (s.wake.visible) {
      const boost = (s.act === "porpoise" || s.state === "rush") ? 2.1 : 1;
      const wl = (1.3 + Math.min(3.0, s.spd * 0.42)) * sz * boost;
      const ww = (0.5 + Math.min(0.9, s.spd * 0.08)) * sz * boost;
      s.wake.scale.set(wl, ww, 1);
      s.wake.position.x = DORSAL_X * sz - wl * 0.5;
    }
  }

  // ============================================================
  //  §4. THE POD. marine_predation.js owns pod TACTICS — bearing slots, who
  //  commits, the flank ram — and this file will not write a second copy of
  //  any of it. What nobody owned is pod TRAVEL, which is the thing you
  //  actually spend your time watching: a matriline moving as a unit, abreast
  //  or in line or fanned, with a calf glued into its mother's slipstream.
  //
  //  THE MATRIARCH IS NOT DRAWN, SHE IS MEASURED: the biggest live orca in the
  //  group. Ties break on the spawn hash, so every member of a pod independently
  //  elects the SAME matriarch without any of them talking to each other and
  //  without a leader field that can go stale when she dies.
  //
  //  Throttled: the sweep is O(animals) and a pod does not need to recount
  //  itself sixty times a second. Same discipline as wildlife.js's pickPrey.
  // ============================================================
  const POD_R = 120;          // u — inside this you are travelling together
  const POD_SCAN = 0.9;       // s between sweeps, per actor
  const PROXY_R = 620;        // u — the surface read draws inside this
  const SIM_R = 900;          // u — beyond this an orca does not think at all

  function isOrca(a) {
    return !!(a && a.species && a.species.id === "orca" && a.group && !a.external);
  }
  function liveOrca(a) {
    return isOrca(a) && !a.dead && !a.tamed && !a.ridden;
  }

  function podScan(a, s, dt) {
    s.podT -= dt;
    if (s.podT > 0) return;
    s.podT = POD_SCAN;
    const list = CBZ.cityWildlife;
    s.podN = 1; s.matriarch = null; s.mother = null; s.slot = 0;
    if (!list) return;
    const p = a.group.position;
    let n = 0, best = null, bestK = -1, bestR = -1, slot = 0, momD2 = 1e18;
    const myK = scaleOf(a), myRank = h01(homeOf(a).x, homeOf(a).z, 0x0C71);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!liveOrca(o)) continue;
      const q = o.group.position;
      const ddx = q.x - p.x, ddz = q.z - p.z;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 > POD_R * POD_R) continue;
      n++;                                       // counts me too — I am in the pod
      if (o === a) continue;
      const k = scaleOf(o);
      const rank = h01(homeOf(o).x, homeOf(o).z, 0x0C71);
      // STABLE ELECTION, and it has to be stable: every member runs this sweep
      // independently and they must all elect the SAME matriarch without ever
      // talking to each other. Bigger wins; the spawn hash breaks the tie, and
      // it is a property of the world rather than of the loop order.
      if (k > bestK + 1e-6 || (Math.abs(k - bestK) <= 1e-6 && rank > bestR)) {
        best = o; bestK = k; bestR = rank;
      }
      // my station index: how many of them outrank me
      if (k > myK + 1e-6 || (Math.abs(k - myK) <= 1e-6 && rank > myRank)) slot++;
      // A CALF SWIMS IN ITS MOTHER'S SLIPSTREAM. Its mother is the nearest
      // adult cow — not the matriarch, and never the bull.
      if (s.calf) {
        const os = o._orca;
        // if she has not ticked yet, size answers the same question: an adult
        // that is not a bull. No ensure() call, so this sweep cannot recurse.
        const isCow = os ? os.cow : (k >= 0.80 && h01(homeOf(o).x, homeOf(o).z, 0x0C4A) <= 0.74);
        if (isCow && d2 < momD2) { momD2 = d2; s.mother = o; }
      }
    }
    s.podN = Math.max(1, n);
    // I lead unless somebody in range beats me
    s.matriarch = (best && (bestK > myK + 1e-6 ||
      (Math.abs(bestK - myK) <= 1e-6 && bestR > myRank))) ? best : null;
    s.slot = slot;
    if (s.podN > 1) AUDIT.formations++;
  }

  /* THE FORMATION. Three, and which one is in force rotates slowly off the
     matriarch's own hash and the clock — so a pod you watch for two minutes
     visibly re-forms, which is exactly what a pod does.

       abreast  a line across the direction of travel: the hunting formation,
                and the one that looks most like a wall coming at you.
       line     nose to tail: travelling, covering distance.
       fan      a spread arc, wings forward: searching.

     Returns the station in the LEADER'S frame (+x ahead, +z to her right). */
  const _st = { x: 0, z: 0 };
  function station(s, leadLen, t) {
    const n = Math.max(1, s.slot);
    const side = (s.slot % 2) ? 1 : -1;
    const rank = Math.ceil(s.slot * 0.5);
    const mode = s.formation;
    if (mode === 1) {                              // line astern
      _st.x = -leadLen * (0.95 + 0.75 * s.slot);
      _st.z = side * leadLen * 0.16;
    } else if (mode === 2) {                       // fan, wings forward
      _st.x = -leadLen * (0.45 + 0.32 * rank) + Math.abs(side) * 0;
      _st.z = side * leadLen * (0.55 + 0.62 * rank);
    } else {                                       // abreast
      _st.x = -leadLen * (0.22 + 0.10 * rank);
      _st.z = side * leadLen * (0.72 + 0.66 * rank);
    }
    // a real formation breathes; a rigid one reads as a parade float
    _st.x += Math.sin(t * 0.31 + n * 1.7) * leadLen * 0.10;
    _st.z += Math.cos(t * 0.27 + n * 2.3) * leadLen * 0.09;
    return _st;
  }

  // ============================================================
  //  §5 + §6 SUPPORT — the per-actor scratch. Built once, never per frame.
  // ============================================================
  function ensure(a) {
    if (a._orca) return a._orca;
    const s = a._orca = {
      // identity
      sex: "cow", bull: false, cow: true, calf: false, dorsalSpan: COW_DORSAL.span,
      markVar: 1, applied: false, dorsalMesh: null, blowMesh: null,
      // proxy
      root: null, blade: null, wake: null, shadow: null, body: null,
      shadowMat: null, bodyMat: null, spout: null, spoutT: 0,
      finK: 0, shK: 0, spd: 0, px: null, pz: null, sz: 1, finExposed: 0,
      // pod
      podT: 0, podN: 1, matriarch: null, mother: null, slot: 0, formation: 0, formT: 0,
      // acts
      act: "", actT: 0, actK: 0, breathT: 12, holdT: 0, pitch: 0, roll: 0, lift: 0,
      // hunt
      state: "cruise", owned: false, opts: null, look: 0, interest: 0, bored: 0, cool: 0,
      dive: a.swimDepth || 2.6, diveWant: (a.swimDepth || 2.6) * 1.4, dragT: 0, dragPh: 0,
    };
    identify(a, s);
    applyIdentity(a, s);
    s.formation = (h01(homeOf(a).x, homeOf(a).z, 0x0C72) * 3) | 0;
    if (!a._waterMove) a._waterMove = { x: 0, z: 0, heading: 0, blocked: false, shore: -999 };
    return s;
  }

  /* THE MOVER IS BORROWED, NOT REWRITTEN. wildlife_shark.js published exactly
     one water mover — a closure over the actor that swims through
     CBZ.waterField, honours the shoreline-clearance law by hunt state and
     drives the depth track — and this file is not going to write a second one.
     marine_predation.js borrows the same one for exactly the same reason.
     If it is ever absent, the fallback is a straight-line integrate, which is
     wrong at a coastline and correct in the 99% of the ocean that is not one. */
  function moveOf(a) {
    const sh = a._shark;
    if (sh && sh.opts && typeof sh.opts.move === "function") return sh.opts.move;
    return null;
  }
  function swim(a, want, speed, dt) {
    const mv = moveOf(a);
    if (mv) { try { return mv(a, want, speed, dt); } catch (e) {} }
    const g = a.group;
    if (!g) return false;
    const turn = 1.0 * dt;
    let d = shortest((want == null ? a.heading : want) - a.heading);
    if (d > turn) d = turn; else if (d < -turn) d = -turn;
    a.heading += d;
    g.position.x += Math.cos(a.heading) * speed * dt;
    g.position.z += Math.sin(a.heading) * speed * dt;
    return true;
  }

  // ============================================================
  //  §5. THE SURFACE ACTS. Every one of these is visible from a boat, and not
  //  one of them is possible for a shark — which is the whole reason an orca
  //  must not read like one.
  //
  //    blow      it HAS to breathe. The single most legible thing in this file.
  //    spyhop    it rises vertically to get its eye above water and LOOK at
  //              you. The owner's reference photograph, in one act.
  //    breach    the whole animal leaves the water and comes down flat.
  //    taillob   flukes up, slam down. A percussive display.
  //    porpoise  travelling fast, arcing through the surface.
  //
  //  The pose is applied in the 47.2 pass, AFTER wildlife.js's own animateSwim
  //  has written roll and pitch — otherwise the rig would flatten a spy-hop
  //  back down on the frame it started. That ordering is deliberate and is why
  //  none of this needed an edit to wildlife_rig.js.
  // ============================================================
  const SPY_R = 95;           // u — a boat this close is worth looking at
  const ACT_COOL = 14;        // s minimum between acts, per animal

  function playerBoatNear(a, dist) {
    // "when the player's boat is near" — a boat first, the swimmer second.
    if (dist > SPY_R) return 0;
    const P = CBZ.player;
    if (!P) return 0;
    if (P.car || P.vehicle || P.inCar || P.boat) return 1.6;
    return 1;
  }

  function startAct(a, s, act, dur) {
    s.act = act; s.actT = dur; s.blown = false; s.splashed = false; s.lobbed = false;
    if (act === "spyhop") AUDIT.spyhops++;
    else if (act === "breach") AUDIT.breaches++;
    else if (act === "taillob") AUDIT.tailLobs++;
  }
  function endAct(s) { s.act = ""; s.blown = false; s.splashed = false; s.lobbed = false; s.roll = 0; }

  /* THE LIFT IS A DEPTH TARGET, NOT A POSITION WRITE, and that distinction is
     load-bearing. An earlier shape of this added the act's lift to
     group.position.y in the late pass — and depth() then read that raised y
     back on the next frame and eased its target from it, so a spy-hop fed its
     own height into the thing that was supposed to be holding it down and the
     animal sank through its own act. Setting `s.diveWant` negative (i.e. "the
     body belongs ABOVE the surface") means exactly one system owns y and there
     is no loop to damp. `s.airborne` is what tells depth() to let go of the
     submersion clamp for the duration. */
  function actTick(a, s, dt, dist) {
    if (!ACTS()) { if (s.act) endAct(s); s.airborne = false; return false; }
    s.cool -= dt;
    s.breathT -= dt;
    const g = a.group;
    const t = clock();
    const surf = surfaceAt(g.position.x, g.position.z, t);
    const dep = surf - g.position.y;
    const draft = a.swimDepth || 2.6;

    // ---- PORPOISING. Not a decision — a consequence of travelling fast, so it
    // is a modifier on top of everything else rather than an act that has to
    // start and end. It only runs when no act owns the animal.
    if (!s.act && s.spd > 5.2 && dep < draft * 2.6) {
      s.porpPh = (s.porpPh || 0) + dt * 1.35;
      if (s.porpPh > 6.283185307) { s.porpPh -= 6.283185307; AUDIT.porpoises++; }
      s.lift = Math.max(0, Math.sin(s.porpPh)) * draft * 1.5;
      s.pitch = -Math.cos(s.porpPh) * 0.38;
      s.airborne = s.lift > draft * 0.5;
      s.porp = true;
      s.diveWant = -s.lift;
      return true;
    }
    s.porp = false;

    // ---- BREATHING. Not optional and not decorative: a pod that never breaks
    // the surface to blow is missing its most legible behaviour, and the blow
    // is visible from well outside the radius at which the body draws.
    if (s.breathT <= 0 && !s.act) {
      startAct(a, s, "blow", 4.2);
      s.breathT = 26 + h01(g.position.x, g.position.z, 0x0C81) * 34;
    }
    if (!s.act) {
      s.idleT -= dt;
      if (s.cool <= 0 && playerBoatNear(a, dist) && dist < SPY_R && !s.calf) {
        // SPY-HOP: it rises vertically and LOOKS at you. Its own eye, above the
        // water, pointed at the boat — the moment in the owner's reference.
        startAct(a, s, "spyhop", 4.6); s.cool = ACT_COOL;
      } else if (s.cool <= 0 && s.idleT <= 0) {
        const r = h01(g.position.x * 0.37, g.position.z * 0.41, 0x0C82);
        if (r > 0.72) startAct(a, s, "breach", 2.9);
        else if (r > 0.45) startAct(a, s, "taillob", 3.1);
        else startAct(a, s, "blow", 3.4);
        s.cool = ACT_COOL * (0.7 + r * 0.9);
        s.idleT = 12 + r * 30;
      }
    }
    if (!s.act) {
      s.lift += (0 - s.lift) * Math.min(1, dt * 3);
      s.pitch += (0 - s.pitch) * Math.min(1, dt * 3);
      s.roll += (0 - s.roll) * Math.min(1, dt * 3);
      s.airborne = false;
      return false;
    }

    s.actT -= dt;
    if (s.act === "blow") {
      // rise until the blowhole clears, vent, sink back
      const k = 1 - clamp(s.actT / 4.2, 0, 1);
      s.lift = Math.sin(clamp(k, 0, 1) * Math.PI) * (dep + 0.55);
      s.pitch = -Math.sin(k * Math.PI * 2) * 0.10;
      if (!s.blown && k > 0.42) { s.blown = true; fireSpout(a, s); }
      if (s.actT <= 0) { s.act = ""; s.blown = false; }
    } else if (s.act === "spyhop") {
      /* RISE VERTICALLY, HOLD, SINK. The pitch goes to ~72 degrees nose-up and
         the animal turns its head to the boat while it is up there — an orca
         spy-hops in order to SEE, so a spy-hop that does not look at anything
         is a pose, not a behaviour. */
      const T0 = 4.6, e = clamp((T0 - s.actT) / T0, 0, 1);
      const up = e < 0.30 ? e / 0.30 : (e > 0.74 ? 1 - (e - 0.74) / 0.26 : 1);
      s.lift = up * (dep + draft * 1.35);
      s.pitch = -up * 1.26;
      const P = CBZ.player;
      if (P && P.pos && up > 0.5) {
        const want = Math.atan2(P.pos.z - g.position.z, P.pos.x - g.position.x);
        a.heading += shortest(want - a.heading) * Math.min(1, dt * 1.6);
      }
      if (s.actT <= 0) s.act = "";
    } else if (s.act === "breach") {
      const T0 = 2.9, e = clamp((T0 - s.actT) / T0, 0, 1);
      const arc = Math.sin(clamp(e / 0.72, 0, 1) * Math.PI);
      s.lift = arc * (dep + draft * 3.4);
      s.pitch = -Math.cos(clamp(e / 0.72, 0, 1) * Math.PI) * 0.85;
      s.roll = Math.sin(e * 4.2) * 0.30;
      if (!s.splashed && e > 0.80) {
        s.splashed = true;
        if (CBZ.waterSplashAt) {
          try { CBZ.waterSplashAt(g.position.x, surf, g.position.z, 3.6 * s.sz); } catch (e2) {}
        }
      }
      if (s.actT <= 0) { s.act = ""; s.splashed = false; s.roll = 0; }
    } else if (s.act === "taillob") {
      const T0 = 3.1, e = clamp((T0 - s.actT) / T0, 0, 1);
      const ph = Math.sin(clamp(e, 0, 1) * Math.PI * 3);
      s.pitch = ph * 0.55;                          // flukes up, then slammed down
      s.lift = Math.max(0, Math.sin(e * Math.PI)) * (dep * 0.5);
      if (!s.lobbed && ph < -0.9) {
        s.lobbed = true;
        if (CBZ.waterSplashAt) {
          try { CBZ.waterSplashAt(g.position.x - Math.cos(a.heading) * 3 * s.sz, surf,
            g.position.z - Math.sin(a.heading) * 3 * s.sz, 2.6 * s.sz); } catch (e3) {}
        }
      }
      if (s.actT <= 0) { s.act = ""; s.lobbed = false; }
    }
    return true;
  }

  // The pose is applied AFTER everyone else has written the transform, which is
  // the only ordering that survives wildlife.js's animateSwim, creature_combat's
  // strike poses and marine_predation's roll-over all wanting the same three
  // numbers. Additive on roll, absolute on pitch and lift.
  function applyPose(a, s, dt) {
    const g = a.group;
    if (!g) return;
    if (s.lift > 0.001 || s.pitch !== 0 || s.roll !== 0) {
      g.position.y += s.lift;
      g.rotation.z = s.pitch;
      g.rotation.x += s.roll;
    }
  }

  // ============================================================
  //  §6. THE HUNT, AND THE GRAB-AND-DRAG.
  //
  //  ORCAS ARE VISIBLY SMARTER THAN SHARKS, and this is where that is cashed
  //  in. A great white's brain in this repo is: smell -> circle -> bump ->
  //  vanish -> rush. It commits. An orca's is the SAME shared driver
  //  (CBZ.predatorHunt — no fourth loop) with a `canReach` that almost always
  //  says no: it comes and looks at you, it circles the boat, it spy-hops, and
  //  then it LEAVES ON PURPOSE (CBZ.predatorDisengage) rather than losing
  //  interest. Only a genuinely hungry animal over a bleeding target ever gets
  //  past the gate. That single expression is the entire difference between an
  //  orca and a shark in this game, and it is the honest one: orcas do not eat
  //  people, and the interesting thing about them is that they are deciding.
  //
  //  When one DOES commit, the seize is style "drag", not "shake". A shark
  //  bites and backs off; an orca HOLDS, drags it under, thrashes it side to
  //  side, and SURFACES WITH IT STILL IN ITS MOUTH. predatorSeize already owns
  //  the hold, the escape QTE, the thrash and the jaw; the depth track that
  //  takes the pair down and brings them back up is what this file adds, and it
  //  is three lines because the driver owns everything else.
  // ============================================================
  function hungerOf(a) {
    if (typeof CBZ.wildlifeHunger === "function") {
      try { const h = +CBZ.wildlifeHunger(a); if (h >= 0 && isFinite(h)) return h; } catch (e) {}
    }
    return 0.5;
  }
  function bleeding(t) {
    if (!t) return false;
    if (t === CBZ.player && typeof CBZ.citySwimBleeding === "function") {
      try { if (CBZ.citySwimBleeding()) return true; } catch (e) {}
    }
    if (t.hp != null && t.maxHp > 0 && t.hp < t.maxHp * 0.55) return true;
    return false;
  }
  function inWater(t) {
    if (!t) return false;
    if (CBZ.player && t === CBZ.player) {
      if (CBZ.citySwimming && CBZ.citySwimming()) return true;
      if (t._swim) return true;
      return false;
    }
    const p = t.pos || (t.group && t.group.position);
    if (!p) return false;
    if (CBZ.predatorMedium) return CBZ.predatorMedium(p.x, p.y, p.z) === "water";
    return !!(CBZ.cityWaterAt && CBZ.cityWaterAt(p.x, p.z));
  }

  function optsFor(a, s) {
    if (s.opts) return s.opts;
    const sp = a.species || {};
    const label = String(sp.name || sp.id || "orca").toLowerCase();
    const SEAMS = {
      move: function (h, want, speed, dt) { return swim(h, want, speed, dt); },
      onState: function (ns) {
        s.state = ns || "cruise";
        const d = a.swimDepth || 2.6;
        s.diveWant = d * (ns === "rush" ? 1.7 : ns === "seize" ? 0.6 : ns === "circle" ? 0.85 : 1.4);
        if (CBZ.swimJaw && ns !== "rush" && ns !== "seize") { try { CBZ.swimJaw(a, 0); } catch (e) {} }
        if (ns === "seize") { s.dragT = 0; s.dragPh = 0; AUDIT.grabs++; }
      },
      onHit: function (d) {
        if (CBZ.cityAnimalStrikePlayer) { try { CBZ.cityAnimalStrikePlayer(a, d, "lunge"); } catch (e) {} }
      },
      /* THE GATE. It reaches the target only if the target is in the water AND
         this animal has actually decided. Everything upstream — the approach,
         the circle, the look — runs regardless, which is what produces an orca
         that comes over, inspects you and goes away again. */
      canReach: function (t) {
        if (!inWater(t)) return false;
        if (!HUNT()) return false;
        return s.committed === true;
      },
      seize: {
        // THE GRAB-AND-DRAG. `drag` is predatorSeize's own style: it carries
        // the victim along the attacker's heading with an irregular, working
        // speed instead of dropping it. The hold is long — an orca does not
        // let go — and the escape chance correspondingly small.
        style: DRAG() ? "drag" : "shake",
        cause: "taken by a " + label,
        qteMax: 2,
      },
    };
    const kit = (typeof CBZ.predatorKit === "function") ? CBZ.predatorKit(a, SEAMS) : null;
    s.opts = kit || {
      // DEGRADE PATH ONLY (predator.js absent or its kit flagged off). These
      // are an orca's own numbers written out, so a flag-off build cannot
      // silently lose its radii.
      senseR: 150, chumR: 300, circleR: 34, orbitR: 22, circleT: 9,
      cruiseSpeed: (sp.spd || 3.4) * 2.2, rushSpeed: (sp.spd || 3.4) * 8.0,
      bumpDmg: (sp.bite || 42) * 0.18, style: "lunge", medium: "water",
      reach: 2.6 + (sp.scale || 1.55) * 1.7, rate: 1.2, dmg: sp.bite || 42,
      canReach: SEAMS.canReach, move: SEAMS.move, onState: SEAMS.onState, onHit: SEAMS.onHit,
      seize: {
        jaw: CBZ.creatureJawPoint ? CBZ.creatureJawPoint(a) : { x: 2.8, y: 0.75, z: 0 },
        dps: 14 + (sp.bite || 42) * 0.42, hold: 4.6, escape: 0.16,
        thrash: 1.25, medium: "water", style: DRAG() ? "drag" : "shake",
        cause: SEAMS.seize.cause, qteMax: 2,
      },
    };
    if (s.opts.seize && typeof s.opts.seize === "object") {
      // The kit's archetype row is solved for a shark's bite-and-release. An
      // orca does not release: a longer hold, a smaller escape, the drag style.
      if (DRAG()) s.opts.seize.style = "drag";
      s.opts.seize.hold = Math.max(s.opts.seize.hold || 0, 4.2) * (s.bull ? 1.15 : 1);
      s.opts.seize.escape = Math.min(s.opts.seize.escape == null ? 0.16 : s.opts.seize.escape, 0.18);
      s.opts.seize.thrash = 1.25;
      s.opts.seize.cause = SEAMS.seize.cause;
    }
    return s.opts;
  }

  /* THE COMMIT DECISION, taken once every couple of seconds instead of every
     frame. A hungry animal over something already bleeding, or a pod that has
     been circling long enough to have made up its mind. Everything else gets
     looked at and left. */
  function decide(a, s, target, dist, dt) {
    s.look += dt;
    const hun = hungerOf(a);
    const near = dist < (s.opts && s.opts.circleR ? s.opts.circleR * 1.6 : 55);
    if (s.committed) {
      // it committed; it does not un-commit until the hunt itself ends
      return;
    }
    if (!near) { s.interest = Math.max(0, s.interest - dt * 0.5); return; }
    s.interest += dt * (0.35 + hun * 0.5 + (bleeding(target) ? 1.1 : 0));
    // THE BAR IS HIGH ON PURPOSE. Orcas do not eat people, and an orca that
    // grabs every swimmer it meets is a shark with a paint job.
    const bar = bleeding(target) ? 5.5 : 26;
    if (s.interest > bar && hun > 0.68) {
      s.committed = true;
      AUDIT.commits++;
      return;
    }
    // ...and it BREAKS OFF DELIBERATELY. Not "loses interest" — it inspects,
    // it decides you are not food, and it leaves. predatorDisengage is the
    // shared driver's own word for that, and it keeps the menace gauge (i.e.
    // the anti-habituation state) instead of deleting it the way a null would.
    s.bored += dt;
    if (s.bored > 22) {
      s.bored = 0; s.interest = 0; s.look = 0;
      AUDIT.breakoffs++;
      if (CBZ.predatorDisengage) { try { CBZ.predatorDisengage(a, 30); } catch (e) {} }
      s.cool = 0;                                    // and it spy-hops on the way out
    }
  }

  /* THE DRAG ITSELF. predatorSeize already carries the victim, thrashes it and
     runs the escape QTE; the one thing it cannot know is that an ORCA takes it
     UNDER and then comes back UP with it. Three beats, on a clock:

       0.0 - 1.4 s   down, hard, out of the light
       1.4 - 3.6 s   held under, thrashing side to side, blood in the water
       3.6 s +       back to the surface with it still in the mouth

     CBZ.goreChum is another block's API (systems/gore.js, being extended
     concurrently) so it is consumed defensively and the drag degrades to a
     silent one if it never lands. */
  function dragTick(a, s, dt) {
    if (!DRAG()) return;
    s.dragT += dt;
    const d = a.swimDepth || 2.6;
    if (s.dragT < 1.4) s.diveWant = d * (1.4 + s.dragT * 2.6);
    else if (s.dragT < 3.6) s.diveWant = d * 5.0;
    else s.diveWant = d * 0.45;                       // and it surfaces with it
    s.dragPh += dt * 3.1;
    s.roll = Math.sin(s.dragPh) * 0.34;               // the side-to-side thrash
    if (!s.chum && typeof CBZ.goreChum === "function") {
      const g = a.group;
      try { s.chum = CBZ.goreChum(g.position.x, g.position.y, g.position.z, 1.4, 7); AUDIT.drags++; } catch (e) { s.chum = null; }
    }
  }

  // depth track — the shark's mover already drives depth when it owns the
  // frame; this is for the frames when nothing else does (formation travel,
  // an act, the drag) and it uses the same two clamps in the same order:
  // keep the torso under FIRST, never inside the seabed LAST.
  function depth(a, s, dt, t) {
    const g = a.group;
    const surf = surfaceAt(g.position.x, g.position.z, t);
    s.dive += (s.diveWant - s.dive) * Math.min(1, dt * 1.1);
    let y = surf - s.dive;
    const draft = a.swimDepth || 2.6;
    if (y > surf - draft * 0.92) y = surf - draft * 0.92;
    if (CBZ.cityAquaticBedRestY) {
      const lift = CBZ.cityAquaticBedLift ? CBZ.cityAquaticBedLift(a.species) : scaleOf(a) * 0.9;
      const lo = CBZ.cityAquaticBedRestY(g.position.x, g.position.z, draft, lift, t, surf);
      if (y < lo) y = lo;
    }
    g.position.y += (y - g.position.y) * Math.min(1, dt * 3.2);
  }

  // ============================================================
  //  §7. THE MEGALODON TAKEDOWN — CONSUMED, NOT REBUILT.
  //
  //  city/marine_predation.js already solves "how many orcas beat a megalodon"
  //  from the animals' own hp/bite/size, already runs the flank ram, and
  //  already drives creature_combat's tonic roll-over as the finisher. Writing
  //  a second answer here would be the exact duplication CLAUDE.md calls the
  //  real danger — so this is a READ of that answer plus a degrade path for a
  //  build where that file is absent or flagged off.
  //
  //  The degrade path is the same expression that file documents, because the
  //  point of "derive it from the animals' own numbers" is that two independent
  //  derivations agree: time-to-kill each way, with size on BOTH sides, so a
  //  monster meg beats a pod that would kill an average one and a pod of big
  //  bulls beats a meg a small pod could not.
  // ============================================================
  function dpsGuess(a) {
    const sp = a.species || {};
    const k = (sp.bite || 30) * 0.8;
    return Math.max(1, k) * Math.pow(scaleOf(a), 1.6);
  }
  function hpOf(a) { return Math.max(1, a.maxHp || (a.species && a.species.hp) || 100); }
  function neededFallback(orca, quarry) {
    const dA = dpsGuess(orca) / Math.pow(scaleOf(quarry), 2.2);
    const dB = dpsGuess(quarry) / Math.pow(scaleOf(orca), 2.2);
    const ttkA = hpOf(quarry) / Math.max(0.01, dA);
    const ttkB = hpOf(orca) / Math.max(0.01, dB);
    const ratio = ttkA / Math.max(0.01, ttkB);
    return ratio >= 1 ? Math.ceil(ratio) + 1 : Math.max(1, Math.ceil(ratio));
  }
  function takedown(orca, quarry) {
    if (!orca || !quarry) return null;
    let needed = 0;
    if (typeof CBZ.marinePodNeeded === "function") {
      try { needed = +CBZ.marinePodNeeded(orca, quarry) || 0; } catch (e) { needed = 0; }
    }
    if (!(needed > 0)) needed = neededFallback(orca, quarry);
    const s = ensure(orca);
    const have = Math.max(1, s.podN || 1);
    let verdict;
    if (have < Math.max(2, Math.ceil(needed * 0.45))) verdict = "loses";
    else if (have < needed) verdict = "stalemate";
    else verdict = "kills";
    return {
      needed: needed, have: have, verdict: verdict,
      source: typeof CBZ.marinePodNeeded === "function" ? "marine_predation" : "orca-fallback",
      rollOver: typeof CBZ.creatureTonicRoll === "function",
      ram: typeof CBZ.predatorStagger === "function",
    };
  }

  // ============================================================
  //  §8. THE DRIVE. One function. Returns true when this file owns the actor's
  //  transform for the frame — the same contract CBZ.sharkBrain already has
  //  with wildlife.js, so nothing downstream changes.
  // ============================================================
  function orcaBrain(a, dt, P) {
    if (!a || !(dt > 0) || a.dead || a.tamed || a.ridden) return false;
    if (!isOrca(a)) return false;
    const g = a.group;
    if (!g) return false;

    // ---- THE DISTANCE GATE. Two hypots and out. -----------------------------
    const dist = P ? Math.hypot(g.position.x - P.x, g.position.z - P.z) : 1e9;
    if (dist > SIM_R) return false;

    const s = ensure(a);
    applyIdentity(a, s);
    s.owned = false;
    const t = clock();

    // A BODY BEING HELD, OR HOLDING SOMETHING, IS NOT TRAVELLING.
    if (a._seizedBy || a._mpRoll) { proxy(a, s, dist, dt); return false; }

    // ---- the acts come first: a spy-hopping orca is not station-keeping -----
    const acting = actTick(a, s, dt, dist);

    // ---- THE HUNT (shared driver, orca gate) --------------------------------
    let owned = false;
    const hunt = CBZ.predatorHunt, player = CBZ.player;
    if (HUNT() && typeof hunt === "function" && P && player && !player.dead && !s.calf && !acting) {
      const opts = optsFor(a, s);
      decide(a, s, player, dist, dt);
      let st = null;
      try { st = hunt(a, player, dt, opts); } catch (e) { st = null; }
      if (st && st !== "cruise") {
        if (st !== s.state && opts.onState) { try { opts.onState(st, s.state); } catch (e) {} }
        s.state = st;
        // MARKERS FOR FREE: systems/markers.js lights the HUD off a.state, and
        // an orca that is only LOOKING at you must not paint a threat blip —
        // that is the difference the whole §6 gate exists to express.
        if (st === "rush" || st === "seize") a.state = "charge";
        else if (s.committed && (st === "circle" || st === "bump")) a.state = "stalk";
        else a.state = "wander";
        if (st === "seize") dragTick(a, s, dt);
        // showing the animal: an orca is not a withheld monster, it is a thing
        // that comes to look at you, so the body draws far more freely than a
        // shark's does.
        g.visible = dist < (opts.senseR || 150) * 1.1 || st === "rush" || st === "seize";
        owned = true;
      } else if (s.state !== "cruise") {
        s.state = "cruise";
        s.committed = false;
        if (s.chum && typeof CBZ.goreChumStop === "function") { try { CBZ.goreChumStop(s.chum); } catch (e) {} }
        s.chum = null;
      }
    }

    // ---- POD TRAVEL (only when nothing more urgent owns the animal) ---------
    if (!owned && POD()) {
      podScan(a, s, dt);
      s.formT -= dt;
      if (s.formT <= 0) {
        s.formT = 45 + h01(g.position.x, g.position.z, 0x0C90) * 60;
        s.formation = ((s.formation + 1 + ((h01(g.position.x, g.position.z, 0x0C91) * 2) | 0)) % 3) | 0;
      }
      /* A CALF SWIMS IN ITS MOTHER'S SLIPSTREAM. Just behind and beside her,
         inside the water she has already moved — the single best thing you can
         put in this ocean, and it is one station offset. */
      const lead = s.calf && s.mother ? s.mother : s.matriarch;
      if (lead && lead.group) {
        const ls = ensure(lead);
        const leadLen = PLAN_LEN * scaleOf(lead);
        let ox, oz;
        if (s.calf) {
          ox = -leadLen * 0.62;
          oz = leadLen * (h01(homeOf(a).x, homeOf(a).z, 0x0C92) > 0.5 ? 0.30 : -0.30);
          s.formation = ls.formation;
        } else {
          const st2 = station(s, leadLen, t);
          ox = st2.x; oz = st2.z;
        }
        const lh = lead.heading || 0;
        const cx = Math.cos(lh), cz = Math.sin(lh);
        const wx = lead.group.position.x + ox * cx - oz * cz;
        const wz = lead.group.position.z + ox * cz + oz * cx;
        const ddx = wx - g.position.x, ddz = wz - g.position.z;
        const d = Math.hypot(ddx, ddz);
        const cruise = (a._spd0 || a.spd || 3.4) * 2.0;
        if (d > leadLen * 0.22) {
          const want = Math.atan2(ddz, ddx);
          // close fast when far behind, match her pace when on station — that
          // difference is what makes a formation look held rather than chased
          const spd = clamp(cruise * (0.55 + d / (leadLen * 3)), cruise * 0.5, cruise * 2.4);
          swim(a, want, spd, dt);
          owned = true;
        } else {
          swim(a, lh, cruise * 0.9, dt);
          owned = true;
        }
        s.diveWant = (a.swimDepth || 2.6) * (s.calf ? 1.05 : 1.35);
      }
    }

    if (owned || acting) {
      depth(a, s, dt, t);
      if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(g, a.heading); } catch (e) {} }
      s.owned = true;
    }
    proxy(a, s, dist, dt);
    return s.owned;
  }

  // ============================================================
  //  THE WRAP. Capture-and-wrap of CBZ.sharkBrain — the same pattern
  //  marine_predation.js uses on it one script tag later, so the chain that
  //  actually runs is marine -> orca -> shark. Re-armed lazily because script
  //  order is not ours to depend on.
  //
  //  ORCAS NEVER FALL THROUGH TO THE SHARK'S BRAIN WITH dt > 0, and that is
  //  deliberate: sharkBrain draws its own fin/wake/shadow proxy from inside
  //  itself, so letting it run for an orca would put a second, shark-shaped
  //  dorsal on top of this file's own — the exact "another fin above the fin"
  //  bug wildlife_shark.js's header spends a paragraph on. It IS called once
  //  with dt = 0, which is a pure ensure: it builds a._shark (and with it the
  //  ONE water mover this file borrows) and moves nothing.
  // ============================================================
  let orig = null, wrapped = null;
  function installWrap() {
    if (CBZ.sharkBrain === wrapped) return;
    orig = (typeof CBZ.sharkBrain === "function") ? CBZ.sharkBrain : null;
    wrapped = function (a, dt, P) {
      if (!isOrca(a)) return orig ? orig(a, dt, P) : false;
      if (orig && !a._shark) { try { orig(a, 0, P); } catch (e) {} }
      try { return orcaBrain(a, dt, P); } catch (e) { return false; }
    };
    CBZ.sharkBrain = wrapped;
  }
  installWrap();

  /* THE PASS. onUpdate(47.2): AFTER wildlife.js's tick (47.1) — which is where
     animateSwim writes roll and pitch — and after marine_predation's own
     47.15, so a pose written here survives every one of them. It also drives
     the surface proxy for orcas this file did NOT own that frame (one being
     rolled by marine_predation still has to keep its dorsal and its spout),
     which is the reason the proxy is not simply called from the brain.

     DISTANCE-GATED HARD: an orca 8 km away costs one species compare and two
     Math.hypot calls. */
  if (CBZ.onUpdate) {
    CBZ.onUpdate(47.2, function (dt) {
      if (!(dt > 0)) return;
      installWrap();
      const list = CBZ.cityWildlife;
      if (!list) return;
      const P = (CBZ.player && CBZ.player.pos) || null;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || !a.species || a.species.id !== "orca" || !a.group) continue;
        const s = a._orca;
        if (a.dead) { if (s && s.root) dropProxy(a); continue; }
        const d = P ? Math.hypot(a.group.position.x - P.x, a.group.position.z - P.z) : 1e9;
        if (d > PROXY_R * 1.2) {
          if (s && s.root && s.root.visible) s.root.visible = false;
          continue;
        }
        const st = s || ensure(a);
        applyPose(a, st, dt);
        if (!st.owned) proxy(a, st, d, dt);
        st.owned = false;
      }
    });
  }

  // ============================================================
  //  PUBLIC SURFACE
  // ============================================================
  CBZ.orcaBrain = orcaBrain;
  CBZ.orcaFinDrop = dropProxy;
  CBZ.orcaTakedown = takedown;

  CBZ.orcaIdentity = function (a) {
    if (!isOrca(a)) return null;
    const s = ensure(a);
    return {
      sex: s.sex, bull: s.bull, cow: s.cow, calf: s.calf,
      dorsalSpan: s.dorsalSpan, dorsalWorld: s.dorsalSpan * scaleOf(a),
      dorsalShape: s.bull ? "straight-vertical" : "falcate",
      markVar: s.markVar, scale: scaleOf(a),
    };
  };

  CBZ.orcaPodRead = function (a) {
    if (!isOrca(a)) return null;
    const s = ensure(a);
    return {
      podN: s.podN, slot: s.slot,
      formation: ["abreast", "line", "fan"][s.formation | 0] || "abreast",
      matriarch: !s.matriarch,                       // true = this one leads
      mother: !!s.mother, calf: s.calf,
      act: s.act || "", state: s.state, committed: !!s.committed,
      interest: Number((s.interest || 0).toFixed(2)),
    };
  };

  /* THE SURFACE READ, for measurement. tools/visual-presets/orca-pod.mjs asks
     this instead of reaching into the proxy's internals, so the numbers in the
     report cannot drift away from the thing they describe. Everything is metres
     above the LIVE surface at the animal's own position. */
  CBZ.orcaSurfaceRead = function (a) {
    if (!isOrca(a)) return null;
    const s = a._orca, g = a.group;
    if (!s || !g) return null;
    const t = clock();
    const surf = surfaceAt(g.position.x, g.position.z, t);
    const sz = scaleOf(a);
    const authored = (g.position.y + (DORSAL_Y + s.dorsalSpan) * sz) - surf;
    const bodyOn = g.visible !== false;
    const proxyUp = !!(s.root && s.root.visible && s.blade && s.blade.visible && (s.finK || 0) > 0.05);
    return {
      dorsals: (bodyOn && authored > 0.02 ? 1 : 0) + (proxyUp && (s.finExposed || 0) > 0.02 ? 1 : 0),
      finM: Math.max(bodyOn && authored > 0 ? authored : 0, proxyUp ? s.finExposed : 0),
      authoredM: authored, proxyFinM: proxyUp ? s.finExposed : 0,
      dorsalShape: s.bull ? "straight-vertical" : "falcate",
      bodyOnScreen: bodyOn, depthM: surf - g.position.y,
      blowing: (s.spoutT || 0) > 0, spoutM: (s.spoutT || 0) > 0 ? (1.2 + (1 - s.spoutT / 1.7) * 2.6) * sz : 0,
      shadowUp: !!(s.shadow && s.shadow.visible),
      shadowAlpha: s.shadow && s.shadow.visible && s.shadowMat ? s.shadowMat.opacity : 0,
      bodySilUp: !!(s.body && s.body.visible),
      bodyAlpha: s.body && s.body.visible && s.bodyMat ? s.bodyMat.opacity : 0,
      wakeLenM: s.wake && s.wake.visible ? s.wake.scale.x : 0,
      planLenM: PLAN_LEN * sz, planBeamM: PLAN_BEAM * sz,
      meshes: s.root ? s.root.children.length : 0,
      act: s.act || "",
    };
  };

  // Staging / tests only. Never called in play.
  CBZ.orcaStage = function (a, act, arg) {
    if (!isOrca(a)) return false;
    const s = ensure(a);
    if (act === "bull" || act === "cow" || act === "calf") {
      s.bull = act === "bull"; s.cow = act === "cow"; s.calf = act === "calf";
      s.sex = act;
      s.dorsalSpan = (s.bull ? BULL_DORSAL.span : COW_DORSAL.span) * (s.calf ? 0.72 : 1);
      s.applied = false; applyIdentity(a, s);
      if (s.root) { dropProxy(a); }
      return true;
    }
    if (act === "blow") { fireSpout(a, s); startAct(a, s, "blow", 4.2); s.blown = true; return true; }
    if (act === "formation") { s.formation = (arg | 0) % 3; return true; }
    if (act === "commit") { s.committed = arg !== false; return true; }
    if (act === "" || act == null) { s.act = ""; s.lift = 0; s.pitch = 0; s.roll = 0; return true; }
    startAct(a, s, act, arg > 0 ? arg : 4.0);
    return true;
  };

  CBZ.orcaAudit = function () {
    return {
      model: MODEL(), pod: POD(), surface: SURF(), acts: ACTS(),
      drag: DRAG(), hunt: HUNT(),
      wrapped: CBZ.sharkBrain === wrapped,
      consumes: {
        predatorHunt: typeof CBZ.predatorHunt === "function",
        predatorKit: typeof CBZ.predatorKit === "function",
        predatorDisengage: typeof CBZ.predatorDisengage === "function",
        creatureFight: typeof CBZ.creatureFight === "function",
        creatureTonicRoll: typeof CBZ.creatureTonicRoll === "function",
        marinePodNeeded: typeof CBZ.marinePodNeeded === "function",
        wildlifeSize: typeof CBZ.wildlifeSize === "function",
        goreChum: typeof CBZ.goreChum === "function",
        aquaticFin: typeof CBZ.aquaticFin === "function",
        sharkMover: true,
      },
      counters: AUDIT,
    };
  };

  // THE RATCHET. This file ticks the shared drivers rather than owning a loop,
  // and says so where the audit can read it — an audit that hides its wins is
  // as useless as one that hides its debt.
  if (typeof CBZ.predatorAdopt === "function") {
    try { CBZ.predatorAdopt("wildlife_orca:hunt"); } catch (e) {}
  } else {
    try { (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push("wildlife_orca:hunt"); } catch (e) {}
  }
})();
