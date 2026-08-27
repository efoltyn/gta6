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
     §7  THE MEGALODON TAKEDOWN — the threshold, and a forward sim of the
         fight's own numbers so "one loses, three grind, enough win" is a
         measurement rather than a claim.
     §7b THE MOB — the same fight, driven from here, for every page that does
         not load marine_predation.js. It stands down completely when that file
         IS loaded; see the note in §7 about the eight-orca measurement that
         made this necessary.

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
     CBZ.orcaBrain(a, dt, P)             the tick (installed on CBZ.sharkBrain,
                                         and self-driven from the 47.2 pass on
                                         any host that has no wildlife.js)
     CBZ.orcaIdentity(a)                 {sex, bull, cow, calf, dorsalSpan, ...}
     CBZ.orcaSurfaceRead(a)              what is above the water, in metres
     CBZ.orcaPodRead(a)                  formation, station, matriarch, calf
     CBZ.orcaTakedown(orca, quarry, n)   {needed, have, verdict, seconds,
                                         killed, casualties, survivors} — the
                                         fight's own numbers run forward
     CBZ.orcaUseLegacyModel(on)          put aquatic.js's original orca back
                                         (the before/after A/B seam)
     CBZ.orcaStage(a, act, arg)          force a sex or an act (staging only)
     CBZ.orcaFinDrop(a)                  tear the surface proxy down
     CBZ.orcaAudit()                     counters (no gameplay reads it)
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
  /* ?orca=off — the whole block, from the URL, so the before/after tool (and
     anyone debugging) can revert this file without editing a line. Read at
     LOAD, before the species registration, because a build is baked at
     registration and cannot be flipped later (see CBZ.orcaUseLegacyModel).
     ORCA_POD is shared with city/marine_predation.js's tactical layer on
     purpose: "orca=off" means no orca concept anywhere, not half of one. */
  try {
    if (typeof location !== "undefined" && location.search &&
        /(^|[?&])orca=off(&|$)/.test(location.search)) {
      CFG.ORCA_V1 = false; CFG.ORCA_POD = false; CFG.ORCA_SURFACE = false;
      CFG.ORCA_ACTS = false; CFG.ORCA_DRAG = false; CFG.ORCA_HUNT = false;
    }
  } catch (e) {}

  function MODEL() { return CFG.ORCA_V1 !== false; }
  function POD() { return CFG.ORCA_POD !== false; }
  function SURF() { return CFG.ORCA_SURFACE !== false; }
  function ACTS() { return CFG.ORCA_ACTS !== false; }
  function DRAG() { return CFG.ORCA_DRAG !== false; }
  function HUNT() { return CFG.ORCA_HUNT !== false; }
  /* MARINE_SIT_DEEPER — owner, 2026-08-25: "orcas and sharks are just slightly
     too high up in the water, it's not bad but this out-of-water bit should go
     under water and dive more naturally." Declared in city/wildlife_tame.js
     (the aquatic-ride owner) and read here so the ridden body and the wild pod
     answer to ONE switch: ?cfg_MARINE_SIT_DEEPER=0 restores every number this
     file used to ride at. Deliberately does NOT touch the breach, the spy-hop
     or the tail lob — those are the acts that are SUPPOSED to leave the water,
     and their heights were staged against the owner's reference photographs. */
  if (CFG.MARINE_SIT_DEEPER == null) CFG.MARINE_SIT_DEEPER = true;
  function SITLOW() { return CFG.MARINE_SIT_DEEPER !== false; }

  let FRAME = 0;              // the late pass's own clock; nothing else reads it
  const AUDIT = {
    blows: 0, spyhops: 0, breaches: 0, tailLobs: 0, porpoises: 0,
    grabs: 0, drags: 0, breakoffs: 0, commits: 0, formations: 0, calves: 0,
    rams: 0, rolls: 0, kills: 0,
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
  /* THE MOUTH INTERIOR IS UNLIT, and the hex values that follow look absurdly
     dark because they are correct. core/renderer.js runs outputEncoding =
     sRGBEncoding with ColorManagement.enabled = false, so an authored colour is
     treated as LINEAR and brightened on the way out — then MeshLambert takes
     the same key light as the whale's back on top of that. That is how a mouth
     written as 0x100609 and a deck written as 0x32171c ended up rendering as
     the broad salmon trough that filled every open orca gape: nothing was
     wrong with the winding or the geometry, the interior was simply never the
     dark it was written as. MeshBasic holds these where a throat belongs, and
     DoubleSide keeps a grazing sightline from finding a hole in the mesh. */
  const UNLIT_CACHE = new Map();
  function unlit(c) {
    let mm = UNLIT_CACHE.get(c);
    if (!mm) { mm = new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }); UNLIT_CACHE.set(c, mm); }
    return mm;
  }

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
    const paint = o.paint, mouth = o.mouth || null;
    const sh = new Shell(), id = [];
    for (let i = 0; i < n; i++) {
      const r = rings[i], row = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * Math.PI * 2;
        let y = r.y + Math.sin(a) * r.ry;
        // An authored mouth removes the static chin from the front of the
        // hull.  Vertices below the mouth roof collapse onto an interior
        // palate; the real lower-body surface is rebuilt in the hinged lower
        // envelope below.  This is deliberately geometry, not a black decal:
        // when the mandible opens there is no intact whale face behind it.
        if (mouth && r.x >= mouth.startX) {
          const seam = mouth.seamY(r.x);
          if (y < seam) y = seam;
        }
        row.push(sh.v(r.x, y, Math.cos(a) * r.rz));
      }
      id.push(row);
    }
    function slot(i, j) {
      const a0 = (j / sides) * Math.PI * 2, a1 = ((j + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) * 0.5;
      const s = Math.sin(am);
      const af = Math.atan2(s, Math.abs(Math.cos(am)));      // folded onto one flank
      const u = n > 1 ? i / (n - 1) : 0;
      if (mouth) {
        const r0 = rings[Math.min(i, n - 1)], r1 = rings[Math.min(i + 1, n - 1)];
        const x = (r0.x + r1.x) * 0.5;
        if (x >= mouth.startX) {
          const cy = (r0.y + r1.y) * 0.5;
          const ry = (r0.ry + r1.ry) * 0.5;
          if (cy + s * ry < mouth.seamY(x) + 1e-5) return mouth.interiorSlot == null ? 2 : mouth.interiorSlot;
        }
      }
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

  /* THE LOWER BODY ENVELOPE.  A cetacean mandible is not a narrow cigar hung
     below a complete whale hull: the visible white chin and throat ARE the
     mandible's outer surface.  This shell samples the same body rings as the
     hull, follows their exact underside and beam, closes on an interior-dark
     deck, and lives in hinge-local space so the shared swim rig can rotate it
     without translating its root.  The same descriptor shape is intentionally
     usable by any future toothed whale builder. */
  function lowerEnvelopeGeom(o) {
    const sh = new Shell(), N = o.stations || 14, ARC = o.arcSteps || 10;
    const rows = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), x = lerp(o.x0, o.x1, t), r = ringAt(o.rings, x);
      const rimWorld = o.rimY(x), rim = rimWorld - o.hingeY;
      const bottom = r.y - r.ry - o.hingeY;
      const depth = Math.max(0.05, rim - bottom);
      const rel = clamp((rimWorld - r.y) / Math.max(0.02, r.ry), -0.96, 0.96);
      let halfW = r.rz * Math.sqrt(Math.max(0.02, 1 - rel * rel));
      // The root and nose taper only a WHISKER. The shipped 0.42/0.72 root
      // taper left the dark palate exposed in the gap between hull flank and
      // chin from below — a maroon ring on a closed whale. At rest this
      // surface IS the body's lower silhouette, so it keeps the hull's beam
      // to within a crease everywhere it can be seen.
      halfW *= (i === 0 ? 0.96 : (i === 1 ? 0.99 : 1)) * (i === N - 1 ? 0.55 : 1);
      const pts = [], ids = [];
      for (let k = 0; k <= ARC; k++) {
        const ph = (k / ARC) * Math.PI;
        const p = [x - o.hingeX,
          rim - depth * Math.pow(Math.sin(ph), 0.84),
          Math.cos(ph) * halfW];
        pts.push(p); ids.push(sh.v(p[0], p[1], p[2]));
      }
      const deckDrop = o.deckDrop == null ? 0.035 : o.deckDrop;
      [[-halfW * 0.72, 0], [halfW * 0.72, 0]].forEach(function (q) {
        const p = [x - o.hingeX, rim - deckDrop, q[0]];
        pts.push(p); ids.push(sh.v(p[0], p[1], p[2]));
      });
      rows.push({ pts: pts, ids: ids, rim: rim, depth: depth });
    }
    const M = ARC + 3;
    /* THE WINDING IS THE CHIN (owner, 2026-08-22: "underside of orca like
       chin is see thru even before mouth gaps, it's like a missing orca
       chunk"). The strip below shipped wound the other way round, which put
       the outer skin's normals INSIDE the jaw: r128 culls back faces, so
       from below and ahead the whole white underside vanished and the camera
       looked straight through the culled keel onto the dark deck — a hole in
       a closed whale. This order faces the keel arc OUT/DOWN (the visible
       chin) and the deck UP (the mouth floor you see when the jaw drops).
       Verified from underneath by orca-pod's markings-under frame, which is
       exactly the angle that caught it. */
    for (let i = 0; i < N - 1; i++) {
      const a = rows[i], b = rows[i + 1];
      for (let k = 0; k < M; k++) {
        const k2 = (k + 1) % M;
        sh.quad(k <= ARC - 1 ? 0 : 1, a.ids[k2], b.ids[k2], b.ids[k], a.ids[k]);
      }
    }
    const cap = function (row, forward) {
      const c = sh.v(row.pts[0][0] + (forward ? 0.018 : -0.018),
        row.rim - row.depth * 0.48, 0);
      for (let k = 0; k < M; k++) {
        const k2 = (k + 1) % M;
        if (forward) sh.tri(k <= ARC - 1 ? 0 : 1, row.ids[k2], c, row.ids[k]);
        else sh.tri(k <= ARC - 1 ? 0 : 1, row.ids[k], c, row.ids[k2]);
      }
    };
    cap(rows[0], false); cap(rows[rows.length - 1], true);
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
  /* THE RUNTIME PROBE, and it is a probe rather than an assumption because
     city/wildlife/aquatic.js is being edited concurrently and may or may not
     have published more of its kit by the time this loads.

     CBZ.aquaticFin(mats, at, shape) is that file's SINGLE-blade builder and its
     shape grammar is the one emitBlade above is a port of, so a single blade
     is delegated to it whenever it exists — which keeps this animal's fins on
     the same geometry cache as every other fin in the ocean and means one fix
     there fixes an orca too. It is NOT used for the flukes: the two lobes have
     to be ONE mesh (see bladeMesh) and no merged builder is published.

     The HULL is deliberately not delegated even if a builder appears: that
     file's hull takes a `bellyCut` scalar/array, and an orca's markings need a
     per-face paint callback with a mirrored flank angle. Delegating to a
     narrower contract would silently drop the flank flare. */
  function finOf(mats, at, shape, key) {
    if (typeof CBZ.aquaticFin === "function") {
      try {
        const m = CBZ.aquaticFin(mats, at, shape);
        if (m && m.isMesh) return m;
      } catch (e) {}
    }
    return bladeMesh(mats, at, shape, key);
  }
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
      /* WINDING, AND IT IS NOT A DETAIL — it is a bug the report caught and no
         metric could have. Both branches used to be the other way round, so
         every marking on this animal was BACK-FACED: the eye patch, the saddle
         and the blowhole were all present in the geometry, all correctly
         placed, and all invisible from the flank the camera was on, because the
         host's materials are FrontSide. The close-up frame showed a bare head.

         Work it out rather than guessing: on the +z flank the outward normal is
         +z, and going round th CCW in the (x, angle) plane is x -> y, which is
         CCW seen from +z, i.e. front-facing. Emitting (r,j) (r,nj) (r+1,nj)
         (r+1,j) makes the second triangle run j -> nj -> j the wrong way; the
         (r,j) (r+1,j) (r+1,nj) (r,nj) order is the CCW one. The -z flank is
         mirrored and therefore takes the opposite order. */
      for (let r = 0; r < rad; r++) {
        for (let j = 0; j < seg; j++) {
          const nj = (j + 1) % seg;
          if (flip > 0) sh.quad(0, grid[r][j], grid[r + 1][j], grid[r + 1][nj], grid[r][nj]);
          else sh.quad(0, grid[r][j], grid[r][nj], grid[r + 1][nj], grid[r + 1][j]);
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
  /* HOW FINE THE SKIN IS, and it is the marking resolution, not a polish
     number. At 34x24 the countershading boundary — which the reference sheet
     calls a HARD, RAGGED, high-contrast line — snapped to whole columns and
     came out as a flight of rectangular stairs down the flank: one angular
     step is 0.26 rad, which is 0.21 of the sine the cut is written in, so a
     jitter of +/-0.055 could not move the line by even a quarter of a step and
     the "ragged" edge was perfectly regular. 48x36 puts the step at 0.09 and
     the jitter below is scaled to actually cross it. ONE cached geometry for
     every orca in the world, so the cost is 3.5k triangles once. */
  const HULL_RINGS = 48, HULL_SIDES = 36;
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
  const JAW_X = 1.52, JAW_Y = 0.74;
  // The roof and the white chin share one closure curve.  Teeth interlock
  // behind that outer seam; leaving a visible vertical gap for them made the
  // resting animal look permanently open.  The curve still tapers with the
  // blunt nose instead of drawing a ruler-straight cut through the melon.
  function orcaRoofY(x) {
    const t = clamp((x - JAW_X) / Math.max(0.01, HX1 - JAW_X), 0, 1);
    return lerp(0.93, 0.89, t * t);
  }
  function orcaChinRimY(x) {
    return orcaRoofY(x);
  }

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
    // A WANDERING LINE DOWN THE FLANK (per column) plus a smaller per-ring
    // wobble. Both hash-derived, so the same animal always tears the same way
    // and the world stays byte-identical. Sized to be MORE than one angular
    // step, which is the whole difference between ragged and stair-stepped.
    const jit = (h01(j * 7 + 1, 0, 0x0C1) - 0.5) * 0.135
      + (h01(j * 7 + 1, i * 13 + 3, 0x0C2) - 0.5) * 0.075;
    let cut = sample(CUT, u) + jit;
    const d = u - 0.255;
    const w = d < 0 ? 0.185 : 0.135;                 // skewed: it flares TAILWARD
    cut += 0.92 * Math.exp(-(d * d) / (w * w));
    return s < cut ? 1 : 0;
  }

  const HULL_KEY = "orcaHull|mouth-envelope-v3|" + HULL_RINGS + "x" + HULL_SIDES;

  function build(ctx) {
    const m = ctx.mat, g = new T.Group();
    // GLOSSY JET BLACK against CRISP BRIGHT WHITE. This is the
    // highest-contrast animal in the game and the contrast is the whole read,
    // so the black goes darker than any other hide in the bestiary and the
    // white goes brighter than the great white's belly.
    // THE SADDLE HAS TO BE GREY, not white. At 0x93a0a8 under a bright key it
    // rendered as a second eye patch on the back — a marking that does not read
    // as its own colour is a marking that is not there. It sits between the jet
    // and the white with clear daylight on both sides.
    const black = m(0x0a0c10), white = m(0xf7faf8), saddle = m(0x717f88);
    const eyeM = m(0x04050a), pink = m(0x7a3a40), gum = m(0x6f353b), tooth = m(0xf2ead6);
    const mouthDark = unlit(0x070202), deckGum = unlit(0x0b0304);

    const rings = ringsOf(HX0, HX1, HY, RY, RZ, HULL_RINGS);
    const hull = meshOf(cached(HULL_KEY, function () {
      return hullGeom({
        rings: rings, sides: HULL_SIDES, paint: orcaPaint,
        mouth: { startX: JAW_X - 0.12, seamY: orcaRoofY, interiorSlot: 2 },
      });
    }), [black, white, mouthDark]);
    hull.name = "cetaceanHull";            // the name aquatic.js's cetaceans use
    g.add(hull);

    /* THE WHITE POST-OCULAR EYE PATCH. An oval of white set ABOVE and BEHIND
       the eye, its long axis angled BACK along the body. Its absence is the
       entire reason the old model read as a generic dolphin, and a photograph
       of an orca is unmistakable at 200 m because of this one mark. */
    const patch = new T.Mesh(cached("orcaEyePatch|v1", function () {
      return patchGeom({
        rings: rings, x: PATCH_X, ang: PATCH_AF, rx: 0.34, rArc: 0.145,
        tilt: 0.36, arcR: 0.74, lift: 0.030, seg: 24, rad: 4,
      });
    }), white);
    patch.name = "orcaEyePatch"; g.add(patch);

    /* THE GREY SADDLE. A lighter grey-white blaze behind AND BELOW the dorsal
       fin, crescent-shaped because it wraps the fin's base rather than sitting
       square behind it. `radius(th)` is what makes it a cape and not a blob. */
    const sad = new T.Mesh(cached("orcaSaddle|v1", function () {
      return patchGeom({
        rings: rings, x: SADDLE_X, ang: SADDLE_AF, rx: 0.62, rArc: 0.34,
        tilt: -0.10, arcR: 0.80, lift: 0.026, seg: 26, rad: 4,
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
        tilt: 0, arcR: 0.80, lift: 0.020, seg: 16, rad: 2,
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
    const bull = finOf([black], [DORSAL_X, DORSAL_Y, 0], BULL_DORSAL, "bullDorsal|v1");
    bull.name = "orcaDorsalBull"; g.add(bull);
    const cow = finOf([black], [DORSAL_X, DORSAL_Y, 0], COW_DORSAL, "cowDorsal|v1");
    cow.name = "orcaDorsalCow"; cow.visible = false; g.add(cow);

    /* PECTORALS — broad ROUNDED PADDLES, much larger and blunter than a
       shark's swept blade. chordTip is over half the root chord and apexRound
       is 0.55: that is the difference between a paddle and a knife. */
    [1, -1].forEach(function (s2) {
      // ROOTED ON THE SKIN, NOT INSIDE IT. The hull is ~0.81 half-wide at this
      // station, so a root at 0.52 buried most of the blade and left a stub —
      // the side view showed a dark lump under the belly instead of a paddle.
      const f = finOf([black], [1.28, 0.60, s2 * 0.66], {
        span: 1.52, chordRoot: 1.06, chordTip: 0.66, sweep: 0.26, concavity: 0.02,
        leadBow: 0.12, rearTipH: 0.22, rearTipBack: 0.10, apexRound: 0.58,
        thick: 0.17, spanSteps: 5, chordSteps: 5,
        spanDir: [-0.24, -0.20, s2 * 0.95], chordDir: [1, 0, s2 * 0.08],
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
    /* THE CAVITY IS A HOLE, NOT A LUMP (docs/SHARK-REFERENCE.md §6 — owner:
       "it's like there's a pink rock in the mouth"). This shipped as the same
       convex pink SphereGeometry the sharks had, so an open mouth framed a
       bulging pink object. Same footprint, wound INSIDE-OUT: every sightline
       into the gape lands on the far interior wall, and four material bands
       run warm pink at the rim (the only place the strong pink belongs — the
       gum rail above carries the rest) to near-black down the throat. swimJaw
       still owns the reveal: it expands scale.y with the gape exactly as
       before, so at rest this is a hidden sliver on the mouth line.
       One-line revert: ORCA_CAVITY_HOLE = false. */
    const ORCA_CAVITY_HOLE = true;
    const cavity = ORCA_CAVITY_HOLE
      ? meshOf(cached("orcaCavityHole|v2", function () {
        const sh = new Shell(), SEG = 14, ST = 8;
        const rr = [];
        for (let i = 0; i <= ST; i++) {
          const ph = (i / ST) * Math.PI;         // front pole (+x) -> back pole (-x)
          const x = Math.cos(ph), r = Math.sin(ph), row = [];
          for (let j = 0; j < SEG; j++) {
            const th = (j / SEG) * Math.PI * 2;
            row.push(sh.v(x, Math.sin(th) * r, Math.cos(th) * r));
          }
          rr.push(row);
        }
        for (let i = 0; i < ST; i++) {
          const grp = i < 2 ? 0 : (i < 4 ? 1 : (i < 6 ? 2 : 3));
          for (let j = 0; j < SEG; j++) {
            const nj = (j + 1) % SEG;
            // wound inside-out so the visible face is the interior; the pole
            // rows degenerate to triangles inside Shell.quad
            sh.quad(grp, rr[i][j], rr[i + 1][j], rr[i + 1][nj], rr[i][nj]);
          }
        }
        return sh.geom();
      }), [unlit(0x0b0304), unlit(0x050202), unlit(0x010101), unlit(0x000000)])
      : new T.Mesh(cached("orcaCavity", function () { return new T.SphereGeometry(1, 12, 8); }), pink);
    cavity.name = "orcaMouthCavity";
    // retracted from the old footprint (JAW_X+0.82 ± 0.86 reached the snout
    // tip): front pole behind the tooth rows' end, back pole behind the hinge,
    // so the hole lives entirely inside the closed head.
    cavity.position.set(JAW_X + 0.72, JAW_Y + 0.10, 0);
    // At rest this is a black-red seam, not a pink stripe pasted along the
    // whale's face.  The shared rig expands it tenfold during a gape.
    cavity.scale.set(0.78, 0.018, 0.28);
    g.add(cavity);

    const lower = new T.Group();
    lower.name = "orcaLowerJaw";
    lower.position.set(JAW_X, JAW_Y, 0);
    g.add(lower);
    const mand = meshOf(cached("orcaLowerEnvelope|v4", function () {
      return lowerEnvelopeGeom({
        rings: rings, hingeX: JAW_X, hingeY: JAW_Y,
        x0: JAW_X - 0.12, x1: HX1 - 0.03, rimY: orcaChinRimY,
        stations: 16, arcSteps: 12, deckDrop: 0.024,
      });
    }), [white, deckGum]);
    mand.name = "orcaLowerEnvelope"; lower.add(mand);

    function toothRow(up) {
      return meshOf(cached("orcaTeeth|" + (up ? "u" : "l"), function () {
        const sh = new Shell();
        const N = 11;
        for (let side = -1; side <= 1; side += 2) {
          for (let i = 0; i < N; i++) {
            const t = i / (N - 1);
            const x = lerp(0.20, 1.62, t);
            const z = side * lerp(0.26, 0.075, t);
            // NOAA's status review records roughly two-thirds of an orca tooth
            // inside the maxillary/mandibular alveolus.  The gum rails below
            // cover the root two-thirds; only this short interlocking crown is
            // allowed out into the gape.
            const hgt = lerp(0.075, 0.044, t) * (up ? -1 : 1);
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

    // Two alveolar rails, one under each tooth row.  The former gum mesh was
    // one solid capsule down the centre of the mouth; when the mandible opened
    // head-on, that capsule projected as a broad pink tongue/plank and put the
    // denture silhouette back inside otherwise-correct body geometry.  These
    // narrow rails converge with the teeth and leave real dark volume between.
    function gumRails() {
      return meshOf(cached("orcaPairedGumRails|v1", function () {
        const sh = new Shell(), N = 9, SIDES = 8;
        for (let side = -1; side <= 1; side += 2) {
          const rings2 = [];
          for (let i = 0; i < N; i++) {
            const t = i / (N - 1), x = lerp(0.16, 1.66, t);
            const z = side * lerp(0.26, 0.075, t);
            const ry = lerp(0.034, 0.021, t), rz = lerp(0.050, 0.030, t);
            const row = [];
            for (let j = 0; j < SIDES; j++) {
              const a = (j / SIDES) * Math.PI * 2;
              row.push(sh.v(x, Math.sin(a) * ry, z + Math.cos(a) * rz));
            }
            rings2.push(row);
          }
          for (let i = 0; i < N - 1; i++) {
            for (let j = 0; j < SIDES; j++) {
              const nj = (j + 1) % SIDES;
              sh.quad(0, rings2[i][j], rings2[i + 1][j], rings2[i + 1][nj], rings2[i][nj]);
            }
          }
          const rear = sh.v(0.16, 0, side * 0.26);
          const front = sh.v(1.66, 0, side * 0.075);
          for (let j = 0; j < SIDES; j++) {
            const nj = (j + 1) % SIDES;
            sh.tri(0, rear, rings2[0][nj], rings2[0][j]);
            sh.tri(0, front, rings2[N - 1][j], rings2[N - 1][nj]);
          }
        }
        return sh.geom();
      }), [gum]);
    }
    const lt = toothRow(false); lt.name = "orcaLowerTeeth";
    lt.position.set(0, 0.145, 0); lower.add(lt);
    const lowerGum = gumRails();
    lowerGum.name = "orcaLowerGum"; lowerGum.position.set(0, 0.135, 0); lower.add(lowerGum);

    /* AN UPPER JAW GROUP THAT DOES NOT MOVE, and it is not ceremony.

       An orca does not protrude its upper jaw — a shark does, and it is the
       great white's single most-missed anatomical fact — so this file first
       published `upper: null` and declared protrude 0. The canonical shared
       rig requires an authored upper group because it snapshots that group's
       rest transform alongside the lower hinge.

       The contract therefore publishes the orca's real upper jaw as a fixed
       named group. Its tooth row and paired gum rails live at the hinge where
       they anatomically belong, while protrude/upperDrop stay 0 and the actual
       white mandible opens alone. */
    const upper = new T.Group();
    upper.name = "orcaUpperJaw";
    upper.position.set(JAW_X, JAW_Y, 0);
    g.add(upper);
    const ut = toothRow(true); ut.name = "orcaUpperTeeth";
    ut.position.set(0, 0.205, 0); upper.add(ut);
    const gumRail = gumRails();
    gumRail.name = "orcaUpperGum"; gumRail.position.set(0, 0.235, 0); upper.add(gumRail);

    const REST_CLOSE = 0, MAX_OPEN = 0.52;
    lower.rotation.z = REST_CLOSE;
    const contract = {
      version: 4, shape: "articulated-body-envelope",
      hinge: { x: JAW_X, y: JAW_Y, z: 0 },
      bite: { x: JAW_X + 1.30, y: JAW_Y + 0.16, z: 0 },
      maxOpen: MAX_OPEN, travel: MAX_OPEN + REST_CLOSE, restClose: REST_CLOSE,
      protrude: 0, upperDrop: 0,                        // an orca protrudes nothing
      upperTeeth: 22, lowerTeeth: 22, toothRows: 1,
      bodySplit: true, articulatedEnvelope: true,
      upperShell: "cetaceanHull", lowerShell: "orcaLowerEnvelope",
      embeddedToothFraction: 0.67,
    };
    g.userData.aquaticMouth = contract;
    g._aquaticMouth = {
      lower: lower, upper: upper, lowerShell: mand, upperShell: hull,
      cavity: cavity, contract: contract,
    };

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
  const LEGACY_SPECIES = (CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES.orca) || null;
  const ORCA_SPECIES = {
    id: "orca", name: "Orca", biome: "water", rarity: "rare",
    hp: 620, fur: "Orca Hide", furValue: 520, meat: "Whale Meat", meatValue: 44,
    herd: [3, 8], packs: 3, spd: 3.4, danger: 0.5, bite: 42, aquatic: true,
    scale: 1.55, color: 0x0a0c10, clearance: 110, swimDepth: 2.6,
    build: build,
  };
  if (MODEL() && typeof CBZ.defineSpecies === "function") CBZ.defineSpecies(ORCA_SPECIES);

  /* A REVERT YOU CAN ACTUALLY PHOTOGRAPH. Every other switch in this file is
     read LIVE, so flipping it mid-run is the whole "before" — but a species
     BUILD is baked at registration, so a flag alone cannot put the old animal
     back. The definition this file displaced is therefore kept, and handing it
     back to defineSpecies restores city/wildlife/aquatic.js's orca exactly.
     That is what makes tools/visual-presets/orca-pod.mjs a true A/B of the
     same checkout against itself rather than a comparison with a deployment.
     Returns true when the requested build is the live one. */
  CBZ.orcaUseLegacyModel = function (on) {
    if (typeof CBZ.defineSpecies !== "function") return false;
    const want = on ? LEGACY_SPECIES : ORCA_SPECIES;
    if (!want) return false;
    CBZ.defineSpecies(want);
    return CBZ.WILDLIFE_SPECIES.orca === want;
  };
  CBZ.orcaLegacySpecies = LEGACY_SPECIES;

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
  // The spawn point is the seed for every per-individual draw in this file, so
  // it is resolved ONCE and cached on the actor: podScan asks it for every
  // packmate every sweep, and a fresh {x,z} per ask would be an allocation per
  // orca per orca per second.
  function homeOf(a) {
    const h = a.home;
    if (h && isFinite(h.x)) return h;
    if (a._orcaHome) return a._orcaHome;
    const p = a.pos || (a.group && a.group.position);
    return (a._orcaHome = p ? { x: p.x, z: p.z } : { x: 0, z: 0 });
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
    s.idleT = 8 + h01(h.x, h.z, 0x0C4D) * 26;
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
  // Can the sea be seen into? world/water_spec.js's SEA_TRANSLUCENT. When it
  // can, items 3 and 4 above (the painted body and its painted shadow) stand
  // down in favour of the real animal — see the note in makeProxy().
  function seaClear() { return !!(CBZ.seaTranslucentOn && CBZ.seaTranslucentOn()); }

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

    /* THE PAINTED PAIR — AND WHY THEY ARE GONE (2026-08-25).
       OWNER: "the shadow left by the orca is dumb and fake, like a fake horizon
       — rather than water being slightly opaque and the shadow being real
       then." These two quads were a top-down PAINTING of an orca and a
       top-down PAINTING of its shadow, laid flat on the waterline because the
       sea was an opaque lid and the real animal could not be seen through it.
       world/water_spec.js's SEA_TRANSLUCENT lifts the lid: the sea now blends
       by view angle and the real body is veiled by the real water column. With
       the actual orca visible underneath, a painted orca lying on the surface
       is a second orca, and a painted shadow riding the waterline is precisely
       the flat sticker the owner was pointing at. So neither is built.
       The DORSAL, the SPOUT and the WAKE stay: those are above the water and
       are not standing in for anything. ?cfg_SEA_TRANSLUCENT=0 brings the pair
       straight back. */
    let shadow = null, body = null;
    if (!seaClear()) {
      s.shadowMat = new T.MeshBasicMaterial({
        color: 0x04101a, map: A.maskTex, transparent: true,
        opacity: SHADOW_ALPHA, depthWrite: false,
      });
      shadow = new T.Mesh(A.quad, s.shadowMat);
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.015;
      shadow.renderOrder = 2; shadow.castShadow = false;
      root.add(shadow);

      // THE BLACK-AND-WHITE BODY. Lifted toward the water the way a mass under
      // a metre of sea actually looks — but only a little, because the whole
      // point of an orca is that its patches survive the wash-out.
      s.bodyMat = new T.MeshBasicMaterial({
        color: 0xc8d8d6, map: A.planTex, transparent: true,
        opacity: SHADOW_ALPHA, depthWrite: false,
      });
      body = new T.Mesh(A.quad, s.bodyMat);
      body.rotation.x = -Math.PI / 2; body.position.y = 0.024;
      body.renderOrder = 3; body.castShadow = false;
      root.add(body);
    }

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
    const sc = s.sz = scaleOf(a);
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
    const shWant = (!seaClear() && !a.dead && dist < PROXY_R * 1.15 && dep > 0.25)
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
    if (s.shadow) s.shadow.visible = s.shK > 0.02;
    if (s.shadow && s.shadow.visible) {
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
  const FIGHT_R = 1500;       // ...unless it is already in a fight (see orcaBrain)

  /* WHERE THE ANIMALS ARE, and it is not always CBZ.cityWildlife. That list is
     city/wildlife.js's, and city/wildlife.js is not in the studio packs the
     smaller pages load — games/battle.html runs `beasts` + `bestiary` and has
     no wildlife engine at all. A pod that can only find its packmates in one
     host's private array is a pod that does not exist on any other page, which
     is exactly how the eight-orca measurement came back with a live megalodon.
     So the roster is resolved: wildlife.js's list first, then the capability
     bus (systems/modecaps.js), which every registered game answers for its own
     cast. Refreshed at most once per frame into ONE array that is never
     reallocated. */
  const _roster = [];
  let _rosterF = -1;
  function actorList() {
    const wl = CBZ.cityWildlife;
    if (wl && wl.length) return wl;
    if (typeof CBZ.worldActors === "function") {
      if (_rosterF !== FRAME) {
        _rosterF = FRAME;
        try { CBZ.worldActors(_roster); } catch (e) { _roster.length = 0; }
      }
      return _roster;
    }
    return wl || null;
  }

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
    const list = actorList();
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
      _st.x = -leadLen * (0.45 + 0.32 * rank);
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
      act: "", actT: 0, idleT: 6, breathT: 12, pitch: 0, roll: 0, lift: 0,
      porp: false, porpPh: 0, airborne: false, blown: false, splashed: false, lobbed: false,
      // hunt
      state: "cruise", owned: false, opts: null, look: 0, interest: 0, bored: 0, cool: 0,
      committed: false, chum: null, tick: 0,
      // the mob (§7b) — only ever used when marine_predation.js is absent
      quarry: null, mobT: 0, rolling: null, retreat: 0, ramOpts: null,
      bodyLen: 0, mobNeed: 0, mobHave: 0,
      dive: a.swimDepth || 2.6, diveWant: (a.swimDepth || 2.6) * (SITLOW() ? 1.61 : 1.4), dragT: 0, dragPh: 0,
      mover: null,
    };
    identify(a, s);
    applyIdentity(a, s);
    s.formation = (h01(homeOf(a).x, homeOf(a).z, 0x0C72) * 3) | 0;
    if (!a._waterMove) a._waterMove = { x: 0, z: 0, heading: 0, blocked: false, shore: -999 };
    /* THE REAL ANIMAL IS THE READ NOW (SEA_TRANSLUCENT). Swap the group's
       materials for their veiled twins so the black and the white fade toward
       the water colour by the real water column between the fragment and the
       eye. Cached per source material, idempotent, no-op with the flag off.
       (wildlife_shark.js's ensure() does the same thing and runs first for an
       orca, because wildlife.js routes every danger>=0.5 aquatic through
       sharkBrain — this line is what makes the veil true of an orca even if
       that routing ever changes.) */
    if (a.group && CBZ.waterVeilApply) { try { CBZ.waterVeilApply(a.group); } catch (e) {} }
    /* CAPTURE THE SHARK'S MOVER NOW, BEFORE optsFor() EVER RUNS, and this is
       not a micro-optimisation — it is a recursion guard. predatorKit caches
       ONE merged opts object per actor (`actor._predOpts`), so if this file
       called predatorKit(a, seams) it would overwrite the very object
       a._shark.opts points at, and moveOf() would then hand back this file's
       own swim() as "the shark's mover" and call itself forever. §6 therefore
       copies the kit's BASE instead of asking it to merge, and the one mover
       there has ever been is grabbed here while it is still the shark's. */
    const sh = a._shark;
    if (sh && sh.opts && typeof sh.opts.move === "function") s.mover = sh.opts.move;
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
    const s = a._orca;
    if (s && typeof s.mover === "function") return s.mover;
    const sh = a._shark;
    // never hand back this file's own seam (see the recursion guard in ensure)
    if (sh && sh.opts && typeof sh.opts.move === "function" &&
        !(s && s.opts && sh.opts.move === s.opts.move)) return sh.opts.move;
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

  /* WHEN IS THERE SOMETHING WORTH LOOKING AT. The repo has no one canonical
     "is the player in a boat" predicate — inCar is a ped field and the boat
     lane goes through several owners — so this asks the question it can
     actually answer honestly: is a person close, and are they on top of the
     water rather than in it. Somebody on a deck rates higher than a swimmer
     only because a boat is the thing an orca comes over to inspect; both get
     spy-hopped at, which is exactly what the reference photograph shows. */
  function personNear(a, dist) {
    if (dist > SPY_R) return 0;
    const P = CBZ.player;
    if (!P || P.dead) return 0;
    let swimming = false;
    if (typeof CBZ.citySwimming === "function") { try { swimming = !!CBZ.citySwimming(); } catch (e) {} }
    if (P.inCar || P.vehicle || P.car) return 1.6;      // on/in something
    return swimming ? 1 : 1.4;                          // dry = probably a deck
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
      // MARINE_SIT_DEEPER: 1.5 drafts of air put the ORIGIN 4.3 m over the
      // surface, i.e. the whole nine metres of animal clear of the water on an
      // ordinary fast transit. A porpoise is a low arc that skims — the back
      // and the flank break out, the body does not fly.
      s.lift = Math.max(0, Math.sin(s.porpPh)) * draft * (SITLOW() ? 0.75 : 1.5);
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
      if (s.cool <= 0 && personNear(a, dist) && dist < SPY_R && !s.calf) {
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
      /* BREATHING IS NOT LEVITATION (MARINE_SIT_DEEPER). MEASURED on the live
         island, 60 samples over a pod: during a blow the orca's own
         CBZ.orcaSurfaceRead reported the body **2.10 m ABOVE the surface** at
         its worst and a mean of 4.07 m of dorsal in the air, peaking at 7.15 m.
         That is the owner's "orcas are just slightly too high up in the water …
         this out-of-water bit should go under water", and it is not a tuning
         drift: `lift = 0.85 × draft` is a target ABOVE the waterline, applied
         to the one act every orca in the pod performs on a 26-60 s clock. So a
         breath — the most frequent thing an orca does — was the biggest jump in
         the game.
         The honest shape is a rise to the SURFACE, not through it: aim the same
         eased curve at a shallow DEPTH instead of a height, and let depth()'s
         own submersion clamp (0.92 × draft, which puts the back and the whole
         dorsal in the air and nothing else) be what stops it. `s.airborne`
         stays false for a blow now, which is what re-arms that clamp — the act
         no longer asks for the exemption a breach legitimately needs. */
      const rise = Math.sin(clamp(k, 0, 1) * Math.PI);
      if (SITLOW()) s.lift = -draft * (1.25 - 1.05 * rise);   // ⇒ diveWant = a depth
      else s.lift = rise * (draft * 0.85);
      s.pitch = -Math.sin(k * Math.PI * 2) * 0.10;
      if (!s.blown && k > 0.42) { s.blown = true; fireSpout(a, s); }
      if (s.actT <= 0) endAct(s);
    } else if (s.act === "spyhop") {
      /* RISE VERTICALLY, HOLD, SINK. The pitch goes to ~72 degrees nose-up and
         the animal turns its head to the boat while it is up there — an orca
         spy-hops in order to SEE, so a spy-hop that does not look at anything
         is a pose, not a behaviour. */
      const T0 = 4.6, e = clamp((T0 - s.actT) / T0, 0, 1);
      const up = e < 0.30 ? e / 0.30 : (e > 0.74 ? 1 - (e - 0.74) / 0.26 : 1);
      s.lift = up * draft * 2.1;
      s.pitch = -up * 1.26;                          // ~72 degrees nose-up
      const P = CBZ.player;
      if (P && P.pos && up > 0.5) {
        // AN ORCA SPY-HOPS IN ORDER TO SEE. One that does not turn its head to
        // the thing it came to look at is a pose, not a behaviour.
        const want = Math.atan2(P.pos.z - g.position.z, P.pos.x - g.position.x);
        a.heading += shortest(want - a.heading) * Math.min(1, dt * 1.6);
      }
      if (s.actT <= 0) endAct(s);
    } else if (s.act === "breach") {
      const T0 = 2.9, e = clamp((T0 - s.actT) / T0, 0, 1);
      const f = clamp(e / 0.72, 0, 1);
      s.lift = Math.sin(f * Math.PI) * draft * 4.2;
      s.pitch = -Math.cos(f * Math.PI) * 0.85;
      s.roll = Math.sin(e * 4.2) * 0.30;
      if (!s.splashed && e > 0.80) {
        s.splashed = true;
        if (CBZ.waterSplashAt) {
          try { CBZ.waterSplashAt(g.position.x, surf, g.position.z, 3.6 * (s.sz || 1)); } catch (e2) {}
        }
      }
      if (s.actT <= 0) endAct(s);
    } else if (s.act === "taillob") {
      const T0 = 3.1, e = clamp((T0 - s.actT) / T0, 0, 1);
      const ph = Math.sin(clamp(e, 0, 1) * Math.PI * 3);
      s.pitch = ph * 0.55;                          // flukes up, then slammed down
      s.lift = Math.max(0, Math.sin(e * Math.PI)) * draft * 0.45;
      if (!s.lobbed && ph < -0.9) {
        s.lobbed = true;
        if (CBZ.waterSplashAt) {
          try {
            CBZ.waterSplashAt(g.position.x - Math.cos(a.heading) * 3 * (s.sz || 1), surf,
              g.position.z - Math.sin(a.heading) * 3 * (s.sz || 1), 2.6 * (s.sz || 1));
          } catch (e3) {}
        }
      }
      if (s.actT <= 0) endAct(s);
    }
    s.airborne = s.lift > draft * 0.35;
    s.diveWant = -s.lift;                            // "the body belongs up there"
    return true;
  }

  // The pose is applied AFTER everyone else has written the transform, which is
  // the only ordering that survives wildlife.js's animateSwim, creature_combat's
  // strike poses and marine_predation's roll-over all wanting the same three
  // numbers. Additive on roll, absolute on pitch and lift.
  function applyPose(a, s) {
    const g = a.group;
    if (!g) return;
    // ABSOLUTE on pitch, ADDITIVE on roll. animateSwim assigns rotation.x and
    // rotation.z outright every frame, so neither of these can accumulate; and
    // the HEIGHT is not here at all — it is depth()'s, via s.diveWant. One
    // system owns y, or the act fights the thing holding the animal down.
    if (s.act || s.porp || Math.abs(s.pitch) > 0.001 || Math.abs(s.roll) > 0.001) {
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
        // MARINE_SIT_DEEPER trims the RESTING lane only (the trailing 1.4 —
        // "nobody is being hunted right now"). rush/seize/circle are the
        // shallow, deliberate, visible states and keep their own numbers.
        s.diveWant = d * (ns === "rush" ? 1.7 : ns === "seize" ? 0.6 : ns === "circle" ? 0.85
          : (SITLOW() ? 1.61 : 1.4));
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
    /* ASK THE KIT FOR ITS BASE AND COPY IT — never for a merge. predatorKit
       caches one merged object per actor and wildlife_shark.js has already
       claimed it; merging on top would silently rewrite the shark's opts (and,
       through them, the mover marine_predation borrows). marine_predation does
       the same copy for the same reason. */
    let kit = null;
    if (typeof CBZ.predatorKit === "function") {
      let base = null;
      try { base = CBZ.predatorKit(a); } catch (e) { base = null; }
      if (base) {
        kit = {};
        for (const k in base) kit[k] = base[k];
        if (base.seize && typeof base.seize === "object") {
          const sz = kit.seize = {};
          for (const j in base.seize) sz[j] = base.seize[j];
        }
        for (const k in SEAMS) { if (k !== "seize") kit[k] = SEAMS[k]; }
        if (!kit.seize || typeof kit.seize !== "object") {
          kit.seize = {
            jaw: CBZ.creatureJawPoint ? CBZ.creatureJawPoint(a) : { x: 2.8, y: 0.75, z: 0 },
            dps: 14 + (sp.bite || 42) * 0.42, hold: 4.6, escape: 0.16,
            thrash: 1.25, medium: "water", qteMax: 2,
          };
        }
        for (const j in SEAMS.seize) kit.seize[j] = SEAMS.seize[j];
      }
    }
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
    // an ACT is a fast, deliberate move; ordinary depth is a slow drift
    s.dive += (s.diveWant - s.dive) * Math.min(1, dt * (s.airborne || s.act ? 4.5 : 1.1));
    let y = surf - s.dive;
    const draft = a.swimDepth || 2.6;
    // THE SUBMERSION CLAMP IS LIFTED FOR AN ACT. A breach whose body may not
    // leave the water is not a breach, and a spy-hop under the surface is a
    // hovering whale. The seabed clamp below is NOT lifted — the bed always
    // wins, which is wildlife_shark.js's order and its reasoning.
    if (!s.airborne && y > surf - draft * 0.92) y = surf - draft * 0.92;
    if (CBZ.cityAquaticBedRestY) {
      const lift = CBZ.cityAquaticBedLift ? CBZ.cityAquaticBedLift(a.species) : scaleOf(a) * 0.9;
      const lo = CBZ.cityAquaticBedRestY(g.position.x, g.position.z, draft, lift, t, surf);
      if (y < lo) y = lo;
    }
    g.position.y += (y - g.position.y) * Math.min(1, dt * (s.airborne || s.act ? 7 : 3.2));
  }

  // ============================================================
  //  §7. THE MEGALODON TAKEDOWN.
  //
  //  IT USED TO BE CONSUMED AND ONLY CONSUMED, and that was a real bug, found
  //  by measurement rather than by reading: the NPC-war agent staged an
  //  EIGHT-ORCA POD against a megalodon in games/battle.html and at t+52 s the
  //  megalodon was still alive. Eight is double the threshold. The cause was
  //  not the arithmetic — it was that the arithmetic was not there:
  //  games/battle.html loads the `beasts`/`bestiary` studio packs, which carry
  //  creature_combat.js and the bestiary but NOT city/marine_predation.js, so
  //  every consume in this section returned null and the headline feature of
  //  the whole block silently did not exist on that page.
  //
  //  "CONSUME IT IF PRESENT" IS ONLY HONEST IF THE ABSENT CASE ALSO WORKS.
  //  So this section now carries the whole fight itself — pick the quarry,
  //  hold a bearing, ram, stagger, unlock the finisher on the number, roll it
  //  belly-up, hold it under, drown it — and STANDS DOWN COMPLETELY when
  //  city/marine_predation.js is loaded (one check: CBZ.marineRelation). Two
  //  implementations never run at once; the second one only exists so the
  //  feature cannot vanish with a script tag.
  //
  //  THE NUMBERS ARE THE SAME NUMBERS. Both derivations solve time-to-kill
  //  each way off hp/bite/scale with size on both sides, so a monster meg
  //  beats a pod that would kill an average one and a pod of big bulls beats a
  //  meg a small pod could not — and, for the authored rows, both say FOUR.
  //
  //  AND IT HAS TO RESOLVE ON A WATCHABLE TIMESCALE. A player who parks a boat
  //  and watches a pod work a megalodon must see it END — tens of seconds, not
  //  minutes. Two things buy that, and both are corrections of how a naive pod
  //  behaves rather than damage inflation:
  //
  //    1. EVERY MEMBER ATTACKS. A pod that passes one commit token round is a
  //       pod whose eight members do the damage of one; real orcas take turns
  //       committing, but the others are not idling — they are harrying from
  //       their own bearings. So the turn-taking here is a PHASE OFFSET on a
  //       shared cadence, not a queue, and eight orcas genuinely hit eight
  //       times as often as one.
  //    2. THE FINISHER IS ONE-WAY. Once the roll begins it runs to the death;
  //       it cannot re-enter its own first phase, which is the failure mode
  //       that produces exactly the symptom above — constant pressure and no
  //       death. `_orcaRoll` is set once, ticked from one place, and the last
  //       frame of it is lethal.
  //
  //  CBZ.orcaTakedown() is the probe, and it does not assert any of this: it
  //  runs the fight's OWN numbers forward on a fixed step and reports how many
  //  seconds it takes and how many orcas die doing it. That is what the
  //  before/after table prints.
  // ============================================================
  const MOB = {
    SCAN: 1.3,          // s between quarry re-scans, per orca
    R: 300,             // u — a quarry further than this is not our problem
    RAM_EVERY: 2.2,     // s — ONE member's ram cadence (they phase, not queue)
    RAM_K: 2.0,         // ram damage = dpsAgainst x this
    LAND: 0.62,         // fraction of ram attempts that actually connect
    ROLL_HP: 0.35,      // quarry hp fraction that unlocks the finisher
    ROLL_S: 4.6,        // s the roll-over takes, end to end
    BREAK_HP: 0.50,     // below this and short-handed, a member leaves
    MOB_MAX: 2.6,       // a pod's quarry may be at most this x its own scale
  };

  function hpOf(a) { return Math.max(1, a.maxHp || (a.species && a.species.hp) || 100); }
  /* WHAT THIS ANIMAL DOES PER SECOND, from the shared kit when predator.js is
     loaded and from the bestiary row when it is not — so the number is the
     same one the strike driver will actually apply either way. */
  function dpsOf(a) {
    const sp = a.species || {};
    if (typeof CBZ.predatorKit === "function") {
      let k = null;
      try { k = CBZ.predatorKit(a); } catch (e) { k = null; }
      if (k && k.dmg > 0 && k.rate > 0) return k.dmg / k.rate;
    }
    return (sp.bite || 10) / 1.4;
  }
  // THE ONE EXPRESSION IN WHICH SIZE MATTERS BOTH WAYS: a bigger attacker hits
  // harder (^1.6, a linear-dimension bite force) and a bigger defender soaks
  // more (^2.2, its mass). Individual size only — the species constant is
  // already inside dpsOf and hpOf, and multiplying it in twice is the classic
  // way this kind of ladder goes quietly wrong.
  function dpsAgainst(att, def) {
    return dpsOf(att) * Math.pow(sizeOf(att), 1.6) / Math.pow(sizeOf(def), 2.2);
  }
  /* HOW MANY DOES IT TAKE — closed form, no actor needed, no species name.
     ratio = ttk(pod member -> quarry) / ttk(quarry -> pod member). One spare
     over the break-even, because a fight is not an average. */
  function neededFallback(orca, quarry) {
    const ttkA = hpOf(quarry) / Math.max(0.01, dpsAgainst(orca, quarry));
    const ttkB = hpOf(orca) / Math.max(0.01, dpsAgainst(quarry, orca));
    const ratio = ttkA / Math.max(0.01, ttkB);
    if (!isFinite(ratio) || ratio <= 0) return 12;
    const n = ratio >= 1 ? Math.ceil(ratio) + 1 : Math.max(1, Math.ceil(ratio));
    return clamp(n, 1, 12);
  }
  function neededFor(orca, quarry) {
    if (typeof CBZ.marinePodNeeded === "function") {
      try { const n = +CBZ.marinePodNeeded(orca, quarry); if (n > 0) return n; } catch (e) {}
    }
    return neededFallback(orca, quarry);
  }

  /* THE FORWARD SIM. Not a model of the fight — the fight's own numbers, on a
     quarter-second step, with the quarry biting back and killing members as it
     goes. It answers the only question that matters about this feature: DOES
     IT END, and how long does the player have to watch. Pure arithmetic, no
     actors moved, no allocation beyond one result object per call. */
  function simulate(orca, quarry, n) {
    const perRam = dpsAgainst(orca, quarry) * MOB.RAM_K;
    const back = dpsAgainst(quarry, orca);
    const floor = hpOf(quarry) * MOB.ROLL_HP;
    const need = neededFor(orca, quarry);
    const n0 = Math.max(1, n | 0);
    let hpQ = hpOf(quarry), alive = n0, lost = 0, left = 0;
    let hpMe = hpOf(orca), t = 0, rolled = false;
    const STEP = 0.25, CAP = 240;
    while (t < CAP) {
      t += STEP;
      let dmg = (alive * perRam * MOB.LAND / MOB.RAM_EVERY) * STEP;
      // THE FLOOR IS THE STALEMATE, and it is what makes "three is a grinding
      // draw" a rule rather than a hope: a pod short of the number can harry an
      // apex, bleed it and hold it down to a third of its health, and can never
      // do the last third — that is the roll-over's job and the roll-over is
      // gated on numbers. Without this a big enough grind wins by attrition and
      // the whole three-step curve collapses into "more is faster".
      if (alive < need) dmg = Math.min(dmg, Math.max(0, hpQ - floor));
      hpQ -= dmg;
      if (hpQ <= floor + 1e-6 && alive >= need) { rolled = true; t += MOB.ROLL_S; hpQ = 0; break; }
      if (hpQ <= 0) break;
      // the quarry works ONE of them at a time
      hpMe -= back * STEP;
      if (hpMe <= 0) {
        // short-handed, a member that is losing BREAKS OFF rather than dying —
        // the owner's "one orca takes a bite, breaks off bleeding and retreats"
        if (alive < need) left++; else lost++;
        alive--; hpMe = hpOf(orca);
      }
      if (alive <= 0) break;
    }
    const killed = hpQ <= 0;
    let verdict;
    if (killed) verdict = "kills";
    else if (n0 < Math.max(2, Math.ceil(need * 0.5))) verdict = "loses";
    else verdict = "stalemate";
    return {
      seconds: Number(t.toFixed(1)), killed: killed, rolled: rolled,
      casualties: lost, withdrew: left, survivors: Math.max(0, alive),
      quarryHpPct: Number((100 * Math.max(0, hpQ) / hpOf(quarry)).toFixed(1)),
      verdict: verdict,
    };
  }

  /* THE PROBE. `podOverride` lets a stager ask "what would N of them do"
     without assembling N animals; everything else is read off the two actors.
     `enabled` is not decoration — with the block reverted this fight does not
     happen at all, and a report that printed the arithmetic anyway would be
     claiming a kill that no player would ever see. */
  function takedown(orca, quarry, podOverride) {
    if (!orca || !quarry) return null;
    const needed = neededFor(orca, quarry);
    const s = orca._orca || ensure(orca);
    const have = Math.max(1, (podOverride | 0) || s.podN || 1);
    const sim = simulate(orca, quarry, have);
    // the STATED curve — one loses, two or three grind, enough kill — and the
    // SIMULATED one, side by side, so a disagreement is visible rather than
    // buried. `verdict` is the sim's, because the sim is what actually happens.
    const stated = have >= needed ? "kills"
      : (have >= Math.max(2, Math.ceil(needed * 0.5)) ? "stalemate" : "loses");
    return {
      needed: needed, have: have, verdict: sim.verdict, stated: stated,
      seconds: sim.seconds, killed: sim.killed, rolled: sim.rolled,
      casualties: sim.casualties, withdrew: sim.withdrew, survivors: sim.survivors,
      quarryHpPct: sim.quarryHpPct,
      enabled: POD(),
      source: typeof CBZ.marinePodNeeded === "function" ? "marine_predation" : "wildlife_orca",
      driver: typeof CBZ.marineRelation === "function" ? "marine_predation" : "wildlife_orca",
      rollOver: typeof CBZ.creatureTonicRoll === "function",
      ram: typeof CBZ.creatureFight === "function",
    };
  }

  // ============================================================
  //  §7b. THE MOB ITSELF — the degrade path, and the reason the feature cannot
  //  vanish with a script tag. Stands down entirely when marine_predation.js
  //  is loaded; there is never a frame in which both drive the same animal.
  // ============================================================
  function mobOwnedElsewhere() { return typeof CBZ.marineRelation === "function"; }

  function hurt(target, dmg, by, cause) {
    if (!target || target.dead || !(dmg > 0)) return;
    if (typeof CBZ.cityWildlifeHit === "function") {
      _hit.head = false; _hit.point = null; _hit.dir = null; _hit.from = by || null;
      try { CBZ.cityWildlifeHit(target, dmg, _hit, cause); return; } catch (e) {}
    }
    if (typeof CBZ.hurtWorldActor === "function") {
      try { CBZ.hurtWorldActor(target, dmg, by); return; } catch (e) {}
    }
    // LAST RESORT, and it is a real one: in a studio page there may be no
    // damage bus at all, and a takedown that cannot kill because nobody
    // published a killer is exactly the failure this section was written for.
    target.hp = (target.hp == null ? hpOf(target) : target.hp) - dmg;
    if (target.hp <= 0 && !target.dead) {
      target.hp = 0; target.dead = true;
      if (typeof CBZ.wildlifeDeathTumble === "function") { try { CBZ.wildlifeDeathTumble(target); } catch (e) {} }
    }
  }
  const _hit = { head: false, point: null, dir: null, from: null };

  function mobbable(a, o) {
    if (!o || o === a || o.dead || o.tamed || o.ridden) return false;
    const sp = o.species;
    if (!sp || !sp.aquatic || sp.id === "orca") return false;
    if (!(sp.danger > 0) || !(sp.bite > 0)) return false;      // no teeth, no fight
    const mine = (a.species && a.species.scale) || 1.55;
    return (sp.scale || 1) <= mine * MOB.MOB_MAX;
  }
  function pickQuarry(a, s, dt) {
    s.mobT -= dt;
    if (s.quarry && !s.quarry.dead && s.quarry.group) {
      const q = s.quarry.group.position, p = a.group.position;
      if (Math.hypot(q.x - p.x, q.z - p.z) < MOB.R * 1.5) return s.quarry;
      // IT GOT AWAY. Dropping the reference matters beyond tidiness: orcaBrain
      // widens its own sim radius to FIGHT_R while a quarry is held, so a stale
      // pointer would keep this animal thinking at 1500 u forever.
      s.quarry = null;
    }
    if (s.mobT > 0) return null;
    s.mobT = MOB.SCAN;
    const list = actorList();
    if (!list) return (s.quarry = null);
    const p = a.group.position;
    let best = null, bd2 = MOB.R * MOB.R;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!mobbable(a, o) || !o.group) continue;
      const dx = o.group.position.x - p.x, dz = o.group.position.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd2) { bd2 = d2; best = o; }
    }
    return (s.quarry = best);
  }

  function ramOptsFor(a, s) {
    if (s.ramOpts) return s.ramOpts;
    // the pass is a BITE now (creature_combat's bite_flank: jaws on the bite
    // curve, drive capped at the quarry's surface); ?bitepass=off restores
    // the old shut-mouth ram. Same numbers either way — the stagger is the
    // mechanic, the mouth is the read.
    const bite = typeof CBZ.creatureBitePass === "function" ? !!CBZ.creatureBitePass() : true;
    const o = s.ramOpts = {
      style: bite ? "bite_flank" : "ram_flank", seize: false, reach: 0, dmg: 0,
      speed: (s.opts && s.opts.rushSpeed > 0) ? s.opts.rushSpeed * 0.85 : 12,
      rate: MOB.RAM_EVERY,
      onHit: function () {
        const q = s.quarry;
        if (!q || q.dead) return;
        /* THE SAME FLOOR THE FORWARD SIM USES. A pod short of the number can
           bleed an apex down to a third and no further; the last third is the
           roll-over's, and the roll-over is gated on numbers. Two places would
           be two answers, so both read MOB.ROLL_HP and neededFor(). */
        let dmg = dpsAgainst(a, q) * MOB.RAM_K;
        if ((s.mobHave || 1) < (s.mobNeed || 1)) {
          dmg = Math.min(dmg, Math.max(0, (q.hp == null ? hpOf(q) : q.hp) - hpOf(q) * MOB.ROLL_HP));
        }
        hurt(q, dmg, a, (bite ? "bitten" : "rammed") + " by a pod of orcas");
        if (typeof CBZ.predatorStagger === "function") {
          try { CBZ.predatorStagger(q, 1.15); } catch (e) {}
        }
        if (typeof CBZ.creatureFlinch === "function") { try { CBZ.creatureFlinch(q); } catch (e) {} }
        const qp = q.pos || (q.group && q.group.position);
        if (qp) {
          if (CBZ.waterSplashAt) {
            try { CBZ.waterSplashAt(qp.x, surfaceAt(qp.x, qp.z, clock()), qp.z, 1.6 + scaleOf(a) * 0.6); } catch (e) {}
          }
          if (CBZ.goreBloom) { try { CBZ.goreBloom(qp.x, (qp.y || 0) + 0.4, qp.z, { amount: 0.7 }); } catch (e) {} }
        }
        AUDIT.rams = (AUDIT.rams || 0) + 1;
      },
    };
    const mv = moveOf(a);
    if (mv) o.move = mv;
    return o;
  }
  // HOW LONG IS THIS ANIMAL, in world metres, cached on the actor (the quarry
  // has no _orca scratch of its own). Only ever used for spacing — the bearing
  // ring and the ram's contact reach — so a proportional estimate off the
  // species' authored scale is the right cost. An exact bounding-box measure
  // would be a Box3 per actor and this is called from a per-frame path.
  function bodyLenOf(a) {
    if (a._orcaLen > 0) return a._orcaLen;
    const orcaLike = !!(a.species && a.species.id === "orca");
    return (a._orcaLen = (orcaLike ? PLAN_LEN : 4.4) * scaleOf(a));
  }

  /* THE ROLL-OVER. A shark held upside down goes into tonic immobility and
     stops fighting; that is how a pod actually kills one, and it is the
     animation that makes this feature.

     IT IS ONE-WAY. `_orcaRoll` is written once, ticked from exactly one place,
     and its last frame is lethal. A finisher that can re-enter its own first
     phase produces constant pressure and no death — which is the precise
     symptom the eight-orca measurement reported, so the guard is not
     defensive tidiness, it is the bug. */
  const ROLLING = [];
  function beginRoll(a, q) {
    if (q._orcaRoll || q._mpRoll) return false;
    const s = a._orca;
    q._orcaRoll = { by: a, t: 0, dur: MOB.ROLL_S, side: h01(homeOf(a).x, homeOf(a).z, 0x0CA1) > 0.5 ? 1 : -1 };
    s.rolling = q;
    if (ROLLING.indexOf(q) < 0 && ROLLING.length < 8) ROLLING.push(q);
    AUDIT.rolls = (AUDIT.rolls || 0) + 1;
    if (typeof CBZ.predatorStagger === "function") { try { CBZ.predatorStagger(q, MOB.ROLL_S + 1.5); } catch (e) {} }
    if (typeof CBZ.creatureEndAttack === "function") { try { CBZ.creatureEndAttack(q); } catch (e) {} }
    return true;
  }
  function stepRoll(a, s, dt) {
    const q = s.rolling;
    if (!q || q.dead || !q._orcaRoll || q._orcaRoll.by !== a) {
      if (q && q._orcaRoll && q._orcaRoll.by === a) q._orcaRoll = null;
      s.rolling = null;
      return false;
    }
    const R = q._orcaRoll;
    R.t += dt;
    const p = clamp(R.t / R.dur, 0, 1);
    // ride it over from the flank, jaws ON the pectoral: the station is the
    // orca's own bite point plus a slice of the quarry's beam, so the mouth
    // grips the fin line and the two bodies never share the same water
    const hp = a.group.position, tp = q.group && q.group.position;
    if (tp) {
      const face = (q.heading != null) ? q.heading : -q.group.rotation.y;
      const br = face + R.side * 1.35;
      const mouth = a.group.userData && a.group.userData.aquaticMouth;
      const jawFwd = (mouth && mouth.bite && mouth.bite.x > 0)
        ? mouth.bite.x * ((a.group.scale && a.group.scale.x) || 1)
        : bodyLenOf(a) * 0.5;
      const rr = jawFwd + bodyLenOf(q) * 0.09;
      const k = Math.min(1, dt * 3.2);
      hp.x += (tp.x + Math.cos(br) * rr - hp.x) * k;
      hp.z += (tp.z + Math.sin(br) * rr - hp.z) * k;
      hp.y += ((tp.y || 0) + 0.4 - hp.y) * k;
      a.heading = Math.atan2(tp.z - hp.z, tp.x - hp.x);
      if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(a.group, a.heading); } catch (e) {} }
      if (CBZ.swimJaw) { try { CBZ.swimJaw(a, 0.7); } catch (e) {} }
    }
    hurt(q, dpsAgainst(a, q) * 2.4 * dt, a, "drowned by a pod of orcas");
    if (p >= 1 || q.dead) {
      // THE LAST FRAME IS LETHAL. Not "a lot of damage" — the kill, so the
      // sequence cannot end with the animal alive and the pod starting over.
      if (!q.dead) hurt(q, hpOf(q) * 2, a, "drowned by a pod of orcas");
      q._orcaRoll = null; s.rolling = null;
      AUDIT.kills = (AUDIT.kills || 0) + 1;
      if (CBZ.swimJaw) { try { CBZ.swimJaw(a, 0); } catch (e) {} }   // let go
      return false;
    }
    return true;
  }
  // the inversion itself, applied LAST (see the 47.2 pass): wildlife.js's
  // animateSwim writes rotation.x every frame and would otherwise undo it on
  // whichever iteration happened to come later.
  function tonicPass(dt) {
    for (let i = ROLLING.length - 1; i >= 0; i--) {
      const q = ROLLING[i];
      const R = q && q._orcaRoll;
      if (!q || !R) {
        // A DEAD ONE KEEPS THE POSE: it died belly-up, and putting it back the
        // right way up on the frame it stops being rolled is the worst read
        // this could produce.
        if (q && !q.dead && typeof CBZ.creatureTonicClear === "function") {
          try { CBZ.creatureTonicClear(q); } catch (e) {}
        }
        ROLLING.splice(i, 1);
        continue;
      }
      if (typeof CBZ.creatureTonicRoll === "function") {
        try { CBZ.creatureTonicRoll(q, clamp(R.t / R.dur, 0, 1), dt); } catch (e) {}
      } else if (q.group) {
        // no animation owner in this page: do the inversion plainly rather
        // than silently not rolling anything over
        q.group.rotation.x = Math.PI * clamp(R.t / R.dur, 0, 1);
      }
    }
  }

  /* ONE MEMBER'S FRAME OF THE MOB. Returns true when it owns the transform. */
  function mobStep(a, s, dt, dist) {
    if (mobOwnedElsewhere() || !POD()) return false;
    if (s.rolling) { if (stepRoll(a, s, dt)) return true; }
    if (a._orcaRoll) return false;                       // I am the one being rolled

    // RETREATING: hurt and short-handed. "One orca loses. It should visibly
    // lose: take a bite, break off bleeding, and retreat."
    if (s.retreat > 0) {
      s.retreat -= dt;
      s.state = "disengage";
      const q = s.quarry;
      if (q && q.group) {
        const away = Math.atan2(a.group.position.z - q.group.position.z,
          a.group.position.x - q.group.position.x);
        swim(a, away, (a._spd0 || a.spd || 3.4) * 2.6, dt);
      } else swim(a, a.heading, (a._spd0 || a.spd || 3.4) * 2.2, dt);
      if (!s.chum && typeof CBZ.goreChum === "function") {
        try { s.chum = CBZ.goreChum(a.group.position.x, a.group.position.y, a.group.position.z, 1.0, 8); } catch (e) {}
      }
      if (s.retreat <= 0) { s.quarry = null; s.mobT = 8; }
      return true;
    }

    const q = pickQuarry(a, s, dt);
    if (!q || !q.group) return false;
    const qp = q.group.position, p = a.group.position;
    const d = Math.hypot(qp.x - p.x, qp.z - p.z);
    if (d > MOB.R) return false;

    const need = neededFor(a, q);
    const have = Math.max(1, s.podN || 1);
    s.mobNeed = need; s.mobHave = have;

    // BREAK OFF DELIBERATELY when it is losing and short-handed.
    if (a.hp != null && a.hp < hpOf(a) * MOB.BREAK_HP && have < need) {
      s.retreat = 9;
      AUDIT.breakoffs++;
      return true;
    }

    // THE FINISHER, gated on the ONE comparison that decides the feature.
    if ((q.hp || hpOf(q)) <= hpOf(q) * MOB.ROLL_HP && have >= need &&
        !q._orcaRoll && !q._mpRoll && d < bodyLenOf(q) * 0.9 + bodyLenOf(a) * 0.6) {
      if (beginRoll(a, s.quarry = q)) return true;
    }

    /* STATION, THEN RAM. The bearing slot comes from the pod sweep, so the
       members genuinely surround it and it cannot face them all; the ram
       cadence is creature_combat's own (opts.rate), phased per member off the
       spawn hash so eight orcas hit eight times as often as one instead of
       queueing behind a single commit token. */
    const slot = s.slot | 0;
    const bearing = (slot / Math.max(1, have)) * Math.PI * 2 +
      h01(homeOf(a).x, homeOf(a).z, 0x0CA2) * 0.9;
    const ring = bodyLenOf(q) * 0.62 + bodyLenOf(a) * 0.42;
    const face = (q.heading != null) ? q.heading : -q.group.rotation.y;
    const bx = qp.x + Math.cos(face + bearing) * ring;
    const bz = qp.z + Math.sin(face + bearing) * ring;

    const toMe = Math.atan2(p.z - qp.z, p.x - qp.x);
    const onFlank = Math.abs(shortest(toMe - face)) > 0.85;
    const inRange = d < ring * 1.9;
    s.state = "mob";

    /* AND THE QUARRY BITES BACK — which it otherwise would not, and that is
       not a detail. In this path city/marine_predation.js is absent by
       definition, so nothing in the game is driving the megalodon against an
       ORCA: it is hunting the player, or it is wandering. A pod attacking a
       punching bag always wins eventually, and the whole three-step curve the
       owner asked for depends on the other side hurting somebody. So the
       animal that is DRIVING this fight also resolves the quarry's answer to
       it, on the quarry itself, focused on ONE member at a time — an apex that
       divides its attention between eight is an apex that kills none of them,
       and taking a bite is precisely how a lone orca is supposed to lose. */
    q._orcaFocusT = (q._orcaFocusT || 0) - dt;
    if (q._orcaFocusT <= 0 || !q._orcaFocus || q._orcaFocus.dead) {
      q._orcaFocus = a; q._orcaFocusT = 2.2;
    }
    if (q._orcaFocus === a && inRange && !q._orcaRoll && !q.dead) {
      hurt(a, dpsAgainst(q, a) * dt, q,
        "killed by a " + String((q.species && (q.species.name || q.species.id)) || "shark").toLowerCase());
      if (a.dead) return false;
    }
    if (typeof CBZ.creatureFight === "function" && onFlank && inRange) {
      const o = ramOptsFor(a, s);
      o.reach = bodyLenOf(q) * 0.55 + bodyLenOf(a) * 0.42;
      o.targetRad = bodyLenOf(q) * 0.095;   // ≈ the hull's half-beam off its length
      o.dmg = dpsAgainst(a, q) * MOB.RAM_K;
      try { CBZ.creatureFight(a, q, dt, o); } catch (e) {}
      if (a._atkAnim >= 0) return true;                  // the swing owns the frame
    }
    // hold the bearing (or close on it)
    const want = Math.atan2(bz - p.z, bx - p.x);
    const gap = Math.hypot(bx - p.x, bz - p.z);
    const cruise = (a._spd0 || a.spd || 3.4) * 2.2;
    swim(a, gap > ring * 0.25 ? want : face, clamp(cruise * (0.6 + gap / (ring * 2)), cruise * 0.5, cruise * 3), dt);
    s.diveWant = Math.max(0.4, (qp.y != null ? surfaceAt(p.x, p.z, clock()) - qp.y : (a.swimDepth || 2.6)));
    return true;
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
    // A FIGHT ALREADY RUNNING KEEPS RUNNING FURTHER OUT. Cutting a takedown
    // off at the ordinary sim radius would leave a half-rolled megalodon
    // frozen belly-up the moment the player's boat drifted 900 u away.
    const busyFar = !!(a._orca && (a._orca.quarry || a._orca.rolling || a._orca.retreat > 0));
    if (dist > (busyFar ? FIGHT_R : SIM_R)) return false;

    const s = ensure(a);
    applyIdentity(a, s);
    s.owned = false;
    s.tick = FRAME;
    const t = clock();

    // A BODY BEING HELD, OR BEING ROLLED BELLY-UP BY marine_predation, IS NOT
    // TRAVELLING AND IS NOT SPY-HOPPING. Drop the act rather than freezing it
    // half-played — a whale stuck at 70 degrees nose-up is the worst read this
    // file could produce.
    if (a._seizedBy || a._mpRoll) {
      if (s.act) endAct(s);
      s.lift = 0; s.pitch = 0; s.roll = 0; s.airborne = false;
      proxy(a, s, dist, dt);
      return false;
    }

    /* WHO IS AROUND ME. Throttled to POD_SCAN, and it has to run BEFORE the
       mob: the finisher is gated on how many of us there are, so a pod that
       has not counted itself yet would report one member and never unlock. */
    if (POD()) podScan(a, s, dt);

    /* THE MOB OUTRANKS EVERYTHING. A pod working a megalodon is the headline
       of this whole feature; nothing about a boat, a breath or a formation is
       allowed to interrupt it. It stands down instantly when
       city/marine_predation.js is loaded — that file owns animal-vs-animal at
       sea and this is only its degrade path (see §7b). */
    if (mobStep(a, s, dt, dist)) {
      if (s.act) endAct(s);
      s.lift = 0; s.airborne = false; s.porp = false;
      depth(a, s, dt, t);
      if (CBZ.faceAnimalHeading) { try { CBZ.faceAnimalHeading(g, a.heading); } catch (e) {} }
      s.owned = true;
      proxy(a, s, dist, dt);
      return true;
    }

    /* THE REST OF THE PRIORITY LADDER, and the order is the whole design.

       A COMMITTED ORCA DOES NOT BREACH. Once it has decided, the hunt owns the
       animal outright — an act firing over a rush would read as the animal
       forgetting what it was doing, which is precisely the "loses interest"
       failure §6 exists to avoid. Everything SHORT of a commit is the opposite:
       the acts run first, because an orca that comes over, spy-hops at your
       boat and leaves is the behaviour, not an interruption of one. */
    const busy = s.committed || s.state === "rush" || s.state === "seize";
    const acting = busy ? false : actTick(a, s, dt, dist);
    if (busy && (s.act || s.porp)) { endAct(s); s.lift = 0; s.airborne = false; s.porp = false; }

    // ---- THE HUNT (shared driver, orca gate) --------------------------------
    let owned = false;
    const hunt = CBZ.predatorHunt, player = CBZ.player;
    if (HUNT() && typeof hunt === "function" && P && player && !player.dead && !s.calf && !acting) {
      const opts = optsFor(a, s);
      decide(a, s, player, dist, dt);
      let st = null;
      try { st = hunt(a, player, dt, opts); } catch (e) { st = null; }
      if (st && st !== "cruise") {
        // predatorHunt calls opts.onState itself on every transition — the
        // SEAMS closure above is that callback, and it is the one place the
        // dive target and the jaw are written. Calling it a second time from
        // here would be the "two mirrored expressions that can disagree" bug
        // wildlife_shark.js's header names.
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
        // MARINE_SIT_DEEPER: the pod's station-keeping depth, one notch lower.
        s.diveWant = (a.swimDepth || 2.6) * (s.calf ? 1.05 : 1.35) * (SITLOW() ? 1.15 : 1);
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
  /* AM I IN THE CHAIN, NOT AM I ON TOP. This test used to be
     `CBZ.sharkBrain === wrapped`, and city/marine_predation.js asks the same
     question from its own per-frame pass at 47.15 — so each file saw the
     other's wrapper on top, concluded it had been displaced, and wrapped
     again. Two closures per frame, forever, until the call stack ran out
     mid-match. See the long note in marine_predation.js:1507. Each link now
     carries its owner and its fall-through, and installWrap walks the chain
     looking for itself; a genuinely new CBZ.sharkBrain (wildlife_shark.js
     re-publishing) still re-arms it exactly once. */
  const BRAIN_LINK = "wildlife_orca";
  let orig = null, wrapped = null;
  function installWrap() {
    for (let f = CBZ.sharkBrain, n = 0; typeof f === "function" && n < 64; f = f._brainNext, n++) {
      if (f._brainLink === BRAIN_LINK) return;
    }
    orig = (typeof CBZ.sharkBrain === "function") ? CBZ.sharkBrain : null;
    wrapped = function (a, dt, P) {
      if (!isOrca(a)) return orig ? orig(a, dt, P) : false;
      if (orig && !a._shark) { try { orig(a, 0, P); } catch (e) {} }
      try { return orcaBrain(a, dt, P); } catch (e) { return false; }
    };
    wrapped._brainLink = BRAIN_LINK;
    wrapped._brainNext = orig;
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
      FRAME++;
      installWrap();
      tonicPass(dt);
      const list = actorList();
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
          if (s && s.spout && s.spout.visible) s.spout.visible = false;
          continue;
        }
        const st = s || ensure(a);
        /* NOBODY TICKED THIS ORCA THIS FRAME. Two reasons, and they want
           opposite answers:

             marine_predation.js took the actor for a fight  -> stand down, and
                drop any half-played act rather than freezing it (a whale stuck
                at seventy degrees nose-up is the worst read in this file).
             THE HOST HAS NO wildlife.js AT ALL          -> tick it HERE.

           The second case is why the eight-orca pod in games/battle.html did
           nothing: that page loads the bestiary and the combat driver but no
           wildlife engine, so CBZ.sharkBrain — the seam this file wraps — is
           never called by anybody and every behaviour in this file was dead
           code on that page. A block that only works inside one host is a
           block that silently does not ship. */
        if (st.tick !== FRAME - 1 && st.tick !== FRAME) {
          let ticked = false;
          if (!a._mpRoll && !a._seizedBy && typeof CBZ.sharkBrain !== "function") {
            try { ticked = orcaBrain(a, dt, P); } catch (_e) { ticked = false; }
          } else if (!a._mpRoll && !a._seizedBy && !CBZ.cityWildlife) {
            try { ticked = orcaBrain(a, dt, P); } catch (_e2) { ticked = false; }
          }
          if (!ticked && st.tick !== FRAME) {
            if (st.act) endAct(st);
            st.lift = 0; st.pitch = 0; st.roll = 0; st.airborne = false; st.porp = false;
          }
        }
        applyPose(a, st);
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
      wrapped: (function () { for (let f = CBZ.sharkBrain, n = 0; typeof f === "function" && n < 64; f = f._brainNext, n++) if (f._brainLink === BRAIN_LINK) return true; return false; })(),
      brainChain: (function () { let n = 0; for (let f = CBZ.sharkBrain; typeof f === "function" && n < 64; f = f._brainNext) n++; return n; })(),
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
        predatorStagger: typeof CBZ.predatorStagger === "function",
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
